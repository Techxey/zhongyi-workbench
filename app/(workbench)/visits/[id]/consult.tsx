"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { TermChips } from "@/components/term-chips";
import { TopBar } from "@/components/topbar";
import { ageOf, formatDate, genderLabel } from "@/lib/format";
import type { AttachmentItem } from "@/lib/attachments";
import {
  DEFAULT_USAGE,
  diffPrescription,
  findIncompatibilities,
  formatDose,
  herbLines,
  isNumericDose,
  newHerb,
  parseDose,
  validateDraft,
  type HerbDraft,
  type IncompatPair,
  type RxLine,
  type VisitDraft,
} from "@/lib/visit";
import {
  pickSyndromeCandidates,
  type VocabCategory,
  type VocabItem,
} from "@/lib/vocabulary";
import { bumpConsultTerms } from "@/lib/vocabulary-actions";
import { registerKbInsert, setKbContext, type KbInsertPayload } from "@/lib/kb-bridge";
import { saveAsTemplate, saveVisit, deleteTemplate } from "./actions";

export type KbFormula = {
  id: string;
  name: string;
  source: string | null;
  efficacy: string | null;
  indication: string | null;
  commentary: string | null;
  usageText: string | null;
  items: RxLine[];
  version: number;
};

export type TemplateSummary = {
  id: string;
  name: string;
  kind: string;
  note: string | null;
  items: { name: string; dose: string }[];
};

export type PreviousRecord = {
  visitAt: string;
  presentIllness: string;
  symptoms: string[];
  tongue: string[];
  pulse: string[];
  syndrome: string;
  treatment: string;
  advice: string;
  followupDays: number | null;
  remindFollowup: boolean;
  items: RxLine[];
  formulaName: string;
  usageText: string;
  doses: number | null;
};

export type ConsultationData = {
  visitId: string;
  patient: {
    id: string;
    name: string;
    gender: string | null;
    birthYear: number | null;
    allergy: string | null;
    constitution: string | null;
    pastHistory: string | null;
  };
  visitNo: number;
  visitAt: string;
  status: string;
  revisionNo: number;
  doctorName: string;
  clinicName: string;
  draft: VisitDraft;
  isAmend: boolean;
  previous: PreviousRecord | null;
  symptomTerms: { term: string; count: number }[];
  syndromeAliases: { label: string; term: string; normTerm: string; weight: number }[];
  incompatPairs: IncompatPair[];
  /** 舌象 / 脉象 / 证型 / 治法 词库（来自 consult_terms 表，医生可增删，全站共享） */
  vocabulary: Record<VocabCategory, VocabItem[]>;
  /** 该患者的图片资料（舌象照片、检查报告、病历照片） */
  attachments: AttachmentItem[];
  kbFormula: KbFormula | null;
  /** 保存过的常用方 / 协定处方，右栏可一键套用 */
  templates: TemplateSummary[];
};

