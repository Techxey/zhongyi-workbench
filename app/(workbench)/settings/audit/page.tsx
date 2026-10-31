import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TopBar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "操作记录 · 中医诊疗工作台",
};

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  create: "新建",
  update: "修改",
  sign: "签名归档",
  amend: "修订病历",
  import: "导入知识库",
  export: "导出 / 备份",
  view_pii: "查看手机号",
  import_rollback: "撤销导入",
  delete: "删除",
  upload: "上传图片",
};

const ENTITY_LABELS: Record<string, string> = {
  patient: "患者",
  visit: "就诊",
  visit_revision: "病历版本",
  prescription: "处方",
  kb_item: "知识库条目",
  attachment: "图片资料",
  consult_term: "接诊词条",
  template: "常用方",
  export: "设置 / 备份",
  user: "账号",
};

const PAGE_SIZE = 50;

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pretty(json: string | null): string {
  if (!json) return "";
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const action = params.action ?? "";
  const entity = params.entity ?? "";

  const [rows, actionGroups, entityGroups, total, operators] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(entity ? { entityType: entity } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["entityType"], _count: { _all: true } }),
    prisma.auditLog.count(),
    prisma.auditLog.findMany({ distinct: ["operatorId"], select: { operatorId: true } }),
  ]);

  const operatorIds = operators
    .map((row) => row.operatorId)
    .filter((id): id is string => Boolean(id));
  const userRows = await prisma.user.findMany({
    where: { id: { in: operatorIds } },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(userRows.map((row) => [row.id, row.displayName]));

  const filtered = Boolean(action || entity);

  return (
    <>
      <TopBar
        title="操作记录"
        subtitle="谁在什么时候改了哪份病历，这里都可查"
        actions={
          <Link href="/settings" className="btn btn-ghost">
            返回设置
          </Link>
        }
      />
      <div className="px-[26px] py-6 max-w-[1040px] space-y-4">
        <form className="flex flex-wrap items-center gap-2.5" method="get">
          <select name="action" defaultValue={action} className="input w-[150px]">
            <option value="">全部动作</option>
            {actionGroups.map((group) => (
              <option key={group.action} value={group.action}>
                {ACTION_LABELS[group.action] ?? group.action}（{group._count._all}）
              </option>
            ))}
          </select>
          <select name="entity" defaultValue={entity} className="input w-[170px]">
            <option value="">全部对象</option>
            {entityGroups.map((group) => (
              <option key={group.entityType} value={group.entityType}>
                {ENTITY_LABELS[group.entityType] ?? group.entityType}（{group._count._all}）
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-ghost">
            筛选
          </button>
          {filtered ? (
            <Link href="/settings/audit" className="text-[12.5px] text-ink-3 hover:text-ink-2">
              清空筛选
            </Link>
          ) : null}
          <span className="ml-auto text-[12px] text-ink-4">
            共 {total} 条，显示最近 {Math.min(PAGE_SIZE, rows.length)} 条
          </span>
        </form>

        <section className="card overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-[13px] text-ink-3">
              没有符合条件的记录。换个筛选条件，或先在接诊台做一次操作。
            </p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="font-normal px-4 h-10 border-b border-line-2 w-[150px]">时间</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2 w-[110px]">动作</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2 w-[130px]">对象</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2 w-[110px]">操作人</th>
                  <th className="font-normal px-4 h-10 border-b border-line-2">内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const before = pretty(row.beforeJson);
                  const after = pretty(row.afterJson);
                  return (
                    <tr key={row.id} className="border-b border-line-2 last:border-b-0 align-top">
                      <td className="px-4 py-3 text-[12.5px] text-ink-2 num">
                        {formatTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="chip chip-brand">{ACTION_LABELS[row.action] ?? row.action}</span>
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-ink-2">
                        {ENTITY_LABELS[row.entityType] ?? row.entityType}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-ink-2">
                        {nameOf.get(row.operatorId ?? "") ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-ink-2">
                        <div className="num text-[11.5px] text-ink-4 mb-1">{row.entityId}</div>
                        <details>
                          <summary className="cursor-pointer text-ink-3 hover:text-ink-2 select-none">
                            展开修改前后
                          </summary>
                          <div className="mt-2 grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-[11px] text-ink-4 mb-1">改之前</div>
                              <pre className="text-[11px] leading-relaxed bg-ghost rounded-[6px] p-2 overflow-x-auto max-h-[220px]">
                                {before || "—"}
                              </pre>
                            </div>
                            <div>
                              <div className="text-[11px] text-ink-4 mb-1">改之后</div>
                              <pre className="text-[11px] leading-relaxed bg-ghost rounded-[6px] p-2 overflow-x-auto max-h-[220px]">
                                {after || "—"}
                              </pre>
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-[12px] text-ink-4 leading-relaxed">
          记录只增不改：医疗记录的操作流水按规范永久保留，手机号等敏感信息在写入时已打码（只留后四位）。
          修改已提交病历会同时留下一条「修订病历」记录和一条新的病历版本。
        </p>
      </div>
    </>
  );
}
