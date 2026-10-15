/**
 * 种子挑战赛（GDD §11.5 v2.5，零服务端模拟的轻竞技）：
 * 官方以静态 JSON 发挑战包（固定 seed + 开局约束 + 赛季数 + 计分目标）；
 * 玩家本地确定性跑同一世界，成绩 = challengeReport 摘要 + 任意一场回放链接为凭证（§9.4）。
 * 服务端只做「发种子、收成绩」——本模块纯本地、零 RNG。
 */
import type { GameState } from "../types.ts";

export interface ChallengeConstraints {
  origin?: "legend" | "grassroots" | "analyst";
  difficulty?: "normal" | "hard" | "pro";
  /** 限定俱乐部档位（1=VCT 合作队 / 2=挑战者） */
  tier?: 1 | 2;
  /** 全队年龄上限（如 U22 挑战） */
  maxAge?: number;
}

export interface Challenge {
  id: string;
  name: string;
  desc: string;
  seed: number;
  seasons: number;
  goal: "titles" | "circuit";
  constraints: ChallengeConstraints;
}

/** 解析并校验挑战包 JSON（静态下发；坏包返回 null——UI 显示加载失败） */
export function loadChallengePack(raw: unknown): Challenge | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.name !== "string" || typeof c.seed !== "number" || !Number.isInteger(c.seed)) return null;
  if (c.goal !== "titles" && c.goal !== "circuit") return null;
  const seasons = typeof c.seasons === "number" && c.seasons >= 1 && c.seasons <= 10 ? Math.floor(c.seasons) : 1;
  const cons = (c.constraints ?? {}) as Record<string, unknown>;
  const constraints: ChallengeConstraints = {};
  if (cons.origin === "legend" || cons.origin === "grassroots" || cons.origin === "analyst") constraints.origin = cons.origin;
  if (cons.difficulty === "normal" || cons.difficulty === "hard" || cons.difficulty === "pro") constraints.difficulty = cons.difficulty;
  if (cons.tier === 1 || cons.tier === 2) constraints.tier = cons.tier;
  if (typeof cons.maxAge === "number") constraints.maxAge = Math.floor(cons.maxAge);
  return { id: c.id, name: c.name, desc: typeof c.desc === "string" ? c.desc : "", seed: c.seed, seasons, goal: c.goal, constraints };
}

/** 开局约束校验：返回违规说明（null = 合规）。种子相等是硬条件。 */
export function validateChallengeStart(state: GameState, ch: Challenge): string | null {
  if (state.seed !== ch.seed) return `种子不符（需 ${ch.seed}）`;
  const my = state.myTeamId ? state.teams[state.myTeamId] : null;
  if (!my) return "未选队";
  if (ch.constraints.tier != null && my.tier !== ch.constraints.tier) return `俱乐部档位不符（需 ${ch.constraints.tier === 2 ? "挑战者" : "VCT 合作队"}）`;
  const c = state.manager.career;
  if (ch.constraints.origin && c?.origin !== ch.constraints.origin) return `出身不符（需 ${{ legend: "前豪门名宿", grassroots: "次级联赛草根", analyst: "数据分析师出身" }[ch.constraints.origin]}）`;
  if (ch.constraints.difficulty && state.difficulty !== ch.constraints.difficulty) return `难度不符（需 ${{ normal: "普通", hard: "困难", pro: "职业" }[ch.constraints.difficulty]}）`;
  if (ch.constraints.maxAge != null) {
    const over = my.roster.map((pid) => state.players[pid]).some((p) => p && p.age > ch.constraints.maxAge!);
    if (over) return `阵容年龄超限（需全员 ≤${ch.constraints.maxAge} 岁——当前名单含超龄者，请换队）`;
  }
  return null;
}

export interface ChallengeScore {
  goal: Challenge["goal"];
  /** titles：生涯冠军数 / circuit：当前冠军积分合计 */
  value: number;
  seasonsPlayed: number;
  qualified: boolean;
}

/** 成绩演算（确定性纯派生）：按目标计分；赛季数达标即 qualified */
export function challengeScore(state: GameState, ch: Challenge): ChallengeScore {
  const c = state.manager.career;
  const seasonsPlayed = c?.seasons ?? 1;
  const value = ch.goal === "titles" ? (c?.titles ?? 0) : (state.circuitPoints?.[state.myTeamId ?? ""] ?? 0);
  return { goal: ch.goal, value, seasonsPlayed, qualified: seasonsPlayed >= ch.seasons };
}

/** 成绩摘要（玩家提交的文本凭证；回放链接由分享面板另行生成附上） */
export function challengeReport(state: GameState, ch: Challenge): string {
  const s = challengeScore(state, ch);
  const my = state.myTeamId ? state.teams[state.myTeamId] : null;
  const goalName = ch.goal === "titles" ? "冠军数" : "冠军积分";
  return `【种子挑战赛 ${ch.id}·${ch.name}】${my?.name ?? "?"}｜${goalName} ${s.value}｜已赛 ${s.seasonsPlayed}/${ch.seasons} 赛季${s.qualified ? "（完赛）" : ""}｜种子 ${ch.seed}。成绩以回放链接为凭证。`;
}
