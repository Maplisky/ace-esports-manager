/**
 * 种子化世界生成器（GDD §4.4 / §13；v0.7 真实数据包）：
 * 四大赛区 64 队（每区 10 VCT + 6 挑战者，数据快照 vlr.gg，见 data/real/real-data.ts）。
 * 选手属性由 vlr.gg 逐英雄统计（rounds 加权）推导；无统计/缺员以青训虚拟生成并标注 synthetic。
 */
import { Rng, clamp, hashString } from "./rng.ts";
import { AGENTS, primaryDuty } from "./data/agents.ts";
import { MAPS } from "./data/maps.ts";
import { REAL_TEAMS, REAL_PLAYERS_BY_VLR, type VlrPlayerStat, type VlrTeamStat } from "./data/real/real-data.ts";
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

/** 青训/自由人名池（按赛区，无 vlr 数据时虚拟生成） */
const SYN_NAMES: Record<string, string[]> = {
  americas: ["Tyler", "Mason", "Diego", "Mateo", "Lucas", "Jayden", "Carlo", "Santi", "Eli", "Marco", "Andre", "Nico"],
  emea: ["Emil", "Jonas", "Maks", "Patrik", "Aleks", "Nikita", "Tomas", "Felix", "Hugo", "Louis", "Piotr", "Sasha"],
  pacific: ["Minjun", "Sungwoo", "Yuki", "Haruto", "Renji", "Jiho", "Kenta", "Minseo", "Takeru", "Dohyun", "Riku", "Junsu"],
  china: ["Xiaoyu", "Chenxi", "Zihan", "Yifan", "Haochen", "Junyi", "Weiming", "Zhiyuan", "Ruoxi", "Tianyi", "Zeming", "Boyu"],
};
const SYN_SUFFIX = ["", "", "X", "7", "2", "ee", "z", "99", "01"];

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

const AGENT_IDS = new Set(AGENTS.map((a) => a.id));

/** 特质推导（v0.8）：真实选手按 vlr 生涯统计特征打标；虚拟选手按职责+随机。0-3 条。 */
function deriveTraits(vlrId: number | null, duty: string, attrs: PlayerAttrs, rng: Rng): string[] {
  const out: string[] = [];
  if (vlrId != null) {
    // 真实选手：按统计特征（fk/fd 比、kd、生存）+ 少量随机
    const p = REAL_PLAYERS_BY_VLR.get(vlrId);
    const w = p ? weightedStats(p) : null;
    if (w) {
      const fkShare = w.fkRate + w.fdRate > 0 ? w.fkRate / (w.fkRate + w.fdRate) : 0.5;
      if (fkShare >= 0.62) out.push("entry");
      if (w.kd >= 1.15 && w.rating >= 1.1) out.push("carry");
      if (fkShare <= 0.38 && w.kd >= 1.0) out.push("survivor");
      if (fkShare <= 0.35) out.push("baiter");
      if (Math.abs(w.kpr - 0.72) < 0.04 && w.kd >= 1.05) out.push("headshot");
      if (w.apr >= 0.3) out.push("enabler");
      if (w.rating >= 1.05 && Math.abs(w.rating - 1.05) < 0.08) out.push("consistent");
    }
  }
  if (out.length === 0) {
    // 虚拟/无统计：职责锚点 + 随机 0-2
    const anchor = { duelist: "entry", initiator: "enabler", controller: "anchor", sentinel: "anchor" }[duty] ?? "anchor";
    if (rng.chance(0.7)) out.push(anchor);
    if (attrs.clutch >= 75 && !out.includes("clutch") && rng.chance(0.5)) out.push("clutch");
    if (attrs.aim >= 80 && !out.includes("carry") && rng.chance(0.4)) out.push("carry");
    if (rng.chance(0.12)) out.push("glass");
    if (rng.chance(0.06) && !out.includes("entry")) out.push("baiter");
  }
  return [...new Set(out)].slice(0, 3);
}

/** 场上位置展示序（决斗→先锋→控场→哨卫；与 UI 分组一致） */
const DUTY_DISPLAY_ORDER = ["duelist", "initiator", "controller", "sentinel"];

