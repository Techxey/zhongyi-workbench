"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "正在进入…" : "进入工作台"}
    </button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="field-label" htmlFor="username">
          账号
        </label>
        <input
          id="username"
          name="username"
          className="input"
          autoComplete="username"
          defaultValue={state.username ?? ""}
          placeholder="医生账号"
          autoFocus
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          placeholder="登录密码"
          aria-invalid={state.error ? true : undefined}
        />
      </div>

      {state.error ? (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
