/**
 * 英雄数据表 — 28 名英雄（GDD §5.4 v1.6 全量分级 + §6.1 职责向量）
 * ultTiers[0] 为主档；mechTags 驱动地图适配 fit 与推荐训练项。
 * * 号英雄（钛狐/禁灭/维斯/暮蝶）为初始推断，随版本用出场数据校准（GDD §5.4）。
 */
import type { AgentDef, DutyVector } from "../types.ts";

function dv(duelist: number, initiator: number, controller: number, sentinel: number): DutyVector {
  return { duelist, initiator, controller, sentinel };
}

export const AGENTS: readonly AgentDef[] = [
  // ── 决斗系 ──
  { id: "jett", name: "捷风", duty: dv(1, 0, 0, 0), ultTiers: ["harvest"], mechTags: ["mobility", "entry"] },
  { id: "raze", name: "雷兹", duty: dv(1, 0, 0, 0), ultTiers: ["core", "harvest"], mechTags: ["entry", "area"] },
  { id: "yoru", name: "夜露", duty: dv(0.85, 0.15, 0, 0), ultTiers: ["combo"], mechTags: ["mobility", "entry"] },
  { id: "phoenix", name: "不死鸟", duty: dv(1, 0, 0, 0), ultTiers: ["core"], mechTags: ["entry", "flash"] },
  { id: "reyna", name: "芮娜", duty: dv(1, 0, 0, 0), ultTiers: ["harvest"], mechTags: ["entry"] },
  { id: "neon", name: "霓虹", duty: dv(1, 0, 0, 0), ultTiers: ["core"], mechTags: ["mobility", "entry"] },
  { id: "iso", name: "壹决", duty: dv(1, 0, 0, 0), ultTiers: ["harvest"], mechTags: ["entry"] },
  { id: "waylay", name: "暮蝶", duty: dv(1, 0, 0, 0), ultTiers: ["harvest"], mechTags: ["mobility", "entry"], newUntilVersion: "2026-S1" },
  // ── 先锋系 ──
  { id: "sova", name: "猎枭", duty: dv(0, 1, 0, 0), ultTiers: ["combo"], mechTags: ["recon"] },
  { id: "breach", name: "铁臂", duty: dv(0, 1, 0, 0), ultTiers: ["core"], mechTags: ["flash", "entry"] },
  { id: "skye", name: "斯凯", duty: dv(0.15, 0.85, 0, 0), ultTiers: ["core"], mechTags: ["flash", "heal", "recon"] },
  { id: "kayo", name: "K/O", duty: dv(0, 1, 0, 0), ultTiers: ["core"], mechTags: ["suppress", "recon"] },
  { id: "fade", name: "黑梦", duty: dv(0, 1, 0, 0), ultTiers: ["info"], mechTags: ["recon"] },
  { id: "gekko", name: "盖可", duty: dv(0.1, 0.9, 0, 0), ultTiers: ["core"], mechTags: ["recon", "entry"] },
  { id: "tejo", name: "钛狐", duty: dv(0, 1, 0, 0), ultTiers: ["core"], mechTags: ["recon", "area"], newUntilVersion: "2026-S1" },
  // ── 控场系 ──
  { id: "brimstone", name: "炼狱", duty: dv(0, 0, 1, 0), ultTiers: ["core"], mechTags: ["smoke", "area"] },
  { id: "omen", name: "幽影", duty: dv(0, 0.2, 0.8, 0), ultTiers: ["core"], mechTags: ["smoke", "mobility"] },
  { id: "astra", name: "星礈", duty: dv(0, 0, 1, 0), ultTiers: ["core"], mechTags: ["smoke", "area"] },
  { id: "viper", name: "蝰蛇", duty: dv(0, 0, 0.9, 0.1), ultTiers: ["core"], mechTags: ["smoke", "area"] },
  { id: "harbor", name: "海神", duty: dv(0, 0, 1, 0), ultTiers: ["core"], mechTags: ["smoke", "area"] },
  { id: "clove", name: "幻棱", duty: dv(0, 0, 1, 0), ultTiers: ["core"], mechTags: ["smoke"] },
  // ── 哨卫系 ──
  { id: "sage", name: "贤者", duty: dv(0, 0, 0.5, 0.5), ultTiers: ["utility"], mechTags: ["heal", "anchor"] },
  { id: "cypher", name: "零", duty: dv(0, 0, 0, 1), ultTiers: ["info"], mechTags: ["recon", "anchor"] },
  { id: "killjoy", name: "奇乐", duty: dv(0, 0, 0, 1), ultTiers: ["core"], mechTags: ["anchor", "area"] },
  { id: "chamber", name: "尚勃勒", duty: dv(0.4, 0, 0, 0.6), ultTiers: ["harvest"], mechTags: ["anchor"] },
  { id: "deadlock", name: "钢锁", duty: dv(0, 0, 0, 1), ultTiers: ["harvest"], mechTags: ["anchor", "area"] },
  { id: "vyse", name: "维斯", duty: dv(0, 0, 0.1, 0.9), ultTiers: ["core"], mechTags: ["anchor", "suppress"], newUntilVersion: "2026-S1" },
  { id: "veto", name: "禁灭", duty: dv(0, 0.3, 0, 0.7), ultTiers: ["core"], mechTags: ["anchor", "suppress", "recon"], newUntilVersion: "2026-S1" },
];

export const AGENT_BY_ID: ReadonlyMap<string, AgentDef> = new Map(AGENTS.map((a) => [a.id, a]));

/** 大招就绪加成（GDD §5.4 v1.5 调参表） */
export const ULT_TIER_BONUS: Record<string, number> = {
  core: 0.6,
  harvest: 0.5,
  combo: 0.5,
  utility: 0.4,
  info: 0.25,
};

/** 职责主类（向量最大分量；平手按 先锋>控场>哨卫>决斗 的展示序取一） */
export function primaryDuty(duty: DutyVector): string {
  let best: keyof DutyVector = "duelist";
  let bestV = -1;
  const order: (keyof DutyVector)[] = ["initiator", "controller", "sentinel", "duelist"];
  for (const k of order) {
    if (duty[k] > bestV) {
      bestV = duty[k];
      best = k;
    }
  }
  return best;
}
