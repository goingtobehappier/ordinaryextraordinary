"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Pencil, X } from "lucide-react";
import { useCategories } from "@/store/categories";
import { CATEGORY_NAME_MAX, validateCategoryName } from "@/lib/categories";
import { SLOT_STYLES, WORK_SLOT } from "@/lib/types";
import { cn } from "@/lib/cn";
import { GlassButton } from "@/components/ui/Glass";

/**
 * 1차 태그 이름 편집 모달.
 * 슬롯은 항상 6개(추가·삭제·순서 변경 없음). 1~5번만 이름 변경, 6번 '업무'는 잠금.
 * 저장 시 사용자 설정과 기존 할 일의 1차 태그가 함께 새 이름으로 바뀜.
 */
export function CategoryEditor() {
  const labels = useCategories((s) => s.labels);
  const rename = useCategories((s) => s.rename);
  const setOpen = useCategories((s) => s.setEditorOpen);

  const [draft, setDraft] = useState<string[]>(() => [...labels]);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [saving, setOpen]);

  // 슬롯별 검사: 빈 값·길이·금지 문자·다른 슬롯(현재 이름 또는 편집 중인 이름)과 중복
  const errors = useMemo(
    () =>
      draft.map((d, i) => {
        if (i === WORK_SLOT || d.trim() === labels[i]) return null;
        return (
          validateCategoryName(labels, i, d) ??
          (draft.some((o, j) => j !== i && o.trim() === d.trim()) ? "다른 태그와 이름이 같습니다." : null)
        );
      }),
    [draft, labels],
  );
  const changed = draft.some((d, i) => i !== WORK_SLOT && d.trim() !== labels[i]);
  const canSave = changed && errors.every((e) => !e) && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setServerError(null);
    for (let i = 0; i < WORK_SLOT; i++) {
      if (draft[i].trim() === labels[i]) continue;
      const err = await rename(i, draft[i]);
      if (err) {
        setServerError(`${i + 1}번 태그: ${err}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 backdrop-blur-sm print:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && setOpen(false)}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-editor-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="max-h-[90dvh] w-[min(440px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/40 bg-white/80 p-4 shadow-2xl backdrop-blur-2xl sm:p-6 scroll-thin"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-apple-blue/10">
            <Pencil className="size-5 text-apple-blue" />
          </div>
          <div>
            <h2 id="category-editor-title" className="text-[17px] font-semibold">
              1차 태그 편집
            </h2>
            <p className="text-xs text-ink-2">1~5번 이름만 바꿀 수 있어요. 기존 할 일의 태그도 함께 바뀝니다.</p>
          </div>
          <GlassButton type="button" className="ml-auto px-2" onClick={() => setOpen(false)} disabled={saving} aria-label="닫기">
            <X className="size-4" />
          </GlassButton>
        </div>

        <ol className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5 bg-white/60">
          {draft.map((d, i) => {
            const locked = i === WORK_SLOT;
            const err = errors[i];
            return (
              <li key={i} className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-4 text-center font-mono text-xs text-ink-2">{i + 1}</span>
                  <span className={cn("size-2.5 shrink-0 rounded-full", SLOT_STYLES[i].dot)} />
                  {locked ? (
                    <div
                      className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 text-sm text-ink-2"
                      title="'업무' 태그는 이름 변경·삭제·순서 변경이 불가능합니다"
                    >
                      <span className="font-medium">{d}</span>
                      <span className="ml-auto flex items-center gap-1 text-[11px]">
                        <Lock className="size-3.5" /> 고정
                      </span>
                    </div>
                  ) : (
                    <input
                      value={d}
                      maxLength={CATEGORY_NAME_MAX}
                      disabled={saving}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((prev) => prev.map((x, j) => (j === i ? v : x)));
                        setServerError(null);
                      }}
                      aria-label={`${i + 1}번 태그 이름`}
                      aria-invalid={!!err}
                      className={cn(
                        "h-9 min-w-0 flex-1 rounded-lg border bg-white/70 px-2.5 text-sm outline-none focus:ring-2",
                        err ? "border-[#ff3b30]/50 focus:ring-[#ff3b30]/30" : "border-black/5 focus:ring-apple-blue/40",
                      )}
                    />
                  )}
                </div>
                {err && <p className="mt-1 pl-[42px] text-[11px] text-[#d1281e]">{err}</p>}
              </li>
            );
          })}
        </ol>

        {serverError && <p className="mt-3 text-xs text-[#d1281e]">{serverError}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <GlassButton type="button" onClick={() => setOpen(false)} disabled={saving}>
            취소
          </GlassButton>
          <GlassButton
            type="submit"
            disabled={!canSave}
            variant="primary"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            저장
          </GlassButton>
        </div>
      </form>
    </div>
  );
}
