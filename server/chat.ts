import { randomUUID } from 'node:crypto';
import { type Redis } from 'ioredis';
import { type Pool } from 'pg';
import { ApiError, getSettings, transaction } from './db.js';
export const normalizeChat = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export class ChatService {
  constructor(
    readonly pool: Pool,
    readonly redis?: Redis,
  ) {}
  async history() {
    const version = (await this.redis?.get('chat:version')) ?? '0',
      key = 'chat:history:' + version;
    const cached = await this.redis?.get(key);
    if (cached) return JSON.parse(cached);
    const rows = (
      await this.pool.query(
        "SELECT m.id,m.body,m.created_at,u.name FROM chat_messages m JOIN users u ON u.id=m.user_id WHERE m.status='APPROVED' ORDER BY m.created_at DESC,m.id LIMIT 50",
      )
    ).rows.reverse();
    await this.redis?.set(key, JSON.stringify(rows), 'EX', 10);
    return rows;
  }
  async send(userId: string, body: string) {
    const normalized = normalizeChat(body);
    const result = await transaction(this.pool, async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const { config } = await getSettings(tx);
      if (config.chat.mode !== 'open')
        throw new ApiError(403, 'CHAT_READ_ONLY', 'Chat đang tạm dừng gửi tin.');
      const sanction = (
        await tx.query(
          'SELECT reason,expires_at FROM chat_sanctions WHERE user_id=$1 AND expires_at>clock_timestamp() ORDER BY expires_at DESC LIMIT 1',
          [userId],
        )
      ).rows[0];
      if (sanction)
        throw new ApiError(
          403,
          'MUTE_CHAT',
          `Tạm khóa chat: ${sanction.reason}. Có thể gửi kháng nghị với quản trị viên.`,
        );
      const recent = (
        await tx.query(
          "SELECT normalized,created_at FROM chat_messages WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 minute' ORDER BY created_at DESC",
          [userId],
        )
      ).rows;
      if (
        recent.length >= 10 ||
        (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 5000)
      )
        throw new ApiError(429, 'CHAT_RATE', 'Chờ 5 giây giữa các tin, tối đa 10 tin/phút.');
      if (
        !normalized ||
        /[<>\u0000-\u001f]/.test(body) ||
        /(?:https?:|www\.|[\p{L}\d-]+\.(?:com|vn|net|org|io)\b)/iu.test(normalized)
      )
        throw new ApiError(400, 'CHAT_CONTENT', 'Không gửi liên kết, HTML hoặc ký tự điều khiển.');
      const exempt = config.chat.allowlist.some((t) => normalized === normalizeChat(t));
      const blocked =
        !exempt && config.chat.rejectedTerms.some((t) => normalized.includes(normalizeChat(t)));
      const compact = (v: string) =>
        normalizeChat(v)
          .replace(/[01345]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's' })[c]!)
          .replace(/[^a-z]/g, '');
      const suspicious =
        (!exempt &&
          config.chat.rejectedTerms.some((t) => compact(normalized).includes(compact(t)))) ||
        recent.some((r) => r.normalized === normalized) ||
        (!exempt && config.chat.reviewTerms.some((t) => normalized.includes(normalizeChat(t))));
      const status = blocked ? 'REJECTED' : suspicious ? 'PENDING_REVIEW' : 'APPROVED';
      const id = randomUUID();
      await tx.query(
        'INSERT INTO chat_messages(id,user_id,body,normalized,status,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [
          id,
          userId,
          body.normalize('NFC').trim(),
          normalized,
          status,
          blocked
            ? 'Nội dung vi phạm quy định'
            : suspicious
              ? 'Cần người kiểm duyệt xem xét'
              : null,
        ],
      );
      if (status === 'APPROVED')
        await tx.query("INSERT INTO outbox(kind,payload) VALUES('chat.message.approved',$1)", [
          JSON.stringify({ id }),
        ]);
      return { id, status };
    });
    await this.redis?.incr('chat:version');
    return result;
  }
  async moderate(actor: string, id: string, status: string, reason: string) {
    await transaction(this.pool, async (tx) => {
      const before = (await tx.query('SELECT * FROM chat_messages WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!before) throw new ApiError(404, 'CHAT_MISSING', 'Không tìm thấy tin.');
      await tx.query('UPDATE chat_messages SET status=$2,reason=$3 WHERE id=$1', [
        id,
        status,
        reason,
      ]);
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,before_json,after_json) VALUES($1,'chat.moderate',$2,$3)",
        [actor, JSON.stringify(before), JSON.stringify({ id, status, reason })],
      );
      await tx.query("INSERT INTO outbox(kind,payload) VALUES('chat.message.approved',$1)", [
        JSON.stringify({ id }),
      ]);
    });
    await this.redis?.incr('chat:version');
  }
}
