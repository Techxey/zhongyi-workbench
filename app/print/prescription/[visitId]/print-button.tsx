"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      打印（Ctrl+P）
    </button>
  );
}

export function BackLink() {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => window.close()}>
      关闭
    </button>
  );
}
