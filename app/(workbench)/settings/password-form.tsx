"use client";

import { useActionState } from "react";

import { changePassword, type SettingsState } from "./actions";

const initial: SettingsState = {};

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);

  return (
    <form action={action} className="space-y-3 border-t border-line-2 pt-4">
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="field-label">当前密码</span>
          <input type="password" name="currentPassword" className="input" autoComplete="current-password" />
        </label>
        <label className="block">
          <span className="field-label">新密码（≥8 位）</span>
          <input type="password" name="newPassword" className="input" autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="field-label">再输一次新密码</span>
          <input type="password" name="confirmPassword" className="input" autoComplete="new-password" />
        </label>
      </div>
      {state.error ? <p className="field-error">{state.error}</p> : null}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "保存中…" : "修改密码"}
        </button>
        <span className="text-[12px] text-ink-4">改完会退出登录，用新密码重新进。</span>
      </div>
    </form>
  );
}
