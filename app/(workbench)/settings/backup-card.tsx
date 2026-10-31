"use client";

import { useState, useTransition } from "react";

import { backupNow, type SettingsState } from "./actions";

export type BackupItem = { name: string; size: number; createdAt: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BackupCard({
  backups,
  retentionDays,
}: {
  backups: BackupItem[];
  retentionDays: number;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SettingsState | null>(null);

  const handleBackup = () => {
    startTransition(async () => {
      const result = await backupNow();
      setState(result);
    });
  };

  return (
    <section className="card">
      <div className="px-5 h-[50px] flex items-center border-b border-line-2">
        <h2 className="section-title">备份与导出</h2>
        <span className="ml-2 text-[11.5px] text-ink-4">
          每天第一次打开设置会自动备份一份，保留 {retentionDays} 天
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleBackup}
            disabled={pending}
          >
            {pending ? "正在备份…" : "立即备份"}
          </button>
          <a className="btn btn-ghost" href="/api/export">
            导出全部数据（JSON）
          </a>
          <span className="text-[12px] text-ink-4">
            备份文件在 data/backups，可下载保存到移动硬盘
          </span>
        </div>

        {state?.error ? <p className="text-[12.5px] text-danger">{state.error}</p> : null}
        {state?.ok && state.message ? (
          <p className="text-[12.5px] text-brand">{state.message}</p>
        ) : null}

        {backups.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">还没有备份。点「立即备份」存第一份。</p>
        ) : (
          <div className="border border-line-2 rounded-[9px] overflow-hidden">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-3 bg-ghost">
                  <th className="font-normal px-3 h-9">备份文件</th>
                  <th className="font-normal px-3 h-9 w-[150px]">时间</th>
                  <th className="font-normal px-3 h-9 w-[90px]">大小</th>
                  <th className="font-normal px-3 h-9 w-[80px]">下载</th>
                </tr>
              </thead>
              <tbody>
                {backups.slice(0, 6).map((file) => (
                  <tr key={file.name} className="border-t border-line-2">
                    <td className="px-3 py-2 text-ink-2 num">{file.name}</td>
                    <td className="px-3 py-2 text-ink-3 num">{formatTime(file.createdAt)}</td>
                    <td className="px-3 py-2 text-ink-3 num">{formatSize(file.size)}</td>
                    <td className="px-3 py-2">
                      <a className="text-brand hover:underline" href={`/api/backup/${file.name}`}>
                        下载
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="text-[12.5px] text-ink-2 leading-relaxed">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-2">怎么从备份恢复？</summary>
          <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-line-2">
            <p>
              1. 关掉正在跑的程序（终端里 Ctrl+C，或关掉那个黑窗口）。
            </p>
            <p>
              2. 在项目目录执行：
              <code className="mx-1 text-[12px] bg-ghost px-1.5 py-0.5 rounded">
                node scripts/restore-backup.mjs data/backups/备份文件名.db
              </code>
            </p>
            <p>3. 脚本会先把现有数据库另存一份，再覆盖成备份内容，然后重新启动即可。</p>
            <p className="text-ink-4">
              恢复会整库覆盖，备份之后新增的病历会丢；日常留底请定期下载备份文件到别处。
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
