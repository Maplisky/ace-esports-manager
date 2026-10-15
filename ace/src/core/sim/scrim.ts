/**
 * 训练赛系统（GDD §5.6 v1.1 重做版）：
 * 约战（对手/地图/目标三选一）→ AI 接受判定（强队婉拒弱队/临近正赛拒约/宿敌互约）→
 * 单图先到 13 模拟（无 BP、不计个人数据、不产生 MatchRecord）→ 收益按陪练系数结算。
 * 情报生态（§7.2）：负场情报进度全量增加；对手战术变化（阵容变动）→ 我方情报衰减一半。
 */
import { clamp } from "../rng.ts";
import { hashString, Rng } from "../rng.ts";
import type { GameState, NewsItem, ScrimGoal } from "../types.ts";
import { MAP_BY_ID } from "../data/maps.ts";
import { addIntel, INTEL_CAP, intelOf, starsOf, estimateMapStrength } from "./intel.ts";
import { simMatch, resolveMatchRoster } from "./match.ts";
import { aggrOfLineup, styleOf, STYLE_LABEL, type StyleKey } from "./strength.ts";
import type { Player } from "../types.ts";

/** 队伍实力口径：首发平均 overall（与选队界面「阵容强度」同一直觉） */
export function teamAvgOverall(state: GameState, teamId: string): number {
  const t = state.teams[teamId];
  if (!t) return 50;
  const ps = t.starters.map((id) => state.players[id]).filter((p): p is Player => !!p);
  if (ps.length === 0) return 50;
  return ps.reduce((s, p) => s + p.overall, 0) / ps.length;
}

/** 陪练系数（§12 调参表）：1 + clamp((对手−我方)/40, −0.35, +0.20) —— 约低 20 分 ×0.65、约高 8 分 ×1.20 */
export function scrimSparringCoef(mine: number, opp: number): number {
  return 1 + clamp((opp - mine) / 40, -0.35, 0.2);
}

/** 对手临近正赛判定（≤2 天有正式赛 → 怕暴露战术拒约） */
function oppBusySoon(state: GameState, oppId: string): boolean {
  return state.fixtures.some((f) => !f.played && f.day > state.day && f.day <= state.day + 2 && (f.teamA === oppId || f.teamB === oppId));
}

/**
 * AI 约战接受判定（GDD §5.6，显式 Rng——同 seed 双跑逐位一致）：
 * 基础 0.74；强队婉拒弱队（对手比我强 ≥12 → −0.45）；临近正赛 −0.55；宿敌（同赛区且我对其有情报）+0.18。
 */
export function scrimAcceptChance(state: GameState, myId: string, oppId: string): number {
  const my = teamAvgOverall(state, myId);
  const opp = teamAvgOverall(state, oppId);
  let chance = 0.74;
  if (opp - my >= 12) chance -= 0.45; // 强队更婉拒弱队
  if (oppBusySoon(state, oppId)) chance -= 0.55; // 临近正赛怕暴露
  const rival = state.teams[oppId]?.regionId === state.teams[myId]?.regionId && intelOf(state, oppId) >= 1;
  if (rival) chance += 0.18; // 宿敌互约（互相侦察）
  return clamp(chance, 0.05, 0.95);
}

export interface ScrimRequest {
  oppId: string;
  mapId: string;
  goal: ScrimGoal;
  /** goal === "style" 时指定目标风格 */
  goalStyle?: StyleKey;
}

export interface ScrimResult {
  accepted: boolean;
  reason: string;
  won: boolean;
  score: [number, number];
  coef: number;
}

/**
 * 发起训练赛（worker 已校验行动力 ≥1；此处请求即扣 1 点——被婉拒也算打过电话）。
 * 确定性：接受判定用传入 rng；对局 seed 由 (世界种子, 天, 对手, 图, 目标) 哈希派生。
 */
