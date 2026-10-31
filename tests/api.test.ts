import { after, before, beforeEach, test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { Queue } from 'bullmq';
import { redisConnection } from '../server/jobs.js';
import assert from 'node:assert/strict';
import { type Server, createServer } from 'node:http';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { TOTP, Secret } from 'otpauth';
import argon2 from 'argon2';
import { createApp } from '../server/app.js';
import { connectDb, migrate } from '../server/db.js';
import { defaultSettings } from '../server/config.js';
import { digest, hashOptions } from '../server/auth.js';
import { MockLiveAdapter } from '../server/live.js';
import { flushOutbox } from '../server/jobs.js';
import { attachRealtime } from '../server/realtime.js';
import { io } from 'socket.io-client';
const origin = 'http://localhost:3000',
  password = 'Mat-khau-kiem-thu-rieng-2026!';
const schema = `test_${randomUUID().replaceAll('-', '')}`,
  prefix = `${schema}:`;
let root: Pool,
  pool: Pool,
  redis: Redis,
  rawRedis: Redis,
  instance: Awaited<ReturnType<typeof createApp>>,
  server: Server,
  base: string,
  hash: string,
  temp: string;
const originalMailDir = process.env.MAIL_OUTBOX_DIR;
const originalMediaDir = process.env.MEDIA_DIR;
const originalShopAssetDir = process.env.SHOP_ASSET_DIR;
async function request(
  path: string,
  body?: unknown,
  cookie = '',
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', Origin: origin, 'X-Temple-Request': '1' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}
async function fixture(name = 'An Nhiên', verified = true, role = 'USER') {
  const id = randomUUID(),
    email = `${id}@example.com`,
    token = randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO users(id,email,password_hash,name,verified_at,role) VALUES($1,$2,$3,$4,$5,$6)',
    [id, email, hash, name, verified ? new Date() : null, role],
  );
  await pool.query("INSERT INTO inventory VALUES($1,'linen')", [id]);
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day')",
    [digest(token), id],
  );
  return { id, email, cookie: `temple_session=${token}`, token };
}
async function mail(email: string, purpose: string) {
  for (const name of await readdir(temp)) {
    if (!name.endsWith('.json')) continue;
    const record = JSON.parse(await readFile(`${temp}/${name}`, 'utf8'));
    if (record.to === email && record.purpose === purpose)
      return new URL(record.url).searchParams.get(purpose)!;
  }
  throw new Error('Expected development mail was not written');
}
async function join(u: Awaited<ReturnType<typeof fixture>>, key = randomUUID()) {
  const r = await request('/room/join', { requestKey: key }, u.cookie);
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  return r.data.entry;
}
before(async () => {
  root = connectDb();
  await root.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 20,
  });
  await migrate(pool);
  rawRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  redis = rawRedis.duplicate({ keyPrefix: prefix });
  temp = await mkdtemp(tmpdir() + '/temple-tests-');
  process.env.MAIL_OUTBOX_DIR = temp;
  process.env.MEDIA_DIR = temp + '/assets';
  process.env.SHOP_ASSET_DIR = temp + '/shop-assets';
  hash = await argon2.hash(password, hashOptions);
  instance = await createApp({ pool, redis, origin });
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await pool.query('DELETE FROM leaderboard_snapshots');
  await pool.query(
    'TRUNCATE effect_jobs,ceremony_runs,users,room_entries,ritual_actions,commands,inventory,purchases,sessions,user_tokens,config_revisions,audit_logs,outbox,live_events,gift_streaks,tts_jobs,broadcast_tokens RESTART IDENTITY CASCADE',
  );
  await pool.query("INSERT INTO config_revisions(status,config) VALUES('published',$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await pool.query("UPDATE rooms SET status='open',version=0");
  await pool.query('UPDATE ceremony_clock SET next_at=NULL,config_version=NULL');
  let cursor = '0';
  do {
    const [next, keys] = await rawRedis.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 1000);
    cursor = next;
    if (keys.length) await rawRedis.del(...keys);
  } while (cursor !== '0');
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await instance?.close();
  await redis?.quit();
  await rawRedis?.quit();
  await pool?.end();
  if (root) {
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  }
  if (temp) await rm(temp, { recursive: true, force: true });
  if (originalShopAssetDir === undefined) delete process.env.SHOP_ASSET_DIR;
  else process.env.SHOP_ASSET_DIR = originalShopAssetDir;
  if (originalMediaDir === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = originalMediaDir;
  if (originalMailDir === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = originalMailDir;
});
test('readiness checks worker, DB and Redis; defensive headers and request ID', async () => {
  let r = await request('/health/ready');
  assert.equal(r.response.status, 503);
  assert.equal(r.data.worker, false);
  await redis.set('temple:worker:heartbeat', '1', 'EX', 30);
  r = await request('/health/ready');
  assert.equal(r.response.status, 200);
  assert.equal(r.response.headers.get('cache-control'), 'no-store');
  assert.equal(r.response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.response.headers.get('x-request-id'));
  assert.equal(r.response.headers.get('x-powered-by'), null);
  assert.match(r.response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
});
test('origin/custom header, JSON size, name and password validation', async () => {
  assert.equal(
    (await request('/auth/register', {}, '', { Origin: 'https://evil.example' })).response.status,
    403,
  );
  assert.equal(
    (await request('/auth/register', {}, '', { 'X-Temple-Request': '' })).response.status,
    403,
  );
  assert.equal(
    (await request('/auth/register', { email: 'bad@example.com', name: '<script>', password }))
      .response.status,
    400,
  );
  assert.equal(
    (await request('/auth/register', { email: 'bad@example.com', name: 'An', password: 'short' }))
      .response.status,
    400,
  );
  const malformed = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'X-Temple-Request': '1', 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(
    (await request('/auth/login', { email: 'a@example.com', password: 'x'.repeat(13000) })).response
      .status,
    400,
  );
});
async function signupProof() {
  const c = (await request('/auth/challenge')).data;
  let solution = 0;
  while (!digest(`${c.nonce}:${solution}`).startsWith('000')) solution++;
  return { id: c.id, solution };
}
test('username signup has optional email, auto-login and immediate seat access without verification', async () => {
  const r = await request('/auth/register', {
    username: 'An_Nhien',
    dharmaName: 'An Nhiên',
    password,
    challenge: await signupProof(),
  });
  assert.equal(r.response.status, 201);
  assert.equal(r.data.user.username, 'an_nhien');
  assert.equal(r.data.user.dharmaName, 'An Nhiên');
  assert.equal(r.data.user.verified, false);
  assert.equal(r.data.user.hasRecoveryEmail, false);
  assert.equal(r.data.user.password_hash, undefined);
  assert.equal(r.data.user.coins, 300);
  const cookie = r.response.headers.get('set-cookie')!.split(';')[0];
  assert.match(r.response.headers.get('set-cookie')!, /HttpOnly.*SameSite=Strict/);
  const u = (await pool.query('SELECT * FROM users')).rows[0];
  assert.equal(u.email, null);
  assert.ok(await argon2.verify(u.password_hash, password));
  assert.notEqual(
    (await pool.query('SELECT token_hash FROM sessions')).rows[0].token_hash,
    cookie.split('=')[1],
  );
  assert.equal((await request('/me', undefined, cookie)).data.user.id, u.id);
  const join = await request('/room/join', { requestKey: randomUUID(), seatId: 5 }, cookie);
  assert.equal(join.response.status, 200);
  assert.equal(join.data.entry.seat_id, 5);
  const same = await request('/auth/register', {
    username: 'AN_NHIEN',
    dharmaName: 'Tên khác',
    password,
    challenge: await signupProof(),
  });
  assert.equal(same.response.status, 400);
  const login = await request('/auth/login', { username: 'AN_NHIEN', password });
  assert.equal(login.response.status, 200);
});
test('signup proof is required, single use and honeypot rejects bots; recovery email remains optional', async () => {
  const body = { username: 'test_abc', dharmaName: 'An Lạc', email: 'First@Example.COM', password };
  assert.equal((await request('/auth/register', body)).response.status, 400);
  const challenge = await signupProof();
  assert.equal(
    (await request('/auth/register', { ...body, website: 'https://bot.example', challenge }))
      .response.status,
    400,
  );
  const r = await request('/auth/register', { ...body, challenge });
  assert.equal(r.response.status, 201);
  assert.equal(r.data.user.hasRecoveryEmail, true);
  const cookie = r.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await pool.query('SELECT email FROM users')).rows[0].email, 'first@example.com');
  assert.equal(
    (await request('/room/join', { requestKey: randomUUID() }, cookie)).response.status,
    200,
  );
  assert.equal(
    (await request('/auth/register', { ...body, username: 'other_user', challenge })).data.code,
    'BOT_CHECK_FAILED',
  );
  await request('/auth/resend-verification', {}, cookie);
  const token = await mail('first@example.com', 'verify');
  assert.equal((await request('/auth/verify-email', { token })).response.status, 200);
  assert.equal((await request('/auth/verify-email', { token })).response.status, 400);
});
test('reset token expires, changes password once and revokes every old session', async () => {
  const u = await fixture();
  const generic = await request('/auth/forgot-password', { email: u.email });
  assert.equal(generic.response.status, 200);
  assert.deepEqual(
    generic.data,
    (await request('/auth/forgot-password', { email: 'missing@example.com' })).data,
  );
  const token = await mail(u.email, 'reset'),
    newPassword = 'Mat-khau-moi-kiem-thu-2026!';
  assert.equal(
    (await request('/auth/reset-password', { token, password: newPassword })).response.status,
    200,
  );
  assert.equal((await request('/me', undefined, u.cookie)).data.user, null);
  assert.equal((await request('/room/me', undefined, u.cookie)).data.entry, null);
  assert.equal(
    (await request('/auth/reset-password', { token, password: newPassword })).response.status,
    400,
  );
  assert.equal((await request('/auth/login', { email: u.email, password })).response.status, 401);
  assert.equal(
    (await request('/auth/login', { email: u.email, password: newPassword })).response.status,
    200,
  );
  const expired = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO user_tokens VALUES($1,$2,'reset',clock_timestamp()-interval '1 second')",
    [digest(expired), u.id],
  );
  assert.equal(
    (await request('/auth/reset-password', { token: expired, password })).response.status,
    400,
  );
});
test('logout revokes current cookie and frees the seat; expired/banned sessions fail', async () => {
  const u = await fixture();
  await join(u);
  assert.equal((await request('/auth/logout', {}, u.cookie)).response.status, 200);
  assert.equal((await request('/me', undefined, u.cookie)).data.user, null);
  assert.equal((await request('/room/me', undefined, u.cookie)).data.entry, null);
  assert.equal((await instance.room.snapshot()).occupied, 0);
  const v = await fixture();
  await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [v.id],
  );
  assert.equal((await request('/me', undefined, v.cookie)).data.user, null);
  const b = await fixture();
  await pool.query('UPDATE users SET banned=true WHERE id=$1', [b.id]);
  assert.equal(
    (await request('/room/join', { requestKey: randomUUID() }, b.cookie)).response.status,
    401,
  );
});
test('same error for wrong/unknown password, shared per-account and per-IP limits', async () => {
  const u = await fixture();
  const wrong = await request('/auth/login', { email: u.email, password: 'Wrong-Password-1234' }),
    unknown = await request('/auth/login', {
      email: 'unknown@example.com',
      password: 'Wrong-Password-1234',
    });
  assert.equal(wrong.response.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
  const username = (await pool.query('SELECT username FROM users WHERE id=$1', [u.id])).rows[0]
    .username;
  for (let i = 0; i < 7; i++)
    await request('/auth/login', {
      ...(i % 2 ? { username } : { email: u.email }),
      password: 'Wrong-Password-1234',
    });
  assert.equal((await request('/auth/login', { email: u.email, password })).response.status, 429);
});
test('100 simultaneous HTTP joins: exactly 36 seats, 64 FIFO waiters, no duplicates; repeated join idempotent', async () => {
  const users = await Promise.all(Array.from({ length: 100 }, () => fixture()));
  const keys = users.map(() => randomUUID());
  const results = await Promise.all(
    users.map((u, i) => request('/room/join', { requestKey: keys[i] }, u.cookie)),
  );
  assert.ok(results.every((r) => r.response.status === 200));
  const snapshot = await instance.room.snapshot();
  assert.equal(snapshot.occupied, 36);
  assert.equal(snapshot.waiting, 64);
  assert.equal(snapshot.available, 0);
  const active = (
    await pool.query("SELECT user_id,seat_id FROM room_entries WHERE status='ACTIVE'")
  ).rows;
  assert.equal(new Set(active.map((r) => r.user_id)).size, 36);
  assert.equal(new Set(active.map((r) => r.seat_id)).size, 36);
  const repeats = await Promise.all(
    users.map((u, i) => request('/room/join', { requestKey: keys[i] }, u.cookie)),
  );
  assert.ok(repeats.every((r, i) => r.data.entry.id === results[i].data.entry.id));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM room_entries')).rows[0].n, 100);
  const index = (
    await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname IN ('one_live_membership_per_user','one_occupied_seat')",
      [schema],
    )
  ).rows;
  assert.equal(index.length, 2);
});
test('FIFO invite reserves seat, blocks leapfrogging and expires to the next user; acceptance is atomic', async () => {
  const settings = { ...defaultSettings, capacity: 1 };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(settings),
  ]);
  const [a, b, c, d] = await Promise.all(Array.from({ length: 4 }, () => fixture()));
  assert.equal(
    (await instance.room.snapshot()).seats.filter((s: { enabled: boolean }) => s.enabled).length,
    1,
  );
  assert.equal(
    (await request('/room/join', { requestKey: randomUUID(), seatId: 6 }, a.cookie)).data.code,
    'SLOT_OCCUPIED',
  );
  await join(a);
  await join(b);
  await join(c);
  await instance.room.leave(a.id);
  assert.equal((await instance.room.myEntry(b.id)).status, 'INVITED');
  assert.equal((await join(d)).status, 'WAITING');
  assert.equal((await instance.room.snapshot()).occupied, 1);
  await pool.query(
    "UPDATE room_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [b.id],
  );
  const apiAccept = await request('/waitlist/accept', {}, b.cookie);
  assert.equal(apiAccept.data.code, 'INVITATION_EXPIRED');
  assert.equal((await instance.room.myEntry(c.id)).status, 'INVITED');
  const accepted = await request('/waitlist/accept', {}, c.cookie);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.entry.status, 'ACTIVE');
  await instance.room.leave(c.id);
  assert.equal((await instance.room.myEntry(d.id)).status, 'INVITED');
});
test('grace/session expiry, waiting cancellation, closed room and worker restart reconciliation', async () => {
  const u = await fixture();
  await join(u);
  const before = (await instance.room.myEntry(u.id)).disconnect_deadline;
  await request('/room/heartbeat', {}, u.cookie);
  assert.ok((await instance.room.myEntry(u.id)).disconnect_deadline >= before);
  await pool.query(
    "UPDATE room_entries SET disconnect_deadline=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [u.id],
  );
  // New service object reconstructs state from DB, without in-memory queue state.
  const { RoomService } = await import('../server/room.js');
  await new RoomService(pool).tick();
  assert.equal(await instance.room.myEntry(u.id), null);
  await pool.query("UPDATE rooms SET status='closed'");
  assert.equal(
    (await request('/room/join', { requestKey: randomUUID() }, u.cookie)).data.code,
    'ROOM_CLOSED',
  );
  await pool.query("UPDATE rooms SET status='open'");
  const entry = await join(u);
  await pool.query(
    "UPDATE room_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [entry.id],
  );
  await instance.room.tick();
  assert.equal(await instance.room.myEntry(u.id), null);
});
test('server authorizes actions, enforces cooldown and serializes incense FIFO after restart/cancellation', async () => {
  const [a, b, c] = await Promise.all(Array.from({ length: 3 }, () => fixture()));
  assert.equal(
    (await request('/actions/bow', { requestKey: randomUUID() }, a.cookie)).data.code,
    'ACTIVE_SEAT_REQUIRED',
  );
  await join(a);
  await join(b);
  await join(c);
  const key = randomUUID(),
    bow = await request('/actions/bow', { requestKey: key }, a.cookie);
  assert.equal(bow.response.status, 200);
  assert.equal(
    (await request('/actions/bow', { requestKey: key }, a.cookie)).data.action.id,
    bow.data.action.id,
  );
  await pool.query("UPDATE ritual_actions SET ends_at=clock_timestamp()-interval '1 second'");
  await instance.room.tick();
  assert.equal(
    (await request('/actions/bow', { requestKey: randomUUID() }, a.cookie)).data.code,
    'ACTION_COOLDOWN',
  );
  const first = await request('/actions/incense', { requestKey: randomUUID() }, a.cookie),
    second = await request('/actions/incense', { requestKey: randomUUID() }, b.cookie),
    third = await request('/actions/incense', { requestKey: randomUUID() }, c.cookie);
  assert.equal(first.data.action.status, 'RUNNING');
  assert.equal(second.data.action.status, 'QUEUED');
  assert.equal(third.data.action.status, 'QUEUED');
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ritual_actions WHERE type='incense' AND status='RUNNING'",
      )
    ).rows[0].n,
    1,
  );
  await instance.room.leave(a.id);
  assert.equal((await instance.room.myAction(b.id))!.status, 'RUNNING');
  await instance.room.leave(b.id);
  assert.equal((await instance.room.myAction(c.id))!.status, 'RUNNING');
});
test('wardrobe rejects client price/ownership hacks, atomic parallel buying and layered accessory persistence', async () => {
  const u = await fixture();
  assert.equal(
    (await request('/wardrobe/equip', { outfitId: 'cloud' }, u.cookie)).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        '/wardrobe/buy',
        { outfitId: 'saffron', requestKey: randomUUID(), price: 0 },
        u.cookie,
      )
    ).response.status,
    400,
  );
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      request(
        '/wardrobe/buy',
        { outfitId: i % 2 ? 'saffron' : 'lotus', requestKey: randomUUID() },
        u.cookie,
      ),
    ),
  );
  assert.ok(results.every((r) => [200, 409].includes(r.response.status)));
  const me = (await request('/me', undefined, u.cookie)).data.user;
  assert.ok([50, 120].includes(me.coins));
  assert.equal(me.inventory.length, 2);
  const outfitId = me.inventory.find((id: string) => id !== 'linen');
  const equip = await request('/wardrobe/equip', { outfitId, accessory: 'beads' }, u.cookie);
  assert.equal(equip.data.user.accessory, 'beads');
  assert.equal((await request('/me', undefined, u.cookie)).data.user.equipped, outfitId);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n, 1);
  assert.equal(
    (await request('/wardrobe/equip', { outfitId, accessory: '<script>' }, u.cookie)).response
      .status,
    400,
  );
});
test('admin password session, legacy MFA and live role/session revocation', async () => {
  const admin = await fixture('Chủ chùa', true, 'ADMIN');
  assert.equal((await request('/admin/config')).response.status, 401);
  assert.equal(
    (await request('/auth/login', { email: admin.email, password: 'Wrong-Password-1234' })).response
      .status,
    401,
  );
  const login = await request('/auth/login', { email: admin.email, password });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/admin/config', undefined, cookie)).response.status, 200);
  assert.deepEqual((await request('/admin/mfa/status', undefined, cookie)).data, {
    enrolled: false,
    required: false,
    active: true,
  });
  const enrollment = await request('/admin/mfa/enroll', {}, cookie);
  assert.equal(enrollment.response.status, 200);
  await pool.query('UPDATE users SET mfa_last_counter=1 WHERE id=$1', [admin.id]);
  await pool.query(
    "UPDATE sessions SET admin_until=clock_timestamp()-interval '1 hour' WHERE user_id=$1",
    [admin.id],
  );
  assert.deepEqual((await request('/admin/mfa/status', undefined, cookie)).data, {
    enrolled: true,
    required: false,
    active: true,
  });
  assert.equal((await request('/admin/dashboard', undefined, cookie)).response.status, 200);
  assert.equal((await request('/admin/chat', undefined, cookie)).response.status, 200);
  await pool.query("UPDATE users SET role='USER' WHERE id=$1", [admin.id]);
  for (const path of ['/admin/config', '/admin/dashboard', '/admin/chat', '/admin/mfa/status'])
    assert.equal((await request(path, undefined, cookie)).response.status, 403, path);
  assert.equal(
    (await request('/admin/config/draft', { config: defaultSettings, expectedId: null }, cookie))
      .response.status,
    403,
  );
  await pool.query("UPDATE users SET role='ADMIN',banned=true WHERE id=$1", [admin.id]);
  assert.equal((await request('/admin/config', undefined, cookie)).response.status, 401);
  await pool.query('UPDATE users SET banned=false WHERE id=$1', [admin.id]);
  assert.equal((await request('/auth/logout', {}, cookie)).response.status, 200);
  assert.equal((await request('/admin/config', undefined, cookie)).response.status, 401);
});
test('delegated roles still require MFA, reject replay and cannot publish admin configuration', async () => {
  const operator = await fixture('Điều phối LIVE', true, 'OPERATOR'),
    moderator = await fixture('Kiểm duyệt', true, 'MODERATOR');
  assert.equal(
    (await request('/admin/dashboard', undefined, operator.cookie)).data.code,
    'MFA_REQUIRED',
  );
  assert.equal(
    (await request('/admin/chat', undefined, moderator.cookie)).data.code,
    'MFA_REQUIRED',
  );
  assert.deepEqual((await request('/admin/mfa/status', undefined, operator.cookie)).data, {
    enrolled: false,
    required: true,
    active: false,
  });
  const enrollment = await request('/admin/mfa/enroll', {}, operator.cookie);
  assert.ok(enrollment.data.uri.startsWith('otpauth://'));
  const code = new TOTP({ secret: Secret.fromBase32(enrollment.data.secret) }).generate();
  assert.equal(
    (await request('/admin/mfa/verify', { code }, operator.cookie)).response.status,
    200,
  );
  assert.equal(
    (await request('/admin/mfa/verify', { code }, operator.cookie)).data.code,
    'MFA_REPLAY',
  );
  assert.equal(
    (await request('/admin/dashboard', undefined, operator.cookie)).response.status,
    200,
  );
  assert.equal((await request('/admin/config', undefined, operator.cookie)).response.status, 403);
  await pool.query(
    "UPDATE sessions SET admin_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [operator.id],
  );
  assert.equal(
    (await request('/admin/dashboard', undefined, operator.cookie)).data.code,
    'MFA_REQUIRED',
  );
});
test('admin RBAC without MFA, draft/publish/rollback and occupied-seat guard', async () => {
  const regular = await fixture(),
    admin = await fixture('Chủ chùa', true, 'ADMIN');
  assert.equal((await request('/admin/config', undefined, regular.cookie)).response.status, 403);
  assert.equal((await request('/admin/config', undefined, admin.cookie)).response.status, 200);
  const previous = await instance.cms.state();
  const config = { ...defaultSettings, roomName: 'Chánh điện Tâm An' };
  const draft = await request('/admin/config/draft', { config, expectedId: null }, admin.cookie);
  assert.equal(draft.response.status, 200);
  assert.equal((await instance.room.snapshot()).config.roomName, defaultSettings.roomName);
  assert.equal(
    (await request('/admin/config/draft', { config, expectedId: null }, admin.cookie)).data.code,
    'DRAFT_CHANGED',
  );
  assert.equal(
    (await request('/admin/config/publish', { id: draft.data.id }, admin.cookie)).response.status,
    200,
  );
  assert.equal((await instance.room.snapshot()).config.roomName, 'Chánh điện Tâm An');
  assert.equal(
    (await request('/admin/config/rollback', { id: previous.published.id }, admin.cookie)).response
      .status,
    200,
  );
  assert.equal((await instance.room.snapshot()).config.roomName, defaultSettings.roomName);
  await join(regular);
  const contentDraft = await request(
    '/admin/config/draft',
    { config, expectedId: null },
    admin.cookie,
  );
  assert.equal(
    (await request('/admin/config/publish', { id: contentDraft.data.id }, admin.cookie)).response
      .status,
    200,
  );
  const layout = await request(
    '/admin/config/draft',
    { config: { ...defaultSettings, capacity: 1 }, expectedId: null },
    admin.cookie,
  );
  assert.equal(
    (await request('/admin/config/publish', { id: layout.data.id }, admin.cookie)).data.code,
    'ROOM_NOT_EMPTY',
  );
  assert.ok((await request('/admin/audit', undefined, admin.cookie)).data.logs.length >= 4);
});
test('mock gifts deduplicate and cumulative 1→5 totals 5, coalesces TTS and cannot grant seats', async () => {
  const adapter = new MockLiveAdapter(instance.live);
  for (let count = 1; count <= 5; count++)
    await adapter.receive({
      liveId: 'live-test',
      sourceEventId: `e-${count}`,
      senderId: 'sender',
      displayName: 'Tiểu Vũ',
      giftId: 'rose',
      count,
      streakId: 's1',
    });
  const repeat = (await adapter.receive({
    liveId: 'live-test',
    sourceEventId: 'e-5',
    senderId: 'sender',
    displayName: 'Tiểu Vũ',
    giftId: 'rose',
    count: 5,
    streakId: 's1',
  })) as any;
  assert.equal(repeat.duplicate, true);
  assert.equal((await pool.query('SELECT sum(quantity)::int AS n FROM live_events')).rows[0].n, 5);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM tts_jobs')).rows[0].n, 1);
  assert.equal((await instance.room.snapshot()).occupied, 0);
  assert.equal((await request('/admin/live/mock', { liveId: 'x' })).response.status, 401);
  await adapter.receive({
    liveId: 'live-test',
    sourceEventId: 'bad-name',
    senderId: 'other',
    displayName: '<script>alert(1)</script>',
    giftId: 'rose',
    count: 1,
  });
  assert.equal((await instance.live.recent())[0].display_name, 'Một người hữu duyên');
});
test('signed provider webhook rejects tampering, stale signatures and spoofing', async () => {
  const secret = randomBytes(32),
    file = `${temp}/webhook-secret`;
  await writeFile(file, secret, { mode: 0o600 });
  const previous = process.env.LIVE_WEBHOOK_SECRET_FILE;
  process.env.LIVE_WEBHOOK_SECRET_FILE = file;
  try {
    const body = {
      liveId: 'partner-live',
      sourceEventId: 'unique-1',
      senderId: 'sender',
      displayName: 'An Nhiên',
      giftId: 'rose',
      count: 1,
    };
    const timestamp = Date.now().toString(),
      signature = createHmac('sha256', secret)
        .update(timestamp + '.' + JSON.stringify(body))
        .digest('hex');
    assert.equal(
      (
        await request('/integrations/live/events', body, '', {
          'X-Live-Timestamp': timestamp,
          'X-Live-Signature': signature,
        })
      ).response.status,
      200,
    );
    assert.equal(
      (
        await request('/integrations/live/events', { ...body, count: 9 }, '', {
          'X-Live-Timestamp': timestamp,
          'X-Live-Signature': signature,
        })
      ).response.status,
      401,
    );
    assert.equal(
      (
        await request('/integrations/live/events', body, '', {
          'X-Live-Timestamp': String(Date.now() - 600000),
          'X-Live-Signature': signature,
        })
      ).response.status,
      401,
    );
    assert.equal((await request('/integrations/live/events', body)).response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.LIVE_WEBHOOK_SECRET_FILE;
    else process.env.LIVE_WEBHOOK_SECRET_FILE = previous;
  }
});
test('TTS mock/text fallback, scoped broadcast auth, one consumer, completion and no replay', async () => {
  await new MockLiveAdapter(instance.live).receive({
    liveId: 'x',
    sourceEventId: '1',
    senderId: '1',
    displayName: 'Tiểu Vũ',
    giftId: 'rose',
    count: 1,
  });
  await instance.live.generateNext();
  const token = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO broadcast_tokens(token_hash,expires_at) VALUES($1,clock_timestamp()+interval '10 minutes')",
    [digest(token)],
  );
  assert.equal((await request('/broadcast/claim', {})).response.status, 401);
  const headers = { 'X-Broadcast-Token': token };
  const r = await request('/broadcast/claim', {}, '', headers);
  assert.equal(r.data.job.mode, 'mock');
  assert.ok(r.data.job.text.includes('Tiểu Vũ'));
  assert.equal((await request('/broadcast/claim', {}, '', headers)).data.job, null);
  await request('/broadcast/complete', { id: r.data.job.id }, '', {
    'X-Broadcast-Token': randomBytes(32).toString('hex'),
  });
  assert.equal((await pool.query('SELECT status FROM tts_jobs')).rows[0].status, 'PLAYING');
  await request('/broadcast/complete', { id: r.data.job.id }, '', headers);
  assert.equal((await pool.query('SELECT status FROM tts_jobs')).rows[0].status, 'COMPLETED');
  assert.equal((await request('/broadcast/claim', {}, '', headers)).data.job, null);
});
test('TTS failure is isolated, expired broadcast token fails, and operator skip reaches the broadcast state', async () => {
  const previous = process.env.TTS_PROVIDER;
  try {
    await new MockLiveAdapter(instance.live).receive({
      liveId: 'failed',
      sourceEventId: '1',
      senderId: '1',
      displayName: 'An Nhiên',
      giftId: 'rose',
      count: 1,
    });
    process.env.TTS_PROVIDER = 'unsupported';
    await instance.live.generateNext();
    const failed = (await pool.query('SELECT status,error_code FROM tts_jobs')).rows[0];
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.error_code, 'TTS_PROVIDER_UNSUPPORTED');
    process.env.TTS_PROVIDER = 'mock';
    const player = await fixture();
    assert.equal((await join(player)).status, 'ACTIVE');
    await new MockLiveAdapter(instance.live).receive({
      liveId: 'ok',
      sourceEventId: '2',
      senderId: '2',
      displayName: 'Tiểu Vũ',
      giftId: 'rose',
      count: 1,
    });
    await instance.live.generateNext();
    const token = randomBytes(32).toString('hex');
    await pool.query(
      "INSERT INTO broadcast_tokens(token_hash,expires_at) VALUES($1,clock_timestamp()-interval '1 second')",
      [digest(token)],
    );
    const headers = { 'X-Broadcast-Token': token };
    assert.equal((await request('/broadcast/claim', {}, '', headers)).response.status, 401);
    await pool.query(
      "UPDATE broadcast_tokens SET expires_at=clock_timestamp()+interval '10 minutes'",
    );
    const claim = await request('/broadcast/claim', {}, '', headers);
    assert.ok(claim.data.job.id);
    const operator = await fixture('Điều hành', true, 'OPERATOR');
    await pool.query(
      "UPDATE sessions SET admin_until=clock_timestamp()+interval '5 minutes' WHERE user_id=$1",
      [operator.id],
    );
    assert.equal((await request('/admin/config', undefined, operator.cookie)).response.status, 403);
    assert.equal(
      (await request('/admin/tts/skip', { id: claim.data.job.id }, operator.cookie)).response
        .status,
      200,
    );
    assert.equal(
      (await request('/broadcast/state/' + claim.data.job.id, undefined, '', headers)).data.status,
      'SKIPPED',
    );
    assert.equal((await instance.room.snapshot()).occupied, 1);
  } finally {
    if (previous === undefined) delete process.env.TTS_PROVIDER;
    else process.env.TTS_PROVIDER = previous;
  }
});
test('production requires HTTPS and optional SMTP and uses secure host-only cookies and strict script CSP', async () => {
  const previous = process.env.MAIL_MODE;
  let secureServer: Server | undefined;
  try {
    await assert.rejects(createApp({ pool, redis, production: true, origin }), /HTTPS/);
    process.env.MAIL_MODE = 'smtp';
    const secure = await createApp({
      pool,
      redis,
      production: true,
      origin: 'https://temple.example',
    });
    const u = await fixture();
    secureServer = secure.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => secureServer!.once('listening', resolve));
    const response = await fetch(
      `http://127.0.0.1:${(secureServer.address() as { port: number }).port}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://temple.example',
          'X-Temple-Request': '1',
        },
        body: JSON.stringify({ email: u.email, password }),
      },
    );
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /^__Host-temple_session=/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.ok(!cookie.includes('Domain='));
    assert.ok(response.headers.get('strict-transport-security'));
    assert.match(response.headers.get('content-security-policy')!, /script-src 'self';/);
  } finally {
    if (secureServer) await new Promise<void>((resolve) => secureServer!.close(() => resolve()));
    if (previous === undefined) delete process.env.MAIL_MODE;
    else process.env.MAIL_MODE = previous;
  }
});
test('visual effects queue deduplicates, plays FIFO, expires and does not allocate seats', async () => {
  const { ExperienceService } = await import('../server/experience.js');
  const service = new ExperienceService(pool);
  const event = {
    liveId: 'fx',
    sourceEventId: '1',
    senderId: '1',
    displayName: 'Tiểu Vũ',
    giftId: 'rose',
    count: 1,
  };
  const adapter = new MockLiveAdapter(instance.live);
  await adapter.receive(event);
  await adapter.receive(event);
  await adapter.receive({ ...event, sourceEventId: '2', giftId: 'lantern' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM effect_jobs')).rows[0].n, 2);
  await service.tick();
  assert.equal((await instance.room.snapshot()).effect.kind, 'lotus');
  await pool.query(
    "UPDATE effect_jobs SET ends_at=clock_timestamp()-interval '1 second' WHERE status='RUNNING'",
  );
  await service.tick();
  assert.equal((await instance.room.snapshot()).effect.kind, 'lantern');
  assert.equal((await instance.room.snapshot()).occupied, 0);
  await adapter.receive({ ...event, sourceEventId: '3', giftId: 'incense' });
  await pool.query(
    "UPDATE effect_jobs SET created_at=clock_timestamp()-interval '61 seconds' WHERE status='QUEUED'",
  );
  await service.tick();
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM effect_jobs WHERE status='SKIPPED'")).rows[0]
      .n,
    1,
  );
});
test('ceremony scheduler persists due time, serializes starts and survives replacement; endpoint protected', async () => {
  const { ExperienceService } = await import('../server/experience.js');
  const service = new ExperienceService(pool);
  const config = { ...defaultSettings, live: { ...defaultSettings.live, ceremonyEnabled: true } };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  await service.tick();
  assert.ok((await instance.room.snapshot()).nextCeremony);
  await pool.query("UPDATE ceremony_clock SET next_at=clock_timestamp()-interval '1 second'");
  await Promise.all([service.tick(), new ExperienceService(pool).tick()]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ceremony_runs')).rows[0].n, 1);
  const snapshot = await instance.room.snapshot();
  assert.ok(snapshot.ceremony);
  assert.equal(
    new Date(snapshot.ceremony.ends_at).getTime() -
      new Date(snapshot.ceremony.starts_at).getTime() <
      60100,
    true,
  );
  assert.equal((await request('/admin/ceremonies/test', {})).response.status, 401);
  await pool.query("UPDATE ceremony_runs SET ends_at=clock_timestamp()-interval '1 second'");
  await service.tick();
  assert.equal((await instance.room.snapshot()).ceremony, null);
  assert.equal((await service.analytics()).tiktok_viewers, null);
});
test('old TTS backlog falls back to text; audio ducking restores latest user volume', async () => {
  await new MockLiveAdapter(instance.live).receive({
    liveId: 'old',
    sourceEventId: '1',
    senderId: '1',
    displayName: 'Tiểu Vũ',
    giftId: 'rose',
    count: 1,
  });
  await pool.query("UPDATE tts_jobs SET created_at=clock_timestamp()-interval '61 seconds'");
  await instance.live.generateNext();
  assert.equal((await pool.query('SELECT status FROM tts_jobs')).rows[0].status, 'SKIPPED');
  const { BroadcastAudioManager } = await import('../src/AudioManager.js');
  const channel = { volume: 1 };
  const mixer = new BroadcastAudioManager(channel, 0.2);
  mixer.setVolume(0.8);
  mixer.setSpeaking(true);
  assert.ok(Math.abs(channel.volume - 0.16) < 1e-9);
  mixer.setVolume(0.6);
  mixer.setSpeaking(false);
  assert.equal(channel.volume, 0.6);
});
test('BullMQ worker resumes deadlines after actual process restart without losing persisted state', async () => {
  const queueName = `worker-${schema}`,
    url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const u = await fixture();
  const queue = new Queue(queueName, { connection: redisConnection() });
  async function round() {
    await join(u);
    await pool.query(
      "UPDATE room_entries SET disconnect_deadline=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND status='ACTIVE'",
      [u.id],
    );
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/worker.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        REDIS_KEY_PREFIX: prefix,
        QUEUE_NAME: queueName,
        ROOM_EVENT_CHANNEL: `events-${schema}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });
    try {
      const end = Date.now() + 10000;
      while (Date.now() < end && (await instance.room.myEntry(u.id))) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(await instance.room.myEntry(u.id), null, error);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
    }
  }
  try {
    await round();
    await round();
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM room_entries WHERE status='EXPIRED'"))
        .rows[0].n,
      2,
    );
  } finally {
    await queue.removeJobScheduler('clock');
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
test('V8 minute rewards stop at eligibility deadline, cap per day and do not repeat across reconciliation', async () => {
  const u = await fixture(),
    w = await fixture();
  const e = await join(u);
  await pool.query(
    "UPDATE config_revisions SET config=jsonb_set(config,'{dailyCoinCap}','2') WHERE status='published'",
  );
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '185 seconds' WHERE id=$1",
    [e.id],
  );
  await instance.room.tick();
  await instance.room.tick();
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 302);
  const journal = (await request('/journal', undefined, u.cookie)).data;
  assert.equal(journal.cultivated_minutes, 3);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM coin_ledger WHERE user_id=$1', [u.id]))
      .rows[0].n,
    2,
  );
  assert.equal((await request('/me', undefined, w.cookie)).data.user.coins, 300);
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '3 minutes',disconnect_deadline=clock_timestamp()-interval '2 minutes' WHERE id=$1",
    [e.id],
  );
  await instance.room.tick();
  assert.equal(await instance.room.myEntry(u.id), null);
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 302);
});
test('V8 merit is awarded once on completion, wallets separate and incense cooldown starts with actual turn', async () => {
  const u = await fixture(),
    v = await fixture();
  await join(u);
  await join(v);
  const key = randomUUID();
  let r = await request('/actions/bow', { requestKey: key }, u.cookie);
  assert.equal(r.data.action.cooldown_ms, 60000);
  assert.equal((await request('/me', undefined, u.cookie)).data.user.merit, 0);
  await pool.query(
    "UPDATE ritual_actions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [r.data.action.id],
  );
  await instance.room.tick();
  await instance.room.tick();
  assert.equal((await request('/me', undefined, u.cookie)).data.user.merit, 1);
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 300);
  await request('/actions/bow', { requestKey: key }, u.cookie);
  assert.equal((await request('/me', undefined, u.cookie)).data.user.merit, 1);
  r = await request('/actions/incense', { requestKey: randomUUID() }, u.cookie);
  assert.equal(r.data.action.duration_ms, 5000);
  assert.equal(r.data.action.cooldown_ms, 300000);
  const queued = await request('/actions/incense', { requestKey: randomUUID() }, v.cookie);
  assert.equal(queued.data.action.status, 'QUEUED');
  await pool.query(
    "UPDATE ritual_actions SET requested_at=clock_timestamp()-interval '20 minutes' WHERE id=$1",
    [queued.data.action.id],
  );
  await pool.query(
    "UPDATE ritual_actions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [r.data.action.id],
  );
  await instance.room.tick();
  await pool.query(
    "UPDATE ritual_actions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [queued.data.action.id],
  );
  await instance.room.tick();
  assert.equal((await request('/me', undefined, v.cookie)).data.user.merit, 10);
  assert.equal(
    (await request('/actions/incense', { requestKey: randomUUID() }, v.cookie)).response.status,
    429,
  );
});
test('V8 dots are sequential, atomic, bounded at 8 and idempotent', async () => {
  const u = await fixture();
  await pool.query('UPDATE users SET coins=10000 WHERE id=$1', [u.id]);
  assert.equal(
    (await request('/wardrobe/dots', { pair: 2, requestKey: randomUUID() }, u.cookie)).response
      .status,
    409,
  );
  const key = randomUUID();
  const results = await Promise.all([
    request('/wardrobe/dots', { pair: 1, requestKey: key }, u.cookie),
    request('/wardrobe/dots', { pair: 1, requestKey: key }, u.cookie),
  ]);
  assert.ok(results.every((r) => r.response.status === 200));
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 9800);
  for (const pair of [2, 3, 4])
    assert.equal(
      (await request('/wardrobe/dots', { pair, requestKey: randomUUID() }, u.cookie)).response
        .status,
      200,
    );
  const me = (await request('/me', undefined, u.cookie)).data.user;
  assert.equal(me.dots, 8);
  assert.equal(me.coins, 6300);
  assert.equal(me.merit, 0);
  assert.equal(
    (await request('/wardrobe/dots', { pair: 5, requestKey: randomUUID() }, u.cookie)).response
      .status,
    400,
  );
});
test('V8 moderated chat, reports and MFA moderator mute preserve seats and balances', async () => {
  const u = await fixture(),
    mod = await fixture('Điều phối', true, 'MODERATOR'),
    operator = await fixture('LIVE', true, 'OPERATOR');
  await join(u);
  await pool.query(
    "UPDATE sessions SET admin_until=clock_timestamp()+interval '5 minutes' WHERE user_id IN ($1,$2)",
    [mod.id, operator.id],
  );
  assert.equal((await request('/chat', { body: 'Xin chào bình an' }, '')).response.status, 401);
  const safe = await request('/chat', { body: 'Xin chào bình an' }, u.cookie);
  assert.equal(safe.data.status, 'APPROVED');
  assert.equal((await request('/chat', { body: 'Tin quá nhanh' }, u.cookie)).response.status, 429);
  await pool.query(
    "UPDATE chat_messages SET created_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",
    [u.id],
  );
  assert.equal(
    (await request('/chat', { body: 'Xin chào bình an' }, u.cookie)).data.status,
    'PENDING_REVIEW',
  );
  await pool.query(
    "UPDATE chat_messages SET created_at=clock_timestamp()-interval '6 seconds' WHERE user_id=$1",
    [u.id],
  );
  assert.equal((await request('/chat', { body: 'ĐỊT MẸ' }, u.cookie)).data.status, 'REJECTED');
  assert.equal((await request('/chat')).data.messages.length, 1);
  await request('/chat/report', { id: safe.data.id, reason: 'Cần kiểm tra nội dung' }, mod.cookie);
  assert.equal((await request('/admin/chat', undefined, operator.cookie)).response.status, 403);
  assert.equal((await request('/admin/chat', undefined, mod.cookie)).response.status, 200);
  assert.equal(
    (
      await request(
        '/admin/chat/mute',
        { userId: u.id, minutes: 10, reason: 'Cảnh báo spam tin nhắn' },
        mod.cookie,
      )
    ).response.status,
    200,
  );
  assert.equal((await request('/chat', { body: 'Một tin khác' }, u.cookie)).data.code, 'MUTE_CHAT');
  assert.equal((await instance.room.myEntry(u.id))?.status, 'ACTIVE');
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 300);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='chat.mute'")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await request('/chat/appeal', { body: 'Xin xem lại tin nhắn của tôi' }, u.cookie)).response
      .status,
    200,
  );
  const appeal = (await request('/admin/chat/appeals', undefined, mod.cookie)).data.appeals[0];
  assert.equal(
    (
      await request(
        '/admin/chat/appeals',
        { id: appeal.id, resolution: 'Đã kiểm tra và gỡ khóa chat.', unmute: true },
        mod.cookie,
      )
    ).response.status,
    200,
  );
  assert.equal((await request('/chat/me', undefined, u.cookie)).data.sanctions.length, 0);
  assert.equal((await request('/chat/me', undefined, u.cookie)).data.appeals[0].status, 'RESOLVED');
  assert.equal(
    (
      await request(
        '/admin/chat/moderate',
        { id: safe.data.id, status: 'DELETED', reason: 'Xóa theo báo cáo thử nghiệm' },
        mod.cookie,
      )
    ).response.status,
    200,
  );
  assert.equal((await request('/chat')).data.messages.length, 0);
});
test('V8 prayer templates reject arbitrary text and rankings remain frozen for 300 seconds', async () => {
  const u = await fixture();
  assert.equal((await request('/prayers', { template: 'Tự viết' }, u.cookie)).response.status, 400);
  assert.equal(
    (await request('/prayers', { template: 'Cầu bình an' }, u.cookie)).response.status,
    200,
  );
  await pool.query('DELETE FROM leaderboard_snapshots');
  await instance.room.tick();
  await pool.query('UPDATE users SET merit=99 WHERE id=$1', [u.id]);
  await instance.room.tick();
  assert.equal((await request('/leaderboards', undefined, u.cookie)).data.mine.merit, 0);
  await pool.query(
    "UPDATE leaderboard_snapshots SET created_at=clock_timestamp()-interval '301 seconds'",
  );
  await instance.room.tick();
  assert.equal((await request('/leaderboards', undefined, u.cookie)).data.mine.merit, 99);
});

