/**
 * Daily Memopad 로컬 보관소 (localStorage).
 *  - draft: 서버 저장 전/실패 시 이 기기에 둔 최신 내용. base = 이 내용이 기반한 서버 버전(updated_at)
 *  - undo : 템플릿 적용 직전 내용 또는 서버와 충돌해 밀려난 이 기기 내용 (되돌리기용)
 * 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 무시.
 */

export type NoteDraft = { content: string; savedAt: number; base: string | null };
export type NoteUndo = { content: string; reason: "template" | "conflict"; at: number };

const UNDO_TTL_MS = 7 * 24 * 60 * 60_000;
const draftKey = (userId: string, date: string) => `memopad-draft:${userId}:${date}`;
const undoKey = (userId: string, date: string) => `memopad-undo:${userId}:${date}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 성공 여부 반환 (사생활 보호 모드·용량 초과 등으로 실패하면 false) */
function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const readDraft = (userId: string, date: string) => {
  const d = read<NoteDraft>(draftKey(userId, date));
  return d && typeof d.content === "string" ? d : null;
};
/** 이 기기에 보관. 실패하면 false → 화면에 '저장 실패'로 알림 */
export const writeDraft = (userId: string, date: string, content: string, base: string | null): boolean =>
  write(draftKey(userId, date), { content, savedAt: Date.now(), base } satisfies NoteDraft);
/** 서버에 저장된 내용과 같을 때만 지움 (그 사이 더 입력한 내용은 보존) */
export const clearDraftIf = (userId: string, date: string, savedContent: string) => {
  if (readDraft(userId, date)?.content === savedContent) write(draftKey(userId, date), null);
};
export const clearDraft = (userId: string, date: string) => write(draftKey(userId, date), null);

export const readUndo = (userId: string, date: string) => {
  const u = read<NoteUndo>(undoKey(userId, date));
  if (!u || typeof u.content !== "string") return null;
  if (Date.now() - u.at > UNDO_TTL_MS) {
    write(undoKey(userId, date), null);
    return null;
  }
  return u;
};
export const writeUndo = (userId: string, date: string, undo: NoteUndo | null) => write(undoKey(userId, date), undo);
