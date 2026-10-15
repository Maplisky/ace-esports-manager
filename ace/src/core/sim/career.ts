/**
 * 经理人生涯（GDD §9.5，v1.0-6）：出身 3 选 1 / 下课（信任警告→连败/谷底）/
 * 跳槽申请（声望+荣誉+门下弟子加成）/ 五年之约与第 10 年强制退休 / 名人堂数据源。
 */
import { Rng, clamp } from "../rng.ts";
import type { GameState, NewsItem, PendingEventCard, Team } from "../types.ts";

export const MILESTONE_CARD_ID = "milestone";

/** 出身定义（开档 3 选 1：2 强 1 弱 + 起始资源差异，GDD §9.5） */
export const ORIGINS: { key: "legend" | "grassroots" | "analyst"; label: string; desc: string }[] = [
  { key: "legend", label: "前豪门名宿", desc: "声望 +15、谈判 +5、个人钱包 +$60K——名头好借，期望也高" },
  { key: "grassroots", label: "次级联赛草根", desc: "眼光 +8、俱乐部预算 +$400K——从泥地里爬上来的实干派" },
  { key: "analyst", label: "数据分析师出身", desc: "战术 +5、眼光 +5、声望 -5——更衣室待证明自己" },
];

/** 开档初始化生涯账本并应用出身加成 */
export function initCareer(state: GameState, origin: "legend" | "grassroots" | "analyst"): void {
  const mgr = state.manager;
  mgr.career = { startYear: state.year, seasons: 1, titles: 0, wins: 0, losses: 0, loseStreak: 0, warned: false, origin };
  mgr.skills.negotiation = clamp((mgr.skills.negotiation ?? 50) + (origin === "legend" ? 5 : 0), 10, 90);
  mgr.skills.scouting = clamp((mgr.skills.scouting ?? 50) + (origin === "grassroots" ? 8 : origin === "analyst" ? 5 : 0), 10, 90);
  mgr.skills.tactics = clamp((mgr.skills.tactics ?? 50) + (origin === "analyst" ? 5 : 0), 10, 90);
  mgr.reputation = clamp(mgr.reputation + (origin === "legend" ? 15 : origin === "analyst" ? -5 : 0), 20, 99);
  mgr.life.wallet += origin === "legend" ? 60_000 : 0;
  if (origin === "grassroots" && state.myTeamId) {
    const t = state.teams[state.myTeamId];
    if (t) t.budget += 400_000;
  }
}

/** 我的正式比赛结果入账（advanceDay/playHeldMatch 双路径调用）：胜负/连败/下课判定 */
export function noteMatchResult(state: GameState, won: boolean, notes: NewsItem[]): void {
  const c = state.manager.career;
  if (!c || c.ending) return;
  if (won) {
    c.wins++;
    c.loseStreak = 0;
  } else {
    c.losses++;
    c.loseStreak++;
    if (c.warned && c.loseStreak >= 3) {
      fireManager(state, notes, "警告后三连败");
      return;
    }
  }
}

/** 周结算下课检查（GDD §9.5：信任 ≤20 警告；≤6 直接下课） */
export function careerWeeklyTick(state: GameState, notes: NewsItem[]): void {
  const c = state.manager.career;
  if (!c || c.ending) return;
  const conf = state.boardConfidence;
  if (conf <= 6) {
    fireManager(state, notes, "董事会信心跌至谷底");
    return;
  }
  if (conf <= 20 && !c.warned) {
    c.warned = true;
    notes.push({ day: state.day, kind: "club", important: true, text: "⚠️ 董事会发出最后通牒：再遭连败或将解除主帅职务。" });
  } else if (conf > 45) {
    c.warned = false; // 信任回暖解除警告
  }
}

function fireManager(state: GameState, notes: NewsItem[], reason: string): void {
  const c = state.manager.career!;
  c.ending = { kind: "fired", year: state.year, day: state.day };
  const total = c.wins + c.losses;
  const wr = total > 0 ? ((c.wins / total) * 100).toFixed(1) : "—";
  const teamName = state.myTeamId ? state.teams[state.myTeamId]?.name : "原东家";
  notes.push({
    day: state.day, kind: "club", important: true,
    text: `🔻 下课：${teamName} 解除了 ${state.manager.name} 的主帅职务（${reason}）。任期 ${c.seasons} 赛季，战绩 ${c.wins}胜${c.losses}负（胜率 ${wr}%），冠军 ${c.titles} 座。`,
  });
}

/** 经理冠军计数（联赛/国际赛夺冠时调用；champTeamId 为我队才计）。kind 进分类账本（v1.0-10 大满贯判定） */
export function noteManagerTitle(state: GameState, champTeamId: string, kind?: "league" | "cup" | "masters" | "champions"): void {
  const c = state.manager.career;
  if (c && !c.ending && champTeamId === state.myTeamId) {
    c.titles++;
    if (kind) {
      c.titleKinds ??= {};
      c.titleKinds[kind] = (c.titleKinds[kind] ?? 0) + 1;
    }
  }
}

