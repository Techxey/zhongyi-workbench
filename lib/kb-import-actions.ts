"use server";

/**
 * 知识库导入的服务端动作：预览 → 校验 → 入库 → 按批次回滚。
 *
 * - 原始文件先落到 data/import-tmp/<token>.<ext>，第 3 步仍在同一份文件上重新解析，
 *   避免「预览看到的」和「真正入库的」不是同一份数据；
 * - 每次导入写一条 kb_import_batches，行数据在 kb_item_versions.batchId 上留痕，
 *   所以能按批次回滚；
 * - 审计直接写 audit_logs（lib/audit.ts 的 entityType/action 是窄联合，不含导入场景）。
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { IMPORT_TARGETS, formatCompositionJson } from "@/lib/kb";
import { invalidateKbIndex } from "@/lib/kb-search";
import {
  KbImportError,
  MAX_IMPORT_BYTES,
  PREVIEW_ROW_LIMIT,
  duplicateTargets,
  fileExtension,
  inferItemType,
  isImportExtension,
  isImportTargetKey,
  kbItemKey,
  missingRequiredTargets,
  normalizeKeyText,
  parseUpload,
  selectRowsForCommit,
  summarizeRows,
  validateImportRows,
  type ImportItemType,
  type ImportValidateContext,
  type ImportValidationRow,
} from "@/lib/kb-import";

const TMP_ROOT = path.join(process.cwd(), "data", "import-tmp");
const TMP_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** 校验结果一次最多回传 500 行给界面，汇总数字仍按全量算 */
const VALIDATE_ROW_LIMIT = 500;
/** 临时文件 token 必须是 UUID，防止路径穿越 */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_LABEL = new Map(IMPORT_TARGETS.map((target) => [target.key, target.label]));

type TmpMeta = {
  filename: string;
  size: number;
  ext: string;
  totalRows: number;
  createdAt: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof KbImportError) return error.message;
  return fallback;
}

function randomToken(): string {
  return randomUUID();
}

async function cleanupTmp(): Promise<void> {
  try {
    const entries = await fs.readdir(TMP_ROOT, { withFileTypes: true });
    const cutoff = Date.now() - TMP_MAX_AGE_MS;
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const full = path.join(TMP_ROOT, entry.name);
        try {
          const stat = await fs.stat(full);
          if (stat.mtimeMs < cutoff) await fs.unlink(full);
        } catch {
          // 单个文件清理失败不影响本次导入
        }
      }),
    );
  } catch {
    // 目录还不存在，忽略
  }
}

async function resolveTmp(token: string): Promise<{ meta: TmpMeta; file: string } | null> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  const metaPath = path.join(TMP_ROOT, `${token}.meta`);
  let meta: TmpMeta;
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TmpMeta>;
    if (typeof parsed.filename !== "string") return null;
    if (typeof parsed.ext !== "string" || !isImportExtension(parsed.ext)) return null;
    if (typeof parsed.size !== "number") return null;
    meta = {
      filename: parsed.filename,
      size: parsed.size,
      ext: parsed.ext,
      totalRows: typeof parsed.totalRows === "number" ? parsed.totalRows : 0,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
  const file = path.join(TMP_ROOT, `${token}${meta.ext}`);
  try {
    await fs.access(file);
  } catch {
    return null;
  }
  return { meta, file };
}

async function readTmp(token: string): Promise<{ meta: TmpMeta; file: string; bytes: Uint8Array } | null> {
  const resolved = await resolveTmp(token);
  if (!resolved) return null;
  const buffer = await fs.readFile(resolved.file);
  return { meta: resolved.meta, file: resolved.file, bytes: new Uint8Array(buffer) };
}

/** 只保留文件里真实存在的列，值必须是目标字段 key 或 "ignore" */
function normalizeMapping(mapping: Record<string, string>, columns: string[]): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return normalized;
  for (const column of columns) {
    const value = mapping[column];
    if (typeof value === "string") normalized[column] = value;
  }
  return normalized;
}

