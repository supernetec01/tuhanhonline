import { Experience } from './Experience';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Coins,
  Flame,
  Headphones,
  Heart,
  Leaf,
  LockKeyhole,
  LogOut,
  Maximize2,
  Menu,
  ShieldCheck,
  Shirt,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/lora/vietnamese-400.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/vietnamese-400-italic.css';
import '@fontsource/lora/latin-400-italic.css';
import { Avatar, Lotus, TempleArt } from './Art';
import { api, type User, type Outfit } from './api';
import { useTemple } from './useTemple';
import { Seats } from './Seats';
import { Admin } from './Admin';
import { Broadcast } from './Broadcast';
import './styles.css';
import './upgrade.css';
import './experience.css';

type Modal = 'wardrobe' | 'login' | 'register' | 'guide' | 'security' | 'forgot' | 'reset' | null;

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState('saffron');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const temple = useTemple(user);
  const { room, entry, myAction, sitting, connected } = temple;
  const action = myAction ? (myAction.status === 'QUEUED' ? 'queued' : myAction.type) : 'idle';
  const [accessory, setAccessory] = useState<'none' | 'beads' | 'lotus'>('none');
  const [frontView, setFrontView] = useState(true);
  const [resetToken, setResetToken] = useState('');
  const [quiet, setQuiet] = useState(false);
  const [filter, setFilter] = useState('Tất cả');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const handledLink = useRef(false);
  const roomBusy = useRef(false);
  const purchaseKey = useRef(crypto.randomUUID());
  useEffect(() => {
    Promise.all([api('/me'), api('/catalog')])
      .then(([me, catalog]) => {
        setUser(me.user);
        setOutfits(catalog.outfits);
      })
      .catch(() => setToast('Chưa kết nối được máy chủ. Vui lòng tải lại trang.'));
  }, []);
  useEffect(() => {
    if (handledLink.current) return;
    handledLink.current = true;
    const query = new URLSearchParams(location.search);
    const verify = query.get('verify'),
      reset = query.get('reset');
    if (verify || reset) history.replaceState(null, '', location.pathname);
    if (verify)
      api('/auth/verify-email', { token: verify })
        .then(async () => {
          setUser((await api('/me')).user);
          setToast('Đã xác minh email. Bạn có thể tham gia chánh điện.');
        })
        .catch((e) => setToast(e.message));
    if (reset) {
      setResetToken(reset);
      setModal('reset');
    }
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    setError('');
    setConfirmBuy(false);
    if (!modal) {
      previousFocus.current?.focus();
      previousFocus.current = null;
      return;
    }
    if (modal === 'wardrobe') setAccessory(user?.accessory ?? 'none');
    if (!previousFocus.current) previousFocus.current = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = setTimeout(
      () => dialogRef.current?.querySelector<HTMLElement>('button, input')?.focus(),
      20,
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setModal(null);
      if (event.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, a[href], [tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.body.style.overflow = old;
      window.removeEventListener('keydown', onKey);
    };
  }, [modal]);
  const outfit = outfits.find((o) => o.id === user?.equipped) ?? outfits[0];
  const preview = outfits.find((o) => o.id === selected) ?? outfits[0];
  const owned = user?.inventory.includes(selected);
  useEffect(() => {
    if (room?.config.title) document.title = `${room.config.title} · Một chốn an yên`;
  }, [room?.config.title]);
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const data = await api(`/auth/${modal}`, {
        email: form.get('email'),
        password: form.get('password'),
        ...(modal === 'register' ? { name: form.get('name') } : {}),
      });
      setUser(data.user);
      setModal(null);
      setToast(
        modal === 'register'
          ? 'Tài khoản đã tạo và nhận 300 xu thử nghiệm. Hãy xác minh email trước khi vào chánh điện.'
          : 'Mừng bạn trở về. Chúc bạn một ngày an yên.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function purchaseOrEquip() {
    if (!user) {
      setModal('login');
      return;
    }
    if (!preview) return;
    if (!owned && !confirmBuy) {
      setConfirmBuy(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api(
        owned ? '/wardrobe/equip' : '/wardrobe/buy',
        owned
          ? { outfitId: selected, accessory }
          : { outfitId: selected, requestKey: purchaseKey.current },
      );
      setUser(data.user);
      setConfirmBuy(false);
      purchaseKey.current = crypto.randomUUID();
      setToast(
        owned
          ? 'Đã mặc trang phục. Bạn có thể trở lại chánh điện.'
          : 'Đã thêm trang phục vào tủ áo. Chọn “Mặc trang phục” để sử dụng.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeSeat() {
    if (!user) {
      setModal('login');
      return;
    }
    if (roomBusy.current) return;
    roomBusy.current = true;
    try {
      if (entry) await api('/room/leave', {});
      else await api('/room/join', { requestKey: crypto.randomUUID() });
      await temple.refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      roomBusy.current = false;
    }
  }
  async function ritual(type: string) {
    if (!sitting || roomBusy.current) return;
    roomBusy.current = true;
    try {
      const data = await api(`/actions/${type}`, { requestKey: crypto.randomUUID() });
      if (data.action.status === 'QUEUED') setToast('Đã vào hàng chờ dâng hương.');
      await temple.refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      roomBusy.current = false;
    }
  }
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label="Tu Hành Online, trang chủ">
          <span className="brand-icon">
            <Lotus size={33} />
          </span>
          <span>
            {room?.config.title && room.config.title !== 'Tu Hành Online' ? (
              room.config.title
            ) : (
              <>
                Tu Hành <b>Online</b>
              </>
            )}
            <small>MỘT CHỐN AN YÊN</small>
          </span>
        </a>
        <button
          className="mobile-menu icon-button"
          aria-label="Mở menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu size={22} />
        </button>
        <nav className={menuOpen ? 'open' : ''} aria-label="Điều hướng chính">
          <button
            className="nav-active"
            onClick={() => {
              setModal(null);
              setMenuOpen(false);
            }}
          >
            Chánh điện
          </button>
          <button
            onClick={() => {
              setModal('wardrobe');
              setMenuOpen(false);
            }}
          >
            Tủ áo <span className="new-dot" />
          </button>
          <button
            onClick={() => {
              setModal('guide');
              setMenuOpen(false);
            }}
          >
            Hướng dẫn
          </button>
        </nav>
        <div className="header-right">
          <span className="quiet-note">
            <Leaf size={15} /> Chậm một chút, an yên hơn
          </span>
          {user ? (
            <>
              <button className="account-button" onClick={() => setModal('wardrobe')}>
                <Coins size={16} />
                {user.coins}
                <span>{user.name}</span>
              </button>
              <button
                className="icon-button"
                aria-label="Đăng xuất"
                onClick={async () => {
                  try {
                    await api('/auth/logout', {});
                    setUser(null);
                    setToast('Đã đăng xuất an toàn.');
                  } catch (e) {
                    setToast((e as Error).message);
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <button className="login-button" onClick={() => setModal('login')}>
              Đăng nhập <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>
      <main>
        <section className="welcome">
          <div>
            <div className="eyebrow">
              <span /> HÍT THỞ NHẸ NHÀNG. TRỞ VỀ HIỆN TẠI.
            </div>
            <h1>
              Gác lại bộn bề, <em>trở về an yên.</em>
            </h1>
            <p>{room?.config.tagline ?? 'Một mái chùa nhỏ, một khoảng lặng dành riêng cho bạn.'}</p>
          </div>
          <div className="welcome-tag">
            <span className="mini-lotus">
              <Lotus size={21} />
            </span>
            <div>
              Tâm bình, thế giới bình<small>Nuôi dưỡng bình an từ bên trong</small>
            </div>
          </div>
        </section>
        {room?.config.announcement && (
          <p className="room-announcement" role="status">
            {room.config.announcement}
          </p>
        )}
        {!connected && (
          <p className="connection-warning" role="status">
            Đang đồng bộ với máy chủ. Thao tác tạm khóa để tránh thay đổi sai trạng thái.
          </p>
        )}
        {user && !user.verified && (
          <div className="verification-note">
            <span>Hãy xác minh email trước khi vào chánh điện.</span>
            <button
              onClick={() =>
                void api('/auth/resend-verification', {})
                  .then(() => setToast('Đã gửi lại hướng dẫn xác minh.'))
                  .catch((e) => setToast(e.message))
              }
            >
              Gửi lại email xác minh
            </button>
          </div>
        )}
        {entry && entry.status !== 'ACTIVE' && (
          <div className="queue-note" role="status">
            {entry.status === 'INVITED' ? (
              <>
                <strong>Đã có chỗ cho bạn.</strong>
                <span>
                  Xác nhận trước {new Date(entry.expires_at).toLocaleTimeString('vi-VN')}.
                </span>
                <button
                  onClick={() =>
                    void api('/waitlist/accept', {})
                      .then(() => temple.refresh())
                      .catch((e) => setToast(e.message))
                  }
                >
                  Nhận chỗ ngồi
                </button>
              </>
            ) : (
              <>
                <strong>Bạn ở vị trí {entry.position} trong hàng chờ.</strong>
                <span>
                  Mọi người được mời theo thứ tự, không phụ thuộc trang phục hay quà LIVE.
                </span>
              </>
            )}
            <button onClick={() => void changeSeat()}>Rời hàng chờ</button>
          </div>
        )}
        {myAction?.status === 'QUEUED' && (
          <p className="room-announcement">
            Bạn đang chờ dâng hương. Nghi lễ sẽ bắt đầu khi người trước hoàn tất.
          </p>
        )}
        <div className="workspace-grid">
          <section className="temple-card" aria-label="Trải nghiệm chánh điện">
            <div className="scene-heading">
              <div>
                <span className="status-dot" />
                <strong>{room?.config.roomName ?? 'Đang kết nối chánh điện…'}</strong>
                <span className="separator">/</span>
                <span className="scene-subtitle">Không gian tĩnh tâm</span>
              </div>
              <span className="prototype-badge">
                {connected
                  ? `${room?.occupied ?? 0}/${room?.capacity ?? 36} CHỖ · TRỰC TUYẾN`
                  : 'ĐANG KẾT NỐI LẠI'}
              </span>
            </div>
            <div className={`scene ${quiet ? 'quiet-scene' : ''}`} ref={sceneRef}>
              <TempleArt />
              <Experience room={room} />
              <div className="scene-top">
                <span>
                  <span className="soft-dot" /> Bình yên trong từng hơi thở
                </span>
                <button
                  className="scene-icon"
                  aria-label="Toàn màn hình chánh điện"
                  onClick={() => {
                    if (!document.fullscreenElement)
                      sceneRef.current
                        ?.requestFullscreen?.()
                        .catch(() => setToast('Thiết bị này chưa hỗ trợ toàn màn hình.'));
                    else document.exitFullscreen();
                  }}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
              <Seats room={room} outfits={outfits} userId={user?.id} />
              {action === 'incense' && (
                <div className="incense-effect">
                  <Flame size={26} />
                  <span>Một lời nguyện lành</span>
                </div>
              )}
              <div className="scene-bottom">
                <span>
                  <Users size={14} /> {room?.occupied ?? 0}/{room?.capacity ?? 36} chỗ <i>·</i>{' '}
                  {room?.waiting ?? 0} người chờ
                </span>
                <span className="illustration-label">Minh họa nguyên bản · Trạng thái máy chủ</span>
              </div>
            </div>
            <div className="ritual-bar">
              <div className="ritual-main">
                <button
                  className={`sit-button ${sitting ? 'is-sitting' : ''}`}
                  onClick={() => void changeSeat()}
                  disabled={!connected}
                >
                  <Lotus size={22} />
                  {sitting ? 'Rời đệm ngồi' : entry ? 'Rời hàng chờ' : 'Ngồi tĩnh tâm'}
                  <span>{sitting ? <Check size={16} /> : <ArrowDown size={15} />}</span>
                </button>
                <div className="ritual-divider" />
                <button
                  className="ritual-button"
                  disabled={
                    !sitting || action !== 'idle' || !connected || !room?.config.actionsEnabled
                  }
                  onClick={() => ritual('bow')}
                >
                  <span className="bow-symbol" aria-hidden="true">
                    ♧
                  </span>
                  <span>Chắp tay</span>
                </button>
                <button
                  className="ritual-button"
                  disabled={
                    !sitting || action !== 'idle' || !connected || !room?.config.actionsEnabled
                  }
                  onClick={() => ritual('prostrate')}
                >
                  <Heart size={20} />
                  <span>Lễ Phật</span>
                </button>
                <button
                  className="ritual-button"
                  disabled={
                    !sitting || action !== 'idle' || !connected || !room?.config.actionsEnabled
                  }
                  onClick={() => ritual('incense')}
                >
                  <Flame size={20} />
                  <span>Dâng hương</span>
                </button>
              </div>
              <button
                className={`sound-button ${quiet ? 'active' : ''}`}
                aria-label={quiet ? 'Tắt chế độ tĩnh lặng' : 'Bật chế độ tĩnh lặng'}
                onClick={() => {
                  setQuiet(!quiet);
                  setToast(
                    !quiet
                      ? 'Đã giảm chuyển động. Chưa có bản kinh được cấp phép để phát.'
                      : 'Đã trở về chế độ chuyển động thông thường.',
                  );
                }}
              >
                {quiet ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
            <div className="scene-footnote">
              <LockKeyhole size={12} />
              <span>Không gian miễn phí cho mọi người. Trang phục chỉ thay đổi diện mạo.</span>
              <button onClick={() => setModal('guide')}>
                <CircleHelp size={14} /> Tìm hiểu
              </button>
            </div>
          </section>
          <aside className="sidebar">
            <section className="profile-card">
              <div className="card-title">
                <span>
                  <Leaf size={17} /> Góc nhỏ của bạn
                </span>
                <span className="tag">{user ? 'THÀNH VIÊN' : 'KHÁCH GHÉ THĂM'}</span>
              </div>
              <div className="avatar-stage">
                <span className="avatar-aura" />
                <span className="leaf-decoration leaf-one">✧</span>
                <span className="leaf-decoration leaf-two">✧</span>
                <Avatar
                  front
                  color={outfit?.color}
                  accent={outfit?.accent}
                  outfitId={outfit?.id}
                  accessory={user?.accessory}
                />
                <span className="avatar-platform" />
              </div>
              <h2>{user ? user.name : 'Một người hữu duyên'}</h2>
              <p>{user ? 'Bình an bắt đầu từ một hơi thở.' : 'Chào bạn, thật vui vì bạn ở đây.'}</p>
              <div className="profile-outfit">
                <Shirt size={15} />
                <span>{outfit?.name ?? 'Áo vải mộc'}</span>
                <span className="tiny-dot" /> Trang phục hiện tại
              </div>
              <button
                className="wardrobe-button"
                onClick={() => {
                  setSelected(user?.equipped ?? 'saffron');
                  setModal('wardrobe');
                }}
              >
                <Shirt size={17} /> Ghé tủ áo <ArrowRight size={16} />
              </button>
              <div className="coins-row">
                <span>
                  <Coins size={16} /> Xu của bạn
                </span>
                <strong>
                  {user ? user.coins.toLocaleString('vi') : '—'} <small>xu</small>
                </strong>
              </div>
              {!user && (
                <button className="signup-note" onClick={() => setModal('register')}>
                  Tạo tài khoản để lưu nhân vật <ChevronRight size={13} />
                </button>
              )}
            </section>
            <section className="quote-card">
              <span className="quote-label">
                <span /> MỘT CHÚT AN NHIÊN
              </span>
              <span className="quote-mark">“</span>
              <blockquote>
                Bình yên không ở đâu xa,
                <br />
                mà ở cách ta bước qua
                <br />
                mỗi ngày.
              </blockquote>
              <div className="quote-bottom">
                <span>Lời nhắc hôm nay</span>
                <Lotus size={30} />
              </div>
            </section>
            <button className="security-card" onClick={() => setModal('security')}>
              <span className="shield-circle">
                <ShieldCheck size={21} />
              </span>
              <span>
                <strong>An tâm khi ghé thăm</strong>
                <small>Tìm hiểu cách bảo vệ tài khoản</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </aside>
        </div>
        <section className="below-scene">
          <span>
            <Lotus size={20} />
            <i>Không cần đi thật xa để tìm một chốn bình yên.</i>
          </span>
          <button onClick={() => setModal('guide')}>
            Lần đầu ghé chùa? <ArrowRight size={14} />
          </button>
        </section>
      </main>
      <footer>
        <span>
          © {new Date().getFullYear()} Tu Hành Online <span className="footer-dot">·</span> Gieo
          một niệm lành.
        </span>
        <div>
          {user && user.role !== 'USER' && <a href="/admin">Quản trị</a>}
          <button onClick={() => setModal('security')}>Quyền riêng tư</button>
          <button onClick={() => setModal('guide')}>Quy tắc không gian</button>
          <span>
            Được làm với <Heart size={12} />
          </span>
        </div>
      </footer>
      {temple.gift && (
        <div className="gift-banner" role="status">
          <Flame size={24} />
          <span>
            {temple.gift.provider === 'mock' ? 'MÔ PHỎNG · ' : ''}Cảm ơn {temple.gift.name} đã gửi{' '}
            {temple.gift.quantity} quà. Chúc bạn bình an.
          </span>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Leaf size={18} />
          </span>
          {toast}
          <button aria-label="Đóng thông báo" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <div
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            ref={dialogRef}
          >
            <button
              className="modal-close icon-button"
              aria-label="Đóng cửa sổ"
              onClick={() => setModal(null)}
              disabled={busy}
            >
              <X size={22} />
            </button>
            {modal === 'wardrobe' && (
              <>
                <div className="wardrobe-header">
                  <div className="eyebrow">
                    <Shirt size={14} /> MỘT CHÚT RIÊNG, MỘT CHÚT BẠN
                  </div>
                  <h2 id="dialog-title">Tủ áo an nhiên</h2>
                  <p>Chọn một chiếc áo, mang theo một niềm vui nhỏ.</p>
                  <span className="wallet">
                    <Coins size={17} />
                    {user ? `${user.coins} xu` : 'Đăng nhập để mua'}
                  </span>
                </div>
                <div className="wardrobe-layout">
                  <div className="outfit-preview">
                    <span className="preview-label">THỬ TRANG PHỤC</span>
                    <div className="large-avatar">
                      <Avatar
                        front={frontView}
                        color={preview?.color}
                        accent={preview?.accent}
                        outfitId={preview?.id}
                        accessory={accessory}
                      />
                      <span className="preview-platform" />
                    </div>
                    <div className="angle-switch">
                      <button
                        className={frontView ? 'selected' : ''}
                        onClick={() => setFrontView(true)}
                      >
                        Mặt trước
                      </button>
                      <button
                        className={!frontView ? 'selected' : ''}
                        onClick={() => setFrontView(false)}
                      >
                        Mặt sau
                      </button>
                    </div>
                    <h3>{preview?.name}</h3>
                    <p>{preview?.subtitle}</p>
                    <span className="collection-label">
                      <Leaf size={13} />
                      {preview?.collection}
                    </span>
                  </div>
                  <div className="outfit-shop">
                    <div className="filter-tabs">
                      {['Tất cả', 'Đã sở hữu'].map((label) => (
                        <button
                          key={label}
                          className={filter === label ? 'selected' : ''}
                          onClick={() => setFilter(label)}
                        >
                          {label}
                        </button>
                      ))}
                      <span>
                        {
                          outfits.filter(
                            (o) => filter === 'Tất cả' || user?.inventory.includes(o.id),
                          ).length
                        }{' '}
                        trang phục
                      </span>
                    </div>
                    <div className="outfit-grid">
                      {outfits
                        .filter((o) => filter === 'Tất cả' || user?.inventory.includes(o.id))
                        .map((o) => (
                          <button
                            key={o.id}
                            className={`outfit-card ${selected === o.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelected(o.id);
                              setConfirmBuy(false);
                              setError('');
                              purchaseKey.current = crypto.randomUUID();
                            }}
                            aria-pressed={selected === o.id}
                          >
                            <span className="outfit-mini-stage">
                              <Avatar front color={o.color} accent={o.accent} outfitId={o.id} />
                              {selected === o.id && (
                                <span className="selected-check">
                                  <Check size={12} />
                                </span>
                              )}
                            </span>
                            <strong>{o.name}</strong>
                            <span className="outfit-price">
                              {user?.inventory.includes(o.id) ? (
                                <>
                                  <Check size={12} /> Đã sở hữu
                                </>
                              ) : o.price === 0 ? (
                                'Trang phục khởi đầu'
                              ) : (
                                <>
                                  <Coins size={12} />
                                  {o.price} xu
                                </>
                              )}
                            </span>
                          </button>
                        ))}
                    </div>
                    {filter === 'Đã sở hữu' && !user && (
                      <p className="empty-state">Đăng nhập để xem những chiếc áo của bạn.</p>
                    )}
                    <div className="accessory-options">
                      <span>Phụ kiện miễn phí · lớp riêng</span>
                      <div>
                        {(
                          [
                            ['none', 'Không phụ kiện'],
                            ['beads', 'Chuỗi hạt'],
                            ['lotus', 'Hoa sen'],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            className={accessory === id ? 'selected' : ''}
                            onClick={() => setAccessory(id)}
                            aria-pressed={accessory === id}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="purchase-area">
                      {error && (
                        <p className="form-error" role="alert">
                          {error}
                        </p>
                      )}
                      {confirmBuy && (
                        <p className="confirm-text">
                          Mua “{preview?.name}” với {preview?.price} xu? Còn lại{' '}
                          {user ? user.coins - (preview?.price ?? 0) : 0} xu.
                        </p>
                      )}
                      <button
                        className="primary-button"
                        onClick={purchaseOrEquip}
                        disabled={
                          busy ||
                          (user?.equipped === selected && user?.accessory === accessory) ||
                          (!!user && !owned && user.coins < (preview?.price ?? 0))
                        }
                      >
                        {busy ? (
                          'Đang xử lý…'
                        ) : !user ? (
                          'Đăng nhập để sở hữu'
                        ) : user.equipped === selected && user.accessory === accessory ? (
                          <>
                            <Check size={17} /> Đang mặc
                          </>
                        ) : owned ? (
                          <>
                            <Shirt size={17} /> Mặc trang phục
                          </>
                        ) : user.coins < (preview?.price ?? 0) ? (
                          'Chưa đủ xu'
                        ) : confirmBuy ? (
                          `Xác nhận mua · ${preview?.price} xu`
                        ) : (
                          <>
                            <Coins size={17} /> Sở hữu với {preview?.price} xu
                          </>
                        )}
                      </button>
                      <small>
                        Xu thử nghiệm · Không nạp tiền thật · Không ảnh hưởng quyền vào chùa
                      </small>
                    </div>
                  </div>
                </div>
              </>
            )}
            {(modal === 'login' || modal === 'register') && (
              <div className="auth-content">
                <div className="auth-lotus">
                  <Lotus size={42} />
                </div>
                <div className="eyebrow">TU HÀNH ONLINE</div>
                <h2 id="dialog-title">
                  {modal === 'login' ? 'Mừng bạn trở về.' : 'Bắt đầu một duyên lành.'}
                </h2>
                <p>
                  {modal === 'login'
                    ? 'Một góc bình yên đang đợi bạn.'
                    : 'Lưu nhân vật, chọn chiếc áo bạn yêu thích.'}
                </p>
                <form onSubmit={authenticate}>
                  {modal === 'register' && (
                    <label>
                      Tên hiển thị
                      <input
                        name="name"
                        placeholder="Bạn muốn được gọi là gì?"
                        minLength={2}
                        maxLength={32}
                        required
                        autoComplete="nickname"
                      />
                    </label>
                  )}
                  <label>
                    Email
                    <input
                      type="email"
                      name="email"
                      placeholder="ban@example.com"
                      required
                      autoComplete="email"
                      maxLength={254}
                    />
                  </label>
                  <label>
                    Mật khẩu
                    <input
                      type="password"
                      name="password"
                      placeholder="Ít nhất 12 ký tự"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={modal === 'login' ? 'current-password' : 'new-password'}
                    />
                  </label>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="primary-button" disabled={busy}>
                    {busy ? 'Đang xử lý…' : modal === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
                    <ArrowRight size={16} />
                  </button>
                </form>
                {modal === 'login' && (
                  <button className="forgot-button" onClick={() => setModal('forgot')}>
                    Quên mật khẩu?
                  </button>
                )}
                <div className="auth-switch">
                  {modal === 'login' ? 'Bạn mới ghé thăm?' : 'Đã có tài khoản?'}{' '}
                  <button onClick={() => setModal(modal === 'login' ? 'register' : 'login')}>
                    {modal === 'login' ? 'Tạo tài khoản' : 'Đăng nhập'}
                  </button>
                </div>
                <p className="auth-security">
                  <LockKeyhole size={13} /> Mật khẩu được băm bằng Argon2id.
                </p>
                {modal === 'register' && (
                  <p className="dev-notice">
                    Tặng 300 xu thử nghiệm. Cần xác minh email để vào chánh điện; trang phục không
                    ảnh hưởng quyền giữ ghế.
                  </p>
                )}
              </div>
            )}
            {(modal === 'forgot' || modal === 'reset') && (
              <div className="auth-content">
                <div className="auth-lotus">
                  <LockKeyhole size={36} />
                </div>
                <h2 id="dialog-title">
                  {modal === 'forgot' ? 'Tìm lại tài khoản' : 'Đặt mật khẩu mới'}
                </h2>
                <p>
                  {modal === 'forgot'
                    ? 'Nhập email để nhận hướng dẫn khôi phục.'
                    : 'Liên kết có hạn và chỉ dùng được một lần.'}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    setBusy(true);
                    setError('');
                    void api(
                      modal === 'forgot' ? '/auth/forgot-password' : '/auth/reset-password',
                      modal === 'forgot'
                        ? { email: data.get('email') }
                        : { token: resetToken, password: data.get('password') },
                    )
                      .then(() => {
                        setModal('login');
                        setUser(null);
                        setToast(
                          modal === 'forgot'
                            ? 'Nếu email tồn tại, hướng dẫn khôi phục sẽ được gửi.'
                            : 'Đã đổi mật khẩu và thu hồi các phiên cũ. Hãy đăng nhập lại.',
                        );
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  {modal === 'forgot' ? (
                    <label>
                      Email
                      <input type="email" name="email" autoComplete="email" required />
                    </label>
                  ) : (
                    <label>
                      Mật khẩu mới
                      <input
                        type="password"
                        name="password"
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={128}
                        required
                      />
                    </label>
                  )}
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="primary-button" disabled={busy}>
                    {busy
                      ? 'Đang xử lý…'
                      : modal === 'forgot'
                        ? 'Gửi hướng dẫn'
                        : 'Lưu mật khẩu mới'}
                  </button>
                </form>
              </div>
            )}
            {modal === 'guide' && (
              <div className="info-content">
                <Lotus size={38} />
                <h2 id="dialog-title">Một khoảng lặng cho bạn</h2>
                <p>
                  Chánh điện có tối đa 36 người cùng tham gia. Còn chỗ sẽ được gán ghế; khi đầy bạn
                  vào hàng chờ theo thứ tự. Hãy đăng nhập và xác minh email để bắt đầu.
                </p>
                <ol>
                  <li>
                    <strong>Chọn “Ngồi tĩnh tâm”</strong>
                    <p>
                      Nhân vật xuất hiện ở ghế do máy chủ cấp. Nghi lễ có thời gian chờ; dâng hương
                      lần lượt từng người. Lời mời từ hàng chờ có hạn 60 giây mặc định.
                    </p>
                  </li>
                  <li>
                    <strong>Ghé tủ áo</strong>
                    <p>
                      Thử áo miễn phí. Tạo tài khoản để nhận 300 xu thử nghiệm, mua và lưu trang
                      phục. Xu chưa thể nạp hoặc quy đổi tiền.
                    </p>
                  </li>
                  <li>
                    <strong>Tôn trọng không gian chung</strong>
                    <p>
                      Chọn tên lịch sự, tôn trọng tín ngưỡng và quyền riêng tư. Trang phục chỉ mang
                      tính thẩm mỹ.
                    </p>
                  </li>
                </ol>
                <div className="info-note">
                  <Headphones size={20} />
                  <span>
                    Chưa phát kinh hoặc âm nhạc vì chưa có bản thu được cấp phép. Nút loa hiện
                    chuyển chế độ giảm chuyển động.
                  </span>
                </div>
              </div>
            )}
            {modal === 'security' && (
              <div className="info-content">
                <ShieldCheck size={38} />
                <h2 id="dialog-title">An tâm khi ghé thăm</h2>
                <p>
                  Bảo mật được xây từ phía máy chủ. Không hệ thống nào có thể cam kết an toàn tuyệt
                  đối.
                </p>
                <ul className="security-list">
                  <li>
                    <Check size={18} />
                    <span>
                      <strong>Mật khẩu không lưu nguyên văn</strong>Được băm bằng Argon2id với muối
                      ngẫu nhiên.
                    </span>
                  </li>
                  <li>
                    <Check size={18} />
                    <span>
                      <strong>Phiên đăng nhập được bảo vệ</strong>Cookie HttpOnly, SameSite Strict;
                      máy chủ chỉ lưu mã băm của phiên. Bản production bắt buộc HTTPS và cookie
                      Secure.
                    </span>
                  </li>
                  <li>
                    <Check size={18} />
                    <span>
                      <strong>Giới hạn thử đăng nhập</strong>Giới hạn theo IP và tài khoản; kiểm tra
                      nguồn yêu cầu trước khi thay đổi dữ liệu.
                    </span>
                  </li>
                  <li>
                    <Check size={18} />
                    <span>
                      <strong>Xu và trang phục do máy chủ quản lý</strong>Trừ xu và cấp trang phục
                      trong một giao dịch, ngăn trừ lặp.
                    </span>
                  </li>
                </ul>
                <div className="dev-notice">
                  <strong>Giới hạn bản thử nghiệm</strong>
                  <p>
                    Đã có xác minh email, đặt lại mật khẩu và MFA cho quản trị. Bản phát triển gửi
                    thư vào hộp thư thử nghiệm riêng của máy chủ; production cần SMTP và HTTPS. Chưa
                    có xóa tài khoản tự phục vụ hoặc thanh toán; cần kiểm toán và kiểm thử tải trước
                    khi mở công khai.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname.startsWith('/admin') ? (
      <Admin />
    ) : location.pathname.startsWith('/broadcast/') ? (
      <Broadcast />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
