import { z } from "zod";

const currentYear = new Date().getFullYear();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `最多 ${max} 个字`)
    .optional()
    .transform((v) => (v ? v : null));

export const patientInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写姓名")
    .max(20, "姓名不超过 20 个字"),
  cardNo: z
    .string()
    .trim()
    .max(32, "卡号不超过 32 个字符")
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-Za-z0-9_-]{1,32}$/.test(v), {
      message: "卡号可用字母、数字、短横线下划线",
    }),
  gender: z.enum(["male", "female", "unknown"], { message: "请选择性别" }),
  birthYear: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= currentYear), {
      message: `出生年应在 1900–${currentYear} 之间`,
    }),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/[\s-]/g, "") : null))
    .refine((v) => v === null || /^1[3-9]\d{9}$/.test(v), { message: "请填写 11 位手机号" }),
  constitution: optionalText(20),
  allergy: optionalText(200),
  pastHistory: optionalText(2000),
  note: optionalText(1000),
});

export type PatientInput = z.infer<typeof patientInputSchema>;

/** 表单里拿到的都是字符串，校验与转型交给 schema */
export type PatientFormRaw = {
  name: string;
  cardNo: string;
  gender: string;
  birthYear: string;
  phone: string;
  constitution: string;
  allergy: string;
  pastHistory: string;
  note: string;
};

export type FormState =
  | { status: "idle" }
  | { status: "ok"; id?: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
    };

export const idleState: FormState = { status: "idle" };

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
