import { connectDb, migrate } from '../server/db.js';
const pool = connectDb();
try {
  await migrate(pool);
  console.log('Migrations and 36 seats ready.');
} finally {
  await pool.end();
}
