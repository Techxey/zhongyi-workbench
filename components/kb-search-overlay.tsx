"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KB_TABS } from "@/lib/kb";
import { getKbContext, hasKbInsertHandler, requestKbInsert, type KbInsertPayload } from "@/lib/kb-bridge";

type Hit = {
  id: string;
  type: "formula" | "herb" | "case" | "classic";
  name: string;
  source: string | null;
  aliases: string[];
  components: { name: string; dose: string }[];
  herbCount: number;
  efficacy: string;
  indication: string;
  usageText: string;
  version: number;
  usageCount: number;
  overlap: number;
  reason: string;
  /** 古籍：简介、字数、章节数、正文命中片段 */
  intro?: string;
  chars?: number;
  chapters?: number;
  snippet?: string;
};

type ClassicChapter = { title: string; text: string };

type ClassicBook = {
  id: string;
  name: string;
  source: string | null;
  intro: string;
  chars: number;
  chapters: ClassicChapter[];
};

function formatChars(chars: number | undefined): string {
  if (!chars) return "";
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)} 万字`;
  return `${chars} 字`;
}

type SearchResult = {
  query: string;
  intents: { kind: string; text: string; norm: string }[];
  tabs: Record<string, { hits: Hit[]; matched: number }>;
  index: { formulas: number; herbs: number; cases: number; classics: number; loadedAt: string };
};

const EMPTY: SearchResult = {
  query: "",
  intents: [],
  tabs: {
    formula: { hits: [], matched: 0 },
    herb: { hits: [], matched: 0 },
    case: { hits: [], matched: 0 },
    classic: { hits: [], matched: 0 },
  },
  index: { formulas: 0, herbs: 0, cases: 0, classics: 0, loadedAt: "" },
};

const INTENT_LABEL: Record<string, string> = {
  symptom: "症状",
  syndrome: "证型",
  formula: "方剂",
  herb: "中药",
};

export function KbSearchOverlay() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>("formula");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult>(EMPTY);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Ctrl/Cmd + K 打开；Esc 关闭
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开时聚焦输入框、重置选中与查询
  useEffect(() => {
    if (!open) return;
    setActive(0);
    setHint(null);
    setExpanded(null);
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 查询：180ms 防抖 + 带当前病历上下文
  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const context = getKbContext();
        const params = new URLSearchParams({ q: query });
        if (context.symptoms.length) params.set("symptoms", context.symptoms.join("|"));
        if (context.syndrome) params.set("syndrome", context.syndrome);
        const response = await fetch(`/api/kb/search?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (data.ok) {
          setResult(data as SearchResult);
          setActive(0);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") setHint("检索失败，请重试");
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const current = result.tabs[tab] ?? { hits: [], matched: 0 };
  const hits = current.hits;

  // 新一次检索结果里，当前页签没命中、别的页签有命中时自动切过去（避免"方剂 0 条"挡住真正的命中）
  const autoTabRef = useRef("");
  useEffect(() => {
    if (!result.query || result.query === autoTabRef.current) return;
    autoTabRef.current = result.query;
    if ((result.tabs[tab]?.hits.length ?? 0) > 0) return;
    const next = ["formula", "herb", "case", "classic"].find(
      (key) => (result.tabs[key]?.hits.length ?? 0) > 0,
    );
    if (next) setTab(next);
  }, [result, tab]);

  // 古籍展开：拉取正文（章节标题 + 该章前 200 字）
  const [book, setBook] = useState<ClassicBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const expandedClassicId = tab === "classic" && expanded && hits.some((hit) => hit.id === expanded) ? expanded : null;

  useEffect(() => {
    if (!expandedClassicId) {
      setBook(null);
      setBookError(null);
      return;
    }
    let alive = true;
    setBook(null);
    setBookError(null);
    fetch(`/api/kb/search?id=${encodeURIComponent(expandedClassicId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!alive) return;
        if (data?.ok && data.book) setBook(data.book as ClassicBook);
        else setBookError(data?.message ?? "读取条文失败");
      })
      .catch(() => {
        if (alive) setBookError("读取条文失败");
      });
    return () => {
      alive = false;
    };
  }, [expandedClassicId]);

  const insert = useCallback(
    (hit: Hit) => {
      // 古籍不能带进处方：Enter 只展开条文
      if (hit.type === "classic") {
        setExpanded((value) => (value === hit.id ? null : hit.id));
        return;
      }
      const payload: KbInsertPayload = {
        type: hit.type === "herb" ? "herb" : "formula",
        name: hit.name,
        source: hit.source,
        components: hit.components,
        usageText: hit.usageText,
        kbItemId: hit.id,
        kbItemVersion: hit.version,
      };
      if (!hasKbInsertHandler()) {
        setHint("在接诊台页面里才能带入处方（当前为浏览模式）");
        return;
      }
      requestKbInsert(payload);
      setOpen(false);
    },
    [],
  );

  // 键盘：↑↓ 选择、Enter 带入、→ 作展开用（详情行内展开）、Tab 在浮层内循环
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      if (hits[active]) {
        event.preventDefault();
        insert(hits[active]);
      }
    } else if (event.key === "ArrowRight") {
      const input = inputRef.current;
      const atInputEnd = event.target === input && input && input.selectionStart === input.value.length;
      if (event.target !== input || atInputEnd) {
        const hit = hits[active];
        if (hit) {
          event.preventDefault();
          setExpanded((current) => (current === hit.id ? null : hit.id));
        }
      }
    } else if (event.key === "Tab") {
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, a[href], [tabindex="0"]',
      );
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes);
      const first = list[0];
      const last = list[list.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
  }

  // 选中行滚进视野
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open, hits.length]);

  const tabCounts = useMemo(() => {
    const record: Record<string, number> = {};
    for (const item of KB_TABS) {
      const bucket = result.tabs[item.type];
      record[item.type] = query.trim() ? bucket?.matched ?? 0 : result.index[
        item.type === "formula"
          ? "formulas"
          : item.type === "herb"
            ? "herbs"
            : item.type === "case"
              ? "cases"
              : "classics"
      ] ?? 0;
    }
    return record;
  }, [result, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center items-start bg-[rgba(20,22,26,0.36)] px-6 pt-[8vh] pb-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="知识库检索"
      data-kb-overlay
    >
      <div
        ref={panelRef}
        onKeyDown={onKeyDown}
        className="w-full max-w-[980px] max-h-[78vh] flex flex-col bg-surface border border-line rounded-overlay shadow-pop overflow-hidden"
      >
        {/* 1 搜索行 */}
        <div className="h-[60px] shrink-0 flex items-center gap-3 px-5 border-b border-line-2">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入方名、药名、书名、症状或证型，如「失眠」「伤寒论」「太阳之为病」"
            className="flex-1 bg-transparent outline-none text-[18px] text-ink placeholder:text-ink-4"
            aria-label="知识库检索输入"
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? <span className="text-[11px] text-ink-4">检索中…</span> : null}
          <kbd className="text-[11px] text-ink-4 border border-line rounded-[5px] px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* 2 意图识别行 */}
        <div className="shrink-0 px-5 pt-3 pb-2 flex flex-wrap items-center gap-2 min-h-[38px]">
          {result.intents.length > 0 ? (
            <>
              <span className="text-[11px] text-ink-4 mr-0.5">识别为</span>
              {result.intents.map((intent) => (
                <span key={`${intent.kind}-${intent.norm}`} className="chip chip-lg">
                  <span className="text-ink-4 mr-1">{INTENT_LABEL[intent.kind] ?? "词条"}</span>
                  <span className="text-ink-2">{intent.norm}</span>
                </span>
              ))}
            </>
          ) : (
            <span className="text-[11.5px] text-ink-4">
              {query.trim()
                ? "没有识别出结构化词条，按全文匹配"
                : "空着也能查：按使用次数与完整度排序，先看看常用方"}
            </span>
          )}
        </div>

        {/* 3 页签 */}
        <div
          className="shrink-0 px-5 flex items-center gap-5 border-b border-line-2"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            const index = KB_TABS.findIndex((entry) => entry.type === tab);
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const next = KB_TABS[(index + delta + KB_TABS.length) % KB_TABS.length];
            event.preventDefault();
            setTab(next.type);
            setActive(0);
          }}
        >
          {KB_TABS.map((item) => {
            const isActive = tab === item.type;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => {
                  setTab(item.type);
                  setActive(0);
                }}
                className={`relative h-[38px] text-[13px] transition-colors ${
                  isActive ? "text-brand font-semibold" : "text-ink-3 hover:text-ink"
                }`}
              >
                {item.label}
                <span className={`ml-1.5 text-[11px] num ${isActive ? "text-brand" : "text-ink-4"}`}>
                  {tabCounts[item.type] ?? 0}
                </span>
                {isActive ? <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-brand" /> : null}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-ink-4">排序：症状吻合 → 用过次数 → 条目完整度</span>
        </div>

        {/* 4 结果列表 */}
        <div ref={listRef} className="overflow-y-auto py-1 max-h-[calc(78vh-190px)]">
          {hits.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[13px] text-ink-2 mb-1">
                {query.trim() ? `没有找到与「${query.trim()}」相关的${KB_TABS.find((item) => item.type === tab)?.label}` : "知识库还是空的"}
              </p>
              <p className="text-[12px] text-ink-4">
                {query.trim()
                  ? tab === "classic"
                    ? "换个书名，或直接搜条文关键字（如「太阳之为病」），会到正文里找"
                    : "换个说法，或先到「知识库 → 导入」把这批方药导进来"
                  : "先到「知识库 → 导入」用 CSV 导入你的方剂与中药"}
              </p>
            </div>
          ) : (
            hits.map((hit, index) => {
              const isActive = index === active;
              const isExpanded = expanded === hit.id;
              return (
                <div key={hit.id} className={isActive ? "bg-ghost" : ""}>
                  <button
                    type="button"
                    data-row={index}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => insert(hit)}
                    className={`w-full text-left px-5 py-3 flex items-start gap-4 transition-colors ${
                      isActive ? "" : "hover:bg-ghost/60"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-serif text-[16px] text-ink">{hit.name}</span>
                        {hit.type === "classic" ? (
                          <span className="chip chip-brand !h-[20px] !text-[11px]">古籍</span>
                        ) : hit.aliases.length > 0 ? (
                          <span className="text-[11.5px] text-ink-4 truncate">
                            {hit.aliases.slice(0, 2).join(" / ")}
                          </span>
                        ) : null}
                        {hit.snippet ? (
                          <span className="chip chip-brand !h-[20px] !text-[11px]">正文命中</span>
                        ) : null}
                        {hit.overlap > 0 ? (
                          <span className="chip chip-brand !h-[20px] !text-[11px]">吻合 {hit.overlap} 项</span>
                        ) : null}
                      </div>
                      {hit.type === "classic" ? (
                        <>
                          <p className="mt-0.5 text-[11.5px] text-ink-4 truncate">
                            {[
                              hit.source || "作者未标",
                              formatChars(hit.chars),
                              hit.chapters ? `${hit.chapters} 章` : null,
                              `v${hit.version}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {hit.intro ? (
                            <p className="mt-0.5 text-[12px] text-ink-3 truncate">{hit.intro}</p>
                          ) : null}
                          {hit.snippet ? (
                            <p className="mt-1 text-[12.5px] text-ink-2 font-serif truncate">{hit.snippet}</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-0.5 text-[11.5px] text-ink-4 truncate">
                          {[
                            hit.source || "出处未标",
                            hit.type === "formula" ? `${hit.herbCount} 味` : "中药",
                            hit.efficacy || hit.indication || "—",
                            `v${hit.version}`,
                            hit.usageCount > 0 ? `用过 ${hit.usageCount} 次` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 self-center text-[11.5px] text-ink-4">
                      {hit.type === "classic"
                        ? isExpanded
                          ? "Enter 收起"
                          : "Enter 看条文"
                        : hit.type === "formula"
                          ? "Enter 带入处方"
                          : "Enter 带入"}
                    </span>
                  </button>
                  {isExpanded ? (
                    hit.type === "classic" ? (
                      <div className="px-5 pb-3.5 -mt-1 text-[12px] text-ink-2">
                        <p className="text-[11px] text-ink-4 mb-1.5">条文 · 章节标题 + 该章前 200 字</p>
                        {book ? (
                          book.chapters.length === 0 ? (
                            <p className="text-ink-3">这本书没有可读的章节。</p>
                          ) : (
                            (() => {
                              const needle = result.query.trim();
                              const matched = needle
                                ? book.chapters.filter(
                                    (chapter) => chapter.text.includes(needle) || chapter.title.includes(needle),
                                  )
                                : [];
                              const list = matched.length > 0 ? matched : book.chapters;
                              const shown = list.slice(0, 10);
                              return (
                                <>
                                  {shown.map((chapter, chapterIndex) => (
                                    <div key={`${chapterIndex}-${chapter.title}`} className="mb-2 last:mb-0">
                                      <p className="font-serif text-[13px] text-ink">
                                        {chapter.title || `第 ${chapterIndex + 1} 章`}
                                      </p>
                                      <p className="font-serif text-[12.5px] text-ink-2 leading-relaxed text-pretty">
                                        {chapter.text.slice(0, 200)}
                                        {chapter.text.length > 200 ? "…" : ""}
                                      </p>
                                    </div>
                                  ))}
                                  {list.length > shown.length ? (
                                    <p className="text-[11px] text-ink-4 mt-1">
                                      还有 {list.length - shown.length} 章 · 到「知识库 → 古籍」看全文
                                    </p>
                                  ) : null}
                                </>
                              );
                            })()
                          )
                        ) : bookError ? (
                          <p className="text-danger">{bookError}</p>
                        ) : (
                          <p className="text-ink-3">正在读取条文…</p>
                        )}
                        <p className="text-ink-4 mt-1.5">
                          {hit.source ?? "作者未标"} · {formatChars(hit.chars)} · 第 {hit.version} 版
                        </p>
                      </div>
                    ) : (
                      <div className="px-5 pb-3.5 -mt-1 text-[12px] text-ink-2 space-y-1">
                        {hit.components.length > 0 ? (
                          <p className="font-serif text-[13px] text-ink">
                            {hit.components.map((part) => `${part.name}${part.dose}`).join("、")}
                          </p>
                        ) : null}
                        {hit.indication ? <p>主治：{hit.indication}</p> : null}
                        {hit.usageText ? <p className="text-ink-3">用法：{hit.usageText}</p> : null}
                        <p className="text-ink-4">{hit.source ?? "出处未标"} · 第 {hit.version} 版</p>
                      </div>
                    )
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* 5 底栏 */}
        <div className="shrink-0 h-[38px] px-5 bg-footer border-t border-line-2 flex items-center justify-between text-[11px] text-ink-4">
          <span className="flex items-center gap-3">
            <span>↑↓ 选择</span>
            <span>Enter 带入处方</span>
            <span>→ 查看条文</span>
            <span>←→ 切页签</span>
            <span>Esc 关闭</span>
            {hint ? <span className="text-danger">{hint}</span> : null}
          </span>
          <span className="num">
            {tab === "classic"
              ? `知识库 v3 · 古籍 ${query.trim() ? current.matched : result.index.classics} 部`
              : `知识库 v3 · 自建 · ${result.index.formulas} 方 / ${result.index.herbs} 药`}
          </span>
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="text-ink-3 shrink-0">
      <circle cx="11" cy="11" r="6.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function KbSearchTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 复用全局浮层：直接合成 Ctrl+K 事件最省事，也保证只有一个打开入口
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true });
    window.dispatchEvent(event);
    setOpen(false);
  }, [open]);

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => setOpen(true)}
      title="知识检索（Ctrl+K）"
    >
      检索 <kbd className="ml-1 text-[10.5px] text-ink-4">Ctrl K</kbd>
    </button>
  );
}
