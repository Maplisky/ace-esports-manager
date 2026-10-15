/**
 * 年度选秀（GDD §18-2，v1.0-4）：休赛期联盟分发新血。
 * 16-18 岁新秀池，按上赛季冠军积分倒序选人（弱队先拿 1 号签——联盟再分配反垄断），
 * 与青训营（自建产能）并行构成两条新血来源。
 * 我的 t1 队收到选秀卡：顺位轮到时池中按我队需求推荐前 7 冻结备选（AI 不可截胡），
 * 玩家 7 选 1 或放弃；其余新秀照常被 AI 按需求×潜力挑走，落选者进自由市场。
 */
import { Rng, hashString } from "../rng.ts";
import { spawnRookieClass, salaryFor } from "../worldgen.ts";
import { AGENTS, primaryDuty } from "../data/agents.ts";
import { inTransferWindow } from "./transfer.ts";
import type { Duty, GameState, NewsItem, PendingEventCard, Player, Team } from "../types.ts";

export const DRAFT_CARD_ID = "draft";
export const DRAFT_OPTIONS = 7; // 冻结给玩家的备选数

const DUTY_LABEL: Record<Duty, string> = { duelist: "决斗", initiator: "先锋", controller: "控场", sentinel: "哨卫" };

/** 选手主位置：主职责英雄（agentPool 首位）的职责（makePlayer 先放主职责英雄） */
const positionOf = (p: Player): Duty => {
  const main = AGENTS.find((a) => a.id === p.agentPool[0]);
  return (main ? primaryDuty(main.duty) : "duelist") as Duty;
};

/** 队伍对该新秀的需求评分：潜力 0.6 + 即战力 0.4 + 位置缺口（该职责 <2 人 +8） */
function scoreOf(state: GameState, team: Team, p: Player): number {
  const pos = positionOf(p);
  const count = [...team.roster, ...team.academy].filter((pid) => {
    const q = state.players[pid];
    return q && positionOf(q) === pos;
  }).length;
  return p.potential * 0.6 + p.overall * 0.4 + (count < 2 ? 8 : 0);
}

/** 新秀签约入队：18 岁且一线有空位 → roster；否则入青训营（19 岁毕业窗口自动转正） */
function signRookie(state: GameState, team: Team, p: Player): boolean {
  void state;
  p.teamId = team.id;
  p.contractYears = 3; // 新秀合同 3 年
  p.salary = Math.round(salaryFor(p.overall, 1) * 0.55); // 新秀折扣价
  p.morale = 72;
  if (p.age >= 18 && team.roster.length < 7) {
    team.roster.push(p.id);
    p.promisedRole = "bench";
  } else {
    team.academy.push(p.id);
  }
  return team.roster.includes(p.id);
}

