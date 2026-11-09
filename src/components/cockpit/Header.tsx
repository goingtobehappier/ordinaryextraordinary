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
    // 데스크톱: 한 줄(h-16) / 태블릿·모바일: 검색창을 아랫줄 전체 폭으로 내려 줄바꿈
    <GlassPanel className="relative z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2.5 rounded-2xl px-3 py-2.5 sm:px-5 md:flex-nowrap md:gap-x-4 lg:h-16 lg:py-0 xl:gap-x-6 print:hidden">
      <Link href="/" className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40" aria-label="ordinaryextraordinary 홈">
        <BrandLockup size={34} textClassName="hidden text-[18px] sm:inline" />
      </Link>

      <SearchBar />

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <ViewSwitcher />
        <GlassButton onClick={() => setShortcutsOpen(true)} title="단축키 설정" aria-label="단축키 설정" className="px-2 xl:px-3">
          <Keyboard className="size-4 shrink-0" />
          <span className="hidden whitespace-nowrap xl:inline">단축키</span>
          <span className="ml-1 hidden gap-0.5 xl:flex">
            {formatCombo(openCombo).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </GlassButton>

        <div className="mx-1 hidden h-8 w-px bg-black/10 sm:block xl:mx-2" />

        <div className="flex min-w-0 items-center gap-3" title={`${user.name} (${user.email})`}>
          {user.avatarUrl ? (
            // Google 프로필 이미지는 외부 도메인이므로 next/image 대신 img 사용
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-9 shrink-0 rounded-full border-2 border-white object-cover shadow-sm"
            />
          ) : (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-apple-blue/15 text-sm font-semibold text-apple-blue">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="hidden min-w-0 max-w-[180px] leading-tight xl:block 2xl:max-w-[220px]">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-ink-2">{user.email}</div>
          </div>
        </div>

        <GlassButton onClick={signOut} disabled={signingOut} title="로그아웃" aria-label="로그아웃" className="px-2 xl:ml-1 xl:px-3">
          {signingOut ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <LogOut className="size-4 shrink-0" />}
          <span className="hidden whitespace-nowrap xl:inline">로그아웃</span>
        </GlassButton>
      </div>
    </GlassPanel>
  );
}

const VIEWS: { id: ViewMode; label: string; icon: typeof List; action: "viewDay" | "viewWeek" | "viewMonth" }[] = [
  { id: "day", label: "일간", icon: List, action: "viewDay" },
  { id: "week", label: "주간", icon: CalendarRange, action: "viewWeek" },
  { id: "month", label: "월간", icon: CalendarDays, action: "viewMonth" },
];

/** 일간 / 주간 / 월간 보기 전환 */
function ViewSwitcher() {
  const view = useCockpit((s) => s.view);
  const setView = useCockpit((s) => s.setView);
  const openSummary = useCockpit((s) => s.openSummary);
  const shortcuts = useCockpit((s) => s.shortcuts);
  return (
    <div className="flex shrink-0 rounded-lg bg-black/5 p-0.5" role="tablist" aria-label="보기 전환">
      {VIEWS.map(({ id, label, icon: Icon, action }) => (
        <button
          key={id}
          role="tab"
          aria-selected={view === id}
          aria-label={label}
          onClick={() => setView(id)}
          title={label + " (" + shortcuts[action] + ")"}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-[background-color,color,box-shadow] sm:px-2.5",
            view === id ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
      <button
        role="tab"
        aria-selected={view === "summary"}
        aria-label="요약"
        onClick={openSummary}
        title={"요약 (" + shortcuts.viewSummary + ")"}
        className={cn(
          "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-[background-color,color,box-shadow] sm:px-2.5",
          view === "summary" ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
        )}
      >
        <ListTree className="size-4 shrink-0" />
        <span className="hidden sm:inline">요약</span>
      </button>
    </div>
  );
}
