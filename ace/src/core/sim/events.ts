/**
 * 事件卡系统（GDD §9.3 v0.5-2）：
 * 每日抽取 0-3 张（35% 基础概率 + 空 6 天保底补偿）· 负面卡 14 天抑制器 · 生日事件（7 天祝福窗口语义以队列表达）。
 * 抽取时绑定目标选手并把 {ign}/{teamName} 代入文案；resolveEvent 按选项结算数值效果。
 */
import { Rng, clamp } from "../rng.ts";
import { TRANSFER_WINDOWS } from "./transfer.ts";
import { EVENT_POOL } from "../data/events.ts";
import type { GameState, PendingEventCard, Player, Team } from "../types.ts";

function fill(text: string, ign: string, teamName: string): string {
  return text.replaceAll("{ign}", ign).replaceAll("{teamName}", teamName);
}

function instUid(state: GameState, cardId: string, pid: string): string {
  return `E${state.year}_${state.day}_${cardId}_${pid}`;
}

function spawnCard(state: GameState, rng: Rng, def: (typeof EVENT_POOL)[number], p: Player, team: Team): void {
  const ign = p.ign;
  const card: PendingEventCard = {
    uid: instUid(state, def.id, p.id),
    cardId: def.id,
    title: def.title,
    text: fill(def.text, ign, team.name),
    negative: def.negative,
    targetPlayerId: p.id,
    day: state.day,
    options: def.options({ ign, teamName: team.name }).map((o) => ({ ...o, label: fill(o.label, ign, team.name), result: fill(o.result, ign, team.name) })),
  };
  state.pendingEvents.push(card);
}

/** 每日事件抽取（advanceDay 调用）：队列上限 4，基础 35%，空 6 天保底 1 张 */
export function spawnDailyEvents(state: GameState, rng: Rng): void {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return;
  const roster = myTeam.roster.map((id) => state.players[id]).filter((p): p is Player => !!p && p.injuredUntilDay <= state.day);
  if (roster.length === 0) return;

  const idleDays = state.day - (state.lastEventDay ?? 0);
  const starved = idleDays >= 6;
  // Deadline Day（GDD §18 #6 落地 v0.8）：转会窗最后 3 天事件密度 ×2（阈值 0.35→0.55，单日上限 3→6）
  const windows = TRANSFER_WINDOWS;
  const deadlineSoon = windows.some(([a, b]) => state.day >= b - 2 && state.day <= b);
  let draws = 0;
  if (starved) draws = 1;
  else {
    const threshold = deadlineSoon ? 0.55 : 0.35;
    const cap = deadlineSoon ? 6 : 3;
    let roll = rng.next();
    while (roll < threshold && draws < cap && state.pendingEvents.length + draws < (deadlineSoon ? 6 : 4)) {
      draws++;
      roll = rng.next();
    }
  }
  if (draws === 0) return;

  for (let i = 0; i < draws; i++) {
    if (state.pendingEvents.length >= 4) break;
    const p = rng.pick(roster);
    const totalW = EVENT_POOL.reduce((s, d) => s + d.weight, 0);
    // 负面卡抑制器：该选手 14 天内当过负面主角 → 只从正面卡里抽
    const suppress = p.lastEventDay !== undefined && state.day - p.lastEventDay < 14;
    let pickIdx = rng.weightedIndex(EVENT_POOL.map((d) => (d.negative && suppress ? 0 : d.weight)));
    let def = EVENT_POOL[pickIdx] as (typeof EVENT_POOL)[number];
    if (def.negative && suppress) def = EVENT_POOL[0] as (typeof EVENT_POOL)[number]; // 兜底：全被抑制时取第一张正面卡
    void pickIdx;
    spawnCard(state, rng, def, p, myTeam);
    if (def.negative) p.lastEventDay = state.day;
    state.lastEventDay = state.day;
  }
}

/** 生日事件：当日生日的我队选手生成祝福卡（uid 含年份，天然一年一次） */
export function spawnBirthdays(state: GameState): void {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return;
  for (const pid of myTeam.roster) {
    const p = state.players[pid] as Player | undefined;
    if (!p || p.birthdayDay !== state.day) continue;
    const uid = `BD_${state.year}_${p.id}`;
    if (state.pendingEvents.some((e) => e.uid === uid)) continue;
    state.pendingEvents.push({
      uid,
      cardId: "birthday",
      title: `🎂 ${p.ign} 的生日`,
      text: `今天 ${p.ign} 满 ${p.age} 岁。更衣室里已经有人偷偷准备惊喜了——要不要表示一下？`,
      negative: false,
      targetPlayerId: p.id,
      day: state.day,
      options: [
        { label: "口头祝福", result: `一句“生日快乐”，{ign} 笑着说“谢谢教练”。`, morale: 2 },
        { label: "送小礼物（$200）", result: `一份精致的小礼物，{ign} 很感动（士气 +5）。`, morale: 5, budget: -200 },
        { label: "组织全队庆祝（$2,500）", result: `更衣室小型派对：蛋糕、合影、闹到很晚。全队士气 +2。`, teamMorale: 2, bond: 2, budget: -2500 },
      ],
    });
  }
}

/** 结算事件卡：应用选项效果并移出队列。返回结果文本（含目标名）。 */
export function resolveEvent(state: GameState, uid: string, optionIndex: number, rng: Rng): { result: string; note: string } | null {
  const idx = state.pendingEvents.findIndex((e) => e.uid === uid);
  if (idx < 0) return null;
  const card = state.pendingEvents[idx] as PendingEventCard;
  const opt = card.options[optionIndex];
  if (!opt) return null;
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  const target = card.targetPlayerId ? state.players[card.targetPlayerId] : null;
  // 目标已离队（转会/解约）→ 选手向效果作废，卡仍按俱乐部层结算移出
  const targetOnMyTeam = target != null && target.teamId === state.myTeamId;

  if (opt.morale && target && targetOnMyTeam) target.morale = clamp(target.morale + opt.morale, 10, 100);
  if (card.negative && target) target.lastEventDay = state.day; // 负面抑制器起点（14 天内不再当负面主角）
  if (opt.teamMorale && myTeam) {
    for (const pid of myTeam.roster) {
      const p = state.players[pid];
      if (p) p.morale = clamp(p.morale + opt.teamMorale, 10, 100);
    }
  }
  if (opt.budget && myTeam) myTeam.budget += opt.budget;
  if (opt.reputation && myTeam) myTeam.reputation = clamp(myTeam.reputation + opt.reputation, 20, 99);
  if (opt.bond && myTeam) myTeam.bond = clamp(myTeam.bond + opt.bond, 0, 100);
  if (opt.fatigue && target && targetOnMyTeam) target.fatigue = clamp(target.fatigue + opt.fatigue, 0, 100);
  if (opt.boardConfidence) state.boardConfidence = clamp(state.boardConfidence + opt.boardConfidence, 0, 100);

  state.pendingEvents.splice(idx, 1);
  state.lastEventDay = state.day;
  let result = fill(opt.result, target?.ign ?? "", myTeam?.name ?? "");
  if (target && !targetOnMyTeam) result += "（注：他已离队，选手向效果作废。）";
  void rng;
  return { result, note: `【${card.title}】${result}` };
}