test('V8 media measures actual audio duration, enforces admin role and serves static blessings', async () => {
  const admin = await fixture('Quản trị', true, 'ADMIN'),
    u = await fixture();
  const createAudio = (seconds: number) =>
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      String(seconds),
      '-c:a',
      'libvorbis',
      '-f',
      'ogg',
      'pipe:1',
    ]).toString('base64');
  const data = createAudio(0.25);
  assert.equal(
    (await request('/admin/media/upload', { kind: 'voice', title: 'Voice test', data }, u.cookie))
      .response.status,
    403,
  );
  assert.equal(
    (
      await request(
        '/admin/media/upload',
        { kind: 'voice', title: 'Overlong', data: createAudio(11) },
        admin.cookie,
      )
    ).data.code,
    'MEDIA_DURATION',
  );
  const asset = await request(
    '/admin/media/upload',
    { kind: 'voice', title: 'Voice test', data },
    admin.cookie,
  );
  assert.equal(asset.response.status, 200, JSON.stringify(asset.data));
  assert.ok(asset.data.durationMs <= 10000);
  const config = structuredClone(defaultSettings);
  config.blessings = [{ id: 'test', text: 'Chúc bạn bình an.', audioId: asset.data.id }];
  const saved = await instance.cms.save(admin.id, config, null);
  await instance.cms.publish(admin.id, saved.id);
  await new MockLiveAdapter(instance.live).receive({
    liveId: 'static-test',
    sourceEventId: 'gift',
    senderId: 'sender',
    displayName: 'An Nhiên',
    giftId: 'rose',
    count: 1,
  });
  await instance.live.generateNext();
  const job = (await pool.query('SELECT * FROM tts_jobs WHERE asset_id=$1', [asset.data.id]))
    .rows[0];
  assert.equal(job.mode, 'static');
  assert.equal(job.status, 'READY');
  assert.equal(job.text, 'Chúc bạn bình an.');
  assert.equal((await instance.live.audio(job.id)).subarray(0, 4).toString(), 'OggS');
  await assert.rejects(
    pool.query('UPDATE coin_ledger SET amount=amount WHERE id=-1').then(async () => {
      await pool.query(
        "INSERT INTO coin_ledger(user_id,amount,source) VALUES($1,1,'test-immutable')",
        [u.id],
      );
      await pool.query("UPDATE coin_ledger SET amount=2 WHERE source='test-immutable'");
    }),
    /append-only/,
  );
});

