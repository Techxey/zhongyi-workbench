"use client";

import { useRef, useState, useTransition } from "react";

import { deleteAttachment, uploadAttachment } from "@/lib/attachment-actions";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_LABELS,
  attachmentUrl,
  formatBytes,
  type AttachmentItem,
  type AttachmentKind,
} from "@/lib/attachments";

type Props = {
  patientId: string;
  visitId?: string | null;
  items: AttachmentItem[];
  defaultKind?: AttachmentKind;
  /** 紧凑模式：接诊台里只放缩略图 + 上传，不带大标题 */
  compact?: boolean;
  title?: string;
  hint?: string;
};

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file;
  if (file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return file;
    const name = file.name.replace(/\.\w+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function AttachmentGallery({
  patientId,
  visitId,
  items,
  defaultKind = "tongue",
  compact = false,
  title = "图片资料",
  hint,
}: Props) {
  const [list, setList] = useState<AttachmentItem[]>(items);
  const [kind, setKind] = useState<AttachmentKind>(defaultKind);
  const [busy, startTransition] = useTransition();
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2600);
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, 6);
    startTransition(async () => {
      for (const file of picked) {
        const prepared = await shrink(file);
        const formData = new FormData();
        formData.set("patientId", patientId);
        if (visitId) formData.set("visitId", visitId);
        formData.set("kind", kind);
        formData.set("file", prepared);
        const result = await uploadAttachment(formData);
        if (result.ok) {
          setList((prev) => [result.item, ...prev]);
        } else {
          flash(result.message);
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function remove(item: AttachmentItem) {
    if (!window.confirm(`删除这张「${ATTACHMENT_LABELS[item.kind]}」？删除后不可恢复。`)) return;
    startTransition(async () => {
      const result = await deleteAttachment(item.id);
      if (result.ok) {
        setList((prev) => prev.filter((row) => row.id !== item.id));
      } else {
        flash(result.message ?? "删除失败");
      }
    });
  }

  return (
    <section className={compact ? "" : "card p-4"}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2">
          <h2 className={compact ? "text-[12px] text-ink-3" : "text-[13px] text-ink-2 font-medium"}>{title}</h2>
          <span className="text-[11px] text-ink-4 num">{list.length} 张</span>
        </div>
        <div className="flex items-center gap-1.5">
          {compact ? null : (
            <select
              className="input h-7 py-0 text-[12px] w-auto pr-6"
              value={kind}
              onChange={(event) => setKind(event.target.value as AttachmentKind)}
              aria-label="图片类型"
            >
              {ATTACHMENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ATTACHMENT_LABELS[value]}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn btn-ghost h-7 px-2.5 text-[12px]"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "上传中…" : "＋ 上传图片"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </div>
      </div>

      {hint && !compact ? <p className="text-[11.5px] text-ink-4 mb-2">{hint}</p> : null}

      {list.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-[74px] rounded-[8px] border border-dashed border-line text-[12px] text-ink-4 hover:border-brand hover:text-brand transition-colors"
        >
          还没有图片，点击上传（舌象照片、检查报告、病历照片）
        </button>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((item) => (
            <li key={item.id} className="group relative">
              <button
                type="button"
                onClick={() => setPreview(item)}
                className="block w-[76px] h-[76px] rounded-[8px] overflow-hidden bg-ghost border border-line"
                title={`${ATTACHMENT_LABELS[item.kind]} · ${formatBytes(item.byteSize)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachmentUrl(item.id)}
                  alt={ATTACHMENT_LABELS[item.kind]}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
              <button
                type="button"
                onClick={() => remove(item)}
                title="删除图片"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-line text-ink-3 text-[12px] leading-none grid place-items-center opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {message ? <p className="mt-2 text-[11.5px] text-danger">{message}</p> : null}

      {preview ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-6"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label="图片预览"
        >
          <figure className="max-w-[92vw] max-h-[88vh] space-y-2 text-center" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachmentUrl(preview.id)}
              alt={ATTACHMENT_LABELS[preview.kind]}
              className="max-w-[92vw] max-h-[80vh] rounded-[10px] bg-white object-contain"
            />
            <figcaption className="text-[12px] text-white/80">
              {ATTACHMENT_LABELS[preview.kind]} · {preview.fileName} · {formatBytes(preview.byteSize)}
            </figcaption>
          </figure>
        </div>
      ) : null}
    </section>
  );
}
