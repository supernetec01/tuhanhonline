import { MediaService } from './media.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { type Pool } from 'pg';
import { z } from 'zod';
import { ApiError, transaction, roomLock, changed, getSettings } from './db.js';
export const liveEventSchema = z
  .object({
    liveId: z.string().min(1).max(100),
    sourceEventId: z.string().min(1).max(100),
    senderId: z.string().min(1).max(100),
    displayName: z.string().max(100),
    giftId: z.string().min(1).max(50),
    count: z.number().int().min(1).max(10000),
    streakId: z.string().min(1).max(100).optional(),
  })
  .strict();
export type LiveEvent = z.infer<typeof liveEventSchema>;
export interface LiveEventAdapter {
  readonly provider: string;
  receive(event: LiveEvent): Promise<unknown>;
}
export class MockLiveAdapter implements LiveEventAdapter {
  readonly provider = 'mock';
  constructor(readonly live: LiveService) {}
  receive(event: LiveEvent) {
    return this.live.ingest(this.provider, event);
  }
}
export class ApprovedWebhookAdapter implements LiveEventAdapter {
  readonly provider = 'partner';
  constructor(readonly live: LiveService) {}
  receive(event: LiveEvent) {
    return this.live.ingest(this.provider, event);
  }
}
export function safeName(value: string) {
  const name = value.normalize('NFKC').trim();
  return /^[\p{L}\p{N} ._-]{2,32}$/u.test(name) && !/(đụ|địt|fuck|shit|cặc|lồn)/iu.test(name)
    ? name
    : 'Một người hữu duyên';
}
export class LiveService {
  constructor(readonly pool: Pool) {}
  async ingest(provider: string, event: LiveEvent) {
    const parsed = liveEventSchema.parse(event);
    return transaction(this.pool, async (tx) => {
      await roomLock(tx); // serializes streak totals and outbox order across workers/API processes
      const senderKey = createHash('sha256').update(`${provider}:${parsed.senderId}`).digest('hex');
      const duplicate = await tx.query(
        'SELECT id FROM live_events WHERE provider=$1 AND live_id=$2 AND source_event_id=$3',
        [provider, parsed.liveId, parsed.sourceEventId],
      );
      if (duplicate.rowCount) return { duplicate: true, id: duplicate.rows[0].id, quantity: 0 };
      let delta = parsed.count;
      if (parsed.streakId) {
        const values = [provider, parsed.liveId, senderKey, parsed.giftId, parsed.streakId];
        const previous = (
          await tx.query(
            'SELECT max_count FROM gift_streaks WHERE provider=$1 AND live_id=$2 AND sender_key=$3 AND gift_id=$4 AND streak_id=$5',
            values,
          )
        ).rows[0];
        delta = Math.max(0, parsed.count - (previous?.max_count ?? 0));
        await tx.query(
          'INSERT INTO gift_streaks VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,live_id,sender_key,gift_id,streak_id) DO UPDATE SET max_count=GREATEST(gift_streaks.max_count,excluded.max_count)',
          [...values, parsed.count],
        );
      }
      const id = randomUUID(),
        name = safeName(parsed.displayName);
      await tx.query(
        'INSERT INTO live_events(id,provider,live_id,source_event_id,sender_key,display_name,gift_id,quantity,streak_id,cumulative_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          provider,
          parsed.liveId,
          parsed.sourceEventId,
          senderKey,
          name,
          parsed.giftId,
          delta,
          parsed.streakId ?? null,
          parsed.count,
        ],
      );
      if (delta > 0) {
        const { config } = await getSettings(tx);
        const rule = config.live.effects.find((r) => r.giftId === parsed.giftId && r.enabled);
        if (rule) {
          const n = (
            await tx.query(
              "SELECT count(*)::int AS n FROM effect_jobs WHERE status IN ('QUEUED','RUNNING')",
            )
          ).rows[0].n;
          await tx.query(
            'INSERT INTO effect_jobs(id,event_id,kind,name,show_name,duration_ms,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              randomUUID(),
              id,
              rule.kind,
              name,
              rule.showName,
              rule.durationSeconds * 1000,
              n < 30 ? 'QUEUED' : 'SKIPPED',
            ],
          );
        }
        const pending = (
          await tx.query(
            "SELECT count(*)::int AS n FROM tts_jobs WHERE status IN ('QUEUED','GENERATING','READY','PLAYING')",
          )
        ).rows[0].n;
        const merged = (
          await tx.query(
            "SELECT 1 FROM tts_jobs j JOIN live_events e ON e.id=j.event_id WHERE e.provider=$1 AND e.live_id=$2 AND e.sender_key=$3 AND j.status IN ('QUEUED','GENERATING','READY') AND j.created_at>clock_timestamp()-interval '10 seconds' LIMIT 1",
            [provider, parsed.liveId, senderKey],
          )
        ).rowCount;
        if (!merged && config.live.ttsEnabled) {
          const last = (
            await tx.query('SELECT text FROM tts_jobs ORDER BY created_at DESC LIMIT 5')
          ).rows.map((r) => r.text);
          const choices = config.blessings.filter((b) => !last.includes(b.text));
          const available = choices.length ? choices : config.blessings;
          const blessing = available[Math.floor(Math.random() * available.length)];
          await tx.query(
            'INSERT INTO tts_jobs(id,event_id,text,status,voice,asset_id,mode) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              randomUUID(),
              id,
              blessing?.text ?? config.blessing.replaceAll('{name}', name).slice(0, 400),
              pending * config.ttsInterval < 60 ? 'QUEUED' : 'SKIPPED',
              config.live.voice,
              blessing?.audioId ?? null,
              blessing && !blessing.audioId ? 'text' : 'mock',
            ],
          );
        }
        await changed(tx, 'live.gift', {
          id,
          provider,
          name,
          giftId: parsed.giftId,
          quantity: delta,
        });
      }
      return { id, quantity: delta, duplicate: false };
    });
  }
  async recent() {
    return (
      await this.pool.query(
        'SELECT id,provider,display_name,gift_id,quantity,created_at FROM live_events WHERE quantity>0 ORDER BY created_at DESC LIMIT 10',
      )
    ).rows;
  }
  async generateNext() {
    const job = await transaction(this.pool, async (tx) => {
      await tx.query(
        "UPDATE tts_jobs SET status='QUEUED',lease_until=NULL WHERE status='GENERATING' AND lease_until<clock_timestamp()",
      );
      await tx.query(
        "UPDATE tts_jobs SET status='FAILED',error_code='PLAYBACK_TIMEOUT' WHERE status='PLAYING' AND lease_until<clock_timestamp()",
      );
      await tx.query(
        "UPDATE tts_jobs SET status='SKIPPED',error_code='WAIT_TIMEOUT' WHERE status IN ('QUEUED','GENERATING','READY') AND created_at<clock_timestamp()-interval '60 seconds'",
      );
      const candidate = (
        await tx.query(
          "SELECT * FROM tts_jobs WHERE status='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!candidate) return null;
      await tx.query(
        "UPDATE tts_jobs SET status='GENERATING',lease_until=clock_timestamp()+interval '45 seconds' WHERE id=$1",
        [candidate.id],
      );
      return candidate;
    });
    if (!job) return;
    try {
      const provider = job.mode === 'text' ? 'mock' : (process.env.TTS_PROVIDER ?? 'mock');
      let file: string | null = null;
      if (job.asset_id) {
        await new MediaService(this.pool).file(job.asset_id);
        await this.pool.query(
          "UPDATE tts_jobs SET status='READY',mode='static',lease_until=NULL WHERE id=$1 AND status='GENERATING'",
          [job.id],
        );
        return;
      }
      if (provider === 'openai') {
        if (!process.env.OPENAI_API_KEY) throw new Error('TTS_CREDENTIAL_MISSING');
        const voice = job.voice,
          model = 'gpt-4o-mini-tts';
        file =
          createHash('sha256')
            .update(JSON.stringify({ provider, voice, model, text: job.text }))
            .digest('hex') + '.mp3';
        const dir = process.env.TTS_CACHE_DIR ?? '.data/tts';
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let cached = false;
        try {
          await readFile(`${dir}/${file}`);
          cached = true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (!cached) {
          const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              voice,
              input: job.text,
              response_format: 'mp3',
              instructions: 'Speak Vietnamese gently and clearly. This is an AI-generated voice.',
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) throw new Error(`TTS_HTTP_${response.status}`);
          const audio = Buffer.from(await response.arrayBuffer());
          if (
            audio.length < 3 ||
            audio.length > 5_000_000 ||
            !(
              audio.subarray(0, 3).toString() === 'ID3' ||
              (audio[0] === 255 && (audio[1] & 224) === 224)
            )
          )
            throw new Error('TTS_INVALID_AUDIO');
          const temporary = `${dir}/${randomUUID()}.tmp`;
          await writeFile(temporary, audio, { flag: 'wx', mode: 0o600 });
          await rename(temporary, `${dir}/${file}`);
        }
      } else if (provider !== 'mock') throw new Error('TTS_PROVIDER_UNSUPPORTED');
      await this.pool.query(
        "UPDATE tts_jobs SET status='READY',mode=$2,audio_file=$3,lease_until=NULL WHERE id=$1 AND status='GENERATING'",
        [job.id, provider, file],
      );
    } catch (e) {
      const message = (e as Error).message;
      await this.pool.query(
        "UPDATE tts_jobs SET status='FAILED',error_code=$2,lease_until=NULL WHERE id=$1 AND status='GENERATING'",
        [job.id, /^TTS_[A-Z0-9_]+$/.test(message) ? message : 'TTS_UNAVAILABLE'],
      );
    }
  }
  async claim(tokenHash: string) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const { config } = await getSettings(tx);
      if (
        (
          await tx.query(
            "SELECT 1 FROM ceremony_runs WHERE status='RUNNING' AND ends_at>clock_timestamp()",
          )
        ).rowCount
      )
        return null;
      await tx.query(
        "UPDATE tts_jobs SET status='SKIPPED',error_code='WAIT_TIMEOUT' WHERE status='READY' AND created_at<clock_timestamp()-interval '60 seconds'",
      );
      if (
        (
          await tx.query(
            "SELECT 1 FROM tts_jobs WHERE status='PLAYING' OR played_at>clock_timestamp()-$1*interval '1 second'",
            [config.ttsInterval],
          )
        ).rowCount
      )
        return null;
      const job = (
        await tx.query(
          "SELECT id,text,mode FROM tts_jobs WHERE status='READY' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!job) return null;
      await tx.query(
        "UPDATE tts_jobs SET status='PLAYING',lease_until=clock_timestamp()+interval '90 seconds',played_at=clock_timestamp(),claimed_by=$2 WHERE id=$1",
        [job.id, tokenHash],
      );
      return job;
    });
  }
  async complete(id: string, tokenHash: string) {
    await this.pool.query(
      "UPDATE tts_jobs SET status='COMPLETED',claimed_by=NULL WHERE id=$1 AND status='PLAYING' AND claimed_by=$2",
      [id, tokenHash],
    );
  }
  async audio(jobId: string) {
    const job = (
      await this.pool.query(
        "SELECT audio_file,asset_id FROM tts_jobs WHERE id=$1 AND status IN ('READY','PLAYING','COMPLETED')",
        [jobId],
      )
    ).rows[0];
    if (!job?.audio_file && !job?.asset_id)
      throw new ApiError(404, 'NO_AUDIO', 'Chưa có âm thanh cho lời chúc này.');
    if (job.asset_id) return (await new MediaService(this.pool).file(job.asset_id)).bytes;
    return readFile(`${process.env.TTS_CACHE_DIR ?? '.data/tts'}/${job.audio_file}`);
  }
}
