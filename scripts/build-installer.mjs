// 生成本机版「免管理员」安装包（Windows）
// 用法：node scripts/build-installer.mjs
//   ZYB_APP_DIR  安装源目录，默认 dist\中医工作台-本机版
//   ZYB_OUT_DIR  输出目录，默认 dist\安装包
//
// 产物：<out>\安装中医工作台.exe + <out>\payload.zip
// 卸载器不单独分发：安装器运行时会把自身复制成 安装目录\卸载.exe
// （构建时仍会用 /define:UNINSTALL 编译一份做语法/链接校验，校验后清理）。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const appDir = path.resolve(root, process.env.ZYB_APP_DIR || path.join("dist", "中医工作台-本机版"));
const outDir = path.resolve(root, process.env.ZYB_OUT_DIR || path.join("dist", "安装包"));
const setupSource = path.join(root, "packaging", "src", "setup.cs");
const icon = path.join(root, "packaging", "app.ico");
const installerName = "安装中医工作台.exe";
const uninstallerName = "卸载.exe";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(setupSource)) fail(`缺少安装器源码：${setupSource}`);
if (!existsSync(appDir) || !statSync(appDir).isDirectory()) fail(`安装源目录不存在：${appDir}`);
if (readdirSync(appDir).length === 0) fail(`安装源目录是空的：${appDir}`);

const cscCandidates = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];
const csc = cscCandidates.find((file) => existsSync(file));
if (!csc) fail("找不到 csc.exe（.NET Framework 4.x 编译器），无法生成 exe。");
const frameworkDir = path.dirname(csc);

const references = [
  "System.dll",
  "System.Core.dll",
  "System.Drawing.dll",
  "System.Windows.Forms.dll",
  "System.IO.Compression.dll",
  "System.IO.Compression.FileSystem.dll",
];
for (const name of references) {
  if (!existsSync(path.join(frameworkDir, name))) fail(`缺少 .NET 引用程序集：${path.join(frameworkDir, name)}`);
}

mkdirSync(outDir, { recursive: true });

// 清掉旧产物，保证最终目录只有「安装器 + payload.zip」
for (const stale of [installerName, uninstallerName, "payload.zip"]) {
  rmSync(path.join(outDir, stale), { recursive: true, force: true });
}

function compile(outName, define) {
  const args = [
    "/nologo",
    "/target:winexe",
    "/codepage:65001",
    "/optimize+",
  ];
  if (existsSync(icon)) args.push(`/win32icon:${icon}`);
  for (const name of references) args.push(`/reference:${path.join(frameworkDir, name)}`);
  if (define) args.push(`/define:${define}`);
  args.push(`/out:${path.join(outDir, outName)}`, setupSource);

  console.log(`编译 ${outName}${define ? `（/define:${define}）` : ""}…`);
  try {
    execFileSync(csc, args, { stdio: "inherit" });
  } catch (error) {
    fail(`csc 编译失败：${outName}（${error.message}）`);
  }
  const built = path.join(outDir, outName);
  if (!existsSync(built)) fail(`编译后没有找到产物：${built}`);
  return built;
}

compile(installerName);
// 卸载器版本：校验 /define:UNINSTALL 分支能正常编译；运行期由安装器自我复制生成
const uninstallerBuilt = compile(uninstallerName, "UNINSTALL");

// 用系统自带的 tar.exe 生成 zip（bsdtar，-a 按扩展名决定格式）
const payload = path.join(outDir, "payload.zip");
console.log(`打包 payload.zip（源：${appDir}）…`);
const tarArgs = ["-a", "-c", "-f", payload, "-C", appDir, "."];
const tarResult = spawnSync("tar.exe", tarArgs, { cwd: outDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (tarResult.error) {
  fail(`调用 tar.exe 失败：${tarResult.error.message}`);
}
if (tarResult.status !== 0) {
  console.error(`tar 打包失败（exit ${tarResult.status}）。`);
  console.error("请先关闭工作台（node.exe 可能正占用 prisma\\dev.db），再重试。");
  if (tarResult.stdout) console.error("stdout:\n" + tarResult.stdout.trim());
  if (tarResult.stderr) console.error("stderr:\n" + tarResult.stderr.trim());
  process.exit(1);
}
if (!existsSync(payload) || statSync(payload).size === 0) fail("payload.zip 没有生成或大小为 0。");

// 校验通过后清理独立卸载器，保持发布目录只有两个文件
rmSync(uninstallerBuilt, { force: true });

const installer = path.join(outDir, installerName);
const mb = (file) => (statSync(file).size / 1024 / 1024).toFixed(1);
console.log("");
console.log("安装包已生成：" + outDir);
console.log(`  ${installerName}  ${mb(installer)} MB`);
console.log(`  payload.zip       ${mb(payload)} MB`);
console.log("");
console.log(`双击「${installerName}」即可安装：默认装到 %LOCALAPPDATA%\\Programs\\中医工作台，不需要管理员权限。`);
console.log("卸载器不单独分发：安装时由安装器复制为 安装目录\\卸载.exe（文件名含「卸载」即进入卸载模式）。");