/** vlr 逐英雄统计 → rounds 加权综合（只计内部英雄池内的行） */
function weightedStats(vlrP: VlrPlayerStat) {
  let rounds = 0, rating = 0, acs = 0, kd = 0, kast = 0, adr = 0, kpr = 0, apr = 0, fk = 0, fd = 0;
  const byAgent: { agent: string; rounds: number; share: number; rating: number }[] = [];
  for (const s of vlrP.stats) {
    if (!AGENT_IDS.has(s.agent) || s.rounds <= 0) continue;
    rounds += s.rounds;
    rating += s.rating * s.rounds;
    acs += s.acs * s.rounds;
    kd += s.kd * s.rounds;
    kast += s.kast * s.rounds;
    adr += s.adr * s.rounds;
    kpr += s.kpr * s.rounds;
    apr += s.apr * s.rounds;
    fk += s.fk;
    fd += s.fd;
    byAgent.push({ agent: s.agent, rounds: s.rounds, share: 0, rating: s.rating });
  }
  if (rounds === 0) return null;
  for (const a of byAgent) a.share = a.rounds / rounds;
  return {
    rating: rating / rounds, acs: acs / rounds, kd: kd / rounds, kast: kast / rounds,
    adr: adr / rounds, kpr: kpr / rounds, apr: apr / rounds,
    fkRate: rounds > 0 ? fk / rounds : 0, fdRate: rounds > 0 ? fd / rounds : 0,
    byAgent: byAgent.sort((a, b) => b.rounds - a.rounds),
  };
}

const linmap = (v: number, inMin: number, inMax: number, outMin: number, outMax: number): number =>
  clamp(outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin), 35, 95);

/** 真实选手属性推导：vlr 指标 → 八维（口径见 README"真实数据包"节） */
function attrsFromVlr(w: NonNullable<ReturnType<typeof weightedStats>>, duty: DutyKey, isIgl: boolean): PlayerAttrs {
  const fkShare = w.fkRate + w.fdRate > 0 ? w.fkRate / (w.fkRate + w.fdRate) : 0.5;
  const attrs: PlayerAttrs = {
    aim: linmap(w.acs, 145, 245, 60, 96),
    reaction: linmap(w.kd, 0.80, 1.26, 60, 94),
    awareness: linmap(w.kast, 61, 78, 60, 86) + fkShare * 6,
    utility: linmap(w.apr, 0.05, 0.36, 56, 92),
    clutch: clamp(66 + (w.rating - 1.0) * 60 + (w.kd - 1.0) * 20, 55, 96),
    teamwork: linmap(w.kast * 0.7 + w.apr * 60, 55, 85, 62, 90),
    communication: 65 + fkShare * 5,
    igl: isIgl ? 76 : 48,
  };
  // 职责微倾斜保留（真实数据只是均值，分工倾向仍成立）
  const tilt = DUTY_ATTR_TILT[duty];
  for (const k of Object.keys(attrs) as (keyof PlayerAttrs)[]) {
    attrs[k] = clamp(attrs[k] + (tilt[k] ?? 0) * 0.4, 35, 95);
  }
  if (isIgl) attrs.igl = clamp(attrs.igl + 8, 35, 95);
  return attrs;
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
  opts?: { ign?: string; synthetic?: "academy" | "free" | "rookie"; realName?: string; country?: string; avatar?: string; age?: number },
): Player {
  let ign = opts?.ign ?? "";
  if (ign) {
    while (usedIgns.has(ign)) ign = ign + rng.pick(SYN_SUFFIX);
  } else {
    do {
      ign = rng.pick(IGN_A) + rng.pick(IGN_B);
    } while (usedIgns.has(ign));
  }
  usedIgns.add(ign);

  const age = opts?.age ?? rng.int(ageRange[0], ageRange[1]);
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
    realName: opts?.realName,
    country: opts?.country,
    avatar: opts?.avatar,
    synthetic: opts?.synthetic,
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
    commercialDays: 0,
    stream: null,
    listed: false,
    releaseClause: rng.chance(0.06) ? Math.round(salaryFor(overall, tier) * 14 / 1000) * 1000 : 0,
    noPoach: false,
    traits: deriveTraits(null, duty, attrs, rng),
    promisedRole: "starter",
    injuredUntilDay: 0,
    homegrown,
    benchedWeeks: 0,
    birthdayDay: rng.int(1, 365),
    lastEventDay: 0,
    career: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, mvps: 0, titles: 0, clubs: teamId ? [teamId] : [] },
  };
}

