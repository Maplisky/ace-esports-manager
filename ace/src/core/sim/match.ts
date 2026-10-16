/**
 * 比赛引擎（GDD §5.2/§5.3）：
 * BP → 逐图逐回合模拟（logistic k=30 / 经济系统 / 大招经济 / 高光事件）→ MatchRecord 事件流。
 * 模拟与呈现分离：本文件只产出数据，播放器消费 MatchRecord（§5.1）。
 * 注意：会修改 state（生涯累计、赛后疲劳/状态/士气）——由日推进统一调度。
 */
import { Rng, clamp, hashString } from "../rng.ts";
import { MAP_BY_ID, MAPS } from "../data/maps.ts";
import { AGENT_BY_ID, ULT_TIER_BONUS, ultCostOf } from "../data/agents.ts";
import {
  computeSide, dutyKillWeight, dutyEntryWeight,
  styleOf, aggrOfLineup, styleCounterOf,
  effectiveOverall, LOGISTIC_K, SWING_SD,
} from "./strength.ts";
import { intelOf } from "./intel.ts";
import { runVeto } from "./veto.ts";
import { callDefOf, callSideOf } from "./tactics.ts";
import type { BuyType, GameState, IglReading, MapRecord, MatchIntervention, MatchRecord, Player, PlayerLine, RoundEvent, RoundRecord, Team } from "../types.ts";
import type { StyleKey } from "./strength.ts";
const ULT_BONUS_CAP = 2.5;
const MAX_ROUNDS = 80;

/** 开局战术（GDD §5.4 二期）：确定性 hash 选择，不消耗 RNG——同图同回合同经济必出同战术 */
function tacticForAtk(mapId: string, round: number, buy: BuyType, iglId: string, aware: number): string {
  const r = hashString(`${mapId}:${round}:${buy}:${iglId}:atk`) % 100;
  if (buy === "eco") return r < 55 ? "atk:ecoStack" : r < 80 ? "atk:rush:A" : "atk:rush:B";
  if (buy === "force") return r < 45 ? "atk:rush:A" : r < 90 ? "atk:rush:B" : "atk:ecoStack";
  // 长枪局：意识高的指挥更倾向中路夹击与针对性快攻
  if (aware >= 70) return r < 30 ? "atk:midSplit" : r < 60 ? "atk:rush:A" : r < 85 ? "atk:rush:B" : "atk:default";
  return r < 20 ? "atk:midSplit" : r < 45 ? "atk:rush:A" : r < 65 ? "atk:rush:B" : "atk:default";
}

function tacticForDef(mapId: string, round: number, iglId: string, aware: number): string {
  const h = hashString(`${mapId}:${round}:${iglId}:def`);
  const r = h % 100;
  const site = h % 2 === 0 ? "A" : "B";
  if (aware >= 70) return r < 25 ? "def:aggro" : r < 55 ? `def:stack:${site}` : "def:standard";
  return r < 15 ? "def:aggro" : r < 40 ? `def:stack:${site}` : "def:standard";
}

/** 队内指挥的意识值与 id（无指挥用队长位=首发第一人） */
function iglInfo(team: Team, state: GameState): { id: string; aware: number } {
  const igl = team.roster.map((pid) => state.players[pid]).find((p) => p?.isIgl);
  if (igl) return { id: igl.id, aware: igl.attrs.awareness };
  const first = team.roster.map((pid) => state.players[pid]).find(Boolean);
  return { id: first?.id ?? team.id, aware: first?.attrs.awareness ?? 50 };
}

interface SimTeam {
  side: "A" | "B";
  team: Team;
  /** 当前地图的强度（每图重算） */
  str: ReturnType<typeof computeSide> | null;
  players: Player[];
  money: number;
  lossStreak: number;
  score: number;
  ultReady: Set<string>;
  timeouts: number;
  /** 喊话中的战术（AI rush/steady 与玩家/IGL 干预共用结构，v1.0-8） */
  call: {
    atkMod: number;
    defMod: number;
    counterRush?: boolean;
    roundsLeft: number;
    /** 喊话战术 id（覆盖该侧开局战术展示） */
    tacticId?: string;
    player?: boolean;
    igl?: boolean;
  } | null;
}

interface UltState {
  points: Map<string, number>;
}

function sideOf(sim: { A: SimTeam; B: SimTeam }, s: "A" | "B"): SimTeam {
  return s === "A" ? sim.A : sim.B;
}

/** 特质乘数（v0.8）：kind 决定查询维度；无特质 = 1 */
function traitMul(p: Player, kind: "first" | "kill" | "death" | "assist" | "clutch"): number {
  const ts = p.traits;
  if (!ts || ts.length === 0) return 1;
  const has = (k: string) => ts.includes(k);
  let m = 1;
  if (kind === "first") {
    if (has("entry")) m *= 1.35;
    if (has("baiter")) m *= 0.5;
  } else if (kind === "kill") {
    if (has("carry")) m *= 1.25;
    if (has("headshot")) m *= 1.1;
    if (has("glass")) m *= 1.15;
  } else if (kind === "death") {
    if (has("survivor")) m *= 0.8;
    if (has("glass")) m *= 1.3;
    if (has("anchor")) m *= 0.9;
  } else if (kind === "assist") {
    if (has("enabler")) m *= 1.3;
  } else if (kind === "clutch") {
    if (has("clutch")) m *= 3;
  }
  return m;
}

