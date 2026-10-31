// 中医工作台 · 本机版启动器
// 作用：启动内置的 Next.js 服务（只监听 127.0.0.1），等页面能访问后自动打开应用窗口。
// 启动器会常驻在后台（不显示窗口），负责看住服务进程；关掉工作台请双击「停止工作台」。
// 所有数据都在本目录下，不联网、不需要安装 Node。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.ZYB_PORT || 4310);
const url = `http://127.0.0.1:${port}`;
const dataDir = path.join(root, "data");
const logDir = path.join(dataDir, "logs");
const dbFile = path.join(root, "prisma", "dev.db");
const pidFile = path.join(dataDir, "server.pid");

for (const dir of [dataDir, path.join(dataDir, "uploads"), path.join(dataDir, "backups"), logDir]) {
  mkdirSync(dir, { recursive: true });
}

function readSecret() {
  const file = path.join(dataDir, "session-secret.txt");
  if (existsSync(file)) {
    const value = readFileSync(file, "utf8").trim();
    if (value.length >= 32) return value;
  }
  const value = randomBytes(32).toString("hex");
  writeFileSync(file, value, "utf8");
  return value;
}

async function isUp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${url}/login`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function openWindow() {
  if (process.env.ZYB_NO_BROWSER === "1") return;
  const edgeCandidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edge = edgeCandidates.find((candidate) => existsSync(candidate));
  const options = { detached: true, stdio: "ignore" };
  if (edge) {
    spawn(edge, [`--app=${url}`, "--window-size=1440,900"], options).unref();
    return;
  }
  spawn("cmd", ["/c", "start", "", url], options).unref();
}

if (await isUp()) {
  console.log(`工作台已经在运行：${url}`);
  openWindow();
  process.exit(0);
}

if (!existsSync(dbFile)) {
  console.error(`找不到数据库文件：${dbFile}`);
  process.exit(1);
}

const logFd = openSync(path.join(logDir, "server.log"), "a");
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
  // 用绝对路径指向本目录里的数据库，整个文件夹换位置也能用
  DATABASE_URL: `file:${dbFile.replace(/\\/g, "/")}`,
  SESSION_SECRET: readSecret(),
  NEXT_TELEMETRY_DISABLED: "1",
};

const child = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ["ignore", logFd, logFd],
});

// 记的是启动器自己的 PID：停止时按进程树一起结束，不会漏掉服务
writeFileSync(pidFile, String(process.pid), "utf8");

const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  if (await isUp()) {
    ready = true;
    break;
  }
  if (child.exitCode !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 400));
}

if (!ready) {
  console.error("启动失败，日志见 data/logs/server.log");
  rmSync(pidFile, { force: true });
  try {
    child.kill();
  } catch {}
  process.exit(1);
}

console.log(`已启动：${url}`);
openWindow();

// 常驻：服务结束时启动器随之退出（关闭窗口请用「停止工作台」）
child.on("exit", (code) => {
  rmSync(pidFile, { force: true });
  process.exit(code ?? 0);
});
