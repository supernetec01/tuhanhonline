import { arriveMovements, advanceIncense, planMovement } from './movement.js';
import { navigation } from './navigation.js';
import { selectNpcSeats } from './npc-config.js';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { ApiError, changed, getSettings, roomLock, transaction, type Tx, type Row } from './db.js';
import { type Settings } from './config.js';
import { accrueCoins, completeMerit, snapshotRanks } from './economy.js';
const live = "status IN ('ACTIVE','WAITING','INVITED')";
export class RoomService {
  constructor(readonly pool: Pool) {}
  private async freeSeats(tx: Tx, c: Settings): Promise<number[]> {
    const enabled = c.seatLayout
      .filter((s) => s.enabled)
      .map((s) => s.id)
      .sort((a, b) => a - b)
      .slice(0, c.capacity);
    const occupied = new Set(
      (
        await tx.query("SELECT seat_id FROM room_entries WHERE status IN ('ACTIVE','INVITED')")
      ).rows.map((r) => r.seat_id),
    );
    return enabled.filter((id) => !occupied.has(id));
  }
  async reconcile(tx: Tx, c: Settings) {
    let dirty = await accrueCoins(tx, c);
    const arrived = await arriveMovements(tx, c);
    if (arrived) {
      dirty = true;
      dirty = (await accrueCoins(tx, c)) || dirty;
    }
    dirty = (await completeMerit(tx, c)) || dirty;
    await snapshotRanks(tx);
    const expired = await tx.query(
      `UPDATE room_entries SET status='EXPIRED',ended_at=clock_timestamp() WHERE (status IN ('ACTIVE','INVITED') AND greatest(expires_at,coalesce(ritual_protected_until,expires_at))<=clock_timestamp()) OR (status='ACTIVE' AND (disconnect_deadline<=clock_timestamp() OR leave_deadline<=clock_timestamp())) RETURNING id`,
    );
    dirty ||= !!expired.rowCount;
    const cancelled = await tx.query(
      `UPDATE ritual_actions a SET status='CANCELLED',ends_at=clock_timestamp() WHERE status IN ('RUNNING','QUEUED') AND NOT EXISTS(SELECT 1 FROM room_entries e WHERE e.id=a.entry_id AND e.status='ACTIVE') RETURNING id`,
    );
    dirty ||= !!cancelled.rowCount;
    const completed = await tx.query(
      "UPDATE ritual_actions SET status='COMPLETED' WHERE status='RUNNING' AND ends_at<=clock_timestamp() RETURNING id",
    );
    dirty ||= !!completed.rowCount;
    const running = (
      await tx.query("SELECT 1 FROM ritual_actions WHERE type='incense' AND status='RUNNING'")
    ).rowCount;
    if (!c.movement.enabled && !running) {
      const next = (
        await tx.query(
          "SELECT id,duration_ms FROM ritual_actions WHERE type='incense' AND status='QUEUED' ORDER BY sequence LIMIT 1",
        )
      ).rows[0];
      if (next) {
        await tx.query(
          "UPDATE ritual_actions SET station='A',status='RUNNING',started_at=clock_timestamp(),ends_at=clock_timestamp()+duration_ms*interval '1 millisecond' WHERE id=$1",
          [next.id],
        );
        dirty = true;
      }
    }
    if (c.movement.enabled) dirty = (await advanceIncense(tx, c)) || dirty;
    const open =
      (await tx.query("SELECT status FROM rooms WHERE id='main'")).rows[0].status === 'open';
    if (open)
      for (const seat of await this.freeSeats(tx, c)) {
        const next = (
          await tx.query(
            "SELECT id FROM room_entries WHERE status='WAITING' ORDER BY sequence LIMIT 1",
          )
        ).rows[0];
        if (!next) break;
        await tx.query(
          "UPDATE room_entries SET status='INVITED',seat_id=$1,expires_at=clock_timestamp()+$2*interval '1 second' WHERE id=$3",
          [seat, c.invitationSeconds, next.id],
        );
        dirty = true;
      }
    return dirty;
  }
  async tick() {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      if (await this.reconcile(tx, config)) await changed(tx);
    });
  }
  async myEntry(userId: string) {
    return (
      (
        await this.pool.query(
          `SELECT e.*,s.code AS seat_code,(SELECT count(*)::int FROM room_entries w WHERE w.status='WAITING' AND w.sequence<=e.sequence) AS position FROM room_entries e LEFT JOIN seats s ON s.id=e.seat_id WHERE e.user_id=$1 AND e.${live} ORDER BY e.sequence DESC LIMIT 1`,
          [userId],
        )
      ).rows[0] ?? null
    );
  }
  async snapshot() {
    // One repeatable snapshot prevents occupancy and avatars from describing different commits.
    return transaction(this.pool, async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const { id: configVersion, config } = await getSettings(tx);
      const room = (await tx.query("SELECT status,version::text FROM rooms WHERE id='main'"))
        .rows[0];
      const entries = (
        await tx.query(
          `SELECT e.seat_id,e.status,u.id AS player_id,u.name,u.equipped,u.accessory,u.dots,u.cosmetics,u.appearance_type,e.character_state,e.position_node,e.movement_path,e.move_started_at,e.move_ends_at,e.leave_deadline,a.id AS action_id,a.phase,a.queue_slot,a.station,a.type AS action,a.started_at,a.ends_at FROM room_entries e JOIN users u ON u.id=e.user_id LEFT JOIN ritual_actions a ON a.entry_id=e.id AND a.status IN ('RUNNING','QUEUED') WHERE e.status IN ('ACTIVE','INVITED')`,
        )
      ).rows;
      const waiting = (
        await tx.query("SELECT count(*)::int AS count FROM room_entries WHERE status='WAITING'")
      ).rows[0].count;
      const capacity = Math.min(config.capacity, config.seatLayout.filter((s) => s.enabled).length);
      const enabledIds = config.seatLayout
        .filter((s) => s.enabled)
        .map((s) => s.id)
        .sort((a, b) => a - b)
        .slice(0, capacity);
      const effect =
        (
          await tx.query(
            "SELECT id,kind,name,show_name,starts_at,ends_at FROM effect_jobs WHERE status='RUNNING' AND ends_at>clock_timestamp()",
          )
        ).rows[0] ?? null;
      const ceremony =
        (
          await tx.query(
            "SELECT id,starts_at,ends_at FROM ceremony_runs WHERE status='RUNNING' AND ends_at>clock_timestamp()",
          )
        ).rows[0] ?? null;
      const nextCeremony =
        (await tx.query('SELECT next_at FROM ceremony_clock WHERE id=1')).rows[0]?.next_at ?? null;
      const seats = config.seatLayout
        .filter((s) => s.id <= 36 || config.capacity > 36 || enabledIds.some((id) => id > 36))
        .map((s) => ({
          ...s,
          enabled: enabledIds.includes(s.id),
          code: String.fromCharCode(65 + Math.floor((s.id - 1) / 6)) + (((s.id - 1) % 6) + 1),
          player: entries.find((e) => e.seat_id === s.id && e.status === 'ACTIVE') ?? null,
          reserved: entries.some((e) => e.seat_id === s.id && e.status === 'INVITED'),
        }));
      return {
        effect,
        ceremony,
        nextCeremony,
        ...room,
        configVersion,
        navigation: config.movement.enabled
          ? [...navigation(config).nodes.values()].filter((n) => n.walkable)
          : [],
        config: { ...config, store: { title: config.store.title, products: [] } },
        capacity,
        occupied: entries.length,
        waiting,
        waitingPlayers: (
          await tx.query(
            "SELECT u.name,u.equipped,u.accessory FROM room_entries e JOIN users u ON u.id=e.user_id WHERE e.status='WAITING' ORDER BY e.sequence LIMIT $1",
            [config.waitingDisplayLimit],
          )
        ).rows,
        available: capacity - entries.length,
        serverTime: new Date().toISOString(),
        activeCount: entries.filter((e) => e.status === 'ACTIVE').length,
        reservedCount: entries.filter((e) => e.status === 'INVITED').length,
        npcTargetCount: selectNpcSeats(seats, config.npc).length,
        seats,
      };
    });
  }
  async join(userId: string, key: string, preferredSeat?: number) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      let dirty = await this.reconcile(tx, config);
      const replay = (
        await tx.query('SELECT * FROM commands WHERE user_id=$1 AND request_key=$2', [userId, key])
      ).rows[0];
      if (replay) {
        if (replay.operation !== 'join')
          throw new ApiError(409, 'KEY_REUSED', 'Mã yêu cầu đã được dùng.');
        if (dirty) await changed(tx);
        return (await tx.query('SELECT * FROM room_entries WHERE id=$1', [replay.result_id]))
          .rows[0];
      }
      let entry = (
        await tx.query(`SELECT * FROM room_entries WHERE user_id=$1 AND ${live}`, [userId])
      ).rows[0];
      if (!entry) {
        if ((await tx.query("SELECT status FROM rooms WHERE id='main'")).rows[0].status !== 'open')
          throw new ApiError(409, 'ROOM_CLOSED', 'Chánh điện đang tạm đóng.');
        const free = await this.freeSeats(tx, config);
        if (preferredSeat !== undefined && free.length && !free.includes(preferredSeat))
          throw new ApiError(
            409,
            'SLOT_OCCUPIED',
            'Đệm ngồi đã được giữ hoặc đang tắt. Hãy chọn vị trí khác.',
          );
        const seat =
          preferredSeat !== undefined && free.includes(preferredSeat) ? preferredSeat : free[0];
        const id = randomUUID();
        entry = (
          await tx.query(
            `INSERT INTO room_entries(id,user_id,seat_id,status,expires_at,disconnect_deadline) VALUES($1,$2,$3,$4,CASE WHEN $3::integer IS NULL THEN NULL ELSE clock_timestamp()+$5*interval '1 minute' END,CASE WHEN $3::integer IS NULL THEN NULL ELSE clock_timestamp()+$6*interval '1 second' END) RETURNING *`,
            [
              id,
              userId,
              seat ?? null,
              seat ? 'ACTIVE' : 'WAITING',
              config.sessionMinutes,
              config.graceSeconds,
            ],
          )
        ).rows[0];
        if (seat)
          await tx.query('UPDATE room_entries SET position_node=$2 WHERE id=$1', [
            entry.id,
            `seat:${seat}`,
          ]);
        dirty = true;
      }
      await tx.query('INSERT INTO commands VALUES($1,$2,$3,$4)', [userId, key, 'join', entry.id]);
      if (dirty) await changed(tx);
      return entry;
    });
  }
  async leave(userId: string) {
    await transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      const earned = await accrueCoins(tx, config, true);
      const beforeDirty = await this.reconcile(tx, config);
      const result = await tx.query(
        `UPDATE room_entries SET status='CANCELLED',ended_at=clock_timestamp() WHERE user_id=$1 AND ${live}`,
        [userId],
      );
      const dirty = await this.reconcile(tx, config);
      if (result.rowCount || dirty || beforeDirty || earned) await changed(tx);
    });
  }
  async accept(userId: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      const dirty = await this.reconcile(tx, config);
      const entry = (
        await tx.query(
          "UPDATE room_entries SET status='ACTIVE',character_state='SEATED',position_node='seat:'||seat_id,reward_cursor=clock_timestamp(),expires_at=clock_timestamp()+$2*interval '1 minute',disconnect_deadline=clock_timestamp()+$3*interval '1 second' WHERE user_id=$1 AND status='INVITED' RETURNING *",
          [userId, config.sessionMinutes, config.graceSeconds],
        )
      ).rows[0];
      if (entry || dirty) await changed(tx);
      // Return failure after commit so an expired invitation still advances the queue.
      return entry ?? null;
    });
  }
  async heartbeat(userId: string) {
    await transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      const minted = await accrueCoins(tx, config, true);
      await tx.query(
        "UPDATE room_entries SET disconnect_deadline=clock_timestamp()+$2*interval '1 second' WHERE user_id=$1 AND status='ACTIVE' AND greatest(expires_at,coalesce(ritual_protected_until,expires_at))>clock_timestamp() AND disconnect_deadline>clock_timestamp()",
        [userId, config.graceSeconds],
      );
      if (minted) await changed(tx, 'wallet.updated');
    });
  }

  async action(userId: string, type: string, key: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      const dirty = await this.reconcile(tx, config);
      const replay = (
        await tx.query('SELECT * FROM commands WHERE user_id=$1 AND request_key=$2', [userId, key])
      ).rows[0];
      if (replay) {
        if (replay.operation !== type)
          throw new ApiError(409, 'KEY_REUSED', 'Mã yêu cầu đã được dùng.');
        if (dirty) await changed(tx);
        return (await tx.query('SELECT * FROM ritual_actions WHERE id=$1', [replay.result_id]))
          .rows[0];
      }
      if (!config.actionsEnabled)
        throw new ApiError(409, 'ACTION_DISABLED', 'Nghi lễ đang tạm dừng.');
      const entry = (
        await tx.query("SELECT * FROM room_entries WHERE user_id=$1 AND status='ACTIVE'", [userId])
      ).rows[0];
      if (!entry)
        throw new ApiError(403, 'ACTIVE_SEAT_REQUIRED', 'Bạn cần có chỗ ngồi đang hoạt động.');
      if (config.movement.enabled && entry.character_state !== 'SEATED')
        throw new ApiError(
          409,
          'CHARACTER_BUSY',
          'Hãy quay lại ghế và ngồi xuống trước khi làm nghi lễ.',
        );
      if (
        (
          await tx.query(
            "SELECT 1 FROM ritual_actions WHERE user_id=$1 AND status IN ('RUNNING','QUEUED')",
            [userId],
          )
        ).rowCount
      )
        throw new ApiError(409, 'ACTION_BUSY', 'Bạn đang thực hiện hoặc chờ một nghi lễ.');
      const cooldown =
        type === 'bow'
          ? config.bowCooldown
          : type === 'prostrate'
            ? config.prostrateCooldown
            : config.movement.enabled
              ? 300
              : config.incenseCooldown;
      if (
        (
          await tx.query(
            "SELECT 1 FROM ritual_actions WHERE user_id=$1 AND type=$2 AND started_at>clock_timestamp()-$3*interval '1 second'",
            [userId, type, cooldown],
          )
        ).rowCount
      )
        throw new ApiError(429, 'ACTION_COOLDOWN', 'Hãy chờ một chút trước khi thực hiện lại.');
      const queued =
        type === 'incense' &&
        (config.movement.enabled ||
          !!(
            await tx.query("SELECT 1 FROM ritual_actions WHERE type='incense' AND status='RUNNING'")
          ).rowCount);
      const duration =
        type === 'bow'
          ? 2000
          : type === 'prostrate'
            ? 4000
            : config.movement.enabled
              ? 5000
              : config.incenseDuration * 1000;
      const result = (
        await tx.query(
          `INSERT INTO ritual_actions(id,entry_id,user_id,type,status,duration_ms,cooldown_ms,merit_reward,started_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $5='RUNNING' THEN clock_timestamp() END,CASE WHEN $5='RUNNING' THEN clock_timestamp()+$6::integer*interval '1 millisecond' END) RETURNING *`,
          [
            randomUUID(),
            entry.id,
            userId,
            type,
            queued ? 'QUEUED' : 'RUNNING',
            duration,
            cooldown * 1000,
            config.ritualMerit[type as keyof typeof config.ritualMerit],
          ],
        )
      ).rows[0];
      if (type === 'incense') {
        if (config.movement.enabled) {
          await tx.query(
            "UPDATE ritual_actions SET phase='PENDING',cooldown_ms=300000,merit_reward=10 WHERE id=$1",
            [result.id],
          );
          await tx.query("UPDATE room_entries SET character_state='INCENSE_PENDING' WHERE id=$1", [
            entry.id,
          ]);
          await advanceIncense(tx, config);
        } else if (!queued)
          await tx.query("UPDATE ritual_actions SET station='A' WHERE id=$1", [result.id]);
      }
      await tx.query('INSERT INTO commands VALUES($1,$2,$3,$4)', [userId, key, type, result.id]);
      await changed(tx);
      return result;
    });
  }
  async move(userId: string, key: string, target?: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      if (!config.movement.enabled)
        throw new ApiError(409, 'MOVEMENT_DISABLED', 'Di chuyển đang tạm tắt.');
      const dirty = await this.reconcile(tx, config);
      const old = (
        await tx.query('SELECT * FROM movement_commands WHERE user_id=$1 AND request_key=$2', [
          userId,
          key,
        ])
      ).rows[0];
      const operation = target ?? 'return';
      if (old) {
        if (old.operation !== operation)
          throw new ApiError(409, 'KEY_REUSED', 'Mã yêu cầu đã dùng.');
        if (dirty) await changed(tx);
        return (await tx.query('SELECT * FROM room_entries WHERE id=$1', [old.entry_id])).rows[0];
      }
      const e = (
        await tx.query("SELECT * FROM room_entries WHERE user_id=$1 AND status='ACTIVE'", [userId])
      ).rows[0];
      if (!e) throw new ApiError(403, 'ACTIVE_SEAT_REQUIRED', 'Bạn cần một ghế đang giữ.');
      if (
        e.movement_path ||
        e.character_state.startsWith('INCENSE') ||
        (
          await tx.query(
            "SELECT 1 FROM ritual_actions WHERE user_id=$1 AND status IN ('RUNNING','QUEUED')",
            [userId],
          )
        ).rowCount
      )
        throw new ApiError(409, 'CHARACTER_BUSY', 'Nhân vật đang di chuyển hoặc làm nghi lễ.');
      if (target && !navigation(config).nodes.get(target)?.walkable)
        throw new ApiError(400, 'INVALID_DESTINATION', 'Hãy chọn lối đi hợp lệ.');
      await accrueCoins(tx, config, true);
      if (target) {
        await planMovement(tx, config, e, target, 'WALKING_AWAY');
        await tx.query(
          "UPDATE room_entries SET leave_deadline=coalesce(leave_deadline,clock_timestamp()+interval '180 seconds') WHERE id=$1",
          [e.id],
        );
      } else if (e.character_state !== 'SEATED')
        await planMovement(tx, config, e, `seat:${e.seat_id}`, 'RETURNING');
      await tx.query('INSERT INTO movement_commands VALUES($1,$2,$3,$4)', [
        userId,
        key,
        operation,
        e.id,
      ]);
      await changed(tx, target ? 'character.move.started' : 'character.return.started');
      return (await tx.query('SELECT * FROM room_entries WHERE id=$1', [e.id])).rows[0];
    });
  }
  async myAction(userId: string): Promise<Row | null> {
    return (
      (
        await this.pool.query(
          "SELECT * FROM ritual_actions WHERE user_id=$1 AND status IN ('QUEUED','RUNNING') ORDER BY sequence LIMIT 1",
          [userId],
        )
      ).rows[0] ?? null
    );
  }
}
