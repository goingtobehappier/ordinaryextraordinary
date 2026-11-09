import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cockpit, CockpitSkeleton } from "@/components/cockpit/Cockpit";
import type { CockpitUser } from "@/lib/types";

export default function HomePage() {
  // 세션 읽기는 요청 시점에만 가능하므로 Suspense 경계 안에서 스트리밍
  return (
    <Suspense fallback={<CockpitSkeleton />}>
      <AuthedCockpit />
    </Suspense>
  );
}

async function AuthedCockpit() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const meta = user.user_metadata ?? {};
  const cockpitUser: CockpitUser = {
    id: user.id,
    email: user.email ?? "",
    name: meta.full_name ?? meta.name ?? user.email?.split("@")[0] ?? "사용자",
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };

  return <Cockpit user={cockpitUser} />;
}
