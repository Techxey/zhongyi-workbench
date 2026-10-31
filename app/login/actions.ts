"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type LoginState = { error?: string; username?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/patients";

  if (!username || !password) {
    return { error: "请输入账号和密码", username };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return { error: "账号或密码不正确", username };
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "账号或密码不正确", username };
  }

  await createSession({ id: user.id, name: user.displayName, role: user.role });
  redirect(next.startsWith("/") ? next : "/patients");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
