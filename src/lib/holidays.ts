/**
 * 대한민국 관공서 공휴일·대체공휴일 (「관공서의 공휴일에 관한 규정」 기준)
 *
 * - 양력 고정 공휴일은 규칙으로, 음력 공휴일(설·추석·부처님오신날)과 선거일은 연도별 표로 관리
 * - 표에 없는 연도는 음력 공휴일이 빠지므로 해마다 LUNAR 표를 한 줄씩 추가할 것
 * - 대체공휴일
 *   · 설·추석 연휴: 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 비공휴일
 *   · 삼일절·노동절·어린이날·부처님오신날·제헌절·광복절·개천절·한글날·성탄절:
 *     토·일요일 또는 다른 공휴일과 겹치면 다음 첫 비공휴일 평일
 *   · 신정·현충일·선거일은 대체공휴일 없음
 *   · 여러 공휴일이 같은 날 겹치면 그 날짜당 대체공휴일 1일 (예: 2025-05-05 → 05-06)
 */

type Lunar = {
  /** 설날 당일 (전날·다음날 포함 3일 연휴) */
  seollal: string;
  /** 추석 당일 (전날·다음날 포함 3일 연휴) */
  chuseok: string;
  buddha: string;
  /** 선거일 등 그해 확정된 임시·법정 휴일 */
  extra?: Record<string, string>;
};

const LUNAR: Record<number, Lunar> = {
  2024: { seollal: "2024-02-10", chuseok: "2024-09-17", buddha: "2024-05-15", extra: { "2024-04-10": "국회의원선거일", "2024-10-01": "국군의 날" } },
  2025: { seollal: "2025-01-29", chuseok: "2025-10-06", buddha: "2025-05-05", extra: { "2025-01-27": "임시공휴일", "2025-06-03": "대통령선거일" } },
  2026: { seollal: "2026-02-17", chuseok: "2026-09-25", buddha: "2026-05-24", extra: { "2026-06-03": "지방선거일" } },
  2027: { seollal: "2027-02-07", chuseok: "2027-09-15", buddha: "2027-05-13" },
  2028: { seollal: "2028-01-27", chuseok: "2028-10-03", buddha: "2028-05-02", extra: { "2028-04-12": "국회의원선거일" } },
  2029: { seollal: "2029-02-13", chuseok: "2029-09-22", buddha: "2029-05-20" },
  2030: { seollal: "2030-02-03", chuseok: "2030-09-12", buddha: "2030-05-09" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shift = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const dow = (s: string) => parse(s).getDay(); // 0=일 … 6=토

type Base = { date: string; name: string; rule: "none" | "festival" | "national" };

function baseHolidays(year: number): Base[] {
  const list: Base[] = [];
  const add = (md: string, name: string, rule: Base["rule"]) => list.push({ date: `${year}-${md}`, name, rule });

  add("01-01", "신정", "none");
  add("03-01", "삼일절", "national");
  if (year >= 2026) add("05-01", "노동절", "national");
  add("05-05", "어린이날", "national");
  add("06-06", "현충일", "none");
  if (year >= 2027) add("07-17", "제헌절", "national");
  add("08-15", "광복절", "national");
  add("10-03", "개천절", "national");
  add("10-09", "한글날", "national");
  add("12-25", "성탄절", "national");

  const lunar = LUNAR[year];
  if (lunar) {
    for (const [day, label] of [[lunar.seollal, "설날"], [lunar.chuseok, "추석"]] as const) {
      list.push({ date: shift(day, -1), name: `${label} 연휴`, rule: "festival" });
      list.push({ date: day, name: label, rule: "festival" });
      list.push({ date: shift(day, 1), name: `${label} 연휴`, rule: "festival" });
    }
    list.push({ date: lunar.buddha, name: "부처님오신날", rule: "national" });
    for (const [date, name] of Object.entries(lunar.extra ?? {})) list.push({ date, name, rule: "none" });
  }
  return list;
}

const cache = new Map<number, Map<string, string>>();

function holidaysOf(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;

  const base = baseHolidays(year);
  const map = new Map<string, string>();
  for (const h of base) map.set(h.date, map.has(h.date) ? `${map.get(h.date)} · ${h.name}` : h.name);

  // 대체공휴일이 필요한 날짜 (날짜당 1회). 설·추석은 연휴 마지막 날 다음부터 찾음
  const needs: { from: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const h of [...base].sort((a, b) => a.date.localeCompare(b.date))) {
    if (h.rule === "none" || seen.has(h.date)) continue;
    const same = base.filter((x) => x.date === h.date);
    const overlap = same.length > 1;
    const wd = dow(h.date);
    const weekend = same.some((x) => (x.rule === "festival" ? wd === 0 : x.rule === "national" ? wd === 0 || wd === 6 : false));
    if (!overlap && !weekend) continue;
    seen.add(h.date);
    const festival = same.find((x) => x.rule === "festival");
    let from = h.date;
    if (festival) {
      // 연휴의 마지막 날까지 이동
      while (base.some((x) => x.rule === "festival" && x.date === shift(from, 1))) from = shift(from, 1);
    }
    needs.push({ from, name: (festival ?? same.find((x) => x.rule === "national") ?? h).name.replace(" 연휴", "") });
  }

  for (const n of needs) {
    let d = shift(n.from, 1);
    while (dow(d) === 0 || dow(d) === 6 || map.has(d)) d = shift(d, 1);
    map.set(d, `대체공휴일(${n.name})`);
  }

  cache.set(year, map);
  return map;
}

/** 해당 날짜(YYYY-MM-DD)가 공휴일·대체공휴일이면 이름, 아니면 null */
export function getKoreanHoliday(dateStr: string): string | null {
  const year = Number(dateStr.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return holidaysOf(year).get(dateStr.slice(0, 10)) ?? null;
}

/** 휴무일: 토·일요일 또는 공휴일·대체공휴일 */
export function isOffDay(dateStr: string): boolean {
  const d = dow(dateStr.slice(0, 10));
  return d === 0 || d === 6 || getKoreanHoliday(dateStr) !== null;
}
