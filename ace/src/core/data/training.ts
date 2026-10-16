/**
 * 个人训练项目表（GDD §6.3 v1.1 个人层，与团队课表并行）：
 * 每项明确对应一个八维属性（具体训练指标），攒满 100 经验 = +1 属性。
 */
import type { PlayerAttrs } from "../types.ts";

export interface IndividualOption {
  key: string;
  name: string;
  /** 训练指标（八维之一）；rest 为 null */
  attr: keyof PlayerAttrs | null;
  desc: string;
}

export const INDIVIDUAL_OPTIONS: readonly IndividualOption[] = [
  { key: "aim", name: "枪法", attr: "aim", desc: "压枪/爆头线" },
  { key: "reaction", name: "反应", attr: "reaction", desc: " peek 与拉枪速度" },
  { key: "awareness", name: "意识", attr: "awareness", desc: "地图信息与决策" },
  { key: "utility", name: "道具", attr: "utility", desc: "道具投掷与配合" },
  { key: "clutch", name: "残局", attr: "clutch", desc: "1vX 处理" },
  { key: "teamwork", name: "协同", attr: "teamwork", desc: "交叉火力与补枪" },
  { key: "communication", name: "沟通", attr: "communication", desc: "报点与指挥清晰度" },
  { key: "igl", name: "指挥", attr: "igl", desc: "读场与临场调度（建议指挥练）" },
  { key: "rest", name: "休息", attr: null, desc: "不安排个人加练" },
];

export const OPTION_BY_KEY: ReadonlyMap<string, IndividualOption> = new Map(INDIVIDUAL_OPTIONS.map((o) => [o.key, o]));

/** 推荐项目：按主职责 + 是否指挥（GDD §6.3 v1.1 修正：按实际职责而非申报位置） */
export function recommendFocus(duty: "duelist" | "initiator" | "controller" | "sentinel", isIgl: boolean): string {
  if (isIgl) return "igl";
  switch (duty) {
    case "duelist": return "aim";
    case "initiator": return "awareness";
    case "controller": return "utility";
    case "sentinel": return "awareness";
  }
}

/** 各职责的次要训练项（主项达到成长上限时的 fallback，GDD §6.3 v1.4） */
const SECONDARY_FOCUS: Record<"duelist" | "initiator" | "controller" | "sentinel", string> = {
  duelist: "reaction",
  initiator: "utility",
  controller: "teamwork",
  sentinel: "clutch",
};

/** 训练推荐计划项（v1.4 一键推荐）：fatigue>70 或全属性近上限 → 休息保状态 */
export interface PlanRecommendation {
  key: string;
  reason: "primary" | "secondary" | "rest-fatigue" | "rest-capped";
}

/** 属性成长上限（与 day.ts 训练结算同口径：potential + 5，硬顶 99） */
function attrCapped(p: { attrs: { aim: number; reaction: number; awareness: number; utility: number; clutch: number; teamwork: number; communication: number; igl: number }; potential: number }, attr: string): boolean {
  const cap = Math.min(99, p.potential + 5);
  return (p.attrs[attr as keyof typeof p.attrs] ?? 50) >= cap;
}

/**
 * 一键训练推荐（v1.4 用户反馈）：
 * 1) 疲劳 >70 → 休息（疲劳伤害训练收益减半，先恢复）；
 * 2) 主职责项（IGL 优先指挥）未达上限 → 练主项；
 * 3) 主项已上限 → 次职责项未上限 → 练次项；
 * 4) 全部接近上限 → 休息保状态。
 */
export function recommendPlan(
  p: { attrs: { aim: number; reaction: number; awareness: number; utility: number; clutch: number; teamwork: number; communication: number; igl: number }; potential: number; fatigue: number; isIgl: boolean },
  duty: "duelist" | "initiator" | "controller" | "sentinel",
): PlanRecommendation {
  if (p.fatigue > 70) return { key: "rest", reason: "rest-fatigue" };
  const primary = recommendFocus(duty, p.isIgl);
  const primaryAttr = OPTION_BY_KEY.get(primary)?.attr;
  if (primaryAttr && !attrCapped(p, primaryAttr)) return { key: primary, reason: "primary" };
  const secondary = SECONDARY_FOCUS[duty];
  const secondaryAttr = OPTION_BY_KEY.get(secondary)?.attr;
  if (secondaryAttr && !attrCapped(p, secondaryAttr)) return { key: secondary, reason: "secondary" };
  return { key: "rest", reason: "rest-capped" };
}

/** 每训练日经验基准（GDD §6.3：1.4~3.2/日 = 原作周 7~16 均摊 5 个训练日） */
export const XP_PER_DAY: [number, number] = [1.4, 3.2];
export const XP_PER_ATTR_POINT = 100;