test('V9 catalog contains six new robes, ten seats and five dot styles; only cosmetics are purchasable', async () => {
  const { data } = await request('/store');
  assert.equal(data.title, 'Bảo Các Thanh Liên');
  assert.equal(
    data.products.filter((p: any) => p.category === 'robe' && p.id.startsWith('robe_')).length,
    6,
  );
  assert.equal(data.products.filter((p: any) => p.category === 'seat').length, 10);
  assert.equal(data.products.filter((p: any) => p.category === 'dotStyle').length, 5);
  assert.ok(
    data.products.every((p: any) => !('merit' in p) && !('cooldown' in p) && !('priority' in p)),
  );
  assert.equal(
    (await request('/store/buy', { itemId: 'seat_hong', requestKey: randomUUID() })).response
      .status,
    401,
  );
  const u = await fixture();
  assert.equal(
    (
      await request(
        '/store/buy',
        { itemId: 'seat_hong', requestKey: randomUUID(), price: 0 },
        u.cookie,
      )
    ).response.status,
    400,
  );
  assert.equal(
    (await request('/store/equip', { itemId: 'seat_hong' }, u.cookie)).response.status,
    403,
  );
});
test('V9 simultaneous duplicate purchases debit once and request keys cannot cross old/new shops', async () => {
  const u = await fixture(),
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      request('/store/buy', { itemId: 'dots_gold', requestKey: key, expectedPrice: 100 }, u.cookie),
    ),
  );
  assert.ok(results.every((r) => r.response.status === 200));
  let me = (await request('/me', undefined, u.cookie)).data.user;
  assert.equal(me.coins, 200);
  assert.equal(me.dots, 0);
  assert.equal(
    (await request('/store/buy', { itemId: 'seat_hoa', requestKey: key }, u.cookie)).data.code,
    'KEY_REUSED',
  );
  assert.equal(
    (await request('/wardrobe/buy', { outfitId: 'saffron', requestKey: key }, u.cookie)).data.code,
    'KEY_REUSED',
  );
  await request('/store/equip', { itemId: 'dots_gold' }, u.cookie);
  me = (await request('/me', undefined, u.cookie)).data.user;
  assert.equal(me.cosmetics.dotStyle, 'dots_gold');
  assert.equal(me.dots, 0);
  assert.equal((await request('/store/history', undefined, u.cookie)).data.transactions.length, 1);
  const concurrent = await Promise.all(
    ['seat_hoa', 'robe_thanh'].map((itemId) =>
      request('/store/buy', { itemId, requestKey: randomUUID() }, u.cookie),
    ),
  );
  assert.equal(concurrent.filter((r) => r.response.status === 200).length, 1);
  assert.equal(concurrent.filter((r) => r.data.code === 'INSUFFICIENT_COINS').length, 1);
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 50);
});
test('V9 equip is shared with viewers and preserves seats, action timeline, rewards and dot bound', async () => {
  const u = await fixture();
  await pool.query('UPDATE users SET coins=20000 WHERE id=$1', [u.id]);
  await join(u);
  const before = await instance.room.snapshot(),
    action = (await request('/actions/incense', { requestKey: randomUUID() }, u.cookie)).data
      .action;
  for (const itemId of ['robe_ngoc', 'seat_cuu', 'accessory_book', 'frame_bamboo', 'dots_pearl']) {
    assert.equal(
      (await request('/store/buy', { itemId, requestKey: randomUUID() }, u.cookie)).response.status,
      200,
    );
    assert.equal((await request('/store/equip', { itemId }, u.cookie)).response.status, 200);
  }
  const after = (await request('/room')).data,
    player = after.seats.find((s: any) => s.player?.player_id === u.id).player;
  assert.equal(player.equipped, 'robe_ngoc');
  assert.equal(player.cosmetics.seat, 'seat_cuu');
  assert.equal(player.cosmetics.accessory, 'accessory_book');
  assert.equal(player.dots, 0);
  assert.deepEqual(
    after.seats.map((s: any) => [s.id, s.x, s.y, s.scale]),
    before.seats.map((s: any) => [s.id, s.x, s.y, s.scale]),
  );
  assert.equal((await instance.room.myEntry(u.id))?.status, 'ACTIVE');
  assert.equal(
    (await instance.room.myAction(u.id))?.ends_at.toISOString(),
    new Date(action.ends_at).toISOString(),
  );
  assert.equal((await request('/me', undefined, u.cookie)).data.user.merit, 0);
  assert.equal(
    (await request('/wardrobe/equip', { outfitId: 'seat_cuu' }, u.cookie)).response.status,
    400,
  );
});
test('V9 draft changes are isolated; delisting keeps ownership and publishing cannot remove owned products', async () => {
  const u = await fixture(),
    admin = await fixture('Quản trị', true, 'ADMIN');
  await join(u);
  await request('/store/buy', { itemId: 'robe_thanh', requestKey: randomUUID() }, u.cookie);
  const config = structuredClone(defaultSettings);
  const item = config.store.products.find((p) => p.id === 'robe_thanh')!;
  item.enabled = false;
  item.price = 900;
  const saved = await instance.cms.save(admin.id, config, null);
  assert.equal(
    (await request('/store')).data.products.find((p: any) => p.id === 'robe_thanh').enabled,
    true,
  );
  await instance.cms.publish(admin.id, saved.id);
  assert.equal(
    (await request('/store/equip', { itemId: 'robe_thanh' }, u.cookie)).response.status,
    200,
  );
  const newcomer = await fixture();
  assert.equal(
    (
      await request(
        '/store/buy',
        { itemId: 'robe_thanh', requestKey: randomUUID() },
        newcomer.cookie,
      )
    ).data.code,
    'ITEM_UNAVAILABLE',
  );
  config.store.products = config.store.products.filter((p) => p.id !== 'robe_thanh');
  const removed = await instance.cms.save(admin.id, config, null);
  await assert.rejects(instance.cms.publish(admin.id, removed.id), /ngừng bán/);
  const priceConfig = structuredClone(defaultSettings);
  priceConfig.store.products.find((p) => p.id === 'dots_gold')!.price = 120;
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(priceConfig),
  ]);
  assert.equal(
    (
      await request(
        '/store/buy',
        { itemId: 'dots_gold', expectedPrice: 100, requestKey: randomUUID() },
        newcomer.cookie,
      )
    ).data.code,
    'PRICE_CHANGED',
  );
  assert.equal((await request('/me', undefined, newcomer.cookie)).data.user.coins, 300);
});
test('V9 CMS can customize legacy robes without losing inventory or bypassing sale state', async () => {
  const u = await fixture(),
    admin = await fixture('Quản trị', true, 'ADMIN');
  const config = structuredClone(defaultSettings);
  const template = config.store.products.find((p) => p.id === 'robe_thanh')!;
  config.store.products.push({
    ...template,
    id: 'saffron',
    name: 'Nắng ban mai mới',
    price: 190,
    enabled: true,
  });
  let draft = await instance.cms.save(admin.id, config, null);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal(
    (await request('/store')).data.products.filter((p: any) => p.id === 'saffron').length,
    1,
  );
  assert.equal(
    (await request('/catalog')).data.outfits.find((p: any) => p.id === 'saffron').price,
    190,
  );
  assert.equal(
    (await request('/wardrobe/buy', { outfitId: 'saffron', requestKey: randomUUID() }, u.cookie))
      .response.status,
    200,
  );
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 110);
  config.store.products.find((p) => p.id === 'saffron')!.enabled = false;
  draft = await instance.cms.save(admin.id, config, null);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal(
    (await request('/store/equip', { itemId: 'saffron' }, u.cookie)).response.status,
    200,
  );
  const other = await fixture();
  assert.equal(
    (
      await request(
        '/wardrobe/buy',
        { outfitId: 'saffron', requestKey: randomUUID() },
        other.cookie,
      )
    ).data.code,
    'ITEM_UNAVAILABLE',
  );
});

