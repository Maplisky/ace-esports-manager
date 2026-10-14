/**
 * 团队强度计算（GDD §5.2）：
 * base = Σ(首发有效能力 × [1.22,1.10,1.00,0.90,0.78]) / Σ权重
 * atk/def = base×K + Σ修正项；防守方固有 +1.5；回合胜负 logistic k=30。
 * ROUND_BASE_SCALE（K=0.35）为调参常数：控制"评 分差 → 回合胜率"的压缩比，
 * 验收基准：87 分队对 72 分队 BO3 胜率 68-78%（§12 T1）。
 */
import { clamp } from "../rng.ts";
import { AGENT_BY_ID } from "../data/agents.ts";
import { computeFit } from "./fit.ts";
import type { MapDef, Player, Team, DutyVector } from "../types.ts";

const LINEUP_WEIGHTS = [1.22, 1.10, 1.00, 0.90, 0.78] as const;
export const ROUND_BASE_SCALE = 0.28;
const DEF_BONUS = 1.5;
export const LOGISTIC_K = 30;
export const SWING_SD = 6;

/** 角色系数表（GDD §5.2），按职责向量插值 */
const KILL_W: DutyVector = { duelist: 1.08, initiator: 0.98, controller: 0.93, sentinel: 0.96 };
const ENTRY_W: DutyVector = { duelist: 2.0, initiator: 1.3, controller: 0.5, sentinel: 0.6 };
const FLEX_MERGE = { duelist: "sentinel", initiator: "controller", controller: "initiator", sentinel: "duelist" } as const;

function interpolate(weights: DutyVector, duty: DutyVector): number {
  let v = 0;
  for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) {
    const main = duty[k];
    const flexKey = FLEX_MERGE[k];
    v += main * weights[k] + duty[flexKey] * 0.3 * weights[flexKey];
  }
  return v;
}

export function dutyKillWeight(duty: DutyVector): number {
  return interpolate(KILL_W, duty);
}
export function dutyEntryWeight(duty: DutyVector): number {
  return interpolate(ENTRY_W, duty);
}

/** 有效能力（GDD §5.2）：状态三角 + 带伤 */
export function effectiveOverall(p: Player, day: number): number {
  const formMod = (p.form - 70) * 0.003;
  const moraleMod = (p.morale - 70) * 0.002;
  const fatigueMod = -p.fatigue * 0.0015;
  const injuryMod = p.injuredUntilDay > day ? -0.2 : 0;
  return p.overall * (1 + formMod + moraleMod + fatigueMod + injuryMod);
}

export interface TeamMapInput {
  team: Team;
  players: Record<string, Player>;
  map: MapDef;
  day: number;
  /** 情报等级 0-10（针对准备 = 等级 × 0.22，最高 +2.2） */
  intel?: number;
  /** 指定每名首发使用的英雄（preset），缺省自动分配 */
  agentAssign?: Record<string, string>;
}

export interface SideStrength {
  teamId: string;
  /** 缩放前的基准强度（加权有效能力均值） */
  base: number;
  atk: number;
  def: number;
  mid: number;
  edge: {
    base: number;
    igl: number;
    chem: number;
    coach: number;
    meta: number;
    map: number;
    prep: number;
    familiarity: number;
    shortHanded: number;
    aim: number;
    awareness: number;
    mapTactics: number;
  };
  lineup: Player[];
  agents: Record<string, string>;
  iglAttr: number;
  clutchAvg: number;
}

function dutyVectorOf(p: Player): DutyVector {
  // 选手职责 = 英雄池职责向量加权（熟练度权重）
  const sum: DutyVector = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) {
      sum[k] += a.duty[k] * pro;
    }
    w += pro;
  }
  if (w <= 0) return { duelist: 0.25, initiator: 0.25, controller: 0.25, sentinel: 0.25 };
  for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] /= w;
  return sum;
}

/** 自动分配英雄：标准位（决斗/先锋/控场/哨卫/自由）按职责覆盖 + 熟练度贪心 */
function assignAgents(lineup: Player[]): Record<string, string> {
  const need: (keyof DutyVector)[] = ["duelist", "initiator", "controller", "sentinel"];
  const used = new Set<string>();
  const out: Record<string, string> = {};
  // 先满足四个标准位：找职责向量在该位最高、且池里有该职责英雄的选手
  for (const duty of need) {
    let bestPid: string | null = null;
    let bestAgent: string | null = null;
    let bestScore = -1;
    for (const p of lineup) {
      if (used.has(p.id)) continue;
      const dv = dutyVectorOf(p);
      for (const agentId of p.agentPool) {
        if (used.has("agent:" + agentId)) continue;
        const a = AGENT_BY_ID.get(agentId);
        if (!a) continue;
        const score = dv[duty] * (p.agentPro[agentId] ?? 0) * 0.01 + a.duty[duty] * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestPid = p.id;
          bestAgent = agentId;
        }
      }
    }
    if (bestPid && bestAgent) {
      out[bestPid] = bestAgent;
      used.add(bestPid);
      used.add("agent:" + bestAgent);
    }
  }
  // 自由位：剩余选手最强英雄；同场不重复（池内全撞车才允许回落）
  for (const p of lineup) {
    if (out[p.id]) continue;
    const free = p.agentPool.filter((a) => !used.has("agent:" + a));
    const pool = free.length ? free : p.agentPool;
    let best = pool[0] ?? p.agentPool[0] ?? "omen";
    let bestPro = -1;
    for (const a of pool) {
      const pro = p.agentPro[a] ?? 0;
      if (pro > bestPro) {
        bestPro = pro;
        best = a;
      }
    }
    out[p.id] = best;
    used.add("agent:" + best);
  }
  return out;
}