function usableMapping(mapping: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => Boolean(value) && value !== "ignore"),
  );
}

/** 必填缺失 / 同一字段多列映射 → 返回给医生看的一句话，null 表示映射可用 */
function checkMapping(mapping: Record<string, string>, itemType: ImportItemType): string | null {
  for (const value of Object.values(mapping)) {
    if (!value || value === "ignore") continue;
    if (!isImportTargetKey(value)) return "字段映射里有无法识别的目标字段，请重新选择";
  }
  const usable = usableMapping(mapping);
  const duplicated = duplicateTargets(usable);
  if (duplicated.length > 0) {
    const labels = duplicated.map((key) => TARGET_LABEL.get(key) ?? key).join("、");
    return `同一个字段被多列映射（${labels}），请只保留一列`;
  }
  const missing = missingRequiredTargets(usable, itemType);
  if (missing.length > 0) {
    const labels = missing.map((key) => TARGET_LABEL.get(key) ?? key).join("、");
    return `还缺必填映射：${labels}`;
  }
  return null;
}

async function loadValidateContext(itemType: ImportItemType): Promise<ImportValidateContext> {
  const items = await prisma.kbItem.findMany({
    where: { type: itemType },
    select: { id: true, name: true, source: true, currentVersion: true },
  });
  const existing = new Map<string, { id: string; currentVersion: number }>();
  for (const item of items) {
    existing.set(kbItemKey(itemType, item.name, item.source), {
      id: item.id,
      currentVersion: item.currentVersion,
    });
  }

  // W3 的中药词表只在库里有中药条目时才校验（库为空时跳过，避免整批告警）
  let herbTerms: string[] = [];
  if (itemType === "formula") {
    const [herbs, herbAliases] = await Promise.all([
      prisma.kbItem.findMany({ where: { type: "herb" }, select: { name: true } }),
      prisma.kbAlias.findMany({ where: { aliasType: "herb_name" }, select: { term: true } }),
    ]);
    herbTerms = [...herbs.map((herb) => herb.name), ...herbAliases.map((alias) => alias.term)];
  }

  return { itemType, existing, herbTerms };
}

type PreparedImport = {
  tmp: { meta: TmpMeta; file: string };
  parsed: ReturnType<typeof parseUpload>;
  itemType: ImportItemType;
  mapping: Record<string, string>;
};

/** 三个动作共用的前置：读临时文件、重新解析、推断类型、校验映射 */
async function prepareImport(
  token: string,
  mapping: Record<string, string>,
): Promise<{ ok: true; prepared: PreparedImport } | { ok: false; message: string }> {
  const tmp = await readTmp(token);
  if (!tmp) return { ok: false, message: "导入文件已过期，请重新上传" };

  let parsed: ReturnType<typeof parseUpload>;
  try {
    parsed = parseUpload(tmp.meta.filename, tmp.bytes);
  } catch (error) {
    return { ok: false, message: errorMessage(error, "文件解析失败，请检查格式后重试") };
  }
  if (parsed.rows.length === 0) return { ok: false, message: "文件里没有数据行" };

  const itemType = inferItemType(parsed.columns);
  const normalized = normalizeMapping(mapping, parsed.columns);
  const mappingError = checkMapping(normalized, itemType);
  if (mappingError) return { ok: false, message: mappingError };

  return { ok: true, prepared: { tmp: { meta: tmp.meta, file: tmp.file }, parsed, itemType, mapping: normalized } };
}

export async function previewImport(formData: FormData): Promise<
  | {
      ok: true;
      token: string;
      columns: string[];
      rows: Record<string, string>[];
      totalRows: number;
      filename: string;
    }
  | { ok: false; message: string }
