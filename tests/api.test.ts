import { after, before, beforeEach, test } from 'node:test';
import { spawn } from 'node:child_process';
import { Queue } from 'bullmq';
import { redisConnection } from '../server/jobs.js';
import assert from 'node:assert/strict';
import { type Server } from 'node:http';
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
  hash = await argon2.hash(password, hashOptions);
  instance = await createApp({ pool, redis, origin });
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
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
test('admin RBAC, MFA enrollment, code replay protection, draft/publish/rollback and occupied-seat guard', async () => {
  const regular = await fixture(),
    admin = await fixture('Chủ chùa', true, 'ADMIN');
  assert.equal((await request('/admin/config', undefined, regular.cookie)).response.status, 403);
  assert.equal((await request('/admin/config', undefined, admin.cookie)).data.code, 'MFA_REQUIRED');
  const enrollment = await request('/admin/mfa/enroll', {}, admin.cookie);
  assert.ok(enrollment.data.uri.startsWith('otpauth://'));
  const code = new TOTP({ secret: Secret.fromBase32(enrollment.data.secret) }).generate();
  assert.equal((await request('/admin/mfa/verify', { code }, admin.cookie)).response.status, 200);
  assert.equal(
    (await request('/admin/mfa/verify', { code }, admin.cookie)).data.code,
    'MFA_REPLAY',
  );
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
  assert.equal(channel.volume, 0.2);
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
