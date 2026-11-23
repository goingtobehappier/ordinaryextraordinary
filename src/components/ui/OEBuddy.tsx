import Image from "next/image";
import { cn } from "@/lib/cn";

/** 투명 배경 전신 이미지 (public/oe-buddy.png에서 흰 배경 제거·여백 트림, 512×525) */
export const OE_BUDDY_FULL = { src: "/oe-buddy-clean.png", ratio: 525 / 512 };
/** 작은 자리용: 얼굴·안경 중심 정사각 크롭 (512×512) */
export const OE_BUDDY_ICON = "/oe-buddy-icon.png";

/**
 * O.E. Buddy 캐릭터 (동그란 안경을 쓴 민트 3D 피규어).
 * full = 전신(플로팅 버튼 등) / icon = 얼굴 중심 정사각(헤더·작은 아이콘)
 * size = 표시 너비(px)
 */
export function OEBuddy({
  variant = "full",
  size,
  className,
  alt = "",
  priority,
}: {
  variant?: "full" | "icon";
  size: number;
  className?: string;
  alt?: string;
  priority?: boolean;
}) {
  const full = variant === "full";
  return (
    <Image
      src={full ? OE_BUDDY_FULL.src : OE_BUDDY_ICON}
      width={size}
      height={full ? Math.round(size * OE_BUDDY_FULL.ratio) : size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      priority={priority}
      draggable={false}
      className={cn("block shrink-0 select-none object-contain", className)}
    />
  );
}
