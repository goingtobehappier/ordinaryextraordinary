import { cn } from "@/lib/cn";
import { OEBuddy, OE_BUDDY_FULL } from "./OEBuddy";

export const BRAND_NAME = "ordinaryextraordinary";

/** 아치형 워드마크 각 글자의 중심 각도(도, 수학 좌표계) — 원본 로고에서 측정 */
const ARC_ANGLES = [
  192, 180.35, 169.65, 161.4, 152.95, 141.4, 129.95, 119.75, 109.7, 99.8, 89.4, 78.8, 68.2, 56.95, 44.9, 34.45, 26.5,
  18.25, 7.1, -3.9, -13.25,
];
const ARC_WORD = "ORDINARYEXTRAORDINARY";

/**
 * 브랜드 심볼: O.E. Buddy 캐릭터 얼굴(동그란 안경 + 눈) 아이콘 (GNB·탭 등 작은 자리).
 * 크기는 className의 size-* / h-* w-* 로 지정 (기본 20px).
 */
export function BrandMark({ className }: { className?: string }) {
  return <OEBuddy variant="icon" size={40} alt={`${BRAND_NAME} 로고`} className={cn("size-5", className)} />;
}

/** 전체 로고: 아치형 'ORDINARYEXTRAORDINARY' + 가운데 O.E. Buddy 캐릭터. width 기준 크기 */
export function BrandLogo({ width = 200, className }: { width?: number; className?: string }) {
  // 아치 안쪽(반지름 370) 가운데에 전신 캐릭터 배치
  const figW = 360;
  const figH = Math.round(figW * OE_BUDDY_FULL.ratio);
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
      <image href={OE_BUDDY_FULL.src} x={-figW / 2} y={150 - figH} width={figW} height={figH} />
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

/** [캐릭터 아이콘] + [워드마크] — 아이콘은 글자 높이보다 크지 않게, 세로 가운데 정렬 */
export function BrandLockup({ markClassName, textClassName }: { markClassName?: string; textClassName?: string }) {
  return (
    <span className="inline-flex shrink-0 flex-nowrap items-center gap-1.5">
      <BrandMark className={markClassName} />
      <BrandWordmark className={cn("shrink-0", textClassName)} />
    </span>
  );
}
