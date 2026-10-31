import { useState, useRef } from 'react';
import { api } from './api';
import { type Settings } from '../server/config';
import { type Product, productSchema, tierNames } from '../server/store-config';
import { ProductArt, AppearancePreview } from './StoreArt';
export function StoreEditor({
  value,
  dotLayout,
  onChange,
  legacy,
}: {
  dotLayout?: Settings['dotLayout'];
  value: Settings['store'];
  legacy: Product[];
  onChange: (v: Settings['store']) => void;
}) {
  const [selected, setSelected] = useState(value.products[0].id),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const products = [
    ...legacy.filter((p) => !value.products.some((v) => v.id === p.id)),
    ...value.products,
  ];
  const item = products.find((p) => p.id === selected) ?? products[0];
  function update<K extends keyof Product>(key: K, v: Product[K]) {
    onChange({
      ...value,
      products: value.products.some((p) => p.id === item.id)
        ? value.products.map((p) => (p.id === item.id ? { ...p, [key]: v } : p))
        : [...value.products, { ...item, [key]: v }],
    });
  }
  return (
    <section className="admin-panel">
      <h2>Bảo Các Thanh Liên · Catalog V9</h2>
      <p>
        Ảnh là một lớp độc lập, nền trong suốt PNG/WebP tối đa 1024px/1.5 MB. Không dùng ảnh tổng
        hợp cả nhân vật và đài sen. Lưu nháp → xem trước → xuất bản; ngừng bán vẫn giữ quyền sở
        hữu/trang bị.
      </p>
      <label>
        Tên cửa hàng
        <input
          value={value.title}
          maxLength={60}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        Vật phẩm
        <select value={item.id} onChange={(e) => setSelected(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.category} · {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="store-admin-art">
        <ProductArt item={item} admin />
      </div>
      <label>
        Tên
        <input value={item.name} maxLength={60} onChange={(e) => update('name', e.target.value)} />
      </label>
      <label>
        Mô tả
        <textarea
          value={item.description}
          maxLength={240}
          onChange={(e) => update('description', e.target.value)}
        />
      </label>
      <label>
        Giá xu
        <input
          type="number"
          min="0"
          max="100000"
          value={item.price}
          onChange={(e) => update('price', Number(e.target.value))}
        />
      </label>
      <label>
        Bậc hiếm
        <select value={item.tier} onChange={(e) => update('tier', Number(e.target.value))}>
          {tierNames.map((name, i) => (
            <option key={name} value={i + 1}>
              {i + 1} · {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Màu
        <input type="color" value={item.color} onChange={(e) => update('color', e.target.value)} />
      </label>
      <label>
        Màu viền
        <input
          type="color"
          value={item.accent}
          onChange={(e) => update('accent', e.target.value)}
        />
      </label>
      <label>
        Kiểu hình
        <select
          value={item.design}
          onChange={(e) => update('design', e.target.value as Product['design'])}
        >
          {productSchema.shape.design.options.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        Thứ tự
        <input
          type="number"
          min="0"
          max="10000"
          value={item.order}
          onChange={(e) => update('order', Number(e.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
        />
        Mở bán
      </label>
      <label>
        Thay ảnh (tạo phiên bản mới)
        <input
          type="file"
          accept="image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const id = item.id;
            setBusy(true);
            setError('');
            try {
              if (f.size > 1500000) throw new Error('Tệp tối đa 1.5 MB.');
              const data = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(',')[1]);
                r.onerror = () => reject(new Error('Không đọc được ảnh'));
                r.readAsDataURL(f);
              });
              const asset = await api('/admin/store/assets', { data });
              onChange({
                ...latest.current,
                products: latest.current.products.some((p) => p.id === id)
                  ? latest.current.products.map((p) =>
                      p.id === id ? { ...p, imageId: asset.id } : p,
                    )
                  : [...latest.current.products, { ...item, imageId: asset.id }],
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {item.imageId && (
        <button onClick={() => update('imageId', null)}>Dùng hình vẽ mặc định</button>
      )}
      <button onClick={() => setPreview(!preview)}>Xem trước bản đang sửa</button>
      {preview && (
        <AppearancePreview
          dotLayout={dotLayout}
          appearance={{
            robe: item.category === 'robe' ? item.id : 'robe_pham',
            cosmetics: {
              seat: item.category === 'seat' ? item.id : 'seat_moc',
              accessory: item.category === 'accessory' ? item.id : 'accessory_none',
              dotStyle: item.category === 'dotStyle' ? item.id : 'dots_brown',
              nameFrame: item.category === 'nameFrame' ? item.id : 'frame_none',
            },
          }}
          products={products}
          dots={8}
          admin
        />
      )}
      <button
        disabled={value.products.length >= 100 || busy}
        onClick={() => {
          const id = 'item_' + crypto.randomUUID().slice(0, 8);
          onChange({
            ...value,
            products: [
              ...value.products,
              {
                ...item,
                id,
                name: 'Vật phẩm mới',
                enabled: false,
                imageId: null,
                order: item.order + 1,
              },
            ],
          });
          setSelected(id);
        }}
      >
        Nhân bản mẫu · thêm vật phẩm
      </button>
      <p role="alert">{error}</p>
    </section>
  );
}