function attackSideOf(round: number, aAttacksFirst: boolean): "A" | "B" {
  const first = aAttacksFirst ? "A" : "B";
  const second = aAttacksFirst ? "B" : "A";
  if (round <= 12) return first;
  if (round <= 24) return second;
  return (round - 25) % 2 === 0 ? first : second;
}

function decideBuy(money: number, pistol: boolean, rng: Rng): BuyType {
  if (pistol) return "eco";
  if (money >= 3900) return "full";
  if (money >= 2200 && rng.chance(0.55)) return "force";
  return "eco";
}

const BUY_MOD: Record<BuyType, number> = { full: 0, force: -6.5, eco: -15 };

function dutyOf(p: Player) {
  const sum = { duelist: 0, initiator: 0, controller: 0, sentinel: 0 };
  let w = 0;
  for (const agentId of p.agentPool) {
    const a = AGENT_BY_ID.get(agentId);
    if (!a) continue;
    const pro = p.agentPro[agentId] ?? 0;
    for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] += a.duty[k] * pro;
    w += pro;
  }
  if (w <= 0) return { duelist: 0.25, initiator: 0.25, controller: 0.25, sentinel: 0.25 };
  for (const k of ["duelist", "initiator", "controller", "sentinel"] as const) sum[k] /= w;
  return sum;
}

function pickWeighted(players: Player[], alive: Set<string>, weight: (p: Player) => number, rng: Rng): Player {
  const candidates = players.filter((p) => alive.has(p.id));
  const weights = candidates.map((p) => Math.max(0.01, weight(p)));
  return candidates[rng.weightedIndex(weights)] as Player;
}

function addUlt(ult: Map<string, number>, pid: string, n: number, team: SimTeam, events: RoundEvent[]): void {
  if (team.ultReady.has(pid)) return;
  const cur = (ult.get(pid) ?? 0) + n;
  const agentId = team.str?.agents[pid];
  const cost = ultCostOf(agentId ?? ""); // 逐特工阈值（v1.0 按真实游戏实录）
  if (cur >= cost) {
    team.ultReady.add(pid);
    const tier = agentId ? (AGENT_BY_ID.get(agentId)?.ultTiers?.[0] ?? "utility") : "utility";
    events.push({ t: "ultReady", s: pid, tier, side: team.side });
  } else {
    ult.set(pid, cur);
  }
}

