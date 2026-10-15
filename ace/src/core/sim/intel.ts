/**
 * 情报系统（GDD §7.2 v0.5-3）：
 * 侦察（1 行动力）→ 对手情报点 +2（上限 10）→ 比赛中"针对准备"加成（点数 × 0.22，最高 +2.2）。
 * 长期不侦察按周衰减。图池档案：★ 级评估由图池熟练 × 阵容 meta 适配合成，情报等级决定显示精度。
 */
import { clamp } from "../rng.ts";
import { AGENT_BY_ID } from "../data/agents.ts";
import type { GameState, MapDef, Team } from "../types.ts";

const INTEL_PER_SCOUT = 2;
export const INTEL_CAP = 10;
const INTEL_WEEKLY_DECAY = 0.5;

export function intelOf(state: GameState, oppTeamId: string): number {
  return clamp(state.scouting[oppTeamId]?.points ?? 0, 0, INTEL_CAP);
}

/** 侦察：+2 情报点（上限 10）。返回新情报等级。 */
export function addIntel(state: GameState, oppTeamId: string, amount = INTEL_PER_SCOUT): number {
  const cur = state.scouting[oppTeamId] ?? { points: 0, last: 0 };
  const next = clamp(cur.points + amount, 0, INTEL_CAP);
  state.scouting[oppTeamId] = { points: next, last: state.day };
  return next;
}

/** 周衰减：长期不侦察，情报慢慢过时（weeklyTick 调用） */
export function decayIntel(state: GameState): void {
  for (const key of Object.keys(state.scouting)) {
    const e = state.scouting[key]!;
    e.points = Math.max(0, e.points - INTEL_WEEKLY_DECAY);
  }
}

export function intelLevel(points: number): 0 | 1 | 2 | 3 {
  if (points >= 6) return 3;
  if (points >= 3) return 2;
  if (points >= 1) return 1;
  return 0;
}

/** 对手单图预估强度 1-100（图池熟练 × 阵容 meta 适配） */
export function estimateMapStrength(state: GameState, team: Team, map: MapDef): number {
  const pref = team.mapPref[map.id] ?? 50;
  // 阵容 meta 适配：按自动分配英雄的 fit 均值折算（不重算完整强度，轻量）
  const lineup = team.starters.map((id) => state.players[id]).filter((p): p is NonNullable<typeof p> => !!p);
  let fitSum = 0;
  let n = 0;
  for (const p of lineup) {
    let bestFit = 1;
    for (const agentId of p.agentPool) {
      const a = AGENT_BY_ID.get(agentId);
      if (!a) continue;
      let f = 1;
      const has = (t: string) => a.mechTags.includes(t);
      if (has("recon")) f += (map.openness - 0.5) * 0.5;
      if (has("smoke")) f += map.sites === 3 ? 0.08 : 0.04;
      if (has("anchor")) f += (0.5 - map.corridor) * 0.4;
      if (has("mobility")) f += (map.openness - 0.5) * 0.3;
      bestFit = Math.max(bestFit, Math.min(1.3, Math.max(0.7, f)));
    }
    fitSum += bestFit;
    n++;
  }
  const fitAvg = n > 0 ? fitSum / n : 1;
  return Math.round(clamp(pref * fitAvg, 1, 100));
}

/** ★ 级映射（★3 强图 / ★2 均势 / ★1 弱图） */
export function starsOf(score: number): 1 | 2 | 3 {
  return score >= 62 ? 3 : score >= 42 ? 2 : 1;
}

/**
 * 未侦察散布区间（GDD §7.2 v1.1）：情报等级 0 时对手单图强度只能看区间估计——
 * 「眼光」技能缩误差（50 → 宽 40；90 → 宽 24；封顶 16/40）。
 */
export function mapStrengthBand(state: GameState, team: Team, map: MapDef, scoutingSkill: number): { lo: number; hi: number } {
  const center = estimateMapStrength(state, team, map);
  const width = clamp(40 - (scoutingSkill - 50) * 0.4, 16, 40);
  const lo = clamp(center - width / 2, 1, 100);
  const hi = clamp(center + width / 2, 1, 100);
  return { lo: Math.round(lo), hi: Math.round(hi) };
}
