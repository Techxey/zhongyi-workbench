import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 用系统自带的 Edge 无头模式把处方页打印成 PDF（不额外依赖任何软件）
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

async function findBrowser(): Promise<string | null> {
  for (const candidate of EDGE_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续找下一个
    }
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ visitId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });

  const { visitId } = await params;
  const browser = await findBrowser();
  if (!browser) {
    return NextResponse.json(
      { ok: false, message: "本机没找到 Edge/Chrome，无法直接生成 PDF；可以在打印窗口里选「另存为 PDF」。" },
      { status: 500 },
    );
  }

  // 先取到处方页的 HTML（带上当前登录 Cookie），再交给无头浏览器打印
  const origin = new URL(request.url).origin;
  const pageUrl = `${origin}/print/prescription/${visitId}`;
  const response = await fetch(pageUrl, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!response.ok) {
    return NextResponse.json({ ok: false, message: "读取处方页失败" }, { status: 502 });
  }
  let html = await response.text();
  // 打印页引用的样式在 /_next/static 下：存成 file:// 后要改成绝对地址才能加载
  html = html.replace(/(src|href)="\/_next\//g, `$1="${origin}/_next/`);
  html = html.replace(/(src|href)="\/(?!\/)/g, `$1="${origin}/`);

  const dir = await mkdtemp(path.join(os.tmpdir(), "zyb-pdf-"));
  const htmlPath = path.join(dir, "rx.html");
  const pdfPath = path.join(dir, "rx.pdf");

  try {
    await writeFile(htmlPath, html, "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--no-first-run",
          "--no-pdf-header-footer",
          `--user-data-dir=${path.join(dir, "profile")}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(htmlPath).href,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("导出超时"));
      }, 30_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`导出失败（exit ${code}）`));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    // Edge 的 --print-to-pdf 会先退出、再异步落盘（实测约 0.5–1 秒），所以要轮询等文件出现
    let pdf: Buffer | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const file = await readFile(pdfPath);
        if (file.byteLength > 1000) {
          pdf = file;
          break;
        }
      } catch {
        // 文件还没写完，继续等
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!pdf) throw new Error("生成的 PDF 为空");

    const suffix = visitId.slice(0, 8);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="prescription-${suffix}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: (error as Error).message || "生成 PDF 失败" },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}
