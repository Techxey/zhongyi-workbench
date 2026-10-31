"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { addConsultTerm, deleteConsultTerm } from "@/lib/vocabulary-actions";
import {
  VOCAB_LABELS,
  visibleTerms,
  type VocabCategory,
  type VocabItem,
} from "@/lib/vocabulary";

type Props = {
  category: VocabCategory;
  items: VocabItem[];
  /** multi：多选（舌象/脉象）；single：单选（证型/治法） */
  mode?: "multi" | "single";
  selected: string[];
  onToggle: (term: string, item: VocabItem | null) => void;
  ariaLabel?: string;
  /** 是否显示「＋自定义」入口 */
  allowAdd?: boolean;
  visibleCount?: number;
};

/**
 * 数据库词库驱动的标签行：点选、hover 删除（删了全站都少一条）、末尾可新增自定义词。
 * 舌象/脉象是 multi，证型/治法是 single。
 */
export function TermChips({
  category,
  items,
  mode = "multi",
  selected,
  onToggle,
  ariaLabel,
  allowAdd = true,
  visibleCount = 12,
}: Props) {
  const [list, setList] = useState<VocabItem[]>(items);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeIndex = useRef(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setList(items);
  }, [items]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  // 刚加的自定义词条即使频次还低也要露出来，否则医生加完一取消选中就“找不到了”
  const shown = (() => {
    const base = visibleTerms(list, selected, visibleCount);
    const extra = list.filter(
      (item) => addedIds.includes(item.id) && !base.some((row) => row.id === item.id),
    );
    return [...base, ...extra];
  })();

  function commitAdd() {
    const term = value.trim();
    if (!term) {
      setAdding(false);
      setValue("");
      return;
    }
    startTransition(async () => {
      const result = await addConsultTerm({ category, term });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setList((prev) =>
        prev.some((item) => item.term === result.item.term) ? prev : [...prev, result.item],
      );
      setAddedIds((prev) => (prev.includes(result.item.id) ? prev : [...prev, result.item.id]));
      setError(null);
      setAdding(false);
      setValue("");
      onToggle(result.item.term, result.item);
    });
  }

  function remove(item: VocabItem) {
    if (!window.confirm(`从词库删除「${item.term}」？删除后会从所有患者的接诊台移除（已保存的病历不受影响）。`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteConsultTerm(item.id);
      if (!result.ok) {
        setError(result.message ?? "删除失败");
        return;
      }
      setList((prev) => prev.filter((row) => row.id !== item.id));
      setAddedIds((prev) => prev.filter((id) => id !== item.id));
      if (selected.includes(item.term)) onToggle(item.term, null);
    });
  }

  return (
    <div className="flex-1 min-w-0">
      <div
        role="group"
        aria-label={ariaLabel ?? VOCAB_LABELS[category]}
        data-kb-stop
        tabIndex={0}
        className="rounded-[6px]"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          if (shown.length === 0) return;
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const next = (activeIndex.current + direction + shown.length) % shown.length;
          activeIndex.current = next;
          buttons.current[next]?.focus();
        }}
      >
        <div className="flex flex-wrap gap-2">
          {shown.map((item, index) => {
            const isSelected = selected.includes(item.term);
            return (
              <span key={item.id} className="relative inline-flex group">
                <button
                  type="button"
                  tabIndex={-1}
                  ref={(element) => {
                    buttons.current[index] = element;
                  }}
                  aria-pressed={isSelected}
                  title={item.hint ?? undefined}
                  onClick={() => onToggle(item.term, item)}
                  className={
                    isSelected
                      ? "chip chip-lg chip-brand"
                      : "chip chip-lg hover:border-line-strong"
                  }
                >
                  {item.term}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  title={`删除「${item.term}」`}
                  aria-label={`删除${item.term}`}
                  onClick={() => remove(item)}
                  className="absolute -top-1 -right-1 w-[15px] h-[15px] rounded-full bg-surface border border-line text-ink-4 text-[10px] leading-none grid place-items-center opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity"
                >
                  ×
                </button>
              </span>
            );
          })}

          {adding ? (
            <input
              ref={inputRef}
              className="h-[28px] px-2.5 rounded-[6px] border border-brand bg-surface text-[12.5px] text-ink w-[128px] outline-none"
              placeholder={`新${VOCAB_LABELS[category]}，回车保存`}
              value={value}
              maxLength={20}
              disabled={pending}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => {
                if (!value.trim()) setAdding(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitAdd();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(false);
                  setValue("");
                }
              }}
            />
          ) : allowAdd ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setAdding(true)}
              className="chip chip-lg border-dashed text-ink-4 hover:text-brand hover:border-brand"
            >
              ＋ 自定义
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-1.5 text-[11.5px] text-danger">{error}</p> : null}
      {mode === "single" && selected.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-ink-4">再点一次可取消选中，也可直接在下方手写。</p>
      ) : null}
    </div>
  );
}
