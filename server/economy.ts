import { effectiveExpiry } from './movement.js';
import { type Pool } from 'pg';
import { ApiError, roomLock, changed, getSettings, transaction, type Tx } from './db.js';
import { type Settings } from './config.js';
const DAY = 86400000,
  OFFSET = 7 * 3600000;
const rewardDay = (at: number) => new Date(at + OFFSET).toISOString().slice(0, 10);
// Caller holds roomLock. Always settle the previous lease before extending or ending it.
export async function accrueCoins(tx: Tx, config: Settings, force = false) {
  const entries = (
    await tx.query(`SELECT e.id,e.user_id,e.reward_cursor,
    LEAST((${effectiveExpiry}),e.disconnect_deadline,clock_timestamp()) AS until,
    (e.expires_at<=clock_timestamp() OR e.disconnect_deadline<=clock_timestamp()) AS closing,
    coalesce(p.remainder_ms,0) AS remainder_ms
    FROM room_entries e JOIN users u ON u.id=e.user_id
    LEFT JOIN coin_progress p ON p.user_id=e.user_id AND p.day=(e.reward_cursor AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    WHERE e.status='ACTIVE' AND e.character_state NOT IN ('STANDING','WALKING_AWAY','RETURNING') AND NOT u.banned ORDER BY e.user_id`)
  ).rows;
  let dirty = false;
  for (const e of entries) {
    let cursor = new Date(e.reward_cursor).getTime();
    const until = new Date(e.until).getTime();
    if (until <= cursor) continue;
    if (
      !force &&
      !e.closing &&
      rewardDay(cursor) === rewardDay(until) &&
      until - cursor + e.remainder_ms < 60000
    )
      continue;
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [e.user_id]);
    let cultivated = 0;
    while (cursor < until) {
      const day = rewardDay(cursor),
        end = Math.min(until, (Math.floor((cursor + OFFSET) / DAY) + 1) * DAY - OFFSET);
      await tx.query(
        'INSERT INTO coin_progress(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [e.user_id, day],
      );
      const progress = (
        await tx.query(
          'SELECT remainder_ms FROM coin_progress WHERE user_id=$1 AND day=$2 FOR UPDATE',
          [e.user_id, day],
        )
      ).rows[0];
      const total = progress.remainder_ms + end - cursor,
        minutes = Math.floor(total / 60000);
      const count = (
        await tx.query(
          `SELECT coalesce(sum(amount),0)::int AS n FROM coin_ledger WHERE user_id=$1 AND source LIKE 'minute:%' AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=$2::date`,
          [e.user_id, day],
        )
      ).rows[0].n;
      const award = Math.min(minutes, Math.max(0, config.dailyCoinCap - count));
      if (award) {
        const result = await tx.query(
          `INSERT INTO coin_ledger(user_id,amount,source,created_at)
          SELECT $1,1,'minute:'||$2||':'||n::text,$3::timestamptz+(n*60000-$4)*interval '1 millisecond'-interval '1 millisecond'
          FROM generate_series(1,$5::int) n ON CONFLICT(source) DO NOTHING RETURNING id`,
          [
            e.user_id,
            `${e.id}:${new Date(cursor).toISOString()}`,
            new Date(cursor),
            progress.remainder_ms,
            award,
          ],
        );
        if (result.rowCount) {
          await tx.query('UPDATE users SET coins=coins+$2 WHERE id=$1', [
            e.user_id,
            result.rowCount,
          ]);
          dirty = true;
        }
      }
      cultivated += minutes;
      await tx.query('UPDATE coin_progress SET remainder_ms=$3 WHERE user_id=$1 AND day=$2', [
        e.user_id,
        day,
        total % 60000,
      ]);
      cursor = end;
    }
    await tx.query(
      'UPDATE room_entries SET cultivated_minutes=cultivated_minutes+$2,reward_cursor=$3 WHERE id=$1',
      [e.id, cultivated, new Date(until)],
    );
  }
  return dirty;
}
export async function completeMerit(tx: Tx, _config: Settings) {
  const actions = (
    await tx.query(
      `UPDATE ritual_actions a SET status='COMPLETED' FROM room_entries e WHERE e.id=a.entry_id AND e.status='ACTIVE' AND a.status='RUNNING' AND a.ends_at<=LEAST(clock_timestamp(),greatest(e.expires_at,coalesce(e.ritual_protected_until,e.expires_at)),e.disconnect_deadline) RETURNING a.*`,
    )
  ).rows;
  for (const a of actions) {
    const added = await tx.query(
      'INSERT INTO merit_transactions(source_action_id,user_id,amount,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING amount',
      [a.id, a.user_id, a.merit_reward, a.ends_at],
    );
    if (added.rowCount)
      await tx.query('UPDATE users SET merit=merit+$2,merit_at=$3 WHERE id=$1', [
        a.user_id,
        a.merit_reward,
        a.ends_at,
      ]);
  }
  return actions.length > 0;
}
export async function snapshotRanks(tx: Tx) {
  const previous = (
    await tx.query(
      "SELECT 1 FROM leaderboard_snapshots WHERE kind='merit' AND created_at>clock_timestamp()-interval '300 seconds'",
    )
  ).rowCount;
  if (previous) return;
  await tx.query("DELETE FROM chat_messages WHERE created_at<clock_timestamp()-interval '30 days'");
  // Persist every rank, so personal rank and Top 10 use exactly the same snapshot.
  await tx.query(
    `INSERT INTO leaderboard_snapshots(kind,payload) SELECT 'merit',COALESCE(jsonb_agg(r),'[]') FROM (SELECT id,name,merit,row_number() OVER(ORDER BY merit DESC,merit_at,id)::int AS rank FROM users WHERE NOT banned) r ON CONFLICT(kind) DO UPDATE SET payload=EXCLUDED.payload,created_at=clock_timestamp() WHERE leaderboard_snapshots.created_at<=clock_timestamp()-interval '300 seconds'`,
  );
  await tx.query(
    `INSERT INTO leaderboard_snapshots(kind,payload) SELECT 'live',COALESCE(jsonb_agg(r),'[]') FROM (SELECT provider,sender_key,max(display_name) AS name,sum(quantity)::int AS gifts FROM live_events GROUP BY provider,sender_key ORDER BY sum(quantity) DESC,provider,sender_key LIMIT 10) r ON CONFLICT(kind) DO UPDATE SET payload=EXCLUDED.payload,created_at=clock_timestamp() WHERE leaderboard_snapshots.created_at<=clock_timestamp()-interval '300 seconds'`,
  );
}
export class EconomyService {
  constructor(readonly pool: Pool) {}
  async buyDots(userId: string, pair: number, key: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const u = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      const old = (
        await tx.query('SELECT pair FROM dot_unlocks WHERE user_id=$1 AND request_key=$2', [
          userId,
          key,
        ])
      ).rows[0];
      if (old) {
        if (old.pair !== pair) throw new ApiError(409, 'KEY_REUSED', 'Mã yêu cầu đã dùng.');
        return;
      }
      if (pair !== u.dots / 2 + 1)
        throw new ApiError(409, 'DOT_ORDER', 'Mở lần lượt từng cặp, tối đa 8 chấm.');
      const { config } = await getSettings(tx),
        price = config.dotPrices[pair - 1];
      if (u.coins < price) throw new ApiError(409, 'INSUFFICIENT_COINS', 'Bạn chưa đủ xu.');
      await tx.query('UPDATE users SET coins=coins-$2,dots=$3 WHERE id=$1', [
        userId,
        price,
        pair * 2,
      ]);
      await tx.query('INSERT INTO dot_unlocks VALUES($1,$2,$3,$4)', [userId, pair, key, price]);
      await tx.query('INSERT INTO coin_ledger(user_id,amount,source) VALUES($1,$2,$3)', [
        userId,
        -price,
        `dots:${userId}:${pair}`,
      ]);
      await changed(tx, 'wallet.updated');
    });
  }
  async journal(userId: string) {
    return (
      await this.pool.query(
        `SELECT u.coins,u.merit,u.dots,(SELECT COALESCE(sum(cultivated_minutes),0)::int FROM room_entries WHERE user_id=u.id) AS cultivated_minutes,(SELECT COALESCE(jsonb_object_agg(type,n),'{}') FROM (SELECT type,count(*)::int AS n FROM ritual_actions WHERE user_id=u.id AND status='COMPLETED' GROUP BY type) x) AS rituals FROM users u WHERE id=$1`,
        [userId],
      )
    ).rows[0];
  }
  async ranks(userId?: string) {
    const rows = (await this.pool.query('SELECT * FROM leaderboard_snapshots')).rows;
    const merit = rows.find((r) => r.kind === 'merit'),
      live = rows.find((r) => r.kind === 'live');
    return {
      merit: merit?.payload.slice(0, 10) ?? [],
      mine: merit?.payload.find((r: { id: string }) => r.id === userId) ?? null,
      updatedAt: merit?.created_at ?? null,
      live: live?.payload ?? [],
      liveUpdatedAt: live?.created_at ?? null,
      liveUnit: 'quà tham chiếu (gồm mô phỏng)',
    };
  }
}
