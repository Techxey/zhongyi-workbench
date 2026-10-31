// 图片资料的共享类型（客户端组件也要用）
export type AttachmentKind = "tongue" | "record" | "other";

export type AttachmentItem = {
  id: string;
  patientId: string;
  visitId: string | null;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  note: string | null;
  createdAt: string;
};

export const ATTACHMENT_KINDS: AttachmentKind[] = ["tongue", "record", "other"];

export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  tongue: "舌象照片",
  record: "检查报告 / 病历",
  other: "其他资料",
};

export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}`;
}

export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