export function computeSide(input: TeamMapInput): SideStrength {
  const { team, players, map, day } = input;
  const all = team.starters.map((id) => players[id]).filter((p): p is Player => !!p);
  const healthy = all.filter((p) => p.injuredUntilDay <= day);
  // 伤病缺阵 → 从 roster 补（按有效能力排序）
  if (healthy.length < 5) {
    const bench = team.roster
      .map((id) => players[id])
      .filter((p): p is Player => !!p && !all.includes(p))
      .sort((a, b) => effectiveOverall(b, day) - effectiveOverall(a, day));
    while (healthy.length < 5 && bench.length) {
      const p = bench.shift() as Player;
      if (p.injuredUntilDay <= day) healthy.push(p);
    }
  }
  const lineup = healthy.slice(0, 5);
  const missing = 5 - lineup.length;

  const effs = lineup.map((p) => effectiveOverall(p, day));
  const sorted = effs.slice().sort((a, b) => b - a);
  let base = 0;
  let wSum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = LINEUP_WEIGHTS[i] ?? 0.8;
    base += (sorted[i] ?? 60) * w;
    wSum += w;
  }
  base = wSum > 0 ? base / wSum : 50;

  const avg = (k: keyof Player["attrs"]) => (lineup.length ? lineup.reduce((s, p) => s + p.attrs[k], 0) / lineup.length : 55);
  const iglPlayer = lineup.find((p) => p.isIgl) ?? lineup.slice().sort((a, b) => b.attrs.igl - a.attrs.igl)[0];
  const iglAttr = iglPlayer?.attrs.igl ?? 0;

  const iglMod = iglPlayer ? (iglAttr - 60) * 0.09 : -4;
  const chemMod = ((avg("teamwork") + avg("communication")) / 2 - 65) * 0.07 + (team.bond - 50) * 0.04;
  const coachMod = (team.coach.tactics - 60) * 0.05 - 1;
  const mapMod = ((team.mapPref[map.id] ?? 50) - 50) * 0.07;
  const prepMod = clamp((input.intel ?? 0) * 0.22, 0, 2.2);
  const shortHandedMod = -Math.max(0, missing) * 18;

  // 英雄分配：自动分配打底，玩家首选预案覆盖（GDD §7.1 预案决定上图英雄）
  const autoAgents = assignAgents(lineup);
  const agents = { ...autoAgents };
  if (input.agentAssign) {
    for (const p of lineup) {
      const want = input.agentAssign[p.id];
      if (want && p.agentPool.includes(want)) agents[p.id] = want;
    }
  }
  let fitSum = 0;
  let fitN = 0;
  let proSum = 0;
  for (const p of lineup) {
    const agentId = agents[p.id];
    if (!agentId) continue;
    const a = AGENT_BY_ID.get(agentId);
    fitSum += a ? computeFit(agentId, map) : 1;
    fitN++;
    proSum += p.agentPro[agentId] ?? 50;
  }
  const compFit = fitN > 0 ? fitSum / fitN : 1;
  const metaMod = clamp((compFit - 1) * 10, -2.5, 2.5);
  const avgPro = fitN > 0 ? proSum / fitN : 50;
  const familiarityMod = clamp((avgPro - 40) / 60, 0, 1) * 2;

  // 风格：进攻性 = 决斗+先锋职责占比
  let aggr = 0;
  for (const p of lineup) {
    const dv = dutyVectorOf(p);
    aggr += dv.duelist + dv.initiator;
  }
  aggr /= Math.max(1, lineup.length);
  const styleAtk = (aggr - 0.5) * 3;
  const styleDef = -(aggr - 0.5) * 2;

  const aimMod = (avg("aim") - 65) * 0.05;
  const awareMod = (avg("awareness") - 65) * 0.05;
  const scaledBase = base * ROUND_BASE_SCALE;
  // 地图战术助教（GDD §8.3 v1.7）：预案质量折算攻防修正（最高 +1.2）
  const mapTacticsMod = team.staff?.mapTactics ? clamp((team.staff.mapTactics.value - 60) * 0.02, 0, 1.2) : 0;

  const atk = scaledBase + iglMod + chemMod + coachMod + mapMod + prepMod + metaMod + familiarityMod + shortHandedMod + styleAtk + aimMod + mapTacticsMod;
  const def = scaledBase + iglMod + chemMod + coachMod + mapMod + prepMod + metaMod + familiarityMod + shortHandedMod + styleDef + awareMod + DEF_BONUS + mapTacticsMod;
  const mid = (avg("clutch") - 65) * 0.05 + iglAttr * 0.06;

  return {
    teamId: team.id,
    base,
    atk,
    def,
    mid,
    edge: {
      base: scaledBase, igl: iglMod, chem: chemMod, coach: coachMod, meta: metaMod,
      map: mapMod, prep: prepMod, familiarity: familiarityMod, shortHanded: shortHandedMod,
      aim: aimMod, awareness: awareMod, mapTactics: mapTacticsMod,
    },
    lineup,
    agents,
    iglAttr,
    clutchAvg: avg("clutch"),
  };
}

// fit 计算统一走 fit.ts（单一实现，GDD §4.3）
