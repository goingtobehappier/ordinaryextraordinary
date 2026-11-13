import { cn } from "@/lib/cn";

export const BRAND_NAME = "ordinaryextraordinary";

/** 아치형 워드마크 각 글자의 중심 각도(도, 수학 좌표계) — 원본 로고에서 측정 */
const ARC_ANGLES = [
  192, 180.35, 169.65, 161.4, 152.95, 141.4, 129.95, 119.75, 109.7, 99.8, 89.4, 78.8, 68.2, 56.95, 44.9, 34.45, 26.5,
  18.25, 7.1, -3.9, -13.25,
];
const ARC_WORD = "ORDINARYEXTRAORDINARY";

/** 동그란 안경 + 눈동자 (흑백 플랫). 좌표 원점 = 안경 중심 */
function GlassesShape() {
  return (
    <>
      <g fill="none" stroke="currentColor" strokeWidth="21" strokeLinecap="round">
        <circle cx="-124" r="91.5" />
        <circle cx="124" r="91.5" />
        <path d="M-32-27.5Q1-41.5 34-27.5M-238 0h22M238 0h-22" />
      </g>
      {/* 눈동자 + 하이라이트(구멍) */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M-162 0a38 38 0 1 0 76 0a38 38 0 1 0-76 0ZM-119-18.5a13 13 0 1 0 26 0a13 13 0 1 0-26 0ZM86.5 0a38 38 0 1 0 76 0a38 38 0 1 0-76 0ZM131-18.5a13 13 0 1 0 26 0a13 13 0 1 0-26 0Z"
      />
    </>
  );
}

/** 안경 심볼만 (GNB 등 작은 자리). height 기준 크기 */
export function BrandMark({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="-252 -106 504 212"
      height={height}
      width={(height * 504) / 212}
      className={cn("shrink-0 text-ink", className)}
      role="img"
      aria-label={`${BRAND_NAME} 로고`}
    >
      <GlassesShape />
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
export function BrandLockup({ markHeight = 24, textClassName }: { markHeight?: number; textClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark height={markHeight} />
      <BrandWordmark className={textClassName} />
    </span>
  );
}
