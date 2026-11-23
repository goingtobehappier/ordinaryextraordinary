import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * O.E. Manager 캐릭터: 브랜드 안경(동그란 렌즈 + 눈동자)을 쓴 작은 3D 피규어.
 * 몸통은 대시보드 강조색(apple-blue) 계열의 볼륨 음영, 좌상단 스페큘러 하이라이트, 하단 반사광으로 입체감.
 * 그라데이션은 캐릭터 재질 표현에만 쓰고 화면 크롬(배경·버튼)에는 쓰지 않음.
 */
export function OEBuddy({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `${id}-body`;
  const spec = `${id}-spec`;
  const clip = `${id}-clip`;
  const lens = `${id}-lens`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("block shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* 몸통: 좌상단 광원 → 우하단으로 어두워지는 볼륨 */}
        <radialGradient id={body} cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#6db4ff" />
          <stop offset="0.45" stopColor="#1f86ff" />
          <stop offset="0.85" stopColor="#0062cc" />
          <stop offset="1" stopColor="#004fa8" />
        </radialGradient>
        {/* 스페큘러: 매트한 플라스틱 피규어 느낌으로 부드럽게 퍼지는 하이라이트 */}
        <radialGradient id={spec} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* 렌즈: 아주 옅은 유리 톤 */}
        <radialGradient id={lens} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e8f1fb" />
        </radialGradient>
        <clipPath id={clip}>
          <path d="M32 7C46.5 7 55 17.5 55 31.5C55 46.5 45.5 56 32 56C18.5 56 9 46.5 9 31.5C9 17.5 17.5 7 32 7Z" />
        </clipPath>
      </defs>

      {/* 발 */}
      <ellipse cx="23.5" cy="56.2" rx="5.2" ry="3" fill="#0057b8" />
      <ellipse cx="40.5" cy="56.2" rx="5.2" ry="3" fill="#0057b8" />

      {/* 몸통 + 내부 음영·반사광 */}
      <path
        d="M32 7C46.5 7 55 17.5 55 31.5C55 46.5 45.5 56 32 56C18.5 56 9 46.5 9 31.5C9 17.5 17.5 7 32 7Z"
        fill={`url(#${body})`}
      />
      <g clipPath={`url(#${clip})`}>
        {/* 하단 앰비언트 음영 */}
        <ellipse cx="34" cy="58" rx="26" ry="9" fill="#003a7d" opacity="0.28" />
        {/* 바닥에서 튀는 은은한 반사광 */}
        <ellipse cx="30" cy="52.5" rx="13" ry="2.6" fill="#9fd0ff" opacity="0.35" />
      </g>
      {/* 스페큘러 하이라이트 + 작은 반짝임 */}
      <ellipse cx="22" cy="16.5" rx="10" ry="5.6" transform="rotate(-28 22 16.5)" fill={`url(#${spec})`} />
      <circle cx="16.6" cy="22.4" r="1.4" fill="#ffffff" opacity="0.7" />

      {/* 볼 터치 */}
      <ellipse cx="16.5" cy="40" rx="3.6" ry="2.1" fill="#ff8fa3" opacity="0.55" />
      <ellipse cx="47.5" cy="40" rx="3.6" ry="2.1" fill="#ff8fa3" opacity="0.55" />

      {/* 브랜드 안경: 렌즈 + 테 + 브리지 */}
      <g stroke="#262626" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="23" cy="31" r="7.6" fill={`url(#${lens})`} />
        <circle cx="41" cy="31" r="7.6" fill={`url(#${lens})`} />
        <path d="M29.6 29.2Q32 27.9 34.4 29.2M15.4 30.4H12.4M48.6 30.4H51.6" fill="none" />
      </g>
      {/* 눈동자 + 눈 반짝임 */}
      <circle cx="24.2" cy="32" r="3.3" fill="#262626" />
      <circle cx="42.2" cy="32" r="3.3" fill="#262626" />
      <circle cx="25.4" cy="30.7" r="1.15" fill="#ffffff" />
      <circle cx="43.4" cy="30.7" r="1.15" fill="#ffffff" />
      {/* 렌즈 유리 반사 */}
      <path d="M18.6 27.6Q20 25.4 22.6 25" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M36.6 27.6Q38 25.4 40.6 25" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.9" />

      {/* 입 */}
      <path d="M29 42.2Q32 44.8 35 42.2" stroke="#0b3d7a" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  );
}