/** 跳槽目标市场：声望差距 ≤15 的 t1 队（非我队），按声望降序 */
export function jobOffers(state: GameState): Team[] {
  const rep = state.manager.reputation;
  return Object.values(state.teams)
    .filter((t) => t.tier === 1 && t.id !== state.myTeamId && t.reputation <= rep + 15 && t.reputation >= rep - 25)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 8);
}

/** 门下弟子数（跳槽背书加成；成就页数据源）：我队现役 overall ≥75 且属我培养（青训/选秀/接班人） */
export function discipleCount(state: GameState): number {
  if (!state.myTeamId) return 0;
  const my = state.myTeamId;
  return Object.values(state.players).filter(
    (p) => p.teamId === my && p.overall >= 75 && (p.homegrown || p.synthetic === "academy" || p.synthetic === "rookie" || p.track === "successor"),
  ).length;
}

/** 申请执教（GDD §9.5 跳槽公式 + 门下弟子加成）：成功即切换俱乐部 */
export function applyJob(state: GameState, teamId: string, rng: Rng, notes: NewsItem[]): { ok: boolean; text: string } {
  const target = state.teams[teamId];
  if (!target || !state.myTeamId) return { ok: false, text: "目标俱乐部不存在。" };
  const c = state.manager.career;
  if (c?.ending) return { ok: false, text: "已离开教练席。" };
  const rep = state.manager.reputation;
  const chance = clamp(
    0.1 + (rep - target.reputation) * 0.011 + (c?.titles ?? 0) * 0.03 + discipleCount(state) * 0.02 + ((state.manager.skills.negotiation ?? 50) - 50) / 400,
    0.05, 0.9,
  );
  if (rng.chance(chance)) {
    const oldName = state.teams[state.myTeamId]?.name ?? "原东家";
    state.myTeamId = teamId;
    state.manager.reputation = clamp(rep + 2, 20, 99);
    state.boardConfidence = 60;
    state.objective = null;
    if (c) {
      c.warned = false;
      c.jobHops = (c.jobHops ?? 0) + 1; // 雇佣兵线成就数据源（v1.0-10）
    }
    notes.push({
      day: state.day, kind: "club", important: true,
      text: `🤝 ${target.name} 宣布新任主帅：${state.manager.name}（自 ${oldName} 跳槽而来，签约成功）。`,
    });
    return { ok: true, text: `签约成功：欢迎入主 ${target.name}。` };
  }
  state.manager.reputation = clamp(rep - 1, 20, 99);
  notes.push({ day: state.day, kind: "club", text: `📰 ${target.name} 拒绝了 ${state.manager.name} 的执教申请。` });
  return { ok: false, text: `${target.name} 礼貌回绝了你的申请（声望 -1）。` };
}

/** 翻年里程碑（GDD §9.5 五年之约 / 第 10 年强制退休）：在翻年块调用 */
export function checkCareerMilestone(state: GameState, notes: NewsItem[]): void {
  const c = state.manager.career;
  if (!c || c.ending) return;
  c.seasons = state.year - c.startYear + 1;
  if (c.seasons >= 10) {
    c.ending = { kind: "retired", year: state.year, day: state.day };
    notes.push({ day: 1, kind: "club", important: true, text: `🎖 十年执教期满，${state.manager.name} 光荣退休——名人堂为其保留一席。` });
    return;
  }
  if (c.seasons === 5 && !state.pendingEvents.some((e) => e.uid === `milestone-5-${state.year}`)) {
    const card: PendingEventCard = {
      uid: `milestone-5-${state.year}`,
      cardId: MILESTONE_CARD_ID,
      title: "📜 五年之约",
      text: "入主时的五年之约到期。可以选择继续追逐更高的荣誉，或在此刻画上句号、以名人堂身份收官。",
      negative: false,
      day: state.day,
      options: [
        { label: "继续执教（冲刺更多荣誉）", result: "五年之约续期。" },
        { label: "就此收官（名人堂结局）", result: "传奇谢幕。" },
      ],
      payload: { kind: "five-year" },
    };
    state.pendingEvents.push(card);
  }
}

/** 里程碑卡结算：五年之约（收官 → 名人堂结局） */
export function resolveMilestoneCard(state: GameState, card: PendingEventCard, optionIndex: number): { result: string; note: string } {
  const c = state.manager.career;
  if (optionIndex === 1 && c && !c.ending) {
    c.ending = { kind: "hall", year: state.year, day: state.day };
    return { result: `📜 ${state.manager.name} 宣布收官：${c.seasons} 赛季 ${c.titles} 冠，名人堂席位已点亮。`, note: "五年之约收官" };
  }
  return { result: "五年之约续期：故事还在继续。", note: "" };
}
