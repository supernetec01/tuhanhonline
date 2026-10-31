import { Avatar } from './Art';
import { type Product, type Appearance, baseCosmetics } from '../server/store-config';
export function ProductArt({
  item,
  front = false,
  admin = false,
}: {
  item: Product;
  front?: boolean;
  admin?: boolean;
}) {
  if (item.imageId)
    return (
      <img
        className="product-art"
        alt=""
        src={`/api/${admin ? 'admin/store' : 'store'}/assets/${item.imageId}`}
      />
    );
  if (item.category === 'robe')
    return (
      <Avatar
        front={front}
        color={item.color}
        accent={item.accent}
        outfitId={item.id}
        hideShadow
        design={item.design}
      />
    );
  const { color: c, accent: a, design: d } = item;
  if (item.category === 'nameFrame')
    return (
      <svg className="product-art" viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="2"
          y="2"
          width="116"
          height="28"
          rx={d === 'bamboo' ? 3 : 10}
          fill="#261c18"
          stroke={c}
          strokeWidth="3"
        />
        {d !== 'plain' && <path d="M8 8h12m-6-4v8M100 24h12m-6-4v8" stroke={a} strokeWidth="2" />}
      </svg>
    );
  if (item.category === 'dotStyle')
    return (
      <svg className="product-art" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        {d === 'petal' ? (
          <path d="M24 4Q44 20 24 44Q4 20 24 4Z" fill={c} stroke={a} />
        ) : (
          <circle cx="24" cy="24" r="17" fill={c} stroke={d === 'metal' ? a : c} strokeWidth="3" />
        )}
        {d === 'pearl' && <circle cx="18" cy="17" r="5" fill="#fff" opacity=".7" />}
      </svg>
    );
  return (
    <svg className="product-art" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      {item.category === 'seat' ? (
        <>
          <ellipse cx="60" cy="130" rx="51" ry="7" fill="#251d22" opacity=".35" />
          {['cushion', 'embroidered', 'bamboo'].includes(d) ? (
            <>
              <rect
                x="12"
                y="112"
                width="96"
                height="19"
                rx="10"
                fill={c}
                stroke={a}
                strokeWidth="2"
              />
              <ellipse cx="60" cy="114" rx="46" ry="8" fill={c} stroke={a} />
              {d === 'embroidered' && (
                <path
                  d="M27 117L35 112L43 117L51 112L59 117L67 112L75 117L83 112L91 117"
                  fill="none"
                  stroke={a}
                />
              )}{' '}
              {d === 'bamboo' && (
                <path d="M24 121l12-9m-7 4h8m45 5l10-9m-7 4h8" stroke={a} fill="none" />
              )}
            </>
          ) : (
            <>
              {Array.from({ length: d === 'nine' ? 9 : d === 'purple' ? 4 : 2 }, (_, layer) => (
                <g key={layer} opacity={1 - layer * 0.045}>
                  {Array.from({ length: 7 }, (_, i) => (
                    <path
                      key={i}
                      d={`M60 ${129 - layer * 2}Q${10 + i * 15} ${91 - layer * 1.3} ${6 + i * 17} ${111 - layer * 1.4}Q${10 + i * 15} ${134 - layer * 2} 60 ${129 - layer * 2}`}
                      fill={i % 2 ? c : a}
                      stroke={c}
                      strokeWidth=".7"
                    />
                  ))}
                </g>
              ))}
              <ellipse cx="60" cy="113" rx="29" ry="6" fill={c} stroke={a} />
              {d === 'lantern' && (
                <ellipse cx="60" cy="119" rx="45" ry="11" fill="#f8dda0" opacity=".2" />
              )}
            </>
          )}
        </>
      ) : item.id.endsWith('_none') ? null : d === 'beads' ? (
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <circle
              key={i}
              cx={60 + 27 * Math.cos((Math.PI * i) / 11)}
              cy={78 + 18 * Math.sin((Math.PI * i) / 11)}
              r="3.5"
              fill={c}
              stroke={a}
              strokeWidth=".8"
            />
          ))}
        </g>
      ) : d === 'book' ? (
        <>
          <path d="M6 106L25 102L35 111L16 116Z" fill={a} stroke={c} />
          <path d="M6 106v10l10 8 19-5v-8l-19 5Z" fill={c} />
          <path d="M16 116v8m5-14l7-2" stroke={a} />
        </>
      ) : d === 'incense' ? (
        <>
          <path d="M91 110h23l-4 16H95Z" fill={c} stroke={a} />
          <path d="M97 110l-3-18m8 18V90m5 20l4-18" stroke="#b98361" />
          <path d="M102 87q-5-6 0-12" fill="none" stroke="#c9c4bc" opacity=".6" />
        </>
      ) : (
        <>
          <path d="M90 117q-15-20 3-10q-3-22 8-7q12-16 11 5q18-7 5 12Z" fill={c} stroke={a} />
          <ellipse cx="102" cy="117" rx="15" ry="5" fill={a} />
        </>
      )}
    </svg>
  );
}
export function AppearancePreview({
  appearance,
  products,
  dots = 0,
  front = false,
  admin = false,
  dotLayout,
}: {
  dotLayout?: { x: number; y: number; size: number; spacing: number };
  appearance: Appearance;
  products: Product[];
  dots?: number;
  front?: boolean;
  admin?: boolean;
}) {
  const find = (id: string) => products.find((p) => p.id === id),
    robe = find(appearance.robe),
    seat = find(appearance.cosmetics.seat),
    accessory = find(appearance.cosmetics.accessory),
    style = find(appearance.cosmetics.dotStyle),
    frame = find(appearance.cosmetics.nameFrame);
  return (
    <div
      className="appearance-preview"
      data-preview-robe={appearance.robe}
      data-preview-seat={appearance.cosmetics.seat}
    >
      {seat && (
        <div className="appearance-layer appearance-seat">
          <ProductArt item={seat} admin={admin} />
        </div>
      )}
      {robe && (
        <div className="appearance-layer appearance-robe">
          <ProductArt item={robe} front={front} admin={admin} />
        </div>
      )}
      {accessory && (
        <div className="appearance-layer appearance-accessory">
          <ProductArt item={accessory} admin={admin} />
        </div>
      )}
      <div className={dotLayout ? 'appearance-dot-overlay' : 'appearance-dots'}>
        {Array.from({ length: Math.min(8, dots) }, (_, i) => (
          <span
            key={i}
            style={
              dotLayout
                ? {
                    position: 'absolute',
                    left: `${((dotLayout.x + ((i % 4) - 1.5) * dotLayout.spacing) / 120) * 100}%`,
                    top: `${((dotLayout.y + Math.floor(i / 4) * dotLayout.spacing) / 140) * 100}%`,
                    width: `${(dotLayout.size / 120) * 100}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%,-50%)',
                  }
                : undefined
            }
          >
            {style && <ProductArt item={style} admin={admin} />}
          </span>
        ))}
      </div>
      {frame && (
        <div className="appearance-frame">
          <ProductArt item={frame} admin={admin} />
          <span>Pháp danh</span>
        </div>
      )}
    </div>
  );
}
export const defaultAppearance: Appearance = { robe: 'linen', cosmetics: baseCosmetics };
