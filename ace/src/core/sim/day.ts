/**
 * 日推进（GDD §2 微循环 / §9.6 停靠规则）：
 * 赛季中 1 回合 = 1 天；每 7 天结算一次训练/状态回归（v0.1 简化版）。
 * 比赛模拟经 simMatch（确定性 seed = hash(worldSeed:fixtureId)）。
 */
import { Rng, clamp, hashString } from "../rng.ts";
import { computeOverall, spawnFreeAgents } from "../worldgen.ts";
import { OPTION_BY_KEY, XP_PER_ATTR_POINT, XP_PER_DAY } from "../data/training.ts";
import { spawnDailyEvents, spawnBirthdays, resolveEvent } from "./events.ts";
import { aiWeeklyTransfers } from "./transfer.ts";
import { decayIntel } from "./intel.ts";
import { refreshCommercialWeek, weeklySponsorIncome } from "./business.ts";
import type { PlayerAttrs } from "../types.ts";
import { simMatch } from "./match.ts";
import { buildCup, buildLeague, fillNextSlot } from "./fixtures.ts";
import type { GameState, MatchRecord, NewsItem } from "../types.ts";

/**
 * 赛历（GDD §4.2，按自然年排布，考虑闰年）：
 * 季前 1-24 · 揭幕杯 25-52 · Stage1 53-122 · 夏季窗口 123-152 · Stage2 153-232 · 休赛期 233-年末
 * 闰年（2028/2032…）为 366 天，2 月 29 日自然存在；年末跨年翻页。
 */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

export const CALENDAR = {
  preseasonEnd: 24,
  cupStart: 25,
  cupEnd: 52,
  stage1Start: 53,
  stage1End: 122,
  summerStart: 123,
  summerEnd: 152,
  stage2Start: 153,
  stage2End: 232,
  offseasonStart: 233,
} as const;

export interface AdvanceResult {
  day: number;
  notes: string[];
  playedMine: string[];
  seasonEnded: boolean;
}

/** 开赛程：揭幕杯（一级前 8）+ 双循环联赛（一级/次级各一 × Stage1/Stage2）。按年份变化种子。 */
export function initSeasonFixtures(state: GameState): void {
  const rng = new Rng((state.seed ^ Math.imul(state.year, 0x9e3779b9)) >>> 0);
  const t1 = Object.values(state.teams).filter((t) => t.tier === 1);
  const t2 = Object.values(state.teams).filter((t) => t.tier === 2);
  state.comps["cup"] = { key: "cup", name: "揭幕杯", stage: "cup", teamIds: [], standings: {} };
  state.comps["stage1-t1"] = { key: "stage1-t1", name: "VCT-P 霞赛区 · Stage 1", stage: "stage1", teamIds: t1.map((t) => t.id), standings: {} };
  state.comps["stage1-t2"] = { key: "stage1-t2", name: "挑战者联赛 · Stage 1", stage: "stage1", teamIds: t2.map((t) => t.id), standings: {} };
  state.comps["stage2-t1"] = { key: "stage2-t1", name: "VCT-P 霞赛区 · Stage 2", stage: "stage2", teamIds: t1.map((t) => t.id), standings: {} };
  state.comps["stage2-t2"] = { key: "stage2-t2", name: "挑战者联赛 · Stage 2", stage: "stage2", teamIds: t2.map((t) => t.id), standings: {} };
  for (const comp of Object.values(state.comps)) {
    if (comp.key === "cup") continue;
    for (const id of comp.teamIds) {
      comp.standings[id] = { teamId: id, w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, pts: 0 };
    }
  }
  // 揭幕杯：一级按平均 overall 取前 8
  const avgOverall = (id: string) => {
    const t = state.teams[id] as GameState["teams"][string];
    return t.roster.reduce((s, pid) => s + (state.players[pid]?.overall ?? 0), 0) / t.roster.length;
  };
  const cupTeams = t1.slice().sort((a, b) => avgOverall(b.id) - avgOverall(a.id)).slice(0, 8).map((t) => t.id);
  state.comps["cup"]!.teamIds = cupTeams;
  buildCup(state.fixtures, { comp: "cup", name: "揭幕杯", stage: "cup", teamIds: cupTeams, startDay: CALENDAR.cupStart + 1, gapDays: 8, bo: 3, rng });
  buildLeague(state.fixtures, { comp: "stage1-t1", name: "霞赛区联赛", stage: "stage1", teamIds: t1.map((t) => t.id), startDay: CALENDAR.stage1Start + 2, endDay: CALENDAR.stage1End, bo: 3, rng });
  buildLeague(state.fixtures, { comp: "stage1-t2", name: "挑战者联赛", stage: "stage1", teamIds: t2.map((t) => t.id), startDay: CALENDAR.stage1Start + 2, endDay: CALENDAR.stage1End, bo: 3, rng });
  buildLeague(state.fixtures, { comp: "stage2-t1", name: "霞赛区联赛", stage: "stage2", teamIds: t1.map((t) => t.id), startDay: CALENDAR.stage2Start + 2, endDay: CALENDAR.stage2End, bo: 3, rng });
  buildLeague(state.fixtures, { comp: "stage2-t2", name: "挑战者联赛", stage: "stage2", teamIds: t2.map((t) => t.id), startDay: CALENDAR.stage2Start + 2, endDay: CALENDAR.stage2End, bo: 3, rng });
}

