import { connection } from "next/server";

/** 현재 서버에 배포된 빌드 ID — 오래 열어 둔 PWA가 새 배포를 감지하는 데 사용 (캐시 금지) */
export async function GET() {
  await connection();
  return Response.json({ id: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