/** 基础顺位：t1 按冠军积分升序（上赛季倒序——战绩越差顺位越靠前） */
function baseOrderOf(state: GameState): Team[] {
  return Object.values(state.teams)
    .filter((t) => t.tier === 1)
    .sort(
      (a, b) =>
        (state.circuitPoints?.[a.id] ?? 0) - (state.circuitPoints?.[b.id] ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
}

/** 应用选秀权交易后的实际签位归属（v1.0-8）：每条 move 把 from 的一个签位转给 to */
export function resolveDraftSlots(state: GameState): string[] {
  const slots = baseOrderOf(state).map((t) => t.id);
  for (const mv of state.draftPickMoves ?? []) {
    const idx = slots.indexOf(mv.from);
    if (idx >= 0) slots[idx] = mv.to;
  }
  return slots;
}

/** 签位估值：1 号签 $500K 起，每顺位 −$25K，地板 $120K */
export function draftPickValue(pickNo: number): number {
  return Math.max(120_000, 500_000 - (Math.max(1, pickNo) - 1) * 25_000);
}

/** 选秀权行情（UI 卡）：我方持签数/预计顺位/卖出价/可买进的最高顺位报价 */
export function draftPickInfo(state: GameState): {
  mySlots: number;
  myProjected: number | null;
  sellPrice: number | null;
  buyOffer: { teamId: string; slotNo: number; price: number } | null;
  windowOpen: boolean;
} {
  const slots = resolveDraftSlots(state);
  const counts: Record<string, number> = {};
  for (const id of slots) counts[id] = (counts[id] ?? 0) + 1;
  const myId = state.myTeamId ?? "";
  const myIdx = slots.indexOf(myId);
  const mySlots = counts[myId] ?? 0;
  const sellPrice = mySlots > 0 && myIdx >= 0 ? Math.round(draftPickValue(myIdx + 1) * 0.9) : null;
  // 买进：战绩差（预计前 8 顺位）且只持 1 签的队愿意换现金——取顺位最高者
  let buyOffer: { teamId: string; slotNo: number; price: number } | null = null;
  if ((counts[myId] ?? 0) < 3) {
    for (let i = 0; i < Math.min(8, slots.length); i++) {
      const owner = slots[i]!;
      if (owner === myId || (counts[owner] ?? 0) > 1) continue;
      buyOffer = { teamId: owner, slotNo: i + 1, price: Math.round(draftPickValue(i + 1) * 1.15) };
      break;
    }
  }
  return { mySlots, myProjected: myIdx >= 0 ? myIdx + 1 : null, sellPrice, buyOffer, windowOpen: inTransferWindow(state.day) };
}

/** 选秀权交易（v1.0-8，GDD §13「选秀权可交易」）：转会窗内买卖下届签位——豪门「未来换现在」 */
export function draftPickTrade(state: GameState, action: "sell" | "buy", notes: NewsItem[]): string {
  const my = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!my) return "我队已不存在。";
  if (!inTransferWindow(state.day)) return "选秀权交易只在转会窗内开放（季前/赛中/休赛期）。";
  const moves = (state.draftPickMoves ??= []);
  const slots = resolveDraftSlots(state);
  const counts: Record<string, number> = {};
  for (const id of slots) counts[id] = (counts[id] ?? 0) + 1;
  const fmt = (n: number) => "$" + n.toLocaleString("en-US");

  if (action === "sell") {
    const myIdx = slots.indexOf(my.id);
    if (myIdx < 0) return "我队已没有可卖的选秀权。";
    // 接盘方：顺位靠后（战绩较好）且持签 ≤1 的 t1 队——强队囤签赌未来
    const buyer = baseOrderOf(state)
      .slice()
      .reverse()
      .find((t) => t.id !== my.id && (counts[t.id] ?? 0) >= 1 && (counts[t.id] ?? 0) < 2 && t.budget >= draftPickValue(myIdx + 1));
    if (!buyer) return "没有球队愿意接手这个选秀权。";
    const price = Math.round(draftPickValue(myIdx + 1) * 0.9);
    moves.push({ from: my.id, to: buyer.id });
    my.budget += price;
    buyer.budget -= price;
    notes.push({ day: state.day, kind: "transfer", text: `🗳 ${my.name} 将下届选秀权出售给 ${buyer.name}，入账 ${fmt(price)}（未来换现在）。` });
    return `已将下届选秀权（预计第 ${myIdx + 1} 顺位）出售给 ${buyer.name}，入账 ${fmt(price)}。`;
  }

  if ((counts[my.id] ?? 0) >= 3) return "联盟规则：单队最多持有 3 个选秀签。";
  const info = draftPickInfo(state);
  if (!info.buyOffer) return "市场上没有可买进的选秀权。";
  const seller = state.teams[info.buyOffer.teamId];
  if (!seller) return "卖家已不存在。";
  if (my.budget < info.buyOffer.price) return `资金不足：该签要价 ${fmt(info.buyOffer.price)}。`;
  moves.push({ from: seller.id, to: my.id });
  my.budget -= info.buyOffer.price;
  seller.budget += info.buyOffer.price;
    notes.push({ day: state.day, kind: "transfer", text: `🗳 ${my.name} 从 ${seller.name} 买入选秀权（预计第 ${info.buyOffer.slotNo} 顺位），支付 ${fmt(info.buyOffer.price)}。` });
  return `从 ${seller.name} 买入选秀权（预计第 ${info.buyOffer.slotNo} 顺位），支付 ${fmt(info.buyOffer.price)}。`;
}

/** 选秀日主流程（day.ts 在 CALENDAR.draftDay 调用；确定性独立 rng 流） */
export function runDraft(state: GameState, notes: NewsItem[]): void {
  const rng = new Rng(hashString(`${state.seed}:draft:${state.year}`));
  // 实际签位归属 = 基础顺位（t1 冠军积分升序）+ 选秀权交易转移（v1.0-8）；应用即清空
  const order = resolveDraftSlots(state)
    .map((id) => state.teams[id])
    .filter((t): t is Team => !!t);
  state.draftPickMoves = [];
  if (order.length === 0) return;
  // 新秀池：每队 1 签 + 40% 富余（落选者进自由市场）
  const pool = spawnRookieClass(state, rng, order.length + Math.round(order.length * 0.4));
  const taken = new Set<string>();
  const picks: { pickNo: number; teamId: string; playerId: string }[] = [];
  const myId = state.myTeamId;
  let pickNo = 0;
  const myCards: PendingEventCard[] = [];

  for (const team of order) {
    const capacity = team.roster.length + team.academy.length < 10; // 员额上限：满员队弃权
    if (team.id === myId) {
      // 我的签：冻结当前池中按我队视角推荐前 N，选项随卡携带（AI 不可截胡）
      const ranked = pool
        .filter((p) => !taken.has(p.id))
        .sort((a, b) => scoreOf(state, team, b) - scoreOf(state, team, a) || (a.id < b.id ? -1 : 1));
      const frozen = ranked.slice(0, DRAFT_OPTIONS);
      frozen.forEach((p) => taken.add(p.id)); // 冻结 = 暂离池
      myCards.push({
        uid: `draft-${state.year}-${pickNo}`,
        cardId: DRAFT_CARD_ID,
        title: `🎯 ${state.year} 年度选秀 · 第 ${pickNo + 1} 顺位`,
        text: `联盟新秀选秀大会：${state.teams[myId]?.name ?? "我队"} 手握第 ${pickNo + 1} 顺位。以下是球探部按阵容缺口与潜力给出的推荐名单（其余新秀已各归其主）。`,
        negative: false,
        day: state.day,
        options: [
          ...frozen.map((p) => ({
            label: `${p.ign}（${DUTY_LABEL[positionOf(p)]} · ${p.age} 岁 · ${p.overall}/${p.potential}）`,
            result: `欢迎 ${p.ign}！`,
          })),
          { label: "放弃本签（名单已满/无人看中）", result: "我队放弃本次选秀权。" },
        ],
        payload: { pickNo: pickNo + 1, playerIds: frozen.map((p) => p.id) },
      });
      picks.push({ pickNo: pickNo + 1, teamId: myId ?? "", playerId: "" }); // 我队签位占位（决策后补记）
      pickNo++;
      continue;
    }
    if (!capacity) continue; // 满员队跳过（弃权）
    const ranked = pool
      .filter((p) => !taken.has(p.id))
      .sort((a, b) => scoreOf(state, team, b) - scoreOf(state, team, a) || (a.id < b.id ? -1 : 1));
    if (ranked.length === 0) break; // 池空
    const choice = ranked[0]!;
    taken.add(choice.id);
    signRookie(state, team, choice);
    picks.push({ pickNo: pickNo + 1, teamId: team.id, playerId: choice.id });
    if (pickNo === 0) {
      notes.push({ day: state.day, kind: "transfer", important: true, text: `🎯 ${state.year} 选秀大会开幕：${team.name} 用 1 号签选中 ${choice.ign}（${DUTY_LABEL[positionOf(choice)]}，${choice.age} 岁，潜力 ${choice.potential}）。` });
    } else if (choice.potential >= 88) {
      notes.push({ day: state.day, kind: "transfer", text: `👀 ${team.name} 在第 ${pickNo + 1} 顺位捡到高潜新秀 ${choice.ign}（潜力 ${choice.potential}）。` });
    }
    pickNo++;
  }

  // 落选新秀 → 自由市场（teamId 保持 null 即入池，可被后续签约）
  state.lastDraft = { year: state.year, picks };
  for (const c of myCards) state.pendingEvents.push(c); // 多签多卡（v1.0-8 交易来的签）
  notes.push({
    day: state.day, kind: "transfer", text: `🎯 ${state.year} 年度选秀落幕：共 ${picks.filter((x) => x.playerId).length} 支签位兑现，落选新秀进入自由市场。`,
  });
}

/** 选秀卡结算（events.resolveEvent 截断路由）：7 选 1 签入我队，或放弃（冻结新秀全部回归自由市场） */
export function resolveDraftCard(
  state: GameState,
  card: PendingEventCard,
  optionIndex: number,
): { result: string; note: string } {
  const payload = card.payload as { pickNo: number; playerIds: string[] } | undefined;
  const playerIds = payload?.playerIds ?? [];
  const mine = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!mine) return { result: "我队已不存在，选秀权作废。", note: "" };
  if (optionIndex >= 0 && optionIndex < playerIds.length) {
    const p = state.players[playerIds[optionIndex]!];
    if (p && !p.teamId) {
      const toFirst = signRookie(state, mine, p);
      // 补记选秀留档（我队占位行）
      const row = state.lastDraft?.picks.find((x) => x.teamId === mine.id && !x.playerId);
      if (row) row.playerId = p.id;
      return {
        result: `🎯 我队用第 ${payload?.pickNo ?? "?"} 号签选中 ${p.ign}（${DUTY_LABEL[positionOf(p)]}，${p.age} 岁，${p.overall}/${p.potential}）${toFirst ? "，直接进入一线名单。" : "，先入青训营培养。"}`,
        note: `选中新秀 ${p.ign}`,
      };
    }
    return { result: `${p?.ign ?? "该新秀"}已被其它队捷足先登。`, note: "" };
  }
  return { result: "我队放弃本次选秀权，冻结名单中的新秀回归自由市场。", note: "放弃选秀签" };
}
