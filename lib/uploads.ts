// 图片上传的落盘与读取（只在本机运行，文件放在 data/uploads 下）。
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type SavedUpload = {
  storedPath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

function resolveSafe(relativePath: string): string {
  const full = path.resolve(UPLOAD_ROOT, relativePath);
  if (!full.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    throw new Error("文件路径不合法");
  }
  return full;
}

export async function saveUpload(file: File): Promise<SavedUpload> {
  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    throw new Error("只支持 JPG / PNG / WebP 图片");
  }
  if (file.size <= 0) {
    throw new Error("文件是空的");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB，请先压缩`);
  }

  const now = new Date();
  const bucket = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const fileName = `${randomUUID()}.${ext}`;
  const storedPath = `${bucket}/${fileName}`;

  const dir = path.join(UPLOAD_ROOT, bucket);
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, fileName), bytes);

  return {
    storedPath,
    fileName: file.name || fileName,
    mimeType: file.type,
    byteSize: file.size,
  };
}

export async function readUpload(storedPath: string): Promise<Buffer> {
  return readFile(resolveSafe(storedPath));
}

export async function deleteUploadFile(storedPath: string): Promise<void> {
  try {
    await unlink(resolveSafe(storedPath));
  } catch {
    // 文件已经不在就忽略，数据库记录照删
  }
}
