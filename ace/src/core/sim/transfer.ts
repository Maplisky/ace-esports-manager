/**
 * 转会市场 v1（GDD §8.2，公式承自调研报告 §5.2 的原作还原并按 v1.1 优化）：
 * 四窗口 · 身价/薪资期望 · logistic 谈判（即时三轮 + 态度条）· 挂牌/解约金/noPoach · AI 挖角与紧急补位。
 * 一切随机经显式 Rng（确定性约定 §11.1）。
 */
import { Rng, clamp, hashString } from "../rng.ts";
import type { GameState, Player, Team, TransferOffer } from "../types.ts";

/** 转会窗（自然年内）：季前 · 夏季窗口 · 休赛期 */
export const TRANSFER_WINDOWS: [number, number][] = [[1, 24], [123, 152], [233, 366]];
const WINDOWS = TRANSFER_WINDOWS;
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
  // 违约金条款（GDD §8.2）：报价 ≥ 解约金 → 强制放人（原队与选手意愿均不构成障碍）
  if (p.releaseClause > 0 && offer.fee >= p.releaseClause) {
    return { insulting: false, chance: 1, objection: `触发解约金条款（${fmt(p.releaseClause)}）——原队不得拒绝`, score: 99 };
  }
  // 抢人保护：noPoach 选手在解约金触发前不可被挖（可问价、报价拒）
  if (p.noPoach) {
    return { insulting: false, chance: 0, objection: "原队已激活抢人保护条款（noPoach），解约金触发前不接受报价", score: -80 };
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

/** 最终检定（确定性：seed 由选手/日期派生）。返回是否接受。 */
export function finalizeOffer(state: GameState, offer: TransferOffer, rng: Rng): { accepted: boolean; reason: string } {
  const p = state.players[offer.playerId] as Player;
  const toTeam = state.teams[offer.toTeam] as Team;
  const ev = evaluateOffer(state, p, offer, toTeam);
  if (ev.insulting) return { accepted: false, reason: `${p.ign} 认为这份报价缺乏诚意，谈判破裂。` };
  // 解约金强制：不受 logistic 拒绝（触发条款即成交）
  if (p.releaseClause > 0 && offer.fee >= p.releaseClause) {
    return { accepted: true, reason: `${p.ign} 的解约金条款被触发（${fmt(p.releaseClause)}）——原队不得拒绝，交易强制完成。` };
  }
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

/** 解约：赔付剩余合同 40%，成为自由人（GDD §8.2）。阵容只剩 5 人时禁止解约（GDD 名单下限）。 */
export function releasePlayer(state: GameState, playerId: string): string {
  const p = state.players[playerId] as Player;
  const team = p.teamId ? state.teams[p.teamId] : null;
  if (!team) return "他已是自由人。";
  if (team.roster.length <= 5) return "阵容只剩五人，再放走就凑不齐首发了——先补人。";
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

  // AI 挂牌/摘牌（v0.8 用户需求：让「挂牌」列活起来）——仅他队；性格定概率，换血型最活跃
  if (inTransferWindow(state.day)) {
    // Deadline Day（GDD §18 #6）：窗口末 3 天挂牌与互挖密度 ×2（仪式感）
    const windowsDL: [number, number][] = [[1, 24], [123, 152], [233, 366]];
    const deadlineSoon = windowsDL.some(([a, b]) => state.day >= b - 2 && state.day <= b);
    const dlMul = deadlineSoon ? 2 : 1;
    const LIST_PERSONALITY: Record<Team["personality"], number> = { wheeler: 0.35, spender: 0.1, youth: 0.08, steady: 0.03 };
    for (const t of Object.values(state.teams)) {
      if (t.id === myId) continue;
      const listedNow = t.roster.map((id) => state.players[id] as Player).filter((p) => p?.listed);
      // 摘牌：挂牌 ≥6 周 → 静默撤牌（截止期不摘——最后机会留队）
      for (const p of listedNow) {
        p.listedWeeks = (p.listedWeeks ?? 0) + 1;
        if (p.listedWeeks >= 6 && !deadlineSoon) {
          p.listed = false;
          p.listedWeeks = 0;
        }
      }
      // 新挂牌：性格概率（每队同时 ≤1 人，截止期概率 ×2）；对象=非 IGL/noPoach 且（老将/无潜力空间/长期板凳）
      if (listedNow.length === 0 && rng.chance((LIST_PERSONALITY[t.personality] ?? 0.08) * dlMul)) {
        const pool = t.roster
          .map((id) => state.players[id] as Player)
          .filter((p) => p && !p.isIgl && !p.noPoach && (p.age >= 27 || p.potential - p.overall <= 2 || (p.benchedWeeks ?? 0) >= 4));
        if (pool.length) {
          const target = rng.pick(pool);
          target.listed = true;
          target.listedWeeks = 0;
          const feed = state.transferFeed;
          feed.push({ day: state.day, year: state.year, kind: "list", text: `${t.name} 挂牌 ${target.ign}（${target.overall}，身价约 ${fmt(marketValue(target, t.tier))}）。` });
          if (feed.length > 300) feed.splice(0, feed.length - 300);
          notes.push(feed[feed.length - 1]!.text);
        }
      }
    }
    // AI 互挖挂牌选手：预算够的他队按 30%/周出价，直接成交（completeTransfer 处理收钱/补位）
    const listedPlayers = Object.values(state.players).filter(
      (p) => p.teamId && p.teamId !== myId && p.listed && p.injuredUntilDay <= state.day,
    );
    if (listedPlayers.length && rng.chance(deadlineSoon ? 0.6 : 0.3)) {
      const target = rng.pick(listedPlayers);
      const fromId = target.teamId as string;
      const seller = state.teams[fromId] as Team;
      const suitors = Object.values(state.teams).filter(
        (t) => t.id !== myId && t.id !== fromId && t.budget > marketValue(target, t.tier) && t.roster.length < 7,
      );
      if (suitors.length && seller) {
        const to = rng.pick(suitors);
        const offer: TransferOffer = {
          id: `AIL${state.day}_${target.id}`,
          playerId: target.id,
          fromTeam: fromId,
          toTeam: to.id,
          fee: Math.round(marketValue(target, to.tier) * rng.range(0.8, 1.1) / 1000) * 1000,
          salary: salaryExpectation(target, to.tier),
          years: rng.int(2, 3),
          signingBonus: 0,
          promisedRole: target.promisedRole,
          day: state.day,
          round: 0,
          demand: "",
          attitude: 0,
        };
        notes.push(...completeTransfer(state, offer, rng));
      }
    }
  }
  return notes;
}

/** 问价（原作式异步，GDD §8.2 v0.8）：花 1 行动力不花钱；2-5 天后给要价（身价×0.9~1.3）+ 本人意向 */
export function askInquiry(state: GameState, playerId: string, rng: Rng): string {
  const p = state.players[playerId] as Player;
  if (!p) return "选手不存在。";
  if (!inTransferWindow(state.day)) return "转会窗口已关闭，不能新报价或问价，只能答复在谈的事。";
  if (state.inquiries.some((q) => q.playerId === playerId && !q.done)) return "该选手问价中，等待答复。";
  const resolveDay = state.day + rng.int(2, 5);
  state.inquiries.push({
    id: `INQ_${state.day}_${playerId}`,
    playerId,
    askDay: state.day,
    resolveDay,
    done: false,
    askingFee: 0,
    intent: "",
  });
  return `已就 ${p.ign} 问价，等待答复（约 ${resolveDay - state.day} 天后）。`;
}

/** 日推进结算：到反馈日的问价出要价+意向（确定性：id 哈希定浮动、评估器定意向） */
export function resolveInquiries(state: GameState): void {
  for (const q of state.inquiries) {
    if (q.done || state.day < q.resolveDay) continue;
    const p = state.players[q.playerId];
    q.done = true;
    if (!p) {
      q.intent = "选手已不知所踪。";
      continue;
    }
    const base = marketValue(p, 1);
    // 有主选手：俱乐部溢价 ×1.15（挂牌 ×0.75、noPoach 天价非卖）
    const premium = !p.teamId ? 1 : p.noPoach ? 2.2 : p.listed ? 0.75 : 1.15;
    q.askingFee = Math.round(base * premium * (0.9 + ((hashString(q.id) % 40) / 100)));
    const clauses: string[] = [];
    if (p.releaseClause > 0) clauses.push(`合同含解约金 ${fmt(p.releaseClause)}（报价≥即强制放人）`);
    const willing = !p.teamId || p.morale >= 45;
    const intent = willing ? (p.morale >= 65 ? "本人意愿强烈，愿谈。" : "本人愿意接触。") : "本人倾向留队，需要更大诚意。";
    if (p.noPoach && p.teamId) clauses.push("俱乐部明确表示非卖（noPoach）");
    if (p.promisedRole === "core" && p.teamId) clauses.push("他是队内核心，挖角难度极高");
    q.intent = intent + (clauses.length ? "（" + clauses.join("；") + "）" : "");
  }
  // 保留最近 20 条；完成超 30 天的清掉
  state.inquiries = state.inquiries.filter((q) => !q.done || state.day - q.resolveDay <= 30).slice(-20);
}
