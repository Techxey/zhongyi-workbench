"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { formatDateTime } from "@/lib/format";
import { saveKbVersion, toggleKbItem } from "./actions";

export type KbVersionRow = {
  version: number;
  createdAt: string;
  composition: string[];
  efficacy: string;
  indication: string;
  usageText: string;
  contraindication: string;
  commentary: string;
  batchName: string;
};

export type KbCaseInfo = {
  complaint: string;
  illness: string;
  symptoms: string;
  tongue: string;
  pulse: string;
  syndrome: string;
  treatment: string;
  advice: string;
  visitAt: string | null;
  visitNo: number | null;
  patient: string | null;
  visitId: string | null;
};

export type KbRow = {
  id: string;
  type: string;
  name: string;
  source: string | null;
  status: string;
  currentVersion: number;
  updatedAt: string;
  usageCount: number;
  aliases: string[];
  herbCount: number;
  herbNames: string[];
  efficacy: string;
  indication: string;
  /** 古籍：简介（正文前 200 字）、字数（去空白）、章节数 */
  intro?: string;
  chars?: number;
  chapters?: number;
  /** 医案：从病历存下来的结构（主诉/现病史/四诊/证型/治法/医嘱/原病历） */
  caseInfo?: KbCaseInfo;
  versions: KbVersionRow[];
};

export type KbClassicHit = {
  itemId: string;
  name: string;
  source: string | null;
  snippet: string;
  intro: string;
  chars: number;
  chapters: number;
  chapterTitle?: string | null;
};

export type KbAliasRow = {  id: string;
  term: string;
  normTerm: string;
  aliasType: string;
  weight: number;
  itemName: string | null;
  itemType: string | null;
};

export type KbBatchRow = {
  id: string;
  filename: string;
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
  createdAt: string;
  rolledBack: number;
};

const TABS = [
  { key: "formula", label: "方剂", unit: "首" },
  { key: "herb", label: "中药", unit: "味" },
  { key: "case", label: "医案", unit: "则" },
  { key: "classic", label: "古籍", unit: "部" },
  { key: "alias", label: "别名", unit: "条" },
] as const;

const ALIAS_LABEL: Record<string, string> = {
  formula_name: "方剂别名",
  herb_name: "中药别名",
  symptom: "症状词",
  syndrome: "证型词",
};