export function requestScrim(state: GameState, req: ScrimRequest, rng: Rng, notes: NewsItem[]): ScrimResult {
  const myId = state.myTeamId as string;
  const my = state.teams[myId];
  const opp = state.teams[req.oppId];
  if (!my || !opp || req.oppId === myId) return { accepted: false, reason: "对手无效。", won: false, score: [0, 0], coef: 1 };
  const mapDef = MAP_BY_ID.get(req.mapId);
  if (!mapDef) return { accepted: false, reason: "地图无效。", won: false, score: [0, 0], coef: 1 };

  state.actionPoints = Math.max(0, state.actionPoints - 1);

  const chance = scrimAcceptChance(state, myId, req.oppId);
  if (!rng.chance(chance)) {
    notes.push({ day: state.day, kind: "club", text: `📵 ${opp.name} 婉拒了训练赛邀请（约战消耗 1 行动力）。` });
    return { accepted: false, reason: `${opp.name} 婉拒了邀请。`, won: false, score: [0, 0], coef: 1 };
  }

  const myStr = teamAvgOverall(state, myId);
  const oppStr = teamAvgOverall(state, req.oppId);
  let coef = scrimSparringCoef(myStr, oppStr);
  // 图池特训：对手该图为强图（★3）→ 陪练系数额外 +0.15
  if (req.goal === "mappool" && starsOf(estimateMapStrength(state, opp, mapDef)) === 3) coef += 0.15;

  // 单图先到 13（无 BP、无干预）：mapLock 锁图，simMatch 结果仅取回合比分后丢弃（不进回放库）
  const matchSeed = hashString(`${state.seed}:scrim:${state.day}:${req.oppId}:${req.mapId}:${req.goal}`);
  const rec = simMatch(state, myId, req.oppId, 1, matchSeed, `scrim-${state.day}-${req.oppId}`, [req.mapId]);
  const map = rec.maps[0]!;
  const won = rec.winner === "A";
  const gainMul = won ? coef : 0.45 * coef; // 负场收益 ×0.45（情报另算全量）

  // ── 目标收益（GDD §5.6 三选一）──
  const oppStyle = styleOf(aggrOfLineup(opp.starters.map((id) => state.players[id]).filter((p): p is Player => !!p)));
  let effectText = "";
  state.styleCounter ??= {};
  if (req.goal === "blend") {
    my.bond = clamp(my.bond + 2 * gainMul, 0, 100);
    my.mapPref[req.mapId] = clamp((my.mapPref[req.mapId] ?? 50) + 0.5 * gainMul, 20, 95);
    for (const p of resolveMatchRoster(state, my)) {
      p.xp ??= {};
      p.xp.teamwork = (p.xp.teamwork ?? 0) + 1.5 * gainMul;
      p.xp.communication = (p.xp.communication ?? 0) + 1.5 * gainMul;
    }
    effectText = "磨合训练：羁绊与图池熟练提升";
  } else if (req.goal === "style") {
    if (req.goalStyle && oppStyle === req.goalStyle) {
      state.styleCounter[req.goalStyle] = clamp((state.styleCounter[req.goalStyle] ?? 0) + 0.5, 0, 10);
      effectText = `风格特训生效：对「${STYLE_LABEL[oppStyle]}」应对熟练度 +0.5`;
    } else {
      my.bond = clamp(my.bond + 0.5 * gainMul, 0, 100);
      effectText = `风格不匹配（对手实际为「${STYLE_LABEL[oppStyle]}」），仅少量磨合收益`;
    }
  } else {
    // 图池特训：目标图熟练收益 ×1.5（0.4 跑图当量 → 0.6），另计系数
    my.mapPref[req.mapId] = clamp((my.mapPref[req.mapId] ?? 50) + 0.6 * gainMul, 20, 95);
    effectText = "图池特训：目标图熟练 +0.6 × 系数";
  }

  // ── 状态结算：疲劳按正式赛公式 ×0.6（单图 5 → 3）；士气胜负 ±2/−4，输给强队 ≥10 减半 ──
  const gap = oppStr - myStr;
  for (const p of resolveMatchRoster(state, my)) {
    p.fatigue = clamp(p.fatigue + 3, 0, 100);
    if (won) p.morale = clamp(p.morale + 2, 10, 100);
    else p.morale = clamp(p.morale - (gap >= 10 ? 2 : 4), 10, 100); // 虽败有得
    p.form = clamp(p.form + (won ? 0.5 : -0.5), 30, 99);
  }
  // 负场 → 该对手情报进度全量增加（GDD §5.6：输局是情报的大来源）
  if (!won) addIntel(state, req.oppId, INTEL_CAP);

  state.scrimLog ??= [];
  state.scrimLog.push({ day: state.day, oppId: req.oppId, mapId: req.mapId, goal: req.goal, score: map.score, won });
  if (state.scrimLog.length > 20) state.scrimLog.splice(0, state.scrimLog.length - 20);

  notes.push({
    day: state.day, kind: "match",
    text: `🤝 训练赛 vs ${opp.name}（${mapDef.name}·${req.goal === "blend" ? "磨合" : req.goal === "style" ? "风格特训" : "图池特训"}）：${won ? "胜" : "负"} ${Math.max(map.score[0], map.score[1])}-${Math.min(map.score[0], map.score[1])}。${effectText}${!won ? "；情报进度全量增加" : ""}。`,
  });
  return { accepted: true, reason: "", won, score: map.score, coef };
}

/**
 * 对手战术变化衰减（GDD §7.2）：该队阵容/战术发生变化（转会进出、教练更替）→
 * 我对其情报点减半并返回新闻文本（无情报或不足时返回 null）。completeTransfer 双端调用，零 RNG。
 */
export function noteTacticsChanged(state: GameState, teamId: string): string | null {
  const entry = state.scouting[teamId];
  if (!entry || entry.points <= 0) return null;
  const before = entry.points;
  entry.points = Math.max(0, entry.points / 2);
  if (before < 2) return null;
  const t = state.teams[teamId];
  return `🔀 ${t?.name ?? "对手"} 阵容变动、战术打法生变——对其情报部分过时（${Math.round(before)} → ${Math.round(entry.points)}）。`;
}
