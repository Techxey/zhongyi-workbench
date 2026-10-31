import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ThemeFloatingToggle } from "@/components/theme-toggle";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "登录 · 中医诊疗工作台",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; passwordChanged?: string }>;
}) {
  const user = await getSession();
  if (user) redirect("/patients");
  const { next, passwordChanged } = await searchParams;

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-6 py-16">
      <ThemeFloatingToggle />
      <div className="w-full max-w-[392px]">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-10 h-10 rounded-[9px] bg-brand-solid text-white grid place-items-center font-serif text-[19px] leading-none">
            医
          </div>
          <div>
            <h1 className="font-serif text-[21px] leading-tight text-ink tracking-wide">
              中医诊疗工作台
            </h1>
            <p className="text-[12px] text-ink-3 mt-0.5">个人诊所 · 单人工作站</p>
          </div>
        </div>

        {passwordChanged ? (
          <p className="mb-4 text-[12.5px] text-brand bg-brand-soft border border-chip-brand-line rounded-[8px] px-3 py-2">
            密码已修改，请用新密码重新登录。
          </p>
        ) : null}

        <div className="card p-6">
          <h2 className="text-[14px] text-ink mb-1">医生登录</h2>
          <p className="text-[12.5px] text-ink-3 mb-5">
            病历与处方只保存在本机，请勿共用账号。
          </p>
          <LoginForm next={next} />
        </div>

        <p className="text-[12px] text-ink-4 mt-5 leading-relaxed">
          首次运行：种子账号 <span className="text-ink-2">doctor / doctor1234</span>
          ，登录后可在设置里修改。本系统不提供自动辨证与自动出方，所有辨证与处方由医生本人完成。
        </p>
      </div>
    </div>
  );
}