/** 古籍字数展示：3.7 万字 */
function formatChars(chars: number | undefined): string {
  if (!chars) return "—";
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)} 万字`;
  return `${chars} 字`;
}

export function KbBrowser({
  items,
  aliases,
  batches,
}: {
  items: KbRow[];
  aliases: KbAliasRow[];
  batches: KbBatchRow[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("formula");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [selected, setSelected] = useState<KbRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [visible, setVisible] = useState(120);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 40;
  /** 古籍页签：是否搜正文（FTS5 全文检索） */
  const [bodySearch, setBodySearch] = useState(false);
  const [bodyHits, setBodyHits] = useState<KbClassicHit[] | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  const bodyMode = tab === "classic" && bodySearch && query.trim().length > 0;

  // 古籍正文检索：250ms 防抖，切走页签/关掉开关就中止
  useEffect(() => {
    if (!bodyMode) {
      setBodyHits(null);
      setBodyError(null);
      setBodyLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBodyLoading(true);
      setBodyError(null);
      try {
        const params = new URLSearchParams({ q: query.trim(), limit: "60" });
        const response = await fetch(`/api/kb/classic-search?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await response.json()) as { ok: boolean; hits?: KbClassicHit[]; message?: string };
        if (!data.ok) throw new Error(data.message ?? "检索失败");
        setBodyHits(data.hits ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setBodyError((error as Error).message || "正文检索失败，请重试");
          setBodyHits([]);
        }
      } finally {
        setBodyLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [bodyMode, query]);

  const sources = useMemo(() => {
    if (tab === "alias" || tab === "classic") return ["all"];
    const set = new Set<string>();
    for (const item of items) {
      if (item.type !== tab || !item.source) continue;
      set.add(item.source);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b, "zh"))];
  }, [items, tab]);

  const scoped = useMemo(() => {
    const type = tab === "alias" ? null : tab;
    return items.filter((item) => {
      if (type && item.type !== type) return false;
      if (statusFilter === "active" && item.status === "disabled") return false;
      if (source !== "all" && item.source !== source) return false;
      return true;
    });
  }, [items, tab, statusFilter, source]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    // 古籍页签按任务要求只按书名/作者筛选，避免「简介里出现关键词」把不相干的书混进来
    if (tab === "classic") {
      return scoped.filter(
        (item) => item.name.toLowerCase().includes(q) || (item.source ?? "").toLowerCase().includes(q),
      );
    }
    return scoped.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.source ?? "").toLowerCase().includes(q) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
        item.herbNames.some((herb) => herb.toLowerCase().includes(q)) ||
        item.indication.toLowerCase().includes(q) ||
        (item.intro ?? "").toLowerCase().includes(q) ||
        item.efficacy.toLowerCase().includes(q),
    );
  }, [scoped, query, tab]);

  const filteredAliases = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter(
      (alias) =>
        alias.term.toLowerCase().includes(q) ||
        alias.normTerm.toLowerCase().includes(q) ||
        (alias.itemName ?? "").toLowerCase().includes(q),
    );
  }, [aliases, query]);

  const counts = useMemo(
    () => ({
      formula: items.filter((item) => item.type === "formula").length,
      herb: items.filter((item) => item.type === "herb").length,
      case: items.filter((item) => item.type === "case").length,
      classic: items.filter((item) => item.type === "classic").length,
      alias: aliases.length,
    }),
    [items, aliases],
  );

  // 换页签、改搜索词、改筛选都回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [tab, query, source, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice(pageSafe * PAGE_SIZE - PAGE_SIZE, pageSafe * PAGE_SIZE);
  const aliasTotalPages = Math.max(1, Math.ceil(filteredAliases.length / PAGE_SIZE));
  const aliasPageSafe = Math.min(page, aliasTotalPages);
  const pagedAliases = filteredAliases.slice(
    aliasPageSafe * PAGE_SIZE - PAGE_SIZE,
    aliasPageSafe * PAGE_SIZE,
  );

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function onToggleStatus(item: KbRow) {
    startTransition(async () => {
      const result = await toggleKbItem(item.id);
      flash(result.message);
    });
  }

  return (
    <div className="space-y-4 max-w-[1180px]">
      {/* 工具条 */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(120);
          }}
          placeholder={
            tab === "classic"
              ? bodySearch
                ? "搜书名 / 作者 / 正文（如 失眠、太阳之为病）…"
                : "搜书名（如 伤寒论、本草纲目）…"
              : "搜方名、药名、别名、功效…"
          }
          className="input w-[320px]"
          aria-label="知识库搜索"
        />
        {tab !== "alias" && tab !== "classic" ? (
          <>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="input w-[190px]"
              aria-label="按出处筛选"
            >
              {sources.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === "all" ? "全部出处" : entry}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`btn ${statusFilter === "active" ? "btn-ghost" : "btn-quiet"} h-[34px]`}
              onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
            >
              {statusFilter === "active" ? "只看在用" : "含已停用"}
            </button>
          </>
        ) : null}
        {tab === "classic" ? (
          <>
            <button
              type="button"
              className={`btn ${statusFilter === "active" ? "btn-ghost" : "btn-quiet"} h-[34px]`}
              onClick={() => setStatusFilter(statusFilter === "active" ? "all" : "active")}
            >
              {statusFilter === "active" ? "只看在用" : "含已停用"}
            </button>
            <button
              type="button"
              aria-pressed={bodySearch}
              className={`btn ${bodySearch ? "btn-primary" : "btn-quiet"} h-[34px]`}
              onClick={() => {
                setBodySearch(!bodySearch);
                setVisible(120);
              }}
              title="开启后按关键词搜索全书正文（701 部 · 8512 万字，FTS5 索引，几十毫秒）"
            >
              搜正文
            </button>
          </>
        ) : null}
        <span className="ml-auto text-[11.5px] text-ink-4">
          {tab === "alias"
            ? `${filteredAliases.length} 条别名`
            : bodyMode
              ? bodyLoading
                ? "正文检索中…"
                : `${bodyHits?.length ?? 0} 部命中正文`
              : tab === "classic"
                ? bodySearch
                  ? "输入关键词搜全书正文"
                  : `${filtered.length} 部`
                : `${filtered.length} 条`}
        </span>
        {tab === "classic" ? null : (
          <Link href="/kb/import" className="btn btn-primary h-[34px]">
            导入 CSV
          </Link>
        )}
      </div>

      {/* 页签 */}
      <div className="flex items-center gap-5 border-b border-line-2">
        {TABS.map((entry) => {
          const isActive = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setTab(entry.key);
                setSource("all");
                setVisible(120);
                setSelected(null);
              }}
              className={`relative h-[38px] text-[13px] transition-colors ${
                isActive ? "text-brand font-semibold" : "text-ink-3 hover:text-ink"
              }`}
            >
              {entry.label}
              <span className={`ml-1.5 text-[11px] num ${isActive ? "text-brand" : "text-ink-4"}`}>
                {counts[entry.key]}
              </span>
              {isActive ? <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-brand" /> : null}
            </button>
          );
        })}
      </div>

      {bodyMode ? (
        <section className="card overflow-hidden max-lg:overflow-x-auto">
          {bodyLoading && !bodyHits ? (
            <div className="px-5 py-10 text-center text-[13px] text-ink-3">正在检索全书正文…</div>
          ) : bodyError ? (
            <div className="px-5 py-10 text-center text-[13px] text-danger">{bodyError}</div>
          ) : (bodyHits?.length ?? 0) === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[13.5px] text-ink-2 mb-1">全书正文里没有查到「{query.trim()}」</p>
              <p className="text-[12.5px] text-ink-3 mb-4">
                已检索全部 701 部（8512 万字）。换个词试试，或关掉「搜正文」只按书名/作者找。
              </p>
              <button type="button" className="btn btn-ghost" onClick={() => setBodySearch(false)}>
                只按书名找
              </button>
            </div>
          ) : (
            <>
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="font-normal px-4 h-10 border-b border-line-2 w-[22%]">书名</th>
                    <th className="font-normal px-4 h-10 border-b border-line-2 w-[12%]">作者</th>
                    <th className="font-normal px-4 h-10 border-b border-line-2 w-[16%]">命中章节</th>
                    <th className="font-normal px-4 h-10 border-b border-line-2">正文片段</th>
                    <th className="font-normal px-4 h-10 border-b border-line-2 w-[10%]">字数</th>
                  </tr>
                </thead>
                <tbody>
                  {(bodyHits ?? []).slice(0, visible).map((hit) => {
                    const row = items.find((item) => item.id === hit.itemId) ?? null;
                    return (
                      <tr
                        key={hit.itemId}
                        className="border-b border-line-2 last:border-b-0 hover:bg-ghost cursor-pointer"
                        onClick={() => {
                          if (row) {
                            setSelected(row);
                            setEditing(false);
                          }
                        }}
                      >
                        <td className="px-4 py-2.5 font-serif text-[14px] text-ink">
                          {hit.name}
                          {hit.source ? null : <span className="ml-2 text-[11px] text-ink-4">佚名</span>}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] text-ink-3">{hit.source ?? "—"}</td>
                        <td className="px-4 py-2.5 text-[12px] text-ink-3">
                          {hit.chapterTitle || "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="line-clamp-2 text-[12.5px] leading-[1.6] text-ink-2">
                            {hit.snippet}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[12px] text-ink-3 num">
                          {(hit.chars ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(bodyHits?.length ?? 0) > visible ? (
                <button
                  type="button"
                  className="w-full h-[42px] text-[12.5px] text-ink-3 hover:text-brand border-t border-line-2"
                  onClick={() => setVisible(visible + 120)}
                >
                  已显示 {visible} / {bodyHits?.length ?? 0} 部，点击加载更多
                </button>
              ) : null}
            </>
          )}
        </section>
      ) : tab === "alias" ? (
        <section className="card overflow-hidden max-lg:overflow-x-auto">
          {filteredAliases.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-ink-3">
              还没有别名。导入方剂时会一并写入别名；症状/证型词在「设置 · 接诊词库」里维护。
            </p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="font-normal px-4 h-10 border-b border-line-2">别名</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2">归一为</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2">类型</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2">指向条目</th>
                </tr>
              </thead>
              <tbody>
                {pagedAliases.map((alias) => (
                  <tr key={alias.id} className="border-b border-line-2 last:border-b-0">
                    <td className="px-4 h-[42px] text-ink">{alias.term}</td>
                    <td className="px-4 h-[42px] text-ink-2">{alias.normTerm}</td>
                    <td className="px-4 h-[42px] text-ink-3 text-[12px]">
                      {ALIAS_LABEL[alias.aliasType] ?? alias.aliasType}
                    </td>
                    <td className="px-4 h-[42px] text-ink-3 text-[12px]">
                      {alias.itemName ?? "—（词表）"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={aliasPageSafe} totalPages={aliasTotalPages} total={filteredAliases.length} onChange={setPage} unit="条别名" />
        </section>
      ) : filtered.length === 0 ? (
        <section className="card px-6 py-14 text-center">
          <p className="text-[13.5px] text-ink-2 mb-1">
            {items.length === 0 ? "知识库还是空的" : "没有符合条件的条目"}
          </p>
          <p className="text-[12.5px] text-ink-3 mb-4">
            {items.length === 0
              ? "用「导入 CSV」把常用方剂和中药导进来（模板可下载），一次导入后检索立刻可用。"
              : "换个关键词，或把筛选改成「含已停用」。"}
          </p>
          <Link href="/kb/import" className="btn btn-primary">
            导入知识库
          </Link>
        </section>
      ) : (
        <section className="card overflow-hidden max-lg:overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[26%]">
                  {tab === "classic" ? "书名" : "名称"}
                </th>
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[16%]">
                  {tab === "classic" ? "作者" : "出处"}
                </th>
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[26%]">
                  {tab === "classic" ? "字数 · 章节" : tab === "formula" || tab === "case" ? "味数 · 功效" : "功效"}
                </th>
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[10%]">版本</th>
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[14%]">更新时间</th>
                <th className="font-normal px-4 h-10 border-b border-line-2 w-[8%]">状态</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-line-2 last:border-b-0 hover:bg-ghost cursor-pointer ${
                    selected?.id === item.id ? "bg-ghost" : ""
                  }`}
                  onClick={() => {
                    setSelected(item);
                    setEditing(false);
                  }}
                >
                  <td className="px-4 py-2">
                    <span className="font-serif text-[14.5px] text-ink">{item.name}</span>
                    {item.aliases.length > 0 ? (
                      <span className="ml-2 text-[11px] text-ink-4">{item.aliases.slice(0, 2).join(" / ")}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-[12.5px] text-ink-2">{item.source ?? "—"}</td>
                  {tab === "classic" ? (
                    <td className="px-4 py-2 text-[12.5px] text-ink-2 truncate max-w-[300px]">
                      {formatChars(item.chars)} · {item.chapters ? `${item.chapters} 章` : "—"}
                    </td>
                  ) : (
                    <td className="px-4 py-2 text-[12.5px] text-ink-2 truncate max-w-[300px]">
                      {tab === "formula" || tab === "case" ? `${item.herbCount} 味 · ` : ""}
                      {item.efficacy || item.indication || "—"}
                    </td>
                  )}
                  <td className="px-4 py-2 text-[12.5px] text-ink-2 num">v{item.currentVersion}</td>
                  <td className="px-4 py-2 text-[12px] text-ink-3 num">{formatDateTime(item.updatedAt)}</td>
                  <td className="px-4 py-2">
                    {item.status === "disabled" ? (
                      <span className="chip chip-danger">已停用</span>
                    ) : (
                      <span className="text-[12px] text-ink-3">在用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pageSafe} totalPages={totalPages} total={filtered.length} onChange={setPage} unit={tab === "classic" ? "部" : "条"} />
        </section>
      )}

      {batches.length > 0 ? (
        <section className="card">
          <div className="px-5 h-[46px] flex items-center justify-between border-b border-line-2">
            <h2 className="section-title">导入批次</h2>
            <span className="text-[11.5px] text-ink-4">最近 {batches.length} 次</span>
          </div>
          <ul className="text-[12.5px]">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className="px-5 h-[42px] flex items-center gap-4 border-b border-line-2 last:border-b-0"
              >
                <span className="text-ink-2 truncate max-w-[300px]">{batch.filename}</span>
                <span className="text-ink-4 num">{formatDateTime(batch.createdAt)}</span>
                <span className="text-ink-3">
                  共 {batch.totalRows} · 成功 {batch.okRows} · 警告 {batch.warnRows} · 错误 {batch.errorRows}
                </span>
                {batch.rolledBack ? <span className="chip chip-danger">已撤销</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <KbDetail
          item={selected}
          editing={editing}
          busy={busy}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(true)}
          onToggle={() => onToggleStatus(selected)}
          onSaved={(message) => {
            flash(message);
            setEditing(false);
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 card px-4 py-2.5 shadow-pop">
          <p className="text-[12.5px] text-ink">{toast}</p>
        </div>
      ) : null}
    </div>
  );
}

type ClassicChapterRow = { title: string; text: string };

type ClassicBookRow = {
  id: string;
  name: string;
  source: string | null;
  intro: string;
  chars: number;
  chapters: ClassicChapterRow[];
};

/** 古籍详情：简介 + 章节列表（可展开看条文），通过 /api/kb/search?id= 取正文 */
function ClassicDetailBody({ item, busy, onToggle }: { item: KbRow; busy: boolean; onToggle: () => void }) {
  const [book, setBook] = useState<ClassicBookRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openChapter, setOpenChapter] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setBook(null);
    setOpenChapter(null);
    fetch(`/api/kb/search?id=${encodeURIComponent(item.id)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!alive) return;
        if (data?.ok && data.book) setBook(data.book as ClassicBookRow);
        else setError(data?.message ?? "读取古籍失败");
      })
      .catch(() => {
        if (alive) setError("读取古籍失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [item.id]);

  const chapters = book?.chapters ?? [];
  const intro = item.intro || book?.intro || "";

  return (
    <div className="space-y-4">
      <div className="space-y-3 text-[13px]">
        {intro ? <Field label="简介" value={intro} serif /> : null}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[11.5px] text-ink-4 mb-0.5">全书字数</p>
            <p className="text-ink-2 num">{formatChars(item.chars ?? book?.chars)}</p>
          </div>
          <div>
            <p className="text-[11.5px] text-ink-4 mb-0.5">章节</p>
            <p className="text-ink-2 num">{chapters.length > 0 ? `${chapters.length} 章` : (item.chapters ? `${item.chapters} 章` : "—")}</p>
          </div>
          <div>
            <p className="text-[11.5px] text-ink-4 mb-0.5">状态</p>
            <p className="text-ink-2">{item.status === "disabled" ? "已停用" : "在用"}</p>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="section-title">章节条文</h3>
          {book ? <span className="text-[11.5px] text-ink-4">点击章节展开全文</span> : null}
        </div>
        {loading ? <p className="text-[12.5px] text-ink-3">正在读取正文…</p> : null}
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        {!loading && !error ? (
          chapters.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">这本书没有可读的章节内容。</p>
          ) : (
            <ul className="space-y-1.5">
              {chapters.map((chapter, index) => {
                const opened = openChapter === index;
                return (
                  <li key={`${index}-${chapter.title}`} className="border border-line-2 rounded-[8px]">
                    <button
                      type="button"
                      className="w-full px-3 py-2 flex items-center justify-between text-left"
                      onClick={() => setOpenChapter(opened ? null : index)}
                    >
                      <span className="font-serif text-[13.5px] text-ink truncate max-w-[380px]">
                        {chapter.title || `第 ${index + 1} 章`}
                      </span>
                      <span className="text-[11px] text-ink-4 shrink-0 ml-2">
                        {opened ? "收起" : `${chapter.text.length} 字`}
                      </span>
                    </button>
                    {opened ? (
                      <div className="px-3 pb-3 max-h-[420px] overflow-y-auto">
                        <p className="text-[13px] text-ink-2 leading-relaxed font-serif whitespace-pre-line">
                          {chapter.text}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`btn btn-ghost flex-1 ${item.status === "disabled" ? "text-brand" : "text-danger"}`}
          onClick={onToggle}
          disabled={busy}
        >
          {item.status === "disabled" ? "重新启用" : "停用（不删除）"}
        </button>
      </div>

      <div>
        <h3 className="section-title mb-2">版本历史</h3>
        <ul className="space-y-1.5">
          {item.versions.map((version) => (
            <li
              key={version.version}
              className="px-3 py-2 border border-line-2 rounded-[8px] text-[12px] text-ink-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-ink">
                  v{version.version}
                  {version.version === item.currentVersion ? (
                    <span className="ml-1.5 text-[11px] text-brand">当前</span>
                  ) : null}
                </span>
                <span className="text-ink-4 num">{formatDateTime(version.createdAt)}</span>
              </div>
              <div className="text-ink-4">来源：{version.batchName}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function KbDetail({
  item,
  editing,
  busy,
  onClose,
  onEdit,
  onToggle,
  onSaved,
}: {
  item: KbRow;
  editing: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onSaved: (message: string) => void;
}) {
  const latest = item.versions[0];
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div
      className="fixed inset-0 z-40 bg-black/35 flex justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="w-[560px] h-full bg-surface border-l border-line overflow-y-auto">
        <div className="h-[62px] px-5 flex items-center justify-between border-b border-line-2 sticky top-0 bg-surface z-10">
          <div>
            <h2 className="font-serif text-[17px] text-ink">{item.name}</h2>
            <p className="text-[11.5px] text-ink-4">
              {item.source ?? "出处未标"}
              {item.type === "classic" ? ` · ${formatChars(item.chars)}` : ""} · v{item.currentVersion} · 被引用{" "}
              {item.usageCount} 次
            </p>
          </div>
          <button type="button" className="btn btn-quiet h-[30px]" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="p-5 space-y-4">
          {item.type === "classic" ? (
            <ClassicDetailBody item={item} busy={busy} onToggle={onToggle} />
          ) : editing ? (
            <form
              className="space-y-3"
              action={(formData) => {
                startTransition(async () => {
                  const result = await saveKbVersion(formData);
                  if (result.ok) onSaved(result.message);
                  else setError(result.message);
                });
              }}
            >
              <input type="hidden" name="id" value={item.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label" htmlFor="kb-name">
                    名称
                  </label>
                  <input id="kb-name" name="name" className="input" defaultValue={item.name} />
                </div>
                <div>
                  <label className="field-label" htmlFor="kb-source">
                    出处
                  </label>
                  <input id="kb-source" name="source" className="input" defaultValue={item.source ?? ""} />
                </div>
              </div>
              {item.type === "formula" ? (
                <div>
                  <label className="field-label" htmlFor="kb-composition">
                    组成（每味「药名+剂量」）
                  </label>
                  <textarea
                    id="kb-composition"
                    name="composition"
                    rows={4}
                    className="textarea font-serif"
                    defaultValue={latest?.composition.join("、") ?? ""}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label" htmlFor="kb-efficacy">
                    功效
                  </label>
                  <input id="kb-efficacy" name="efficacy" className="input" defaultValue={latest?.efficacy ?? ""} />
                </div>
                <div>
                  <label className="field-label" htmlFor="kb-usage">
                    用法
                  </label>
                  <input id="kb-usage" name="usageText" className="input" defaultValue={latest?.usageText ?? ""} />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="kb-indication">
                  主治
                </label>
                <textarea
                  id="kb-indication"
                  name="indication"
                  rows={2}
                  className="textarea"
                  defaultValue={latest?.indication ?? ""}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="kb-contra">
                  禁忌
                </label>
                <input
                  id="kb-contra"
                  name="contraindication"
                  className="input"
                  defaultValue={latest?.contraindication ?? ""}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="kb-commentary">
                  方解
                </label>
                <textarea
                  id="kb-commentary"
                  name="commentary"
                  rows={3}
                  className="textarea"
                  defaultValue={latest?.commentary ?? ""}
                />
              </div>
              {error ? <p className="field-error">{error}</p> : null}
              <div className="flex items-center gap-2 justify-end">
                <button type="button" className="btn btn-quiet" onClick={onClose}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  保存为新版本
                </button>
              </div>
              <p className="text-[11.5px] text-ink-4">
                保存会生成第 {item.currentVersion + 1} 版，旧版仍保留在版本历史里；已保存的病历不受影响。
              </p>
            </form>
          ) : (
            <>
              <div className="space-y-3 text-[13px]">
                {item.caseInfo ? (
                  <>
                    <div className="flex items-center gap-4 text-[12px] text-ink-3 pb-1 border-b border-line-2">
                      <span>患者：{item.caseInfo.patient ?? "—"}</span>
                      <span className="num">
                        {item.caseInfo.visitAt ? formatDateTime(item.caseInfo.visitAt) : "—"}
                      </span>
                      <span>第 {item.caseInfo.visitNo ?? "—"} 次接诊</span>
                    </div>
                    <Field label="主诉" value={item.caseInfo.complaint || "—"} />
                    <Field label="现病史" value={item.caseInfo.illness || "—"} />
                    <Field label="四诊" value={[item.caseInfo.tongue, item.caseInfo.pulse].filter(Boolean).join(" · ") || "—"} />
                    <Field label="问诊要点" value={item.caseInfo.symptoms || "—"} />
                    <Field label="证型" value={item.caseInfo.syndrome || "—"} />
                    <Field label="治法" value={item.caseInfo.treatment || "—"} />
                    <Field label="医嘱" value={item.caseInfo.advice || "—"} />
                    {item.caseInfo.visitId ? (
                      <Link href={`/visits/${item.caseInfo.visitId}`} className="btn btn-ghost h-[30px] inline-flex">
                        打开原病历
                      </Link>
                    ) : null}
                  </>
                ) : null}
                <Field label="组成" value={latest?.composition.join("、") ?? "—"} serif />
                <Field label="功效" value={latest?.efficacy || "—"} />
                <Field label="主治" value={latest?.indication || "—"} />
                <Field label="用法" value={latest?.usageText || "—"} />
                {item.caseInfo ? null : (
                  <>
                    <Field label="禁忌" value={latest?.contraindication || "—"} />
                    <Field label="方解" value={latest?.commentary || "—"} />
                  </>
                )}
                {item.aliases.length > 0 ? <Field label="别名" value={item.aliases.join(" / ")} /> : null}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-ghost flex-1" onClick={onEdit}>
                  编辑（新增版本）
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost flex-1 ${item.status === "disabled" ? "text-brand" : "text-danger"}`}
                  onClick={onToggle}
                  disabled={busy}
                >
                  {item.status === "disabled" ? "重新启用" : "停用（不删除）"}
                </button>
              </div>

              <div>
                <h3 className="section-title mb-2">版本历史</h3>
                <ul className="space-y-1.5">
                  {item.versions.map((version) => (
                    <li
                      key={version.version}
                      className="px-3 py-2 border border-line-2 rounded-[8px] text-[12px] text-ink-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-ink">
                          v{version.version}
                          {version.version === item.currentVersion ? (
                            <span className="ml-1.5 text-[11px] text-brand">当前</span>
                          ) : null}
                        </span>
                        <span className="text-ink-4 num">{formatDateTime(version.createdAt)}</span>
                      </div>
                      <div className="text-ink-4">来源：{version.batchName}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  total,
  onChange,
  unit,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
  unit: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="px-4 py-3 border-t border-line-2 flex items-center justify-between">
      <span className="text-[11.5px] text-ink-4">
        第 {page} / {totalPages} 页 · 共 {total} {unit}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-quiet h-[30px]"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn btn-quiet h-[30px]"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, serif }: { label: string; value: string; serif?: boolean }) {
  return (
    <div>
      <p className="text-[11.5px] text-ink-4 mb-0.5">{label}</p>
      <p className={`text-ink-2 leading-relaxed ${serif ? "font-serif text-[13.5px]" : ""}`}>{value}</p>
    </div>
  );
}
