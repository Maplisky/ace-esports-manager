/**
 * 种子化世界生成器（GDD §4.4 / §13 v0.1）：
 * 1 赛区 18 队（一级 10 + 次级 8），每队 7 人（5 首发 + 2 替补），~160 人。
 * Schema 与调研导出的原作数据同构（research/extracted/world_players.json 为模板）。
 */
import { Rng, clamp } from "./rng.ts";
import { AGENTS, primaryDuty } from "./data/agents.ts";
import { MAPS } from "./data/maps.ts";
import type { GameState, Player, PlayerAttrs, Team, DutyVector } from "./types.ts";

const DUTY_KEYS = ["duelist", "initiator", "controller", "sentinel"] as const;
type DutyKey = (typeof DUTY_KEYS)[number];

const FLAT_DUTY: DutyVector = { duelist: 0.25, initiator: 0.25, controller: 0.25, sentinel: 0.25 };

/** 首发位置模板：决斗/先锋/控场/哨卫 + 1 自由位（随机第二职责） */
const STARTER_TEMPLATE: DutyKey[] = ["duelist", "initiator", "controller", "sentinel"];

const IGN_A = [
  "Nova", "Zen", "Kaze", "Rui", "Lin", "WolF", "Mist", "Void", "Tide", "Yu",
  "Ren", "Kite", "Frost", "Blaze", "Echo", "Drift", "Nora", "Skye", "Ash", "Rain",
  "Halo", "Vex", "Polar", "Sora", "Kuro", "Yuki", "Hana", "Rei", "Taro", "Juno",
];
const IGN_B = ["", "", "", "1", "2", "X", "Z", "7", "9", "ee", "ie", "ao", "in", "er", "0"];

const T1_NAMES: [string, string][] = [
  ["天穹电竞", "TQ"], ["白泽电竞", "BZ"], ["烛龙电竞", "ZL"], ["玄鲲电竞", "XK"],
  ["星阑电竞", "XL"], ["潮汐电竞", "CX"], ["破晓电竞", "PX"], ["凌云电竞", "LY"],
  ["赤霄电竞", "CJ"], ["岚山电竞", "LS"],
];
const T2_NAMES: [string, string][] = [
  ["野草电竞", "YC"], ["屿风电竞", "YF"], ["拾光电竞", "SG"], ["白鸽电竞", "BG"],
  ["麦浪电竞", "ML"], ["夜航电竞", "YH"], ["青苔电竞", "QT"], ["飞鸟电竞", "FN"],
];

const COACH_NAMES = ["老K", "阿澈", "白熊", "萧然", "陆离", "顾行", "苏木", "陈野", "洛尘", "祁风", "温叙", "关山"];

/** 八维合成 overall 的权重（GDD §6.1：合成可读且分工明确） */
const OVERALL_W: Record<keyof PlayerAttrs, number> = {
  aim: 0.18, reaction: 0.14, awareness: 0.13, utility: 0.13,
  clutch: 0.12, teamwork: 0.10, communication: 0.10, igl: 0.10,
};

export function computeOverall(attrs: PlayerAttrs): number {
  let v = 0;
  for (const k of Object.keys(OVERALL_W) as (keyof PlayerAttrs)[]) {
    v += attrs[k] * OVERALL_W[k];
  }
  return Math.round(v);
}

/** 职责 → 属性倾斜（决斗吃枪法反应，哨卫吃意识协同…） */
const DUTY_ATTR_TILT: Record<DutyKey, Partial<Record<keyof PlayerAttrs, number>>> = {
  duelist: { aim: 8, reaction: 6, clutch: 3, awareness: -3, utility: -4, teamwork: -3 },
  initiator: { utility: 6, awareness: 5, communication: 4, aim: -3 },
  controller: { utility: 7, awareness: 5, teamwork: 4, reaction: -4, clutch: -3 },
  sentinel: { awareness: 7, teamwork: 4, utility: 3, reaction: -3, aim: -2 },
};

function generateAttrs(rng: Rng, target: number, duty: DutyKey, isIgl: boolean): PlayerAttrs {
  const tilt = DUTY_ATTR_TILT[duty];
  const attrs = {} as PlayerAttrs;
  for (const k of Object.keys(OVERALL_W) as (keyof PlayerAttrs)[]) {
    const t = tilt[k] ?? 0;
    attrs[k] = clamp(rng.clampNorm(target + t, 5, 30, 99), 30, 99);
  }
  if (isIgl) attrs.igl = clamp(attrs.igl + 12, 30, 99);
  const actual = computeOverall(attrs);
  // 线性微调让 overall 落在目标附近
  const diff = target - actual;
  for (const k of Object.keys(OVERALL_W) as (keyof PlayerAttrs)[]) {
    attrs[k] = clamp(attrs[k] + diff, 30, 99);
  }
  return attrs;
}

