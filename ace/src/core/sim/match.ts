/**
 * 比赛引擎（GDD §5.2/§5.3）：
 * BP → 逐图逐回合模拟（logistic k=30 / 经济系统 / 大招经济 / 高光事件）→ MatchRecord 事件流。
 * 模拟与呈现分离：本文件只产出数据，播放器消费 MatchRecord（§5.1）。
 * 注意：会修改 state（生涯累计、赛后疲劳/状态/士气）——由日推进统一调度。
 */
import { Rng, clamp } from "../rng.ts";
import { MAP_BY_ID, MAPS } from "../data/maps.ts";
import { AGENT_BY_ID, ULT_TIER_BONUS } from "../data/agents.ts";
import {
  computeSide, dutyKillWeight, dutyDeathWeight, dutyEntryWeight,
  effectiveOverall, LOGISTIC_K, SWING_SD,
} from "./strength.ts";
import { intelOf } from "./intel.ts";
import { runVeto } from "./veto.ts";
import type { BuyType, GameState, MapRecord, MatchRecord, Player, PlayerLine, RoundEvent, RoundRecord, Team } from "../types.ts";

const ULT_READY_POINTS = 7;
const ULT_BONUS_CAP = 2.5;
const MAX_ROUNDS = 80;

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
  /** 连败中使用的战术 */
  call: { kind: "rush" | "steady"; roundsLeft: number } | null;
}

interface UltState {
  points: Map<string, number>;
}

function sideOf(sim: { A: SimTeam; B: SimTeam }, s: "A" | "B"): SimTeam {
  return s === "A" ? sim.A : sim.B;
}

function attackSideOf(round: number): "A" | "B" {
  if (round <= 12) return "A";
  if (round <= 24) return "B";
  return (round - 25) % 2 === 0 ? "A" : "B";
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
  if (cur >= ULT_READY_POINTS) {
    team.ultReady.add(pid);
    const agentId = team.str?.agents[pid];
    const tier = agentId ? (AGENT_BY_ID.get(agentId)?.ultTiers?.[0] ?? "utility") : "utility";
    events.push({ t: "ultReady", s: pid, tier, side: team.side });
  } else {
    ult.set(pid, cur);
  }
}

