import { Redis } from 'ioredis';
import { connectDb, migrate } from './db.js';
import { startJobs } from './jobs.js';
const pool = connectDb(),
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? '',
  });
await migrate(pool);
const jobs = await startJobs(pool, redis);
console.log('Temple worker started (persistent timeouts, FIFO, outbox and TTS).');
async function close() {
  await jobs.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
