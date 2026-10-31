import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { connectDb, migrate } from '../server/db.js';
import { digest } from '../server/auth.js';
import { attachRealtime } from '../server/realtime.js';
import { flushOutbox } from '../server/jobs.js';
import { MockLiveAdapter } from '../server/live.js';
const schema = 'bench_' + randomUUID().replaceAll('-', ''),
  root = connectDb();
await root.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    keyPrefix: schema + ':',
  }),
  rawRedis = redis.duplicate({ keyPrefix: '' });
const sockets: Socket[] = [],
  origin = 'http://localhost:3000';
let instance: Awaited<ReturnType<typeof createApp>> | undefined,
  realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined;
let server: ReturnType<Awaited<ReturnType<typeof createApp>>['app']['listen']> | undefined;
const savedChannel = process.env.ROOM_EVENT_CHANNEL;
process.env.ROOM_EVENT_CHANNEL = schema + ':events';
const start = performance.now(),
  cpu = process.cpuUsage();
const stats = (values: number[]) => {
  const v = values.toSorted((a, b) => a - b);
  return {
    count: v.length,
    p50Ms: v[Math.floor(v.length * 0.5)] ?? null,
    p95Ms: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] ?? null,
    maxMs: v.at(-1) ?? null,
  };
};
async function batch<T>(items: T[], task: (item: T) => Promise<unknown>, concurrency = 25) {
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) await task(items[index++]);
    }),
  );
}
try {
  await migrate(pool);
  instance = await createApp({ pool, redis, origin });
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  realtime = await attachRealtime(server, rawRedis, origin);
  const users = Array.from({ length: 536 }, (_, i) => ({
    id: randomUUID(),
    name: 'Đạo hữu ' + i,
    token: randomBytes(32).toString('hex'),
  }));
  await batch(users, async (u) => {
    await pool.query('INSERT INTO users(id,name,password_hash) VALUES($1,$2,$3)', [
      u.id,
      u.name,
      'benchmark-only-no-login',
    ]);
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
      [digest(u.token), u.id],
    );
  });
  await batch(users, (u) => instance!.room.join(u.id, randomUUID()));
  const state = await instance.room.snapshot();
  assert.equal(state.occupied, 36);
  assert.equal(state.waiting, 500);
  await batch(
    Array.from({ length: 1000 }, (_, i) => i),
    async () => {
      const s = io(base, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        extraHeaders: { Origin: origin },
      });
      sockets.push(s);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), 15000);
        s.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
        s.once('connect_error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
      });
    },
    50,
  );
  const requestTimes: number[] = [],
    chatStatus: Record<string, number> = {},
    gifts: number[] = [];
  await batch(
    Array.from({ length: 100 }, (_, i) => i),
    async () => {
      const t = performance.now(),
        r = await fetch(base + '/api/room');
      assert.equal(r.status, 200);
      await r.arrayBuffer();
      requestTimes.push(performance.now() - t);
    },
  );
  await batch(users.slice(0, 100), async (u) => {
    const r = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Temple-Request': '1',
        Cookie: 'temple_session=' + u.token,
      },
      body: JSON.stringify({ body: 'Bình an cùng ' + u.name }),
    });
    chatStatus[r.status] = (chatStatus[r.status] ?? 0) + 1;
    assert.ok([200, 429].includes(r.status));
  });
  await batch(
    Array.from({ length: 100 }, (_, i) => i),
    async (i) => {
      const t = performance.now();
      await new MockLiveAdapter(instance!.live).receive({
        liveId: 'bench',
        sourceEventId: String(i),
        senderId: 'sender-' + i,
        displayName: 'An Nhiên',
        giftId: 'rose',
        count: 1,
      });
      gifts.push(performance.now() - t);
    },
  );
  await flushOutbox(pool, rawRedis);
  const websocketTimes: number[] = [];
  const marker = randomUUID(),
    sent = Date.now();
  const delivered = Promise.all(
    sockets.map(
      (s) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Viewer event timeout')), 10000);
          const handler = (event: any) => {
            if (event.payload?.marker !== marker) return;
            websocketTimes.push(Date.now() - sent);
            clearTimeout(timeout);
            s.off('temple.event', handler);
            resolve();
          };
          s.on('temple.event', handler);
        }),
    ),
  );
  await rawRedis.publish(
    process.env.ROOM_EVENT_CHANNEL!,
    JSON.stringify({ kind: 'bench.marker', payload: { marker } }),
  );
  await delivered;
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM live_events')).rows[0].n, 100);
  const report = {
    createdAt: new Date().toISOString(),
    durationMs: performance.now() - start,
    cpuCount: cpus().length,
    processCpu: process.cpuUsage(cpu),
    rssBytes: process.memoryUsage().rss,
    active: state.occupied,
    waiting: state.waiting,
    viewerSockets: sockets.length,
    api: stats(requestTimes),
    chatAttempts: 100,
    chatStatuses: chatStatus,
    giftIngest: stats(gifts),
    websocketFanout: stats(websocketTimes),
    limitations:
      'Local isolated API process and local DB/Redis; no sustained soak, production TLS/CDN, worker throughput, mobile FPS, host peak CPU/RAM or remote network measurement. 429 chat responses are expected IP rate limiting.',
  };
  await mkdir('.data', { recursive: true });
  await writeFile('.data/benchmark-v8.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const s of sockets) s.disconnect();
  await realtime?.close();
  if (server?.listening) await new Promise<void>((r) => server!.close(() => r()));
  await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
  let cursor = '0';
  do {
    const [next, keys] = await rawRedis.scan(cursor, 'MATCH', schema + ':*', 'COUNT', 1000);
    cursor = next;
    if (keys.length) await rawRedis.del(...keys);
  } while (cursor !== '0');
  await redis.quit();
  await rawRedis.quit();
  if (savedChannel === undefined) delete process.env.ROOM_EVENT_CHANNEL;
  else process.env.ROOM_EVENT_CHANNEL = savedChannel;
}