function mmss(seconds: number): string {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function VisitScreen({ data }: { data: ConsultationData }) {
  const router = useRouter();
  const [draft, setDraft] = useState<VisitDraft>(data.draft);
  const [revisionNo, setRevisionNo] = useState(data.revisionNo);
  const [dirty, setDirty] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [timerOn, setTimerOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [kbPending, setKbPending] = useState<KbInsertPayload | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const [symQuery, setSymQuery] = useState("");
  const [status, setStatus] = useState(data.status);

  const formRef = useRef<HTMLDivElement | null>(null);
  const saveRef = useRef<(print: boolean) => void>(() => {});
  const dosesRef = useRef<HTMLInputElement | null>(null);

  const isAmend = revisionNo > 0;
  const errors = useMemo(() => validateDraft(draft, isAmend), [draft, isAmend]);

  const symptoms = useMemo(() => {
    const q = symQuery.trim();
    const base = data.symptomTerms.map((term) => term.term);
    const seen = new Set(base);
    for (const item of draft.symptoms) if (!seen.has(item)) base.push(item);
    if (!q) return base;
    return base.filter((term) => term.includes(q));
  }, [data.symptomTerms, draft.symptoms, symQuery]);

  const syndromeCandidates = useMemo(
    () =>
      pickSyndromeCandidates(
        [draft.chiefComplaint, draft.presentIllness, draft.symptoms.join("")].join(""),
        data.vocabulary.syndrome,
        data.syndromeAliases.map((alias) => ({ term: alias.term, normTerm: alias.normTerm })),
        6,
      ),
    [
      draft.chiefComplaint,
      draft.presentIllness,
      draft.symptoms,
      data.vocabulary.syndrome,
      data.syndromeAliases,
    ],
  );

  // 证型 chips：候选在前，其余词库证型排后面，合并去重
  const syndromeChipItems = useMemo(() => {
    const seen = new Set<string>();
    const merged: VocabItem[] = [];
    for (const item of [...syndromeCandidates, ...data.vocabulary.syndrome]) {
      if (seen.has(item.term)) continue;
      seen.add(item.term);
      merged.push(item);
    }
    return merged;
  }, [syndromeCandidates, data.vocabulary.syndrome]);

  const tonguePhotos = useMemo(
    () => data.attachments.filter((item) => item.kind === "tongue"),
    [data.attachments],
  );

  const rxLines = useMemo(() => herbLines(draft.prescription.items), [draft.prescription.items]);
  const diff = useMemo(
    () => diffPrescription(data.previous?.items ?? null, rxLines),
    [data.previous, rxLines],
  );
  const kbDiff = useMemo(
    () => diffPrescription(data.kbFormula?.items ?? null, rxLines),
    [data.kbFormula, rxLines],
  );
  const incompatibilities = useMemo(
    () =>
      findIncompatibilities(
        draft.prescription.items.map((item) => item.name),
        data.incompatPairs,
      ),
    [draft.prescription.items, data.incompatPairs],
  );

  // 录入计时
  useEffect(() => {
    if (!timerOn) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [timerOn]);

  // 有未保存内容时离开提示
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const patch = <K extends keyof VisitDraft>(key: K, value: VisitDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const patchRx = (value: Partial<VisitDraft["prescription"]>) => {
    setDraft((current) => ({
      ...current,
      prescription: { ...current.prescription, ...value },
    }));
    setDirty(true);
  };

  const setItems = (items: HerbDraft[]) => patchRx({ items });

  const toggleArray = (key: "symptoms" | "tongue" | "pulse", value: string) => {
    const list = draft[key];
    patch(key, list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  // 选中词条时顺手累加使用频次，下次它会更靠前（不阻塞界面）
  const bump = (category: VocabCategory, term: string) => {
    void bumpConsultTerms(category, [term]).catch(() => {});
  };

  const toggleTonguePulse = (key: "tongue" | "pulse") => (term: string) => {
    const wasSelected = draft[key].includes(term);
    toggleArray(key, term);
    if (!wasSelected) bump(key, term);
  };

  const toggleSyndrome = (term: string, item: VocabItem | null) => {
    const selected = draft.syndrome === term;
    patch("syndrome", selected ? "" : term);
    if (!selected) {
      bump("syndrome", term);
      const hint = item?.hint ?? "";
      if (hint && !draft.treatment.trim()) patch("treatment", hint);
    }
  };

  const toggleTreatment = (term: string) => {
    const selected = draft.treatment === term;
    patch("treatment", selected ? "" : term);
    if (!selected) bump("treatment", term);
  };

  const handleSave = async (print: boolean) => {
    if (saving) return;
    if (errors.length > 0) {
      setServerError(`还差：${errors.map((error) => error.message).join("、")}`);
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const result = await saveVisit(data.visitId, draft);
      if (!result.ok) {
        setServerError(result.errors.map((error) => error.message).join("；"));
        return;
      }
      setRevisionNo(result.revisionNo);
      setStatus("signed");
      setDirty(false);
      setTimerOn(false);
      setToast(
        result.revisionNo > 1
          ? `已保存第 ${result.revisionNo} 版 · 用时 ${mmss(seconds)}`
          : `已保存并签名 · 用时 ${mmss(seconds)}`,
      );
      if (print) {
        window.open(`/print/prescription/${data.visitId}`, "_blank", "noopener");
      }
    } catch {
      setServerError("保存失败，内容已保留，请点击重试");
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = handleSave;

  // 键盘流：Ctrl+Enter 保存并打印（Ctrl+K 由全局检索浮层接管）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === "Enter") {
        event.preventDefault();
        saveRef.current(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 把当前病历的已选症状/证型交给检索浮层，用于「与本次症状吻合 N 项」排序
  useEffect(() => {
    setKbContext({ symptoms: draft.symptoms, syndrome: draft.syndrome });
  }, [draft.symptoms, draft.syndrome]);

  const applyKbFormula = (payload: KbInsertPayload) => {
    const items: HerbDraft[] =
      payload.components.length > 0
        ? payload.components.map((part, index) => {
            const dose = parseDose(part.dose);
            return {
              key: `kb-${payload.kbItemId}-${index}`,
              name: part.name,
              doseValue: dose.value,
              doseUnit: dose.unit || "g",
              role: null,
            };
          })
        : [newHerb()];

    setDraft((current) => ({
      ...current,
      prescription: {
        ...current.prescription,
        formulaName: payload.name,
        formulaSource: payload.source ?? "",
        kbItemId: payload.kbItemId,
        kbItemVersion: payload.kbItemVersion,
        usageText: current.prescription.usageText || payload.usageText || DEFAULT_USAGE,
        items,
      },
    }));
    setDirty(true);
    setKbPending(null);
    setToast(`已带入《${payload.name}》${items.length} 味，剂数可继续改`);
    window.setTimeout(() => dosesRef.current?.focus(), 40);
  };

  /** 套用存过的常用方 / 协定处方（不带知识库快照，方名与药味直接写入） */
  const applyTemplate = (template: TemplateSummary) => {
    const kindLabel = template.kind === "agreed" ? "协定处方" : "我的常用方";
    const items: HerbDraft[] =
      template.items.length > 0
        ? template.items.map((item, index) => {
            const dose = parseDose(item.dose);
            return {
              key: `tpl-${template.id}-${index}`,
              name: item.name,
              doseValue: dose.value,
              doseUnit: dose.unit || "g",
              role: null,
            };
          })
        : [newHerb()];

    const replace = () => {
      setDraft((current) => ({
        ...current,
        prescription: {
          ...current.prescription,
          formulaName: template.name,
          formulaSource: kindLabel,
          kbItemId: null,
          kbItemVersion: null,
          items,
        },
      }));
      setDirty(true);
      setToast(`已套用「${template.name}」${items.length} 味`);
      window.setTimeout(() => dosesRef.current?.focus(), 40);
    };

    if (draft.prescription.items.some((item) => item.name.trim())) {
      const confirmed = window.confirm(
        `处方里已有药味。用「${template.name}」的 ${items.length} 味替换现有处方？\n（取消则不改，想追加请用知识检索）`,
      );
      if (!confirmed) return;
    }
    replace();
  };

  const handleDeleteTemplate = async (template: TemplateSummary) => {
    if (!window.confirm(`删除「${template.name}」？删除后不能再套用，已保存的病历不受影响。`)) return;
    const result = await deleteTemplate(template.id);
    setToast(result.message);
    router.refresh();
  };

  const appendKbHerb = (payload: KbInsertPayload) => {
    const part = payload.components[0];
    const dose = parseDose(part?.dose ?? "");
    setDraft((current) => {
      const items = [...current.prescription.items];
      const blank = items.findIndex((item) => !item.name.trim());
      const next: HerbDraft = {
        key: `kb-herb-${payload.kbItemId}-${Date.now()}`,
        name: payload.name,
        doseValue: dose.value,
        doseUnit: dose.unit || "g",
        role: null,
      };
      if (blank >= 0) items[blank] = next;
      else items.push(next);
      return { ...current, prescription: { ...current.prescription, items } };
    });
    setDirty(true);
    setToast(`已加一味：${payload.name}`);
  };

  // 全局检索浮层带入：已有药味时先问「替换 / 追加」
  useEffect(() => {
    registerKbInsert((payload) => {
      if (payload.type === "herb") {
        appendKbHerb(payload);
        return;
      }
      const filled = draft.prescription.items.some((item) => item.name.trim());
      if (filled) {
        setKbPending(payload);
        return;
      }
      applyKbFormula(payload);
    });
    return () => registerKbInsert(null);
  }, [draft.prescription.items]);

  const focusStop = (direction: 1 | -1) => {
    const root = formRef.current;
    if (!root) return;
    const stops = Array.from(root.querySelectorAll<HTMLElement>("[data-kb-stop]"));
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    let index = -1;
    stops.forEach((stop, i) => {
      if (stop === active || stop.contains(active)) index = i;
    });
    let next = index + direction;
    if (index === -1) next = direction === 1 ? 0 : stops.length - 1;
    next = Math.max(0, Math.min(stops.length - 1, next));
    stops[next].focus();
  };

  const onFormKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      event.preventDefault();
      focusStop(event.shiftKey ? -1 : 1);
      return;
    }
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (target.tagName === "INPUT" || target.tagName === "SELECT") {
        event.preventDefault();
        focusStop(1);
      }
    }
  };

  const bringLast = () => {
    const previous = data.previous;
    if (!previous) return;
    setDraft((current) => ({
      ...current,
      symptoms: [...new Set([...current.symptoms, ...previous.symptoms])],
      tongue: previous.tongue.length > 0 ? previous.tongue : current.tongue,
      pulse: previous.pulse.length > 0 ? previous.pulse : current.pulse,
      syndrome: previous.syndrome || current.syndrome,
      treatment: previous.treatment || current.treatment,
      advice: previous.advice || current.advice,
      followupDays: previous.followupDays ? String(previous.followupDays) : current.followupDays,
      prescription: {
        ...current.prescription,
        formulaName: previous.formulaName || current.prescription.formulaName,
        usageText: previous.usageText || current.prescription.usageText,
        doses: previous.doses ? String(previous.doses) : current.prescription.doses,
        items: previous.items.map((line, index) => {
          const parsed = parseDose(line.dose);
          return {
            key: `prev-${index}-${line.name}`,
            name: line.name,
            doseValue: parsed.value,
            doseUnit: parsed.unit,
            role: null,
          };
        }),
      },
    }));
    setDirty(true);
    setToast("已带入上次记录，改几处即可保存");
  };

  const missing = errors.map((error) => error.message);

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar
        title={
          <span className="flex items-baseline gap-2.5">
            <Link
              href={`/patients/${data.patient.id}`}
              className="text-[12.5px] text-ink-3 hover:text-brand font-normal"
            >
              {data.patient.name}
            </Link>
            <span className="text-ink-4 font-normal">/</span>
            <span className="text-[15px] font-normal text-ink-2">
              第 {data.visitNo} 次接诊
            </span>
          </span>
        }
        subtitle={
          <span className="flex items-center gap-2 text-[12px] text-ink-3 num">
            <span>
              {genderLabel(data.patient.gender)}
              {data.patient.birthYear ? ` · ${ageOf(data.patient.birthYear)}` : ""}
            </span>
            <span className="text-ink-4">·</span>
            <span>{timerOn ? `本次录入 ${mmss(seconds)}` : `用时 ${mmss(seconds)}`}</span>
            <span className="text-ink-4">·</span>
            <span className={dirty ? "text-accent-ink" : "text-ink-4"}>
              {dirty ? "未保存" : status === "signed" ? `已保存第 ${revisionNo} 版` : "待填写"}
            </span>
          </span>
        }
        actions={
          <>
            {data.previous ? (
              <button type="button" className="btn btn-ghost" onClick={bringLast}>
                带入上次记录（可修改）
              </button>
            ) : null}
            <Link href={`/patients/${data.patient.id}`} className="btn btn-quiet">
              返回
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleSave(true)}
              disabled={saving || errors.length > 0}
              title="Ctrl+Enter"
            >
              保存并打印
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave(false)}
              disabled={saving || errors.length > 0}
            >
              {saving ? "保存中…" : isAmend ? "保存修订" : "保存并签名"}
            </button>
          </>
        }
      />

      {missing.length > 0 ? (
        <div className="px-[26px] pt-3">
          <p className="text-[12px] text-ink-3">
            待补：<span className="text-danger">{missing.join("、")}</span>
            <span className="text-ink-4">　（填完即可保存与打印）</span>
          </p>
        </div>
      ) : null}

      {serverError ? (
        <div className="px-[26px] pt-3">
          <div className="flex items-center justify-between gap-4 rounded-[8px] border border-chip-danger-line bg-chip-danger-bg px-3 py-2">
            <p className="text-[12.5px] text-danger">未保存：{serverError}</p>
            <button
              type="button"
              className="btn btn-ghost h-[28px] text-[12px]"
              onClick={() => void handleSave(false)}
            >
              点击重试
            </button>
          </div>
        </div>
      ) : null}

      {isAmend ? (
        <div className="px-[26px] pt-3">
          <div className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-3 py-2">
            <span className="text-[12px] text-ink-3 shrink-0">
              病历不可原地修改 · 保存将生成第 {revisionNo + 1} 版，修订原因必填
            </span>
            <input
              className="input h-[30px] text-[12.5px] flex-1 max-w-[420px]"
              value={draft.amendedReason}
              placeholder="例如：患者服药后睡眠改善，酸枣仁加量"
              onChange={(event) => patch("amendedReason", event.target.value)}
              data-kb-stop
            />
          </div>
        </div>
      ) : null}

      <div
        ref={formRef}
        onKeyDown={onFormKeyDown}
        className="grid grid-cols-[minmax(0,1fr)_406px] items-start"
      >
        <div className="px-[26px] py-5 space-y-[13px] min-w-0">
          {/* 1 主诉 */}
          <section className="card p-4">
            <label className="field-label" htmlFor="chief">
              主诉
            </label>
            <input
              id="chief"
              data-kb-stop
              className="input consult-input-lg"
              placeholder="例如：入睡困难 3 月余，加重 2 周"
              value={draft.chiefComplaint}
              onChange={(event) => patch("chiefComplaint", event.target.value)}
            />
          </section>

          {/* 2 现病史 */}
          <section className="card p-4">
            <label className="field-label" htmlFor="present">
              现病史
            </label>
            <textarea
              id="present"
              data-kb-stop
              className="textarea"
              rows={4}
              placeholder="起病时间、诱因、症状变化、伴随症状、诊治经过…"
              value={draft.presentIllness}
              onChange={(event) => patch("presentIllness", event.target.value)}
            />
            {data.previous?.presentIllness ? (
              <div className="relative mt-2.5">
                <button
                  type="button"
                  onClick={() => setLastOpen((open) => !open)}
                  className="w-full text-left rounded-[6px] bg-ghost px-3 py-2 hover:brightness-[0.98] transition"
                >
                  <span className="block text-[11px] text-ink-4 mb-0.5">
                    上次记录（{formatDate(data.previous.visitAt)}）
                  </span>
                  <span className="block text-[12.5px] leading-[22px] text-ink-3 line-clamp-2">
                    {data.previous.presentIllness}
                  </span>
                </button>
                {lastOpen ? (
                  <div className="absolute z-10 left-0 right-0 mt-1 card p-2 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost h-[30px] text-[12px]"
                      onClick={() => {
                        patch("presentIllness", data.previous!.presentIllness);
                        setLastOpen(false);
                      }}
                    >
                      整段带入
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-[30px] text-[12px]"
                      onClick={() => {
                        const merged = draft.presentIllness.trim()
                          ? `${draft.presentIllness.trim()}\n${data.previous!.presentIllness}`
                          : data.previous!.presentIllness;
                        patch("presentIllness", merged);
                        setLastOpen(false);
                      }}
                    >
                      追加到末尾
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet h-[30px] text-[12px] ml-auto"
                      onClick={() => setLastOpen(false)}
                    >
                      收起
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* 3 问诊要点 */}
          <section className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="field-label !mb-0" htmlFor="symptom-filter">
                问诊要点
              </label>
              <span className="text-[11px] text-ink-4 num">已选 {draft.symptoms.length}</span>
            </div>
            <input
              id="symptom-filter"
              data-kb-stop
              className="input h-[32px] text-[12.5px] mb-2.5"
              placeholder="打字过滤词表，回车可新增自定义要点"
              value={symQuery}
              onChange={(event) => setSymQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && symQuery.trim()) {
                  event.preventDefault();
                  const value = symQuery.trim();
                  const exists = draft.symptoms.includes(value);
                  patch("symptoms", exists ? draft.symptoms : [...draft.symptoms, value]);
                  setSymQuery("");
                }
              }}
            />
            <div role="group" aria-label="问诊要点" data-kb-stop tabIndex={0} className="rounded-[6px]">
              <div className="flex flex-wrap gap-2">
                {symptoms.map((term) => {
                  const selected = draft.symptoms.includes(term);
                  return (
                    <button
                      key={term}
                      type="button"
                      tabIndex={-1}
                      aria-pressed={selected}
                      onClick={() => toggleArray("symptoms", term)}
                      className={selected ? "chip chip-lg chip-brand" : "chip chip-lg hover:border-line-strong"}
                    >
                      {symQuery && term.includes(symQuery) ? (
                        <mark className="bg-transparent text-inherit underline decoration-brand/40">
                          {term}
                        </mark>
                      ) : (
                        term
                      )}
                    </button>
                  );
                })}
                {symptoms.length === 0 ? (
                  <span className="text-[12.5px] text-ink-4">没有匹配的要点，回车可直接新增</span>
                ) : null}
              </div>
            </div>
          </section>

          {/* 4 舌象 / 脉象 */}
          <section className="card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="font-serif text-[16px] text-ink shrink-0 pt-0.5">舌</span>
              <TermChips
                category="tongue"
                items={data.vocabulary.tongue}
                selected={draft.tongue}
                onToggle={toggleTonguePulse("tongue")}
                ariaLabel="舌象"
              />
            </div>
            <div className="h-px bg-line-2" />
            <div className="flex items-start gap-3">
              <span className="font-serif text-[16px] text-ink shrink-0 pt-0.5">脉</span>
              <TermChips
                category="pulse"
                items={data.vocabulary.pulse}
                selected={draft.pulse}
                onToggle={toggleTonguePulse("pulse")}
                ariaLabel="脉象"
              />
            </div>
            <div className="h-px bg-line-2" />
            <AttachmentGallery
              patientId={data.patient.id}
              visitId={data.visitId}
              items={tonguePhotos}
              defaultKind="tongue"
              compact
              title="舌象照片"
            />
          </section>

          {/* 5 辨证与治法 */}
          <section className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="field-label !mb-0">辨证与治法</span>
              <span className="text-[11px] text-ink-4">
                候选按主诉关键词排前 · 「＋ 自定义」加的证型全站可用
              </span>
            </div>
            <TermChips
              category="syndrome"
              items={syndromeChipItems}
              mode="single"
              selected={draft.syndrome ? [draft.syndrome] : []}
              onToggle={toggleSyndrome}
              ariaLabel="证型候选"
              visibleCount={12}
            />
            <div className="grid grid-cols-2 gap-3 mt-2.5">
              <div>
                <label className="field-label" htmlFor="syndrome">
                  证型
                </label>
                <input
                  id="syndrome"
                  data-kb-stop
                  className="input"
                  placeholder="如 心脾两虚"
                  value={draft.syndrome}
                  onChange={(event) => patch("syndrome", event.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="treatment">
                  治法
                </label>
                <input
                  id="treatment"
                  data-kb-stop
                  className="input"
                  placeholder="如 益气补血，健脾养心"
                  value={draft.treatment}
                  onChange={(event) => patch("treatment", event.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex items-start gap-3">
              <span className="shrink-0 pt-0.5 text-[11px] text-ink-4 w-[26px]">常用</span>
              <TermChips
                category="treatment"
                items={data.vocabulary.treatment}
                mode="single"
                selected={draft.treatment ? [draft.treatment] : []}
                onToggle={toggleTreatment}
                ariaLabel="常用治法"
                visibleCount={10}
              />
            </div>
          </section>

          {/* 6 医嘱与复诊 */}
          <section className="card p-4">
            <label className="field-label" htmlFor="advice">
              医嘱
            </label>
            <textarea
              id="advice"
              data-kb-stop
              className="textarea"
              rows={3}
              placeholder="饮食起居、忌口、服药注意…"
              value={draft.advice}
              onChange={(event) => patch("advice", event.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <label className="field-label" htmlFor="doses">
                  剂数
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="doses"
                    ref={dosesRef}
                    data-kb-stop
                    inputMode="numeric"
                    className="input w-[72px] text-right num"
                    value={draft.prescription.doses}
                    onChange={(event) => patchRx({ doses: event.target.value.replace(/[^\d]/g, "") })}
                  />
                  <span className="text-[12.5px] text-ink-3">剂</span>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="followup">
                  复诊
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="followup"
                    data-kb-stop
                    inputMode="numeric"
                    className="input w-[72px] text-right num"
                    value={draft.followupDays}
                    onChange={(event) => patch("followupDays", event.target.value.replace(/[^\d]/g, ""))}
                  />
                  <span className="text-[12.5px] text-ink-3">天后</span>
                </div>
              </div>
              <button
                type="button"
                data-kb-stop
                aria-pressed={draft.remindFollowup}
                onClick={() => patch("remindFollowup", !draft.remindFollowup)}
                className="btn btn-ghost h-[34px]"
              >
                <span
                  className={`inline-block w-8 h-[18px] rounded-full relative transition-colors ${
                    draft.remindFollowup ? "bg-brand-solid" : "bg-line"
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${
                      draft.remindFollowup ? "left-[16px]" : "left-[2px]"
                    }`}
                  />
                </span>
                <span className="text-[12.5px] text-ink-2">
                  {draft.remindFollowup ? "就诊时提醒复诊" : "不提醒复诊"}
                </span>
              </button>
            </div>
          </section>

          <p className="text-[11.5px] text-ink-4 leading-relaxed px-1 pb-6">
            快捷键：Tab 依次到下一项 · Enter 下一项 · Ctrl+K 知识检索 · Ctrl+Enter 保存并打印
          </p>
        </div>

        {/* 右栏 · 处方：跟着页面滚动钉住，改左栏时处方始终在视野里 */}
        <aside className="sticky top-[74px] max-h-[calc(100vh-74px)] overflow-y-auto bg-panel border-l border-line px-5 py-5 space-y-3.5">
          <div className="flex items-baseline justify-between">
            <h2 className="section-title">处方</h2>
            <button
              type="button"
              className="text-[11.5px] text-ink-4 hover:text-brand"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))
              }
            >
              从知识库取方（Ctrl+K）
            </button>
          </div>

          {incompatibilities.length > 0 ? (
            <div className="rounded-[8px] border border-chip-accent-line bg-accent px-3 py-2">
              <p className="text-[12px] text-accent-ink font-medium mb-1">
                配伍提示（十八反 / 十九畏）
              </p>
              <ul className="space-y-0.5">
                {incompatibilities.map((pair) => (
                  <li key={`${pair.herbA}-${pair.herbB}`} className="text-[12px] text-accent-ink">
                    {pair.herbA} 与 {pair.herbB}（{pair.rule}）
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-accent-ink/70 mt-1">仅提示，不阻止保存。</p>
            </div>
          ) : null}

          {/* 方名卡 */}
          <section className="card p-4">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 min-w-0 font-serif text-[21px] font-semibold text-ink bg-transparent border-0 outline-none placeholder:text-ink-4"
                placeholder="方名（可手填）"
                value={draft.prescription.formulaName}
                onChange={(event) => patchRx({ formulaName: event.target.value })}
              />
              {data.kbFormula && !kbDiff.empty ? <span className="chip chip-accent shrink-0">加减</span> : null}
            </div>
            <p className="mt-1 font-serif text-[12px] text-ink-3">
              {draft.prescription.formulaSource || data.kbFormula?.source || "未标出处"}
              {data.kbFormula?.efficacy ? ` · ${data.kbFormula.efficacy}` : ""}
            </p>
          </section>

          {/* 药味卡 */}
          <section className="card p-3">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[11.5px] text-ink-3">药味</span>
              <span className="text-[11px] text-ink-4 num">共 {rxLines.length} 味</span>
            </div>
            <ul className="divide-y divide-line-2/70">
              {draft.prescription.items.map((item, index) => (
                <li
                  key={item.key}
                  className="group flex items-center gap-2 h-9 rounded-[6px] px-1 hover:bg-ghost"
                >
                  <input
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none font-serif text-[15px] text-ink placeholder:text-ink-4"
                    placeholder="药名"
                    aria-label={`第 ${index + 1} 味药名`}
                    value={item.name}
                    onChange={(event) => {
                      const items = draft.prescription.items.slice();
                      items[index] = { ...item, name: event.target.value };
                      setItems(items);
                    }}
                  />
                  <input
                    inputMode="decimal"
                    className="w-[46px] text-right num text-[13px] text-ink bg-transparent border-0 outline-none placeholder:text-ink-4"
                    placeholder="—"
                    aria-label={`第 ${index + 1} 味剂量`}
                    value={item.doseValue}
                    aria-invalid={item.name.trim() !== "" && !isNumericDose(item.doseValue)}
                    onChange={(event) => {
                      const items = draft.prescription.items.slice();
                      items[index] = { ...item, doseValue: event.target.value.replace(/[^\d.]/g, "") };
                      setItems(items);
                    }}
                  />
                  <input
                    className="w-[26px] text-[12px] text-ink-3 bg-transparent border-0 outline-none"
                    aria-label={`第 ${index + 1} 味单位`}
                    value={item.doseUnit}
                    onChange={(event) => {
                      const items = draft.prescription.items.slice();
                      items[index] = { ...item, doseUnit: event.target.value };
                      setItems(items);
                    }}
                  />
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title="替换药名"
                      className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:text-brand hover:bg-surface"
                      onClick={(event) => {
                        const row = event.currentTarget.closest("li");
                        const input = row?.querySelector<HTMLInputElement>('input[aria-label$="味药名"]');
                        input?.focus();
                        input?.select();
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M4 7h9M15 7h5M4 17h5M11 17h9M13 4v6M7 14v6"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="删除这味"
                      className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:text-danger hover:bg-surface"
                      onClick={() => setItems(draft.prescription.items.filter((entry) => entry.key !== item.key))}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M6 6l12 12M18 6L6 18"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-1.5 w-full h-8 rounded-[6px] text-[12.5px] text-ink-3 hover:text-brand hover:bg-ghost transition-colors"
              onClick={() => setItems([...draft.prescription.items, newHerb()])}
            >
              + 加一味药
            </button>
          </section>

          {/* 较上次处方 */}
          <section className="rounded-[10px] bg-accent border border-chip-accent-line px-3.5 py-2.5">
            <p className="text-[11.5px] text-accent-ink font-medium mb-1">
              较上次处方{data.previous ? `（${formatDate(data.previous.visitAt)}）` : ""}
            </p>
            {!data.previous ? (
              <p className="text-[12px] text-accent-ink/80">该患者为初诊，暂无上次处方可比。</p>
            ) : rxLines.length === 0 ? (
              <p className="text-[12px] text-accent-ink/80">
                本次尚未填处方；上次为{data.previous.formulaName || "未命名方"}（{data.previous.items.length} 味）。
                可点「带入上次记录」沿用后再加减。
              </p>
            ) : diff.empty ? (
              <p className="text-[12px] text-accent-ink">与上次一致（效不更方）</p>
            ) : (
              <p className="text-[12px] text-accent-ink leading-[20px]">
                {diff.added.length > 0
                  ? `加 ${diff.added.map((line) => `${line.name}${line.dose}`).join("、")}`
                  : null}
                {diff.added.length > 0 && (diff.removed.length > 0 || diff.changed.length > 0) ? "；" : null}
                {diff.removed.length > 0
                  ? `减 ${diff.removed.map((line) => line.name).join("、")}`
                  : null}
                {diff.removed.length > 0 && diff.changed.length > 0 ? "；" : null}
                {diff.changed.length > 0
                  ? `改 ${diff.changed.map((line) => `${line.name} ${line.from}→${line.to}`).join("、")}`
                  : null}
              </p>
            )}
          </section>

          {/* 方解摘录 */}
          <section className="rounded-[10px] bg-ghost px-3.5 py-2.5">
            <p className="text-[11.5px] text-ink-3 mb-1">方解摘录</p>
            {data.kbFormula ? (
              <>
                <p className="text-[12px] text-ink-2 leading-[20px] line-clamp-4">
                  {data.kbFormula.commentary ||
                    data.kbFormula.indication ||
                    "知识库暂无方解，可在知识库里补充。"}
                </p>
                <p className="mt-1 text-[11px] text-ink-4">
                  {data.kbFormula.source || "出处未标"} · 知识库第 {data.kbFormula.version} 版
                </p>
              </>
            ) : (
              <p className="text-[12px] text-ink-4 leading-[20px]">
                知识库暂未收录此方。知识库导入上线后，这里会显示方解、主治与出处原文。
              </p>
            )}
          </section>

          {/* 用法 */}
          <section className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-ink-3 num">
                共 {rxLines.length} 味 · {draft.prescription.doses || "0"} 剂
              </span>
              <span className="text-[11px] text-ink-4">用法</span>
            </div>
            <input
              className="input h-[32px] text-[12px]"
              value={draft.prescription.usageText}
              placeholder={DEFAULT_USAGE}
              onChange={(event) => patchRx({ usageText: event.target.value })}
            />
          </section>

          {/* 常用方 / 协定处方：套用后仍可逐味改 */}
          <section className="rounded-[10px] border border-line-2 overflow-hidden">
            <details>
              <summary className="flex items-center justify-between px-3.5 h-[34px] cursor-pointer select-none hover:bg-ghost">
                <span className="text-[11.5px] text-ink-3">
                  我的常用方 · 协定处方
                  <span className="text-ink-4 num"> （{data.templates.length}）</span>
                </span>
                <span className="text-[11px] text-ink-4">点开套用</span>
              </summary>
              <div className="px-3.5 pb-3 space-y-1">
                {data.templates.length === 0 ? (
                  <p className="text-[11.5px] text-ink-4 leading-relaxed py-1">
                    还没有存过方。签完一张处方后点「存为我的常用方」，下次相同情况可一键套用。
                  </p>
                ) : (
                  data.templates.map((template) => (
                    <div
                      key={template.id}
                      className="group flex items-center gap-2 rounded-[6px] px-1.5 h-[30px] hover:bg-ghost"
                    >
                      <span className="text-[12.5px] text-ink truncate">{template.name}</span>
                      <span className="text-[11px] text-ink-4 num">{template.items.length} 味</span>
                      <span className="text-[10.5px] text-ink-4">
                        {template.kind === "agreed" ? "协定" : "常用"}
                      </span>
                      <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="text-[11.5px] text-brand hover:underline"
                          onClick={() => applyTemplate(template)}
                        >
                          套用
                        </button>
                        <button
                          type="button"
                          className="w-5 h-5 grid place-items-center text-ink-4 hover:text-danger"
                          title="删除"
                          onClick={() => handleDeleteTemplate(template)}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </details>
          </section>

          {/* 快捷操作 */}
          <section className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost flex-1 h-[32px] text-[12px]"
              onClick={async () => {
                const result = await saveAsTemplate(data.visitId, "favorite");
                setToast(result.ok ? `已存为：${result.name}` : result.message);
                router.refresh();
              }}
            >
              存为我的常用方
            </button>
            <button
              type="button"
              className="btn btn-ghost flex-1 h-[32px] text-[12px]"
              onClick={async () => {
                const result = await saveAsTemplate(data.visitId, "agreed");
                setToast(result.ok ? `已存为：${result.name}` : result.message);
                router.refresh();
              }}
            >
              另存为协定处方
            </button>
          </section>

          <p className="text-[11px] text-ink-4 leading-relaxed">
            药物剂量按医生填写为准；本页不做任何自动辨证与自动出方。
          </p>
        </aside>
      </div>

      {kbPending ? (
        <div
          className="fixed inset-0 z-40 bg-black/35 flex justify-center items-start pt-[20vh] px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setKbPending(null);
          }}
        >
          <div className="w-full max-w-[440px] card rounded-overlay p-5 shadow-pop">
            <h2 className="font-serif text-[17px] text-ink">处方里已有药味</h2>
            <p className="mt-1.5 text-[12.5px] text-ink-3 leading-relaxed">
              把《{kbPending.name}》的 {kbPending.components.length} 味药
              {draft.prescription.items.some((item) => item.name.trim()) ? "替换现有处方，还是接在后面一起用？" : ""}
            </p>
            <div className="mt-4 flex items-center gap-2 justify-end">
              <button type="button" className="btn btn-quiet" onClick={() => setKbPending(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const payload = kbPending;
                  setKbPending(null);
                  if (!payload) return;
                  const merged: HerbDraft[] = payload.components.map((part, index) => {
                    const dose = parseDose(part.dose);
                    return {
                      key: `kb-${payload.kbItemId}-${index}`,
                      name: part.name,
                      doseValue: dose.value,
                      doseUnit: dose.unit || "g",
                      role: null,
                    };
                  });
                  setDraft((current) => {
                    const items = [...current.prescription.items.filter((item) => item.name.trim()), ...merged];
                    return {
                      ...current,
                      prescription: {
                        ...current.prescription,
                        formulaName: current.prescription.formulaName
                          ? `${current.prescription.formulaName}＋${payload.name}`
                          : payload.name,
                        kbItemId: payload.kbItemId,
                        kbItemVersion: payload.kbItemVersion,
                        items,
                      },
                    };
                  });
                  setDirty(true);
                  setToast(`已追加${merged.length} 味，《${payload.name}》记为方源`);
                  window.setTimeout(() => dosesRef.current?.focus(), 40);
                }}
              >
                追加在后面
              </button>
              <button type="button" className="btn btn-primary" onClick={() => applyKbFormula(kbPending)}>
                替换为这个方
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 card px-4 py-2.5 shadow-pop">
          <p className="text-[12.5px] text-ink">{toast}</p>
        </div>
      ) : null}
    </div>
  );
}
