import { prisma } from "@/lib/db";
import { parsePrintOptionsJson, type PrintOptions } from "@/lib/print";

export const PRINT_OPTIONS_KEY = "print_options";

export async function loadPrintOptions(): Promise<PrintOptions> {
  const row = await prisma.setting.findUnique({ where: { key: PRINT_OPTIONS_KEY } });
  return parsePrintOptionsJson(row?.value ?? null);
}
