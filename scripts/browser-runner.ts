import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { connectDb } from '../server/db.js';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConnection } from '../server/jobs.js';
const schema = `browser_${randomUUID().replaceAll('-', '')}`,
  queueName = `ticks-${schema}`,
  prefix = `${schema}:`;
const root = connectDb(),
  temp = await mkdtemp(tmpdir() + '/temple-browser-');
const target = new URL(process.env.DATABASE_URL!);
target.searchParams.set('options', `-c search_path=${schema}`);
const port = Number(process.env.BROWSER_TEST_PORT ?? 3010),
  origin = `http://localhost:${port}`;
const childEnv = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: target.toString(),
  REDIS_KEY_PREFIX: prefix,
  QUEUE_NAME: queueName,
  ROOM_EVENT_CHANNEL: `events:${schema}`,
  MAIL_OUTBOX_DIR: temp,
  MEDIA_DIR: temp + '/assets',
  ADMIN_MFA_KEY_FILE: `${temp}/mfa-key`,
  RUN_WORKER: '1',
  MAIL_MODE: 'file',
  TTS_PROVIDER: 'mock',
  PORT: String(port),
  APP_ORIGIN: origin,
  TEST_ORIGIN: origin,
  VITE_CACHE_DIR: `${temp}/node_modules/.vite`,
};
let server: ChildProcess | undefined;
try {
  await root.query(`CREATE SCHEMA ${schema}`);
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverError = '';
  let booted = false;
  server.stdout?.on('data', (chunk) => {
    if (chunk.toString().includes('Tu Hành Online running')) booted = true;
  });
  server.stderr?.on('data', (chunk) => (serverError += chunk.toString()));
  const end = Date.now() + 30000;
  let ready = false;
  while (Date.now() < end) {
    try {
      const r = await fetch(origin + '/api/health/ready', { signal: AbortSignal.timeout(1000) });
      if (r.ok && booted && server.exitCode === null) {
        ready = true;
        break;
      }
    } catch {
      /* Startup is asynchronous. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready)
    throw new Error('Isolated browser server did not become ready. ' + serverError.slice(-500));
  const test = spawn(process.execPath, ['--import', 'tsx', 'tests/browser.ts'], {
    env: childEnv,
    stdio: 'inherit',
  });
  const code = await new Promise<number>((resolve) =>
    test.once('exit', (code) => resolve(code ?? 1)),
  );
  process.exitCode = code;
  if (code) console.error('Isolated server diagnostics:', serverError.slice(-1800));
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
  }
  const q = new Queue(queueName, { connection: redisConnection() });
  await q.removeJobScheduler('clock');
  await q.obliterate({ force: true });
  await q.close();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 1000);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
  await redis.quit();
  await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await root.end();
  await rm(temp, { recursive: true, force: true });
}
