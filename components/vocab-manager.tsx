"use client";

import { useState, useTransition } from "react";

import { addConsultTerm, deleteConsultTerm } from "@/lib/vocabulary-actions";
import {
  VOCAB_CATEGORIES,
  VOCAB_HINTS,
  VOCAB_LABELS,
  type VocabCategory,
  type VocabItem,
} from "@/lib/vocabulary";

type Grouped = Record<VocabCategory, VocabItem[]>;

export function VocabManager({ initial }: { initial: Grouped }) {
  const [groups, setGroups] = useState<Grouped>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2600);
  }

  function remove(category: VocabCategory, item: VocabItem) {
    if (
      !window.confirm(
        `删除「${item.term}」？\n删除后所有患者的接诊台都不再出现这一条；已保存的病历不受影响。`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteConsultTerm(item.id);
      if (!result.ok) {
        flash(result.message ?? "删除失败");
        return;
      }
      setGroups((prev) => ({
        ...prev,
        [category]: prev[category].filter((row) => row.id !== item.id),
      }));
      flash(`已删除「${item.term}」`);
    });
  }

  function add(category: VocabCategory, raw: string) {
    const term = raw.trim();
    if (!term) return;
    startTransition(async () => {
      const result = await addConsultTerm({ category, term });
      if (!result.ok) {
        flash(result.message);
        return;
      }
      setGroups((prev) => {
        const list = prev[category];
        const exists = list.some((row) => row.term === result.item.term);
        return {
          ...prev,
          [category]: exists ? list.map((row) => (row.id === result.item.id ? result.item : row)) : [...list, result.item],
        };
      });
      flash(`已加入「${result.item.term}」`);
    });
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div className="card px-4 py-2.5">
          <p className="text-[12.5px] text-brand">{message}</p>
        </div>
      ) : null}

      {VOCAB_CATEGORIES.map((category) => (
        <section key={category} className="card">
          <div className="px-5 h-[50px] flex items-center justify-between border-b border-line-2">
            <div className="flex items-baseline gap-2.5">
              <h2 className="section-title">{VOCAB_LABELS[category]}</h2>
              <span className="text-[11.5px] text-ink-4">{VOCAB_HINTS[category]}</span>
            </div>
            <span className="text-[11.5px] text-ink-4 num">{groups[category].length} 条</span>
          </div>
          <div className="px-5 py-4 space-y-3">
            <ul className="flex flex-wrap gap-2">
              {groups[category].map((item) => (
                <li key={item.id} className="group relative inline-flex">
                  <span className="chip chip-lg" title={item.hint ?? undefined}>
                    {item.term}
                    {item.useCount > 0 ? (
                      <span className="ml-1.5 text-[10.5px] text-ink-4 num">{item.useCount}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(category, item)}
                    disabled={pending}
                    title={`删除「${item.term}」`}
                    aria-label={`删除${item.term}`}
                    className="absolute -top-1 -right-1 w-[15px] h-[15px] rounded-full bg-surface border border-line text-ink-4 text-[10px] leading-none grid place-items-center opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity"
                  >
                    ×
                  </button>
                </li>
              ))}
              {groups[category].length === 0 ? (
                <li className="text-[12.5px] text-ink-4">还没有词条，下面加一条即可。</li>
              ) : null}
            </ul>
            <AddRow
              label={VOCAB_LABELS[category]}
              placeholder={`新增${VOCAB_LABELS[category]}，如「${category === "tongue" ? "舌质偏暗" : category === "pulse" ? "脉濡缓" : category === "syndrome" ? "肝郁化火" : "疏肝清热"}」`}
              onAdd={(value) => add(category, value)}
              disabled={pending}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function AddRow({
  label,
  placeholder,
  onAdd,
  disabled,
}: {
  label: string;
  placeholder: string;
  onAdd: (value: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(value);
        setValue("");
      }}
    >
      <input
        className="input h-[32px] text-[12.5px] max-w-[280px]"
        placeholder={placeholder}
        value={value}
        maxLength={20}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        aria-label={`新增${label}`}
      />
      <button type="submit" className="btn btn-ghost h-[32px] text-[12.5px]" disabled={disabled || !value.trim()}>
        ＋ 添加
      </button>
      <span className="text-[11px] text-ink-4">回车即保存，保存后所有患者的接诊台都能用</span>
    </form>
  );
}
