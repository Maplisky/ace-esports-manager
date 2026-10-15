/**
 * 赛程生成（GDD §4.2 v0.1）：揭幕杯（单败）+ Stage1 双循环联赛。
 * 联赛用循环赛轮转法；杯赛整棵树一次生成，后轮 teamA/teamB 留空由日推进回填。
 */
import { Rng } from "../rng.ts";
import type { Fixture } from "../types.ts";

let fixtureSeq = 0;

function mkFixture(f: Omit<Fixture, "id" | "played">): Fixture {
  return { ...f, id: `F${fixtureSeq++}`, played: false };
}

/** 供动态赛程（瑞士轮下一轮/GSL 后续轮）安全创建 fixture：id 全局唯一，避免与计数器撞号 */
export function createFixture(f: Omit<Fixture, "id" | "played">): Fixture {
  return mkFixture(f);
}

/** 供测试：重置全局 fixture 计数器（同进程多次 generateWorld 时保证 id/种子可复现） */
export function resetFixtureSeq(): void {
  fixtureSeq = 0;
}

/** 单循环（轮转法），返回每轮的对阵；rng 决定主队顺序洗牌 */
function roundRobin(teamIds: string[], rng: Rng): [string, string][][] {
  const ids = rng.shuffle(teamIds);
  const n0 = ids.length;
  const rounds: [string, string][][] = [];
  if (n0 < 2) return rounds;
  // 奇数队：补 BYE 占位（该轮轮空），配对时跳过含 BYE 的对
  const BYE = "__BYE__";
  const ids2 = n0 % 2 === 1 ? [...ids, BYE] : ids.slice();
  const n = ids2.length;
  const arr = ids2.slice();
  const half = n / 2;
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i] as string;
      const b = arr[n - 1 - i] as string;
      if (a === BYE || b === BYE) continue;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    // 轮转：固定首位，其余顺移
    const fixed = arr[0] as string;
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

/** 双循环联赛赛程 */
export function buildLeague(
  stateFixtures: Fixture[],
  opts: { comp: string; name: string; stage: Fixture["stage"]; teamIds: string[]; startDay: number; endDay: number; bo: 1 | 3 | 5; rng: Rng },
): void {
  const first = roundRobin(opts.teamIds, opts.rng);
  const second = first.map((round) => round.map(([a, b]) => [b, a] as [string, string]));
  const allRounds = [...first, ...second];
  const rounds = allRounds.length;
  const step = Math.max(1, Math.floor((opts.endDay - opts.startDay) / Math.max(1, rounds - 1)));
  allRounds.forEach((pairs, ri) => {
    const day = opts.startDay + ri * step;
    for (const [a, b] of pairs) {
      stateFixtures.push(mkFixture({
        day, stage: opts.stage, comp: opts.comp, teamA: a, teamB: b,
        bo: opts.bo, label: `${opts.name} 第${ri + 1}轮`,
      }));
    }
  });
}

/** 单败杯赛：整棵树生成（8 队，QF→SF→Final），后轮对阵留空待回填 */
export function buildCup(
  stateFixtures: Fixture[],
  opts: { comp: string; name: string; stage: Fixture["stage"]; teamIds: string[]; startDay: number; gapDays: number; bo: 1 | 3 | 5; rng: Rng },
): { roundFixtureIds: string[][] } {
  const seeded = opts.rng.shuffle(opts.teamIds);
  const qf: Fixture[] = [];
  const sf: Fixture[] = [];
  const final: Fixture[] = [];
  for (let i = 0; i < 4; i++) {
    const f = mkFixture({
      day: opts.startDay, stage: opts.stage, comp: opts.comp,
      teamA: seeded[i * 2] as string, teamB: seeded[i * 2 + 1] as string,
      bo: opts.bo, label: `${opts.name} 四分之一决赛`,
    });
    qf.push(f);
  }
  for (let i = 0; i < 2; i++) {
    const f = mkFixture({
      day: opts.startDay + opts.gapDays, stage: opts.stage, comp: opts.comp,
      teamA: "", teamB: "", bo: opts.bo, label: `${opts.name} 半决赛`,
    });
    sf.push(f);
  }
  const f = mkFixture({
    day: opts.startDay + opts.gapDays * 2, stage: opts.stage, comp: opts.comp,
    teamA: "", teamB: "", bo: 5, label: `${opts.name} 总决赛`,
  });
  final.push(f);
  // 连接树
  (qf[0] as Fixture).nextFixtureId = sf[0]!.id;
  (qf[1] as Fixture).nextFixtureId = sf[0]!.id;
  (qf[2] as Fixture).nextFixtureId = sf[1]!.id;
  (qf[3] as Fixture).nextFixtureId = sf[1]!.id;
  (sf[0] as Fixture).nextFixtureId = final[0]!.id;
  (sf[1] as Fixture).nextFixtureId = final[0]!.id;
  stateFixtures.push(...qf, ...sf, ...final);
  return { roundFixtureIds: [qf.map((x) => x.id), sf.map((x) => x.id), final.map((x) => x.id)] };
}

/** 杯赛回填：胜者进 nextFixtureId；双败树败者进 nextLoserFixtureId */
export function fillNextSlot(fixtures: Fixture[], finished: Fixture, winnerTeamId: string): void {
  const loserTeamId = finished.teamA === winnerTeamId ? finished.teamB : finished.teamA;
  const route = (targetId: string | undefined, teamId: string): void => {
    if (!targetId) return;
    const next = fixtures.find((f) => f.id === targetId);
    if (!next) return;
    if (next.teamA === "") next.teamA = teamId;
    else if (next.teamB === "") next.teamB = teamId;
  };
  route(finished.nextFixtureId, winnerTeamId);
  route(finished.nextLoserFixtureId, loserTeamId);
}

