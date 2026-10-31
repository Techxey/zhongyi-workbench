"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPatient } from "../actions";
import { GENDER_OPTIONS, isValidPhone } from "@/lib/format";
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "正在建档…" : "保存并建档"}
    </button>
  );
}

export function NewPatientForm() {
  const [state, formAction] = useActionState<FormState, FormData>(createPatient, idleState);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const serverErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const errors: Record<string, string> = { ...serverErrors, ...clientErrors };

  function validate(field: string, value: string) {
    let message = "";
    if (field === "name" && !value.trim()) message = "请填写姓名";
    if (field === "name" && value.trim().length > 20) message = "姓名不超过 20 个字";
    if (field === "birthYear") {
      const year = value ? Number(value) : NaN;
      const max = new Date().getFullYear();
      if (value && (!Number.isInteger(year) || year < 1900 || year > max)) {
        message = `出生年应在 1900–${max} 之间`;
      }
    }
    if (field === "phone" && value && !isValidPhone(value)) message = "请填写 11 位手机号";
    setClientErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function clearError(field: string) {
    if (!clientErrors[field]) return;
    setClientErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  return (
    <form action={formAction}>
      <div className="card">
        <div className="px-5 h-[52px] flex items-center border-b border-line-2">
          <h2 className="section-title">基本信息</h2>
          <span className="ml-3 text-[11.5px] text-ink-4">带 * 为必填，其余可后补</span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5">
          <Field label="姓名" required error={errors.name}>
            <input
              name="name"
              className="input"
              placeholder="患者姓名"
              autoFocus
              aria-invalid={!!errors.name}
              onBlur={(e) => validate("name", e.target.value)}
              onChange={(e) => clearError("name")}
            />
          </Field>

          <Field label="性别" required error={errors.gender}>
            <select
              name="gender"
              className="input"
              defaultValue=""
              aria-invalid={!!errors.gender}
              onChange={(e) => clearError("gender")}
            >
              <option value="" disabled>
                请选择
              </option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="出生年" required error={errors.birthYear}>
            <input
              name="birthYear"
              type="number"
              inputMode="numeric"
              className="input num"
              placeholder="如 1984"
              aria-invalid={!!errors.birthYear}
              onBlur={(e) => validate("birthYear", e.target.value)}
              onChange={(e) => clearError("birthYear")}
            />
          </Field>

          <Field label="手机号" error={errors.phone}>
            <input
              name="phone"
              className="input num"
              placeholder="11 位手机号"
              aria-invalid={!!errors.phone}
              onBlur={(e) => validate("phone", e.target.value)}
              onChange={(e) => clearError("phone")}
            />
          </Field>

          <Field label="体质" error={errors.constitution}>
            <select name="constitution" className="input" defaultValue="">
              <option value="">未辨识</option>
              {CONSTITUTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <div />

          <div className="col-span-2">
            <Field label="过敏史" error={errors.allergy}>
              <textarea
                name="allergy"
                className="textarea min-h-[64px]"
                placeholder="药物 / 食物过敏，例如「青霉素过敏」；没有就留空"
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="既往史" error={errors.pastHistory}>
              <textarea
                name="pastHistory"
                className="textarea min-h-[72px]"
                placeholder="慢性病、手术史、长期用药等"
              />
            </Field>
          </div>
        </div>

        {state.status === "error" && Object.keys(serverErrors).length === 0 ? (
          <p className="px-5 pb-3 field-error">{state.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between mt-5">
        <p className="text-[11.5px] text-ink-4">
          患者档案只保存在本机 SQLite 数据库，请定期在设置里导出备份。
        </p>
        <div className="flex items-center gap-2">
          <Link href="/patients" className="btn btn-ghost">
            取消
          </Link>
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="field-label">
        {label}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