function simMap(state: GameState, mapId: string, A: SimTeam, B: SimTeam, rng: Rng, agentLock?: Record<string, Record<string, string>>): MapRecord {
  const map = MAP_BY_ID.get(mapId) ?? MAPS[0]!;
  // 每图重算强度（图池熟练/meta/玩家预案英雄随图变化）
  // 针对准备（GDD §7.2）：我方对对手的情报点 → 针对加成（×0.22，最高 +2.2）；AI 侧 v0.5 不启用情报
  const intelA = A.team.id === state.myTeamId ? intelOf(state, B.team.id) : 0;
  const intelB = B.team.id === state.myTeamId ? intelOf(state, A.team.id) : 0;
  // 英雄分配：首选预案打底，赛前准备的手动选择（agentLock[mapId]）最高优先；都没有则引擎自动分配
  const assignFor = (team: Team) => {
    const preset = presetAgents(state, team, mapId);
    const lock = agentLock?.[mapId];
    return lock ? { ...(preset ?? {}), ...lock } : preset;
  };
  A.str = computeSide({ team: A.team, players: state.players, map, day: state.day, agentAssign: assignFor(A.team), intel: intelA });
  B.str = computeSide({ team: B.team, players: state.players, map, day: state.day, agentAssign: assignFor(B.team), intel: intelB });

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
  const swingA = rng.norm(0, SWING_SD);
  const swingB = rng.norm(0, SWING_SD);
  let comebackNoted = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if ((a >= 13 && a - b >= 2) || (b >= 13 && b - a >= 2)) break;

    const atkSide = attackSideOf(round);
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

    // AI 暂停：连败 ≥3 且有暂停 → 按性格 50% 喊战术，持续 3 回合
    for (const t of [A, B]) {
      if (t.lossStreak >= 3 && t.timeouts > 0 && !t.call && rng.chance(0.5)) {
        t.timeouts--;
        t.call = { kind: t.team.personality === "steady" ? "steady" : "rush", roundsLeft: 3 };
      }
    }
    const callMod = (t: SimTeam, isAtk: boolean) => {
      if (!t.call) return 0;
      return t.call.kind === "rush" ? (isAtk ? 2.4 : -1.6) : isAtk ? -1.2 : 2.0;
    };

    // 回合胜负（GDD §5.2）：攻方强度 − 守方强度 + 经济/战术/每图摆动 + 落后方追分
    const atkStr = atkSim.str!.atk + ultBonus(atkSim);
    const defStr = defSim.str!.def + ultBonus(defSim);
    const atkTerms =
      (atkSide === "A" ? atkStr + BUY_MOD[buyA] + callMod(A, true) + swingA : atkStr + BUY_MOD[buyB] + callMod(B, true) + swingB);
    const defTerms =
      (atkSide === "A" ? defStr + BUY_MOD[buyB] + callMod(B, false) + swingB : defStr + BUY_MOD[buyA] + callMod(A, false) + swingA);
    const trailing: "A" | "B" | null = a > b ? "B" : b > a ? "A" : null;
    const comeback = trailing ? 0.35 * sideOf({ A, B }, trailing).str!.mid : 0;
    const m = atkTerms - defTerms + (trailing === atkSide ? comeback : trailing ? -comeback : 0);

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
    const loseDead = rng.shuffle(loseSim.players).slice(0, 5 - loserAlive);
    const winDead = rng.shuffle(winSim.players).slice(0, winnerDeaths);
    const loseAll = new Set(loseSim.players.map((p) => p.id));
    const winAll = new Set(winSim.players.map((p) => p.id));
    const atkAliveSet = attackerWins ? winAlive : loseAll;
    const defAliveSet = attackerWins ? loseAll : winAlive;
    const atkPlayers = atkSide === "A" ? A.players : B.players;
    const defPlayers = atkSide === "A" ? B.players : A.players;

    const events: RoundEvent[] = [];
    if (A.call || B.call) {
      const caller = A.call ? "A" : "B";
      events.push({ t: "timeout", side: caller });
    }

    // 击杀分配
    const killsThisRound: Record<string, number> = {};
    const firstKiller = pickWeighted(atkPlayers, atkAliveSet, (p) => dutyEntryWeight(dutyOf(p)) * (p.attrs.aim / 60), rng);
    const firstVictim = loseDead.length > 0 ? (loseDead[0] as Player) : (defPlayers[0] as Player);
    events.push({ t: "kill", s: firstKiller.id, v: firstVictim.id, first: true });
    killsThisRound[firstKiller.id] = 1;
    addUlt(ultPoints, firstKiller.id, 1, winSim, events);

    const credit = (killer: Player, victim: Player) => {
      killsThisRound[killer.id] = (killsThisRound[killer.id] ?? 0) + 1;
      events.push({ t: "kill", s: killer.id, v: victim.id });
      addUlt(ultPoints, killer.id, 1, winSim, events);
    };
    for (let i = 1; i < loseDead.length; i++) {
      const victim = loseDead[i] as Player;
      const killer = pickWeighted(winSim.players, winAlive, (p) => dutyKillWeight(dutyOf(p)) * (p.attrs.aim / 70), rng);
      credit(killer, victim);
    }
    for (const victim of winDead) {
      const killer = pickWeighted(loseSim.players, loseAll, (p) => dutyKillWeight(dutyOf(p)) * (p.attrs.aim / 70), rng);
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
      const clutchHero = winSim.players.find((p) => winAlive.has(p.id)) ?? (winSim.players[0] as Player);
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

    // lines 累计
    for (const p of allPlayers) {
      const line = lines[p.id] as PlayerLine;
      line.rounds++;
      const mySideAlive = A.players.includes(p)
        ? (winSide === "A" ? winAlive : loseAll)
        : (winSide === "B" ? winAlive : loseAll);
      const k = killsThisRound[p.id] ?? 0;
      line.kills += k;
      line.damage += k * 150 + (mySideAlive.has(p.id) ? rng.range(20, 55) : rng.range(0, 15));
    }
    for (const victim of [...loseDead, ...winDead]) {
      const line = lines[victim.id] as PlayerLine;
      line.deaths++;
      ultPoints.set(victim.id, (ultPoints.get(victim.id) ?? 0) + 1);
    }
    lines[firstKiller.id]!.firstKills++;
    lines[firstVictim.id]!.firstDeaths++;
    for (const p of winSim.players) {
      if (winAlive.has(p.id) && !(killsThisRound[p.id] > 0) && rng.chance(0.42)) {
        lines[p.id]!.assists++;
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
      events,
      end: {
        win: winSide,
        how,
        alive: { A: winSide === "A" ? winnerAlive : loserAlive, B: winSide === "B" ? winnerAlive : loserAlive },
        score: [a, b],
      },
    });

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
  };
}

