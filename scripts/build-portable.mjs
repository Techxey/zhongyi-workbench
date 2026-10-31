// 生成「双击即用」的本机版文件夹（Windows）
// 用法：node scripts/build-portable.mjs
//   默认输出到 dist\中医工作台-本机版
//   可用环境变量 ZYB_PORTABLE_OUT 指定别的目录
//
// 做的事：next build（standalone）→ 拷独立服务 → 补静态资源 → 修 pnpm 的符号链接
//        → 带上 node.exe、数据库、启动器 → 清空运行期目录。
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = process.env.ZYB_PORTABLE_OUT || path.join(root, "dist", "中医工作台-本机版");
const standalone = path.join(root, ".next", "standalone");
const nodeExe = process.execPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, ...options });
  if (result.status !== 0) {
    console.error(`失败：${command} ${args.join(" ")} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log("1/6 next build（standalone）…");
run(nodeExe, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"]);

console.log("2/6 准备输出目录…");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log("3/6 拷贝独立服务…");
// robocopy 会跳过符号链接，后面单独重建；/NFL /NDL 只留摘要
const rc = spawnSync("robocopy", [standalone, out, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/R:1", "/W:1"]).status;
if (rc === null || rc > 7) {
  console.error(`robocopy 失败 (exit ${rc})`);
  process.exit(1);
}

console.log("4/6 补静态资源与符号链接…");
cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });

function collectLinks(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(full);
      continue;
    }
    if (entry.isDirectory()) collectLinks(full, found);
  }
  return found;
}

// ① robocopy 对符号链接只会留下 0 字节占位：以源目录的链接清单为准，逐个在输出里还原成真实目录
for (const linkPath of collectLinks(standalone)) {
  const relative = path.relative(standalone, linkPath);
  const dest = path.join(out, relative);
  const resolved = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    cpSync(resolved, dest, { recursive: true, dereference: true });
  } catch (error) {
    console.warn(`  ! 还原符号链接失败：${relative}`, error.message);
  }
}

// ② pnpm 的依赖解析靠 .pnpm/<pkg>/node_modules 这一层祖先目录：
// 一旦把符号链接解引用成真实目录，祖先链就断了（例如 next 找不到同级的 styled-jsx）。
// 所以再把这些"同级依赖"平铺到根 node_modules，纯真实目录、可整包复制。
const pnpmDir = path.join(out, "node_modules", ".pnpm");
if (existsSync(pnpmDir)) {
  for (const pkg of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const inner = path.join(pnpmDir, pkg.name, "node_modules");
    if (!existsSync(inner)) continue;
    for (const dep of readdirSync(inner, { withFileTypes: true })) {
      if (!dep.isDirectory() || dep.name === ".bin") continue;
      const dest = path.join(out, "node_modules", dep.name);
      if (existsSync(dest)) {
        let isDir = false;
        try {
          isDir = statSync(dest).isDirectory();
        } catch {
          isDir = false;
        }
        if (isDir) continue;
        rmSync(dest, { recursive: true, force: true });
      }
      cpSync(path.join(inner, dep.name), dest, { recursive: true, dereference: true });
    }
  }
}

// Prisma 生成目录（引擎 dll 在这里），要放到根 node_modules 下才能被 @prisma/client 找到
const prismaClientDirs = readdirSync(pnpmDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("@prisma+client"))
  .map((entry) => path.join(pnpmDir, entry.name, "node_modules", ".prisma"))
  .filter((dir) => existsSync(dir));
const prismaDest = path.join(out, "node_modules", ".prisma");
if (prismaClientDirs.length > 0 && !existsSync(prismaDest)) {
  cpSync(prismaClientDirs[0], prismaDest, { recursive: true, dereference: true });
}

console.log("5/6 带上 node.exe、数据库、启动器…");
copyFileSync(nodeExe, path.join(out, "node.exe"));

mkdirSync(path.join(out, "prisma"), { recursive: true });
for (const file of ["schema.prisma", "seed.mjs", "dev.db"]) {
  const from = path.join(root, "prisma", file);
  if (existsSync(from)) copyFileSync(from, path.join(out, "prisma", file));
}
cpSync(path.join(root, "prisma", "migrations"), path.join(out, "prisma", "migrations"), { recursive: true });

for (const dir of ["data", "data/uploads", "data/backups", "data/logs"]) {
  mkdirSync(path.join(out, dir), { recursive: true });
}
// 把本机已上传的图片一起带走（备份不带走，体积太大）
const uploadsFrom = path.join(root, "data", "uploads");
if (existsSync(uploadsFrom)) {
  cpSync(uploadsFrom, path.join(out, "data", "uploads"), { recursive: true, force: true });
}

const packaging = path.join(root, "packaging");
for (const file of readdirSync(packaging)) {
  const from = path.join(packaging, file);
  if (statSync(from).isFile()) copyFileSync(from, path.join(out, file));
}
// 启动器/停止器 exe（用系统自带 csc 编译，见 scripts/build-exe.mjs）
run(nodeExe, [path.join(root, "scripts", "build-exe.mjs")]);
for (const exe of ["中医工作台.exe", "停止工作台.exe"]) {
  const from = path.join(packaging, "bin", exe);
  if (!existsSync(from)) {
    console.error(`缺少 ${from}，请先确认 build-exe.mjs 能编译成功`);
    process.exit(1);
  }
  copyFileSync(from, path.join(out, exe));
}
for (const file of ["restore-backup.mjs", "import-classics.mjs"]) {
  const from = path.join(root, "scripts", file);
  if (existsSync(from)) copyFileSync(from, path.join(out, file));
}

// 打包后由启动器注入数据库与会话密钥，这里不写死
const envFile = path.join(out, ".env");
cpSync(path.join(root, "packaging", ".env.portable"), envFile);

console.log("6/6 完成");
const total = readdirSync(out, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .reduce((sum, entry) => sum + statSync(path.join(entry.parentPath ?? entry.path ?? out, entry.name)).size, 0);
console.log(`输出：${out}（${(total / 1024 / 1024).toFixed(0)} MB）`);
console.log("双击「中医工作台.exe」即可运行；停止用「停止工作台.exe」（VBS/BAT 为备用方式）。");
