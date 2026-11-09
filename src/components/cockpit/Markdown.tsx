"use client";

import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * 가벼운 마크다운 렌더러 (HTML 주입 없이 React 노드로만 렌더링 → XSS 안전).
 * 지원: 제목, 목록/번호 목록(들여쓰기), 체크박스, 인용, 코드 블록, 구분선,
 *       **굵게**, *기울임*, ~~취소선~~, `코드`, [링크](url), 자동 링크
 */
export function Markdown({
  source,
  onToggleTask,
}: {
  source: string;
  onToggleTask?: (lineIndex: number) => void;
}) {
  const lines = source.split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={`p${i}`} className="my-2 leading-relaxed">
          {para.map((l, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {inline(l)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록
    if (/^\s*```/.test(line)) {
      flushPara();
      const start = i;
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++; // 닫는 ```
      out.push(
        <pre key={`c${start}`} className="my-2 overflow-x-auto rounded-lg bg-ink/[0.06] p-3 font-mono text-[12.5px] leading-relaxed scroll-thin">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const cls = [
        "mt-4 mb-2 text-[21px] font-bold tracking-[-0.02em]",
        "mt-4 mb-1.5 text-[18px] font-semibold tracking-[-0.01em]",
        "mt-3 mb-1 text-[15.5px] font-semibold",
        "mt-3 mb-1 text-sm font-semibold",
        "mt-2 mb-1 text-sm font-semibold text-ink-2",
        "mt-2 mb-1 text-xs font-semibold uppercase text-ink-2",
      ][level - 1];
      const Tag = `h${level}` as "h1";
      out.push(
        <Tag key={`h${i}`} className={cls}>
          {inline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushPara();
      out.push(<hr key={`hr${i}`} className="my-4 border-black/10" />);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushPara();
      const start = i;
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(
        <blockquote key={`q${start}`} className="my-2 border-l-[3px] border-apple-mint/60 pl-3 text-ink-2">
          {quote.map((q, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {inline(q)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (list) {
      flushPara();
      const start = i;
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        const ordered = /\d/.test(m[2]);
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
        const idx = i;
        items.push(
          <li key={idx} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: depth * 18 }}>
            {task ? (
              <button
                type="button"
                onClick={() => onToggleTask?.(idx)}
                className={cn(
                  "mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors",
                  task[1] !== " " ? "border-apple-mint bg-apple-mint" : "border-black/25 hover:border-apple-mint",
                )}
                aria-label="체크 전환"
              >
                <Check className={cn("size-3 text-white", task[1] === " " && "opacity-0")} strokeWidth={3} />
              </button>
            ) : ordered ? (
              <span className="min-w-4 shrink-0 text-right tabular-nums text-ink-2">{m[2]}</span>
            ) : (
              <span className="mt-[9px] size-[5px] shrink-0 rounded-full bg-ink/50" />
            )}
            <span className={cn("leading-relaxed", task && task[1] !== " " && "text-ink-2 line-through")}>
              {inline(task ? task[2] : m[3])}
            </span>
          </li>,
        );
        i++;
      }
      out.push(
        <ul key={`l${start}`} className="my-1.5">
          {items}
        </ul>,
      );
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();

  return <div className="text-[14px] text-ink">{out}</div>;
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g;

function safeHref(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    if (m[1]) {
      nodes.push(
        <code key={k++} className="rounded-md bg-ink/[0.07] px-1 py-px font-mono text-[12.5px]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      nodes.push(<strong key={k++} className="font-semibold">{inline(tok.slice(2, -2))}</strong>);
    } else if (m[3]) {
      nodes.push(<del key={k++} className="text-ink-2">{inline(tok.slice(2, -2))}</del>);
    } else if (m[4]) {
      nodes.push(<em key={k++}>{inline(tok.slice(1, -1))}</em>);
    } else if (m[5]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]);
      nodes.push(
        href ? (
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer" className="text-apple-blue underline-offset-2 hover:underline">
            {inline(lm[1])}
          </a>
        ) : (
          lm[1]
        ),
      );
    } else if (m[6]) {
      nodes.push(
        <a key={k++} href={tok} target="_blank" rel="noopener noreferrer" className="break-all text-apple-blue underline-offset-2 hover:underline">
          {tok}
        </a>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
