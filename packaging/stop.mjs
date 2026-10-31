// 中医工作台 · 本机版停止器：按 PID 结束后台服务进程
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const pidFile = path.join(root, "data", "server.pid");

if (!existsSync(pidFile)) {
  console.log("没有找到运行记录，工作台可能已经关了。");
  process.exit(0);
}

const pid = Number(readFileSync(pidFile, "utf8").trim());
if (!pid || Number.isNaN(pid)) {
  rmSync(pidFile, { force: true });
  console.log("运行记录已损坏，已清理。");
  process.exit(0);
}

spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
rmSync(pidFile, { force: true });
console.log(`已停止工作台（PID ${pid}）。`);
