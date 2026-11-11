import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** 서버에서 외부 ICS를 받아옴. 내부망 접근(SSRF)·대용량·무한 대기를 막고, 짧게 메모리 캐시 */

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 50;

const cache = new Map<string, { at: number; text: string }>();

export class IcsFetchError extends Error {}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new IcsFetchError("http(s) 주소만 사용할 수 있습니다.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new IcsFetchError("내부 주소는 연동할 수 없습니다.");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new IcsFetchError("주소를 찾을 수 없습니다. URL을 확인해 주세요.");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new IcsFetchError("내부 주소는 연동할 수 없습니다.");
}

async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new IcsFetchError("캘린더 파일이 너무 큽니다(8MB 초과).");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new IcsFetchError("캘린더 파일이 너무 큽니다(8MB 초과).");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

export async function fetchIcs(rawUrl: string): Promise<string> {
  const hit = cache.get(rawUrl);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  let url = new URL(rawUrl);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      await assertPublicHost(url);
      const res = await fetch(url, {
        redirect: "manual",
        signal,
        cache: "no-store",
        headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "User-Agent": "ordinaryextraordinary-calendar/1.0" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new IcsFetchError("리다이렉트가 너무 많습니다.");
        url = new URL(res.headers.get("location")!, url);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new IcsFetchError("접근 권한이 없습니다. 공개(비공개 주소 포함) iCal URL인지 확인해 주세요.");
      if (res.status === 404) throw new IcsFetchError("캘린더를 찾을 수 없습니다(404). URL을 확인해 주세요.");
      if (!res.ok) throw new IcsFetchError(`캘린더 서버 응답 오류 (${res.status})`);
      const text = await readLimited(res);
      if (!text.includes("BEGIN:VCALENDAR")) throw new IcsFetchError("iCal(ICS) 형식이 아닙니다. 캘린더의 'iCal 형식 주소'를 붙여 넣어 주세요.");

      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(rawUrl, { at: Date.now(), text });
      return text;
    }
  } catch (e) {
    if (e instanceof IcsFetchError) throw e;
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new IcsFetchError("캘린더 서버 응답이 너무 느립니다(10초 초과).");
    }
    throw new IcsFetchError("캘린더를 불러오지 못했습니다. URL을 확인해 주세요.");
  }
}
