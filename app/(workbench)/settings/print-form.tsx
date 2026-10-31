"use client";

import { useActionState } from "react";
import {
  PRINT_FONT_LABELS,
  PRINT_PAPER_LABELS,
  type PrintFontSize,
  type PrintOptions,
  type PrintPaper,
} from "@/lib/print";
import { savePrintSettings, type SettingsState } from "./actions";

const initialState: SettingsState = {};

export function PrintForm({ options }: { options: PrintOptions }) {
  const [state, formAction, pending] = useActionState(savePrintSettings, initialState);

  return (
    <form action={formAction} className="px-5 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="field-label" htmlFor="print-paper">
            纸张
          </label>
          <select
            id="print-paper"
            name="paper"
            className="input"
            defaultValue={options.paper satisfies PrintPaper}
          >
            {(Object.keys(PRINT_PAPER_LABELS) as PrintPaper[]).map((paper) => (
              <option key={paper} value={paper}>
                {PRINT_PAPER_LABELS[paper]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="print-font">
            字号
          </label>
          <select
            id="print-font"
            name="fontSize"
            className="input"
            defaultValue={options.fontSize satisfies PrintFontSize}
          >
            {(Object.keys(PRINT_FONT_LABELS) as PrintFontSize[]).map((size) => (
              <option key={size} value={size}>
                {PRINT_FONT_LABELS[size]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-ink-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="showFourDiagnosis"
            defaultChecked={options.showFourDiagnosis}
            className="accent-brand"
          />
          打印四诊（舌象 / 脉象 / 问诊）
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="showPhone"
            defaultChecked={options.showPhone}
            className="accent-brand"
          />
          打印手机号后四位
        </label>
      </div>

      <div>
        <label className="field-label" htmlFor="print-footer">
          页脚声明
          <span className="ml-2 text-[11px] font-normal text-ink-4">留空则不打印</span>
        </label>
        <textarea
          id="print-footer"
          name="footer"
          className="textarea min-h-[64px]"
          defaultValue={options.footer}
          placeholder="例如：本处方由医生本人开具，系统不提供自动辨证与自动出方。"
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "保存中…" : "保存版式"}
        </button>
        <span className="text-[12.5px] text-brand h-[18px]">
          {state.ok ? "已保存，下一张处方按新版式打印" : ""}
        </span>
        <span className="text-[12.5px] text-danger h-[18px]">{state.error ?? ""}</span>
      </div>
    </form>
  );
}