/** 真实选手：id = R{vlrId}；属性从 vlr 统计推导，无统计按队档基线虚拟生成（保留真实姓名/头像） */
function makeRealPlayer(rng: Rng, vlrP: VlrPlayerStat, teamId: string, tier: 1 | 2, forceIgl: boolean): Player {
  const w = weightedStats(vlrP);
  const mainAgent = w ? AGENTS.find((a) => a.id === w.byAgent[0]!.agent) : undefined;
  const usedDuty = (mainAgent ? primaryDuty(mainAgent.duty) : rng.pick(DUTY_KEYS)) as DutyKey;
  const isIgl = forceIgl || (vlrP.captain && rng.chance(0.85)); // 队长 ≈ IGL（近似口径）

  let attrs: PlayerAttrs;
  let agentPool: string[];
  let agentPro: Record<string, number>;
  if (w) {
    attrs = attrsFromVlr(w, usedDuty, isIgl);
    const dutyRank = (agentId: string) => {
      const a = AGENTS.find((x) => x.id === agentId);
      if (!a) return 9;
      let best = 9;
      let bv = -1;
      for (const [k, v] of Object.entries(a.duty)) {
        if ((v as number) > bv) { bv = v as number; best = DUTY_DISPLAY_ORDER.indexOf(k); }
      }
      return best;
    };
    agentPool = w.byAgent
      .slice(0, 5)
      .map((a) => a.agent)
      .sort((x, y) => dutyRank(x) - dutyRank(y));
    agentPro = {};
    // 初始熟练度 = vlr 使用占比 + 效率评分加权（48 + 55×占比 + 22×(评分−1)，clamp 45-95）
    for (const a of w.byAgent.slice(0, 5)) agentPro[a.agent] = clamp(48 + a.share * 55 + (a.rating - 1) * 22, 45, 95);
  } else {
    const target = tier === 1 ? 71 : 63;
    attrs = generateAttrs(rng, target + rng.int(-4, 4), usedDuty, isIgl);
    const pool: string[] = [];
    const byDuty = (d: DutyKey) => AGENTS.filter((a) => primaryDuty(a.duty) === d);
    pool.push(...rng.shuffle(byDuty(usedDuty)).slice(0, 3).map((a) => a.id));
    agentPool = pool;
    agentPro = {};
    for (const a of pool) agentPro[a] = rng.int(50, 85);
  }
  if (agentPool.length < 3) {
    const extra = rng.shuffle(AGENTS.filter((a) => primaryDuty(a.duty) === usedDuty && !agentPool.includes(a.id))).slice(0, 3 - agentPool.length);
    for (const a of extra) {
      agentPool.push(a.id);
      agentPro[a.id] = rng.int(45, 60); // 补位英雄给保底熟练（否则 familiarity 口径不一致）
    }
  }

  // 年龄：vlr 无生日字段 → 按 hash 确定性合成 19-29（README 口径）
  let h = vlrP.vlrId ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  const age = 19 + (h % 11);
  const overall = computeOverall(attrs);
  const growth = age <= 19 ? rng.range(6, 14) : age <= 22 ? rng.range(3, 9) : age <= 25 ? rng.range(0, 5) : 0;
  // 解约金（GDD §8.2 用户需求完善）：明星 25% / 普通 8%，额度 ≈ 身价 ×1.5（salaryFor 同族曲线以美元计）
  const releaseOdds = overall >= 80 ? 0.25 : 0.08;
  const releaseClause = rng.chance(releaseOdds) ? Math.round(salaryFor(overall, tier) * 18 / 1000) * 1000 : 0;

  return {
    id: `R${vlrP.vlrId}`,
    ign: vlrP.alias,
    realName: vlrP.real || undefined,
    country: vlrP.country || undefined,
    avatar: vlrP.avatar ?? undefined,
    age,
    teamId,
    attrs,
    overall,
    potential: clamp(Math.round(overall + growth), overall, 99),
    peakOverall: overall,
    form: Math.round(rng.range(60, 80)),
    morale: Math.round(rng.range(60, 85)),
    fatigue: Math.round(rng.range(5, 30)),
    salary: salaryFor(overall, tier),
    contractYears: rng.int(1, 3),
    agentPool,
    agentPro,
    isIgl,
    focus: "rest",
    xp: {},
    commercialDays: 0,
    stream: null,
    listed: false,
    releaseClause,
    noPoach: false,
    traits: deriveTraits(vlrP.vlrId, usedDuty, attrs, rng),
    promisedRole: "starter",
    injuredUntilDay: 0,
    homegrown: false,
    benchedWeeks: 0,
    birthdayDay: rng.int(1, 365),
    lastEventDay: 0,
    career: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, mvps: 0, titles: 0, clubs: [teamId] },
  };
}

