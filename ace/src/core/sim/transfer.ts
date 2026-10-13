/**
 * 转会市场 v1（GDD §8.2，公式承自调研报告 §5.2 的原作还原并按 v1.1 优化）：
 * 四窗口 · 身价/薪资期望 · logistic 谈判（即时三轮 + 态度条）· 挂牌/解约金/noPoach · AI 挖角与紧急补位。
 * 一切随机经显式 Rng（确定性约定 §11.1）。
 */
import { Rng, clamp } from "../rng.ts";
import type { GameState, Player, Team, TransferOffer } from "../types.ts";

/** 转会窗（自然年内）：季前 · 夏季窗口 · 休赛期 */
const WINDOWS: [number, number][] = [[1, 24], [123, 152], [233, 366]];
export function inTransferWindow(day: number): boolean {
  return WINDOWS.some(([a, b]) => day >= a && day <= b);
}
/** 窗口宽限（GDD §8.2 v1.1）：关窗后 3 天内仍可完成在谈交易 */
export function graceRemain(state: GameState): number | null {
  if (inTransferWindow(state.day)) return null;
  for (const [a, b] of WINDOWS) {
    if (state.day > b && state.day <= b + 3) return b + 3 - state.day;
  }
  return 0;
}

/** 身价（调参见 GDD §12）：基础 × 潜力溢价 × 年龄系数 × 级别系数 */
export function marketValue(p: Player, tier: 1 | 2): number {
  const base = Math.pow(Math.max(4, p.overall - 48), 2.2) * 300;
  const potF = 1 + Math.max(0, p.potential - p.overall) * 0.03;
  const ageF = p.age <= 21 ? 1.25 : p.age <= 25 ? 1.1 : p.age <= 29 ? 0.9 : 0.65;
  const tierF = tier === 1 ? 1 : 0.45;
  const v = base * potF * ageF * tierF * (p.listed ? 0.75 : 1);
  return Math.round(v / 1000) * 1000;
}

/** 薪资期望（求购方视角）；按目标级别与当前薪资取高者上浮 10% */
export function salaryExpectation(p: Player, targetTier: 1 | 2): number {
  const market = 0.06 * Math.pow(1.21, clamp(p.overall + 2, 50, 95));
  const cur = Math.max(p.salary, 0);
  return Math.max(Math.round(Math.max(market, cur) * 1.1), 12000);
}

export interface OfferTerms {
  fee: number;
  salary: number;
  years: number;
  signingBonus: number;
  promisedRole: "core" | "starter" | "rotation" | "bench";
}

const ROLE_RANK = { bench: 0, rotation: 1, starter: 2, core: 3 } as const;

export interface NegotiationEval {
  insulting: boolean;
  chance: number;
  /** 最短板（谈判 UI 的主要诉求提示） */
  objection: string | null;
  score: number;
}

/** 报价评估（调研报告 §5.2 logistic 模型 + 经理谈判技能） */
export function evaluateOffer(state: GameState, p: Player, offer: OfferTerms, toTeam: Team): NegotiationEval {
  const curTeam = p.teamId ? state.teams[p.teamId] : null;
  const salaryExp = salaryExpectation(p, toTeam.tier);
  const insultLine = salaryExp * 0.7;
  if (offer.salary < insultLine) {
    return { insulting: true, chance: 0, objection: `薪资远低于他的期望（约 ${fmt(salaryExp)}/年）`, score: -99 };
  }
  const fs: { v: number; why: string }[] = [];
  fs.push({ v: (offer.salary / salaryExp - 1) * 60, why: "薪资低于他的期望" });
  fs.push({ v: offer.signingBonus / Math.max(1, salaryExp) * 26, why: "签字费缺乏吸引力" });
  const roleDelta = ROLE_RANK[offer.promisedRole] - ROLE_RANK[p.promisedRole];
  fs.push({ v: roleDelta >= 0 ? roleDelta * 11 : roleDelta * 16, why: offer.promisedRole === "starter" || offer.promisedRole === "core" ? "他希望更核心的位置" : "不接受替补定位" });
  fs.push({ v: (toTeam.reputation - (curTeam?.reputation ?? 40)) * 0.9, why: "认为这支球队不如他现在的平台" });
  if (curTeam) fs.push({ v: toTeam.tier < curTeam.tier ? 18 : toTeam.tier > curTeam.tier ? -22 : 0, why: "不愿意降级去次级联赛" });
  fs.push({ v: p.listed ? 7 : 0, why: "" });
  // 板凳越久越想走（求购方视角为正向）
  fs.push({ v: Math.min(p.benchedWeeks, 6) * 1.5, why: "" });
  fs.push({ v: offer.years >= 3 ? (p.age >= 27 ? 8 : 3) : 0, why: "" });
  if (p.noPoach) fs.push({ v: -13, why: "不愿接受转会限制条款" });
  const neg = state.manager?.skills.negotiation ?? 50;
  fs.push({ v: (neg - 50) * 0.6, why: "" });
  const score = fs.reduce((s, f) => s + f.v, 0);
  const chance = 1 / (1 + Math.exp(-score / 14));
  const worst = fs.filter((f) => f.why).sort((a, b) => a.v - b.v)[0];
  return { insulting: false, chance: clamp(chance, 0.02, 0.92), objection: worst && worst.v < 0 ? worst.why : null, score };
}

