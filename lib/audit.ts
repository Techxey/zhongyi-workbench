import { prisma } from "./db";

export type AuditInput = {
  entityType: "patient" | "visit" | "visit_revision" | "kb_item" | "prescription" | "export";
  entityId: string;
  action: "create" | "update" | "sign" | "amend" | "import" | "export" | "view_pii";
  before?: unknown;
  after?: unknown;
  operatorId: string;
};

const PII_KEYS = new Set(["phone", "idCard", "id_card", "address"]);

/** 审计里的手机号等直接落明文就失去意义，落库前打码（保留后四位便于对账） */
function redactPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPii);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k) && typeof v === "string" && v.length >= 4) {
        out[k] = `****${v.slice(-4)}`;
      } else {
        out[k] = redactPii(v);
      }
    }
    return out;
  }
  return value;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.before === undefined ? null : JSON.stringify(redactPii(input.before)),
      afterJson: input.after === undefined ? null : JSON.stringify(redactPii(input.after)),
      operatorId: input.operatorId,
      createdAt: new Date().toISOString(),
    },
  });
}
