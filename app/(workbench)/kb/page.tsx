import type { Metadata } from "next";

import { TopBar } from "@/components/topbar";
import { KbSearchTrigger } from "@/components/kb-search-overlay";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseClassicMeta } from "@/lib/kb-classic";
import { parseComposition } from "@/lib/kb";
import { KbBrowser, type KbAliasRow, type KbBatchRow, type KbRow } from "./kb-browser";

export const metadata: Metadata = {
  title: "知识库 · 中医诊疗工作台",
};

export const dynamic = "force-dynamic";

export default async function KbPage() {
  await requireUser();

  const [items, batches, usage, aliases] = await Promise.all([
    prisma.kbItem.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        type: true,
        name: true,
        source: true,
        status: true,
        currentVersion: true,
        updatedAt: true,
        versions: {
          orderBy: { version: "desc" },
          select: {
            version: true,
            createdAt: true,
            compositionJson: true,
            efficacy: true,
            indication: true,
            usageText: true,
            contraindication: true,
            commentary: true,
            batchId: true,
          },
        },
        aliases: { orderBy: { term: "asc" }, select: { term: true } },
      },
    }),
    prisma.kbImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.prescription.groupBy({
      by: ["kbItemId"],
      _count: { _all: true },
      where: { kbItemId: { not: null } },
    }),
    prisma.kbAlias.findMany({
      orderBy: { term: "asc" },
      take: 1000,
      include: { item: { select: { name: true, type: true } } },
    }),
  ]);

  const usageMap = new Map<string, number>();
  for (const row of usage) if (row.kbItemId) usageMap.set(row.kbItemId, row._count._all);

  const batchMap = new Map(batches.map((batch) => [batch.id, batch.filename ?? "未命名批次"]));

  const rows: KbRow[] = items.map((item) => {
    const latest = item.versions[0];
    const parts = parseComposition(latest?.compositionJson ?? null);
    const classicMeta = item.type === "classic" ? parseClassicMeta(latest?.commentary ?? null) : null;
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      source: item.source,
      status: item.status,
      currentVersion: item.currentVersion,
      updatedAt: item.updatedAt,
      usageCount: usageMap.get(item.id) ?? 0,
      aliases: item.aliases.map((alias) => alias.term),
      herbCount: parts.length,
      herbNames: parts.map((part) => part.name),
      efficacy: latest?.efficacy ?? "",
      indication: latest?.indication ?? "",
      intro: classicMeta ? (latest?.indication ?? "") : undefined,
      chars: classicMeta?.chars,
      chapters: classicMeta?.chapters,
      versions: item.versions.map((version) => ({
        version: version.version,
        createdAt: version.createdAt,
        composition: parseComposition(version.compositionJson).map((part) => `${part.name}${part.dose}`),
        efficacy: version.efficacy ?? "",
        indication: version.indication ?? "",
        usageText: version.usageText ?? "",
        contraindication: version.contraindication ?? "",
        commentary: version.commentary ?? "",
        batchName: version.batchId ? (batchMap.get(version.batchId) ?? "导入") : "手工录入",
      })),
    };
  });

  const aliasRows: KbAliasRow[] = aliases.map((alias) => ({
    id: alias.id,
    term: alias.term,
    normTerm: alias.normTerm,
    aliasType: alias.aliasType,
    weight: alias.weight,
    itemName: alias.item?.name ?? null,
    itemType: alias.item?.type ?? null,
  }));

  const batchRows: KbBatchRow[] = batches.map((batch) => ({
    id: batch.id,
    filename: batch.filename ?? "未命名文件",
    totalRows: batch.totalRows ?? 0,
    okRows: batch.okRows ?? 0,
    warnRows: batch.warnRows ?? 0,
    errorRows: batch.errorRows ?? 0,
    createdAt: batch.createdAt,
    rolledBack: batch.rolledBack,
  }));

  return (
    <>
      <TopBar
        title="知识库"
        subtitle="自己的方与药，检索得到、带得进处方"
        actions={<KbSearchTrigger />}
      />
      <div className="px-[26px] py-5">
        <KbBrowser items={rows} aliases={aliasRows} batches={batchRows} />
      </div>
    </>
  );
}
