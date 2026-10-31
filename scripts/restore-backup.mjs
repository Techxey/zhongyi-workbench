import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 从备份恢复数据库。
 * 用法：node scripts/restore-backup.mjs data/backups/backup-20261031-131500.db
 *
 * 注意：先把正在跑的程序关掉（dev server / 生产进程），否则文件被占用会失败。
 */

const input = process.argv[2];
if (!input) {
  console.error("用法：node scripts/restore-backup.mjs <备份文件路径>");
  console.error("例如：node scripts/restore-backup.mjs data/backups/backup-20261031-131500.db");
  process.exit(1);
}

const root = process.cwd();
const source = path.resolve(root, input);
const database = path.join(root, "prisma", "dev.db");
const safetyDir = path.join(root, "data", "backups");

const stat = await fs.stat(source).catch(() => null);
if (!stat || !stat.isFile()) {
  console.error(`找不到备份文件：${source}`);
  process.exit(1);
}

const header = (await fs.readFile(source)).subarray(0, 16).toString("utf8");
if (!header.startsWith("SQLite format 3")) {
  console.error("这个文件不像 SQLite 数据库，先确认是不是选错了备份。");
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .slice(0, 19)
  .replaceAll(":", "")
  .replace("T", "-");

await fs.mkdir(safetyDir, { recursive: true });
const current = await fs.stat(database).catch(() => null);
if (current) {
  const safety = path.join(safetyDir, `restore-safety-${stamp}.db`);
  await fs.copyFile(database, safety);
  console.log(`已把当前数据库另存为：${path.relative(root, safety)}`);
}

await fs.copyFile(source, database);
console.log(`已用备份覆盖数据库：${path.relative(root, database)}`);
console.log("重新启动程序即可（schema 不一致时先跑 prisma migrate deploy）。");