/** 玩家为该图保存的首选预案英雄分配（GDD §7.1），无则 undefined（引擎自动分配） */
function presetAgents(state: GameState, team: Team, mapId: string): Record<string, string> | undefined {
  const presets = team.presets[mapId];
  if (!presets || presets.length === 0) return undefined;
  const preferred = presets.find((p) => p.preferred) ?? presets[0];
  return preferred?.agents;
}

/** 模拟一场比赛（含 BP；mapLock/agentLock 优先——玩家赛前手动指定）。会累计生涯与赛后状态。 */
export function simMatch(state: GameState, teamAId: string, teamBId: string, bo: 1 | 3 | 5, seed: number, matchId: string, mapLock?: string[], agentLock?: Record<string, Record<string, string>>): MatchRecord {
  const rng = new Rng(seed);
  const teamA = state.teams[teamAId] as Team;
  const teamB = state.teams[teamBId] as Team;
  const veto = mapLock && mapLock.length > 0 ? { maps: mapLock.slice(), log: ["手动 BP"] } : runVeto(teamA, teamB, bo, rng);

  const makeSim = (side: "A" | "B", team: Team): SimTeam => {
    const roster = team.starters
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && p.injuredUntilDay <= day(state));
    const bench = team.roster
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && !roster.includes(p) && p.injuredUntilDay <= day(state))
      .sort((x, y) => effectiveOverall(y, day(state)) - effectiveOverall(x, day(state)));
    while (roster.length < 5 && bench.length) roster.push(bench.shift() as Player);
    return {
      side,
      team,
      str: null,
      players: roster.slice(0, 5),
      money: 800,
      lossStreak: 0,
      score: 0,
      ultReady: new Set(),
      timeouts: 2,
      call: null,
    };
  };

  const A = makeSim("A", teamA);
  const B = makeSim("B", teamB);

  const wins = { A: 0, B: 0 };
  const maps: MapRecord[] = [];
  const mvpAggregate: Record<string, number> = {};

  for (const mapId of veto.maps) {
    if (wins.A >= Math.ceil(bo / 2) || wins.B >= Math.ceil(bo / 2)) break;
    const mapRec = simMap(state, mapId, A, B, rng, agentLock);
    if (mapRec.score[0] > mapRec.score[1]) wins.A++;
    else if (mapRec.score[1] > mapRec.score[0]) wins.B++;
    maps.push(mapRec);
    for (const [pid, line] of Object.entries(mapRec.lines)) {
      mvpAggregate[pid] = (mvpAggregate[pid] ?? 0) + line.acs;
      const p = state.players[pid];
      if (p) {
        p.career.maps++;
        p.career.rounds += line.rounds;
        p.career.kills += line.kills;
        p.career.deaths += line.deaths;
        p.career.assists += line.assists;
        p.career.firstKills += line.firstKills;
        p.career.firstDeaths += line.firstDeaths;
        p.career.clutches += line.clutches;
      }
    }
    if (mapRec.mvp) {
      const p = state.players[mapRec.mvp];
      if (p) p.career.mvps++;
    }
  }

  let matchMvp: string | null = null;
  let matchMvpScore = -1;
  for (const [pid, acs] of Object.entries(mvpAggregate)) {
    const onWinning = wins.A > wins.B ? A.players.some((p) => p.id === pid) : B.players.some((p) => p.id === pid);
    const score = acs + (onWinning ? 18 : 0);
    if (score > matchMvpScore) {
      matchMvpScore = score;
      matchMvp = pid;
    }
  }

  // 赛后状态：疲劳按图数，状态/士气按胜负
  for (const t of [A, B]) {
    const won = wins[t.side] > wins[t.side === "A" ? "B" : "A"];
    for (const p of t.players) {
      p.fatigue = clamp(p.fatigue + maps.length * 5, 0, 100);
      p.form = clamp(p.form + (won ? 1 : -1), 30, 99);
      p.morale = clamp(p.morale + (won ? 2 : -2), 10, 100);
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
  };
}

function day(state: GameState): number {
  return state.day;
}
