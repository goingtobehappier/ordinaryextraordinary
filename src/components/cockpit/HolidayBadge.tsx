import { cn } from "@/lib/cn";

/** 뱃지에 쓸 짧은 이름: "대체공휴일(삼일절)" → "대체공휴일", "어린이날 · 부처님오신날" → "어린이날" */
export function shortHolidayName(name: string): string {
  return name.startsWith("대체공휴일") ? "대체공휴일" : name.split(" · ")[0];
}

/** 공휴일·대체공휴일 명칭 뱃지. 전체 이름은 title·스크린리더로 제공 */
export function HolidayBadge({
  name,
  inverted = false,
  className,
}: {
  name: string;
  /** 파란 선택 카드 위 (흰 글씨) */
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      title={name}
      aria-label={`공휴일: ${name}`}
      className={cn(
        "min-w-0 truncate whitespace-nowrap rounded-md px-1 text-[10px] font-semibold leading-4",
        inverted ? "bg-white/25 text-white" : "bg-[#ff3b30]/10 text-[#c4271d]",
        className,
      )}
    >
      {shortHolidayName(name)}
    </span>
  );
}
