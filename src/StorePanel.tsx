import { type Settings } from '../server/config';
import { useEffect, useRef, useState } from 'react';
import { api, type User } from './api';
import { AppearancePreview, ProductArt } from './StoreArt';
import {
  type Product,
  type Appearance,
  baseCosmetics,
  tierNames,
  starterItems,
} from '../server/store-config';
export function StorePanel({
  user,
  dotLayout,
  onUser,
  onPreview,
  onInspect,
  onPurchase,
}: {
  dotLayout?: Settings['dotLayout'];
  user: User | null;
  onUser: (u: User) => void;
  onPreview: (p: Appearance | null) => void;
  onInspect: () => void;
  onPurchase: (key: string) => void;
}) {
  const [catalog, setCatalog] = useState<{
      title: string;
      products: Product[];
      dailyCoinCap: number;
    } | null>(null),
    [category, setCategory] = useState('robe'),
    [selected, setSelected] = useState<string>(user?.equipped ?? 'linen'),
    [appearance, setAppearance] = useState<Appearance>({
      robe: user?.equipped ?? 'linen',
      cosmetics: { ...baseCosmetics, ...user?.cosmetics },
    }),
    [ownedOnly, setOwnedOnly] = useState(false),
    [front, setFront] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(''),
    [hours, setHours] = useState(2),
    [history, setHistory] = useState<any[] | null>(null);
  const keys = useRef(new Map<string, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void api('/store')
      .then(setCatalog)
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      onPreview(null);
    };
  }, []);
  const owned = (id: string) =>
      !!user && (starterItems.includes(id) || user.inventory.includes(id)),
    item = catalog?.products.find((p) => p.id === selected),
    equipped = (p: Product) =>
      p.category === 'robe' ? user?.equipped === p.id : user?.cosmetics?.[p.category] === p.id;
  function tryItem(p: Product) {
    setSelected(p.id);
    setConfirm('');
    const next =
      p.category === 'robe'
        ? { ...appearance, robe: p.id }
        : { ...appearance, cosmetics: { ...appearance.cosmetics, [p.category]: p.id } };
    setAppearance(next);
    onPreview(user ? next : null);
  }
  async function buy() {
    if (!item || !user || busy) return;
    if (confirm !== item.id) {
      setConfirm(item.id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      let key = keys.current.get(item.id);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(item.id, key);
      }
      const r = await api('/store/buy', {
        itemId: item.id,
        requestKey: key,
        expectedPrice: item.price,
      });
      onUser(r.user);
      onPurchase(key);
      setConfirm('');
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).code === 'PRICE_CHANGED') {
        setCatalog(await api('/store'));
        setConfirm('');
      }
    } finally {
      setBusy(false);
    }
  }
  async function equip() {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/store/equip', { itemId: item.id });
      onUser(r.user);
      const next = { robe: r.user.equipped, cosmetics: r.user.cosmetics };
      if (mounted.current) {
        setAppearance(next);
        onPreview(next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="dialog-kicker">PHÁP PHỤC · BÀN TỌA · TRANG TRÍ</div>
      <h1 id="game-dialog-title">{catalog?.title ?? 'Bảo Các Thanh Liên'}</h1>
      <p>
        {user ? `${user.coins.toLocaleString('vi-VN')} xu` : 'Đăng nhập để mua và lưu vật phẩm'} ·
        Độ hiếm chỉ là mức sưu tầm trong game.
      </p>
      <nav className="store-tabs" aria-label="Nhóm vật phẩm">
        {[
          ['robe', 'Pháp phục'],
          ['seat', 'Bàn tọa / Đài sen'],
          ['decor', 'Trang trí'],
        ].map(([id, name]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id);
              setConfirm('');
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      <label className="game-check">
        <input
          type="checkbox"
          checked={ownedOnly}
          onChange={(e) => setOwnedOnly(e.target.checked)}
        />
        Tủ đồ · Chỉ vật phẩm sở hữu
      </label>
      {!catalog ? (
        <p>Đang tải cửa hàng…</p>
      ) : (
        <div className="store-layout">
          <aside>
            <AppearancePreview
              dotLayout={dotLayout}
              appearance={appearance}
              products={catalog.products}
              dots={user?.dots ?? 0}
              front={front}
            />
            <div className="auth-tabs">
              <button aria-pressed={!front} onClick={() => setFront(false)}>
                Mặt sau
              </button>
              <button aria-pressed={front} onClick={() => setFront(true)}>
                Mặt trước
              </button>
            </div>
            <p className="form-hint">
              Xem thử chỉ trên máy bạn. Đóng cửa hàng để hủy; người khác chỉ thấy đồ đã trang bị.
            </p>
            <button className="game-primary" disabled={!user} onClick={onInspect}>
              Ngắm tại ghế
            </button>
            <button
              className="text-link"
              onClick={() => {
                const next = {
                  robe: user?.equipped ?? 'linen',
                  cosmetics: { ...baseCosmetics, ...user?.cosmetics },
                };
                setAppearance(next);
                onPreview(null);
              }}
            >
              Hủy xem thử
            </button>
            {item && (
              <>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
                <p>
                  {tierNames[item.tier - 1]} · {item.price} xu
                </p>
                {user && owned(item.id) ? (
                  <button
                    className="game-primary"
                    disabled={busy || equipped(item)}
                    onClick={() => void equip()}
                  >
                    {equipped(item) ? 'Đang trang bị' : 'Mặc / dùng ngay'}
                  </button>
                ) : (
                  <button
                    className="game-primary"
                    disabled={busy || !user || !item.enabled || user.coins < item.price}
                    onClick={() => void buy()}
                  >
                    {!item.enabled
                      ? 'Đang ngừng bán'
                      : !user
                        ? 'Đăng nhập để mua'
                        : confirm === item.id
                          ? `Xác nhận mua · ${item.price} xu`
                          : item.price === 0
                            ? 'Nhận miễn phí'
                            : `Mua · ${item.price} xu`}
                  </button>
                )}
                <label>
                  Thời gian tu mỗi ngày (giờ)
                  <input
                    type="number"
                    min="0.5"
                    max="24"
                    step=".5"
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                  />
                </label>
                <p className="form-hint">
                  Ước tính từ {user?.coins ?? 0} xu:{' '}
                  {Math.ceil(
                    Math.max(0, item.price - (user?.coins ?? 0)) /
                      Math.max(
                        1,
                        Math.min(catalog.dailyCoinCap, Math.max(0.5, Math.min(24, hours)) * 60),
                      ),
                  )}{' '}
                  ngày. Giả định tu đều, đủ điều kiện và không chi xu khác; trần{' '}
                  {catalog.dailyCoinCap} xu/ngày.
                </p>
              </>
            )}
          </aside>
          <div className="store-grid">
            {catalog.products
              .filter(
                (p) =>
                  (category === 'decor'
                    ? ['accessory', 'dotStyle', 'nameFrame'].includes(p.category)
                    : p.category === category) &&
                  (p.enabled || owned(p.id)) &&
                  (!ownedOnly || owned(p.id)),
              )
              .map((p) => (
                <button
                  className="store-card"
                  key={p.id}
                  aria-pressed={selected === p.id}
                  onClick={() => tryItem(p)}
                >
                  <ProductArt item={p} front={front} />
                  <strong>{p.name}</strong>
                  <small style={{ color: p.color }}>{tierNames[p.tier - 1]}</small>
                  <small>
                    {owned(p.id)
                      ? equipped(p)
                        ? 'Đang dùng'
                        : 'Đã sở hữu'
                      : p.price === 0
                        ? 'Miễn phí'
                        : `${p.price} xu`}
                  </small>
                  <span>Xem thử</span>
                </button>
              ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="game-form-error">
          {error}
        </p>
      )}
      <p className="form-hint">
        Vật phẩm chỉ thay đổi diện mạo. Không tăng công đức/xu, không giảm hồi chiêu hoặc ưu tiên
        ghế. Kiểu chấm không mở thêm số chấm.
      </p>
      {user && (
        <details
          onToggle={(e) => {
            if (e.currentTarget.open)
              void api('/store/history')
                .then((r) => setHistory(r.transactions))
                .catch((e) => setError(e.message));
          }}
        >
          <summary>Lịch sử giao dịch</summary>
          {history?.map((r) => (
            <p key={r.id}>
              {catalog?.products.find((p) => p.id === r.item_id)?.name ?? r.item_id} · {r.amount} xu
              · {new Date(r.created_at).toLocaleString('vi-VN')}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