function applyStandings(state: GameState, compKey: string, teamA: string, teamB: string, mapScore: [number, number], maps: { score: [number, number] }[]): void {
  const comp = state.comps[compKey];
  if (!comp || !comp.standings[teamA] || !comp.standings[teamB]) return;
  const sa = comp.standings[teamA] as GameState["comps"][string]["standings"][string];
  const sb = comp.standings[teamB] as GameState["comps"][string]["standings"][string];
  if (mapScore[0] > mapScore[1]) {
    sa.w++; sb.l++; sa.pts += 3;
  } else {
    sb.w++; sa.l++; sb.pts += 3;
  }
  sa.mapW += mapScore[0]; sa.mapL += mapScore[1];
  sb.mapW += mapScore[1]; sb.mapL += mapScore[0];
  for (const m of maps) {
    sa.roundW += m.score[0]; sa.roundL += m.score[1];
    sb.roundW += m.score[1]; sb.roundL += m.score[0];
  }
}

/** 周结算（每 7 天）：团队课表与个人训练并行（GDD §6.3 v1.1）+ 疲劳恢复、状态/士气回归 */
function weeklyTick(state: GameState, rng: Rng): void {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  const myPlayers = myTeam ? myTeam.roster.map((id) => state.players[id]).filter((p): p is NonNullable<typeof p> => !!p) : [];
  const trainDays = state.teamSchedule.filter((s) => s !== "rest").length;

  // ── 团队层：跑图涨图池熟练（每天 +0.4，浮点累进——round 会吃掉小数增量）──
  if (myTeam) {
    for (const slot of state.teamSchedule) {
      if (slot === "map") {
        for (const mid of state.trainingMaps) {
          myTeam.mapPref[mid] = clamp((myTeam.mapPref[mid] ?? 50) + 0.4, 20, 95);
        }
      }
    }
  }

  for (const p of Object.values(state.players)) {
    if (p.injuredUntilDay > state.day) continue;
    const isMine = myTeam != null && p.teamId === myTeam.id;
    if (isMine) {
      p.xp = p.xp ?? {};
      // ── 团队层选手效果：复盘日给全队意识/沟通经验（与个人训练并行的团队通道）──
      const reviewDays = state.teamSchedule.filter((s) => s === "review").length;
      const cap = Math.min(99, p.potential + 5);
      if (reviewDays > 0) {
        p.xp.awareness = (p.xp.awareness ?? 0) + reviewDays * 1.2;
        p.xp.communication = (p.xp.communication ?? 0) + reviewDays * 0.6;
      }
      // ── 个人层（并行）：每周一个项目，非休息日按天积累经验（GDD §6.3）──
      const focus = state.schedules[p.id] ?? "rest";
      const opt = OPTION_BY_KEY.get(focus);
      if (opt && opt.attr && trainDays > 0) {
        const attrCap = Math.min(99, p.potential + 5);
        if (p.attrs[opt.attr] < attrCap) {
          const moraleF = 0.75 + p.morale / 200;
          const fatigueF = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1;
          const coachF = 1 + (myTeam.coach.development - 55) / 100;
          const commF = 1 - 0.25 * Math.min(2, p.commercialDays ?? 0); // 商务占用惩罚（GDD §8.4）
          const staffF = 1 + ((myTeam.staff?.training?.value ?? 0) * 0.004); // 训练助教（GDD §8.3：99 点 ≈ ×1.40）
          const gain = rng.range(XP_PER_DAY[0], XP_PER_DAY[1]) * trainDays * moraleF * fatigueF * coachF * commF * staffF;
          p.xp[opt.attr] = (p.xp[opt.attr] ?? 0) + gain;
        }
      } else if (focus === "rest") {
        p.fatigue = clamp(p.fatigue - 2, 0, 100);
      }
      if (p.stream && p.stream.untilDay > state.day) p.fatigue = clamp(p.fatigue + 2, 0, 100); // 直播占用（GDD §8.4）
      // 经验满 100 → 属性 +1（可多次触发；注意读池子当前值，否则跨过 100 会死循环——v1.9 检错）
      for (const attrKey of Object.keys(p.xp)) {
        while ((p.xp[attrKey] ?? 0) >= XP_PER_ATTR_POINT) {
          p.xp[attrKey] = (p.xp[attrKey] ?? 0) - XP_PER_ATTR_POINT;
          const k = attrKey as keyof PlayerAttrs;
          p.attrs[k] = clamp(p.attrs[k] + 1, 30, cap);
        }
      }
      p.overall = computeOverall(p.attrs);
      // 出场期望（GDD §6.4①）：核心/首发承诺坐板凳 → 周士气惩罚；轮换/替补获得首发 → 安心
      // 轮换沟通豁免（GDD §6.4②）：本周已沟通的选手不受罚
      const waive = state.rotationWaive.includes(p.id);
      if ((p.promisedRole === "core" || p.promisedRole === "starter") && !myTeam.starters.includes(p.id) && p.injuredUntilDay <= state.day && !waive) {
        p.morale = clamp(p.morale - 3, 10, 100);
      } else if ((p.promisedRole === "rotation" || p.promisedRole === "bench") && myTeam.starters.includes(p.id)) {
        p.morale = clamp(p.morale + 2, 10, 100);
      }
      // 团队课表的体能效果
      for (const slot of state.teamSchedule) {
        if (slot === "scrim") p.fatigue = clamp(p.fatigue + 5, 0, 100);
        else if (slot === "map") p.fatigue = clamp(p.fatigue + 2, 0, 100);
        else if (slot === "individual") p.fatigue = clamp(p.fatigue + 3, 0, 100); // 旧档兼容
      }
    }
    p.fatigue = clamp(p.fatigue - rng.range(15, 28), 0, 100);
    p.form = clamp(p.form + (70 - p.form) * 0.06 + rng.range(-2, 2), 30, 99);
    p.morale = clamp(p.morale + (68 - p.morale) * 0.05 + rng.range(-1.5, 1.5), 10, 100);
    const team = p.teamId ? state.teams[p.teamId] : null;
    if (team) {
      if (team.starters.includes(p.id)) p.benchedWeeks = 0;
      else p.benchedWeeks++;
    }
  }
}

