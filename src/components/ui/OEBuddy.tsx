import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * O.E. Buddy 캐릭터: 아래가 통통한 모찌·물방울형 민트 피규어 + 머리 위 작은 둥근 귀 두 개.
 * 입 없이 두 눈(작은 하이라이트)만으로 표정. 색은 대시보드 '업무' 태그(apple-mint #00c7be / #00857f) 계열 —
 * 위쪽 매트한 빛 반사, 아래쪽 딥 민트 음영으로 클레이·아트토이 질감.
 * 그라데이션은 캐릭터 재질 표현에만 쓰고 화면 크롬(배경·버튼)에는 쓰지 않음.
 */
const BODY =
  "M32 9.5C42.6 9.5 49.4 17 51.8 27.2C53.6 34.6 57.5 40.4 57.5 47C57.5 54.6 46.9 58.5 32 58.5C17.1 58.5 6.5 54.6 6.5 47C6.5 40.4 10.4 34.6 12.2 27.2C14.6 17 21.4 9.5 32 9.5Z";

export function OEBuddy({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `${id}-body`;
  const ear = `${id}-ear`;
  const spec = `${id}-spec`;
  const clip = `${id}-clip`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("block shrink-0 overflow-visible", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* 몸통: 좌상단 광원 → 아래로 갈수록 딥 민트 */}
        <radialGradient id={body} cx="0.4" cy="0.26" r="0.86">
          <stop offset="0" stopColor="#bff6f1" />
          <stop offset="0.3" stopColor="#5ee0d6" />
          <stop offset="0.7" stopColor="#14bdb2" />
          <stop offset="1" stopColor="#00958d" />
        </radialGradient>
        <radialGradient id={ear} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#8debe3" />
          <stop offset="1" stopColor="#10b3a9" />
        </radialGradient>
        {/* 매트 클레이 하이라이트: 넓고 부드럽게 퍼짐 */}
        <radialGradient id={spec} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* 머리 위 작은 둥근 귀 (몸통 뒤) */}
      <circle cx="22" cy="13.2" r="4.6" fill={`url(#${ear})`} stroke="#00857f" strokeOpacity="0.25" strokeWidth="0.8" />
      <circle cx="42" cy="13.2" r="4.6" fill={`url(#${ear})`} stroke="#00857f" strokeOpacity="0.25" strokeWidth="0.8" />
      <circle cx="20.9" cy="11.9" r="1.4" fill="#ffffff" opacity="0.55" />
      <circle cx="40.9" cy="11.9" r="1.4" fill="#ffffff" opacity="0.55" />

      {/* 몸통 + 얇은 윤곽 */}
      <path d={BODY} fill={`url(#${body})`} stroke="#00857f" strokeOpacity="0.3" strokeWidth="0.9" />
      <g clipPath={`url(#${clip})`}>
        {/* 하단 딥 민트 음영 (통통한 아랫배의 볼륨) */}
        <ellipse cx="34" cy="60" rx="30" ry="11" fill="#006b66" opacity="0.3" />
        {/* 바닥에서 올라오는 은은한 반사광 */}
        <ellipse cx="30" cy="55.2" rx="11" ry="1.8" fill="#d2fbf7" opacity="0.18" />
        {/* 오른쪽 옆면 그늘 */}
        <ellipse cx="58" cy="40" rx="9" ry="20" fill="#00756f" opacity="0.18" />
      </g>
      {/* 상단 빛 반사 + 작은 반짝임 */}
      <ellipse cx="24" cy="20.5" rx="9.5" ry="5.4" transform="rotate(-24 24 20.5)" fill={`url(#${spec})`} />
      <circle cx="18.6" cy="26.2" r="1.2" fill="#ffffff" opacity="0.7" />

      {/* 두 눈 + 하이라이트 (입 없음) */}
      <ellipse cx="25" cy="37" rx="2.7" ry="3.6" fill="#1d2a29" />
      <ellipse cx="39" cy="37" rx="2.7" ry="3.6" fill="#1d2a29" />
      <circle cx="26" cy="35.4" r="1.05" fill="#ffffff" />
      <circle cx="40" cy="35.4" r="1.05" fill="#ffffff" />
      <circle cx="24.3" cy="38.9" r="0.5" fill="#ffffff" opacity="0.55" />
      <circle cx="38.3" cy="38.9" r="0.5" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}
