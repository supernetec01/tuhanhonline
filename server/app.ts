import { ShopAssets } from './shop-assets.js';
import { StoreService, storeProducts } from './store.js';
import { starterItems } from './store-config.js';
import { ChatService } from './chat.js';
import { EconomyService } from './economy.js';
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
import {
  ApiError,
  getSettings,
  connectDb,
  migrate,
  transaction,
  roomLock,
  changed,
  type Row,
} from './db.js';
import {
  AuthService,
  digest,
  credentials,
  registration,
  hashOptions,
  emailSchema,
  passwordSchema,
} from './auth.js';
import { RoomService } from './room.js';
import { CmsService } from './cms.js';
import { LiveService, MockLiveAdapter, ApprovedWebhookAdapter, liveEventSchema } from './live.js';
import { MediaService } from './media.js';
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

  const pool = options.pool ?? connectDb();
  const redis =
    options.redis ??
    new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? '',
    });
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
          imgSrc: ["'self'", 'data:', 'blob:'],
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
    ['/api/admin/media/upload', '/api/admin/store/assets'],
    auth.requireUser,
    auth.admin('ADMIN'),
    async (_req, _res, next) => {
      try {
        await auth.limit('media:upload', 20, 60);
        next();
      } catch (e) {
        next(e);
      }
    },
    express.json({ limit: '4mb' }),
  );
  app.use(
    '/api/admin/config/draft',
    auth.requireUser,
    auth.admin('ADMIN'),
    express.json({ limit: '128kb' }),
  );
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
  app.get('/api/catalog', async (_req, res) =>
    res.json({
      outfits: storeProducts((await getSettings(pool)).config)
        .filter((p) => ['linen', 'saffron', 'lotus', 'cloud'].includes(p.id))
        .map((p) => ({ ...p, subtitle: p.description, collection: 'Trang phục V8' })),
    }),
  );
  const authRate = async (req: Request, type: string) =>
    auth.limit(
      `${type}:ip:${digest(req.ip ?? 'unknown')}`,
      type === 'register' ? 5 : 12,
      type === 'register' ? 3600 : 900,
    );
  app.get('/api/auth/challenge', async (req, res) => {
    await auth.limit(`challenge:${digest(req.ip ?? 'unknown')}`, 20, 60);
    const id = randomUUID(),
      nonce = randomBytes(24).toString('hex');
    await redis.set(
      `signup:${id}`,
      JSON.stringify({ nonce, ip: digest(req.ip ?? 'unknown') }),
      'EX',
      300,
    );
    res.json({ id, nonce, difficulty: 3 });
  });
  app.post('/api/auth/register', async (req, res) => {
    await authRate(req, 'register');
    const input = registration.parse(req.body);
    const proof = await redis.getdel(`signup:${input.challenge.id}`);
    if (!proof)
      throw new ApiError(400, 'BOT_CHECK_FAILED', 'Thử thách đã hết hạn. Vui lòng thử lại.');
    const challenge = JSON.parse(proof);
    if (
      challenge.ip !== digest(req.ip ?? 'unknown') ||
      !digest(`${challenge.nonce}:${input.challenge.solution}`).startsWith('000')
    )
      throw new ApiError(400, 'BOT_CHECK_FAILED', 'Kiểm tra chống đăng ký tự động chưa hợp lệ.');
    const passwordHash = await argon2.hash(input.password, hashOptions),
      id = randomUUID();
    let u: Row;
    try {
      u = await transaction(pool, async (tx) => {
        const result = (
          await tx.query(
            'INSERT INTO users(id,email,password_hash,name,username) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [id, input.email || null, passwordHash, input.dharmaName, input.username],
          )
        ).rows[0];
        for (const item of [...starterItems, 'robe_pham'])
          await tx.query('INSERT INTO inventory VALUES($1,$2) ON CONFLICT DO NOTHING', [id, item]);
        await tx.query('INSERT INTO coin_ledger(user_id,amount,source) VALUES($1,$2,$3)', [
          id,
          result.coins,
          'opening:' + id,
        ]);
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
    await auth.session(id, res, req);
    res.status(201).json({ user: await auth.account(u) });
  });
  app.post('/api/auth/login', async (req, res) => {
    await authRate(req, 'login');
    const input = credentials.parse(req.body);
    const u = (
      await pool.query('SELECT * FROM users WHERE username=$1 OR email=$1', [input.identifier])
    ).rows[0];
    const accountKey = digest(u?.id ?? input.identifier);
    await auth.limit(`login:account:${accountKey}`, 8, 900);
    const valid = await argon2.verify(u?.password_hash ?? dummyHash, input.password);
    if (!u || !valid || u.banned)
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng.');
    await redis.del(`limit:login:account:${accountKey}`);
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
    if (!user(res).email)
      throw new ApiError(400, 'EMAIL_MISSING', 'Tài khoản chưa có email khôi phục.');
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
    if (
      production &&
      (process.env.MAIL_MODE !== 'smtp' || !process.env.SMTP_URL || !process.env.MAIL_FROM)
    )
      throw new ApiError(
        503,
        'RECOVERY_UNAVAILABLE',
        'Email khôi phục chưa được cấu hình trên hệ thống này.',
      );
    const { email } = z.object({ email: emailSchema }).parse(req.body);
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
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema })
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
  const store = new StoreService(pool),
    shopAssets = new ShopAssets(pool);
  app.post('/api/admin/store/assets', auth.requireUser, auth.admin('ADMIN'), async (req, res) => {
    const { data } = z
      .object({ data: z.string().max(2100000) })
      .strict()
      .parse(req.body);
    res.json(await shopAssets.upload(user(res).id, data));
  });
  app.get(
    '/api/admin/store/assets/:id',
    auth.requireUser,
    auth.admin('ADMIN'),
    async (req, res) => {
      const f = await shopAssets.file(uuid.parse(req.params.id));
      res.type(f.mime).send(f.bytes);
    },
  );
  app.get('/api/store/assets/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (!storeProducts((await getSettings(pool)).config).some((p) => p.imageId === id))
      throw new ApiError(404, 'IMAGE_MISSING', 'Ảnh chưa xuất bản.');
    const f = await shopAssets.file(id);
    res.type(f.mime).setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    res.send(f.bytes);
  });
  app.get('/api/store', async (_req, res) => res.json(await store.catalog()));
  app.get('/api/store/history', auth.requireUser, async (_req, res) =>
    res.json({ transactions: await store.history(user(res).id) }),
  );
  const account = async (id: string) =>
    auth.account((await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0]);
  app.post('/api/store/buy', auth.requireUser, async (req, res) => {
    const i = z
      .object({
        itemId: z.string().max(60),
        requestKey: uuid,
        expectedPrice: z.number().int().min(0).max(100000).optional(),
      })
      .strict()
      .parse(req.body);
    await store.buy(user(res).id, i.itemId, i.requestKey, i.expectedPrice);
    res.json({ user: await account(user(res).id) });
  });
  app.post('/api/store/equip', auth.requireUser, async (req, res) => {
    const i = z
      .object({ itemId: z.string().max(60) })
      .strict()
      .parse(req.body);
    await store.equip(user(res).id, i.itemId);
    res.json({ user: await account(user(res).id) });
  });
  app.post('/api/wardrobe/buy', auth.requireUser, async (req, res) => {
    const input = z.object({ outfitId: z.string(), requestKey: uuid }).strict().parse(req.body);
    const outfit = (await getSettings(pool)).config.shop.find((o) => o.id === input.outfitId);
    if (!outfit) throw new ApiError(404, 'OUTFIT_MISSING', 'Không tìm thấy trang phục.');
    await store.buy(user(res).id, outfit.id, input.requestKey);
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
      !storeProducts((await getSettings(pool)).config).some(
        (i) => i.category === 'robe' && i.id === outfitId,
      )
    )
      throw new ApiError(400, 'INVALID_ROBE', 'Hãy chọn pháp phục.');
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
      await tx.query(
        "UPDATE users SET equipped=$1,accessory=$2,cosmetics=jsonb_set(cosmetics,'{accessory}','\"accessory_none\"') WHERE id=$3",
        [outfitId, accessory, user(res).id],
      );
      await changed(tx);
    });
    res.json({
      user: await auth.account(
        (await pool.query('SELECT * FROM users WHERE id=$1', [user(res).id])).rows[0],
      ),
    });
  });
  const media = new MediaService(pool);
  app.post('/api/admin/media/upload', auth.requireUser, auth.admin('ADMIN'), async (req, res) => {
    const i = z
      .object({
        kind: z.enum(['voice', 'sfx', 'music']),
        title: z.string().trim().min(1).max(100),
        data: z.string().max(3400000),
      })
      .strict()
      .parse(req.body);
    res.json(await media.upload(user(res).id, i.kind, i.title, i.data));
  });
  app.get('/api/admin/media', auth.requireUser, auth.admin('ADMIN'), async (_req, res) =>
    res.json({
      assets: (
        await pool.query(
          'SELECT id,kind,title,mime,duration_ms,sha256,created_at,archived_at FROM media_assets ORDER BY created_at DESC LIMIT 500',
        )
      ).rows,
    }),
  );
  app.post('/api/admin/media/archive', auth.requireUser, auth.admin('ADMIN'), async (req, res) => {
    const { id, archived } = z.object({ id: uuid, archived: z.boolean() }).strict().parse(req.body);
    await transaction(pool, async (tx) => {
      const a = (
        await tx.query(
          'UPDATE media_assets SET archived_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE id=$1 RETURNING id',
          [id, archived],
        )
      ).rows[0];
      if (!a) throw new ApiError(404, 'MEDIA_MISSING', 'Không tìm thấy bản thu.');
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'media.archive',$2)",
        [user(res).id, JSON.stringify({ id, archived })],
      );
    });
    res.json({ ok: true });
  });
  app.get('/api/admin/media/:id', auth.requireUser, auth.admin('ADMIN'), async (req, res) => {
    const f = await media.file(uuid.parse(req.params.id));
    res.type(f.mime).send(f.bytes);
  });
  app.get('/api/media/:id', async (req, res) => {
    const id = uuid.parse(req.params.id),
      { config } = await getSettings(pool);
    if (!Object.values(config.audio).includes(id))
      throw new ApiError(404, 'MEDIA_MISSING', 'Bản thu chưa xuất bản.');
    const f = await media.file(id);
    res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    res.type(f.mime).send(f.bytes);
  });
  const chat = new ChatService(pool, redis);
  app.get('/api/chat/me', auth.requireUser, async (_req, res) =>
    res.json({
      sanctions: (
        await pool.query(
          'SELECT reason,expires_at FROM chat_sanctions WHERE user_id=$1 AND expires_at>clock_timestamp()',
          [user(res).id],
        )
      ).rows,
      appeals: (
        await pool.query(
          'SELECT id,body,status,resolution FROM chat_appeals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',
          [user(res).id],
        )
      ).rows,
    }),
  );
  app.post('/api/chat/appeal', auth.requireUser, async (req, res) => {
    await auth.limit('appeal:' + user(res).id, 3, 86400);
    const { body } = z
      .object({ body: z.string().trim().min(5).max(500) })
      .strict()
      .parse(req.body);
    await pool.query('INSERT INTO chat_appeals(id,user_id,body) VALUES($1,$2,$3)', [
      randomUUID(),
      user(res).id,
      body,
    ]);
    res.json({ ok: true });
  });
  app.get('/api/chat', async (_req, res) =>
    res.json({
      messages:
        (await getSettings(pool)).config.chat.mode === 'disabled' ? [] : await chat.history(),
    }),
  );
  app.post('/api/chat', auth.requireUser, async (req, res) => {
    await auth.limit(`chat:ip:${digest(req.ip ?? 'unknown')}`, 60, 60);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(150) })
      .strict()
      .parse(req.body);
    res.json(await chat.send(user(res).id, body));
  });
  app.post('/api/chat/report', auth.requireUser, async (req, res) => {
    await auth.limit(`chat:report:${user(res).id}`, 10, 3600);
    const { id, reason } = z
      .object({ id: uuid, reason: z.string().trim().min(5).max(200) })
      .strict()
      .parse(req.body);
    if (
      !(await pool.query("SELECT 1 FROM chat_messages WHERE id=$1 AND status='APPROVED'", [id]))
        .rowCount
    )
      throw new ApiError(404, 'CHAT_MISSING', 'Không tìm thấy tin.');
    await pool.query(
      'INSERT INTO chat_reports(message_id,reporter_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, user(res).id, reason],
    );
    res.json({ ok: true });
  });
  const moderation = [auth.requireUser, auth.admin('MODERATOR')] as const;
  app.get('/api/admin/chat/appeals', ...moderation, async (_req, res) =>
    res.json({
      appeals: (
        await pool.query(
          "SELECT a.*,u.name FROM chat_appeals a JOIN users u ON u.id=a.user_id WHERE a.status='OPEN' ORDER BY a.created_at LIMIT 100",
        )
      ).rows,
    }),
  );
  app.post('/api/admin/chat/appeals', ...moderation, async (req, res) => {
    const i = z
      .object({ id: uuid, resolution: z.string().trim().min(5).max(500), unmute: z.boolean() })
      .strict()
      .parse(req.body);
    await transaction(pool, async (tx) => {
      const a = (
        await tx.query(
          "UPDATE chat_appeals SET status='RESOLVED',resolution=$2 WHERE id=$1 AND status='OPEN' RETURNING user_id",
          [i.id, i.resolution],
        )
      ).rows[0];
      if (!a) throw new ApiError(409, 'APPEAL_CHANGED', 'Kháng nghị không còn mở.');
      if (i.unmute)
        await tx.query(
          'UPDATE chat_sanctions SET expires_at=clock_timestamp() WHERE user_id=$1 AND expires_at>clock_timestamp()',
          [a.user_id],
        );
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'chat.appeal',$2)",
        [user(res).id, JSON.stringify(i)],
      );
    });
    res.json({ ok: true });
  });
  app.get('/api/admin/chat', ...moderation, async (_req, res) =>
    res.json({
      messages: (
        await pool.query(
          "SELECT m.*,u.name,(SELECT count(*)::int FROM chat_reports r WHERE r.message_id=m.id) AS reports FROM chat_messages m JOIN users u ON u.id=m.user_id WHERE m.status='PENDING_REVIEW' OR EXISTS(SELECT 1 FROM chat_reports r WHERE r.message_id=m.id) ORDER BY m.created_at DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  app.post('/api/admin/chat/moderate', ...moderation, async (req, res) => {
    const i = z
      .object({
        id: uuid,
        status: z.enum(['APPROVED', 'REJECTED', 'DELETED']),
        reason: z.string().trim().min(5).max(200),
      })
      .strict()
      .parse(req.body);
    await chat.moderate(user(res).id, i.id, i.status, i.reason);
    res.json({ ok: true });
  });
  app.post('/api/admin/chat/mute', ...moderation, async (req, res) => {
    const i = z
      .object({
        userId: uuid,
        minutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]),
        reason: z.string().trim().min(5).max(200),
      })
      .strict()
      .parse(req.body);
    await transaction(pool, async (tx) => {
      await tx.query(
        "INSERT INTO chat_sanctions(id,user_id,actor_id,reason,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+$5*interval '1 minute')",
        [randomUUID(), i.userId, user(res).id, i.reason, i.minutes],
      );
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,after_json) VALUES($1,'chat.mute',$2)",
        [user(res).id, JSON.stringify(i)],
      );
    });
    res.json({ ok: true });
  });
  const economy = new EconomyService(pool);
  app.get('/api/journal', auth.requireUser, async (_req, res) =>
    res.json(await economy.journal(user(res).id)),
  );
  app.get('/api/leaderboards', async (req, res) =>
    res.json(await economy.ranks((await auth.currentUser(req))?.id)),
  );
  app.post('/api/wardrobe/dots', auth.requireUser, async (req, res) => {
    const input = z
      .object({ pair: z.number().int().min(1).max(4), requestKey: uuid })
      .strict()
      .parse(req.body);
    await economy.buyDots(user(res).id, input.pair, input.requestKey);
    res.json({
      user: await auth.account(
        (await pool.query('SELECT * FROM users WHERE id=$1', [user(res).id])).rows[0],
      ),
    });
  });
  app.get('/api/prayers', auth.requireUser, async (_req, res) =>
    res.json({
      templates: (await getSettings(pool)).config.prayerTemplates,
      selected:
        (await pool.query('SELECT template FROM prayers WHERE user_id=$1', [user(res).id])).rows[0]
          ?.template ?? null,
    }),
  );
  app.post('/api/prayers', auth.requireUser, async (req, res) => {
    const { template } = z
      .object({ template: z.string().max(120) })
      .strict()
      .parse(req.body);
    if (!(await getSettings(pool)).config.prayerTemplates.includes(template))
      throw new ApiError(400, 'PRAYER_TEMPLATE', 'Hãy chọn lời nguyện có sẵn.');
    await pool.query(
      'INSERT INTO prayers(user_id,template) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET template=EXCLUDED.template,updated_at=clock_timestamp()',
      [user(res).id, template],
    );
    res.json({ ok: true });
  });
  app.get('/api/room', async (_req, res) => res.json(await room.snapshot()));
  app.get('/api/room/me', async (req, res) => {
    const current = await auth.currentUser(req);
    res.json({
      wallet: current ? { coins: current.coins, merit: current.merit, dots: current.dots } : null,
      entry: current ? await room.myEntry(current.id) : null,
      action: current ? await room.myAction(current.id) : null,
      completedAction: current
        ? ((
            await pool.query(
              "SELECT id,type,ends_at FROM ritual_actions WHERE user_id=$1 AND status='COMPLETED' ORDER BY ends_at DESC,sequence DESC LIMIT 1",
              [current.id],
            )
          ).rows[0] ?? null)
        : null,
      coinReward: current
        ? ((
            await pool.query(
              "SELECT id::text,created_at FROM coin_ledger WHERE user_id=$1 AND source LIKE 'minute:%' ORDER BY id DESC LIMIT 1",
              [current.id],
            )
          ).rows[0] ?? null)
        : null,
    });
  });
  app.get('/api/waitlist/me', auth.requireUser, async (_req, res) =>
    res.json({ entry: await room.myEntry(user(res).id) }),
  );
  app.post('/api/room/join', auth.requireUser, async (req, res) => {
    const input = command
      .extend({ seatId: z.number().int().min(1).max(72).optional() })
      .parse(req.body);
    res.json({ entry: await room.join(user(res).id, input.requestKey, input.seatId) });
  });
  app.post('/api/room/leave', auth.requireUser, async (_req, res) => {
    await room.leave(user(res).id);
    res.json({ ok: true });
  });
  app.post('/api/room/heartbeat', auth.requireUser, async (_req, res) => {
    await room.heartbeat(user(res).id);
    res.json({ ok: true });
  });
  app.post('/api/waitlist/accept', auth.requireUser, async (_req, res) => {
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
    app.post(`/api/actions/${type}`, auth.requireUser, async (req, res) =>
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
      required: u.role !== 'ADMIN',
      active: u.role === 'ADMIN' || (!!u.admin_until && new Date(u.admin_until) > new Date()),
    });
  });
  app.post('/api/admin/mfa/enroll', auth.requireUser, async (_req, res) => {
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
      totp.label = u.username ?? u.email ?? u.id;
      return { secret: generated, uri: totp.toString() };
    });
    res.json(result);
  });
  app.post('/api/admin/mfa/verify', auth.requireUser, async (req, res) => {
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
    const asset = (
      await pool.query(
        'SELECT m.mime FROM tts_jobs j JOIN media_assets m ON m.id=j.asset_id WHERE j.id=$1',
        [req.params.id],
      )
    ).rows[0];
    res.type(asset?.mime ?? 'audio/mpeg').send(audio);
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