function fmt(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;
}

/** 开启即时谈判会话（GDD §8.2 v1.1：1-3 轮，态度条实时评估） */
export function startNegotiation(state: GameState, offer: TransferOffer): { demand: string; attitude: number; insulting: boolean } {
  const p = state.players[offer.playerId] as Player;
  const toTeam = state.teams[offer.toTeam] as Team;
  const ev = evaluateOffer(state, p, offer, toTeam);
  offer.round = 1;
  offer.demand = ev.insulting ? "这份报价缺乏诚意。" : ev.objection ?? "他在认真考虑。";
  offer.attitude = Math.round(ev.chance * 100);
  return { demand: offer.demand, attitude: offer.attitude, insulting: ev.insulting };
}

/** 调整后的再谈（第 2/3 轮）：重新评估并给出新诉求 */
export function reNegotiate(state: GameState, offer: TransferOffer): { demand: string; attitude: number } {
  const p = state.players[offer.playerId] as Player;
  const toTeam = state.teams[offer.toTeam] as Team;
  offer.round = Math.min(3, offer.round + 1);
  const ev = evaluateOffer(state, p, offer, toTeam);
  offer.demand = ev.insulting ? "他拒绝继续对话。" : ev.objection ?? "他接近被说服了。";
  offer.attitude = Math.round(ev.chance * 100);
  return { demand: offer.demand, attitude: offer.attitude };
}

/** 最终检定（确定性：seed 由球员/日期派生）。返回是否接受。 */
export function finalizeOffer(state: GameState, offer: TransferOffer, rng: Rng): { accepted: boolean; reason: string } {
  const p = state.players[offer.playerId] as Player;
  const toTeam = state.teams[offer.toTeam] as Team;
  const ev = evaluateOffer(state, p, offer, toTeam);
  if (ev.insulting) return { accepted: false, reason: `${p.ign} 认为这份报价缺乏诚意，谈判破裂。` };
  const accepted = rng.chance(ev.chance);
  return accepted
    ? { accepted: true, reason: `${p.ign} 接受了报价（${fmt(offer.fee)}，年薪 ${fmt(offer.salary)} × ${offer.years} 年）。` }
    : { accepted: false, reason: `${p.ign} 拒绝了报价：${offer.demand || "他对条款不满意"}。` };
}

/** 完成转会：资金/名单/新闻（含卖方 <5 人自动紧急补位，GDD §8.2 继承清单；买方名单上限 7） */
export function completeTransfer(state: GameState, offer: TransferOffer, rng: Rng): string[] {
  const notes: string[] = [];
  const p = state.players[offer.playerId] as Player;
  const fromTeam = p.teamId ? state.teams[p.teamId] : null;
  const toTeam = state.teams[offer.toTeam] as Team;
  if (fromTeam) {
    fromTeam.budget += offer.fee;
    fromTeam.roster = fromTeam.roster.filter((id) => id !== p.id);
    fromTeam.starters = fromTeam.starters.filter((id) => id !== p.id);
    if (fromTeam.roster.length < 5) {
      const fa = Object.values(state.players).find((x) => !x.teamId && x.injuredUntilDay <= state.day);
      if (fa) {
        fa.teamId = fromTeam.id;
        fa.salary = salaryExpectation(fa, fromTeam.tier);
        fromTeam.roster.push(fa.id);
        notes.push(`🚨 ${fromTeam.name} 紧急签下自由人 ${fa.ign} 补足名单。`);
      }
    }
  }
  toTeam.budget -= offer.fee + offer.signingBonus;
  toTeam.roster.push(p.id);
  if (toTeam.starters.length < 5) toTeam.starters.push(p.id);
  p.teamId = toTeam.id;
  p.salary = offer.salary;
  p.contractYears = offer.years;
  p.morale = clamp(p.morale + 8, 10, 100);
  p.benchedWeeks = 0;
  p.listed = false;
  p.career.clubs.push(toTeam.id);
  const feed = state.transferFeed;
  feed.push({ day: state.day, year: state.year, kind: "done", text: `${toTeam.name} 以 ${fmt(offer.fee)} 从 ${fromTeam?.name ?? "自由市场"} 签下 ${p.ign}（${p.overall}）。` });
  if (feed.length > 300) feed.splice(0, feed.length - 300);
  notes.push(feed[feed.length - 1]!.text);
  return notes;
}

