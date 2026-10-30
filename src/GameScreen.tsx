import { useEffect, useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  UserRound,
  Volume2,
  VolumeX,
  Shirt,
  Flame,
  Heart,
  LogOut,
  X,
  Maximize2,
  Leaf,
  ArrowRight,
  Check,
} from 'lucide-react';
import { api, type User, type Outfit } from './api';
import { useTemple } from './useTemple';
import { TempleGame } from './TempleGame';
import { Experience } from './Experience';
import { Avatar, Lotus } from './Art';
type Popup =
  | 'login'
  | 'register'
  | 'account'
  | 'audio'
  | 'wardrobe'
  | 'queue'
  | 'forgot'
  | 'reset'
  | null;
export function GameScreen() {
  const [user, setUser] = useState<User | null>(null),
    [outfits, setOutfits] = useState<Outfit[]>([]),
    [popup, setPopup] = useState<Popup>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [selected, setSelected] = useState('saffron'),
    [accessory, setAccessory] = useState<'none' | 'beads' | 'lotus'>('none'),
    [front, setFront] = useState(true),
    [confirmBuy, setConfirmBuy] = useState(false),
    [quiet, setQuiet] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches),
    [muted, setMuted] = useState(false),
    [playing, setPlaying] = useState(false),
    [track, setTrack] = useState(''),
    [now, setNow] = useState(Date.now()),
    [resetToken, setResetToken] = useState('');
  const temple = useTemple(user),
    { room, entry, myAction, connected } = temple;
  const pendingSeat = useRef<number | undefined>(undefined),
    pendingJoin = useRef(false),
    dialog = useRef<HTMLDivElement>(null),
    screen = useRef<HTMLDivElement>(null),
    focusReturn = useRef<HTMLElement | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    url = useRef(''),
    busyRef = useRef(false),
    proofKey = useRef(crypto.randomUUID()),
    handledLink = useRef(false);
  busyRef.current = busy;
  const robe = outfits.find((o) => o.id === selected),
    owned = !!user?.inventory.includes(selected),
    equipped = user?.equipped === selected && user?.accessory === accessory;
  useEffect(() => {
    void Promise.all([api('/me'), api('/catalog')])
      .then(([me, c]) => {
        setUser(me.user);
        setOutfits(c.outfits);
      })
      .catch(() => setToast('Chưa kết nối được máy chủ. Vui lòng thử tải lại.'));
    audio.current = new Audio();
    audio.current.volume = 0.5;
    return () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (entry?.status === 'WAITING' || entry?.status === 'INVITED') setPopup('queue');
  }, [entry?.id, entry?.status]);
  useEffect(() => {
    setError('');
    setConfirmBuy(false);
    if (!popup) {
      focusReturn.current?.focus();
      focusReturn.current = null;
      return;
    }
    if (!focusReturn.current) focusReturn.current = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () =>
        dialog.current?.querySelector<HTMLElement>('input:not([tabindex="-1"]),button')?.focus(),
      20,
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) setPopup(null);
      if (e.key === 'Tab') {
        const list = dialog.current?.querySelectorAll<HTMLElement>(
          'input:not([tabindex="-1"]),button:not(:disabled),a[href]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', key);
    };
  }, [popup]);
  useEffect(() => {
    if (handledLink.current) return;
    handledLink.current = true;
    const params = new URLSearchParams(location.search);
    const verify = params.get('verify'),
      reset = params.get('reset');
    if (verify || reset) history.replaceState(null, '', location.pathname);
    if (reset) {
      setResetToken(reset);
      setPopup('reset');
    }
    if (verify)
      void api('/auth/verify-email', { token: verify })
        .then(async () => {
          setUser((await api('/me')).user);
          setToast('Đã xác minh email khôi phục.');
        })
        .catch((e) => setToast(e.message));
  }, []);
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
      setToast((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function chooseSeat(id?: number) {
    if (!connected || entry?.status === 'ACTIVE') return;
    if (entry) {
      setPopup('queue');
      return;
    }
    pendingSeat.current = id;
    pendingJoin.current = true;
    if (!user) {
      setPopup('register');
      return;
    }
    await run(async () => {
      const result = await api('/room/join', {
        requestKey: crypto.randomUUID(),
        ...(id ? { seatId: id } : {}),
      });
      if (result.entry.status === 'WAITING') setPopup('queue');
      else setToast('Bạn đã có chỗ. Hít thở nhẹ nhàng và trở về hiện tại.');
      await temple.refresh();
    });
  }
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      let result;
      if (popup === 'register') {
        const challenge = await api('/auth/challenge');
        let solution = 0;
        const encoder = new TextEncoder();
        while (
          !bytesToHex(sha256(encoder.encode(`${challenge.nonce}:${solution}`))).startsWith('000')
        ) {
          solution++;
          if (solution % 2000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        result = await api('/auth/register', {
          username: data.get('username'),
          dharmaName: data.get('dharmaName'),
          password: data.get('password'),
          email: data.get('email') || undefined,
          website: data.get('website') || '',
          challenge: { id: challenge.id, solution },
        });
      } else
        result = await api('/auth/login', {
          username: data.get('username'),
          password: data.get('password'),
        });
      setUser(result.user);
      setPopup(null);
      setToast(`Mừng ${result.user.dharmaName} trở về.`);
      if (pendingJoin.current) {
        pendingJoin.current = false;
        const id = pendingSeat.current;
        pendingSeat.current = undefined;
        try {
          await api('/room/join', {
            requestKey: crypto.randomUUID(),
            ...(id ? { seatId: id } : {}),
          });
        } catch (e) {
          setToast((e as Error).message);
        }
      }
    });
  }
  async function ritual(type: string) {
    await run(async () => {
      const response = await api(`/actions/${type}`, { requestKey: crypto.randomUUID() });
      if (response.action.status === 'QUEUED') setToast('Đã vào hàng chờ dâng hương.');
      await temple.refresh();
    });
  }
  async function buy() {
    if (!user) {
      setPopup('login');
      return;
    }
    if (!owned && !confirmBuy) {
      setConfirmBuy(true);
      return;
    }
    await run(async () => {
      const result = await api(
        owned ? '/wardrobe/equip' : '/wardrobe/buy',
        owned
          ? { outfitId: selected, accessory }
          : { outfitId: selected, requestKey: proofKey.current },
      );
      setUser(result.user);
      setConfirmBuy(false);
      proofKey.current = crypto.randomUUID();
      setToast(owned ? 'Đã mặc trang phục.' : 'Đã thêm áo vào tủ đồ. Chọn mặc để sử dụng.');
      await temple.refresh();
    });
  }
  return (
    <div className="single-game" ref={screen}>
      <header className="game-topbar">
        <div className="game-brand">
          <Lotus size={29} />
          <span>
            {room?.config.title ?? 'Tu Hành Online'}
            <small>MỘT NIỆM AN LÀNH</small>
          </span>
        </div>
        <div className="game-room-count">
          <span className={connected ? 'live-dot' : 'offline-dot'} />
          {room?.occupied ?? 0}/{room?.capacity ?? 36} chỗ <span>·</span> {room?.waiting ?? 0} người
          chờ
        </div>
        <div className="game-tools">
          <button
            aria-label="Tủ đồ"
            onClick={() => {
              setSelected(user?.equipped ?? 'saffron');
              setAccessory(user?.accessory ?? 'none');
              setPopup('wardrobe');
            }}
          >
            <Shirt size={19} />
            <span>Tủ đồ</span>
          </button>
          <button aria-label="Âm thanh" onClick={() => setPopup('audio')}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            <span>Âm thanh</span>
          </button>
          <button aria-label="Tài khoản" onClick={() => setPopup(user ? 'account' : 'login')}>
            <UserRound size={19} />
            <span>{user?.dharmaName ?? 'Đăng nhập'}</span>
          </button>
          <button
            aria-label="Toàn màn hình"
            onClick={() => {
              if (!document.fullscreenElement)
                void screen.current
                  ?.requestFullscreen?.()
                  .catch(() => setToast('Thiết bị chưa hỗ trợ toàn màn hình.'));
              else void document.exitFullscreen();
            }}
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </header>
      <main className="game-stage">
        <div className="game-world">
          <TempleGame
            room={room}
            outfits={outfits}
            userId={user?.id}
            onSeat={(id) => void chooseSeat(id)}
            quiet={quiet}
          />
          <Experience room={room} />
          <div className="world-motto">
            <span />
            Bình yên trong từng hơi thở
          </div>
          {!connected && (
            <div className="game-connection" role="status">
              Đang đồng bộ với chánh điện…
            </div>
          )}
          {room?.config.announcement && (
            <div className="game-announcement">{room.config.announcement}</div>
          )}
        </div>
      </main>
      <footer className="game-dock">
        <div className="dock-presence">
          <span>
            {entry?.status === 'ACTIVE'
              ? `Đang ngồi · ${entry.seat_code ?? 'Đệm của bạn'}`
              : entry
                ? 'Đang chờ nhận chỗ'
                : 'Chọn một đệm trống để bắt đầu'}
          </span>
          <small>
            {myAction?.status === 'QUEUED'
              ? 'Đang chờ dâng hương'
              : 'Chỗ ngồi miễn phí · Trang phục chỉ thay đổi diện mạo'}
          </small>
        </div>
        <div className="dock-actions">
          <button onClick={() => setPopup('audio')}>
            <Volume2 size={23} />
            <span>Nghe kinh</span>
          </button>
          <button
            disabled={
              !temple.sitting || !!myAction || busy || !connected || !room?.config.actionsEnabled
            }
            onClick={() => void ritual('bow')}
          >
            <Lotus size={25} />
            <span>Vái</span>
          </button>
          <button
            disabled={
              !temple.sitting || !!myAction || busy || !connected || !room?.config.actionsEnabled
            }
            onClick={() => void ritual('prostrate')}
          >
            <Heart size={23} />
            <span>Lạy</span>
          </button>
          <button
            disabled={
              !temple.sitting || !!myAction || busy || !connected || !room?.config.actionsEnabled
            }
            onClick={() => void ritual('incense')}
          >
            <Flame size={23} />
            <span>Dâng hương</span>
          </button>
        </div>
        <button
          className="dock-join"
          disabled={busy || !connected}
          onClick={() =>
            entry
              ? void run(async () => {
                  await api('/room/leave', {});
                  setPopup(null);
                  await temple.refresh();
                })
              : void chooseSeat()
          }
        >
          {entry ? 'Rời phòng' : 'Vào chánh điện'}
          <ArrowRight size={16} />
        </button>
      </footer>
      {toast && (
        <div className="game-toast" role="status">
          <Leaf size={16} />
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {popup && (
        <div
          className="game-scrim"
          onClick={(e) => {
            if (e.currentTarget === e.target && !busy) setPopup(null);
          }}
        >
          <section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-dialog-title"
            className={`game-dialog dialog-${popup}`}
          >
            <button
              className="dialog-close"
              aria-label="Đóng cửa sổ"
              disabled={busy}
              onClick={() => setPopup(null)}
            >
              <X size={21} />
            </button>
            {(popup === 'login' || popup === 'register') && (
              <>
                <div className="dialog-lotus">
                  <Lotus size={42} />
                </div>
                <div className="dialog-kicker">MỘT CHỐN TRỞ VỀ</div>
                <h1 id="game-dialog-title">
                  {popup === 'register' ? 'Gieo một duyên lành' : 'Mừng bạn trở về'}
                </h1>
                <p>
                  {pendingSeat.current
                    ? 'Đăng nhập hoặc tạo tài khoản để nhận đệm vừa chọn.'
                    : 'Một khoảng lặng đang chờ bạn.'}
                </p>
                <div className="auth-tabs">
                  <button aria-pressed={popup === 'login'} onClick={() => setPopup('login')}>
                    Đăng nhập
                  </button>
                  <button aria-pressed={popup === 'register'} onClick={() => setPopup('register')}>
                    Đăng ký
                  </button>
                </div>
                <form onSubmit={authenticate}>
                  <label>
                    Tên đăng nhập
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={popup === 'register' ? 24 : 254}
                      placeholder={
                        popup === 'register'
                          ? '3–24 chữ không dấu, số hoặc _'
                          : 'Username hoặc email tài khoản cũ'
                      }
                    />
                  </label>
                  {popup === 'register' && (
                    <label>
                      Pháp danh
                      <input
                        name="dharmaName"
                        required
                        minLength={2}
                        maxLength={32}
                        autoComplete="nickname"
                        placeholder="Tên hiển thị trong chánh điện"
                      />
                    </label>
                  )}
                  <label>
                    Mật khẩu
                    <input
                      type="password"
                      name="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={popup === 'register' ? 'new-password' : 'current-password'}
                      placeholder="Ít nhất 12 ký tự"
                    />
                  </label>
                  {popup === 'register' && (
                    <>
                      <label>
                        Email khôi phục (không bắt buộc)
                        <input
                          type="email"
                          name="email"
                          autoComplete="email"
                          maxLength={254}
                          placeholder="Có thể để trống"
                        />
                      </label>
                      <label className="bot-honey" aria-hidden="true">
                        Website
                        <input name="website" tabIndex={-1} autoComplete="off" />
                      </label>
                      <p className="form-hint">
                        Không cần xác minh email để vào phòng. Nếu không thêm email, bạn chưa có
                        cách tự khôi phục khi quên mật khẩu.
                      </p>
                    </>
                  )}
                  {error && (
                    <p className="game-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="game-primary" disabled={busy}>
                    {busy
                      ? 'Đang xử lý an toàn…'
                      : popup === 'register'
                        ? 'Tạo tài khoản & bước vào'
                        : 'Đăng nhập'}
                    <ArrowRight size={17} />
                  </button>
                </form>
                {popup === 'login' && (
                  <button className="text-link" onClick={() => setPopup('forgot')}>
                    Quên mật khẩu?
                  </button>
                )}
                <p className="form-hint">Mật khẩu được băm Argon2id · Chống đăng ký tự động</p>
              </>
            )}
            {popup === 'queue' && (
              <>
                <Lotus size={40} />
                <h1 id="game-dialog-title">
                  {entry?.status === 'INVITED' ? 'Đã có chỗ cho bạn' : 'Xin chờ một duyên lành'}
                </h1>
                {entry?.status === 'INVITED' ? (
                  <>
                    <p>
                      Đệm {entry.seat_code}. Còn{' '}
                      {Math.max(
                        0,
                        Math.ceil(
                          (new Date(entry.expires_at).getTime() -
                            now -
                            (room?.clockOffsetMs ?? 0)) /
                            1000,
                        ),
                      )}{' '}
                      giây để xác nhận.
                    </p>
                    <button
                      className="game-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api('/waitlist/accept', {});
                          setPopup(null);
                          await temple.refresh();
                        })
                      }
                    >
                      Nhận chỗ ngồi
                    </button>
                  </>
                ) : (
                  <p>
                    Bạn đang ở vị trí <strong>{entry?.position ?? '…'}</strong> trong hàng chờ.
                    Chúng mình sẽ thông báo khi có chỗ trống.
                  </p>
                )}
                <p className="form-hint">
                  Mời theo thứ tự FIFO, không phụ thuộc quà LIVE hay trang phục.
                </p>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('/waitlist/cancel', {});
                      setPopup(null);
                      await temple.refresh();
                    })
                  }
                >
                  Rời hàng chờ
                </button>
              </>
            )}
            {popup === 'account' && user && (
              <>
                <div className="account-avatar">
                  <Avatar
                    front
                    outfitId={user.equipped}
                    accessory={user.accessory}
                    color={outfits.find((o) => o.id === user.equipped)?.color}
                    accent={outfits.find((o) => o.id === user.equipped)?.accent}
                  />
                </div>
                <h1 id="game-dialog-title">{user.dharmaName}</h1>
                <p>
                  @{user.username} · {user.coins} xu thử nghiệm
                </p>
                <p className="form-hint">
                  {user.hasRecoveryEmail
                    ? 'Đã lưu email khôi phục.'
                    : 'Tài khoản chưa có email khôi phục. Hãy ghi nhớ username và mật khẩu.'}
                </p>
                {user.hasRecoveryEmail && !user.verified && (
                  <button
                    className="text-link"
                    onClick={() =>
                      void run(async () => {
                        await api('/auth/resend-verification', {});
                        setToast(
                          'Đã gửi thư xác minh email khôi phục. Việc ngồi trong chánh điện không bị ảnh hưởng.',
                        );
                      })
                    }
                  >
                    Xác minh email khôi phục (tùy chọn)
                  </button>
                )}
                <button
                  className="game-primary"
                  onClick={() => {
                    setSelected(user.equipped);
                    setAccessory(user.accessory);
                    setPopup('wardrobe');
                  }}
                >
                  <Shirt size={18} />
                  Mở tủ đồ
                </button>
                {user.role !== 'USER' && (
                  <a className="text-link" href="/admin">
                    Trung tâm quản trị →
                  </a>
                )}
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('/auth/logout', {});
                      setUser(null);
                      setPopup(null);
                      setToast('Đã đăng xuất an toàn.');
                    })
                  }
                >
                  <LogOut size={15} />
                  Đăng xuất
                </button>
              </>
            )}
            {popup === 'audio' && (
              <>
                <Lotus size={39} />
                <h1 id="game-dialog-title">Lắng nghe & tĩnh tâm</h1>
                <p>
                  Chưa có bản kinh được cấp phép trong thư viện. Bạn có thể mở bản thu mình có quyền
                  sử dụng trên thiết bị này.
                </p>
                <label>
                  Chọn bản thu riêng
                  <input
                    type="file"
                    accept="audio/mpeg,audio/ogg,audio/wav"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 25_000_000) {
                        setError('Tệp tối đa 25 MB.');
                        return;
                      }
                      audio.current?.pause();
                      if (url.current) URL.revokeObjectURL(url.current);
                      url.current = URL.createObjectURL(file);
                      audio.current!.src = url.current;
                      audio.current!.loop = true;
                      setTrack(file.name);
                      setPlaying(false);
                    }}
                  />
                </label>
                {track && <p>{track}</p>}
                <button
                  className="game-primary"
                  disabled={!track}
                  onClick={() => {
                    if (playing) {
                      audio.current?.pause();
                      setPlaying(false);
                    } else
                      void audio.current
                        ?.play()
                        .then(() => setPlaying(true))
                        .catch(() => setError('Trình duyệt chưa phát được bản thu này.'));
                  }}
                >
                  {playing ? 'Tạm dừng bản thu' : 'Phát bản thu'}
                </button>
                <label>
                  Âm lượng
                  <input
                    aria-label="Âm lượng"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    defaultValue={audio.current?.volume ?? 0.5}
                    onChange={(e) => {
                      if (audio.current) audio.current.volume = Number(e.target.value);
                    }}
                  />
                </label>
                <label className="game-check">
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => {
                      setMuted(e.target.checked);
                      if (audio.current) audio.current.muted = e.target.checked;
                    }}
                  />
                  Tắt tiếng
                </label>
                <label className="game-check">
                  <input
                    type="checkbox"
                    checked={quiet}
                    onChange={(e) => setQuiet(e.target.checked)}
                  />
                  Giảm chuyển động
                </label>
                <p className="form-hint">
                  Bản thu chỉ phát tại máy bạn, không được tải lên máy chủ.
                </p>
              </>
            )}
            {popup === 'wardrobe' && (
              <>
                <div className="dialog-kicker">MỘT CHÚT RIÊNG, MỘT CHÚT BẠN</div>
                <h1 id="game-dialog-title">Tủ áo an nhiên</h1>
                <p>
                  {user
                    ? `${user.coins} xu thử nghiệm`
                    : 'Thử áo miễn phí · Đăng nhập để lưu trang phục'}
                </p>
                <div className="wardrobe-room">
                  <div className="robe-preview">
                    <Avatar
                      front={front}
                      color={robe?.color}
                      accent={robe?.accent}
                      outfitId={robe?.id}
                      accessory={accessory}
                    />
                    <h2>{robe?.name}</h2>
                    <div className="auth-tabs">
                      <button aria-pressed={front} onClick={() => setFront(true)}>
                        Mặt trước
                      </button>
                      <button aria-pressed={!front} onClick={() => setFront(false)}>
                        Mặt sau
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="game-robe-grid">
                      {outfits.map((o) => (
                        <button
                          aria-pressed={selected === o.id}
                          key={o.id}
                          onClick={() => {
                            setSelected(o.id);
                            setConfirmBuy(false);
                            proofKey.current = crypto.randomUUID();
                          }}
                        >
                          <Avatar front outfitId={o.id} color={o.color} accent={o.accent} />
                          <strong>{o.name}</strong>
                          <small>
                            {user?.inventory.includes(o.id)
                              ? 'Đã sở hữu'
                              : o.price === 0
                                ? 'Khởi đầu'
                                : `${o.price} xu`}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p className="form-hint">Phụ kiện miễn phí · Tách lớp với áo</p>
                    <div className="accessory-buttons">
                      {(
                        [
                          ['none', 'Không'],
                          ['beads', 'Chuỗi hạt'],
                          ['lotus', 'Hoa sen'],
                        ] as const
                      ).map(([id, name]) => (
                        <button
                          key={id}
                          aria-pressed={accessory === id}
                          onClick={() => setAccessory(id)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    {error && (
                      <p className="game-form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button
                      className="game-primary"
                      disabled={
                        busy || equipped || (!!user && !owned && user.coins < (robe?.price ?? 0))
                      }
                      onClick={() => void buy()}
                    >
                      {equipped ? (
                        <>
                          <Check size={17} />
                          Đang mặc
                        </>
                      ) : !user ? (
                        'Đăng nhập để sở hữu'
                      ) : owned ? (
                        'Mặc trang phục'
                      ) : user.coins < (robe?.price ?? 0) ? (
                        'Chưa đủ xu'
                      ) : confirmBuy ? (
                        `Xác nhận mua · ${robe?.price} xu`
                      ) : (
                        `Sở hữu với ${robe?.price} xu`
                      )}
                    </button>
                    <p className="form-hint">
                      Không nạp tiền thật. Không ảnh hưởng thứ tự nhận ghế.
                    </p>
                  </div>
                </div>
              </>
            )}
            {(popup === 'forgot' || popup === 'reset') && (
              <>
                <h1 id="game-dialog-title">
                  {popup === 'forgot' ? 'Tìm lại tài khoản' : 'Đặt mật khẩu mới'}
                </h1>
                <p>
                  {popup === 'forgot'
                    ? 'Dùng email đã lưu khi đăng ký. Tài khoản không có email chưa hỗ trợ tự khôi phục.'
                    : 'Liên kết có hạn và chỉ dùng được một lần.'}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      await api(
                        popup === 'forgot' ? '/auth/forgot-password' : '/auth/reset-password',
                        popup === 'forgot'
                          ? { email: data.get('email') }
                          : { token: resetToken, password: data.get('password') },
                      );
                      setPopup('login');
                      setToast(
                        popup === 'forgot'
                          ? 'Nếu email đã được lưu, hướng dẫn khôi phục sẽ được gửi.'
                          : 'Mật khẩu đã đổi. Các phiên cũ đã được thu hồi.',
                      );
                    });
                  }}
                >
                  {popup === 'forgot' ? (
                    <label>
                      Email khôi phục
                      <input name="email" type="email" required autoComplete="email" />
                    </label>
                  ) : (
                    <label>
                      Mật khẩu mới
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </label>
                  )}
                  {error && (
                    <p className="game-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="game-primary" disabled={busy}>
                    Tiếp tục
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
