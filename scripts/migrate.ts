import { connectDb, migrate } from '../server/db.js';
const pool = connectDb();
try {
  await migrate(pool);
  console.log('Migrations ready; human seat IDs 1–72 are available.');
} finally {
  await pool.end();
}