/** tier = vlr.gg 合作队身份（铁证判定见爬虫），挑战者为次级 */
function teamTierOf(partnered: boolean): 1 | 2 {
  return partnered ? 1 : 2;
}

function makeTeamSkeleton(rng: Rng, id: string, name: string, tag: string, tier: 1 | 2, regionId: string): Team {
  const mapPref: Record<string, number> = {};
  for (const m of MAPS) mapPref[m.id] = rng.int(45, 75);
  const personalities: Team["personality"][] = ["spender", "youth", "steady", "wheeler"];
  return {
    id,
    name,
    tag,
    tier,
    regionId,
    roster: [],
    starters: [],
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
    sponsors: [],
    staff: {
      training: { name: rng.pick(COACH_NAMES) + "（训练）", value: clamp(Math.round(rng.clampNorm(tier === 1 ? 58 : 50, 12, 20, 90)), 20, 90) },
      mapTactics: { name: rng.pick(COACH_NAMES) + "（战术）", value: clamp(Math.round(rng.clampNorm(tier === 1 ? 60 : 52, 12, 20, 90)), 20, 90) },
      match: { name: rng.pick(COACH_NAMES) + "（比赛）", value: clamp(Math.round(rng.clampNorm(tier === 1 ? 58 : 50, 12, 20, 90)), 20, 90) },
    },
    academy: [],
    patternUsage: {},
    mapPref,
    bond: rng.int(45, 65),
    presets: {},
  };
}