> {
  await requireUser();

  try {
    const file = formData.get("file");
    if (
      !file ||
      typeof file !== "object" ||
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function" ||
      typeof (file as { name?: unknown }).name !== "string"
    ) {
      return { ok: false, message: "请选择要导入的文件" };
    }
    const upload = file as File;
    const ext = fileExtension(upload.name);
    if (!isImportExtension(ext)) return { ok: false, message: "只支持 .csv 与 .json 文件" };

    const size = Number(upload.size) || 0;
    if (size === 0) return { ok: false, message: "文件是空的" };
    if (size > MAX_IMPORT_BYTES) {
      return {
        ok: false,
        message: `文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB，请拆分后分批导入`,
      };
    }

    const bytes = new Uint8Array(await upload.arrayBuffer());
    let parsed: ReturnType<typeof parseUpload>;
    try {
      parsed = parseUpload(upload.name, bytes);
    } catch (error) {
      return { ok: false, message: errorMessage(error, "文件解析失败，请检查格式后重试") };
    }
    if (parsed.rows.length === 0) return { ok: false, message: "文件里没有数据行" };

    const token = randomToken();
    const filename = upload.name.trim() || `导入文件${ext}`;
    const meta: TmpMeta = {
      filename,
      size: bytes.byteLength,
      ext,
      totalRows: parsed.rows.length,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(TMP_ROOT, { recursive: true });
    await fs.writeFile(path.join(TMP_ROOT, `${token}${ext}`), bytes);
    await fs.writeFile(path.join(TMP_ROOT, `${token}.meta`), JSON.stringify(meta), "utf8");
    await cleanupTmp();

    return {
      ok: true,
      token,
      columns: parsed.columns,
      rows: parsed.rows.slice(0, PREVIEW_ROW_LIMIT),
      totalRows: parsed.rows.length,
      filename,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "文件读取失败，请重试") };
  }
}

export async function validateImport(
  token: string,
  mapping: Record<string, string>,
): Promise<
  | {
      ok: true;
      summary: { total: number; pass: number; warn: number; error: number; update: number };
      rows: {
        line: number;
        status: "pass" | "warn" | "error" | "update";
        codes: string[];
        data: {
          name: string;
          source: string;
          aliases: string[];
          composition: { name: string; dose: string }[];
          usageText: string;
          efficacy: string;
          indication: string;
          contraindication: string;
          commentary: string;
          note: string;
        };
        hints: string[];
      }[];
      itemType: ImportItemType;
      truncated: boolean;
      filename: string;
      totalRows: number;
    }
  | { ok: false; message: string }
> {
  await requireUser();

  try {
    const preparedResult = await prepareImport(token, mapping);
    if (!preparedResult.ok) return preparedResult;
    const { prepared } = preparedResult;

    const context = await loadValidateContext(prepared.itemType);
    const rows = validateImportRows(
      prepared.parsed.rows,
      prepared.parsed.lines,
      prepared.mapping,
      context,
    );

    return {
      ok: true,
      summary: summarizeRows(rows),
      rows: rows.slice(0, VALIDATE_ROW_LIMIT),
      itemType: prepared.itemType,
      truncated: rows.length > VALIDATE_ROW_LIMIT,
      filename: prepared.tmp.meta.filename,
      totalRows: rows.length,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "校验失败，请重试") };
  }
}

export async function commitImport(
  token: string,
  mapping: Record<string, string>,
  mode: "pass" | "all",
): Promise<
  { ok: true; batchId: string; inserted: number; updated: number; skipped: number } | { ok: false; message: string }
