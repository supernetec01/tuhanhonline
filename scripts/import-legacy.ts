import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { connectDb, migrate, transaction } from '../server/db.js';
if (!existsSync('.data/temple.sqlite')) throw new Error('No legacy DB found; nothing to import.');
const old = new DatabaseSync('.data/temple.sqlite', { readOnly: true });
const pool = connectDb();
try {
  await migrate(pool);
  await transaction(pool, async (tx) => {
    await tx.query('LOCK TABLE users IN EXCLUSIVE MODE');
    if ((await tx.query('SELECT 1 FROM users LIMIT 1')).rowCount)
      throw new Error(
        'Target users table must be empty. Import never merges or overwrites existing accounts.',
      );
    for (const row of old.prepare('SELECT * FROM users').all())
      await tx.query(
        'INSERT INTO users(id,email,password_hash,name,coins,equipped,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          row.id,
          row.email,
          row.password_hash,
          row.name,
          row.coins,
          row.equipped,
          new Date(row.created_at as number),
        ],
      );
    for (const row of old.prepare('SELECT * FROM inventory').all())
      await tx.query('INSERT INTO inventory VALUES($1,$2)', [row.user_id, row.outfit_id]);
    for (const row of old.prepare('SELECT * FROM purchases').all())
      await tx.query('INSERT INTO purchases VALUES($1,$2,$3,$4,$5,$6)', [
        row.id,
        row.user_id,
        row.outfit_id,
        row.amount,
        row.request_key,
        new Date(row.created_at as number),
      ]);
  });
  console.log(
    'Imported legacy accounts/inventory/purchases without changing source DB. Existing passwords retained; log in again and verify email.',
  );
} finally {
  old.close();
  await pool.end();
}
