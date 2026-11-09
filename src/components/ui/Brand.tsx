"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

export const BRAND_NAME = "ordinaryextraordinary";

/**
 * 원형 심볼 로고: 반투명 유리 원판 안에서 O(고리)와 E(ε 곡선)가 맞물림.
 * E가 O의 위쪽에서는 위로, 아래쪽에서는 아래로 지나가도록 O 일부를 덧그려 엮인 느낌을 줌.
 */
export function BrandLogo({ size = 34, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${uid}-${n}`;

  return (
    <span
      className={cn("inline-flex shrink-0 rounded-full shadow-[0_4px_14px_rgb(0_122_255/0.22)] backdrop-blur-md", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label={`${BRAND_NAME} 로고`}>
        <defs>
          {/* 유리 원판 */}
          <radialGradient id={id("glass")} cx="32%" cy="26%" r="80%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#eef3ff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#e7e3ff" stopOpacity="0.45" />
          </radialGradient>
          {/* 반투명 테두리 */}
          <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.25" />
          </linearGradient>
          {/* 블루 → 퍼플 광택 선 */}
          <linearGradient id={id("ink")} x1="6" y1="8" x2="30" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#007AFF" />
            <stop offset="0.55" stopColor="#5E5CE6" />
            <stop offset="1" stopColor="#AF52DE" />
          </linearGradient>
          <linearGradient id={id("halo")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#007AFF" stopOpacity="0.55" />
            <stop offset="1" stopColor="#AF52DE" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        {/* 원형 프레임 */}
        <circle cx="18" cy="18" r="17.25" fill={`url(#${id("glass")})`} stroke={`url(#${id("rim")})`} strokeWidth="1.1" />
        <circle cx="18" cy="18" r="15.4" fill="none" stroke={`url(#${id("halo")})`} strokeWidth="0.6" />

        <g fill="none" stroke={`url(#${id("ink")})`} strokeLinecap="round" strokeLinejoin="round">
          {/* O */}
          <circle cx="14.4" cy="18" r="6.1" strokeWidth="2.3" />
          {/* E (ε: 위·아래 두 곡선 + 가운데 획) */}
          <path
            d="M26.2 12.7C24.8 11.3 22.5 10.9 20.9 11.8C19.1 12.8 19 15.3 20.6 16.6C21.4 17.3 22.5 17.7 23.7 17.8C21.9 17.9 20.3 18.4 19.5 19.6C18.4 21.3 19.2 23.6 21.2 24.4C22.9 25.1 25.1 24.6 26.4 23.3"
            strokeWidth="2.1"
          />
          <path d="M23.2 17.8H26.6" strokeWidth="1.9" />
          {/* 맞물림: O의 오른쪽 아래 호를 E 위에 덧그림 */}
          <path d="M20.4 16.4A6.1 6.1 0 0 1 19.5 21.4" strokeWidth="2.3" />
        </g>

        {/* 상단 광택 하이라이트 */}
        <path d="M7.6 12.2A12.4 12.4 0 0 1 15.4 6.2" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 소문자 워드마크: ordinary(세미볼드) + extraordinary(볼드 · 로고와 같은 블루→퍼플) */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap lowercase leading-none tracking-[-0.03em]", className)} aria-label={BRAND_NAME}>
      <span className="font-semibold text-ink/75">ordinary</span>
      <span className="bg-gradient-to-r from-[#007AFF] via-[#5E5CE6] to-[#AF52DE] bg-clip-text font-bold text-transparent">
        extraordinary
      </span>
    </span>
  );
}

/** [원형 로고] + [워드마크] */
export function BrandLockup({ size = 34, textClassName }: { size?: number; textClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandLogo size={size} />
      <BrandWordmark className={textClassName} />
    </span>
  );
}