/** 生成 v0.7 世界：四大赛区 64 队（真实数据快照），每队 ≤7 真实 roster + 青训补位 */
export function generateWorld(seed: number): GameState {
  const rng = new Rng(seed);
  const players: Player[] = [];
  const teams: Record<string, Team> = {};
  const usedIgns = new Set<string>();

  // 赛区内按 rank 排序：前 10 为 VCT（tier1），其余挑战者（tier2）
  const byRegion = new Map<string, VlrTeamStat[]>();
  for (const t of REAL_TEAMS) {
    const arr = byRegion.get(t.region) ?? [];
    arr.push(t);
    byRegion.set(t.region, arr);
  }
  for (const [region, list] of byRegion) {
    const sorted = [...list].sort((a, b) => a.rank - b.rank);
    sorted.forEach((vt, i) => {
      const tier = teamTierOf(vt.partnered);
      const id = `${tier === 1 ? "T" : "C"}${vt.vlrId}`;
      // 基础队伍骨架（coach/staff/预算等仍随机生成，锚定 tier）
      const skeleton = makeTeamSkeleton(rng, id, vt.name, vt.tag, tier, region);
      // 真实 roster 覆盖：属性从 vlr 推导
      const realRoster: string[] = [];
      let iglSet = false;
      for (const vlrId of vt.roster) {
        const vlrP = REAL_PLAYERS_BY_VLR.get(vlrId);
        if (!vlrP) continue;
        const p = makeRealPlayer(rng, vlrP, id, tier, false);
        if (!iglSet && p.isIgl) iglSet = true;
        players.push(p);
        realRoster.push(p.id);
        usedIgns.add(p.ign);
      }
      // 青训补位到 7（synthetic 标注；vlr 无该选手数据）
      while (realRoster.length < 7) {
        const duty = STARTER_TEMPLATE[realRoster.length % 4];
        const target = tier === 1 ? 64 : 58;
        const ap = makePlayer(rng, id, tier, target + rng.int(-3, 3), duty, false, [17, 21], usedIgns, true, {
          ign: rng.pick(SYN_NAMES[region] ?? SYN_NAMES.china!) + rng.pick(SYN_SUFFIX),
          synthetic: "academy",
          age: rng.int(17, 20),
        });
        ap.promisedRole = "bench";
        players.push(ap);
        realRoster.push(ap.id);
      }
      // IGL 保证恰 1（在青训补位后对最终名单执行：空 roster 队靠补位后转正）
      {
        const finalPlayers = realRoster.map((pid) => players.find((x) => x.id === pid)!).filter(Boolean);
        if (finalPlayers.length > 0 && !finalPlayers.some((p) => p.isIgl)) {
          const top = [...finalPlayers].sort((a, b) => b.overall - a.overall)[0]!;
          top.isIgl = true;
          top.attrs.igl = clamp(top.attrs.igl + 22, 35, 95);
          top.overall = computeOverall(top.attrs);
        }
      }
      // 替补超编（roster>7，vlr 偶有 8 人名单）：裁到 7，被裁者进自由池
      while (realRoster.length > 7) {
        const cut = realRoster.pop()!;
        const cp = players.find((x) => x.id === cut)!;
        cp.teamId = null;
        cp.promisedRole = "bench";
      }
      // 青训营（v0.9）：每队初始 2 名 ≤18 岁学员（不占一线名单，训练 ×1.5）
      for (let ai = 0; ai < 2; ai++) {
        const duty = STARTER_TEMPLATE[(realRoster.length + ai) % 4];
        const ap = makePlayer(rng, id, tier, tier === 1 ? 58 : 52, duty, false, [16, 18], usedIgns, true, {
          ign: rng.pick(SYN_NAMES[region] ?? SYN_NAMES.china!) + rng.pick(SYN_SUFFIX),
          synthetic: "academy",
          age: rng.int(16, 18),
        });
        ap.promisedRole = "bench";
        players.push(ap);
        skeleton.academy.push(ap.id);
      }
      skeleton.roster = realRoster;
      skeleton.starters = realRoster.slice(0, 5); // vlr roster 顺序即首发优先
      if (vt.coach) skeleton.coach.name = vt.coach.alias;
      const roleSlot: (keyof NonNullable<Team["staff"]>)[] = ["training", "mapTactics", "match"];
      vt.staff.slice(0, 3).forEach((st, si) => {
        const slot = skeleton.staff[roleSlot[si]!];
        if (slot) slot.name = st.alias;
      });
      skeleton.vlrId = vt.vlrId;
      skeleton.logo = vt.logo ?? undefined;
      skeleton.reputation = clamp(Math.round((tier === 1 ? 50 : 30) + (16 - Math.min(i, 15)) * 2 + rng.int(0, 8)), 25, 90);
      teams[id] = skeleton;
    });
  }

  const playerMap: Record<string, Player> = {};
  for (const p of players) playerMap[p.id] = p;

  // 自由市场：按队伍规模等比 + 超编裁出的真实选手（synthetic:"free" 标注虚拟生成部分）
  const faCount = Math.round((Object.keys(teams).length / 18) * 14);
  for (let i = 0; i < faCount; i++) {
    const target = rng.int(60, 78);
    const fa = makePlayer(rng, null, 1, target, rng.pick(DUTY_KEYS), false, [18, 30], usedIgns, false, { synthetic: "free" });
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
    scouting: {},
    transferFeed: [],
    incomingBids: [],
    sponsorOffers: [],
    gigOffers: [],
    finances: { log: [] },
    rotationWaive: [],
    rotationTalks: { week: 0, used: 0 },
    agentTraining: {},
    inquiries: [],
    patchNotes: [],    manager: {
      name: "经理",
      reputation: 40,
      skills: { training: 50, negotiation: 50, tactics: 50, scouting: 50, medical: 50, business: 50, locker: 50, youth: 50 },
      life: { wallet: 2000, hunger: 80, mood: 70 },
    },
    boardConfidence: 62,
    objective: null,
    actionPoints: 3,
    inbox: [],
    schedules: {},
    teamSchedule: ["map", "map", "review", "scrim", "individual", "individual", "rest"],
    trainingMaps: ["ascent", "split"],
  };
  // 开局赞助：每队 2 档随机地方赞助（v0.5-4 商务系统）
  for (const t of Object.values(teams)) {
    t.sponsors = [0, 1].map((k) => ({
      id: `SP0_${t.id}_${k}`,
      name: ["晨光乳业", "飞毛腿快递", "街角咖啡", "雷霆文具"][rng.int(0, 3)],
      tier: 1 as const,
      perSeason: Math.round(rng.range(80_000, 150_000) / 1000) * 1000,
      years: rng.int(1, 2),
      signedYear: 2026,
    }));
  }
    // 野心（v1.0 退役检定输入）：35-85 确定性分布
  for (const p of Object.values(state.players)) p.ambition ??= 35 + (hashString(p.id) % 51);
  return state;
}

