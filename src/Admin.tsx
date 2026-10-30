import { LiveEditor } from './LiveEditor';
import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { type Settings } from '../server/config';
import { Lotus, TempleArt } from './Art';
export function Admin() {
  const [user, setUser] = useState<User | null>(null),
    [mfa, setMfa] = useState<any>(null),
    [enrollment, setEnrollment] = useState<any>(null),
    [code, setCode] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [state, setState] = useState<any>(null),
    [config, setConfig] = useState<Settings | null>(null),
    [dashboard, setDashboard] = useState<any>(null),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [broadcast, setBroadcast] = useState('');
  async function load() {
    const d = await api('/admin/dashboard');
    setDashboard(d);
    if (user?.role === 'ADMIN') {
      const s = await api('/admin/config');
      setState(s);
      setConfig(s.draft?.config ?? s.published.config);
      setDirty(false);
    }
  }
  useEffect(() => {
    api('/me')
      .then(async ({ user }) => {
        setUser(user);
        if (user && user.role !== 'USER') setMfa(await api('/admin/mfa/status'));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (mfa?.active) void run(load);
  }, [mfa?.active, user?.id]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (config) {
      setConfig({ ...config, [key]: value });
      setDirty(true);
    }
  }
  return (
    <main className="admin-page">
      <header className="admin-heading">
        <a href="/">
          <Lotus /> Tu Hành Online
        </a>
        <span>TRUNG TÂM ĐIỀU HÀNH</span>
        <a href="/">Trở về chánh điện →</a>
      </header>
      <h1>Quản trị chánh điện</h1>
      <p className="admin-intro">
        Tài khoản có quyền quản trị và mã xác thực hai bước mới được thay đổi cấu hình. Mỗi thay đổi
        đều có lịch sử.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-note" role="status">
          {message}
        </p>
      )}
      {!user || user.role === 'USER' ? (
        <div className="admin-panel">
          <h2>Chưa có quyền quản trị</h2>
          <p>
            Đăng nhập tài khoản đã được chủ hệ thống cấp quyền. Không có mật khẩu quản trị mặc định.
          </p>
          <a href="/">Đến trang đăng nhập</a>
        </div>
      ) : !mfa?.active ? (
        <section className="admin-panel mfa-panel">
          <h2>Xác thực hai bước</h2>
          <p>Nhập mã 6 chữ số từ ứng dụng xác thực. Phiên quản trị có hiệu lực 15 phút.</p>
          {!mfa?.enrolled && (
            <button
              className="wardrobe-button"
              disabled={busy}
              onClick={() =>
                void run(async () => setEnrollment(await api('/admin/mfa/enroll', {})))
              }
            >
              Thiết lập ứng dụng xác thực
            </button>
          )}
          {enrollment && (
            <div className="dev-notice">
              <p>
                Thêm khóa này vào ứng dụng Authenticator. Giữ riêng khóa, không chia sẻ hoặc đưa vào
                ảnh chụp.
              </p>
              <code className="mfa-secret">{enrollment.secret}</code>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/admin/mfa/verify', { code });
                setEnrollment(null);
                setCode('');
                setMfa(await api('/admin/mfa/status'));
              });
            }}
          >
            <label>
              Mã xác thực
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </label>
            <button className="primary-button" disabled={busy}>
              Xác thực
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className="admin-stats">
            <div>
              <strong>
                {dashboard?.room.occupied ?? '—'}/{dashboard?.room.capacity ?? 36}
              </strong>
              Chỗ đang giữ
            </div>
            <div>
              <strong>{dashboard?.room.waiting ?? '—'}</strong>Người đang chờ
            </div>
            <div>
              <strong>{dashboard?.live.length ?? 0}</strong>Sự kiện gần đây
            </div>
            <div>
              <strong>{dashboard?.room.status === 'open' ? 'Đang mở' : 'Đang đóng'}</strong>Trạng
              thái phòng
            </div>
          </div>
          {user.role === 'ADMIN' && config && (
            <section className="admin-panel">
              <div className="panel-heading">
                <div>
                  <h2>Nội dung & cấu hình</h2>
                  <p>
                    {dirty
                      ? '● Có thay đổi chưa lưu'
                      : state?.draft
                        ? `Bản nháp #${state.draft.id}`
                        : `Đang xuất bản #${state?.published.id}`}
                  </p>
                </div>
                <button
                  className="subtle-button"
                  disabled={busy || dirty}
                  onClick={() => void run(load)}
                >
                  Tải lại dữ liệu
                </button>
              </div>
              <div className="admin-fields">
                <label>
                  Tên website
                  <input
                    value={config.title}
                    maxLength={60}
                    onChange={(e) => update('title', e.target.value)}
                  />
                </label>
                <label>
                  Tên phòng
                  <input
                    value={config.roomName}
                    maxLength={60}
                    onChange={(e) => update('roomName', e.target.value)}
                  />
                </label>
                <label className="wide">
                  Dòng giới thiệu
                  <input
                    value={config.tagline}
                    maxLength={120}
                    onChange={(e) => update('tagline', e.target.value)}
                  />
                </label>
                <label className="wide">
                  Thông báo
                  <input
                    value={config.announcement}
                    maxLength={200}
                    onChange={(e) => update('announcement', e.target.value)}
                  />
                </label>
                {(
                  [
                    ['capacity', 'Sức chứa tối đa', 1, 36],
                    ['sessionMinutes', 'Thời lượng phiên (phút)', 5, 120],
                    ['invitationSeconds', 'Hạn lời mời (giây)', 15, 120],
                    ['graceSeconds', 'Giữ chỗ khi mất kết nối (giây)', 30, 300],
                    ['bowCooldown', 'Chờ giữa hai lần vái (giây)', 3, 60],
                    ['prostrateCooldown', 'Chờ giữa hai lần lạy (giây)', 5, 120],
                    ['incenseCooldown', 'Chờ giữa hai lần dâng hương (giây)', 30, 600],
                    ['incenseDuration', 'Thời lượng dâng hương (giây)', 5, 30],
                    ['ttsInterval', 'Khoảng cách lời chúc (giây)', 10, 120],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={config[key]}
                      onChange={(e) => update(key, Number(e.target.value))}
                    />
                  </label>
                ))}
                <label className="wide">
                  Lời chúc (dùng {'{name}'} cho tên đã kiểm duyệt)
                  <textarea
                    value={config.blessing}
                    maxLength={240}
                    onChange={(e) => update('blessing', e.target.value)}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={config.actionsEnabled}
                    onChange={(e) => update('actionsEnabled', e.target.checked)}
                  />
                  Cho phép nghi lễ
                </label>
              </div>
              <details>
                <summary>Sơ đồ 36 ghế · kéo để chỉnh, nhấp đôi để bật/tắt</summary>
                <p>Thay đổi sơ đồ/sức chứa chỉ được xuất bản khi phòng không còn người giữ ghế.</p>
                <div
                  className="layout-editor"
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    const id = Number(e.currentTarget.dataset.dragSeat),
                      rect = e.currentTarget.getBoundingClientRect();
                    update(
                      'seatLayout',
                      config.seatLayout.map((s) =>
                        s.id === id
                          ? {
                              ...s,
                              x: Math.max(
                                5,
                                Math.min(95, ((e.clientX - rect.left) / rect.width) * 100),
                              ),
                              y: Math.max(
                                48,
                                Math.min(94, ((e.clientY - rect.top) / rect.height) * 100),
                              ),
                            }
                          : s,
                      ),
                    );
                  }}
                  onPointerUp={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                >
                  <TempleArt />
                  {config.seatLayout.map((s) => (
                    <button
                      key={s.id}
                      style={{ left: `${s.x}%`, top: `${s.y}%` }}
                      className={s.enabled ? '' : 'disabled-seat'}
                      aria-label={`Ghế ${s.id}, ${s.enabled ? 'bật' : 'tắt'}`}
                      onDoubleClick={() =>
                        update(
                          'seatLayout',
                          config.seatLayout.map((r) =>
                            r.id === s.id ? { ...r, enabled: !r.enabled } : r,
                          ),
                        )
                      }
                      onPointerDown={(e) => {
                        const editor = e.currentTarget.parentElement!;
                        editor.dataset.dragSeat = String(s.id);
                        editor.setPointerCapture(e.pointerId);
                      }}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
                <label>
                  Chọn ghế để chỉnh bằng bàn phím
                  <select
                    onChange={(e) => {
                      const row = config.seatLayout.find((s) => s.id === Number(e.target.value));
                      if (row) document.getElementById(`seat-${row.id}`)?.focus();
                    }}
                  >
                    <option value="">Chọn ghế</option>
                    {config.seatLayout.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="seat-inputs">
                  {config.seatLayout.map((s) => (
                    <label key={s.id}>
                      Ghế {s.id}
                      <input
                        id={`seat-${s.id}`}
                        aria-label={`Tọa độ ngang ghế ${s.id}`}
                        type="number"
                        min="5"
                        max="95"
                        step=".1"
                        value={s.x}
                        onChange={(e) =>
                          update(
                            'seatLayout',
                            config.seatLayout.map((r) =>
                              r.id === s.id ? { ...r, x: Number(e.target.value) } : r,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Tọa độ dọc ghế ${s.id}`}
                        type="number"
                        min="48"
                        max="94"
                        step=".1"
                        value={s.y}
                        onChange={(e) =>
                          update(
                            'seatLayout',
                            config.seatLayout.map((r) =>
                              r.id === s.id ? { ...r, y: Number(e.target.value) } : r,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Kích thước ghế ${s.id}`}
                        type="number"
                        min="4"
                        max="12"
                        step=".1"
                        value={s.scale}
                        onChange={(e) =>
                          update(
                            'seatLayout',
                            config.seatLayout.map((r) =>
                              r.id === s.id ? { ...r, scale: Number(e.target.value) } : r,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Bật ghế ${s.id}`}
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) =>
                          update(
                            'seatLayout',
                            config.seatLayout.map((r) =>
                              r.id === s.id ? { ...r, enabled: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
              <LiveEditor value={config.live} onChange={(value) => update('live', value)} />
              <div className="admin-actions">
                <button className="subtle-button" onClick={() => setPreview(!preview)}>
                  Xem trước bản nháp
                </button>
                <button
                  disabled={busy || !dirty}
                  onClick={() =>
                    void run(async () => {
                      await api('/admin/config/draft', {
                        config,
                        expectedId: state.draft?.id ?? null,
                      });
                      await load();
                      setMessage('Đã lưu bản nháp. Người chơi chưa thấy thay đổi.');
                    })
                  }
                >
                  Lưu bản nháp
                </button>
                <button
                  className="primary-button"
                  disabled={busy || dirty || !state.draft}
                  onClick={() =>
                    void run(async () => {
                      await api('/admin/config/publish', { id: state.draft.id });
                      await load();
                      setMessage('Đã xuất bản cấu hình.');
                    })
                  }
                >
                  Xuất bản
                </button>
              </div>
              {preview && (
                <div className="config-preview">
                  <h3>
                    {config.title} · {config.roomName}
                  </h3>
                  <p>{config.tagline}</p>
                  <p>{config.announcement}</p>
                  <p>
                    {config.capacity} chỗ · Phiên {config.sessionMinutes} phút
                  </p>
                </div>
              )}
              <details>
                <summary>Lịch sử & khôi phục</summary>
                {state?.revisions.map((r: any) => (
                  <div key={r.id} className="revision-row">
                    <span>
                      #{r.id} · {r.status} · {new Date(r.created_at).toLocaleString('vi-VN')}
                    </span>
                    <button
                      disabled={busy || dirty || r.status !== 'archived'}
                      onClick={() =>
                        void run(async () => {
                          await api('/admin/config/rollback', { id: r.id });
                          await load();
                          setMessage('Đã khôi phục thành phiên bản xuất bản mới.');
                        })
                      }
                    >
                      Khôi phục
                    </button>
                  </div>
                ))}
              </details>
              <button
                className="subtle-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api('/admin/room/status', {
                      status: dashboard.room.status === 'open' ? 'closed' : 'open',
                    });
                    await load();
                  })
                }
              >
                {dashboard?.room.status === 'open'
                  ? 'Tạm đóng nhận người mới'
                  : 'Mở lại nhận người'}
              </button>
            </section>
          )}
          <section className="admin-panel">
            <h2>TikTok LIVE & lời chúc</h2>
            <p>
              Hiện chưa kết nối TikTok thật. Mô phỏng bên dưới không nhận tiền, không cấp chỗ và
              không thay đổi hàng chờ.
            </p>
            <form
              className="mock-form"
              id="mock-gift-form"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  await api('/admin/live/mock', {
                    liveId: 'mock-session',
                    sourceEventId: crypto.randomUUID(),
                    senderId: 'demo-sender',
                    displayName: data.get('name'),
                    giftId: data.get('gift') ?? 'rose',
                    count: Number(data.get('count')),
                  });
                  await load();
                  setMessage('Đã tiếp nhận sự kiện mô phỏng; worker sẽ chuẩn bị lời chúc.');
                });
              }}
            >
              <label>
                Tên hiển thị
                <input name="name" defaultValue="Một người hữu duyên" maxLength={32} required />
              </label>
              <label>
                Số hoa hồng
                <input name="count" type="number" defaultValue="1" min="1" max="100" required />
              </label>
              <button className="primary-button" disabled={busy}>
                Mô phỏng nhận quà
              </button>
            </form>
            <button
              className="wardrobe-button"
              disabled={busy}
              onClick={() =>
                void run(async () => setBroadcast((await api('/admin/broadcast/token', {})).url))
              }
            >
              Tạo phiên màn hình OBS · 30 phút
            </button>
            {broadcast && (
              <a
                className="broadcast-link"
                href={broadcast}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở màn hình phát sóng 9:16 →
              </a>
            )}
            <p className="dev-notice">
              Chế độ mặc định chỉ hiển thị lời chúc. Giọng thiết bị là tùy chọn thử nghiệm; giọng AI
              qua dịch vụ chỉ chạy khi cấu hình TTS thật. Hướng dẫn nguồn sự kiện có chữ ký và TTS ở
              docs/LIVE.md.
            </p>
            <label>
              Loại quà thử
              <select name="gift" form="mock-gift-form">
                <option value="rose">Hoa sen (rose)</option>
                <option value="lantern">Đèn bình an</option>
                <option value="incense">Khói hương</option>
              </select>
            </label>
            <button
              className="wardrobe-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api('/admin/ceremonies/test', {});
                  setMessage('Đã bắt đầu thời khắc bình an 60 giây.');
                })
              }
            >
              Diễn tập thiền chung 60 giây
            </button>
            <button
              className="subtle-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const stats = await api('/admin/live/analytics');
                  setMessage(
                    `Sự kiện: ${stats.received_events} · Quà: ${stats.gifts} · TTS lỗi: ${stats.failed_tts} · p95 chờ đọc: ${stats.tts_p95_seconds ?? 'chưa có'} giây. Không có số lượt xem TikTok.`,
                  );
                })
              }
            >
              Xem thống kê đo được
            </button>
            <h3>Hàng chờ lời chúc</h3>
            {dashboard?.tts.map((job: any) => (
              <div className="tts-row" key={job.id}>
                <span>
                  {job.text}
                  <small>
                    {job.status} · {job.mode} {job.error_code ? `· ${job.error_code}` : ''}
                  </small>
                </span>
                <button
                  disabled={
                    busy || !['QUEUED', 'GENERATING', 'READY', 'PLAYING'].includes(job.status)
                  }
                  onClick={() =>
                    void run(async () => {
                      await api('/admin/tts/skip', { id: job.id });
                      await load();
                    })
                  }
                >
                  Bỏ qua
                </button>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