function setStage(state: GameState): void {
  const d = state.day;
  state.stage =
    d <= CALENDAR.preseasonEnd ? "preseason"
    : d <= CALENDAR.cupEnd ? "cup"
    : d <= CALENDAR.stage1End ? "stage1"
    : d <= CALENDAR.summerEnd ? "summer"
    : d <= CALENDAR.stage2End ? "stage2"
    : "offseason";
}

/** 阶段收官结算：按最终名次结算董事会目标（GDD §9.5） */
function settleObjective(state: GameState, compKey: string, stageName: string, notes: NewsItem[]): void {
  const obj = state.objective;
  if (!obj || !state.myTeamId) return;
  const table = Object.values(state.comps[compKey]?.standings ?? {}).sort(
    (x, y) => y.pts - x.pts || (y.mapW - y.mapL) - (x.mapW - x.mapL) || (y.roundW - y.roundL) - (x.roundW - x.roundL),
  );
  const place = table.findIndex((s) => s.teamId === state.myTeamId) + 1;
  if (place <= 0) return;
  const met = place <= obj.placeAtLeast;
  state.boardConfidence = clamp(state.boardConfidence + (met ? Math.min(14, 6 + (obj.placeAtLeast - place) * 2) : -Math.min(16, 2 + (place - obj.placeAtLeast) * 3)), 0, 100);
  notes.push({
    day: state.day, kind: "club", important: true,
    text: met
      ? `✅ ${stageName}目标达成：第 ${place} 名（要求前 ${obj.placeAtLeast}），董事会满意。`
      : `❌ ${stageName}目标未达成：第 ${place} 名（要求前 ${obj.placeAtLeast}），董事会不满。`,
  });
}

