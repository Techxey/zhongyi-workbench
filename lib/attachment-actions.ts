"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteUploadFile, saveUpload } from "@/lib/uploads";
import { ATTACHMENT_KINDS, type AttachmentItem, type AttachmentKind } from "@/lib/attachments";

export type AttachmentActionResult =
  | { ok: true; item: AttachmentItem }
  | { ok: false; message: string };

function toKind(value: unknown): AttachmentKind {
  return ATTACHMENT_KINDS.includes(value as AttachmentKind) ? (value as AttachmentKind) : "tongue";
}

function toItem(row: {
  id: string;
  patientId: string;
  visitId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  note: string | null;
  createdAt: string;
}): AttachmentItem {
  return {
    id: row.id,
    patientId: row.patientId,
    visitId: row.visitId,
    kind: toKind(row.kind),
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    note: row.note,
    createdAt: row.createdAt,
  };
}

/** 上传一张图片；patientId 必填，visitId 可选（挂在某次就诊上） */
export async function uploadAttachment(formData: FormData): Promise<AttachmentActionResult> {
  const user = await requireUser();
  const patientId = String(formData.get("patientId") ?? "");
  const visitIdRaw = String(formData.get("visitId") ?? "");
  const visitId = visitIdRaw || null;
  const kind = toKind(formData.get("kind"));
  const note = String(formData.get("note") ?? "").trim() || null;
  const file = formData.get("file");

  if (!patientId) return { ok: false, message: "缺少患者信息" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "没有选择图片" };

  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) return { ok: false, message: "患者不存在" };

  try {
    const saved = await saveUpload(file);
    const row = await prisma.attachment.create({
      data: {
        patientId,
        visitId,
        kind,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        byteSize: saved.byteSize,
        storedPath: saved.storedPath,
        note,
        operatorId: user.id,
        createdAt: new Date().toISOString(),
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "attachment",
        entityId: row.id,
        action: "create",
        beforeJson: null,
        afterJson: JSON.stringify({ patientId, visitId, kind, fileName: saved.fileName, byteSize: saved.byteSize }),
        operatorId: user.id,
        createdAt: new Date().toISOString(),
      },
    });

    revalidatePath(`/patients/${patientId}`);
    if (visitId) revalidatePath(`/visits/${visitId}`);
    return { ok: true, item: toItem(row) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "上传失败" };
  }
}

export async function deleteAttachment(id: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const row = await prisma.attachment.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "图片已经不存在" };

  await prisma.attachment.delete({ where: { id } });
  await deleteUploadFile(row.storedPath);
  await prisma.auditLog.create({
    data: {
      entityType: "attachment",
      entityId: id,
      action: "delete",
      beforeJson: JSON.stringify({ patientId: row.patientId, kind: row.kind, fileName: row.fileName }),
      afterJson: null,
      operatorId: user.id,
      createdAt: new Date().toISOString(),
    },
  });

  revalidatePath(`/patients/${row.patientId}`);
  if (row.visitId) revalidatePath(`/visits/${row.visitId}`);
  return { ok: true };
}