/** 解约：赔付剩余合同 40%，成为自由人（GDD §8.2） */
export function releasePlayer(state: GameState, playerId: string): string {
  const p = state.players[playerId] as Player;
  const team = p.teamId ? state.teams[p.teamId] : null;
  if (!team) return "他已是自由人。";
  const cost = Math.round(p.salary * Math.max(0, p.contractYears) * 0.4);
  team.budget -= cost;
  team.roster = team.roster.filter((id) => id !== playerId);
  team.starters = team.starters.filter((id) => id !== playerId);
  p.teamId = null;
  p.contractYears = 0;
  p.morale = clamp(p.morale - 6, 10, 100);
  const feed = state.transferFeed;
  feed.push({ day: state.day, year: state.year, kind: "release", text: `${team.name} 与 ${p.ign} 解约（赔付 ${fmt(cost)}），他成为自由人。` });
  if (feed.length > 300) feed.splice(0, feed.length - 300);
  return `${p.ign} 已解约，赔付 ${fmt(cost)}。`;
}

/** 每周 AI 转会动态：挖角我方 + AI 自由签约（仅窗内；轻量活市场，GDD §8.2 继承清单） */
export function aiWeeklyTransfers(state: GameState, rng: Rng, onBid: (offer: TransferOffer) => void): string[] {
  const notes: string[] = [];
  const myId = state.myTeamId;
  if (myId && inTransferWindow(state.day)) {
    // AI 挖角我方：优先长期板凳/高整体值钱货
    const team = state.teams[myId] as Team;
    const candidates = team.roster
      .map((id) => state.players[id] as Player)
      .filter((p) => p && p.injuredUntilDay <= state.day)
      .map((p) => ({ p, w: 1 + Math.min(6, p.benchedWeeks) * 1.2 + Math.max(0, p.overall - 74) * 0.4 + (p.listed ? 3 : 0) }));
    if (candidates.length && rng.chance(0.25)) {
      const target = candidates[rng.weightedIndex(candidates.map((c) => c.w))]!.p;
      // 挖角不限买方名单（接受时满员会自动腾位，见 worker respondBid）；只看预算与意愿
      const suitors = Object.values(state.teams).filter((t) => t.id !== myId && t.tier === team.tier && t.budget > marketValue(target, team.tier));
      if (suitors.length) {
        const from = rng.pick(suitors);
        const fee = Math.round(marketValue(target, team.tier) * rng.range(0.85, 1.25) / 1000) * 1000;
        const offer: TransferOffer = {
          id: `BID${state.day}_${target.id}`,
          playerId: target.id,
          fromTeam: from.id,
          toTeam: myId,
          fee,
          salary: salaryExpectation(target, from.tier),
          years: rng.int(2, 3),
          signingBonus: 0,
          promisedRole: target.promisedRole,
          day: state.day,
          round: 0,
          demand: `${from.name} 报价求购，7 天内答复，逾期视为拒绝。`,
          attitude: 1,
        };
        state.incomingBids.push(offer);
        onBid(offer);
        notes.push(`💼 ${from.name} 报价 ${fmt(fee)} 求购 ${target.ign}，7 天内答复。`);
      }
    }
  }
  // AI 自由签约：自由池按需补强（仅窗内；每周概率触发）
  const fas = Object.values(state.players).filter((p) => !p.teamId && p.injuredUntilDay <= state.day);
  if (fas.length && rng.chance(0.4) && inTransferWindow(state.day)) {
    const fa = rng.pick(fas);
    const suitors = Object.values(state.teams).filter((t) => t.id !== myId && t.roster.length < 7);
    if (suitors.length) {
      const to = rng.pick(suitors);
      if (to.roster.length < 7) {
        fa.teamId = to.id;
        fa.salary = salaryExpectation(fa, to.tier);
        to.roster.push(fa.id);
        const feed = state.transferFeed;
        feed.push({ day: state.day, year: state.year, kind: "done", text: `${to.name} 免转会费签下自由人 ${fa.ign}（${fa.overall}）。` });
        if (feed.length > 300) feed.splice(0, feed.length - 300);
        notes.push(feed[feed.length - 1]!.text);
      }
    }
  }
  return notes;
}
