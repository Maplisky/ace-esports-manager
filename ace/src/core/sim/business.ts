/**
 * 商务系统 v1（GDD §8.4）：
 * 赞助（俱乐部层，三档/声望门槛/业绩条款）· 商务日（选手层，占训练）· 直播合同（60/40 分成）。
 * 收支均走周结算节奏：周收入 = perSeason/48，薪资支出同口径（GDD §12）。
 */
import { Rng, clamp } from "../rng.ts";
import type { GameState, GigOffer, Player, Sponsor, SponsorOffer } from "../types.ts";

const TIER_DEF = [
  { tier: 1 as const, name: "地方品牌", min: 80_000, max: 150_000, repNeed: 20 },
  { tier: 2 as const, name: "国民品牌", min: 200_000, max: 300_000, repNeed: 45 },
  { tier: 3 as const, name: "国际品牌", min: 350_000, max: 450_000, repNeed: 60 },
];

const BRANDS_T1 = ["晨光乳业", "飞毛腿快递", "街角咖啡", "雷霆文具", "滨江健身房"];
const BRANDS_T2 = ["星火运动", "长城汽车", "云杉银行", "银河电子", "巨浪饮料"];
const BRANDS_T3 = ["HyperTech", "VoltEnergy", "ApexAir", "NovaTel"];


function sponsorSlotsFor(reputation: number): number {
  return reputation >= 60 ? 4 : reputation >= 35 ? 3 : 2;
}

/** 生成 1-2 条赞助意向（档位按声望门槛过滤） */
function refreshSponsorOffers(state: GameState, rng: Rng): void {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return;
  const slots = sponsorSlotsFor(myTeam.reputation);
  const open = slots - myTeam.sponsors.length;
  if (open <= 0) return;
  const pool = TIER_DEF.filter((t) => myTeam.reputation >= t.repNeed);
  if (pool.length === 0) return;
  const count = Math.min(open, rng.int(1, 2));
  for (let i = 0; i < count; i++) {
    const def = rng.pick(pool);
    const perSeason = Math.round(rng.range(def.min, def.max) / 1000) * 1000;
    const brands = def.tier === 1 ? BRANDS_T1 : def.tier === 2 ? BRANDS_T2 : BRANDS_T3;
    state.sponsorOffers.push({
      id: `SP${state.year}_${state.day}_${i}_${rng.int(100, 999)}`,
      name: rng.pick(brands),
      tier: def.tier,
      perSeason,
      years: rng.int(1, 2),
      signedYear: state.year,
      expires: state.day + 21,
    });
  }
  // 过期清理
  state.sponsorOffers = state.sponsorOffers.filter((o) => o.expires > state.day);
}

/** 签约成功率（GDD §8.4）：声望档位差 + 商务技能 + 商务经理 − 同档竞品 */
export function sponsorSignChance(state: GameState, tier: 1 | 2 | 3): number {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  const rep = myTeam?.reputation ?? 40;
  const def = TIER_DEF.find((t) => t.tier === tier)!;
  const bizSkill = state.manager?.skills.business ?? 50;
  const bizManager = 0; // v0.5-5 教练组接入后由商务经理提供
  const need = def.repNeed;
  const sameTierCount = (myTeam?.sponsors ?? []).filter((s) => s.tier === tier).length;
  return clamp(0.3 + (rep - need) * 0.01 + bizSkill * 0.005 + bizManager * 0.002 - sameTierCount * 0.05, 0.1, 0.9);
}

/** 签约（检定通过后调用）：写档 + 首期进账 + 流水 */
export function signSponsorOffer(state: GameState, offer: SponsorOffer, rng: Rng): { ok: boolean; text: string } {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return { ok: false, text: "无俱乐部。" };
  if (offer.expires <= state.day) return { ok: false, text: "该赞助意向已过期。" };
  if (myTeam.sponsors.length >= sponsorSlotsFor(myTeam.reputation)) return { ok: false, text: "赞助栏位已满。" };
  const chance = sponsorSignChance(state, offer.tier);
  if (!rng.chance(chance)) return { ok: false, text: `${offer.name} 婉拒了合作（态度 + 档位门槛）。` };
  const sponsor: Sponsor = { ...offer, signedYear: state.year };
  myTeam.sponsors.push(sponsor);
  // 收入走周结算细水长流（首期+周薪双重发放曾致首年超发 25%——检错移除）
  return { ok: true, text: `与 ${offer.name} 签下 ${offer.years} 年赞助（${fmtMoney(sponsor.perSeason)}/赛季），周收入即刻生效。` };
}

