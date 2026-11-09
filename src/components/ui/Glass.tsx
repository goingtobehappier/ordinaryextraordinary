import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { CATEGORY_STYLE, type Category } from "@/lib/types";

/** 애플 스타일 글래스 패널 */
export function GlassPanel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/40 bg-white/70 drop-shadow-xl backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

export function GlassButton({
  className,
  variant = "ghost",
  ...props
}: ComponentProps<"button"> & { variant?: "ghost" | "primary" | "mint" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
        "transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50",
        "disabled:pointer-events-none disabled:opacity-40",
        variant === "ghost" && "text-ink-2 hover:bg-black/5 hover:text-ink",
        variant === "primary" && "bg-apple-blue text-white shadow-sm shadow-apple-blue/30 hover:bg-[#0068d9]",
        variant === "mint" && "bg-apple-mint text-white shadow-sm shadow-apple-mint/30 hover:bg-[#00b0a8]",
        variant === "danger" && "text-[#ff3b30] hover:bg-[#ff3b30]/10",
        className,
      )}
      {...props}
    />
  );
}

export function GlassInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 rounded-lg border border-black/5 bg-white/60 px-3 text-sm text-ink placeholder:text-ink-2/70",
        "outline-none transition-[box-shadow,background-color] focus:bg-white/90 focus:ring-2 focus:ring-apple-blue/40",
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.4rem] items-center justify-center rounded-md border border-black/10 bg-white/80 px-1.5",
        "font-mono text-[11px] font-medium text-ink-2 shadow-[0_1px_0_rgb(0_0_0/0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({
  category,
  className,
  ...props
}: ComponentProps<"span"> & { category: Category }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        CATEGORY_STYLE[category].badge,
        className,
      )}
      {...props}
    >
      {category}
    </span>
  );
}

export function TagChip({
  tag,
  active,
  className,
  ...props
}: ComponentProps<"span"> & { tag: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        active ? "bg-apple-mint text-white" : "bg-apple-mint/12 text-[#00857f]",
        className,
      )}
      {...props}
    >
      #{tag}
    </span>
  );
}