function simMap(
  state: GameState,
  mapId: string,
  A: SimTeam,
  B: SimTeam,
  rng: Rng,
  agentLock?: Record<string, Record<string, string>>,
  intlPlayoff = false,
  mapIdx = 0,
  interventions?: MatchIntervention[],
  scriptSide?: "A" | "B",
): MapRecord {
  const map = MAP_BY_ID.get(mapId) ?? MAPS[0]!;
  // 每图重算强度（图池熟练/meta/玩家预案英雄随图变化）
  // 针对准备（GDD §7.2）：我方对对手的情报点 → 针对加成（×0.22，最高 +2.2）；AI 侧默认不启用
  // 难度（v1.0-7）：困难/职业下 AI 会侦察我队（对手对我 intel 2/4 → 针对加成 +0.44/+0.88）
  const aiIntelOf = state.difficulty === "pro" ? 4 : state.difficulty === "hard" ? 2 : 0;
  const intelA = A.team.id === state.myTeamId ? intelOf(state, B.team.id) : B.team.id === state.myTeamId ? aiIntelOf : 0;
  const intelB = B.team.id === state.myTeamId ? intelOf(state, A.team.id) : A.team.id === state.myTeamId ? aiIntelOf : 0;
  // 英雄分配：首选预案打底，赛前准备的手动选择（agentLock[mapId]）最高优先；都没有则引擎自动分配
  const assignFor = (team: Team) => {
    const preset = presetAgents(state, team, mapId);
    const lock = agentLock?.[mapId];
    return lock ? { ...(preset ?? {}), ...lock } : preset;
  };
  // 招牌战术反向泄露（GDD §6.4）：我方重复使用同一图预案 → 对手针对性准备提升。
  // 变阵降摸透（v1.x 用户反馈）：本图阵容与上一场不同 → 对手准备大半落空（泄露 ×0.25）并记录新指纹
  // （依赖 assignFor，必须在其后定义并在调用时已初始化）
  const patternKeyOf = (team: Team): string => {
    const assign = assignFor(team) ?? {};
    return Object.keys(assign).sort().map((pid) => assign[pid]).join("|");
  };
  const leakOf = (side: "A" | "B", team: Team): number => {
    if (team.id !== state.myTeamId) return 0;
    const usage = team.patternUsage[mapId] ?? 0;
    if (usage === 0) return 0;
    const key = patternKeyOf(team);
    const prev = team.lastPattern?.[mapId];
    team.lastPattern ??= {};
    team.lastPattern[mapId] = key;
    return patternLeakOf(prev, key, usage);
  };
  const leakToB = leakOf("A", A.team);
  const leakToA = leakOf("B", B.team);
  // 当前版本 meta（GDD §4.3）传入阵容强度（fit × meta 联合）
  const patchMetaMap = Object.fromEntries((state.patchNotes?.slice(-1)[0]?.changes ?? []).map((c) => [c.agentId, c.meta]));
  // 风格克制（GDD §7.1/§18-3，v1.0-5）：双方首发风格相性；跨赛区遭遇战对海外风格不熟 → 相性折半
  const crossRegion = (A.team.regionId ?? "") !== (B.team.regionId ?? "");
  const styleA = styleOf(aggrOfLineup(A.players));
  const styleB = styleOf(aggrOfLineup(B.players));
  const counterA = styleCounterOf(styleA, styleB) * (crossRegion ? 0.5 : 1);
  const counterB = styleCounterOf(styleB, styleA) * (crossRegion ? 0.5 : 1);
  // 风格特训应对熟练度（GDD §5.6 v1.1，§12：每点 +0.09，最多向有利偏移 +0.9）——只对我队生效
  const styleTrainingShift = (side: "A" | "B", theirStyle: StyleKey): number => {
    const tid = side === "A" ? A.team.id : B.team.id;
    if (tid !== state.myTeamId) return 0;
    return Math.min(0.9, (state.styleCounter?.[theirStyle] ?? 0) * 0.09);
  };
  const counterA2 = counterA + styleTrainingShift("A", styleB);
  const counterB2 = counterB + styleTrainingShift("B", styleA);
  // 怯场（GDD §18-3，v1.0-5）：国际赛淘汰赛，≤19 岁新兵/大赛软脚虾特质 → 心态 debuff（mid）；
  // 老将 IGL（≥28 岁）或高激励教练（motivation ≥70）压阵 → 减半
  const chokeOf = (t: SimTeam): number => {
    if (!intlPlayoff) return 0;
    let sources = 0;
    for (const p of t.players) {
      if (p.age <= 19) sources += 0.5;
      if (p.traits?.includes("choker")) sources += 1;
    }
    if (sources === 0) return 0;
    const anchored = t.players.some((p) => p.isIgl && p.age >= 28) || t.team.coach.motivation >= 70;
    return -Math.min(1.2, sources) * (anchored ? 0.5 : 1);
  };
  A.str = computeSide({ team: A.team, players: state.players, map, day: state.day, agentAssign: assignFor(A.team), intel: intelA, patchMeta: patchMetaMap, styleCounter: counterA2, chokeMod: chokeOf(A) });
  B.str = computeSide({ team: B.team, players: state.players, map, day: state.day, agentAssign: assignFor(B.team), intel: intelB, patchMeta: patchMetaMap, styleCounter: counterB2, chokeMod: chokeOf(B) });

  const lines: Record<string, PlayerLine> = {};
  const allPlayers = [...A.players, ...B.players];
  for (const p of allPlayers) {
    lines[p.id] = { kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, damage: 0, rounds: 0, acs: 0 };
  }
  const ultPoints = new Map<string, number>();
  const aliveA = new Set(A.players.map((p) => p.id));
  const aliveB = new Set(B.players.map((p) => p.id));
  let a = 0;
  let b = 0;
  let halfA = 0;
  let halfB = 0;
  const rounds: RoundRecord[] = [];
  const readings: IglReading[] = [];
  const swingA = rng.norm(0, SWING_SD);
  const swingB = rng.norm(0, SWING_SD);
  const aAttacksFirst = rng.chance(0.5); // 每图掷硬币定先攻（消除固定 A 先攻的系统性偏置）
  let comebackNoted = false;
  // 我方在场上的 SimTeam（无我队则无干预/读图，v1.0-8）
  const mySide: "A" | "B" | null = A.team.id === state.myTeamId ? "A" : B.team.id === state.myTeamId ? "B" : null;
  const mySim = mySide ? sideOf({ A, B }, mySide) : null;
  const oppSim = mySide ? sideOf({ A, B }, mySide === "A" ? "B" : "A") : null;
  const myIntel = mySim === A ? intelA : intelB; // 我方对对手的情报点（读图质量用）

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if ((a >= 13 && a - b >= 2) || (b >= 13 && b - a >= 2)) break;

    const atkSide = attackSideOf(round, aAttacksFirst);
    const atkSim = sideOf({ A, B }, atkSide);
    const defSim = sideOf({ A, B }, atkSide === "A" ? "B" : "A");
    const pistol = round === 1 || round === 13 || round === 25;
    if (pistol) {
      A.money = 800;
      B.money = 800;
      A.lossStreak = 0;
      B.lossStreak = 0;
    }
    const buyA = decideBuy(A.money, pistol, rng);
    const buyB = decideBuy(B.money, pistol, rng);
    // 开局战术（GDD §5.4 二期）：确定性 hash 选择——不消耗 RNG，模拟结果与此前逐位一致
    const atkIgl = iglInfo(atkSide === "A" ? A.team : B.team, state);
    const defIgl = iglInfo(atkSide === "A" ? B.team : A.team, state);
    let tacticAtk = tacticForAtk(mapId, round, atkSide === "A" ? buyA : buyB, atkIgl.id, atkIgl.aware);
    let tacticDef = tacticForDef(mapId, round, defIgl.id, defIgl.aware);
    if (!pistol) {
      A.money = Math.max(0, A.money - (buyA === "full" ? 3900 : buyA === "force" ? 2300 : 500));
      B.money = Math.max(0, B.money - (buyB === "full" ? 3900 : buyB === "force" ? 2300 : 500));
    }

    // 大招就绪加成：按档位求和，上限 2.5
    const ultBonus = (t: SimTeam) => {
      let bonus = 0;
      for (const pid of t.ultReady) {
        const agentId = t.str?.agents[pid];
        const tier = agentId ? (AGENT_BY_ID.get(agentId)?.ultTiers?.[0] ?? "utility") : "utility";
        bonus += ULT_TIER_BONUS[tier] ?? 0.4;
      }
      return Math.min(ULT_BONUS_CAP, bonus);
    };

    // 玩家喊话（v1.0-8，GDD §5.4 情境化暂停战术菜单）：干预列表命中本图本回合 → 我方喊话。
    // 不消耗 RNG——干预是重模拟的显式输入，「不操作即逐位一致」红线由此保证。
    if (mySim) {
      const iv = interventions?.find((v) => v.map === mapIdx && v.round === round);
      if (iv && !mySim.call) {
        const def = callDefOf(iv.tactic);
        const myBuy = mySim === A ? buyA : buyB;
        const coreReady = [...mySim.ultReady].filter((pid) => {
          const aid = mySim.str?.agents[pid];
          return aid ? AGENT_BY_ID.get(aid)?.ultTiers?.[0] === "core" : false;
        }).length;
        // 引擎侧门控：大招速攻需 ≥2 核心档就绪 + 长枪局（UI 同步过滤，此处兜底）
        const gateOk = (!def?.needsCoreUlts || coreReady >= 2) && (!def?.needsFullBuy || myBuy === "full");
        if (def && gateOk && (iv.igl || mySim.timeouts > 0)) {
          if (!iv.igl) mySim.timeouts--;
          const scale = iv.igl ? 0.8 : 1;
          mySim.call = {
            atkMod: def.atkMod * scale,
            defMod: def.defMod * scale,
            counterRush: def.counterRush,
            roundsLeft: iv.igl ? 2 : 3,
            tacticId: iv.tactic,
            player: true,
            igl: iv.igl,
          };
        }
      }
    }

    // AI 暂停：连败 ≥3 且有暂停 → 按性格 50% 喊战术，持续 3 回合（玩家喊话优先，同回合互斥）
    for (const t of [A, B]) {
      if (t.lossStreak >= 3 && t.timeouts > 0 && !t.call && rng.chance(0.5)) {
        t.timeouts--;
        const kind = t.team.personality === "steady" ? "steady" : "rush";
        const def = callDefOf(kind)!;
        t.call = { atkMod: def.atkMod, defMod: def.defMod, roundsLeft: 3 };
      }
    }
    // 喊话覆盖该侧开局战术展示（Tactical2D 站位随喊话展开，v1.0-8）
    if (atkSim.call?.tacticId && callSideOf(atkSim.call.tacticId) === "atk") tacticAtk = atkSim.call.tacticId;
    if (defSim.call?.tacticId && callSideOf(defSim.call.tacticId) === "def") tacticDef = defSim.call.tacticId;
    const callMod = (t: SimTeam, isAtk: boolean) => {
      if (!t.call) return 0;
      return isAtk ? t.call.atkMod : t.call.defMod;
    };

    // 回合胜负（GDD §5.2）：攻方强度 − 守方强度 + 经济/战术/每图摆动 + 落后方追分
    const atkStr = atkSim.str!.atk + ultBonus(atkSim);
    const defStr = defSim.str!.def + ultBonus(defSim);
    // 双哨位蹲通道克制 rush（v1.0-8）：对手本回合 rush 系开局 → 防守额外 +1.2
    const counterBonus = defSim.call?.counterRush && tacticAtk.startsWith("atk:rush") ? 1.2 : 0;
    // 教学脚本局优势（v1.0-11，§3）：指定侧 +8——固定常量，零 RNG，缺省逐位一致
    const scriptBonus = (s: SimTeam) => (scriptSide === s.side ? 8 : 0);
    const atkTerms =
      (atkSide === "A" ? atkStr + BUY_MOD[buyA] + callMod(A, true) + swingA : atkStr + BUY_MOD[buyB] + callMod(B, true) + swingB) +
      scriptBonus(atkSim);
    const defTerms =
      (atkSide === "A"
        ? defStr + BUY_MOD[buyB] + callMod(B, false) + counterBonus + swingB
        : defStr + BUY_MOD[buyA] + callMod(A, false) + counterBonus + swingA) + scriptBonus(defSim);
    const trailing: "A" | "B" | null = a > b ? "B" : b > a ? "A" : null;
    const comeback = trailing ? 0.35 * sideOf({ A, B }, trailing).str!.mid : 0;
    const m = atkTerms - defTerms + (trailing === atkSide ? comeback : trailing ? -comeback : 0) + (atkSide === "A" ? leakToA : leakToB);

    const pAtk = 1 / (1 + Math.exp(-m / LOGISTIC_K));
    const attackerWins = rng.chance(pAtk);
    const winSide: "A" | "B" = attackerWins ? atkSide : atkSide === "A" ? "B" : "A";
    const winSim = sideOf({ A, B }, winSide);
    const loseSim = sideOf({ A, B }, winSide === "A" ? "B" : "A");

    // 减员分配：回合越接近（c 越大）死亡越分散
    const c = Math.abs(pAtk - 0.5) * 2;
    const loserAlive = rng.weightedIndex([2.0 - 1.5 * c, 1.4, 1.0 + 0.5 * c, 0.6 + 0.7 * c, 0.3 + c]);
    const winnerDeaths = Math.min(rng.weightedIndex([2.6 - 1.4 * c, 1.6, 0.9 + 0.5 * c, 0.4 + 0.6 * c, 0.2 + 0.8 * c]), 4);
    const winnerAlive = 5 - winnerDeaths;

    const winAlive = new Set(winSim.players.map((p) => p.id));
    const loseDead = rng.shuffle(loseSim.players)
      .sort((a, b) => traitMul(b, "death") - traitMul(a, "death"))
      .slice(0, 5 - loserAlive);
    const winDead = rng.shuffle(winSim.players)
      .sort((a, b) => traitMul(b, "death") - traitMul(a, "death"))
      .slice(0, winnerDeaths);
    const loseAll = new Set(loseSim.players.map((p) => p.id));
    const winAll = new Set(winSim.players.map((p) => p.id));
    const atkAliveSet = attackerWins ? winAlive : loseAll;
    const defAliveSet = attackerWins ? loseAll : winAlive;
    const atkPlayers = atkSide === "A" ? A.players : B.players;
    const defPlayers = atkSide === "A" ? B.players : A.players;

    const events: RoundEvent[] = [];
    if (A.call || B.call) {
      const caller = A.call ? "A" : "B";
      const c = (A.call ?? B.call)!;
      events.push({
        t: "timeout",
        side: caller,
        ...(c.player ? { player: true, tactic: c.tacticId, igl: c.igl } : {}),
      });
    }

    // 击杀分配
    const killsThisRound: Record<string, number> = {};
    const firstKiller = pickWeighted(atkPlayers, atkAliveSet, (p) => dutyEntryWeight(dutyOf(p)) * (p.attrs.aim / 60) * traitMul(p, "first"), rng);
    const firstVictim = loseDead.length > 0 ? (loseDead[0] as Player) : (defPlayers[0] as Player);
    events.push({ t: "kill", s: firstKiller.id, v: firstVictim.id, first: true, dmg: 150 });
    killsThisRound[firstKiller.id] = 1;
    addUlt(ultPoints, firstKiller.id, 1, winSim, events);

    const credit = (killer: Player, victim: Player) => {
      killsThisRound[killer.id] = (killsThisRound[killer.id] ?? 0) + 1;
      events.push({ t: "kill", s: killer.id, v: victim.id, dmg: 150 });
      addUlt(ultPoints, killer.id, 1, winSim, events);
    };
    for (let i = 1; i < loseDead.length; i++) {
      const victim = loseDead[i] as Player;
      const killer = pickWeighted(winSim.players, winAlive, (p) => dutyKillWeight(dutyOf(p)) * (p.attrs.aim / 70) * traitMul(p, "kill"), rng);
      credit(killer, victim);
    }
    for (const victim of winDead) {
      const killer = pickWeighted(loseSim.players, loseAll, (p) => dutyKillWeight(dutyOf(p)) * (p.attrs.aim / 70) * traitMul(p, "kill"), rng);
      credit(killer, victim);
    }

    // 包点
    let planted = false;
    if (attackerWins && rng.chance(0.6)) {
      planted = true;
      const planter = pickWeighted(atkPlayers, atkAliveSet, (p) => dutyEntryWeight(dutyOf(p)), rng);
      events.push({ t: "plant", s: planter.id });
      addUlt(ultPoints, planter.id, 1, winSim, events);
    }

    // 高光：ACE / 残局 / 零封
    for (const [pid, k] of Object.entries(killsThisRound)) {
      if (k >= 5) events.push({ t: "ace", s: pid });
    }
    if (winnerDeaths >= 4) {
      const clutchHero = winSim.players.filter((p) => winAlive.has(p.id)).sort((a, b) => traitMul(b, "clutch") - traitMul(a, "clutch"))[0] ?? (winSim.players[0] as Player);
      lines[clutchHero.id]!.clutches++;
      events.push({ t: "clutch", s: clutchHero.id, vs: Math.max(1, loserAlive) });
    }
    if (loserAlive === 0 && winnerAlive === 5) events.push({ t: "flawless", side: winSide });

    // 回合结束方式
    let how: "elim" | "spike" | "defuse" | "time";
    if (attackerWins) {
      how = planted && rng.chance(0.65) ? "spike" : !planted && rng.chance(0.15) ? "time" : "elim";
    } else {
      how = planted && rng.chance(0.55) ? "defuse" : "elim";
    }
    if (how === "defuse") {
      const defuser = pickWeighted(defPlayers, defAliveSet, (p) => p.attrs.awareness, rng);
      events.push({ t: "defuse", s: defuser.id });
    }

    // 计分与经济
    if (winSide === "A") a++;
    else b++;
    winSim.money = Math.min(9000, winSim.money + 3000 + 200 * loserAlive);
    loseSim.money = Math.min(9000, loseSim.money + 1900 + 500 * Math.min(loseSim.lossStreak, 2) + 200 * loserAlive);
    winSim.lossStreak = 0;
    loseSim.lossStreak++;
    for (const t of [A, B]) {
      if (t.call) {
        t.call.roundsLeft--;
        if (t.call.roundsLeft <= 0) t.call = null;
      }
    }

    // lines 累计（残伤与助攻同步记入 end，供实时 ACS/助攻揭示——GDD §5.4）
    const endDmg: Record<string, number> = {};
    const endAssists: string[] = [];
    for (const p of allPlayers) {
      const line = lines[p.id] as PlayerLine;
      line.rounds++;
      const mySideAlive = A.players.includes(p)
        ? (winSide === "A" ? winAlive : loseAll)
        : (winSide === "B" ? winAlive : loseAll);
      const k = killsThisRound[p.id] ?? 0;
      line.kills += k;
      const chip = mySideAlive.has(p.id) ? rng.range(20, 55) : rng.range(0, 15);
      line.damage += k * 150 + chip;
      endDmg[p.id] = chip; // 原始小数入 end——实时 ACS 求和必须与 line.damage 完全一致
    }
    for (const victim of [...loseDead, ...winDead]) {
      const line = lines[victim.id] as PlayerLine;
      line.deaths++;
      ultPoints.set(victim.id, (ultPoints.get(victim.id) ?? 0) + 1);
    }
    lines[firstKiller.id]!.firstKills++;
    lines[firstVictim.id]!.firstDeaths++;
    for (const p of winSim.players) {
      if (winAlive.has(p.id) && !(killsThisRound[p.id] > 0) && rng.chance(0.42 * traitMul(p, "assist"))) {
        lines[p.id]!.assists++;
        endAssists.push(p.id);
      }
    }
    if (round === 12) {
      halfA = a;
      halfB = b;
    }

    rounds.push({
      n: round,
      atk: atkSide,
      buys: { A: buyA, B: buyB },
      tacticAtk,
      tacticDef,
      events,
      end: {
        win: winSide,
        how,
        alive: { A: winSide === "A" ? winnerAlive : loserAlive, B: winSide === "B" ? winnerAlive : loserAlive },
        score: [a, b],
        assists: endAssists,
        dmgBonus: endDmg,
        // 大招进度（就绪=7 分封顶）与回合末经济池——局内战绩板展示（GDD §5.4 二期）
        ults: (() => {
          const snap: Record<string, number> = {};
          for (const p of allPlayers) {
            const ready = (A.players.some((q) => q.id === p.id) ? A.ultReady : B.ultReady).has(p.id);
            snap[p.id] = ready ? ultCostOf(A.str!.agents[p.id] ?? B.str!.agents[p.id] ?? "") : (ultPoints.get(p.id) ?? 0);
          }
          return snap;
        })(),
        money: { A: A.money, B: B.money },
        timeouts: { A: A.timeouts, B: B.timeouts },
      },
    });

    // IGL 场上阅读（v1.0-8，GDD §5.4）：第 7/14 回合末我方 IGL 给出确定性建议（hash 决定命中率，零 RNG）
    if (mySim && oppSim && (round === 7 || round === 14)) {
      const reading = iglReading(state, mapId, mySim, oppSim, myIntel, round, aAttacksFirst, rounds);
      if (reading) readings.push(reading);
    }

    // 翻盘标记（半场 ≤3 分逆转，供播放器高亮）
    if (!comebackNoted && round > 20 && ((halfA <= 3 && a > b) || (halfB <= 3 && b > a))) {
      comebackNoted = true;
    }
  }

  const totalRounds = a + b;
  for (const line of Object.values(lines)) {
    line.rounds = totalRounds;
    line.acs = totalRounds > 0 ? Math.round((line.damage / totalRounds) * 1.45) : 0;
  }
  // 地图 MVP：ACS 最高 + 胜方 +18（GDD §5.2）
  const winnerIds = new Set((a > b ? A.players : B.players).map((p) => p.id));
  let mvp: string | null = null;
  let bestScore = -1;
  for (const [pid, line] of Object.entries(lines)) {
    const score = line.acs + (winnerIds.has(pid) ? 18 : 0);
    if (score > bestScore) {
      bestScore = score;
      mvp = pid;
    }
  }
  return {
    map: mapId,
    score: [a, b],
    rounds,
    lines,
    mvp,
    agents: { ...A.str!.agents, ...B.str!.agents },
    edges: { A: { ...A.str!.edge }, B: { ...B.str!.edge } },
    ...(readings.length > 0 ? { readings } : {}),
  };
}

