"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsState } from "./actions";
import { formatDateTime } from "@/lib/format";

export function SettingsForm({
  backupRetentionDays,
  updatedAt,
}: {
  backupRetentionDays: number;
  updatedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveSettings, {});

  return (
    <section className="card">
      <div className="px-5 h-[50px] flex items-center border-b border-line-2">
        <h2 className="section-title">备份</h2>
        <span className="ml-3 text-[11.5px] text-ink-4">保留天数由你自己决定</span>
      </div>
      <form action={formAction} className="px-5 py-4">
        <div className="flex items-end gap-4">
          <div className="w-[200px]">
            <label className="field-label" htmlFor="backupRetentionDays">
              备份保留天数
            </label>
            <div className="flex items-center gap-2">
              <input
                id="backupRetentionDays"
                name="backupRetentionDays"
                type="number"
                min={1}
                max={3650}
                className="input num"
                defaultValue={backupRetentionDays}
              />
              <span className="text-[13px] text-ink-3 shrink-0">天</span>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </button>
          {state.ok ? <span className="text-[12.5px] text-brand">已保存</span> : null}
          {state.error ? <span className="field-error">{state.error}</span> : null}
        </div>
        <p className="text-[12px] text-ink-4 mt-3 leading-relaxed">
          超过保留天数的自动备份会被清理；手动备份不受此设置限制。
          {updatedAt ? ` 上次修改：${formatDateTime(updatedAt)}` : ""}
        </p>
      </form>
    </section>
  );
}