export function cancelSponsorById(state: GameState, sponsorId: string): string {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return "无俱乐部。";
  const idx = myTeam.sponsors.findIndex((s) => s.id === sponsorId);
  if (idx < 0) return "找不到该赞助。";
  const s = myTeam.sponsors[idx] as Sponsor;
  myTeam.sponsors.splice(idx, 1);
  myTeam.reputation = clamp(myTeam.reputation - 2, 20, 99);
  return `与 ${s.name} 解约（声望 -2）。`;
}

/** 周收入：全部赞助 perSeason/48 + 直播合同俱乐部分成 40% */
export function weeklySponsorIncome(state: GameState): number {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return 0;
  let income = 0;
  for (const s of myTeam.sponsors) income += Math.round(s.perSeason / 48);
  for (const p of myTeam.roster.map((id) => state.players[id])) {
    if (p?.stream && p.stream.untilDay > state.day) income += Math.round(p.stream.weekly * 0.4);
  }
  return income;
}

function fmtMoney(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;
}


/** 接受选手商务邀约：进账 + 占 1 个训练日（GDD §8.4） */
export function acceptGig(state: GameState, gigId: string): { ok: boolean; text: string } {
  const idx = state.gigOffers.findIndex((g) => g.id === gigId);
  if (idx < 0) return { ok: false, text: "邀约已过期。" };
  const gig = state.gigOffers[idx] as GigOffer;
  const p = state.players[gig.playerId];
  if (!p || p.teamId !== state.myTeamId) return { ok: false, text: "选手已不在阵中。" };
  state.gigOffers.splice(idx, 1);
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (myTeam) myTeam.budget += gig.pay;
  state.finances.log.push({ day: state.day, label: `商务活动 · ${gig.brand}（${p.ign}）`, amount: gig.pay });
  p.commercialDays = (p.commercialDays ?? 0) + 1;
  return { ok: true, text: `${p.ign} 出席 ${gig.brand} 活动：+${fmtMoney(gig.pay)}（本周训练日 -1）。` };
}

export function declineGig(state: GameState, gigId: string): void {
  state.gigOffers = state.gigOffers.filter((g) => g.id !== gigId);
}

/** 选手直播合同（2-3 个月）：俱乐部拿 40%，选手拿 60%；每周占 1 个训练日 + 疲劳 */
export function signStream(state: GameState, playerId: string, months: number, rng: Rng): { ok: boolean; text: string } {
  const p = state.players[playerId] as Player;
  if (!p) return { ok: false, text: "找不到选手。" };
  if (p.stream && p.stream.untilDay > state.day) return { ok: false, text: `${p.ign} 已有直播合同在身。` };
  const weekly = Math.round((1200 + p.overall * 60) * rng.range(0.8, 1.3) / 100) * 100;
  p.stream = { weekly, untilDay: state.day + months * 30 };
  return { ok: true, text: `${p.ign} 签下直播合同：周收入 ${fmtMoney(weekly)}（选手 60% / 俱乐部 40%），每周占 1 个训练日。` };
}

export function cancelStream(state: GameState, playerId: string): string {
  const p = state.players[playerId] as Player;
  if (!p?.stream) return "无直播合同。";
  p.stream = null;
  return `${p.ign} 的直播合同已终止。`;
}

/** 每周商务刷新：邀约 0-3 条 + 赞助意向 + 商务占用清零（周结算末尾调用） */
export function refreshCommercialWeek(state: GameState, rng: Rng): void {
  const myTeam = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!myTeam) return;
  for (const p of myTeam.roster.map((id) => state.players[id])) {
    if (p) p.commercialDays = 0;
  }
  state.gigOffers = state.gigOffers.filter((g) => state.day - g.day <= 7);
  const gigCount = rng.int(0, 3);
  for (let i = 0; i < gigCount; i++) {
    const pid = rng.pick(myTeam.roster);
    const p = state.players[pid];
    if (!p || p.injuredUntilDay > state.day) continue;
    const brand = rng.pick(["星火运动", "闪电外设", "锐魄饮料", "极风体育", "晨风能源"]);
    state.gigOffers.push({
      id: `GIG${state.day}_${p.id}_${i}`,
      playerId: p.id,
      brand,
      pay: Math.round(rng.range(2_000, 15_000) * (1 + (state.manager?.skills.business ?? 50) * 0.004) / 100) * 100,
      day: state.day,
    });
  }
  const slots = sponsorSlotsFor(myTeam.reputation);
  if (myTeam.sponsors.length < slots && rng.chance(0.5)) {
    refreshSponsorOffers(state, rng);
  }
}