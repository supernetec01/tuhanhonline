import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { type Server } from 'node:http';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { connectDb, migrate } from '../server/db.js';
import { RoomService } from '../server/room.js';
import { createApp } from '../server/app.js';
import { defaultSettings } from '../server/config.js';
import { standardSeatLayout } from '../server/npc-config.js';
import {
  navigation,
  shortestPath,
  timedPath,
  sampleMotion,
  pathsConflict,
} from '../server/navigation.js';
import { digest } from '../server/auth.js';
const schema = `movement_${randomUUID().replaceAll('-', '')}`,
  origin = 'http://localhost:3000';
let root: Pool,
  pool: Pool,
  redis: Redis,
  room: RoomService,
  server: Server,
  app: Awaited<ReturnType<typeof createApp>>,
  base: string;
async function actor() {
  const id = randomUUID(),
    token = randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO users(id,name,password_hash,username)VALUES($1,'Đạo hữu V12','no-login-fixture',$2)",
    [id, `u_${id.replaceAll('-', '').slice(0, 20)}`],
  );
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at)VALUES($1,$2,clock_timestamp()+interval '1 day')",
    [digest(token), id],
  );
  return { id, cookie: `temple_session=${token}` };
}
async function req(path: string, body?: unknown, cookie = '') {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Temple-Request': '1',
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function advance() {
  await pool.query(
    "UPDATE room_entries SET move_started_at=move_started_at-interval '120 seconds',move_ends_at=move_ends_at-interval '120 seconds' WHERE status='ACTIVE' AND movement_path IS NOT NULL",
  );
  await pool.query(
    "UPDATE ritual_actions SET ends_at=clock_timestamp()-interval '1 second' WHERE status='RUNNING' AND type='incense'",
  );
  await room.tick();
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
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { keyPrefix: `${schema}:` });
  app = await createApp({ pool, redis, origin });
  room = app.room;
  server = app.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE users,config_revisions,leaderboard_snapshots RESTART IDENTITY CASCADE',
  );
  await pool.query("INSERT INTO config_revisions(status,config)VALUES('published',$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await pool.query("UPDATE rooms SET status='open',version=0");
  await pool.query('UPDATE ceremony_clock SET next_at=NULL,config_version=NULL');
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await redis.quit();
  await pool.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
});
test('V12 graph connects every 36/72 seat to legal aisles; paths interpolate speed and detect crossing feet', () => {
  for (const count of [36, 72] as const) {
    const g = navigation({ seatLayout: standardSeatLayout(count) });
    for (let i = 1; i <= count; i++) {
      const path = shortestPath(g, `seat:${i}`, 'front:out');
      assert.ok(path);
      const timed = timedPath(path, 8);
      const motion = {
        path: timed,
        startedAt: 1000,
        endsAt: 1000 + timed.at(-1)!.ms,
        target: 'front:out',
      };
      assert.equal(sampleMotion(motion, motion.endsAt).x, 93);
      assert.ok(Number.isFinite(motion.endsAt));
    }
  }
  const a = {
      path: [
        { id: 'a', x: 0, y: 5, ms: 0 },
        { id: 'b', x: 10, y: 5, ms: 1000 },
      ],
      startedAt: 0,
      endsAt: 1000,
      target: 'b',
    },
    b = {
      path: [
        { id: 'c', x: 5, y: 0, ms: 0 },
        { id: 'd', x: 5, y: 10, ms: 1000 },
      ],
      startedAt: 0,
      endsAt: 1000,
      target: 'd',
    };
  assert.equal(pathsConflict(a, b), true);
  assert.equal(pathsConflict(a, { ...b, startedAt: 2000, endsAt: 3000 }), false);
});
test('V12 appearance is validated, stored on signup/profile and shared with viewers without email', async () => {
  const challenge = (await req('/auth/challenge')).data;
  let solution = 0;
  while (!digest(`${challenge.nonce}:${solution}`).startsWith('000')) solution++;
  const result = await req('/auth/register', {
    username: 'v12_female',
    dharmaName: 'An Nhiên',
    password: 'V12-private-test-password!',
    appearanceType: 'female',
    challenge: { id: challenge.id, solution },
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.appearanceType, 'female');
  const u = await actor();
  assert.equal(
    (await req('/character/appearance', { appearanceType: 'female' }, u.cookie)).data.user
      .appearanceType,
    'female',
  );
  await room.join(u.id, randomUUID());
  assert.equal(
    (await room.snapshot()).seats.find((s: any) => s.player?.player_id === u.id)!.player
      .appearance_type,
    'female',
  );
  assert.equal(
    (await req('/character/appearance', { appearanceType: '<script>' }, u.cookie)).status,
    400,
  );
  assert.equal((await req('/character/appearance', { appearanceType: 'male' })).status, 401);
});
test('V12 walk requests reject illegal nodes, forged speed and occupied destinations; retries do not reset leave deadline', async () => {
  const a = await actor(),
    b = await actor();
  await room.join(a.id, randomUUID());
  await room.join(b.id, randomUUID());
  assert.equal(
    (await req('/character/move', { nodeId: 'station:A', requestKey: randomUUID() }, a.cookie))
      .status,
    400,
  );
  assert.equal(
    (
      await req(
        '/character/move',
        { nodeId: 'walk:0:left', speed: 999, requestKey: randomUUID() },
        a.cookie,
      )
    ).status,
    400,
  );
  const key = randomUUID(),
    entry = await room.move(a.id, key, 'walk:0:left');
  assert.ok(entry.move_ends_at > entry.move_started_at);
  assert.ok(entry.leave_deadline);
  const deadline = String(entry.leave_deadline);
  assert.equal(String((await room.move(a.id, key, 'walk:0:left')).leave_deadline), deadline);
  await assert.rejects(room.move(b.id, randomUUID(), 'walk:0:left'), /Lối đi/);
  await room.heartbeat(a.id);
  const replacement = new RoomService(pool);
  assert.equal(String((await replacement.myEntry(a.id))!.leave_deadline), deadline);
  await assert.rejects(room.move(a.id, randomUUID(), 'walk:1:left'), /đang di chuyển/);
});
test('V12 voluntary walking pauses coins; return is completed by server arrival and 180s expiry grants FIFO', async () => {
  const config = { ...structuredClone(defaultSettings), capacity: 1 };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  const a = await actor(),
    b = await actor();
  await room.join(a.id, randomUUID());
  await room.join(b.id, randomUUID());
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '45 seconds' WHERE user_id=$1",
    [a.id],
  );
  await room.move(a.id, randomUUID(), 'walk:0:left');
  await advance();
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '10 minutes' WHERE user_id=$1",
    [a.id],
  );
  await room.tick();
  assert.equal(
    (await pool.query('SELECT coins FROM users WHERE id=$1', [a.id])).rows[0].coins,
    300,
  );
  const returning = await room.move(a.id, randomUUID());
  assert.equal(returning.character_state, 'RETURNING');
  assert.ok(returning.leave_deadline);
  await advance();
  assert.equal((await room.myEntry(a.id))!.character_state, 'SEATED');
  assert.equal((await room.myEntry(a.id))!.leave_deadline, null);
  await room.move(a.id, randomUUID(), 'walk:0:left');
  await advance();
  await pool.query(
    "UPDATE room_entries SET leave_deadline=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  await room.tick();
  assert.equal(await room.myEntry(a.id), null);
  assert.equal((await room.myEntry(b.id))!.status, 'INVITED');
  await assert.rejects(room.move(a.id, randomUUID()), /ghế đang giữ/);
});
test('V12 return routes detour around standing queue members instead of crossing their feet', async () => {
  const config = {
    ...structuredClone(defaultSettings),
    capacity: 72,
    seatLayout: standardSeatLayout(72),
  };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  const a = await actor(),
    b = await actor();
  await room.join(a.id, randomUUID(), 7);
  await room.join(b.id, randomUUID(), 1);
  await pool.query(
    "UPDATE room_entries SET character_state='STANDING',position_node='station:A',leave_deadline=clock_timestamp()+interval '180 seconds' WHERE user_id=$1",
    [a.id],
  );
  await pool.query(
    "UPDATE room_entries SET character_state='INCENSE_WAITING',position_node='queue:1' WHERE user_id=$1",
    [b.id],
  );
  const e = await room.move(a.id, randomUUID());
  const motion = {
    path: e.movement_path,
    startedAt: new Date(e.move_started_at).getTime(),
    endsAt: new Date(e.move_ends_at).getTime(),
    target: 'seat:7',
  };
  const p = navigation(config).nodes.get('queue:1')!;
  assert.equal(
    pathsConflict(motion, {
      path: [
        { ...p, ms: 0 },
        { ...p, ms: 120000 },
      ],
      startedAt: motion.startedAt,
      endsAt: motion.startedAt + 120000,
      target: p.id,
    }),
    false,
  );
  assert.equal(e.movement_path.at(-1).id, 'seat:7');
});
test('V12 full 72-person incense FIFO uses two stations, bounded physical line, exact once merit and protected returns', async () => {
  const config = {
    ...structuredClone(defaultSettings),
    capacity: 72,
    seatLayout: standardSeatLayout(72),
  };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  const started = performance.now();
  const people = [];
  for (let i = 0; i < 72; i++) {
    const a = await actor();
    people.push(a);
    await room.join(a.id, randomUUID());
  }
  for (const a of people) await room.action(a.id, 'incense', randomUUID());
  let maxRunning = 0,
    maxPhysical = 0,
    both = false,
    round = 0;
  for (; round < 400; round++) {
    await advance();
    const counts = (
      await pool.query(
        "SELECT count(*) FILTER(WHERE status='RUNNING')::int AS running,count(*) FILTER(WHERE queue_slot IS NOT NULL AND status='QUEUED')::int AS physical,count(*) FILTER(WHERE status='COMPLETED')::int AS completed FROM ritual_actions WHERE type='incense'",
      )
    ).rows[0];
    maxRunning = Math.max(maxRunning, counts.running);
    maxPhysical = Math.max(maxPhysical, counts.physical);
    both ||= counts.running === 2;
    assert.ok(counts.running <= 2);
    assert.ok(counts.physical <= 8);
    if (
      counts.completed === 72 &&
      !(
        await pool.query(
          "SELECT 1 FROM room_entries WHERE character_state<>'SEATED' AND status='ACTIVE'",
        )
      ).rowCount
    )
      break;
  }
  assert.ok(
    round < 400,
    JSON.stringify(
      (
        await pool.query(
          "SELECT a.sequence,a.phase,a.status,a.station,e.position_node,e.character_state,e.move_started_at,e.move_ends_at,e.movement_path FROM ritual_actions a JOIN room_entries e ON e.id=a.entry_id WHERE e.character_state<>'SEATED' ORDER BY a.sequence LIMIT 15",
        )
      ).rows,
    ),
  );
  assert.equal(both, true);
  assert.equal((await pool.query('SELECT sum(merit)::int AS n FROM users')).rows[0].n, 720);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM merit_transactions')).rows[0].n,
    72,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM room_entries WHERE status='ACTIVE'")).rows[0]
      .n,
    72,
  );
  const actions = (
    await pool.query(
      'SELECT sequence,started_at,ends_at,duration_ms,cooldown_ms FROM ritual_actions ORDER BY sequence',
    )
  ).rows;
  assert.ok(actions.every((a) => a.duration_ms === 5000 && a.cooldown_ms === 300000));
  assert.ok(
    actions.every((a, i) => !i || new Date(a.started_at) >= new Date(actions[i - 1].started_at)),
  );
  await room.tick();
  assert.equal((await pool.query('SELECT sum(merit)::int AS n FROM users')).rows[0].n, 720);
  await assert.rejects(room.action(people[0].id, 'incense', randomUUID()), /chờ/);
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/v12-server-metrics.json',
    JSON.stringify(
      {
        people: 72,
        rounds: round,
        maxRunning,
        maxPhysical,
        durationMs: performance.now() - started,
        nodeRssBytes: process.memoryUsage().rss,
      },
      null,
      2,
    ),
  );
});
test('V12 called ceremonies retain a nearly expired seat but disconnect cancels and never awards merit', async () => {
  const a = await actor();
  await room.join(a.id, randomUUID());
  await room.action(a.id, 'incense', randomUUID());
  await pool.query(
    "UPDATE room_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  await room.tick();
  assert.equal((await room.myEntry(a.id))!.status, 'ACTIVE');
  for (let i = 0; i < 20; i++) {
    await pool.query(
      "UPDATE room_entries SET move_started_at=move_started_at-interval '120 seconds',move_ends_at=move_ends_at-interval '120 seconds' WHERE movement_path IS NOT NULL",
    );
    await room.tick();
    if ((await room.myAction(a.id))?.status === 'RUNNING') break;
  }
  const running = await room.myAction(a.id);
  assert.equal(running!.status, 'RUNNING');
  assert.equal(
    new Date(running!.ends_at).getTime() - new Date(running!.started_at).getTime(),
    5000,
  );
  await pool.query(
    "UPDATE room_entries SET disconnect_deadline=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  await room.tick();
  assert.equal(await room.myEntry(a.id), null);
  assert.equal((await pool.query('SELECT merit FROM users WHERE id=$1', [a.id])).rows[0].merit, 0);
});

test('V12 delayed worker caps ceremony protection and coin accrual at actual return time', async () => {
  const a = await actor();
  await room.join(a.id, randomUUID());
  const e = (await room.myEntry(a.id))!;
  await pool.query(
    `UPDATE room_entries SET character_state='INCENSE_RETURNING',
    expires_at=clock_timestamp()-interval '4 minutes',
    reward_cursor=clock_timestamp()-interval '150 seconds',
    move_started_at=clock_timestamp()-interval '130 seconds',
    move_ends_at=clock_timestamp()-interval '120 seconds',
    ritual_protected_until=clock_timestamp()+interval '5 minutes',
    movement_path=$2 WHERE id=$1`,
    [e.id, JSON.stringify([{ id: `seat:${e.seat_id}`, x: 30, y: 53, ms: 10000 }])],
  );
  await room.tick();
  assert.equal(await room.myEntry(a.id), null);
  assert.equal(
    (await pool.query('SELECT coins FROM users WHERE id=$1', [a.id])).rows[0].coins,
    300,
  );
  const progress = (
    await pool.query('SELECT remainder_ms FROM coin_progress WHERE user_id=$1', [a.id])
  ).rows[0];
  assert.ok(progress.remainder_ms >= 29900 && progress.remainder_ms < 31000);
  await room.tick();
  assert.equal(
    (await pool.query('SELECT coins FROM users WHERE id=$1', [a.id])).rows[0].coins,
    300,
  );
});

test('V12 migration preserves wallets/passwords/inventory and resumes pending legacy ceremonies', async () => {
  const oldSchema = `legacy_${randomUUID().replaceAll('-', '')}`;
  await root.query(`CREATE SCHEMA ${oldSchema}`);
  const old = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${oldSchema}`,
  });
  try {
    await old.query(
      'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())',
    );
    for (const name of (await readdir('migrations'))
      .filter((n) => n.endsWith('.sql') && n < '013')
      .sort()) {
      const sql = await readFile(`migrations/${name}`, 'utf8');
      await old.query(sql);
      await old.query('INSERT INTO schema_migrations(name,checksum)VALUES($1,$2)', [
        name,
        createHash('sha256').update(sql).digest('hex'),
      ]);
    }
    const config = structuredClone(defaultSettings);
    delete (config as any).movement;
    await old.query("INSERT INTO config_revisions(status,config)VALUES('published',$1)", [
      JSON.stringify(config),
    ]);
    const users = [randomUUID(), randomUUID()];
    for (let i = 0; i < 2; i++) {
      await old.query(
        "INSERT INTO users(id,name,password_hash,coins)VALUES($1,'Đạo hữu cũ','fixture-existing-hash',123)",
        [users[i]],
      );
      await old.query("INSERT INTO inventory VALUES($1,'linen')", [users[i]]);
      const entry = randomUUID();
      await old.query(
        "INSERT INTO room_entries(id,user_id,seat_id,status,expires_at,disconnect_deadline)VALUES($1,$2,$3,'ACTIVE',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '5 minutes')",
        [entry, users[i], i + 1],
      );
      await old.query(
        "INSERT INTO ritual_actions(id,entry_id,user_id,type,status,duration_ms,cooldown_ms,started_at,ends_at,merit_reward)VALUES($1,$2,$3,'incense',$4,5000,300000,CASE WHEN $4='RUNNING' THEN clock_timestamp() END,CASE WHEN $4='RUNNING' THEN clock_timestamp()+interval '5 seconds' END,10)",
        [randomUUID(), entry, users[i], i ? 'QUEUED' : 'RUNNING'],
      );
    }
    await migrate(old);
    assert.equal((await old.query('SELECT sum(coins)::int AS n FROM users')).rows[0].n, 246);
    assert.ok(
      (await old.query('SELECT password_hash FROM users')).rows.every(
        (r) => r.password_hash === 'fixture-existing-hash',
      ),
    );
    assert.equal((await old.query('SELECT count(*)::int AS n FROM inventory')).rows[0].n, 2);
    const active = (
      await old.query(
        'SELECT a.phase,a.station,e.character_state FROM ritual_actions a JOIN room_entries e ON e.id=a.entry_id ORDER BY a.sequence',
      )
    ).rows;
    assert.equal(active[0].phase, 'ACTIVE');
    assert.equal(active[0].station, 'A');
    assert.equal(active[0].character_state, 'INCENSE_ACTIVE');
    assert.equal(active[1].phase, 'PENDING');
    assert.equal(active[1].character_state, 'INCENSE_PENDING');
  } finally {
    await old.end();
    await root.query(`DROP SCHEMA ${oldSchema} CASCADE`);
  }
});
