import { ExperienceService } from './experience.js';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Secret } from 'otpauth';
import { readFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import argon2 from 'argon2';
import { z } from 'zod';
import { type Pool } from 'pg';
import { ApiError, connectDb, migrate, transaction, roomLock, changed, type Row } from './db.js';
import { AuthService, digest, credentials, registration, hashOptions } from './auth.js';
import { RoomService } from './room.js';
import { CmsService } from './cms.js';
import { LiveService, MockLiveAdapter, ApprovedWebhookAdapter, liveEventSchema } from './live.js';
import { catalog } from './catalog.js';
import { settingsSchema } from './config.js';
const uuid = z.uuid();
const command = z.object({ requestKey: uuid }).strict();
const user = (res: Response) => res.locals.user as Row;
export async function createApp(
  options: {
    pool?: Pool;
    redis?: Redis;
    origin?: string;
    production?: boolean;
    migrate?: boolean;
  } = {},
) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';
  if (production && !origin.startsWith('https://'))
    throw new Error('Production requires an HTTPS APP_ORIGIN');
  if (production && process.env.MAIL_MODE !== 'smtp')
    throw new Error('Production requires SMTP email delivery');
  const pool = options.pool ?? connectDb();
  const redis =
    options.redis ??
    new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
  redis.on('error', () => {});
  if (options.migrate !== false) await migrate(pool);
  const auth = new AuthService(pool, redis, origin, production, await AuthService.key());
  const room = new RoomService(pool),
    live = new LiveService(pool),
    cms = new CmsService(pool);
  const dummyHash = await argon2.hash(randomBytes(32), hashOptions);
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', randomUUID());
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...(!production ? ["'unsafe-inline'"] : [])],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", ...(!production ? [origin.replace(/^http/, 'ws')] : [])],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use('/api', async (req, _res, next) => {
    try {
      if (!req.path.startsWith('/health/'))
        await auth.limit(`api:${digest(req.ip ?? 'unknown')}`, 240, 60);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use('/api', (req, res, next) => {
    if (req.path === '/integrations/live/events') {
      next();
      return;
    }
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      (req.headers.origin !== origin ||
        req.headers['x-temple-request'] !== '1' ||
        !req.is('application/json'))
    ) {
      res
        .status(403)
        .json({ code: 'INVALID_ORIGIN', error: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang.' });
      return;
    }
    next();
  });
  app.use(
    express.json({
      limit: '12kb',
      verify: (req, _res, buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, res) => {
    await pool.query('SELECT 1');
    await redis.ping();
    const worker = !!(await redis.get('temple:worker:heartbeat'));
    res
      .status(worker ? 200 : 503)
      .json({ status: worker ? 'ok' : 'degraded', database: true, redis: true, worker });
  });
  app.get('/api/me', async (req, res) => {
    const u = await auth.currentUser(req);
    res.json({ user: u ? await auth.account(u) : null });
  });
  app.get('/api/catalog', (_req, res) => res.json({ outfits: catalog }));
  const authRate = async (req: Request, type: string) =>
    auth.limit(
      `${type}:ip:${digest(req.ip ?? 'unknown')}`,
      type === 'register' ? 5 : 12,
      type === 'register' ? 3600 : 900,
    );
  app.post('/api/auth/register', async (req, res) => {
    await authRate(req, 'register');
    const input = registration.parse(req.body);
    const passwordHash = await argon2.hash(input.password, hashOptions),
      id = randomUUID();
    let u: Row;
    try {
      u = await transaction(pool, async (tx) => {
        const result = (
          await tx.query(
            'INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4) RETURNING *',
            [id, input.email, passwordHash, input.name],
          )
        ).rows[0];
        await tx.query('INSERT INTO inventory VALUES($1,$2)', [id, 'linen']);
        return result;
      });
    } catch (e) {
      if ((e as { code: string }).code === '23505')
        throw new ApiError(
          400,
          'REGISTRATION_UNAVAILABLE',
          'Không thể tạo tài khoản với thông tin này. Thử đăng nhập hoặc khôi phục mật khẩu.',
        );
      throw e;
    }
    // Failed delivery keeps the account recoverable through resend-verification instead of creating duplicate accounts.
    try {
      await auth.mailToken(u, 'verify');
    } catch {
      res.locals.mailFailed = true;
    }
    await auth.session(id, res, req);
    res.status(201).json({ user: await auth.account(u), verificationSent: !res.locals.mailFailed });
  });
  app.post('/api/auth/login', async (req, res) => {
    await authRate(req, 'login');
    const input = credentials.parse(req.body);
    await auth.limit(`login:account:${digest(input.email)}`, 8, 900);
    const u = (await pool.query('SELECT * FROM users WHERE email=$1', [input.email])).rows[0];
    const valid = await argon2.verify(u?.password_hash ?? dummyHash, input.password);
    if (!u || !valid || u.banned)
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    await redis.del(`limit:login:account:${digest(input.email)}`);
    await auth.session(u.id, res, req, u.password_hash);
    res.json({ user: await auth.account(u) });
  });
  app.post('/api/auth/logout', auth.requireUser, async (req, res) => {
    await room.leave(user(res).id);
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(auth.token(req)!)]);
    res.clearCookie(auth.cookieName, auth.cookieOptions);
    res.json({ ok: true });
  });
  app.post('/api/auth/resend-verification', auth.requireUser, async (_req, res) => {
    await auth.limit(`verify:${user(res).id}`, 3, 900);
    if (!user(res).verified_at) await auth.mailToken(user(res), 'verify');
    res.json({ ok: true });
  });
  app.post('/api/auth/verify-email', async (req, res) => {
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    await transaction(pool, async (tx) => {
      const u = (
        await tx.query(
          "DELETE FROM user_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>clock_timestamp() RETURNING user_id",
          [digest(token)],
        )
      ).rows[0];
      if (!u) throw new ApiError(400, 'TOKEN_EXPIRED', 'Liên kết đã hết hạn hoặc được dùng.');
      await tx.query('UPDATE users SET verified_at=clock_timestamp() WHERE id=$1', [u.user_id]);
    });
    res.json({ ok: true });
  });
  app.post('/api/auth/forgot-password', async (req, res) => {
    await authRate(req, 'recovery');
    const { email } = z.object({ email: credentials.shape.email }).parse(req.body);
    await auth.limit(`recovery:${digest(email)}`, 3, 900);
    const u = (await pool.query('SELECT * FROM users WHERE email=$1 AND NOT banned', [email]))
      .rows[0];
    if (u) {
      try {
        await auth.mailToken(u, 'reset');
      } catch {
        /* Keep response independent of account existence/delivery. */
      }
    }
    res.json({ ok: true, message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.' });
  });
  app.post('/api/auth/reset-password', async (req, res) => {
    await authRate(req, 'recovery');
    const { token, password } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: credentials.shape.password })
      .strict()
      .parse(req.body);
    const hash = await argon2.hash(password, hashOptions);
    await transaction(pool, async (tx) => {
      const record = (
        await tx.query(
          "DELETE FROM user_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>clock_timestamp() RETURNING user_id",
          [digest(token)],
        )
      ).rows[0];
      if (!record) throw new ApiError(400, 'TOKEN_EXPIRED', 'Liên kết đã hết hạn hoặc được dùng.');
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, record.user_id]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [record.user_id]);
      await tx.query("DELETE FROM user_tokens WHERE user_id=$1 AND purpose='reset'", [
        record.user_id,
      ]);
    });
    res.clearCookie(auth.cookieName, auth.cookieOptions);
    res.json({ ok: true });
  });
  app.post('/api/wardrobe/buy', auth.requireUser, async (req, res) => {
    const input = z.object({ outfitId: z.string(), requestKey: uuid }).strict().parse(req.body);
    const outfit = catalog.find((o) => o.id === input.outfitId);
    if (!outfit) throw new ApiError(404, 'OUTFIT_MISSING', 'Không tìm thấy trang phục.');
    await transaction(pool, async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(res).id]);
      const previous = (
        await tx.query('SELECT outfit_id FROM purchases WHERE user_id=$1 AND request_key=$2', [
          user(res).id,
          input.requestKey,
        ])
      ).rows[0];
      if (previous && previous.outfit_id !== outfit.id)
        throw new ApiError(409, 'KEY_REUSED', 'Mã giao dịch đã được dùng.');
      if (
        !(
          await tx.query('SELECT 1 FROM inventory WHERE user_id=$1 AND outfit_id=$2', [
            user(res).id,
            outfit.id,
          ])
        ).rowCount
      ) {
        if (
          !(
            await tx.query('UPDATE users SET coins=coins-$1 WHERE id=$2 AND coins>=$1', [
              outfit.price,
              user(res).id,
            ])
          ).rowCount
        )
          throw new ApiError(409, 'INSUFFICIENT_COINS', 'Bạn chưa đủ xu để mua trang phục này.');
        await tx.query('INSERT INTO inventory VALUES($1,$2)', [user(res).id, outfit.id]);
        await tx.query(
          'INSERT INTO purchases(id,user_id,outfit_id,amount,request_key) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), user(res).id, outfit.id, outfit.price, input.requestKey],
        );
      }
    });
    res.json({
      user: await auth.account(
        (await pool.query('SELECT * FROM users WHERE id=$1', [user(res).id])).rows[0],
      ),
    });
  });
  app.post('/api/wardrobe/equip', auth.requireUser, async (req, res) => {
    const { outfitId, accessory } = z
      .object({
        outfitId: z.string(),
        accessory: z.enum(['none', 'beads', 'lotus']).default('none'),
      })
      .strict()
      .parse(req.body);
    if (
      !(
        await pool.query('SELECT 1 FROM inventory WHERE user_id=$1 AND outfit_id=$2', [
          user(res).id,
          outfitId,
        ])
      ).rowCount
    )
      throw new ApiError(403, 'OUTFIT_NOT_OWNED', 'Bạn chưa sở hữu trang phục này.');
    await transaction(pool, async (tx) => {
      await roomLock(tx);
      await tx.query('UPDATE users SET equipped=$1,accessory=$2 WHERE id=$3', [
        outfitId,
        accessory,
        user(res).id,
      ]);
      await changed(tx);
    });
    res.json({
      user: await auth.account(
        (await pool.query('SELECT * FROM users WHERE id=$1', [user(res).id])).rows[0],
      ),
    });
  });
  app.get('/api/room', async (_req, res) => res.json(await room.snapshot()));
  app.get('/api/room/me', auth.requireUser, async (_req, res) =>
    res.json({
      entry: await room.myEntry(user(res).id),
      action: await room.myAction(user(res).id),
    }),
  );
  app.get('/api/waitlist/me', auth.requireUser, async (_req, res) =>
    res.json({ entry: await room.myEntry(user(res).id) }),
  );
  app.post('/api/room/join', auth.requireUser, auth.verified, async (req, res) =>
    res.json({ entry: await room.join(user(res).id, command.parse(req.body).requestKey) }),
  );
  app.post('/api/room/leave', auth.requireUser, async (_req, res) => {
    await room.leave(user(res).id);
    res.json({ ok: true });
  });
  app.post('/api/room/heartbeat', auth.requireUser, async (_req, res) => {
    await room.heartbeat(user(res).id);
    res.json({ ok: true });
  });
  app.post('/api/waitlist/accept', auth.requireUser, auth.verified, async (_req, res) => {
    const entry = await room.accept(user(res).id);
    if (!entry)
      throw new ApiError(
        409,
        'INVITATION_EXPIRED',
        'Lời mời đã hết hạn. Bạn có thể vào hàng chờ lại.',
      );
    res.json({ entry });
  });
  app.post('/api/waitlist/cancel', auth.requireUser, async (_req, res) => {
    await room.leave(user(res).id);
    res.json({ ok: true });
  });
  for (const type of ['bow', 'prostrate', 'incense'])
    app.post(`/api/actions/${type}`, auth.requireUser, auth.verified, async (req, res) =>
      res.json({
        action: await room.action(user(res).id, type, command.parse(req.body).requestKey),
      }),
    );
  app.get('/api/live/status', async (_req, res) =>
    res.json({
      tiktokConnected: false,
      adapter: process.env.LIVE_WEBHOOK_SECRET_FILE ? 'signed-webhook-ready' : 'mock',
      ttsProvider: process.env.TTS_PROVIDER ?? 'mock',
      notice: 'Chưa xác minh kết nối TikTok thật. Mock không nhận quà thật.',
    }),
  );
  app.get('/api/live/recent', async (_req, res) => res.json({ events: await live.recent() }));
  app.post('/api/integrations/live/events', async (req, res) => {
    if (!req.is('application/json'))
      throw new ApiError(400, 'INVALID_BODY', 'Cần gửi dữ liệu JSON.');
    if (!process.env.LIVE_WEBHOOK_SECRET_FILE)
      throw new ApiError(503, 'LIVE_NOT_CONFIGURED', 'Nguồn sự kiện LIVE chưa được cấu hình.');
    const timestamp = req.headers['x-live-timestamp'],
      signature = req.headers['x-live-signature'];
    if (
      typeof timestamp !== 'string' ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300000 ||
      typeof signature !== 'string' ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Chữ ký không hợp lệ.');
    const secret = await readFile(process.env.LIVE_WEBHOOK_SECRET_FILE);
    if (secret.length < 32) throw new Error('LIVE_SECRET_TOO_SHORT');
    const expected = createHmac('sha256', secret)
      .update(timestamp + '.')
      .update((req as Request & { rawBody: Buffer }).rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Chữ ký không hợp lệ.');
    res.json(await new ApprovedWebhookAdapter(live).receive(liveEventSchema.parse(req.body)));
  });
  app.get('/api/admin/mfa/status', auth.requireUser, async (_req, res) => {
    const u = user(res);
    if (u.role === 'USER') throw new ApiError(403, 'ACCESS_DENIED', 'Bạn không có quyền quản trị.');
    res.json({
      enrolled: !!u.mfa_last_counter,
      active: !!u.admin_until && new Date(u.admin_until) > new Date(),
    });
  });
  app.post('/api/admin/mfa/enroll', auth.requireUser, auth.verified, async (_req, res) => {
    const u = user(res);
    if (u.role === 'USER' || u.mfa_last_counter)
      throw new ApiError(403, 'ACCESS_DENIED', 'Không thể tạo lại xác thực hai bước.');
    const result = await transaction(pool, async (tx) => {
      const current = (
        await tx.query('SELECT mfa_secret FROM users WHERE id=$1 FOR UPDATE', [u.id])
      ).rows[0];
      const generated = current.mfa_secret
        ? auth.decrypt(current.mfa_secret)
        : new Secret({ size: 20 }).base32;
      if (!current.mfa_secret)
        await tx.query('UPDATE users SET mfa_secret=$1 WHERE id=$2', [
          auth.encrypt(generated),
          u.id,
        ]);
      const totp = auth.totp(generated);
      totp.label = u.email;
      return { secret: generated, uri: totp.toString() };
    });
    res.json(result);
  });
  app.post('/api/admin/mfa/verify', auth.requireUser, auth.verified, async (req, res) => {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const u = user(res);
    await auth.limit(`mfa:${u.id}`, 5, 300);
    if (u.role === 'USER' || !u.mfa_secret)
      throw new ApiError(403, 'ACCESS_DENIED', 'Chưa có xác thực hai bước.');
    const delta = auth.totp(auth.decrypt(u.mfa_secret)).validate({ token: code, window: 1 });
    if (delta === null) throw new ApiError(401, 'MFA_INVALID', 'Mã xác thực không đúng.');
    const counter = Math.floor(Date.now() / 30000) + delta;
    await transaction(pool, async (tx) => {
      if (
        !(
          await tx.query(
            'UPDATE users SET mfa_last_counter=$1 WHERE id=$2 AND (mfa_last_counter IS NULL OR mfa_last_counter<$1)',
            [counter, u.id],
          )
        ).rowCount
      )
        throw new ApiError(401, 'MFA_REPLAY', 'Mã đã dùng. Chờ mã tiếp theo.');
      await tx.query(
        "UPDATE sessions SET admin_until=clock_timestamp()+interval '15 minutes' WHERE token_hash=$1",
        [u.session_hash],
      );
    });
    res.json({ ok: true });
  });
  const admin = [auth.requireUser, auth.admin()] as const;
  const owner = [auth.requireUser, auth.admin('ADMIN')] as const;
  app.get('/api/admin/live/analytics', ...admin, async (_req, res) =>
    res.json(await new ExperienceService(pool).analytics()),
  );
  app.post('/api/admin/ceremonies/test', ...admin, async (_req, res) => {
    await auth.limit(`ceremony:${user(res).id}`, 3, 60);
    res.json(await new ExperienceService(pool).start(user(res).id));
  });
  app.get('/api/admin/dashboard', ...admin, async (_req, res) =>
    res.json({
      room: await room.snapshot(),
      live: await live.recent(),
      tts: (
        await pool.query(
          'SELECT id,text,status,mode,error_code,created_at FROM tts_jobs ORDER BY created_at DESC LIMIT 20',
        )
      ).rows,
    }),
  );
  app.get('/api/admin/config', ...owner, async (_req, res) => res.json(await cms.state()));
  app.post('/api/admin/config/draft', ...owner, async (req, res) => {
    const { config, expectedId } = z
      .object({ config: settingsSchema, expectedId: z.string().regex(/^\d+$/).nullable() })
      .strict()
      .parse(req.body);
    res.json(await cms.save(user(res).id, config, expectedId));
  });
  app.post('/api/admin/config/publish', ...owner, async (req, res) =>
    res.json(
      await cms.publish(
        user(res).id,
        z
          .object({ id: z.string().regex(/^\d+$/) })
          .strict()
          .parse(req.body).id,
      ),
    ),
  );
  app.post('/api/admin/config/rollback', ...owner, async (req, res) =>
    res.json(
      await cms.publish(
        user(res).id,
        z
          .object({ id: z.string().regex(/^\d+$/) })
          .strict()
          .parse(req.body).id,
        true,
      ),
    ),
  );
  app.post('/api/admin/room/status', ...owner, async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['open', 'closed']) })
      .strict()
      .parse(req.body);
    await transaction(pool, async (tx) => {
      await roomLock(tx);
      await tx.query("UPDATE rooms SET status=$1 WHERE id='main'", [status]);
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'room.status',$2)",
        [user(res).id, JSON.stringify({ status })],
      );
      await changed(tx);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/room/kick', ...owner, async (req, res) => {
    const input = z
      .object({ userId: uuid, reason: z.string().trim().min(5).max(200) })
      .strict()
      .parse(req.body);
    await room.leave(input.userId);
    await pool.query(
      "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'room.kick',$2)",
      [user(res).id, JSON.stringify(input)],
    );
    res.json({ ok: true });
  });
  app.post('/api/admin/live/mock', ...admin, async (req, res) => {
    await auth.limit(`mock:${user(res).id}`, 10, 60);
    res.json(await new MockLiveAdapter(live).receive(liveEventSchema.parse(req.body)));
  });
  app.post('/api/admin/tts/skip', ...admin, async (req, res) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.body);
    await pool.query(
      "UPDATE tts_jobs SET status='SKIPPED' WHERE id=$1 AND status IN ('QUEUED','GENERATING','READY','PLAYING')",
      [id],
    );
    await pool.query(
      "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'tts.skip',$2)",
      [user(res).id, JSON.stringify({ id })],
    );
    res.json({ ok: true });
  });
  app.get('/api/admin/audit', ...owner, async (_req, res) =>
    res.json({
      logs: (await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50')).rows,
    }),
  );
  app.post('/api/admin/broadcast/token', ...admin, async (_req, res) => {
    const token = randomBytes(32).toString('hex');
    await pool.query(
      "INSERT INTO broadcast_tokens VALUES($1,clock_timestamp()+interval '30 minutes',$2)",
      [digest(token), user(res).id],
    );
    res.json({ url: `/broadcast/main#token=${token}`, expiresIn: 1800 });
  });
  const broadcast: express.RequestHandler = async (req, res, next) => {
    try {
      const token = req.headers['x-broadcast-token'];
      if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(token) ||
        !(
          await pool.query(
            'SELECT 1 FROM broadcast_tokens WHERE token_hash=$1 AND expires_at>clock_timestamp()',
            [digest(token)],
          )
        ).rowCount
      )
        throw new ApiError(
          401,
          'BROADCAST_REQUIRED',
          'Phiên phát sóng đã hết hạn hoặc chưa được cấp.',
        );
      res.locals.broadcast = digest(token);
      next();
    } catch (e) {
      next(e);
    }
  };
  app.post('/api/broadcast/claim', broadcast, async (_req, res) =>
    res.json({ job: await live.claim(res.locals.broadcast) }),
  );
  app.post('/api/broadcast/complete', broadcast, async (req, res) => {
    await live.complete(z.object({ id: uuid }).strict().parse(req.body).id, res.locals.broadcast);
    res.json({ ok: true });
  });
  app.get('/api/broadcast/audio/:id', broadcast, async (req, res) => {
    const audio = await live.audio(uuid.parse(req.params.id));
    res.type('audio/mpeg').send(audio);
  });
  app.get('/api/broadcast/state/:id', broadcast, async (req, res) => {
    const job = (
      await pool.query('SELECT status FROM tts_jobs WHERE id=$1 AND claimed_by=$2', [
        uuid.parse(req.params.id),
        res.locals.broadcast,
      ])
    ).rows[0];
    res.json({ status: job?.status ?? 'COMPLETED' });
  });
  app.use('/api', (_req, res) =>
    res.status(404).json({ code: 'NOT_FOUND', error: 'Không tìm thấy chức năng này.' }),
  );
  app.use((e: any, _req: Request, res: Response, _next: express.NextFunction) => {
    if (e instanceof ApiError) {
      res.status(e.status).json({ code: e.code, error: e.message });
      return;
    }
    if (e instanceof z.ZodError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        error: 'Dữ liệu không hợp lệ. ' + (e.issues[0]?.message ?? ''),
      });
      return;
    }
    if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large') {
      res.status(400).json({ code: 'INVALID_BODY', error: 'Dữ liệu gửi lên không hợp lệ.' });
      return;
    }
    console.error(
      JSON.stringify({
        event: 'request.failed',
        requestId: res.getHeader('X-Request-Id'),
        code: e.code ?? e.name ?? 'Error',
      }),
    );
    res.status(503).json({
      code: 'SERVICE_UNAVAILABLE',
      error: 'Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại.',
    });
  });
  return {
    app,
    pool,
    redis,
    auth,
    room,
    live,
    cms,
    origin,
    async close() {
      if (!options.redis) await redis.quit();
      if (!options.pool) await pool.end();
    },
  };
}
