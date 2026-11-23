import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * O.E. Buddy 캐릭터: 입 없는 매끈한 민트 피규어에 작고 또렷한 두 눈만 있는 미니멀 아트토이.
 * 색은 대시보드 '업무' 태그(apple-mint #00c7be / #00857f) 계열 — 위쪽 화이트 광택, 아래쪽 딥 틸 음영으로 입체감.
 * 그라데이션은 캐릭터 재질 표현에만 쓰고 화면 크롬(배경·버튼)에는 쓰지 않음.
 */
export function OEBuddy({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `${id}-body`;
  const spec = `${id}-spec`;
  const clip = `${id}-clip`;
  const SHAPE = "M32 7C46.5 7 55 17.5 55 31.5C55 46.5 45.5 56 32 56C18.5 56 9 46.5 9 31.5C9 17.5 17.5 7 32 7Z";

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("block shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* 몸통: 좌상단 광원 → 아래로 갈수록 딥 민트·틸 */}
        <radialGradient id={body} cx="0.38" cy="0.28" r="0.82">
          <stop offset="0" stopColor="#c4f7f2" />
          <stop offset="0.32" stopColor="#62e2d8" />
          <stop offset="0.72" stopColor="#12bdb2" />
          <stop offset="1" stopColor="#00958d" />
        </radialGradient>
        {/* 상단 화이트 광택 (부드럽게 퍼지는 매트 하이라이트) */}
        <radialGradient id={spec} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <path d={SHAPE} />
        </clipPath>
      </defs>

      {/* 발 */}
      <ellipse cx="23.5" cy="56.2" rx="5.2" ry="3" fill="#00968e" />
      <ellipse cx="40.5" cy="56.2" rx="5.2" ry="3" fill="#00968e" />

      {/* 몸통 + 얇은 윤곽(흰 글래스 위에서 형태가 또렷하도록) */}
      <path d={SHAPE} fill={`url(#${body})`} stroke="#00857f" strokeOpacity="0.28" strokeWidth="0.9" />
      <g clipPath={`url(#${clip})`}>
        {/* 하단 딥 틸 음영 */}
        <ellipse cx="34" cy="58.5" rx="27" ry="10" fill="#006b66" opacity="0.3" />
        {/* 바닥에서 올라오는 은은한 반사광 */}
        <ellipse cx="30" cy="52.6" rx="12.5" ry="2.4" fill="#d2fbf7" opacity="0.4" />
      </g>
      {/* 스페큘러 하이라이트 + 작은 반짝임 */}
      <ellipse cx="22.5" cy="16.5" rx="10.5" ry="5.8" transform="rotate(-28 22.5 16.5)" fill={`url(#${spec})`} />
      <circle cx="16.8" cy="22.6" r="1.4" fill="#ffffff" opacity="0.75" />

      {/* 두 눈 + 눈동자 광택 */}
      <ellipse cx="25" cy="33" rx="2.9" ry="3.9" fill="#1d2a29" />
      <ellipse cx="39" cy="33" rx="2.9" ry="3.9" fill="#1d2a29" />
      <circle cx="26" cy="31.3" r="1.1" fill="#ffffff" />
      <circle cx="40" cy="31.3" r="1.1" fill="#ffffff" />
      <circle cx="24.3" cy="35" r="0.55" fill="#ffffff" opacity="0.55" />
      <circle cx="38.3" cy="35" r="0.55" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}