test('V9 versioned shop images validate actual files, require admin role and are public only after publish', async () => {
  const admin = await fixture('Quản trị', true, 'ADMIN'),
    regular = await fixture();
  const data = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x8c9368:s=32x32',
    '-frames:v',
    '1',
    '-threads',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1',
  ]).toString('base64');
  assert.equal(
    (await request('/admin/store/assets', { data }, regular.cookie)).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        '/admin/store/assets',
        { data: Buffer.from('<svg/>').toString('base64') },
        admin.cookie,
      )
    ).data.code,
    'IMAGE_FORMAT',
  );
  const asset = await request('/admin/store/assets', { data }, admin.cookie);
  assert.equal(asset.response.status, 200, JSON.stringify(asset.data));
  assert.equal(asset.data.width, 32);
  assert.equal((await fetch(base + '/api/store/assets/' + asset.data.id)).status, 404);
  const config = structuredClone(defaultSettings);
  config.store.products.find((p) => p.id === 'seat_hong')!.imageId = asset.data.id;
  const draft = await instance.cms.save(admin.id, config, null);
  await instance.cms.publish(admin.id, draft.id);
  const response = await fetch(base + '/api/store/assets/' + asset.data.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(data, 'base64'));
});

test('Thiền Tĩnh V2 CMS mapping and mix are validated, versioned and archived files remain playable for published bindings', async () => {
  const admin = await fixture('Quản trị âm thanh', true, 'ADMIN'),
    regular = await fixture();
  await pool.query(
    "UPDATE sessions SET admin_until=clock_timestamp()+interval '5 minutes' WHERE user_id=$1",
    [admin.id],
  );
  const { audioMixSchema, v2FileCues } = await import('../server/audio-config.js');
  const manifest = JSON.parse(
    await readFile('docs/audio/thien-tinh-v2/audio-manifest.json', 'utf8'),
  );
  assert.deepEqual(
    Object.keys(v2FileCues).toSorted(),
    manifest.files.map((f: { name: string }) => f.name).toSorted(),
  );
  assert.equal(Object.keys(v2FileCues).length, 14);
  const data = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220',
    '-t',
    '0.2',
    '-c:a',
    'libopus',
    '-f',
    'ogg',
    'pipe:1',
  ]).toString('base64');
  const asset = await request(
    '/admin/media/upload',
    { kind: 'music', title: 'TEST ONLY Opus', data },
    admin.cookie,
  );
  assert.equal(asset.response.status, 200);
  const config = structuredClone(defaultSettings);
  config.audio.background = asset.data.id;
  config.audio.waitingBackground = asset.data.id;
  config.audioMix = audioMixSchema.parse({});
  assert.equal(config.audioMix.volumes.templeAmbient, 0.16);
  assert.equal(config.audioMix.volumes.waitingAmbient, 0.13);
  assert.equal(config.audioMix.duckFactor, 0.25);
  const draft = await instance.cms.save(admin.id, config, null);
  assert.equal((await fetch(base + '/api/media/' + asset.data.id)).status, 404);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal((await fetch(base + '/api/media/' + asset.data.id)).status, 200);
  assert.equal(
    (await request('/admin/media/archive', { id: asset.data.id, archived: true }, regular.cookie))
      .response.status,
    403,
  );
  assert.equal(
    (await request('/admin/media/archive', { id: asset.data.id, archived: true }, admin.cookie))
      .response.status,
    200,
  );
  assert.equal((await fetch(base + '/api/media/' + asset.data.id)).status, 200);
  assert.ok(
    (await request('/admin/media', undefined, admin.cookie)).data.assets.find(
      (a: any) => a.id === asset.data.id,
    ).archived_at,
  );
  config.audioMix.maxEffects = 3;
  assert.equal(
    (await request('/admin/config/draft', { config, expectedId: null }, admin.cookie)).response
      .status,
    400,
  );
});