/**
 * IGL 场上阅读（v1.0-8）：建议 = 对手近 3 回合开局战术趋势的正确对策；质量公式 =
 * f(IGL 意识 + 情报等级 + 比赛型教练)（GDD §5.4 v1.1 口径）。未达质量线 → 自信误判
 * （同侧另一条战术，同样自信展示——误判只在赛后复盘揭示）。全程确定性 hash，零 RNG。
 */
function iglReading(
  state: GameState,
  mapId: string,
  mySim: SimTeam,
  oppSim: SimTeam,
  myIntel: number,
  round: number,
  aAttacksFirst: boolean,
  rounds: RoundRecord[],
): IglReading | null {
  const igl = iglInfo(mySim.team, state);
  const coachVal = mySim.team.staff?.match?.value ?? 0;
  const quality = Math.round(clamp(20 + (igl.aware - 50) * 0.9 + myIntel * 4 + coachVal * 0.25, 5, 95));
  const myAtkNext = attackSideOf(round + 1, aAttacksFirst) === mySim.side;
  const trend = rounds.slice(-3).map((r) => (r.atk === oppSim.side ? r.tacticAtk ?? "atk:default" : r.tacticDef ?? "def:standard"));
  const site = hashString(`${mapId}:${round}:${igl.id}:site`) % 2 === 0 ? "A" : "B";
  let correctTactic: string;
  if (myAtkNext) {
    // 我方下回合进攻：对手堆防 → 假打转点；前顶 → 慢速默认；其余 → 集火 Rush
    correctTactic = trend.some((t) => t.startsWith("def:stack"))
      ? "atk:fakeRotate"
      : trend.includes("def:aggro")
        ? "atk:slowDefault"
        : `atk:rush:${site}`;
  } else {
    // 我方下回合防守：对手 rush 倾向 → 双哨位蹲通道；中路夹击 → 131 回防；其余 → 抱团前压
    const rushy = trend.filter((t) => t.startsWith("atk:rush") || t.startsWith("atk:ecoStack")).length;
    correctTactic = rushy >= 2 ? "def:sentinelTunnel" : trend.includes("atk:midSplit") ? "def:rotate131" : `def:stackPush:${site}`;
  }
  const hit = hashString(`${mapId}:${round}:${igl.id}:read`) % 100 < quality;
  let suggested = correctTactic;
  if (!hit) {
    // 自信误判：同侧另一条战术（IGL 不推荐大招速攻——他自己也不确定大招窗口）
    const pool = ["atk:rush", "atk:fakeRotate", "atk:slowDefault", "def:stackPush", "def:rotate131", "def:giveSite", "def:sentinelTunnel"]
      .filter((t) => callSideOf(t) === callSideOf(correctTactic) && t !== correctTactic.replace(/:[ABC]$/, ""));
    if (pool.length > 0) {
      suggested = pool[hashString(`${mapId}:${round}:${igl.id}:miss`) % pool.length]!;
      if (callDefOf(suggested)?.pickSite) suggested += `:${site}`;
    }
  }
  return { round, iglId: igl.id, suggested, quality, correct: hit };
}

