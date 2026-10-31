import { useEffect, useState } from 'react';
import { api, type User } from './api';
export function ChatPanel({ user, version }: { user: User | null; version: number }) {
  const [messages, setMessages] = useState<any[]>([]),
    [body, setBody] = useState(''),
    [notice, setNotice] = useState(''),
    [onlySystem, setOnlySystem] = useState(false),
    [busy, setBusy] = useState(false);
  const [sanctions, setSanctions] = useState<any[]>([]);
  async function load() {
    try {
      setMessages((await api('/chat')).messages);
      if (user) setSanctions((await api('/chat/me')).sanctions);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [version]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <h1 id="game-dialog-title">Chat chánh điện</h1>
      {sanctions.map((s, i) => (
        <p key={i}>
          Tạm khóa chat: {s.reason} · đến {new Date(s.expires_at).toLocaleString('vi-VN')}
        </p>
      ))}
      {user && (
        <button
          onClick={() => {
            const body = window.prompt('Nội dung kháng nghị (5–500 ký tự)');
            if (body)
              void api('/chat/appeal', { body })
                .then(() => setNotice('Đã gửi kháng nghị.'))
                .catch((e) => setNotice(e.message));
          }}
        >
          Gửi kháng nghị kiểm duyệt
        </button>
      )}
      <p>Người tu và người chờ cùng trò chuyện. Mở chat không dừng thời gian tu.</p>
      <label>
        <input
          type="checkbox"
          checked={onlySystem}
          onChange={(e) => setOnlySystem(e.target.checked)}
        />{' '}
        Chỉ thông báo hệ thống
      </label>
      <div className="chat-history" aria-live="polite">
        {!onlySystem &&
          messages.map((m) => (
            <article key={m.id}>
              <strong>{m.name}</strong>
              <p>{m.body}</p>
              {user && (
                <button
                  onClick={() => {
                    const reason = window.prompt('Lý do báo cáo (ít nhất 5 ký tự)');
                    if (reason)
                      void api('/chat/report', { id: m.id, reason })
                        .then(() => setNotice('Đã gửi báo cáo.'))
                        .catch((e) => setNotice(e.message));
                  }}
                >
                  Báo cáo
                </button>
              )}
            </article>
          ))}
      </div>
      {user ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void api('/chat', { body })
              .then(async (r) => {
                setBody('');
                setNotice(
                  r.status === 'APPROVED'
                    ? 'Đã gửi'
                    : r.status === 'PENDING_REVIEW'
                      ? 'Tin đang chờ kiểm duyệt.'
                      : 'Tin bị từ chối theo quy định.',
                );
                await load();
              })
              .catch((e) => setNotice(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Tin nhắn
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={150}
            />
          </label>
          <button className="game-primary" disabled={busy}>
            Gửi
          </button>
        </form>
      ) : (
        <p>Đăng nhập để gửi tin.</p>
      )}
      <p role="status">{notice}</p>
    </>
  );
}
export function ProgressPanel({
  kind,
  user,
  onUser,
}: {
  kind: string;
  user: User | null;
  onUser: (u: User) => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  const path =
    kind === 'journal'
      ? '/journal'
      : kind === 'prayers'
        ? '/prayers'
        : kind === 'dots'
          ? '/room'
          : '/leaderboards';
  useEffect(() => {
    setData(null);
    setError('');
    void api(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path]);
  return (
    <>
      <h1 id="game-dialog-title">
        {
          (
            {
              journal: 'Nhật ký tu hành',
              prayers: 'Lời nguyện bình an',
              dots: 'Chấm sáng trang trí',
              ranks: 'Công đức & Tri ân LIVE',
            } as Record<string, string>
          )[kind]
        }
      </h1>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Đang tải…</p>
      ) : kind === 'journal' ? (
        <>
          <p>
            {data.cultivated_minutes} phút tu hợp lệ · {data.coins} xu · {data.merit} công đức
          </p>
          <p>
            Vái: {data.rituals.bow ?? 0} · Lạy: {data.rituals.prostrate ?? 0} · Dâng hương:{' '}
            {data.rituals.incense ?? 0}
          </p>
          <p>Chỉ tính phút khi có ghế hợp lệ. Giới hạn xu tính theo ngày giờ Việt Nam.</p>
        </>
      ) : kind === 'prayers' ? (
        <>
          {data.templates.map((t: string) => (
            <button
              key={t}
              className="game-primary"
              onClick={() =>
                void api('/prayers', { template: t })
                  .then(() => setData({ ...data, selected: t }))
                  .catch((e) => setError(e.message))
              }
            >
              {data.selected === t ? '✓ ' : ''}
              {t}
            </button>
          ))}
        </>
      ) : kind === 'dots' ? (
        <>
          <p>
            Phụ kiện hình chấm sáng, không biểu thị cấp bậc tôn giáo. Bạn đã mở {user?.dots ?? 0}/8
            chấm.
          </p>
          {data.config.dotPrices.map((price: number, i: number) => (
            <button
              key={i}
              className="game-primary"
              disabled={!user || (user.dots ?? 0) !== i * 2 || user.coins < price}
              onClick={() =>
                void api('/wardrobe/dots', { pair: i + 1, requestKey: crypto.randomUUID() })
                  .then((r) => onUser(r.user))
                  .catch((e) => setError(e.message))
              }
            >
              Cặp {i + 1}: {price} xu
            </button>
          ))}
        </>
      ) : (
        <>
          <h2>Công đức tu hành</h2>
          <p>Snapshot 5 phút/lần · Hạng của bạn: {data.mine?.rank ?? 'chưa có'}</p>
          <ol>
            {data.merit.map((r: any) => (
              <li key={r.id}>
                {r.name}: {r.merit} công đức
              </li>
            ))}
          </ol>
          <h2>Tri Ân LIVE</h2>
          <p>{data.liveUnit} · Không đổi thành xu, công đức hoặc ưu tiên ghế.</p>
          <ol>
            {data.live.map((r: any) => (
              <li key={r.provider + ':' + r.sender_key}>
                {r.name}: {r.gifts} quà ({r.provider})
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
export function ModerationPanel() {
  const [appeals, setAppeals] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]),
    [error, setError] = useState('');
  async function load() {
    try {
      setMessages((await api('/admin/chat')).messages);
      setAppeals((await api('/admin/chat/appeals')).appeals);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(m: any, status: string) {
    const reason = window.prompt('Lý do kiểm duyệt (ít nhất 5 ký tự)');
    if (!reason) return;
    try {
      await api('/admin/chat/moderate', { id: m.id, status, reason });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="admin-panel">
      <h2>Kiểm duyệt chat</h2>
      {appeals.map((a) => (
        <article key={a.id}>
          <strong>Kháng nghị · {a.name}</strong>
          <p>{a.body}</p>
          {[false, true].map((unmute) => (
            <button
              key={String(unmute)}
              onClick={() => {
                const resolution = window.prompt('Trả lời kháng nghị (ít nhất 5 ký tự)');
                if (resolution)
                  void api('/admin/chat/appeals', { id: a.id, resolution, unmute })
                    .then(load)
                    .catch((e) => setError(e.message));
              }}
            >
              {unmute ? 'Gỡ mute và trả lời' : 'Trả lời và đóng'}
            </button>
          ))}
        </article>
      ))}
      <p role="status">{error}</p>
      <button onClick={() => void load()}>Tải lại</button>
      {messages.map((m) => (
        <article key={m.id}>
          <strong>
            {m.name} · {m.status} · {m.reports} báo cáo
          </strong>
          <p>{m.body}</p>
          {['APPROVED', 'REJECTED', 'DELETED'].map((s, i) => (
            <button key={s} onClick={() => void act(m, s)}>
              {['Duyệt', 'Từ chối', 'Xóa'][i]}
            </button>
          ))}
          {[10, 60, 1440].map((minutes) => (
            <button
              key={minutes}
              onClick={() => {
                const reason = window.prompt('Lý do tạm khóa chat');
                if (reason)
                  void api('/admin/chat/mute', { userId: m.user_id, minutes, reason })
                    .then(() => setError('Đã khóa chat; ghế và ví không bị ảnh hưởng.'))
                    .catch((e) => setError(e.message));
              }}
            >
              Mute {minutes} phút
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}
