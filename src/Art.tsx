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
  dots = 0,
  dotLayout,
  design,
  hideShadow = false,
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
  dots?: number;
  dotLayout?: { x: number; y: number; size: number; spacing: number };
  design?: string;
  hideShadow?: boolean;
  durationMs?: number;
  elapsedMs?: number;
}) {
  const id = useId().replaceAll(':', '');
  const initialElapsed = useRef(elapsedMs);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
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
      <g data-layer="shadow" opacity={hideShadow ? 0 : 1}>
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
            design === 'long'
              ? 'M29 77Q10 86 9 120L35 133H85L112 120Q109 86 89 77Z'
              : design === 'belt'
                ? 'M36 76L23 98L34 119L60 128L88 119L100 97L84 76Z'
                : design === 'ceremony'
                  ? 'M29 78L12 108L35 125L87 127L109 110L91 78Z'
                  : design === 'lotus'
                    ? 'M34 76Q14 90 18 124Q60 137 102 124Q107 90 86 76Z'
                    : design === 'jade'
                      ? 'M32 76Q14 85 9 114L36 131H84L111 114Q106 85 88 76Z'
                      : outfitId === 'cloud'
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
        {Array.from({ length: Math.max(0, Math.min(8, dots)) }, (_, i) => (
          <circle
            key={i}
            cx={(dotLayout?.x ?? 60) + ((i % 4) - 1.5) * (dotLayout?.spacing ?? 8)}
            cy={(dotLayout?.y ?? 28) + Math.floor(i / 4) * (dotLayout?.spacing ?? 8)}
            r={dotLayout ? (dotLayout.size * 17) / 48 : 2.5}
            fill="#fff0af"
          />
        ))}
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
      viewBox="0 0 1400 1000"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Chánh điện trầm ấm với tượng Phật vàng trang nghiêm"
    >
      <image href="/sanctuary.svg" width="1400" height="1000" />
    </svg>
  );
}
