/**
 * 财务可视化核心（GDD v1.3 可视化核心）：finances.log 是唯一事实源。
 * 30 天窗口对账（窗口终点 === 当前预算）/ 分类占比 / 瀑布步进 / 顶栏 7 日净流外推。
 * 口径说明：当前模拟中资金只经 转会/解约/选秀权/商务/事件 流动（薪资与奖金未模拟为现金流）。
 */
import type { GameState } from "../types.ts";

export type FinanceCat = "transfer" | "release" | "draft" | "business" | "event" | "other";

export const FINANCE_CAT_CN: Record<FinanceCat, string> = {
  transfer: "转会",
  release: "解约",
  draft: "选秀权",
  business: "商务",
  event: "事件",
  other: "其他",
};

/** 入账 helper：push + 统一裁剪到最近 100 条（各资金变动点都用这个，口径一致） */
export function logFinance(state: GameState, label: string, amount: number): void {
  state.finances.log.push({ day: state.day, label, amount });
  if (state.finances.log.length > 100) state.finances.log.splice(0, state.finances.log.length - 100);
}

/** 流水分类：按 label 前缀/关键词（与各入账点的文案约定保持同步） */
export function categorize(label: string): FinanceCat {
  if (label.startsWith("转会") || label.includes("签字费")) return "transfer";
  if (label.startsWith("解约")) return "release";
  if (label.startsWith("选秀权")) return "draft";
  if (label.startsWith("商务")) return "business";
  if (label.startsWith("事件")) return "event";
  return "other";
}

export interface FinanceEntry {
  day: number;
  label: string;
  amount: number;
  cat: FinanceCat;
}

export interface FinanceWindow {
  /** 窗口起点余额（= 当前预算 − 窗口内流水合计，反推锚定） */
  start: number;
  entries: FinanceEntry[];
  /** 瀑布步进：每笔后的累计余额（含起点） */
  steps: { day: number; balance: number; label: string; amount: number }[];
  /** 窗口终点余额——对账不变量：恒等于当前预算 */
  end: number;
}

/** 30 天（可参数化）现金流窗口：从 finances.log 取 [day-window+1, day] 的流水 */
export function financeWindow(state: GameState, windowDays = 30): FinanceWindow {
  const my = state.myTeamId ? state.teams[state.myTeamId] : null;
  const budget = my?.budget ?? 0;
  const from = state.day - windowDays + 1;
  const entries: FinanceEntry[] = (state.finances.log ?? [])
    .filter((e) => e.day >= from && e.day <= state.day)
    .map((e) => ({ day: e.day, label: e.label, amount: e.amount, cat: categorize(e.label) }));
  const net = entries.reduce((s, e) => s + e.amount, 0);
  const start = budget - net;
  const steps: FinanceWindow["steps"] = [{ day: from, balance: start, label: "期初", amount: 0 }];
  let acc = start;
  for (const e of entries) {
    acc += e.amount;
    steps.push({ day: e.day, balance: acc, label: e.label, amount: e.amount });
  }
  return { start, entries, steps, end: acc };
}

/** 分类占比（收入/支出分开聚合，0 值类不出现） */
export function financeBreakdown(entries: FinanceEntry[]): { cat: FinanceCat; income: number; expense: number }[] {
  const map = new Map<FinanceCat, { income: number; expense: number }>();
  for (const e of entries) {
    const cur = map.get(e.cat) ?? { income: 0, expense: 0 };
    if (e.amount >= 0) cur.income += e.amount;
    else cur.expense += -e.amount;
    map.set(e.cat, cur);
  }
  return [...map.entries()].map(([cat, v]) => ({ cat, ...v }));
}

/** 顶栏现金流预测：近 7 日净流均值外推下周（单位 $/天；无流水返回 null） */
export function cashFlowForecast(state: GameState, days = 7): { perDay: number; week: number } | null {
  const from = state.day - days + 1;
  const entries = (state.finances.log ?? []).filter((e) => e.day >= from && e.day <= state.day);
  if (entries.length === 0) return null;
  const net = entries.reduce((s, e) => s + e.amount, 0);
  return { perDay: net / days, week: net };
}