/** 联赛冠军荣誉（career.titles 是退役转教练与名人堂的输入，GDD §8.3） */
function awardLeagueTitle(state: GameState, compKey: string, notes: NewsItem[]): void {
  const table = Object.values(state.comps[compKey]?.standings ?? {}).sort(
    (x, y) => y.pts - x.pts || (y.mapW - y.mapL) - (x.mapW - x.mapL),
  );
  const champ = table[0]?.teamId;
  if (!champ) return;
  for (const pid of (state.teams[champ] as GameState["teams"][string]).roster) {
    const p = state.players[pid];
    if (p) p.career.titles++;
  }
  notes.push({ day: state.day, kind: "league", important: true, text: `🏆 ${state.teams[champ]?.name} 加冕 ${compKey.includes("t2") ? "挑战者联赛" : "霞赛区联赛"}${compKey.includes("stage2") ? " Stage 2" : " Stage 1"} 冠军` });
}

/** 推进一天。onMatch：每场结束回调。mineHold：我的比赛开打前暂停（返回 true 表示拦截，由调用方带参重放）。 */
export function advanceDay(
  state: GameState,
  notes: NewsItem[] = [],
  onMatch?: (rec: MatchRecord, fixtureId: string, mine: boolean) => void,
  mineHold?: (fixtureId: string, teamA: string, teamB: string, bo: 1 | 3 | 5, label: string) => boolean,
): AdvanceResult {
  state.day++;
  setStage(state);
  state.actionPoints = 3;
  const rng = new Rng(hashString(`${state.seed}:day:${state.day}`));
  const playedMine: string[] = [];
  let seasonEnded = false;
  let held = false;

  // 阶段切换
  if (state.day === CALENDAR.cupStart) {
    notes.push({ day: state.day, kind: "league", text: "—— 进入揭幕杯 ——" });
  } else if (state.day === CALENDAR.stage1Start) {
    notes.push({ day: state.day, kind: "league", text: "—— 进入 Stage 1 联赛 ——" });
    if (state.myTeamId) {
      state.objective = { stage: "stage1", placeAtLeast: 4, text: "董事会要求：Stage 1 联赛进入前四。" };
      notes.push({ day: state.day, kind: "club", important: true, text: state.objective.text });
    }
  } else if (state.day === CALENDAR.summerStart) {
    // Stage1 收官：结算目标 + 冠军荣誉
    settleObjective(state, "stage1-t1", "Stage 1", notes);
    awardLeagueTitle(state, "stage1-t1", notes);
    awardLeagueTitle(state, "stage1-t2", notes);
    notes.push({ day: state.day, kind: "league", text: "—— 进入夏季窗口（休整与练兵）——" });
  } else if (state.day === CALENDAR.stage2Start) {
    notes.push({ day: state.day, kind: "league", text: "—— 进入 Stage 2 联赛 ——" });
    if (state.myTeamId) {
      state.objective = { stage: "stage2", placeAtLeast: 4, text: "董事会要求：Stage 2 联赛进入前四。" };
      notes.push({ day: state.day, kind: "club", important: true, text: state.objective.text });
    }
  } else if (state.day === CALENDAR.offseasonStart) {
    // Stage2 收官
    settleObjective(state, "stage2-t1", "Stage 2", notes);
    awardLeagueTitle(state, "stage2-t1", notes);
    awardLeagueTitle(state, "stage2-t2", notes);
    notes.push({ day: state.day, kind: "league", text: "—— 进入休赛期 ——" });
  }

  // 逾期清扫（v1.9 检错修复：PreMatch 停车期间刷新存档 → 我的比赛 day 已过、永不匹配）
  // 过期未打的比赛按"错过准备"自动补打：不再拦截，避免赛程/杯赛树永久卡死
  const overdue = state.fixtures.filter((f) => !f.played && f.day < state.day && f.teamA !== "" && f.teamB !== "");
  for (const f of overdue) {
    const mine = f.teamA === state.myTeamId || f.teamB === state.myTeamId;
  const seed = hashString(`${state.seed}:${f.id}`);
  const rec = simMatch(state, f.teamA, f.teamB, f.bo, seed, f.id, f.mapLock, f.agentLock);
    f.played = true;
    onMatch?.(rec, f.id, mine);
    applyStandings(state, f.comp, f.teamA, f.teamB, rec.score, rec.maps);
    fillNextSlot(state.fixtures, f, rec.winner === "A" ? f.teamA : f.teamB);
    const tagA = (state.teams[f.teamA] as GameState["teams"][string]).tag;
    const tagB = (state.teams[f.teamB] as GameState["teams"][string]).tag;
    const line = `${f.label}（补赛）｜${tagA} ${rec.score[0]}-${rec.score[1]} ${tagB}`;
    notes.push({ day: state.day, kind: "match", text: line, important: mine });
    if (mine) playedMine.push(f.id);
    if (f.label.includes("总决赛") && state.day >= CALENDAR.cupStart && state.day <= CALENDAR.cupEnd) {
      const champ = rec.winner === "A" ? f.teamA : f.teamB;
      const champTeam = state.teams[champ] as GameState["teams"][string];
      for (const pid of champTeam.roster) {
        const p = state.players[pid];
        if (p) p.career.titles++;
      }
      notes.push({ day: state.day, kind: "league", important: true, text: `🏆 ${champTeam.name} 夺得揭幕杯冠军！` });
    }
  }

  // 当日比赛
  const todays = state.fixtures.filter((f) => f.day === state.day && !f.played && f.teamA !== "" && f.teamB !== "");
  for (const f of todays) {
    const mine = f.teamA === state.myTeamId || f.teamB === state.myTeamId;
    if (mine && mineHold && !held) {
      if (!mineHold(f.id, f.teamA, f.teamB, f.bo, f.label)) continue; // 调用方不拦截则正常打
      held = true;
      playedMine.push(f.id); // 标记为"我的比赛待打"
      continue; // 暂停：等玩家完成赛前准备后由 playHeldMatch 重放
    }
    const seed = hashString(`${state.seed}:${f.id}`);
    const rec = simMatch(state, f.teamA, f.teamB, f.bo, seed, f.id, f.mapLock, f.agentLock);
    f.played = true;
    onMatch?.(rec, f.id, mine);
    applyStandings(state, f.comp, f.teamA, f.teamB, rec.score, rec.maps);
    fillNextSlot(state.fixtures, f, rec.winner === "A" ? f.teamA : f.teamB);
    const tagA = (state.teams[f.teamA] as GameState["teams"][string]).tag;
    const tagB = (state.teams[f.teamB] as GameState["teams"][string]).tag;
    const line = `${f.label}｜${tagA} ${rec.score[0]}-${rec.score[1]} ${tagB}`;
    notes.push({ day: state.day, kind: "match", text: line, important: mine });
    if (mine) playedMine.push(f.id);
    // 杯赛冠军
    if (f.label.includes("总决赛") && state.day >= CALENDAR.cupStart && state.day <= CALENDAR.cupEnd) {
      const champ = rec.winner === "A" ? f.teamA : f.teamB;
      const champTeam = state.teams[champ] as GameState["teams"][string];
      for (const pid of champTeam.roster) {
        const p = state.players[pid];
        if (p) p.career.titles++; // 冠军荣誉：退役转教练公式与名人堂的输入（GDD §8.3）
      }
      notes.push({ day: state.day, kind: "league", important: true, text: `🏆 ${champTeam.name} 夺得揭幕杯冠军！` });
    }
  }

  // 事件卡：生日 + 每日抽取（队列上限 4，抑制器与空档补偿，GDD §9.3）
  spawnBirthdays(state);
  spawnDailyEvents(state, rng);

  // 周结算
  if (state.day % 7 === 0) {
    weeklyTick(state, rng);
    refreshCommercialWeek(state, rng);
    decayIntel(state); // 情报过时衰减（GDD §7.2）
    // 轮换沟通周重置（GDD §6.4②：每周 2 次，跨周清空豁免名单）
    const weekIdx = Math.floor(state.day / 7);
    if (state.rotationTalks.week !== weekIdx) {
      state.rotationWaive = [];
      state.rotationTalks = { week: weekIdx, used: 0 };
    }
    // 商务周结算：赞助/直播收入入账 + 邀约刷新（GDD §8.4）
    const bizIncome = weeklySponsorIncome(state);
    if (bizIncome > 0 && state.myTeamId) {
      const myTeam = state.teams[state.myTeamId] as GameState["teams"][string];
      myTeam.budget += bizIncome;
      state.finances.log.push({ day: state.day, label: "商务周收入（赞助/直播）", amount: bizIncome });
      if (state.finances.log.length > 100) state.finances.log.splice(0, state.finances.log.length - 100);
    }
    // AI 转会动态 + 挖角（GDD §8.2）
    const aiNotes = aiWeeklyTransfers(state, rng, (offer) => {
      notes.push({ day: state.day, kind: "transfer", important: true, text: offer.demand });
    });
    for (const t of aiNotes) notes.push({ day: state.day, kind: "transfer", text: t });
    // 报价答复窗到期：7 天未答复视为拒绝
    const expired = state.incomingBids.filter((b) => state.day - b.day > 7);
    for (const b of expired) {
      const p = state.players[b.playerId];
      if (p) p.morale = clamp(p.morale - 4, 10, 100);
      notes.push({ day: state.day, kind: "transfer", text: `⌛ 对 ${p?.ign ?? "?"} 的报价已逾期，视为拒绝（士气 -4）。` });
    }
    state.incomingBids = state.incomingBids.filter((b) => state.day - b.day <= 7);
  }

  // 年末收官 + 翻年（按自然年天数，闰年 366 天；v1.9 检错修复：原实现收官后日历死掉）
  if (state.day === daysInYear(state.year)) {
    seasonEnded = true;
    notes.push({ day: state.day, kind: "league", important: true, text: `—— ${state.year} 赛季收官 ——` });
    // 翻年：年龄 +1 / 合同 −1 / 抑制器与事件状态重置（旧年 lastEventDay 会让新年负面事件被错误抑制） / 新赛季赛程
    state.year++;
    // 赞助合同到期：年限 −1，归零移除（休赛期窗口 C 内可续签）
    for (const t of Object.values(state.teams)) {
      const expired: string[] = [];
      for (const s of t.sponsors) {
        s.years--;
        if (s.years <= 0) expired.push(s.name);
      }
      t.sponsors = t.sponsors.filter((s) => s.years > 0);
      if (expired.length) {
        notes.push({ day: 1, kind: "transfer", text: `📢 ${t.name} 的赞助合同到期：${expired.join("、")}。` });
      }
    }
    for (const p of Object.values(state.players)) {
      p.age++;
      if (p.contractYears > 0) p.contractYears--;
      p.lastEventDay = 0;
      if (p.stream && p.stream.untilDay <= state.day) p.stream = null; // 到期直播合同清理
    }
    state.lastEventDay = 0;
    state.day = 1;
    state.fixtures = [];
    state.objective = null;
    state.boardConfidence = clamp(state.boardConfidence, 20, 90);
    initSeasonFixtures(state);
    // 休赛期自由市场补强（GDD §6.5）：8-12 名新自由人
    const faRng = new Rng((state.seed ^ Math.imul(state.year, 0x5f5f)) >>> 0);
    spawnFreeAgents(state, faRng, 8 + faRng.int(0, 4));
    notes.push({ day: 1, kind: "league", important: true, text: `—— ${state.year} 赛季开始 · 季前准备 ——` });
  }

  // 新闻入档（上限 400 条）
  for (const n of notes) {
    state.news.push(n);
    if (state.news.length > 400) state.news.splice(0, state.news.length - 400);
  }

  return { day: state.day, notes: notes.map((n) => n.text), playedMine, seasonEnded };
}

