import { Queue, Worker } from 'bullmq';
import { ExperienceService } from './experience.js';
import { RoomService } from './room.js';
import { LiveService } from './live.js';
import { type Pool } from 'pg';
import { type Redis } from 'ioredis';
import { transaction } from './db.js';
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
export async function flushOutbox(pool: Pool, redis: Redis) {
  await transaction(pool, async (tx) => {
    const events = (
      await tx.query(
        'SELECT * FROM outbox WHERE delivered_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50',
      )
    ).rows;
    for (const event of events) {
      await redis.publish(
        process.env.ROOM_EVENT_CHANNEL ?? 'temple:events',
        JSON.stringify({
          eventId: event.id,
          sequence: event.room_version,
          kind: event.kind,
          payload: event.payload,
          serverTime: event.created_at,
        }),
      );
      await tx.query('UPDATE outbox SET delivered_at=clock_timestamp() WHERE id=$1', [event.id]);
    }
  });
}
export async function startJobs(pool: Pool, redis: Redis) {
  const connection = redisConnection(),
    room = new RoomService(pool),
    live = new LiveService(pool);
  const queue = new Queue(process.env.QUEUE_NAME ?? 'temple-ticks', { connection });
  await queue.upsertJobScheduler(
    'clock',
    { every: 1000 },
    { name: 'tick', opts: { removeOnComplete: 10, removeOnFail: 20 } },
  );
  const worker = new Worker(
    process.env.QUEUE_NAME ?? 'temple-ticks',
    async () => {
      await room.tick();
      await new ExperienceService(pool).tick();
      await flushOutbox(pool, redis);
      await redis.set('temple:worker:heartbeat', Date.now().toString(), 'EX', 45);
      await live.generateNext();
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', (e) => console.error(JSON.stringify({ event: 'worker.error', name: e.name })));
  worker.on('failed', (_job, e) =>
    console.error(JSON.stringify({ event: 'job.failed', name: e.name })),
  );
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
