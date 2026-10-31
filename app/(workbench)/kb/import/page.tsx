import type { Metadata } from "next";
import Link from "next/link";

import { TopBar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

import ImportWizard, { type ImportBatchRecord } from "./import-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "知识库导入 · 中医诊疗工作台",
};

export default async function KbImportPage() {
  await requireUser();

  // 批次台账：最近 12 批，够追溯，也不至于把页面撑长
  const batches = await prisma.kbImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  const operatorIds = [
    ...new Set(batches.map((batch) => batch.operatorId).filter((id): id is string => Boolean(id))),
  ];
  const operators =
    operatorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, displayName: true },
        })
      : [];
  const operatorNameById = new Map(operators.map((operator) => [operator.id, operator.displayName]));

  const records: ImportBatchRecord[] = batches.map((batch) => ({
    id: batch.id,
    filename: batch.filename ?? "（未命名文件）",
    totalRows: batch.totalRows ?? 0,
    okRows: batch.okRows ?? 0,
    warnRows: batch.warnRows ?? 0,
    errorRows: batch.errorRows ?? 0,
    createdAt: batch.createdAt,
    rolledBack: batch.rolledBack === 1,
    operatorName: (batch.operatorId && operatorNameById.get(batch.operatorId)) || "未记录",
  }));

  return (
    <>
      <TopBar
        title={
          <span className="inline-flex items-center gap-2">
            <Link href="/kb" className="text-ink-3 transition-colors hover:text-ink">
              知识库
            </Link>
            <span className="text-ink-4">/</span>
            <span>导入</span>
          </span>
        }
        subtitle="CSV 或 JSON，三步入库"
        actions={
          <Link href="/kb" className="btn btn-ghost">
            返回知识库
          </Link>
        }
      />
      <div className="px-[26px] py-6">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
          <ImportWizard initialBatches={records} />
        </div>
      </div>
    </>
  );
}
