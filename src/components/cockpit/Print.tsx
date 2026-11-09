"use client";

import { Printer } from "lucide-react";
import { GlassButton } from "@/components/ui/Glass";
import { BRAND_NAME } from "@/components/ui/Brand";
import type { DateRange } from "@/store/cockpit";

/**
 * 'A4 출력 / PDF 저장' 버튼 → window.print().
 * PDF 저장 시 기본 파일명이 되도록 인쇄하는 동안 문서 제목을 바꿔 둠.
 */
export function PrintButton({ fileName, disabled }: { fileName: string; disabled?: boolean }) {
  function print() {
    const prev = document.title;
    document.title = fileName;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }
  return (
    <GlassButton onClick={print} disabled={disabled} className="text-xs" title="A4 용지로 인쇄하거나 PDF로 저장">
      <Printer className="size-4" />
      A4 출력 / PDF 저장
    </GlassButton>
  );
}

const fmt = (iso: string) => iso.replaceAll("-", ".");

/** 인쇄물 상단 제목 블록 (화면에서는 숨김) */
export function PrintHeader({ title, range, meta }: { title: string; range: DateRange; meta: string }) {
  const printedAt = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  return (
    <header className="hidden print:mb-5 print:block print:border-b-2 print:border-black print:pb-2.5">
      <p className="text-[9pt] tracking-wide">{BRAND_NAME}</p>
      <h1 className="mt-1 text-[16pt] font-bold leading-tight">{title}</h1>
      <p className="mt-1 text-[9.5pt]">
        조회 기간 {fmt(range.start)} ~ {fmt(range.end)} · {meta} · 출력 {printedAt}
      </p>
    </header>
  );
}