> {
  const user = await requireUser();

  try {
    if (mode !== "pass" && mode !== "all") return { ok: false, message: "导入方式不正确，请重新选择" };

    const preparedResult = await prepareImport(token, mapping);
    if (!preparedResult.ok) return preparedResult;
    const { prepared } = preparedResult;

    const context = await loadValidateContext(prepared.itemType);
    const rows = validateImportRows(
      prepared.parsed.rows,
      prepared.parsed.lines,
      prepared.mapping,
      context,
    );
    const summary = summarizeRows(rows);
    const selected = selectRowsForCommit(rows, mode);

    // 同一批次里同名同出处只保留第一行（后面的行没有意义，计为跳过）
    const seen = new Set<string>();
    const targets: ImportValidationRow[] = [];
    for (const row of selected) {
      const key = kbItemKey(prepared.itemType, row.data.name, row.data.source);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(row);
    }

    const rawByLine = new Map<number, Record<string, string>>();
    prepared.parsed.lines.forEach((line, index) => {
      rawByLine.set(line, prepared.parsed.rows[index]);
    });

    // 已有的别名一次读出来，避免逐行查询
    const aliasType = prepared.itemType === "formula" ? "formula_name" : "herb_name";
    const existingAliases = await prisma.kbAlias.findMany({
      where: { aliasType },
      select: { term: true },
    });
    const knownAliasTerms = new Set(existingAliases.map((alias) => normalizeKeyText(alias.term)));

    const batchId = randomUUID();
    const operatorId = user.id;
    const now = new Date().toISOString();
    const filename = prepared.tmp.meta.filename;
    let inserted = 0;
    let updated = 0;

    await prisma.$transaction(
      async (tx) => {
        await tx.kbImportBatch.create({
          data: {
            id: batchId,
            filename,
            totalRows: summary.total,
            okRows: summary.pass + summary.update,
            warnRows: summary.warn,
            errorRows: summary.error,
            operatorId,
            createdAt: now,
            rolledBack: 0,
          },
        });

        for (const row of targets) {
          const draft = row.data;
          const key = kbItemKey(prepared.itemType, draft.name, draft.source);
          const existing = context.existing.get(key);
          const compositionJson =
            prepared.itemType === "herb" ? null : formatCompositionJson(draft.composition);
          const rawJson = JSON.stringify({
            line: row.line,
            itemType: prepared.itemType,
            row: rawByLine.get(row.line) ?? null,
            note: draft.note,
            aliases: draft.aliases,
          });

          let itemId: string;
          if (existing) {
            const latest = await tx.kbItemVersion.aggregate({
              where: { kbItemId: existing.id },
              _max: { version: true },
            });
            const version = Math.max(existing.currentVersion, latest._max.version ?? 0) + 1;
            const createdVersion = await tx.kbItemVersion.create({
              data: {
                kbItemId: existing.id,
                version,
                compositionJson,
                efficacy: draft.efficacy || null,
                indication: draft.indication || null,
                usageText: draft.usageText || null,
                contraindication: draft.contraindication || null,
                commentary: draft.commentary || null,
                batchId,
                createdAt: now,
              },
            });
            await tx.kbItemBody.create({ data: { versionId: createdVersion.id, rawJson } });
            await tx.kbItem.update({
              where: { id: existing.id },
              data: { currentVersion: version, status: "active", updatedAt: now },
            });
            itemId = existing.id;
            updated += 1;
          } else {
            itemId = randomUUID();
            await tx.kbItem.create({
              data: {
                id: itemId,
                type: prepared.itemType,
                name: draft.name,
                source: draft.source || null,
                currentVersion: 1,
                status: "active",
                createdAt: now,
                updatedAt: now,
              },
            });
            const createdVersion = await tx.kbItemVersion.create({
              data: {
                kbItemId: itemId,
                version: 1,
                compositionJson,
                efficacy: draft.efficacy || null,
                indication: draft.indication || null,
                usageText: draft.usageText || null,
                contraindication: draft.contraindication || null,
                commentary: draft.commentary || null,
                batchId,
                createdAt: now,
              },
            });
            await tx.kbItemBody.create({ data: { versionId: createdVersion.id, rawJson } });
            inserted += 1;
          }

          // 别名：normTerm 记目标条目名，与种子数据的写法保持一致
          for (const alias of draft.aliases) {
            const aliasKey = normalizeKeyText(alias);
            if (!aliasKey || aliasKey === normalizeKeyText(draft.name)) continue;
            if (knownAliasTerms.has(aliasKey)) continue;
            knownAliasTerms.add(aliasKey);
            await tx.kbAlias.create({
              data: {
                kbItemId: itemId,
                term: alias,
                normTerm: draft.name,
                aliasType,
                weight: 1,
              },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            entityType: "kb_import",
            entityId: batchId,
            action: "import",
            afterJson: JSON.stringify({ batchId, filename, inserted, updated }),
            operatorId,
            createdAt: now,
          },
        });
      },
      { timeout: 300_000, maxWait: 20_000 },
    );

    revalidatePath("/kb");
    revalidatePath("/kb/import");
    revalidatePath("/visits", "layout");
    invalidateKbIndex();

    await fs.unlink(prepared.tmp.file).catch(() => undefined);
    await fs.unlink(path.join(TMP_ROOT, `${token}.meta`)).catch(() => undefined);

    return {
      ok: true,
      batchId,
      inserted,
      updated,
      skipped: summary.total - inserted - updated,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "入库失败，请重试；未完成的批次不会留在台账里") };
  }
}

