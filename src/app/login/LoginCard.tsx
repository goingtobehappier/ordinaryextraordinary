"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { GlassPanel } from "@/components/ui/Glass";
import { BrandLogo, BrandWordmark } from "@/components/ui/Brand";

export function LoginCard() {
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const router = useRouter();

  // 세션 리스너: 이미 로그인됐거나(다른 탭 포함) 로그인이 완료되면 메인 스케줄러로
  useEffect(() => {
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        router.replace("/");
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  async function signInWithGoogle() {
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    // 성공 시 Google로 이동하므로 여기 도달하지 않음
    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <GlassPanel className="relative w-[420px] px-10 py-12 text-center">
      <BrandLogo width={220} className="mx-auto mb-6" />

      <h1 className="sr-only">
        <BrandWordmark />
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
        평범한 하루를 특별하게.
        <br />일정 · 할 일 · 데일리 노트를 한 화면에서.
      </p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={pending}
        className="mt-10 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-black/10 bg-white text-[15px] font-medium text-ink shadow-sm transition-[transform,box-shadow,background-color] duration-150 hover:bg-white/90 hover:shadow-md active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-5 animate-spin text-ink-2" /> : <GoogleLogo />}
        {pending ? "Google로 이동 중…" : "구글 계정으로 시작하기"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg bg-[#ff3b30]/10 px-3 py-2 text-left text-[13px] text-[#c4271d]"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <p className="mt-8 text-xs text-ink-2/80">
        계정마다 데이터가 분리되어, 본인의 일정과 메모만 보입니다.
      </p>
    </GlassPanel>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