/** 赛前准备完成后重放"被拦截的我的比赛"（玩家 BP/英雄/首发生效；写入 fixture 不污染预案库） */
export function playHeldMatch(
  state: GameState,
  fixtureId: string,
  opts: { starters?: string[]; maps?: string[] | null; agentPicks?: Record<string, Record<string, string>> },
  onMatch?: (rec: MatchRecord, fixtureId: string, mine: boolean) => void,
): MatchRecord | null {
  const f = state.fixtures.find((x) => x.id === fixtureId);
  if (!f || f.played) return null;
  // 首发确认
  if (opts.starters && state.myTeamId) {
    const team = state.teams[state.myTeamId];
    if (team) team.starters = opts.starters;
  }
  // 手动 BP → 覆盖该场图池（引擎优先读取）
  if (opts.maps && opts.maps.length > 0) {
    f.mapLock = opts.maps.slice();
  }
  // 每图英雄 → 挂到 fixture 上（随比赛走，不污染用户预案库——v0.5-2 检错）
  if (opts.agentPicks && Object.keys(opts.agentPicks).length > 0) {
    f.agentLock = opts.agentPicks;
  }
  const seed = hashString(`${state.seed}:${f.id}`);
  const rec = simMatch(state, f.teamA, f.teamB, f.bo, seed, f.id, f.mapLock, f.agentLock);
  f.played = true;
  // 与 advanceDay 同样的赛后处理
  const notes: NewsItem[] = [];
  applyStandings(state, f.comp, f.teamA, f.teamB, rec.score, rec.maps);
  fillNextSlot(state.fixtures, f, rec.winner === "A" ? f.teamA : f.teamB);
  const tagA = (state.teams[f.teamA] as GameState["teams"][string]).tag;
  const tagB = (state.teams[f.teamB] as GameState["teams"][string]).tag;
  notes.push({ day: state.day, kind: "match", text: `${f.label}｜${tagA} ${rec.score[0]}-${rec.score[1]} ${tagB}`, important: true });
  onMatch?.(rec, f.id, true);
  if (f.label.includes("总决赛") && state.day >= CALENDAR.cupStart && state.day <= CALENDAR.cupEnd) {
    const champ = rec.winner === "A" ? f.teamA : f.teamB;
    const champTeam = state.teams[champ] as GameState["teams"][string];
    for (const pid of champTeam.roster) {
      const p = state.players[pid];
      if (p) p.career.titles++;
    }
    notes.push({ day: state.day, kind: "league", important: true, text: `🏆 ${champTeam.name} 夺得揭幕杯冠军！` });
  }
  for (const n of notes) {
    state.news.push(n);
    if (state.news.length > 400) state.news.splice(0, state.news.length - 400);
  }
  return rec;
}
