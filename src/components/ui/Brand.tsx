import { cn } from "@/lib/cn";

export const BRAND_NAME = "ordinaryextraordinary";

/** 아치형 워드마크 각 글자의 중심 각도(도, 수학 좌표계) — 원본 로고에서 측정 */
const ARC_ANGLES = [
  192, 180.35, 169.65, 161.4, 152.95, 141.4, 129.95, 119.75, 109.7, 99.8, 89.4, 78.8, 68.2, 56.95, 44.9, 34.45, 26.5,
  18.25, 7.1, -3.9, -13.25,
];
const ARC_WORD = "ORDINARYEXTRAORDINARY";

/** 원 경로 (evenodd 구멍용) */
const disc = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/**
 * 동그란 안경 + 눈동자 (흑백 플랫). 좌표 원점 = 안경 중심.
 * compact: 20~26px 크기용 — 선을 굵게, 눈동자를 키워 작은 크기에서도 글자 굵기와 어울리게.
 */
function GlassesShape({ compact = false }: { compact?: boolean }) {
  const stroke = compact ? 34 : 21;
  const lensR = 106.5 - stroke / 2; // 바깥 지름은 원본과 동일하게 유지
  const pupilR = compact ? 44 : 38;
  const hi = compact ? { dx: 18, dy: -18, r: 15 } : { dx: 19, dy: -18.5, r: 13 };
  return (
    <>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round">
        <circle cx="-124" r={lensR} />
        <circle cx="124" r={lensR} />
        <path d={`M-32-27.5Q1-41.5 34-27.5M${-238 + (compact ? 4 : 0)} 0h22M${238 - (compact ? 4 : 0)} 0h-22`} />
      </g>
      {/* 눈동자 + 하이라이트(구멍) */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d={[-124, 124.5].map((cx) => disc(cx, 0, pupilR) + disc(cx + hi.dx, hi.dy, hi.r)).join("")}
      />
    </>
  );
}

/** 안경 심볼만 (GNB 등 작은 자리). 크기는 className의 너비(w-*)로 지정, 높이는 비율 자동 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-256 -110 512 220"
      className={cn("block h-auto w-6 shrink-0 text-ink", className)}
      role="img"
      aria-label={`${BRAND_NAME} 로고`}
    >
      <GlassesShape compact />
    </svg>
  );
}

/** 전체 로고: 아치형 'ORDINARYEXTRAORDINARY' + 안경 심볼. width 기준 크기 */
export function BrandLogo({ width = 200, className }: { width?: number; className?: string }) {
  return (
    <svg
      viewBox="-470 -458 940 608"
      width={width}
      height={(width * 608) / 940}
      className={cn("shrink-0 text-ink", className)}
      role="img"
      aria-label={`${BRAND_NAME} 로고`}
    >
      <g fill="currentColor" fontWeight={600} fontSize={104} textAnchor="middle">
        {[...ARC_WORD].map((c, i) => (
          <text key={i} transform={`rotate(${+(90 - ARC_ANGLES[i]).toFixed(2)})`} y={-370}>
            {c}
          </text>
        ))}
      </g>
      <GlassesShape />
    </svg>
  );
}

/** 소문자 워드마크 (흑백): ordinary(세미볼드·연한 잉크) + extraordinary(볼드) */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap lowercase leading-none tracking-[-0.03em]", className)} aria-label={BRAND_NAME}>
      <span className="font-semibold text-ink/60">ordinary</span>
      <span className="font-bold text-ink">extraordinary</span>
    </span>
  );
}

/** [안경 심볼] + [워드마크] */
export function BrandLockup({ markClassName, textClassName }: { markClassName?: string; textClassName?: string }) {
  return (
    <span className="inline-flex shrink-0 flex-nowrap items-center gap-1.5">
      <BrandMark className={markClassName} />
      <BrandWordmark className={cn("shrink-0", textClassName)} />
    </span>
  );
}
