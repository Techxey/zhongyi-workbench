export type PrintPaper = "A5" | "A4";
export type PrintFontSize = "small" | "normal" | "large";

export type PrintOptions = {
  paper: PrintPaper;
  fontSize: PrintFontSize;
  showFourDiagnosis: boolean;
  showPhone: boolean;
  footer: string;
};

export const DEFAULT_PRINT_FOOTER =
  "本处方由医生本人开具，系统不提供自动辨证与自动出方。处方内容为本次就诊快照，后续修订不改变已打印内容。";

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paper: "A5",
  fontSize: "normal",
  showFourDiagnosis: true,
  showPhone: true,
  footer: DEFAULT_PRINT_FOOTER,
};

export const PRINT_PAPER_LABELS: Record<PrintPaper, string> = {
  A5: "A5 · 小处方笺",
  A4: "A4 · 大处方笺",
};

export const PRINT_FONT_LABELS: Record<PrintFontSize, string> = {
  small: "小",
  normal: "标准",
  large: "大",
};

/** 纸面宽度（含打印区）用 mm，字号用 px 基准 */
export const PRINT_PAPER_MM: Record<PrintPaper, { width: number; height: number }> = {
  A5: { width: 148, height: 200 },
  A4: { width: 210, height: 282 },
};

export const PRINT_BASE_PX: Record<PrintFontSize, number> = {
  small: 11,
  normal: 12,
  large: 13.2,
};

export function normalizePrintOptions(raw: unknown): PrintOptions {
  const source = (raw ?? {}) as Partial<PrintOptions>;
  const paper: PrintPaper = source.paper === "A4" ? "A4" : "A5";
  const fontSize: PrintFontSize =
    source.fontSize === "small" || source.fontSize === "large" ? source.fontSize : "normal";
  const footer =
    typeof source.footer === "string" && source.footer.trim()
      ? source.footer.trim().slice(0, 160)
      : DEFAULT_PRINT_OPTIONS.footer;
  return {
    paper,
    fontSize,
    showFourDiagnosis: source.showFourDiagnosis !== false,
    showPhone: source.showPhone !== false,
    footer,
  };
}

export function parsePrintOptionsJson(value: string | null | undefined): PrintOptions {
  if (!value) return DEFAULT_PRINT_OPTIONS;
  try {
    return normalizePrintOptions(JSON.parse(value));
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

export function printPageStyle(options: PrintOptions): string {
  const paper = PRINT_PAPER_MM[options.paper];
  return `@page { size: ${options.paper} portrait; margin: 9mm 10mm; }
.print-page { --sheet-w: ${paper.width}mm; --sheet-h: ${paper.height}mm; --print-base: ${PRINT_BASE_PX[options.fontSize]}px; }
.print-page .sheet { width: var(--sheet-w); min-height: var(--sheet-h); font-size: var(--print-base); }`;
}
