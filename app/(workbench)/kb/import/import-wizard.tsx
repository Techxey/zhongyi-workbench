"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  commitImport,
  previewImport,
  rollbackBatch,
  validateImport,
} from "@/lib/kb-import-actions";
import { IMPORT_CODES, IMPORT_TARGETS, compositionText } from "@/lib/kb";
import {
  MAX_IMPORT_BYTES,
  duplicateTargets,
  guessMapping,
  inferItemType,
  missingRequiredTargets,
  requiredTargetsFor,
  type ImportItemType,
} from "@/lib/kb-import";
import { formatDateTime } from "@/lib/format";

export type ImportBatchRecord = {
  id: string;
  filename: string;
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
  createdAt: string;
  rolledBack: boolean;
  operatorName: string;
};

type RowStatus = "pass" | "warn" | "error" | "update";

type DraftView = {
  name: string;
  source: string;
  aliases: string[];
  composition: { name: string; dose: string }[];
  usageText: string;
  efficacy: string;
  indication: string;
  contraindication: string;
  commentary: string;
  note: string;
};

type ValidationRowView = {
  line: number;
  status: RowStatus;
  codes: string[];
  data: DraftView;
  hints?: string[];
};

type ValidationView = {
  summary: { total: number; pass: number; warn: number; error: number; update: number };
  rows: ValidationRowView[];
  itemType: ImportItemType;
  truncated: boolean;
  filename: string;
  totalRows: number;
};

type PreviewView = {
  token: string;
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
  filename: string;
};

type CommitView = { batchId: string; inserted: number; updated: number; skipped: number };

const STEPS = [
  { id: 1, title: "上传", hint: "CSV 或 JSON" },
  { id: 2, title: "字段映射", hint: "文件列 → 知识库字段" },
  { id: 3, title: "校验入库", hint: "逐行核对后写入" },
] as const;

const STATUS_META: Record<RowStatus, { label: string; chip: string }> = {
  pass: { label: "通过", chip: "chip chip-brand" },
  warn: { label: "警告", chip: "chip chip-accent" },
  error: { label: "错误", chip: "chip chip-danger" },
  update: { label: "将更新", chip: "chip" },
};

function targetLabel(key: string): string {
  return IMPORT_TARGETS.find((target) => target.key === key)?.label ?? key;
}