/**
 * 瑞士轮配对（v1.0-3b 真实赛制）：同战绩一组、组内相邻配对，优先避同赛区与重赛。
 * 确定性：组内按败场升序 + 队 id 稳定排序，不耗 rng。
 */
export function pairSwissRound(
  entries: { teamId: string; wins: number; losses: number }[],
  regionOf: (teamId: string) => string,
  playedPairs: Set<string>,
): [string, string][] {
  const pk = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const byWins = new Map<number, { teamId: string; wins: number; losses: number }[]>();
  for (const e of entries) {
    const arr = byWins.get(e.wins) ?? [];
    arr.push(e);
    byWins.set(e.wins, arr);
  }
  const pairs: [string, string][] = [];
  for (const w of [...byWins.keys()].sort((a, b) => b - a)) {
    const pool = (byWins.get(w) ?? [])
      .slice()
      .sort((a, b) => a.losses - b.losses || (a.teamId < b.teamId ? -1 : 1))
      .map((e) => e.teamId);
    while (pool.length >= 2) {
      const a = pool.shift() as string;
      let idx = pool.findIndex((b) => regionOf(b) !== regionOf(a) && !playedPairs.has(pk(a, b)));
      if (idx < 0) idx = pool.findIndex((b) => !playedPairs.has(pk(a, b)));
      if (idx < 0) idx = 0;
      pairs.push([a, pool.splice(idx, 1)[0] as string]);
    }
    // 奇数落单：本轮轮空（8 队两胜制正常流程不会出现）
  }
  return pairs;
}

/** 生成瑞士轮一轮 fixtures（对阵由调用方给出：首轮跨赛区、后续轮按战绩配对） */
export function buildSwissRound(
  stateFixtures: Fixture[],
  opts: { comp: string; name: string; stage: Fixture["stage"]; pairs: [string, string][]; day: number; roundNo: number; bo: 1 | 3 | 5 },
): void {
  for (const [a, b] of opts.pairs) {
    stateFixtures.push(mkFixture({
      day: opts.day, stage: opts.stage, comp: opts.comp, teamA: a, teamB: b,
      bo: opts.bo, label: `${opts.name} 瑞士轮第${opts.roundNo}轮`,
    }));
  }
}

/**
 * 8 队双败淘汰树（v1.0-3b 真实赛制，Masters/Champions 淘汰赛共用）：
 * 胜者组 3 轮 + 败者组 4 轮 + BO5 总决赛；胜者经 nextFixtureId 前进、败者经 nextLoserFixtureId 落败者组。
 * 对阵 pairs 由调用方排定（种子回避逻辑在调用方），本函数只负责建树接线。
 */
export function buildDoubleElim(
  stateFixtures: Fixture[],
  opts: { comp: string; name: string; stage: Fixture["stage"]; pairs: [string, string][]; startDay: number; gapDays: number; bo: 1 | 3 | 5 },
): { roundFixtureIds: string[][] } {
  const mk = (day: number, label: string, a = "", b = ""): Fixture => {
    const f = mkFixture({ day, stage: opts.stage, comp: opts.comp, teamA: a, teamB: b, bo: opts.bo, label: `${opts.name} ${label}` });
    stateFixtures.push(f);
    return f;
  };
  const ubR1 = opts.pairs.map(([a, b]) => mk(opts.startDay, "胜者组第1轮", a, b));
  const ubSf = [0, 1].map(() => mk(opts.startDay + opts.gapDays, "胜者组半决赛"));
  const ubF = mk(opts.startDay + opts.gapDays * 2, "胜者组决赛");
  const lbR1 = [0, 1].map(() => mk(opts.startDay + opts.gapDays, "败者组第1轮"));
  const lbR2 = [0, 1].map(() => mk(opts.startDay + opts.gapDays * 2, "败者组第2轮"));
  const lbR3 = mk(opts.startDay + opts.gapDays * 3, "败者组第3轮");
  const lbF = mk(opts.startDay + opts.gapDays * 4, "败者组决赛");
  const final = mk(opts.startDay + opts.gapDays * 5, "总决赛");
  final.bo = 5;
  // 接线：胜者前进 / 败者落入败者组（喂给方比赛日恒早于被喂方，回填顺序确定）
  ubR1.forEach((f, i) => {
    f.nextFixtureId = ubSf[i >> 1]!.id;
    f.nextLoserFixtureId = lbR1[i >> 1]!.id;
  });
  ubSf.forEach((f, i) => {
    f.nextFixtureId = ubF.id;
    f.nextLoserFixtureId = lbR2[i]!.id;
  });
  ubF.nextFixtureId = final.id;
  ubF.nextLoserFixtureId = lbF.id;
  lbR1.forEach((f, i) => { f.nextFixtureId = lbR2[i]!.id; });
  lbR2.forEach((f) => { f.nextFixtureId = lbR3.id; });
  lbR3.nextFixtureId = lbF.id;
  lbF.nextFixtureId = final.id;
  return {
    roundFixtureIds: [
      ubR1.map((f) => f.id), ubSf.map((f) => f.id), [ubF.id],
      lbR1.map((f) => f.id), lbR2.map((f) => f.id), [lbR3.id], [lbF.id], [final.id],
    ],
  };
}
