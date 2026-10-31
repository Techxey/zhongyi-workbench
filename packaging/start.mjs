// 中医工作台 · 本机版启动器
// 作用：启动内置的 Next.js 服务（只监听 127.0.0.1），确认数据库能读之后再打开应用窗口。
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
// --background：开机自启时用，只把服务拉起来（不弹窗口），之后点桌面图标秒开
const background = process.argv.includes("--background") || process.env.ZYB_BACKGROUND === "1";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 只探活 HTTP（页面能打开不代表数据库能读）
async function httpUp(timeout = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${url}/login`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// 数据库就绪探测：首次启动时大库文件可能还在被系统占用，这里多试几次
async function dbReady(timeout = 2500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.db === true;
  } catch {
    return false;
  }
}

function openWindow() {
  if (background || process.env.ZYB_NO_BROWSER === "1") return;
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

if (await httpUp()) {
  // 已经有一个在跑：确保数据库也能读，然后直接开窗口
  for (let i = 0; i < 20 && !(await dbReady()); i += 1) await sleep(400);
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

const deadline = Date.now() + 90_000;
let httpReady = false;
let ready = false;
while (Date.now() < deadline) {
  if (!httpReady && (await httpUp())) httpReady = true;
  // 页面起来了还不算好：等数据库也能读，再开窗口，避免用户第一次点进系统就吃到错误页
  if (httpReady && (await dbReady())) {
    ready = true;
    break;
  }
  if (child.exitCode !== null) break;
  await sleep(400);
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
