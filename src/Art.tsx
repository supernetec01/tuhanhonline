import { useId, useRef } from 'react';

export function Lotus({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6C13 17 14 28 24 35C34 28 35 17 24 6Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 16C6 30 12 37 24 37C24 25 18 18 7 16ZM41 16C42 30 36 37 24 37C24 25 30 18 41 16Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3 29C7 40 16 44 24 38C32 44 41 40 45 29"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Avatar({
  color = '#a9b5a0',
  accent = '#d6dac4',
  front = false,
  action = 'idle',
  className = '',
  outfitId = 'linen',
  accessory = 'none',
  durationMs,
  elapsedMs = 0,
}: {
  color?: string;
  accent?: string;
  front?: boolean;
  action?: string;
  className?: string;
  outfitId?: string;
  accessory?: string;
  durationMs?: number;
  elapsedMs?: number;
}) {
  const id = useId().replaceAll(':', '');
  const initialElapsed = useRef(elapsedMs);
  return (
    <svg
      className={`avatar avatar-${action} ${className}`}
      viewBox="0 0 120 140"
      aria-hidden="true"
      data-outfit={outfitId}
      style={
        durationMs
          ? {
              animationDuration: `${durationMs}ms`,
              animationDelay: `-${initialElapsed.current}ms`,
              animationFillMode: 'both',
            }
          : undefined
      }
    >
      <defs>
        <radialGradient id={`head${id}`} cx="35%" cy="25%" r="80%">
          <stop stopColor="#f4d2aa" />
          <stop offset="1" stopColor="#c88e66" />
        </radialGradient>
        <linearGradient id={`robe${id}`} x2=".8" y2="1">
          <stop stopColor={accent} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <g data-layer="shadow">
        <ellipse cx="60" cy="129" rx="48" ry="9" fill="#382b28" opacity=".15" />
      </g>
      <g data-layer="body">
        <path d="M32 81Q60 71 87 81L89 116H31Z" fill="#e5bc94" />
        <path
          d="M14 123Q12 106 38 98H82Q109 107 106 123Q87 137 60 131Q31 137 14 123Z"
          fill={color}
        />
      </g>
      <g data-layer="robe">
        <path
          d={
            outfitId === 'cloud'
              ? 'M34 76Q14 87 15 117L41 123H80L106 117Q103 86 84 76Z'
              : outfitId === 'lotus'
                ? 'M35 76Q24 88 21 114Q60 132 99 114Q96 87 84 76Z'
                : 'M35 76Q23 86 23 112L43 120H78L97 112Q94 84 83 76Z'
          }
          fill={`url(#robe${id})`}
          stroke={color}
          strokeWidth="1.5"
        />
        <path
          d="M35 86L30 111M86 89L92 109M47 118L42 128M74 118L81 127"
          stroke="#514838"
          opacity=".2"
          strokeWidth="1.4"
          fill="none"
        />
        {outfitId === 'lotus' && (
          <path
            d="M27 110Q60 128 94 110M39 85Q60 104 82 85"
            stroke="#f9e3d7"
            opacity=".7"
            strokeWidth="2"
            fill="none"
          />
        )}
        {outfitId === 'cloud' && (
          <path
            d="M22 111Q26 102 33 109Q42 103 44 113M78 114Q82 103 91 110Q98 104 101 112"
            fill="none"
            stroke="#e4f2e9"
            strokeWidth="2.2"
            opacity=".8"
          />
        )}
      </g>
      <g data-layer="outer-robe">
        <path
          d={
            outfitId === 'saffron'
              ? 'M71 77Q80 88 88 91L78 124Q60 123 44 116L67 79Z'
              : 'M73 78L43 118H77L87 89Z'
          }
          fill={accent}
          opacity=".88"
        />
        {outfitId === 'saffron' && (
          <path d="M72 82L51 115M79 89L61 119" stroke="#c49047" opacity=".4" fill="none" />
        )}
        {outfitId === 'lotus' && (
          <path
            d="M73 114Q60 109 67 101Q73 101 73 110Q74 100 80 102Q86 109 73 114Z"
            fill="#fff0e3"
            opacity=".8"
          />
        )}
        {outfitId === 'cloud' && (
          <path
            d="M59 111Q61 102 68 108Q74 101 79 109"
            fill="none"
            stroke="#e9f5eb"
            strokeWidth="2"
          />
        )}
      </g>
      <g data-layer="head">
        <ellipse cx="60" cy="49" rx="36" ry="37" fill={`url(#head${id})`} />
        <ellipse cx="26" cy="54" rx="5" ry="8" fill="#e1ad82" />
        <ellipse cx="94" cy="54" rx="5" ry="8" fill="#d7a079" />
        <path
          d="M41 23Q48 18 54 19"
          stroke="#fff1d9"
          strokeWidth="4"
          opacity=".4"
          strokeLinecap="round"
        />
        {front && (
          <>
            <path
              d="M39 51Q44 55 49 51M71 51Q76 55 81 51"
              fill="none"
              stroke="#675044"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M56 64Q60 67 64 64"
              fill="none"
              stroke="#95674f"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <ellipse cx="37" cy="61" rx="7" ry="4" fill="#d58c7e" opacity=".4" />
            <ellipse cx="83" cy="61" rx="7" ry="4" fill="#d58c7e" opacity=".4" />
          </>
        )}
      </g>
      <g data-layer="accessory">
        {accessory === 'beads' && (
          <>
            {Array.from({ length: 11 }, (_, i) => {
              const angle = (i / 10) * Math.PI;
              return (
                <circle
                  key={i}
                  cx={60 + 24 * Math.cos(angle)}
                  cy={84 + 23 * Math.sin(angle)}
                  r="3"
                  fill="#8c664a"
                  stroke="#e3bc82"
                  strokeWidth=".7"
                />
              );
            })}
            <path d="M60 107V117" stroke="#aa8055" strokeWidth="2" />
          </>
        )}
        {accessory === 'lotus' && (
          <>
            <path
              d="M83 103Q76 95 81 89Q86 90 86 98Q88 88 93 90Q98 99 86 105Z"
              fill="#f1b9bd"
              stroke="#bb8295"
              strokeWidth="1"
            />
            <path d="M86 104L82 117" stroke="#759165" strokeWidth="2" />
          </>
        )}
      </g>
      <g data-layer="hands">
        {front && (
          <path
            d="M49 100L60 88L71 100"
            stroke="#e7bb91"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </g>
    </svg>
  );
}

export function TempleArt() {
  return (
    <svg
      className="temple-art"
      viewBox="0 0 1000 760"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Chánh điện minh họa nguyên bản với tượng Phật vàng, cột đỏ và sàn gỗ"
    >
      <defs>
        <linearGradient id="wall" x2="0" y2="1">
          <stop stopColor="#726447" />
          <stop offset="1" stopColor="#b29766" />
        </linearGradient>
        <linearGradient id="wood" x2="0" y2="1">
          <stop stopColor="#a27351" />
          <stop offset="1" stopColor="#705444" />
        </linearGradient>
        <linearGradient id="pillar">
          <stop stopColor="#673e32" />
          <stop offset=".4" stopColor="#a76549" />
          <stop offset=".65" stopColor="#a96a4e" />
          <stop offset="1" stopColor="#593a30" />
        </linearGradient>
        <linearGradient id="gold" x2=".8" y2="1">
          <stop stopColor="#ffe8a3" />
          <stop offset=".5" stopColor="#dcb365" />
          <stop offset="1" stopColor="#b8843e" />
        </linearGradient>
        <radialGradient id="halo">
          <stop stopColor="#fbe4a5" stopOpacity=".7" />
          <stop offset=".65" stopColor="#e4c37a" stopOpacity=".3" />
          <stop offset="1" stopColor="#ddba74" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="window" x2="0" y2="1">
          <stop stopColor="#c2c6a4" />
          <stop offset="1" stopColor="#ede2b9" />
        </linearGradient>
        <pattern id="lattice" width="23" height="27" patternUnits="userSpaceOnUse">
          <rect
            x="2"
            y="2"
            width="19"
            height="23"
            rx="9"
            fill="none"
            stroke="#c7aa6b"
            strokeWidth=".8"
            opacity=".35"
          />
          <path d="M8 19Q11 10 15 19" stroke="#d1b67d" fill="none" opacity=".5" />
        </pattern>
        <pattern id="floor" width="1000" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 63H1000" stroke="#513c30" strokeWidth="2" opacity=".22" />
        </pattern>
      </defs>
      <rect width="1000" height="760" fill="url(#wall)" />
      <rect x="226" y="70" width="548" height="302" fill="#6d6246" />
      <rect x="236" y="80" width="528" height="280" fill="url(#lattice)" />
      {[65, 805].map((x) => (
        <g key={x}>
          <path d={`M${x} 329V151Q${x + 65} 62 ${x + 130} 151V329Z`} fill="url(#window)" />
          <path
            d={`M${x} 270Q${x + 42} 170 ${x + 82} 248L${x + 130} 212V329H${x}Z`}
            fill="#a2ae8c"
            opacity=".7"
          />
          <path d={`M${x} 295Q${x + 65} 233 ${x + 130} 293V329H${x}Z`} fill="#8c9b7a" />
          <path
            d={`M${x + 65} 115V329M${x} 203H${x + 130}M${x} 267H${x + 130}`}
            stroke="#736348"
            strokeWidth="7"
          />
        </g>
      ))}
      <path d="M0 0H1000V61L500 31L0 61Z" fill="#423e31" />
      <path d="M0 65L500 38L1000 65" fill="none" stroke="#c3a366" strokeWidth="9" />
      <rect
        x="391"
        y="61"
        width="218"
        height="41"
        rx="5"
        fill="#564431"
        stroke="#bd9859"
        strokeWidth="3"
      />
      <text
        x="500"
        y="88"
        textAnchor="middle"
        fill="#ead39a"
        fontSize="20"
        fontFamily="serif"
        letterSpacing="7"
      >
        TÂM AN LẠC
      </text>
      <circle cx="500" cy="214" r="156" fill="url(#halo)" />
      <circle cx="500" cy="211" r="92" fill="none" stroke="#d5b573" opacity=".6" />
      <circle
        cx="500"
        cy="211"
        r="102"
        fill="none"
        stroke="#c6a367"
        opacity=".4"
        strokeDasharray="2 7"
      />
      <path d="M0 397L256 354H744L1000 397V760H0Z" fill="url(#wood)" />
      <path d="M0 397L256 354H744L1000 397V760H0Z" fill="url(#floor)" />
      {[0, 150, 300, 700, 850, 1000].map((x, i) => (
        <path
          key={i}
          d={`M${500 + (x - 500) * 0.35} 355L${x} 760`}
          stroke="#503c30"
          strokeWidth="2"
          opacity=".16"
        />
      ))}
      <path d="M473 374L527 374L601 760H399Z" fill="#c5a079" opacity=".18" />
      <path d="M322 351H678L704 377H296Z" fill="#816247" />
      <path d="M296 377H704V397H296Z" fill="#73513a" />
      <path d="M308 377H692" stroke="#b8935d" strokeWidth="3" />
      <rect x="340" y="310" width="320" height="49" rx="3" fill="#6b4733" />
      <rect x="331" y="304" width="338" height="10" rx="3" fill="#a77b48" />
      <path d="M351 329H649M351 347H649" stroke="#bd9558" opacity=".65" />
      <g fill="url(#gold)" stroke="#ad813c" strokeWidth="1.4">
        <path d="M443 188Q430 197 431 228L420 264L459 276H540L579 263L564 225Q568 198 548 186Z" />
        <path d="M467 188L453 254L489 270L548 249L535 190Z" fill="#e5bb6b" />
        <path d="M456 241Q410 244 414 265Q427 286 493 280L500 266L507 280Q572 285 587 266Q590 246 543 241L501 258Z" />
        <ellipse cx="501" cy="165" rx="29" ry="36" />
        <path
          d="M471 156Q465 126 482 120Q500 106 519 121Q537 125 532 156Q515 145 501 144Q482 144 471 156Z"
          fill="#665843"
        />
        <ellipse cx="501" cy="118" rx="9" ry="10" fill="#665843" />
        <path
          d="M440 221Q459 255 491 250L505 247"
          fill="none"
          stroke="#edca80"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M552 215L524 239L507 240"
          fill="none"
          stroke="#edca80"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path d="M485 166Q490 170 495 166M508 166Q513 170 518 166" stroke="#9d773e" fill="none" />
        <path d="M495 184Q501 187 507 184" stroke="#a37a3c" fill="none" />
        <path d="M432 287Q500 271 570 287L558 302H444Z" />
        {[450, 470, 490, 510, 530, 550].map((x) => (
          <path
            key={x}
            d={`M${x} 296Q${x - 12} 280 ${x} 276Q${x + 13} 280 ${x} 296Z`}
            fill="#d5a552"
          />
        ))}
      </g>
      {[365, 635].map((x) => (
        <g key={x}>
          <path d={`M${x} 268V299`} stroke="#496549" strokeWidth="4" />
          <path d={`M${x - 13} 289Q${x} 296 ${x + 13} 289L${x + 9} 307H${x - 9}Z`} fill="#9da990" />
          <path
            d={`M${x} 277Q${x - 24} 260 ${x - 15} 247Q${x - 3} 247 ${x} 277Q${x + 2} 250 ${x + 16} 246Q${x + 22} 265 ${x} 277Z`}
            fill="#b4919b"
          />
          <path d={`M${x} 273Q${x - 10} 252 ${x} 241Q${x + 11} 252 ${x} 273Z`} fill="#debdba" />
        </g>
      ))}
      {[398, 602].map((x) => (
        <g key={x}>
          <rect x={x - 4} y="279" width="8" height="22" rx="2" fill="#f1d8a2" />
          <path d={`M${x} 278Q${x - 8} 267 ${x} 261Q${x + 8} 269 ${x} 278Z`} fill="#ffdc8c" />
          <circle cx={x} cy="271" r="16" fill="#ffd077" opacity=".12" />
        </g>
      ))}
      <ellipse cx="500" cy="307" rx="24" ry="5" fill="#b08a51" />
      <path d="M482 296H518L514 309H486Z" fill="#a7824d" />
      {[492, 500, 508].map((x) => (
        <path key={x} d={`M${x} 297V270`} stroke="#835839" strokeWidth="2" />
      ))}
      {[22, 218, 752, 946].map((x, i) => (
        <g key={x}>
          <rect
            x={x}
            y="57"
            width={i === 0 || i === 3 ? 32 : 30}
            height="351"
            rx="3"
            fill="url(#pillar)"
          />
          <rect x={x - 4} y="68" width="38" height="12" fill="#b58a4f" />
          <rect x={x - 5} y="385" width="40" height="22" rx="3" fill="#84704c" />
          <path d={`M${x + 9} 85V371`} stroke="#cf9670" opacity=".25" strokeWidth="3" />
        </g>
      ))}
      {[167, 828].map((x) => (
        <g key={x}>
          <path d={`M${x} 70V129`} stroke="#b18f5e" strokeWidth="2" />
          <rect x={x - 19} y="125" width="38" height="56" rx="14" fill="#b97d51" />
          <path
            d={`M${x - 16} 136H${x + 16}M${x - 16} 168H${x + 16}`}
            stroke="#d3ad71"
            strokeWidth="4"
          />
          <path d={`M${x} 181V199`} stroke="#d1ae71" strokeWidth="3" />
          <circle cx={x} cy="154" r="40" fill="#e9b472" opacity=".07" />
        </g>
      ))}
      <path d="M0 0H1000V760H0Z" fill="#f3ddac" opacity=".05" />
    </svg>
  );
}
