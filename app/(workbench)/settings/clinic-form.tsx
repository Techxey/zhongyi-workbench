"use client";

import { useActionState } from "react";

import { saveClinic, type SettingsState } from "./actions";

export function ClinicForm({
  clinicName,
  doctorName,
  defaultUsage,
}: {
  clinicName: string;
  doctorName: string;
  defaultUsage: string;
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveClinic, {});

  return (
    <section className="card">
      <div className="px-5 h-[50px] flex items-center border-b border-line-2">
        <h2 className="section-title">诊所信息</h2>
        <span className="ml-3 text-[11.5px] text-ink-4">
          打印处方抬头、医师署名与默认用法都按这里走
        </span>
      </div>
      <form action={formAction} className="px-5 py-4 space-y-3.5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="clinic_name">
              诊所名称
            </label>
            <input
              id="clinic_name"
              name="clinic_name"
              className="input"
              maxLength={40}
              defaultValue={clinicName}
              placeholder="如 杏林堂中医诊所"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="clinic_doctor">
              医生署名
            </label>
            <input
              id="clinic_doctor"
              name="clinic_doctor"
              className="input"
              maxLength={20}
              defaultValue={doctorName}
              placeholder="如 李医生"
            />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="default_usage">
            处方默认用法
          </label>
          <input
            id="default_usage"
            name="default_usage"
            className="input"
            maxLength={60}
            defaultValue={defaultUsage}
            placeholder="每日 1 剂，水煎 400ml，分早晚温服"
          />
          <p className="text-[11.5px] text-ink-4 mt-1.5">
            新开处方时预填这一行，医生仍可逐张改。写成你诊所惯用的煎服法即可。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "保存中…" : "保存诊所信息"}
          </button>
          {state.ok ? <span className="text-[12.5px] text-brand">已保存</span> : null}
          {state.error ? <span className="field-error">{state.error}</span> : null}
        </div>
      </form>
    </section>
  );
}
