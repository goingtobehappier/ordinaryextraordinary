"use client";

import { useCallback } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { normalizeLabels, validateCategoryName } from "@/lib/categories";
import { DEFAULT_CATEGORIES, categoryStyle, type Category, type Todo } from "@/lib/types";
import { useCockpit } from "./cockpit";

type DbError = { code?: string; message: string };

const describe = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883"
    ? "태그 설정 테이블이 없습니다. supabase/migrations/014_user_categories.sql을 실행해 주세요."
    : e.message;

type CategoriesState = {
  /** 1차 태그 6개 이름 (슬롯 순서). 6번은 항상 '업무' */
  labels: string[];
  loaded: boolean;
  editorOpen: boolean;
  load: (userId?: string) => Promise<void>;
  reset: () => void;
  setEditorOpen: (open: boolean) => void;
  /**
   * 1~5번 슬롯 이름 변경 (slot: 0-based).
   * DB 설정 + 기존 할 일의 1차 태그를 한 트랜잭션으로 바꾸고, 화면의 할 일도 즉시 반영.
   * 성공 시 null, 실패 시 오류 문구.
   */
  rename: (slot: number, name: string) => Promise<string | null>;
};

export const useCategories = create<CategoriesState>()((set, get) => ({
  labels: [...DEFAULT_CATEGORIES],
  loaded: false,
  editorOpen: false,

  load: async (forUser) => {
    const userId = forUser ?? useCockpit.getState().userId;
    if (!userId) return;
    const { data, error } = await createClient()
      .from("user_categories")
      .select("labels")
      .eq("user_id", userId)
      .maybeSingle();
    // 테이블이 없거나 행이 없으면 기본 이름
    const labels = error || !data ? [...DEFAULT_CATEGORIES] : normalizeLabels(data.labels);
    set({ labels, loaded: true });
    // 저장된 필터에 더 이상 없는 이름(다른 기기에서 변경)이 남아 있으면 제거
    const { activeCategories, monthCategories } = useCockpit.getState();
    if ([...activeCategories, ...monthCategories].some((c) => !labels.includes(c))) {
      useCockpit.setState({
        activeCategories: activeCategories.filter((c) => labels.includes(c)),
        monthCategories: monthCategories.filter((c) => labels.includes(c)),
      });
    }
  },

  reset: () => set({ labels: [...DEFAULT_CATEGORIES], loaded: false, editorOpen: false }),
  setEditorOpen: (open) => set({ editorOpen: open }),

  rename: async (slot, rawName) => {
    const labels = get().labels;
    const name = rawName.trim();
    const invalid = validateCategoryName(labels, slot, name);
    if (invalid) return invalid;
    const old = labels[slot];
    if (old === name) return null;

    const { data, error } = await createClient().rpc("rename_category", { p_slot: slot + 1, p_name: name });
    if (error) return describe(error);
    set({ labels: normalizeLabels(data) });
    applyRenameLocally(old, name);
    return null;
  },
}));

/** 화면에 불러온 할 일·필터를 새 이름으로 (DB는 rename_category가 이미 변경) */
function applyRenameLocally(old: Category, next: Category) {
  const swap = (t: Todo) => (t.category === old ? { ...t, category: next } : t);
  useCockpit.setState((s) => ({
    todos: s.todos.map(swap),
    overdue: s.overdue.map(swap),
    activeCategories: s.activeCategories.map((c) => (c === old ? next : c)),
    monthCategories: s.monthCategories.map((c) => (c === old ? next : c)),
    rev: s.rev + 1,
  }));
}

/** 현재 1차 태그 이름 6개 */
export const useCategoryLabels = () => useCategories((s) => s.labels);

/** 1차 태그 이름 → 색상 (슬롯 기준) */
export function useCategoryStyle() {
  const labels = useCategoryLabels();
  return useCallback((c: Category) => categoryStyle(labels, c), [labels]);
}