/** 玩家为该图保存的首选预案英雄分配（GDD §7.1），无则 undefined（引擎自动分配） */
function presetAgents(state: GameState, team: Team, mapId: string): Record<string, string> | undefined {
  const presets = team.presets[mapId];
  if (!presets || presets.length === 0) return undefined;
  const preferred = presets.find((p) => p.preferred) ?? presets[0];
  return preferred?.agents;
}

/** 招牌战术泄露幅度（v1.x 变阵降摸透）：base = min(1.2, 使用次数×0.12)；
 *  指纹与上一场相同（或首次记录）→ 满额；变阵 → 对手准备大半落空 ×0.25。纯函数供测试。 */
export function patternLeakOf(prev: string | undefined, key: string, usage: number): number {
  if (usage <= 0) return 0;
  const base = Math.min(1.2, usage * 0.12);
  return prev === undefined || prev === key ? base : base * 0.25;
}

/** 当日可用首发（伤员剔除、缺员从替补顶替）——simMatch 与 applyMatchEffects 共用同一解析（v1.0-8 拆分） */
export function resolveMatchRoster(state: GameState, team: Team): Player[] {
  const roster = team.starters
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.injuredUntilDay <= state.day);
  const bench = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && !roster.includes(p) && p.injuredUntilDay <= state.day)
    .sort((x, y) => effectiveOverall(y, state.day) - effectiveOverall(x, state.day));
  while (roster.length < 5 && bench.length) roster.push(bench.shift() as Player);
  return roster.slice(0, 5);
}

