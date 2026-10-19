import { useMemo, type ReactNode, type RefObject } from "react";

export type Category = "grammar" | "vocabulary" | "coherence" | "task" | "strength";

export const CATEGORY_LABEL: Record<Category, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  coherence: "Organisation",
  task: "Task",
  strength: "Strength",
};

export interface Highlight {
  key: string;
  start: number;
  end: number;
  category: Category;
  muted?: boolean;
}

/** Renders the essay verbatim with highlighted spans. Text is never altered, so DOM offsets = essay offsets. */
export function Essay({
  text,
  highlights,
  active,
  onPick,
  innerRef,
}: {
  text: string;
  highlights: Highlight[];
  active?: string | null;
  onPick?: (key: string) => void;
  innerRef?: RefObject<HTMLDivElement | null>;
}) {
  const parts = useMemo(() => {
    const sorted = [...highlights].sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let pos = 0;
    for (const h of sorted) {
      if (h.start < pos) continue;
      if (h.start > pos) out.push(text.slice(pos, h.start));
      out.push(
        <mark
          key={h.key}
          className={`hl hl-${h.category}${h.muted ? " hl-muted" : ""}${active === h.key ? " hl-active" : ""}`}
          onClick={onPick ? () => onPick(h.key) : undefined}
          title={CATEGORY_LABEL[h.category]}
        >
          {text.slice(h.start, h.end)}
        </mark>,
      );
      pos = h.end;
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }, [text, highlights, active, onPick]);

  return (
    <div className="essay" ref={innerRef}>
      {parts}
    </div>
  );
}

/** Character offsets of the current selection inside `container`, or null. */
export function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const offsetOf = (node: Node, offset: number) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === node) return total + offset;
      total += n.textContent?.length ?? 0;
    }
    return total;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return end > start ? { start, end } : null;
}

export function Tag({ category }: { category: Category }) {
  return <span className={`tag tag-${category}`}>{CATEGORY_LABEL[category]}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
export const num = (x: number | null | undefined, d = 2) => (x == null ? "–" : x.toFixed(d));