test('audio V2 importer validates the complete pack before writes and saves all 14 bindings to a draft only', async () => {
  const admin = await fixture('Quản trị âm thanh', true, 'ADMIN'),
    username = 'audio_cli_' + randomUUID().slice(0, 8);
  await pool.query('UPDATE users SET username=$2 WHERE id=$1', [admin.id, username]);
  const manifest = JSON.parse(
    await readFile('docs/audio/thien-tinh-v2/audio-manifest.json', 'utf8'),
  );
  const directory = temp + '/v2-pack';
  await import('node:fs/promises').then((fs) =>
    fs.mkdir(directory + '/assets', { recursive: true }),
  );
  const bytes = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220',
    '-t',
    '0.12',
    '-c:a',
    'libopus',
    '-f',
    'ogg',
    'pipe:1',
  ]);
  for (const file of manifest.files.slice(0, -1))
    await writeFile(directory + '/' + file.path, bytes);
  const target = new URL(process.env.DATABASE_URL!);
  target.searchParams.set('options', `-c search_path=${schema}`);
  const run = () =>
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/import-audio-v2.ts',
        '--directory',
        directory,
        '--actor',
        username,
      ],
      {
        env: { ...process.env, DATABASE_URL: target.toString() },
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  assert.throws(run);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM media_assets')).rows[0].n, 0);
  const last = manifest.files.at(-1);
  await writeFile(directory + '/' + last.path, bytes);
  const result = JSON.parse(run());
  assert.equal(result.status, 'draft-saved');
  assert.equal(result.files, 14);
  const state = await instance.cms.state();
  assert.equal(Object.keys(state.draft.config.audio).length, 14);
  assert.deepEqual(state.published.config.audio, {});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM media_assets')).rows[0].n, 14);
});

