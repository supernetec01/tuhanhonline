import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { transaction, roomLock, getSettings, changed, ApiError } from './db.js';
export class ExperienceService {
  constructor(readonly pool: Pool) {}
  async tick() {
    await transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { id, config } = await getSettings(tx);
      let dirty = false;
      dirty = !!(
        await tx.query(
          "UPDATE effect_jobs SET status='COMPLETED' WHERE status='RUNNING' AND ends_at<=clock_timestamp() RETURNING id",
        )
      ).rowCount;
      await tx.query(
        "UPDATE effect_jobs SET status='SKIPPED' WHERE status='QUEUED' AND created_at<clock_timestamp()-interval '60 seconds'",
      );
      if (!(await tx.query("SELECT 1 FROM effect_jobs WHERE status='RUNNING'")).rowCount) {
        const next = (
          await tx.query(
            "SELECT id FROM effect_jobs WHERE status='QUEUED' ORDER BY created_at,id LIMIT 1",
          )
        ).rows[0];
        if (next) {
          await tx.query(
            "UPDATE effect_jobs SET status='RUNNING',starts_at=clock_timestamp(),ends_at=clock_timestamp()+duration_ms*interval '1 millisecond' WHERE id=$1",
            [next.id],
          );
          dirty = true;
        }
      }
      dirty =
        !!(
          await tx.query(
            "UPDATE ceremony_runs SET status='COMPLETED' WHERE status='RUNNING' AND ends_at<=clock_timestamp() RETURNING id",
          )
        ).rowCount || dirty;
      const clock = (await tx.query('SELECT * FROM ceremony_clock WHERE id=1')).rows[0];
      if (!config.live.ceremonyEnabled) {
        if (clock.next_at) {
          await tx.query('UPDATE ceremony_clock SET next_at=NULL,config_version=$1 WHERE id=1', [
            id,
          ]);
          dirty = true;
        }
      } else if (!clock.next_at || String(clock.config_version) !== id) {
        await tx.query(
          "UPDATE ceremony_clock SET next_at=clock_timestamp()+$1*interval '1 minute',config_version=$2 WHERE id=1",
          [config.live.ceremonyIntervalMinutes, id],
        );
        dirty = true;
      } else if (new Date(clock.next_at).getTime() <= Date.now()) {
        if (!(await tx.query("SELECT 1 FROM ceremony_runs WHERE status='RUNNING'")).rowCount)
          await tx.query(
            "INSERT INTO ceremony_runs(id,source,scheduled_at,starts_at,ends_at,status) VALUES($1,'scheduled',$2,clock_timestamp(),clock_timestamp()+interval '60 seconds','RUNNING') ON CONFLICT(scheduled_at) DO NOTHING",
            [randomUUID(), clock.next_at],
          );
        await tx.query(
          "UPDATE ceremony_clock SET next_at=clock_timestamp()+$1*interval '1 minute' WHERE id=1",
          [config.live.ceremonyIntervalMinutes],
        );
        dirty = true;
      }
      if (dirty) await changed(tx, 'experience.changed');
    });
  }
  async start(userId: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      if (
        (
          await tx.query(
            "SELECT 1 FROM ceremony_runs WHERE status='RUNNING' AND ends_at>clock_timestamp()",
          )
        ).rowCount
      )
        throw new ApiError(409, 'CEREMONY_BUSY', 'Phiên thiền chung đang diễn ra.');
      await tx.query("UPDATE ceremony_runs SET status='COMPLETED' WHERE status='RUNNING'");
      const run = (
        await tx.query(
          "INSERT INTO ceremony_runs(id,source,scheduled_at,starts_at,ends_at,status,created_by) VALUES($1,'manual',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '60 seconds','RUNNING',$2) RETURNING *",
          [randomUUID(), userId],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'ceremony.test',$2)",
        [userId, JSON.stringify({ id: run.id })],
      );
      await changed(tx, 'experience.changed');
      return run;
    });
  }
  async analytics() {
    const counts = (
      await this.pool.query(
        `SELECT (SELECT count(*) FROM live_events)::int AS received_events,(SELECT coalesce(sum(quantity),0) FROM live_events)::int AS gifts,(SELECT count(*) FROM tts_jobs WHERE status='FAILED')::int AS failed_tts,(SELECT count(*) FROM tts_jobs WHERE status='SKIPPED')::int AS text_fallbacks,(SELECT count(*) FROM effect_jobs WHERE status='QUEUED')::int AS effects_waiting,(SELECT count(*) FROM ceremony_runs)::int AS ceremonies,(SELECT percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch from (played_at-created_at))) FROM tts_jobs WHERE played_at IS NOT NULL) AS tts_p95_seconds`,
      )
    ).rows[0];
    return {
      ...counts,
      tiktok_viewers: null,
      notice: 'Chỉ số từ ứng dụng; không có dữ liệu lượt xem TikTok.',
    };
  }
}