/** 薪资曲线：overall 67 ≈ $21K/季，78 ≈ $171K/季（调参表可调；base 已是美元，勿再放大） */
export function salaryFor(overall: number, tier: 1 | 2): number {
  const base = 0.06 * Math.pow(1.21, overall);
  const scaled = base * (tier === 1 ? 1 : 0.45);
  return Math.round(scaled / 1000) * 1000;
}

let playerIdSeq = 0;

/** 测试辅助：重置全局玩家 ID 序列（保证两次生成完全一致） */
export function resetPlayerSeq(): void {
  playerIdSeq = 0;
}

function makePlayer(
  rng: Rng,
  teamId: string | null,
  tier: 1 | 2,
  targetOverall: number,
  duty: DutyKey,
  isIgl: boolean,
  ageRange: [number, number],
  usedIgns: Set<string>,
  homegrown: boolean,
): Player {
  let ign = "";
  do {
    ign = rng.pick(IGN_A) + rng.pick(IGN_B);
  } while (usedIgns.has(ign));
  usedIgns.add(ign);

  const age = rng.int(ageRange[0], ageRange[1]);
  const attrs = generateAttrs(rng, targetOverall, duty, isIgl);
  const overall = computeOverall(attrs);

  // 英雄池：主职责英雄 2-3 名 + 邻近职责 1 名，熟练度 40-90
  const primary = duty;
  const pool: string[] = [];
  const byDuty = (d: DutyKey) => AGENTS.filter((a) => primaryDuty(a.duty) === d);
  const primaryPool = rng.shuffle(byDuty(primary));
  pool.push(...primaryPool.slice(0, rng.int(2, 3)).map((a) => a.id));
  const neighbor = rng.pick(DUTY_KEYS.filter((d) => d !== primary));
  pool.push(rng.pick(byDuty(neighbor)).id);

  const agentPro: Record<string, number> = {};
  for (const a of pool) agentPro[a] = rng.int(45, 90);

  // 潜力：越年轻空间越大
  const growth = age <= 19 ? rng.range(6, 16) : age <= 22 ? rng.range(3, 10) : age <= 25 ? rng.range(0, 5) : 0;
  const potential = clamp(Math.round(overall + growth), overall, 99);

  return {
    id: `P${String(playerIdSeq++).padStart(4, "0")}`,
    ign,
    age,
    teamId,
    attrs,
    overall,
    potential,
    peakOverall: overall,
    form: Math.round(rng.range(60, 80)),
    morale: Math.round(rng.range(60, 85)),
    fatigue: Math.round(rng.range(5, 30)),
    salary: salaryFor(overall, tier),
    contractYears: rng.int(1, 3),
    agentPool: pool,
    agentPro,
    isIgl,
    focus: "rest",
    xp: {},
    listed: false,
    releaseClause: 0,
    noPoach: false,
    promisedRole: "starter",
    injuredUntilDay: 0,
    homegrown,
    benchedWeeks: 0,
    birthdayDay: rng.int(1, 340),
    lastEventDay: 0,
    career: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, mvps: 0, titles: 0, clubs: teamId ? [teamId] : [] },
  };
}

function makeTeam(rng: Rng, id: string, name: string, tag: string, tier: 1 | 2, players: Player[], usedIgns: Set<string>): Team {
  const baseMean = tier === 1 ? 74 : 66.5;
  const sd = tier === 1 ? 5.5 : 4.5;
  const roster: string[] = [];
  let iglAssigned = false;

  // 5 首发：4 个固定职责 + 1 自由位
  const flexDuty = rng.pick(DUTY_KEYS);
  const starterDuties: DutyKey[] = [...STARTER_TEMPLATE, flexDuty];
  for (const duty of starterDuties) {
    const target = clamp(rng.clampNorm(baseMean + (tier === 1 ? 2 : 0), sd, 55, 92), 55, 92);
    const isIgl = !iglAssigned && duty === "controller" ? true : false;
    const p = makePlayer(rng, id, tier, target, duty, isIgl, [tier === 1 ? 18 : 17, 31], usedIgns, false);
    if (isIgl) iglAssigned = true;
    players.push(p);
    roster.push(p.id);
  }
  // 兜底：确保每队有 IGL
  if (!iglAssigned) {
    const first = players[players.length - 5] as Player;
    first.isIgl = true;
    first.attrs.igl = clamp(first.attrs.igl + 10, 30, 99);
    first.overall = computeOverall(first.attrs);
  }
  // 2 替补：1 名年轻潜力（接班人/学习型替补候选），1 名老将
  const youngTarget = clamp(baseMean - rng.range(2, 6), 55, 80);
  const young = makePlayer(rng, id, tier, youngTarget, rng.pick(DUTY_KEYS), false, [17, 19], usedIgns, false);
  young.potential = clamp(young.overall + rng.range(8, 18), young.overall, 99);
  players.push(young);
  roster.push(young.id);
  const vet = makePlayer(rng, id, tier, clamp(baseMean - rng.range(0, 4), 55, 84), rng.pick(DUTY_KEYS), false, [28, 33], usedIgns, false);
  players.push(vet);
  roster.push(vet.id);

  const starters = roster.slice(0, 5);
  for (const pid of roster) {
    const p = players.find((x) => x.id === pid) as Player;
    p.promisedRole = starters.includes(pid) ? (p.overall >= baseMean + 4 ? "core" : "starter") : "rotation";
  }

  const mapPref: Record<string, number> = {};
  for (const m of MAPS) mapPref[m.id] = Math.round(clamp(rng.clampNorm(52, 12, 20, 85), 20, 85));

  const personalities: Team["personality"][] = ["spender", "youth", "steady", "wheeler"];
  return {
    id,
    name,
    tag,
    tier,
    roster,
    starters,
    coach: {
      name: rng.pick(COACH_NAMES),
      tactics: Math.round(rng.clampNorm(tier === 1 ? 64 : 56, 8, 35, 90)),
      development: Math.round(rng.clampNorm(tier === 1 ? 62 : 58, 8, 35, 90)),
      motivation: Math.round(rng.clampNorm(tier === 1 ? 63 : 57, 8, 35, 90)),
    },
    facilities: tier === 1 ? rng.int(60, 85) : rng.int(40, 60),
    budget: tier === 1 ? rng.int(3_000_000, 8_000_000) : rng.int(300_000, 900_000),
    reputation: tier === 1 ? rng.int(50, 80) : rng.int(30, 50),
    personality: rng.pick(personalities),
    mapPref,
    bond: rng.int(45, 65),
    presets: {},
  };
}