export async function rollbackBatch(
  batchId: string,
): Promise<{ ok: true; removed: number; reverted: number } | { ok: false; message: string }> {
  const user = await requireUser();

  try {
    if (typeof batchId !== "string" || !batchId) return { ok: false, message: "批次号不正确" };

    const batch = await prisma.kbImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) return { ok: false, message: "批次不存在或已被删除" };
    if (batch.rolledBack === 1) return { ok: false, message: "这一批已经撤销过，不能重复撤销" };

    const batchVersions = await prisma.kbItemVersion.findMany({
      where: { batchId },
      select: { kbItemId: true, version: true },
    });

    const itemIds = [...new Set(batchVersions.map((version) => version.kbItemId))];
    const allVersions =
      itemIds.length > 0
        ? await prisma.kbItemVersion.findMany({
            where: { kbItemId: { in: itemIds } },
            select: { kbItemId: true, version: true, batchId: true },
          })
        : [];
    const versionsByItem = new Map<string, { version: number; batchId: string | null }[]>();
    for (const version of allVersions) {
      const list = versionsByItem.get(version.kbItemId) ?? [];
      list.push({ version: version.version, batchId: version.batchId });
      versionsByItem.set(version.kbItemId, list);
    }

    const now = new Date().toISOString();
    let removed = 0;
    let reverted = 0;

    await prisma.$transaction(
      async (tx) => {
        for (const itemId of itemIds) {
          const versions = versionsByItem.get(itemId) ?? [];
          const otherVersions = versions.filter((version) => version.batchId !== batchId);

          if (otherVersions.length === 0) {
            // 这个条目只由本批次创建过 → 连条目一起删掉
            await tx.kbAlias.deleteMany({ where: { kbItemId: itemId } });
            await tx.kbItemVersion.deleteMany({ where: { kbItemId: itemId } });
            await tx.kbItem.delete({ where: { id: itemId } });
            removed += 1;
          } else {
            // 之前就有这个条目，只是被本批次更新过 → currentVersion 回退到本批次之前的最大版本
            const target = Math.max(...otherVersions.map((version) => version.version));
            await tx.kbItem.update({
              where: { id: itemId },
              data: { currentVersion: target, updatedAt: now },
            });
            reverted += 1;
          }
        }

        await tx.kbImportBatch.update({
          where: { id: batchId },
          data: { rolledBack: 1 },
        });

        await tx.auditLog.create({
          data: {
            entityType: "kb_import",
            entityId: batchId,
            action: "import_rollback",
            beforeJson: JSON.stringify({ rolledBack: 0, okRows: batch.okRows }),
            afterJson: JSON.stringify({ batchId, filename: batch.filename, removed, reverted }),
            operatorId: user.id,
            createdAt: now,
          },
        });
      },
      { timeout: 300_000, maxWait: 20_000 },
    );

    revalidatePath("/kb");
    revalidatePath("/kb/import");
    revalidatePath("/visits", "layout");
    invalidateKbIndex();

    return { ok: true, removed, reverted };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "撤销失败，请重试") };
  }
}
