import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Pool } from 'pg';
import { TOTP, Secret } from 'otpauth';
import { z } from 'zod';
import { type Request, type Response, type RequestHandler } from 'express';
import { type Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import { ApiError, transaction, type Row } from './db.js';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashOptions = { type: 2 as const, memoryCost: 65536, timeCost: 3, parallelism: 1 };
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});
export const registration = credentials
  .extend({
    name: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[\p{L}\p{N} ._-]+$/u),
  })
  .strict();
export class AuthService {
  readonly cookieName: string;
  readonly cookieOptions;
  readonly mfaKey: Buffer;
  constructor(
    readonly pool: Pool,
    readonly redis: Redis,
    readonly origin: string,
    readonly production: boolean,
    mfaKey: Buffer,
  ) {
    this.mfaKey = mfaKey;
    this.cookieName = production ? '__Host-temple_session' : 'temple_session';
    this.cookieOptions = {
      httpOnly: true,
      secure: production,
      sameSite: 'strict' as const,
      path: '/',
    };
  }
  static async key() {
    const file = process.env.ADMIN_MFA_KEY_FILE ?? '.data/mfa-key';
    await mkdir(resolve(file, '..'), { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const key = await readFile(file);
    if (key.length !== 32) throw new Error('Invalid local MFA encryption key');
    return key;
  }
  token(req: Request) {
    return (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(this.cookieName + '='))
      ?.slice(this.cookieName.length + 1);
  }
  async currentUser(req: Request): Promise<Row | null> {
    const token = this.token(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      (
        await this.pool.query(
          'SELECT u.*,s.admin_until,s.token_hash AS session_hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND NOT u.banned',
          [digest(token)],
        )
      ).rows[0] ?? null
    );
  }
  async account(u: Row) {
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      verified: !!u.verified_at,
      coins: u.coins,
      equipped: u.equipped,
      accessory: u.accessory,
      inventory: (
        await this.pool.query('SELECT outfit_id FROM inventory WHERE user_id=$1', [u.id])
      ).rows.map((r) => r.outfit_id),
    };
  }
  async session(userId: string, res: Response, req?: Request, expectedPasswordHash?: string) {
    const token = randomBytes(32).toString('hex');
    await transaction(this.pool, async (tx) => {
      const current = (
        await tx.query('SELECT password_hash,banned FROM users WHERE id=$1 FOR UPDATE', [userId])
      ).rows[0];
      if (
        !current ||
        current.banned ||
        (expectedPasswordHash && current.password_hash !== expectedPasswordHash)
      )
        throw new ApiError(
          401,
          'CREDENTIALS_CHANGED',
          'Thông tin đăng nhập đã thay đổi. Hãy thử lại.',
        );
      // Rotate any previous browser session, preventing session fixation across account switches.
      const previous = req && this.token(req);
      if (previous) await tx.query('DELETE FROM sessions WHERE token_hash=$1', [digest(previous)]);
      await tx.query('DELETE FROM sessions WHERE expires_at<=clock_timestamp()');
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '24 hours')",
        [digest(token), userId],
      );
    });
    res.cookie(this.cookieName, token, { ...this.cookieOptions, maxAge: 86400000 });
  }
  requireUser: RequestHandler = async (req, res, next) => {
    try {
      const u = await this.currentUser(req);
      if (!u) throw new ApiError(401, 'AUTH_REQUIRED', 'Bạn cần đăng nhập để tiếp tục.');
      res.locals.user = u;
      next();
    } catch (e) {
      next(e);
    }
  };
  verified: RequestHandler = (_req, res, next) => {
    if (!res.locals.user?.verified_at) {
      next(new ApiError(403, 'EMAIL_UNVERIFIED', 'Vui lòng xác minh email trước khi tham gia.'));
      return;
    }
    next();
  };
  admin(role: 'ADMIN' | 'OPERATOR' = 'OPERATOR'): RequestHandler {
    return (_req, res, next) => {
      const u = res.locals.user as Row;
      if (!u || u.role === 'USER' || (role === 'ADMIN' && u.role !== 'ADMIN')) {
        next(new ApiError(403, 'ACCESS_DENIED', 'Bạn không có quyền quản trị.'));
        return;
      }
      if (!u.verified_at || !u.admin_until || new Date(u.admin_until).getTime() <= Date.now()) {
        next(new ApiError(403, 'MFA_REQUIRED', 'Vui lòng xác thực hai bước.'));
        return;
      }
      next();
    };
  }
  async limit(key: string, max: number, seconds: number) {
    const count = (await this.redis.eval(
      "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
      1,
      `limit:${key}`,
      seconds,
    )) as number;
    if (count > max)
      throw new ApiError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhiều. Vui lòng thử lại sau.');
  }
  async mailToken(user: Row, purpose: 'verify' | 'reset') {
    const token = randomBytes(32).toString('hex');
    await this.pool.query(
      "INSERT INTO user_tokens VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 second')",
      [digest(token), user.id, purpose, purpose === 'verify' ? 86400 : 1800],
    );
    const url = `${this.origin}/?${purpose}=${token}`;
    try {
      if (process.env.MAIL_MODE === 'smtp') {
        if (!process.env.SMTP_URL || !process.env.MAIL_FROM) throw new Error('MAIL_NOT_CONFIGURED');
        await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
          from: process.env.MAIL_FROM,
          to: user.email,
          subject:
            purpose === 'verify'
              ? 'Xác minh email Tu Hành Online'
              : 'Đặt lại mật khẩu Tu Hành Online',
          text: `${purpose === 'verify' ? 'Xác minh email' : 'Đặt lại mật khẩu'}: ${url}\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
        });
      } else {
        if (this.production) throw new Error('SMTP_REQUIRED_IN_PRODUCTION');
        const dir = process.env.MAIL_OUTBOX_DIR ?? '.data/mail-outbox';
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(
          `${dir}/${Date.now()}-${randomBytes(6).toString('hex')}.json`,
          JSON.stringify({ to: user.email, purpose, url }),
          { flag: 'wx', mode: 0o600 },
        );
      }
    } catch (e) {
      await this.pool.query('DELETE FROM user_tokens WHERE token_hash=$1', [digest(token)]);
      throw e;
    }
  }
  encrypt(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.mfaKey, iv);
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
      'base64',
    );
  }
  decrypt(value: string) {
    const raw = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.mfaKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(-16));
    return Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString();
  }
  totp(secret: string) {
    return new TOTP({
      issuer: 'Tu Hành Online',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
  }
}
