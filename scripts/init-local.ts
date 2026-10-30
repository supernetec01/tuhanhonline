import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
await mkdir('.data', { recursive: true, mode: 0o700 });
try {
  await writeFile('.data/db-password', randomBytes(32).toString('hex'), {
    flag: 'wx',
    mode: 0o600,
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
const password = (await readFile('.data/db-password', 'utf8')).trim();
try {
  await writeFile(
    '.env',
    `DATABASE_URL=postgresql://temple:${encodeURIComponent(password)}@127.0.0.1:5432/temple\nREDIS_URL=redis://127.0.0.1:6379\nAPP_ORIGIN=http://localhost:3000\nPORT=3000\nMAIL_MODE=file\nTTS_PROVIDER=mock\n`,
    { flag: 'wx', mode: 0o600 },
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
console.log(
  'Local config initialized without overwriting existing files. Secret values are not logged.',
);
