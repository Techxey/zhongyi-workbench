import { pinyin } from "pinyin-pro";

const GENDER_LABEL: Record<string, string> = {
  male: "男",
  female: "女",
  unknown: "未填",
};

export const GENDER_OPTIONS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "unknown", label: "不便说明" },
];

export function genderLabel(value?: string | null): string {
  if (!value) return "未填";
  return GENDER_LABEL[value] ?? value;
}

export function ageOf(birthYear?: number | null): string {
  if (!birthYear) return "年龄未填";
  const age = new Date().getFullYear() - birthYear;
  if (age < 0 || age > 130) return "年龄未填";
  return `${age} 岁`;
}

/** 列表里手机号默认打码：138****6621 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.replace(/\s|-/g, ""));
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const HH = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)} ${HH}:${min}`;
}

/** 姓名拼音：全拼 + 首字母，用于搜索「zs / zhangsan」 */
export function pinyinOf(name: string): { full: string; initials: string } {
  try {
    return {
      full: pinyin(name, { toneType: "none", type: "array" }).join("").toLowerCase(),
      initials: pinyin(name, { pattern: "first", toneType: "none", type: "array" })
        .join("")
        .toLowerCase(),
    };
  } catch {
    return { full: "", initials: "" };
  }
}

export type SearchablePatient = {
  name: string;
  phone?: string | null;
};

/** 姓名 / 手机号后四位 / 拼音首字母，任一命中即算匹配 */
export function matchesQuery(patient: SearchablePatient, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  if (patient.name.toLowerCase().includes(q)) return true;

  const phone = (patient.phone ?? "").replace(/\D/g, "");
  if (phone && (phone.includes(q) || phone.slice(-4).includes(q))) return true;

  const { full, initials } = pinyinOf(patient.name);
  if (full.includes(q) || initials.includes(q)) return true;

  return false;
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
