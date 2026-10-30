import { connectDb, transaction } from '../server/db.js';
const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error('Usage: pnpm admin:promote email — promote an existing account.');
const pool = connectDb();
try {
  await transaction(pool, async (tx) => {
    const result = await tx.query(
      "UPDATE users SET role='ADMIN' WHERE (username=$1 OR email=$1) AND NOT banned RETURNING id",
      [email],
    );
    if (!result.rowCount) throw new Error('No account matched. Register first.');
    await tx.query(
      "INSERT INTO audit_logs(actor_id,action) VALUES($1,'admin.promoted.local-cli')",
      [result.rows[0].id],
    );
  });
  console.log('Account promoted. Log in and enroll MFA at /admin.');
} finally {
  await pool.end();
}