/** v0.7 旧档虚构地图 id → 真实图池（训练图/图池熟练/招牌计数/预案/mapLock/agentLock；worker migrate 调用，core 可测） */
export function migrateMapsToRealPool(state: GameState): void {
  const validMap = new Set(MAPS.map((m) => m.id));
  const legacyMap: Record<string, string> = { jingjie: "ascent", xiajing: "haven", panyan: "icebox", yugang: "bind", xueyuan: "split", kongting: "lotus", fenlu: "sunset" };
  const remap = (id: string) => (validMap.has(id) ? id : legacyMap[id] ?? "ascent");
  if (state.trainingMaps.some((m) => !validMap.has(m))) {
    state.trainingMaps = [...new Set(state.trainingMaps.map(remap))].slice(0, 3);
  }
  for (const t of Object.values(state.teams)) {
    for (const oldId of Object.keys(t.mapPref)) {
      if (!validMap.has(oldId)) {
        const n = remap(oldId);
        t.mapPref[n] = Math.max(t.mapPref[n] ?? 50, t.mapPref[oldId] ?? 50);
        delete t.mapPref[oldId];
      }
    }
    for (const oldId of Object.keys(t.patternUsage)) {
      if (!validMap.has(oldId)) {
        t.patternUsage[remap(oldId)] = (t.patternUsage[remap(oldId)] ?? 0) + (t.patternUsage[oldId] ?? 0);
        delete t.patternUsage[oldId];
      }
    }
    for (const oldId of Object.keys(t.presets)) {
      if (!validMap.has(oldId)) {
        if (!t.presets[remap(oldId)]) t.presets[remap(oldId)] = t.presets[oldId]!;
        delete t.presets[oldId];
      }
    }
  }
  for (const f of state.fixtures) {
    if (f.mapLock?.some((m) => !validMap.has(m))) f.mapLock = f.mapLock.map(remap);
    if (f.agentLock) {
      for (const oldId of Object.keys(f.agentLock)) {
        if (!validMap.has(oldId)) {
          if (!f.agentLock[remap(oldId)]) f.agentLock[remap(oldId)] = f.agentLock[oldId]!;
          delete f.agentLock[oldId];
        }
      }
    }
  }
}

/** 生成自由人并入 state（迁移补池 / 休赛期补强共用；GDD §6.5） */
export function spawnFreeAgents(state: GameState, rng: Rng, count: number): void {
  const usedIgns = new Set(Object.values(state.players).map((p) => p.ign));
  for (let i = 0; i < count; i++) {
    const target = rng.int(60, 78);
    const fa = makePlayer(rng, null, 1, target, rng.pick(DUTY_KEYS), false, [18, 30], usedIgns, false, { synthetic: "free" });
    fa.promisedRole = "bench";
    state.players[fa.id] = fa;
  }
}

/**
 * 生成选秀新秀池（GDD §18-2，v1.0-4）：16-18 岁联盟新血，不入队（teamId=null）。
 * 潜力分层：基础 overall 54-66，少量「本届天才」potential 拔高到 86-94（新闻素材+叙事钩子）。
 */
export function spawnRookieClass(state: GameState, rng: Rng, count: number): Player[] {
  const usedIgns = new Set(Object.values(state.players).map((p) => p.ign));
  const rookies: Player[] = [];
  for (let i = 0; i < count; i++) {
    const r = makePlayer(rng, null, 1, rng.int(54, 66), rng.pick(DUTY_KEYS), false, [16, 18], usedIgns, false, { synthetic: "rookie" });
    rookies.push(r);
    state.players[r.id] = r;
  }
  // 天才分层：按潜力排序，前 ~12% 拔高（保持反垄断叙事：天才也可能被中后段顺位捡走）
  const prodigy = Math.max(1, Math.round(count * 0.12));
  const byPotential = rookies.slice().sort((a, b) => b.potential - a.potential);
  for (const r of byPotential.slice(0, prodigy)) {
    r.potential = clamp(Math.min(94, r.potential + rng.int(6, 14)), r.overall, 94);
  }
  return rookies;
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
    id, name: tag, tag, tier: 1, regionId: "emea", roster, starters: roster.slice(),
    coach: { name: "测试教练", tactics: 60, development: 60, motivation: 60 },
    facilities: 60, budget: 5_000_000, reputation: 60,
    personality: "steady", mapPref, bond: 50, presets: {},
    sponsors: [],
    staff: {
      training: { name: "合成训练", value: 50 },
      mapTactics: { name: "合成战术", value: 50 },
      match: { name: "合成比赛", value: 50 },
    },
    academy: [],
    patternUsage: {},
  };
  return { team, players };
}