/** 生成 v0.1 世界：1 赛区 18 队（一级 10 + 次级 8） */
export function generateWorld(seed: number): GameState {
  const rng = new Rng(seed);
  const players: Player[] = [];
  const teams: Record<string, Team> = {};
  const usedIgns = new Set<string>();

  T1_NAMES.forEach(([name, tag], i) => {
    teams[`T${i}`] = makeTeam(rng, `T${i}`, name, tag, 1, players, usedIgns);
  });
  T2_NAMES.forEach(([name, tag], i) => {
    teams[`C${i}`] = makeTeam(rng, `C${i}`, name, tag, 2, players, usedIgns);
  });

  const playerMap: Record<string, Player> = {};
  for (const p of players) playerMap[p.id] = p;

  // 自由市场：14 名自由人（紧急补位 + AI 签约 + 玩家捡漏）
  for (let i = 0; i < 14; i++) {
    const target = rng.int(60, 78);
    const fa = makePlayer(rng, null, 1, target, rng.pick(DUTY_KEYS), false, [18, 30], usedIgns, false);
    fa.promisedRole = "bench";
    players.push(fa);
    playerMap[fa.id] = fa;
  }

  const state: GameState = {
    seed,
    year: 2026,
    day: 1,
    stage: "preseason",
    myTeamId: null,
    teams,
    players: playerMap,
    fixtures: [],
    comps: {},
    news: [],
    pendingEvents: [],
    lastEventDay: 0,
    transferFeed: [],
    incomingBids: [],
    manager: {
      name: "经理",
      reputation: 40,
      skills: { training: 50, negotiation: 50, tactics: 50, scouting: 50, medical: 50, business: 50, locker: 50, youth: 50 },
    },
    boardConfidence: 62,
    objective: null,
    actionPoints: 3,
    inbox: [],
    schedules: {},
    teamSchedule: ["map", "map", "review", "scrim", "individual", "individual", "rest"],
    trainingMaps: ["jingjie", "xueyuan"],
  };
  return state;
}

/** 生成自由人并入 state（迁移补池 / 休赛期补强共用；GDD §6.5） */
export function spawnFreeAgents(state: GameState, rng: Rng, count: number): void {
  const usedIgns = new Set(Object.values(state.players).map((p) => p.ign));
  for (let i = 0; i < count; i++) {
    const target = rng.int(60, 78);
    const fa = makePlayer(rng, null, 1, target, rng.pick(DUTY_KEYS), false, [18, 30], usedIgns, false);
    fa.promisedRole = "bench";
    state.players[fa.id] = fa;
  }
}

/** 供测试：直接构造指定 overall 均值的队伍（平衡性基准用） */
export function makeSyntheticTeam(id: string, tag: string, targetOverall: number, rng: Rng): { team: Team; players: Player[] } {
  const players: Player[] = [];
  const roster: string[] = [];
  const duties: DutyKey[] = ["duelist", "initiator", "controller", "sentinel", rng.pick(DUTY_KEYS)];
  for (const duty of duties) {
    const p = makePlayer(rng, id, 1, targetOverall, duty, duty === "controller", [22, 27], new Set<string>(), false);
    players.push(p);
    roster.push(p.id);
  }
  const mapPref: Record<string, number> = {};
  for (const m of MAPS) mapPref[m.id] = 50;
  const team: Team = {
    id, name: tag, tag, tier: 1, roster, starters: roster.slice(),
    coach: { name: "测试教练", tactics: 60, development: 60, motivation: 60 },
    facilities: 60, budget: 5_000_000, reputation: 60,
    personality: "steady", mapPref, bond: 50, presets: {},
  };
  return { team, players };
}
