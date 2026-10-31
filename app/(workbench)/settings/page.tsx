import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getThemeChoice } from "@/lib/theme-server";
import { TopBar } from "@/components/topbar";
import { ThemeSegmented } from "@/components/theme-toggle";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "设置 · 中医诊疗工作台",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const theme = await getThemeChoice();

  const [retention, patientCount, kbCount, visitCount] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "backup_retention_days" } }),
    prisma.patient.count(),
    prisma.kbItem.count(),
    prisma.visit.count(),
  ]);

  return (
    <>
      <TopBar title="设置" subtitle="账号、数据与备份" />
      <div className="px-[26px] py-6 max-w-[820px] space-y-5">
        <section className="card">
          <div className="px-5 h-[50px] flex items-center border-b border-line-2">
            <h2 className="section-title">账号</h2>
          </div>
          <dl className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-3">
            <div>
              <dt className="text-[11.5px] text-ink-4 mb-0.5">当前登录</dt>
              <dd className="text-[13.5px] text-ink">{user.name}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-ink-4 mb-0.5">角色</dt>
              <dd className="text-[13.5px] text-ink">{user.role === "doctor" ? "医生（单选）" : user.role}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11.5px] text-ink-4 mb-0.5">使用范围</dt>
              <dd className="text-[13px] text-ink-2 leading-relaxed">
                单人诊所工作站，不设多医生协作与权限矩阵。病历只保存在本机。
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <div className="px-5 h-[50px] flex items-center border-b border-line-2">
            <h2 className="section-title">外观</h2>
            <span className="ml-2 text-[11.5px] text-ink-4">夜间模式可随时切换，侧栏底部也有快捷开关</span>
          </div>
          <div className="px-5 py-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ThemeSegmented initial={theme} />
            <p className="text-[12.5px] text-ink-3 leading-relaxed max-w-[420px]">
              夜间为墨色暖调底色，不用纯黑：长时间看舌象照片与药味剂量时更不刺眼。选择会记在本机浏览器里。
            </p>
          </div>
        </section>

        <section className="card">
          <div className="px-5 h-[50px] flex items-center border-b border-line-2">
            <h2 className="section-title">数据</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-[11.5px] text-ink-4 mb-0.5">患者</dt>
                <dd className="text-[15px] text-ink num">{patientCount} 位</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-4 mb-0.5">就诊记录</dt>
                <dd className="text-[15px] text-ink num">{visitCount} 次</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-4 mb-0.5">知识库条目</dt>
                <dd className="text-[15px] text-ink num">{kbCount} 条</dd>
              </div>
            </dl>
            <p className="text-[12.5px] text-ink-3 leading-relaxed">
              数据库文件：<code className="text-[12px] text-ink-2 bg-ghost px-1.5 py-0.5 rounded">prisma/dev.db</code>
              （SQLite）。复制这个文件即是一份完整备份。
            </p>
          </div>
        </section>

        <SettingsForm
          backupRetentionDays={Number(retention?.value ?? 30)}
          updatedAt={retention?.updatedAt ?? null}
        />

        <section className="card">
          <div className="px-5 h-[50px] flex items-center border-b border-line-2">
            <h2 className="section-title">边界</h2>
          </div>
          <ul className="px-5 py-4 space-y-2 text-[12.5px] text-ink-2 leading-relaxed list-disc pl-10">
            <li>不提供自动辨证、自动出方；所有证型、治法和处方均为医生本人填写。</li>
            <li>病历一经提交不可原地修改，只可新增修订版；历史版本永久保留。</li>
            <li>知识库条目在带入病历时保存快照，日后修订知识库不会改变历史处方。</li>
            <li>不提供疗效承诺类文案，不接入收费、库存与医保接口。</li>
          </ul>
        </section>
      </div>
    </>
  );
}