/**
 * 赛后效果入账（v1.0-8 从 simMatch 拆出——模拟必须纯函数化，供交互式重模拟复用）：
 * 生涯累计（逐图）+ 图 MVP + 疲劳/状态/士气。day.ts 各调用点在 simMatch 之后同步调用，
 * 与拆分前逐场「模拟→入账→下一场」的顺序一致，无跨场污染。
 */
export function applyMatchEffects(state: GameState, rec: MatchRecord): void {
  for (const mapRec of rec.maps) {
    for (const [pid, line] of Object.entries(mapRec.lines)) {
      const p = state.players[pid];
      if (!p) continue;
      p.career.maps++;
      p.career.rounds += line.rounds;
      p.career.kills += line.kills;
      p.career.deaths += line.deaths;
      p.career.assists += line.assists;
      p.career.firstKills += line.firstKills;
      p.career.firstDeaths += line.firstDeaths;
      p.career.clutches += line.clutches;
    }
    if (mapRec.mvp) {
      const p = state.players[mapRec.mvp];
      if (p) p.career.mvps++;
    }
  }
  for (const teamId of [rec.teamA, rec.teamB]) {
    const team = state.teams[teamId];
    if (!team) continue;
    const won = (rec.winner === "A" && teamId === rec.teamA) || (rec.winner === "B" && teamId === rec.teamB);
    for (const p of resolveMatchRoster(state, team)) {
      p.fatigue = clamp(p.fatigue + rec.maps.length * 5, 0, 100);
      p.form = clamp(p.form + (won ? 1 : -1), 30, 99);
      p.morale = clamp(p.morale + (won ? 2 : -2), 10, 100);
    }
    // 教练心态（§9.5 v1.4）：我的正式赛胜负 ±10——赢球心情好，连败要照顾自己
    if (teamId === state.myTeamId && state.manager?.life) {
      state.manager.life.mood = clamp(state.manager.life.mood + (won ? 10 : -10), 0, 100);
    }
  }
}

