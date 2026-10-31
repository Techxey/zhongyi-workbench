import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "./db";

/** 备份与导出都落在本机 data/ 目录，随项目一起搬走即可 */
export const BACKUP_DIR = path.join(process.cwd(), "data", "backups");
const BACKUP_PREFIX = "backup-";

export type BackupFile = {
  name: string;
  size: number;
  createdAt: string;
};

function stamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function isBackupName(name: string): boolean {
  return /^backup-\d{8}-\d{6}\.db$/.test(name);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/** 用 SQLite 的 VACUUM INTO 生成一致性快照（比直接复制 dev.db 安全，含未落盘的 WAL） */
export async function createBackup(): Promise<BackupFile> {
  await ensureDir();
  const name = `${BACKUP_PREFIX}${stamp()}.db`;
  const target = path.join(BACKUP_DIR, name);
  const sqlPath = target.replaceAll("\\", "/").replaceAll("'", "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);
  const stat = await fs.stat(target);
  return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
}

export async function listBackups(): Promise<BackupFile[]> {
  await ensureDir();
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const files = await Promise.all(
    entries
      .filter((name) => isBackupName(name))
      .map(async (name) => {
        const stat = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
        return stat
          ? { name, size: stat.size, createdAt: new Date(stat.mtimeMs).toISOString() }
          : null;
      }),
  );
  return files
    .filter((file): file is BackupFile => Boolean(file))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function retentionDays(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: "backup_retention_days" } });
  const days = Number(row?.value ?? 30);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 30;
}

/** 超过保留天数的自动备份删掉；最近一份永远留着 */
export async function pruneBackups(): Promise<number> {
  const days = await retentionDays();
  const files = await listBackups();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const removable = files.slice(1).filter((file) => new Date(file.createdAt).getTime() < cutoff);
  for (const file of removable) {
    await fs.unlink(path.join(BACKUP_DIR, file.name)).catch(() => undefined);
  }
  return removable.length;
}

/** 打开设置页时顺手补一份当天的备份（每天最多一份自动备份） */
export async function ensureDailyBackup(): Promise<BackupFile | null> {
  const today = stamp().slice(0, 8);
  const files = await listBackups();
  if (files.some((file) => file.name.includes(`backup-${today}-`))) return null;
  const created = await createBackup();
  await pruneBackups();
  return created;
}

const EXPORT_TABLES = [
  "user",
  "patient",
  "visit",
  "visitRevision",
  "prescription",
  "prescriptionItem",
  "attachment",
  "kbItem",
  "kbItemVersion",
  "kbAlias",
  "kbImportBatch",
  "templatePrescription",
  "templateItem",
  "consultTerm",
  "symptomTerm",
  "herbIncompatibility",
  "setting",
  "auditLog",
] as const;

/** 全部数据导出成一份 JSON（给医生自己留底 / 换机器用） */
export async function buildFullExport(): Promise<{
  generatedAt: string;
  app: string;
  counts: Record<string, number>;
  data: Record<string, unknown>;
}> {
  const client = prisma as unknown as Record<string, { findMany: (args?: unknown) => Promise<unknown[]> }>;
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  for (const table of EXPORT_TABLES) {
    const rows = await client[table].findMany();
    data[table] = rows;
    counts[table] = rows.length;
  }

  const users = (data.user as Array<Record<string, unknown>>).map((row) => {
    const { passwordHash: _passwordHash, ...rest } = row;
    return rest;
  });
  data.user = users;

  return {
    generatedAt: new Date().toISOString(),
    app: "中医诊疗工作台 · 数据导出",
    counts,
    data,
  };
}
