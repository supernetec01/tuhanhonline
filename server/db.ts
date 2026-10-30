import { Pool, type PoolClient } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultSettings, settingsSchema, type Settings } from './config.js';
export type Tx = PoolClient;
export type Row = Record<string, any>;
export function connectDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required; run pnpm setup:local');
  return new Pool({ connectionString, max: 20, connectionTimeoutMillis: 5000 });
}
export async function transaction<T>(pool: Pool, task: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const result = await task(tx);
    await tx.query('COMMIT');
    return result;
  } catch (e) {
    await tx.query('ROLLBACK');
    throw e;
  } finally {
    tx.release();
  }
}
export async function migrate(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query('SELECT pg_advisory_lock(804251)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())',
    );
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile(`migrations/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = (
        await tx.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])
      ).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await tx.query('BEGIN');
      try {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          name,
          checksum,
        ]);
        await tx.query('COMMIT');
      } catch (e) {
        await tx.query('ROLLBACK');
        throw e;
      }
    }
    await tx.query(
      `INSERT INTO config_revisions(status,config) SELECT 'published',$1 WHERE NOT EXISTS(SELECT 1 FROM config_revisions WHERE status='published')`,
      [JSON.stringify(defaultSettings)],
    );
  } finally {
    await tx.query('SELECT pg_advisory_unlock(804251)');
    tx.release();
  }
}
export async function getSettings(tx: Tx | Pool): Promise<{ id: string; config: Settings }> {
  const row = (
    await tx.query("SELECT id::text,config FROM config_revisions WHERE status='published'")
  ).rows[0];
  return { ...row, config: settingsSchema.parse(row.config) };
}
export async function roomLock(tx: Tx) {
  await tx.query("SELECT id FROM rooms WHERE id='main' FOR UPDATE");
}
export async function changed(tx: Tx, kind = 'room.changed', payload: Row = {}) {
  const {
    rows: [{ version }],
  } = await tx.query("UPDATE rooms SET version=version+1 WHERE id='main' RETURNING version");
  await tx.query('INSERT INTO outbox(room_version,kind,payload) VALUES($1,$2,$3)', [
    version,
    kind,
    JSON.stringify(payload),
  ]);
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