export default function ImportWizard({ initialBatches }: { initialBatches: ImportBatchRecord[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState<"preview" | "validate" | "commit" | "rollback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<ValidationView | null>(null);
  const [committed, setCommitted] = useState<CommitView | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [rolledBackIds, setRolledBackIds] = useState<Set<string>>(new Set());

  const itemType: ImportItemType = preview ? inferItemType(preview.columns) : "formula";
  const requiredTargets = new Set<string>(requiredTargetsFor(itemType));
  const missing = preview ? missingRequiredTargets(mapping, itemType) : [];
  const duplicates = duplicateTargets(mapping);
  const mappingReady = Boolean(preview) && missing.length === 0 && duplicates.length === 0;

  function goTo(next: 1 | 2 | 3) {
    setError(null);
    setNotice(null);
    setStep(next);
  }

  function resetWizard() {
    setPreview(null);
    setValidation(null);
    setCommitted(null);
    setMapping({});
    setError(null);
    setExpanded(new Set());
    setBusy(null);
    setStep(1);
    if (inputRef.current) inputRef.current.value = "";
  }

  function toggleRow(line: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  async function handleFile(file: File) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setValidation(null);
    setCommitted(null);
    setPreview(null);

    if (file.size > MAX_IMPORT_BYTES) {
      setError(`文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB，请拆分后分批导入`);
      return;
    }

    setBusy("preview");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await previewImport(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPreview(result);
      setMapping(guessMapping(result.columns));
    } catch {
      setError("文件读取失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function runValidation() {
    if (!preview || !mappingReady || busy) return;
    setBusy("validate");
    setError(null);
    setNotice(null);
    try {
      const result = await validateImport(preview.token, mapping);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setValidation({
        summary: result.summary,
        rows: result.rows,
        itemType: result.itemType,
        truncated: result.truncated,
        filename: result.filename,
        totalRows: result.totalRows,
      });
      setExpanded(new Set());
      goTo(3);
    } catch {
      setError("校验失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function runCommit(mode: "pass" | "all") {
    if (!preview || !validation || busy) return;
    const warnCount = validation.summary.warn;
    if (mode === "all" && warnCount > 0) {
      const confirmed = window.confirm(
        `「全部导入」会把 ${warnCount} 行只有警告的记录也写进知识库（例如缺出处、缺剂量）。\n\n警告行入库后与其他条目一样会被医生引用，确认继续？`,
      );
      if (!confirmed) return;
    }

    setBusy("commit");
    setError(null);
    setNotice(null);
    try {
      const result = await commitImport(preview.token, mapping, mode);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCommitted(result);
      router.refresh();
    } catch {
      setError("入库失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function rollback(batchId: string, consequence: string) {
    const confirmed = window.confirm(`${consequence}\n\n撤销后无法恢复，确认撤销？`);
    if (!confirmed) return;

    setBusy("rollback");
    setError(null);
    setNotice(null);
    try {
      const result = await rollbackBatch(batchId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRolledBackIds((previous) => new Set(previous).add(batchId));
      resetWizard();
      setNotice(`已撤销批次：删除 ${result.removed} 条，回退 ${result.reverted} 条。`);
      router.refresh();
    } catch {
      setError("撤销失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  const writableCount = validation ? validation.summary.pass + validation.summary.update : 0;
  const writableAllCount = validation
    ? validation.summary.pass + validation.summary.warn + validation.summary.update
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line-2 px-5 py-4">
          {STEPS.map((item, index) => {
            const active = step === item.id;
            const done = step > item.id;
            return (
              <div key={item.id} className="flex items-center gap-2.5">
                <span
                  className={`num flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11.5px] ${
                    active
                      ? "bg-brand-solid text-white"
                      : done
                        ? "bg-brand-soft text-brand"
                        : "bg-line-2 text-ink-4"
                  }`}
                >
                  {done ? "✓" : item.id}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className={`text-[12.5px] ${active ? "text-ink" : "text-ink-3"}`}>
                    {index + 1} {item.title}
                  </span>
                  <span className="text-[10.5px] text-ink-4">{item.hint}</span>
                </span>
                {index < STEPS.length - 1 ? <span className="ml-3 text-ink-4">—</span> : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 p-5">
          {step === 1 ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[13.5px] text-ink">选择要导入的文件</p>
                  <p className="mt-1 max-w-[620px] text-[12.5px] leading-relaxed text-ink-3">
                    支持 .csv（可用 Excel「另存为 CSV UTF-8」）与 .json（对象数组），单个文件不超过 5MB。列名不必和模板完全一致，下一步会一一对应。
                  </p>
                </div>
                <a href="/api/kb/template" className="btn btn-ghost" download>
                  下载 CSV 模板
                </a>
              </div>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed px-6 py-9 text-center transition-colors ${
                  dragOver ? "border-brand bg-brand-soft" : "border-line-strong bg-canvas"
                }`}
              >
                <p className="text-[13px] text-ink-2">
                  {preview ? `已选择：${preview.filename}` : "把文件拖到这里，或"}
                </p>
                {preview ? (
                  <p className="text-[11.5px] text-ink-4">
                    {preview.columns.length} 列 · {preview.totalRows} 行 · 已识别为
                    {itemType === "herb" ? "中药" : "方剂"}
                  </p>
                ) : (
                  <p className="text-[11.5px] text-ink-4">
                    模板列名：方名 / 别名 / 出处 / 组成 / 功效 / 主治 / 用法 / 禁忌 / 方解 / 备注
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy !== null}
                  >
                    {busy === "preview" ? "解析中…" : preview ? "重新选择文件" : "选择文件"}
                  </button>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </div>

              {preview ? (
                <div className="overflow-x-auto rounded-[10px] border border-line-2">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead className="bg-canvas text-[11.5px] text-ink-3">
                      <tr>
                        {preview.columns.map((column) => (
                          <th key={column} className="whitespace-nowrap px-3 py-2 font-normal">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-2">
                      {preview.rows.slice(0, 5).map((row, index) => (
                        <tr key={index} className="text-ink-2">
                          {preview.columns.map((column) => (
                            <td key={column} className="max-w-[220px] truncate px-3 py-2">
                              {row[column] || <span className="text-ink-4">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-line-2 px-3 py-2 text-[11px] text-ink-4">
                    预览前 {Math.min(5, preview.rows.length)} 行，共 {preview.totalRows} 行
                  </p>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!preview || busy !== null}
                  onClick={() => goTo(2)}
                >
                  下一步：字段映射
                </button>
              </div>
            </>
          ) : null}

          {step === 2 && preview ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13.5px] text-ink">把文件里的列对应到知识库字段</p>
                <span className="chip chip-lg">
                  {itemType === "herb" ? "按中药导入（只需药名）" : "按方剂导入（需方名 + 组成）"}
                </span>
              </div>

              <div className="divide-y divide-line-2 rounded-[10px] border border-line-2">
                {preview.columns.map((column) => {
                  const value = mapping[column] ?? "ignore";
                  const sample = preview.rows[0]?.[column] ?? "";
                  return (
                    <div key={column} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <div className="min-w-[200px] flex-1">
                        <p className="text-[12.5px] text-ink">{column}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-4">
                          示例：{sample ? sample.slice(0, 48) : "（空）"}
                        </p>
                      </div>
                      <select
                        className="input h-9 w-[220px] shrink-0 py-0 text-[12.5px]"
                        value={value}
                        onChange={(event) =>
                          setMapping((previous) => ({ ...previous, [column]: event.target.value }))
                        }
                      >
                        <option value="ignore">不导入</option>
                        {IMPORT_TARGETS.map((target) => (
                          <option key={target.key} value={target.key}>
                            {target.label}
                            {requiredTargets.has(target.key) ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {missing.length > 0 ? (
                <p className="field-error">
                  还缺必填映射：{missing.map(targetLabel).join("、")}。补齐后才能下一步。
                </p>
              ) : null}
              {duplicates.length > 0 ? (
                <p className="field-error">
                  「{duplicates.map(targetLabel).join("、")}」被多列映射，请只保留一列。
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <button type="button" className="btn btn-ghost" onClick={() => goTo(1)} disabled={busy !== null}>
                  上一步
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!mappingReady || busy !== null}
                  onClick={() => void runValidation()}
                >
                  {busy === "validate" ? "校验中…" : "下一步：校验"}
                </button>
              </div>
            </>
          ) : null}

          {step === 3 && validation ? (
            committed ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-[10px] border border-brand bg-brand-soft px-5 py-4">
                  <p className="text-[13.5px] text-ink">导入完成</p>
                  <p className="mt-1 text-[12.5px] text-ink-2">
                    新增 {committed.inserted} 条，更新 {committed.updated} 条，跳过 {committed.skipped} 行。
                  </p>
                  <p className="mt-2 text-[12px] text-ink-3">
                    批次号：<span className="num select-all">{committed.batchId}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      void rollback(
                        committed.batchId,
                        `撤销本批次会删除本次新增的 ${committed.inserted} 条条目，并把本次更新的 ${committed.updated} 条条目回退到上一个版本。`,
                      )
                    }
                  >
                    {busy === "rollback" ? "撤销中…" : "撤销本批次"}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={resetWizard}>
                    继续导入
                  </button>
                  <Link href="/kb" className="btn btn-ghost">
                    查看知识库
                  </Link>
                </div>
                <p className="text-[11.5px] text-ink-4">
                  撤销会删除本批次新增的条目，并把本批次更新过的条目回退到上一个版本；撤销后不可恢复。
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13.5px] text-ink">校验结果</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-4">
                      {validation.filename} · 按{validation.itemType === "herb" ? "中药" : "方剂"}校验
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SummaryTile label="共" value={validation.summary.total} tone="ink" />
                    <SummaryTile label="通过" value={validation.summary.pass} tone="brand" />
                    <SummaryTile label="警告" value={validation.summary.warn} tone="ochre" />
                    <SummaryTile label="错误" value={validation.summary.error} tone="danger" />
                    <SummaryTile label="更新" value={validation.summary.update} tone="ink" />
                  </div>
                </div>

                <div className="overflow-hidden rounded-[10px] border border-line-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 bg-canvas px-4 py-2.5">
                    <p className="text-[12px] text-ink-2">逐行结果（点一行看解析明细）</p>
                    <p className="text-[11px] text-ink-4">
                      {validation.truncated
                        ? `列表只显示前 ${validation.rows.length} 行，汇总按全部 ${validation.totalRows} 行统计`
                        : `共 ${validation.totalRows} 行`}
                    </p>
                  </div>
                  <div className="max-h-[460px] divide-y divide-line-2 overflow-y-auto">
                    {validation.rows.map((row) => {
                      const open = expanded.has(row.line);
                      const meta = STATUS_META[row.status];
                      return (
                        <div key={row.line}>
                          <button
                            type="button"
                            onClick={() => toggleRow(row.line)}
                            className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-canvas"
                          >
                            <span className="num w-[62px] shrink-0 text-[11.5px] text-ink-4">
                              第 {row.line} 行
                            </span>
                            <span className={meta.chip}>{meta.label}</span>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                              {row.data.name || <span className="text-ink-4">（无名称）</span>}
                              {row.data.source ? (
                                <span className="ml-2 text-ink-4">{row.data.source}</span>
                              ) : null}
                            </span>
                            <span className="num text-[11px] text-ink-4">{row.codes.join(" · ")}</span>
                            <span className="text-ink-4">{open ? "▾" : "▸"}</span>
                          </button>
                          {open ? (
                            <div className="bg-canvas px-4 pb-3 pt-1">
                              {row.codes.length > 0 ? (
                                <ul className="mb-2 space-y-1 text-[11.5px]">
                                  {row.codes.map((code) => {
                                    const info = IMPORT_CODES[code];
                                    return (
                                      <li
                                        key={code}
                                        className={info?.level === "error" ? "text-danger" : "text-accent-ink"}
                                      >
                                        <span className="num mr-1.5">{code}</span>
                                        {info?.text ?? "未知提示"}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                              {row.hints && row.hints.length > 0 ? (
                                <ul className="mb-2 space-y-0.5 text-[11.5px] text-ink-3">
                                  {row.hints.map((hint) => (
                                    <li key={hint}>{hint}</li>
                                  ))}
                                </ul>
                              ) : null}
                              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
                                <DetailField label="名称" value={row.data.name} />
                                <DetailField label="出处" value={row.data.source} />
                                <DetailField label="别名" value={row.data.aliases.join("、")} />
                                {validation.itemType === "formula" ? (
                                  <DetailField
                                    label="组成"
                                    value={compositionText(row.data.composition)}
                                  />
                                ) : null}
                                <DetailField label="用法" value={row.data.usageText} />
                                <DetailField label="功效" value={row.data.efficacy} />
                                <DetailField label="主治" value={row.data.indication} />
                                <DetailField label="禁忌" value={row.data.contraindication} />
                                <DetailField label="方解" value={row.data.commentary} />
                                <DetailField label="备注" value={row.data.note} />
                              </dl>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p className="text-[11.5px] text-ink-4">
                  错误行在任何方式下都不会入库；「将更新」的条目会作为新版本写入，不改动历史版本。
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line-2 pt-4">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => goTo(2)}
                      disabled={busy !== null}
                    >
                      上一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        if (window.confirm("取消本次导入？已上传的文件与校验结果会丢弃，知识库不会有任何改动。")) {
                          resetWizard();
                        }
                      }}
                      disabled={busy !== null}
                    >
                      取消
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy !== null || writableAllCount === 0}
                      onClick={() => void runCommit("all")}
                    >
                      {busy === "commit" ? "写入中…" : "全部导入（警告行也入库）"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null || writableCount === 0}
                      onClick={() => void runCommit("pass")}
                    >
                      {busy === "commit" ? "写入中…" : "仅导入通过行"}
                    </button>
                  </div>
                </div>
                {writableCount === 0 ? (
                  <p className="text-[11.5px] text-ink-4">
                    {writableAllCount > 0
                      ? "没有可直接通过的干净行：可点「全部导入（警告行也入库）」，或修正文件后重新上传。"
                      : "没有可写入的行：请修正文件里的错误后重新上传。"}
                  </p>
                ) : null}
              </div>
            )
          ) : null}

          {step === 3 && !validation ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-[12.5px] text-ink-2">
                {busy === "validate" ? "正在校验，请稍候…" : "还没有校验结果"}
              </p>
              <button type="button" className="btn btn-ghost" onClick={() => goTo(2)}>
                返回字段映射
              </button>
            </div>
          ) : null}

          {error ? <p className="field-error">{error}</p> : null}
          {notice ? <p className="text-[12.5px] text-ink-2">{notice}</p> : null}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex h-[50px] flex-wrap items-center justify-between gap-2 border-b border-line-2 px-5">
          <h2 className="section-title">最近导入批次</h2>
          <span className="text-[11px] text-ink-4">撤销会删除该批新增条目，并把更新过的条目回退一版</span>
        </div>
        {initialBatches.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">还没有导入记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead className="bg-canvas text-[11.5px] text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-normal">时间</th>
                  <th className="px-4 py-2 font-normal">文件</th>
                  <th className="px-4 py-2 text-right font-normal">总行数</th>
                  <th className="px-4 py-2 text-right font-normal">通过</th>
                  <th className="px-4 py-2 text-right font-normal">警告</th>
                  <th className="px-4 py-2 text-right font-normal">错误</th>
                  <th className="px-4 py-2 font-normal">操作人</th>
                  <th className="px-4 py-2 font-normal">状态</th>
                  <th className="px-4 py-2 text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {initialBatches.map((batch) => {
                  const rolled = batch.rolledBack || rolledBackIds.has(batch.id);
                  return (
                    <tr key={batch.id} className="text-ink-2">
                      <td className="num whitespace-nowrap px-4 py-2.5 text-ink-3">
                        {formatDateTime(batch.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block max-w-[200px] truncate text-ink" title={batch.filename}>
                          {batch.filename}
                        </span>
                        <span className="num text-[10.5px] text-ink-4">{batch.id.slice(0, 8)}</span>
                      </td>
                      <td className="num px-4 py-2.5 text-right">{batch.totalRows}</td>
                      <td className="num px-4 py-2.5 text-right">{batch.okRows}</td>
                      <td className="num px-4 py-2.5 text-right">{batch.warnRows}</td>
                      <td className="num px-4 py-2.5 text-right">{batch.errorRows}</td>
                      <td className="px-4 py-2.5 text-ink-3">{batch.operatorName}</td>
                      <td className="px-4 py-2.5">
                        <span className={rolled ? "chip chip-danger" : "chip chip-brand"}>
                          {rolled ? "已撤销" : "已入库"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="btn btn-ghost h-7 px-3 text-[11.5px]"
                          disabled={rolled || busy !== null}
                          onClick={() => {
                            void rollback(
                              batch.id,
                              `撤销「${batch.filename}」这批导入，会删除该批新增的条目，并把该批更新过的条目回退到上一个版本。`,
                            );
                          }}
                        >
                          撤销
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ink" | "brand" | "ochre" | "danger";
}) {
  const toneClass =
    tone === "brand"
      ? "text-brand"
      : tone === "ochre"
        ? "text-accent-ink"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-[8px] border border-line-2 px-2.5 py-1">
      <span className="text-[11px] text-ink-4">{label}</span>
      <span className={`num text-[15px] ${toneClass}`}>{value}</span>
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-4">{label}</dt>
      <dd className="min-w-0 break-words text-ink-2">{value}</dd>
    </div>
  );
}
