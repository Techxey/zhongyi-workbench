"use client";

import type { RxComponent } from "@/lib/kb";

/** 接诊台与检索浮层之间的最小桥：当前病历上下文 + 带入事件 */
export type KbContext = {
  symptoms: string[];
  syndrome: string;
};

export type KbInsertPayload = {
  type: "formula" | "herb";
  name: string;
  source: string | null;
  components: RxComponent[];
  usageText: string;
  doses?: string;
  kbItemId: string;
  kbItemVersion: number;
};

let context: KbContext = { symptoms: [], syndrome: "" };
let insertHandler: ((payload: KbInsertPayload) => void) | null = null;

export function setKbContext(next: KbContext) {
  context = next;
}

export function getKbContext(): KbContext {
  return context;
}

export function registerKbInsert(handler: ((payload: KbInsertPayload) => void) | null) {
  insertHandler = handler;
}

export function hasKbInsertHandler(): boolean {
  return Boolean(insertHandler);
}

export function requestKbInsert(payload: KbInsertPayload): boolean {
  if (!insertHandler) return false;
  insertHandler(payload);
  return true;
}
