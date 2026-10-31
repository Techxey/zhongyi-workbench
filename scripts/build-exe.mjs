// 用系统自带的 .NET Framework 编译器把 C# 启动器编译成 exe（无需联网、无需装 SDK）
// 输出：packaging/bin/{中医工作台,停止工作台,开机自启,取消自启}.exe（内嵌 app.ico）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "packaging", "src");
const outDir = path.join(root, "packaging", "bin");
const icon = path.join(root, "packaging", "app.ico");

const candidates = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];
const csc = candidates.find((file) => existsSync(file));
if (!csc) {
  console.error("找不到 csc.exe（.NET Framework 4.x 编译器），无法生成 exe。");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const jobs = [
  { source: "launcher.cs", out: "中医工作台.exe" },
  { source: "stopper.cs", out: "停止工作台.exe" },
  { source: "autostart.cs", out: "开机自启.exe" },
  { source: "autostart.cs", out: "取消自启.exe", define: "REMOVE" },
];

for (const job of jobs) {
  const args = [
    "/nologo",
    "/codepage:65001",
    "/target:winexe",
    "/optimize+",
  ];
  if (job.define) args.push(`/define:${job.define}`);
  if (existsSync(icon)) args.push(`/win32icon:${icon}`);
  args.push(`/out:${path.join(outDir, job.out)}`, path.join(src, job.source));
  execFileSync(csc, args, { stdio: "inherit" });
  console.log("built", job.out);
}

// 备份一份到 dist 里的纯拷贝出处（打包脚本从这里取）
if (process.argv.includes("--copy-to-dist")) {
  const dist = path.join(root, "dist", "中医工作台-本机版");
  for (const job of jobs) {
    const from = path.join(outDir, job.out);
    if (existsSync(from) && existsSync(dist)) {
      copyFileSync(from, path.join(dist, job.out));
      console.log("copied to dist:", job.out);
    }
  }
}
