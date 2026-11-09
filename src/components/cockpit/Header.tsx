"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, Keyboard, List, ListTree, Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit, type ViewMode } from "@/store/cockpit";
import { cn } from "@/lib/cn";
import { formatCombo } from "@/hooks/useHotkeys";
import type { CockpitUser } from "@/lib/types";
import { GlassButton, GlassPanel, Kbd } from "@/components/ui/Glass";
import { SearchBar } from "./SearchBar";
import { BrandLockup } from "@/components/ui/Brand";

export function Header({ user }: { user: CockpitUser }) {
  const setShortcutsOpen = useCockpit((s) => s.setShortcutsOpen);
  const openCombo = useCockpit((s) => s.shortcuts.openShortcuts);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <GlassPanel className="relative z-30 flex h-16 shrink-0 print:hidden items-center gap-6 rounded-2xl px-5">
      <Link href="/" className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40" aria-label="ordinaryextraordinary 홈">
        <BrandLockup size={34} textClassName="text-[18px]" />
      </Link>

      <SearchBar />

      <div className="ml-auto flex items-center gap-2">
        <ViewSwitcher />
        <GlassButton onClick={() => setShortcutsOpen(true)} title="단축키 설정">
          <Keyboard className="size-4" />
          단축키
          <span className="ml-1 flex gap-0.5">
            {formatCombo(openCombo).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </GlassButton>

        <div className="mx-2 h-8 w-px bg-black/10" />

        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            // Google 프로필 이미지는 외부 도메인이므로 next/image 대신 img 사용
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-9 rounded-full border-2 border-white object-cover shadow-sm"
            />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-full bg-apple-blue/15 text-sm font-semibold text-apple-blue">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="max-w-[220px] leading-tight">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-ink-2">{user.email}</div>
          </div>
        </div>

        <GlassButton onClick={signOut} disabled={signingOut} title="로그아웃" className="ml-1">
          {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          로그아웃
        </GlassButton>
      </div>
    </GlassPanel>
  );
}

const VIEWS: { id: ViewMode; label: string; icon: typeof List; action: "viewDay" | "viewWeek" | "viewMonth" }[] = [
  { id: "day", label: "일간", icon: List, action: "viewDay" },
  { id: "week", label: "주간", icon: CalendarRange, action: "viewWeek" },
  { id: "month", label: "월별 보기", icon: CalendarDays, action: "viewMonth" },
];

/** 일간 / 주간 / 월별 보기 전환 */
function ViewSwitcher() {
  const view = useCockpit((s) => s.view);
  const setView = useCockpit((s) => s.setView);
  const openSummary = useCockpit((s) => s.openSummary);
  const shortcuts = useCockpit((s) => s.shortcuts);
  return (
    <div className="flex rounded-lg bg-black/5 p-0.5" role="tablist" aria-label="보기 전환">
      {VIEWS.map(({ id, label, icon: Icon, action }) => (
        <button
          key={id}
          role="tab"
          aria-selected={view === id}
          onClick={() => setView(id)}
          title={label + " (" + shortcuts[action] + ")"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-[background-color,color,box-shadow]",
            view === id ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
      <button
        role="tab"
        aria-selected={view === "summary"}
        onClick={openSummary}
        title={"요약 (" + shortcuts.viewSummary + ")"}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-[background-color,color,box-shadow]",
          view === "summary" ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
        )}
      >
        <ListTree className="size-4" />
        요약
      </button>
    </div>
  );
}