/** 模拟一场比赛（含 BP；mapLock/agentLock 优先——玩家赛前手动指定）。纯模拟：生涯/状态入账走 applyMatchEffects。 */
export function simMatch(
  state: GameState,
  teamAId: string,
  teamBId: string,
  bo: 1 | 3 | 5,
  seed: number,
  matchId: string,
  mapLock?: string[],
  agentLock?: Record<string, Record<string, string>>,
  interventions?: MatchIntervention[],
): MatchRecord {
  const rng = new Rng(seed);
  const teamA = state.teams[teamAId] as Team;
  const teamB = state.teams[teamBId] as Team;
  // 难度（v1.0-7，GDD §9.5）：职业难度 AI BP 读图更准（噪声 ±3）；调用次数不变，普通难度逐位一致
  const veto = mapLock && mapLock.length > 0 ? { maps: mapLock.slice(), log: ["手动 BP"] } : runVeto(teamA, teamB, bo, rng, state.difficulty === "pro" ? 3 : 6);

  const makeSim = (side: "A" | "B", team: Team): SimTeam => ({
    side,
    team,
    str: null,
    players: resolveMatchRoster(state, team),
    money: 800,
    lossStreak: 0,
    score: 0,
    ultReady: new Set(),
    timeouts: 2 + ((team.staff?.match?.value ?? 0) >= 85 ? 1 : 0),
    call: null,
  });

  const A = makeSim("A", teamA);
  const B = makeSim("B", teamB);

  // 国际赛淘汰赛标记（怯场机制，GDD §18-3）：Masters/Champions 的胜者组/败者组/总决赛
  const fx = state.fixtures.find((f) => f.id === matchId);
  const intlPlayoff = !!fx && (fx.comp === "masters" || fx.comp === "champions") && /胜者组|败者组|总决赛/.test(fx.label);
  // 教学脚本局（v1.0-11，§3）：我的首场 +8 优势（固定常量，零 RNG）
  const scriptSide = fx?.tutorial ? (teamAId === state.myTeamId ? "A" : "B") : undefined;

  const wins = { A: 0, B: 0 };
  const maps: MapRecord[] = [];

  for (let mi = 0; mi < veto.maps.length; mi++) {
    if (wins.A >= Math.ceil(bo / 2) || wins.B >= Math.ceil(bo / 2)) break;
    const mapId = veto.maps[mi] as string;
    const mapRec = simMap(state, mapId, A, B, rng, agentLock, intlPlayoff, mi, interventions, scriptSide);
    if (mapRec.score[0] > mapRec.score[1]) wins.A++;
    else if (mapRec.score[1] > mapRec.score[0]) wins.B++;
    maps.push(mapRec);
  }

  let matchMvp: string | null = null;
  let matchMvpScore = -1;
  const mvpAggregate: Record<string, number> = {};
  for (const m of maps) {
    for (const [pid, line] of Object.entries(m.lines)) mvpAggregate[pid] = (mvpAggregate[pid] ?? 0) + line.acs;
  }
  // 总 MVP 只从获胜方产生（GDD §5.4 v2.3：败方最佳另标 SMVP，UI 层推导）
  const winnerPlayers = wins.A > wins.B ? A.players : B.players;
  for (const [pid, acs] of Object.entries(mvpAggregate)) {
    if (!winnerPlayers.some((p) => p.id === pid)) continue;
    if (acs > matchMvpScore) {
      matchMvpScore = acs;
      matchMvp = pid;
    }
  }

  return {
    id: matchId,
    seed,
    format: bo,
    teamA: teamAId,
    teamB: teamBId,
    stage: state.stage,
    day: state.day,
    maps,
    score: [wins.A, wins.B],
    winner: wins.A > wins.B ? "A" : "B",
    mvp: matchMvp,
    ...(interventions && interventions.length > 0 ? { interventions: interventions.slice() } : {}),
  };
}
