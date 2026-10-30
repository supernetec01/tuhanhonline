import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { ApiError, changed, getSettings, roomLock, transaction, type Tx, type Row } from './db.js';
import { type Settings } from './config.js';
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
    let dirty = false;
    const expired = await tx.query(
      `UPDATE room_entries SET status='EXPIRED',ended_at=clock_timestamp() WHERE (status IN ('ACTIVE','INVITED') AND expires_at<=clock_timestamp()) OR (status='ACTIVE' AND disconnect_deadline<=clock_timestamp()) RETURNING id`,
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
    if (!running) {
      const next = (
        await tx.query(
          "SELECT id,duration_ms FROM ritual_actions WHERE type='incense' AND status='QUEUED' ORDER BY sequence LIMIT 1",
        )
      ).rows[0];
      if (next) {
        await tx.query(
          "UPDATE ritual_actions SET status='RUNNING',started_at=clock_timestamp(),ends_at=clock_timestamp()+duration_ms*interval '1 millisecond' WHERE id=$1",
          [next.id],
        );
        dirty = true;
      }
    }
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
          `SELECT e.seat_id,e.status,u.id AS player_id,u.name,u.equipped,u.accessory,a.type AS action,a.started_at,a.ends_at FROM room_entries e JOIN users u ON u.id=e.user_id LEFT JOIN ritual_actions a ON a.entry_id=e.id AND a.status='RUNNING' WHERE e.status IN ('ACTIVE','INVITED')`,
        )
      ).rows;
      const waiting = (
        await tx.query("SELECT count(*)::int AS count FROM room_entries WHERE status='WAITING'")
      ).rows[0].count;
      const capacity = Math.min(config.capacity, config.seatLayout.filter((s) => s.enabled).length);
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
      return {
        effect,
        ceremony,
        nextCeremony,
        ...room,
        configVersion,
        config,
        capacity,
        occupied: entries.length,
        waiting,
        available: capacity - entries.length,
        serverTime: new Date().toISOString(),
        seats: config.seatLayout.map((s) => ({
          ...s,
          code: String.fromCharCode(65 + Math.floor((s.id - 1) / 6)) + (((s.id - 1) % 6) + 1),
          player: entries.find((e) => e.seat_id === s.id && e.status === 'ACTIVE') ?? null,
          reserved: entries.some((e) => e.seat_id === s.id && e.status === 'INVITED'),
        })),
      };
    });
  }
  async join(userId: string, key: string) {
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
        const seat = (await this.freeSeats(tx, config))[0];
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
      const result = await tx.query(
        `UPDATE room_entries SET status='CANCELLED',ended_at=clock_timestamp() WHERE user_id=$1 AND ${live}`,
        [userId],
      );
      const dirty = await this.reconcile(tx, config);
      if (result.rowCount || dirty) await changed(tx);
    });
  }
  async accept(userId: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      const dirty = await this.reconcile(tx, config);
      const entry = (
        await tx.query(
          "UPDATE room_entries SET status='ACTIVE',expires_at=clock_timestamp()+$2*interval '1 minute',disconnect_deadline=clock_timestamp()+$3*interval '1 second' WHERE user_id=$1 AND status='INVITED' RETURNING *",
          [userId, config.sessionMinutes, config.graceSeconds],
        )
      ).rows[0];
      if (entry || dirty) await changed(tx);
      // Return failure after commit so an expired invitation still advances the queue.
      return entry ?? null;
    });
  }
  async heartbeat(userId: string) {
    const { config } = await getSettings(this.pool);
    await this.pool.query(
      "UPDATE room_entries SET disconnect_deadline=clock_timestamp()+$2*interval '1 second' WHERE user_id=$1 AND status='ACTIVE' AND expires_at>clock_timestamp() AND disconnect_deadline>clock_timestamp()",
      [userId, config.graceSeconds],
    );
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
        await tx.query("SELECT id FROM room_entries WHERE user_id=$1 AND status='ACTIVE'", [userId])
      ).rows[0];
      if (!entry)
        throw new ApiError(403, 'ACTIVE_SEAT_REQUIRED', 'Bạn cần có chỗ ngồi đang hoạt động.');
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
            : config.incenseCooldown;
      if (
        (
          await tx.query(
            "SELECT 1 FROM ritual_actions WHERE user_id=$1 AND type=$2 AND requested_at>clock_timestamp()-$3*interval '1 second'",
            [userId, type, cooldown],
          )
        ).rowCount
      )
        throw new ApiError(429, 'ACTION_COOLDOWN', 'Hãy chờ một chút trước khi thực hiện lại.');
      const queued =
        type === 'incense' &&
        !!(await tx.query("SELECT 1 FROM ritual_actions WHERE type='incense' AND status='RUNNING'"))
          .rowCount;
      const duration =
        type === 'bow' ? 2200 : type === 'prostrate' ? 3000 : config.incenseDuration * 1000;
      const result = (
        await tx.query(
          `INSERT INTO ritual_actions(id,entry_id,user_id,type,status,duration_ms,cooldown_ms,started_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='RUNNING' THEN clock_timestamp() END,CASE WHEN $5='RUNNING' THEN clock_timestamp()+$6::integer*interval '1 millisecond' END) RETURNING *`,
          [
            randomUUID(),
            entry.id,
            userId,
            type,
            queued ? 'QUEUED' : 'RUNNING',
            duration,
            cooldown * 1000,
          ],
        )
      ).rows[0];
      await tx.query('INSERT INTO commands VALUES($1,$2,$3,$4)', [userId, key, type, result.id]);
      await changed(tx);
      return result;
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
