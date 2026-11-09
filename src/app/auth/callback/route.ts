import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Google OAuth 리다이렉트를 받아 PKCE code를 세션으로 교환합니다. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  // 오픈 리다이렉트 방지: 내부 경로만 허용
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const oauthError = searchParams.get("error_description") ?? "로그인 코드가 없습니다.";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
}