test('V11 72-seat NPC projection leaves every human seat free and creates no accounts, ledgers or actions', async () => {
  const { standardSeatLayout } = await import('../server/npc-config.js');
  const config = {
    ...structuredClone(defaultSettings),
    capacity: 72,
    seatLayout: standardSeatLayout(72),
  };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  for (let n = 0; n < 5; n++) {
    const r = (await request('/room')).data;
    assert.equal(r.capacity, 72);
    assert.equal(r.activeCount, 0);
    assert.equal(r.npcTargetCount, 72);
    assert.equal(r.available, 72);
    assert.equal(r.seats.filter((s: any) => s.player).length, 0);
  }
  for (const table of [
    'users',
    'sessions',
    'room_entries',
    'ritual_actions',
    'coin_ledger',
    'merit_transactions',
    'chat_messages',
    'live_events',
  ])
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
  const users = await Promise.all(Array.from({ length: 72 }, () => fixture()));
  for (const target of [1, 36, 72]) {
    const current = (
      await pool.query("SELECT count(*)::int AS n FROM room_entries WHERE status='ACTIVE'")
    ).rows[0].n;
    await Promise.all(users.slice(current, target).map((u) => join(u)));
    const r = (await request('/room')).data;
    assert.equal(r.activeCount, target);
    assert.equal(r.available, 72 - target);
    assert.equal(r.npcTargetCount, 72 - target);
  }
  assert.equal(
    new Set(
      (await pool.query("SELECT seat_id FROM room_entries WHERE status='ACTIVE'")).rows.map(
        (r) => r.seat_id,
      ),
    ).size,
    72,
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 72);
});
test('V11 two humans contest an NPC seat atomically, FIFO owns released seats and service restart preserves human state', async () => {
  const { standardSeatLayout } = await import('../server/npc-config.js'),
    { RoomService } = await import('../server/room.js');
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify({
      ...structuredClone(defaultSettings),
      capacity: 72,
      seatLayout: standardSeatLayout(72),
    }),
  ]);
  const a = await fixture(),
    b = await fixture();
  const contested = await Promise.all(
    [a, b].map((u) => request('/room/join', { seatId: 72, requestKey: randomUUID() }, u.cookie)),
  );
  assert.equal(contested.filter((r) => r.response.status === 200).length, 1);
  assert.equal(contested.filter((r) => r.data.code === 'SLOT_OCCUPIED').length, 1);
  const more = await Promise.all(Array.from({ length: 71 }, () => fixture()));
  await Promise.all(more.map((u) => join(u)));
  const waiting = await fixture(),
    newcomer = await fixture();
  assert.equal((await join(waiting)).status, 'WAITING');
  const entry = (
    await pool.query("SELECT user_id FROM room_entries WHERE status='ACTIVE' AND seat_id=72")
  ).rows[0];
  await instance.room.leave(entry.user_id);
  assert.equal((await instance.room.myEntry(waiting.id))?.status, 'INVITED');
  const state = await new RoomService(pool).snapshot();
  assert.equal(state.activeCount, 71);
  assert.equal(state.reservedCount, 1);
  assert.equal(state.available, 0);
  assert.equal(state.npcTargetCount, 0);
  assert.equal((await join(newcomer)).status, 'WAITING');
  await pool.query(
    "UPDATE room_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [waiting.id],
  );
  await new RoomService(pool).tick();
  assert.equal((await instance.room.myEntry(newcomer.id))?.status, 'INVITED');
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await new Promise<void>((r) => listener.once('listening', r));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((r) => listener.close(() => r()));
  const target = new URL(process.env.DATABASE_URL!);
  target.searchParams.set('options', `-c search_path=${schema}`);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: target.toString(),
      PORT: String(port),
      APP_ORIGIN: origin,
      NODE_ENV: 'development',
      RUN_WORKER: '0',
      REDIS_KEY_PREFIX: prefix,
      ROOM_EVENT_CHANNEL: prefix + 'restart-events',
      ADMIN_MFA_KEY_FILE: temp + '/restart-mfa-key',
      VITE_CACHE_DIR: temp + '/restart-vite-cache',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr?.on('data', (b) => {
    diagnostics += b.toString();
  });
  try {
    let restored: any = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error('Restarted API exited: ' + diagnostics.slice(-500));
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/room`, {
          signal: AbortSignal.timeout(500),
        });
        if (r.ok) {
          restored = await r.json();
          break;
        }
      } catch {
        /* New process startup is asynchronous. */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(restored, 'Restarted API did not answer: ' + diagnostics.slice(-500));
    assert.equal(restored.activeCount, 71);
    assert.equal(restored.reservedCount, 1);
    assert.equal(restored.npcTargetCount, 0);
    assert.equal(restored.available, 0);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((r) => child.once('exit', () => r()));
    }
  }
});
test('V11 CMS exposes NPC modes independently of protected human layout changes', async () => {
  const { standardSeatLayout } = await import('../server/npc-config.js');
  const admin = await fixture('Quản trị', true, 'ADMIN'),
    u = await fixture();
  await join(u);
  const config = {
    ...structuredClone(defaultSettings),
    npc: { ...defaultSettings.npc, mode: 'off' as const },
  };
  let draft = await instance.cms.save(admin.id, config, null);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal((await instance.room.snapshot()).npcTargetCount, 0);
  assert.equal((await instance.room.myEntry(u.id))?.status, 'ACTIVE');
  config.capacity = 72;
  config.seatLayout = standardSeatLayout(72);
  draft = await instance.cms.save(admin.id, config, null);
  await assert.rejects(instance.cms.publish(admin.id, draft.id), /không còn người giữ chỗ/);
  await instance.room.leave(u.id);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal((await instance.room.snapshot()).capacity, 72);
});

async function rewardElapsed(id: string, seconds: number) {
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-$2*interval '1 second',expires_at=clock_timestamp()+interval '5 minutes',disconnect_deadline=clock_timestamp()+interval '5 minutes' WHERE user_id=$1 AND status='ACTIVE'",
    [id, seconds],
  );
}
test('valid partial minutes survive leaving and reconnect expiry; concurrent ticks do not duplicate rewards', async () => {
  const u = await fixture();
  await join(u);
  await rewardElapsed(u.id, 45);
  await instance.room.leave(u.id);
  await join(u);
  await rewardElapsed(u.id, 20);
  await Promise.all(Array.from({ length: 6 }, () => instance.room.tick()));
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 301);
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '90 seconds',disconnect_deadline=clock_timestamp()-interval '70 seconds' WHERE user_id=$1 AND status='ACTIVE'",
    [u.id],
  );
  await instance.room.heartbeat(u.id);
  await instance.room.tick();
  assert.equal(await instance.room.myEntry(u.id), null);
  await join(u);
  await rewardElapsed(u.id, 36);
  await instance.room.tick();
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 302);
});
test('reward accounting splits at Vietnam midnight and preserves daily limits after worker downtime', async () => {
  const u = await fixture();
  await join(u);
  await pool.query(
    `UPDATE room_entries SET reward_cursor=(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '1 day'-interval '60 seconds',expires_at=(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '1 day'+interval '60 seconds',disconnect_deadline=(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '1 day'+interval '60 seconds' WHERE user_id=$1`,
    [u.id],
  );
  await instance.room.tick();
  await instance.room.tick();
  assert.equal((await request('/me', undefined, u.cookie)).data.user.coins, 302);
  const days = (
    await pool.query(
      "SELECT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,count(*)::int AS n FROM coin_ledger WHERE user_id=$1 AND source LIKE 'minute:%' GROUP BY 1",
      [u.id],
    )
  ).rows;
  assert.equal(days.length, 2);
  assert.ok(days.every((r) => r.n === 1));
});
test('publishing a lower coin cap settles the old policy first; decorations and dot positions use revisions', async () => {
  const admin = await fixture('Quản trị', true, 'ADMIN');
  await join(admin);
  await rewardElapsed(admin.id, 125);
  const config = structuredClone(defaultSettings);
  config.dailyCoinCap = 1;
  config.decorations.fruit = false;
  config.dotLayout.size = 10;
  const draft = await instance.cms.save(admin.id, config, null);
  assert.equal((await instance.room.snapshot()).config.decorations.fruit, true);
  await instance.cms.publish(admin.id, draft.id);
  assert.equal((await request('/me', undefined, admin.cookie)).data.user.coins, 302);
  const room = await instance.room.snapshot();
  assert.equal(room.config.decorations.fruit, false);
  assert.equal(room.config.dotLayout.size, 10);
  assert.equal(room.capacity, 36);
  await rewardElapsed(admin.id, 125);
  await instance.room.tick();
  assert.equal((await request('/me', undefined, admin.cookie)).data.user.coins, 302);
});

test('outbox survives service replacement and read-only socket requires same origin', async () => {
  const realtime = await attachRealtime(server, rawRedis, origin);
  const socket = io(base, {
    transports: ['websocket'],
    extraHeaders: { Origin: origin },
    forceNew: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No durable outbox event received')), 3000);
      socket.once('temple.event', (e) => {
        clearTimeout(timer);
        resolve(e);
      });
    });
    const u = await fixture();
    await join(u);
    await flushOutbox(pool, rawRedis);
    const event = await received;
    assert.equal(event.kind, 'room.changed');
    assert.ok(event.eventId);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM outbox WHERE delivered_at IS NULL')).rows[0]
        .n,
      0,
    );
    const evil = io(base, {
      transports: ['websocket'],
      extraHeaders: { Origin: 'https://evil.example' },
      forceNew: true,
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        evil.once('connect', () => reject(new Error('Cross-origin socket accepted')));
        evil.once('connect_error', () => resolve());
      });
    } finally {
      evil.disconnect();
    }
  } finally {
    socket.disconnect();
    await realtime.close();
  }
});
