"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { updatePatient, revealPhone } from "../actions";
import { GENDER_OPTIONS, ageOf, formatDate, maskPhone } from "@/lib/format";
import { idleState, type FormState } from "@/lib/validation";

const CONSTITUTIONS = [
  "平和质",
  "气虚质",
  "阳虚质",
  "阴虚质",
  "痰湿质",
  "湿热质",
  "血瘀质",
  "气郁质",
  "特禀质",
];

export type PatientDetail = {
  id: string;
  name: string;
  cardNo: string | null;
  gender: string | null;
  birthYear: number | null;
  phone: string | null;
  constitution: string | null;
  allergy: string | null;
  pastHistory: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export function PatientInfoCard({ patient }: { patient: PatientDetail }) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updatePatient.bind(null, patient.id),
    idleState,
  );

  useEffect(() => {
    if (state.status === "ok") setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <section className="card">
        <div className="flex items-center justify-between px-4 h-[46px] border-b border-line-2">
          <h2 className="section-title">基本信息</h2>
          <button type="button" className="btn btn-quiet h-7 px-2 text-[12.5px]" onClick={() => setEditing(true)}>
            编辑
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 px-4 py-4">
          <div>
            <dt className="text-[11.5px] text-ink-4 mb-0.5">姓名</dt>
            <dd className="text-[13.5px] text-ink">{patient.name}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-4 mb-0.5">性别 · 年龄</dt>
            <dd className="text-[13.5px] text-ink">
              {GENDER_OPTIONS.find((g) => g.value === patient.gender)?.label ?? "未填"}
              {patient.birthYear ? ` · ${ageOf(patient.birthYear)}（${patient.birthYear} 年生）` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-4 mb-0.5">手机号</dt>
            <dd className="text-[13.5px] text-ink num flex items-center gap-2">
              {patient.phone ? (revealed ?? maskPhone(patient.phone)) : <span className="text-ink-4">未填</span>}
              {patient.phone && !revealed ? (
                <button
                  type="button"
                  className="text-[11.5px] text-brand hover:underline"
                  onClick={async () => {
                    const res = await revealPhone(patient.id);
                    if (res.phone) setRevealed(res.phone);
                  }}
                >
                  查看完整
                </button>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-4 mb-0.5">门诊卡号</dt>
            <dd className="text-[13.5px] text-ink num">
              {patient.cardNo || <span className="text-ink-4">未绑卡</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-4 mb-0.5">体质</dt>
            <dd className="text-[13.5px] text-ink">
              {patient.constitution ? (
                <span className="chip chip-brand">{patient.constitution}</span>
              ) : (
                <span className="text-ink-4">未辨识</span>
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11.5px] text-ink-4 mb-0.5">过敏史</dt>
            <dd className="text-[13.5px] text-ink whitespace-pre-wrap">
              {patient.allergy ? (
                <span className="text-danger">{patient.allergy}</span>
              ) : (
                <span className="text-ink-4">否认</span>
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11.5px] text-ink-4 mb-0.5">既往史</dt>
            <dd className="text-[13.5px] text-ink-2 whitespace-pre-wrap">
              {patient.pastHistory || <span className="text-ink-4">未记录</span>}
            </dd>
          </div>
          {patient.note ? (
            <div className="col-span-2">
              <dt className="text-[11.5px] text-ink-4 mb-0.5">备注</dt>
              <dd className="text-[13.5px] text-ink-2 whitespace-pre-wrap">{patient.note}</dd>
            </div>
          ) : null}
          <div className="col-span-2 pt-1 flex items-center gap-4 text-[11.5px] text-ink-4">
            <span>建档 {formatDate(patient.createdAt)}</span>
            <span>最近更新 {formatDate(patient.updatedAt)}</span>
          </div>
        </dl>
      </section>
    );
  }

  const fe = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <section className="card">
      <form action={formAction}>
        <div className="flex items-center justify-between px-4 h-[46px] border-b border-line-2">
          <h2 className="section-title">编辑基本信息</h2>
          <span className="text-[11.5px] text-ink-4">修改会留下审计记录</span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4">
          <Field label="姓名" error={fe.name}>
            <input name="name" className="input" defaultValue={patient.name} aria-invalid={!!fe.name} />
          </Field>
          <Field label="性别" error={fe.gender}>
            <select name="gender" className="input" defaultValue={patient.gender ?? "unknown"}>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="出生年" error={fe.birthYear}>
            <input
              name="birthYear"
              type="number"
              inputMode="numeric"
              className="input num"
              defaultValue={patient.birthYear ?? ""}
              placeholder="如 1984"
              aria-invalid={!!fe.birthYear}
            />
          </Field>
          <Field label="手机号" error={fe.phone}>
            <input
              name="phone"
              className="input num"
              defaultValue={patient.phone ?? ""}
              placeholder="11 位手机号"
              aria-invalid={!!fe.phone}
            />
          </Field>
          <Field label="体质" error={fe.constitution}>
            <select name="constitution" className="input" defaultValue={patient.constitution ?? ""}>
              <option value="">未辨识</option>
              {CONSTITUTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="门诊卡号" error={fe.cardNo}>
            <input
              name="cardNo"
              className="input num"
              defaultValue={patient.cardNo ?? ""}
              placeholder="可选，如 A0001"
              aria-invalid={!!fe.cardNo}
            />
          </Field>
          <div />
          <div className="col-span-2">
            <Field label="过敏史" error={fe.allergy}>
              <textarea
                name="allergy"
                className="textarea min-h-[60px]"
                defaultValue={patient.allergy ?? ""}
                placeholder="药物 / 食物 / 其他；没有就留空，列表里显示为「否认」"
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="既往史" error={fe.pastHistory}>
              <textarea
                name="pastHistory"
                className="textarea min-h-[80px]"
                defaultValue={patient.pastHistory ?? ""}
                placeholder="慢性病、手术史、长期用药等"
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="备注" error={fe.note}>
              <textarea
                name="note"
                className="textarea min-h-[60px]"
                defaultValue={patient.note ?? ""}
              />
            </Field>
          </div>
        </div>

        {state.status === "error" && !Object.keys(fe).length ? (
          <p className="px-4 pb-2 field-error">{state.message}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 px-4 h-[56px] border-t border-line-2">
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={pending}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function EmptyTimelineLink() {
  return (
    <Link href="/patients/new" className="btn btn-ghost">
      新建患者
    </Link>
  );
}
