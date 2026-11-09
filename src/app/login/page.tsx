import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginCard } from "./LoginCard";

// 루트 layout의 title 템플릿 → "로그인 · ordinaryextraordinary"
export const metadata: Metadata = { title: "로그인" };

export default function LoginPage() {
  return (
    <main className="relative flex h-full min-h-screen items-center justify-center overflow-hidden p-6">
      {/* 배경 오브 */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-[560px] rounded-full bg-apple-blue/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 size-[620px] rounded-full bg-apple-mint/25 blur-3xl" />

      <Suspense fallback={<div className="h-[420px] w-[420px]" />}>
        <LoginCard />
      </Suspense>
    </main>
  );
}
