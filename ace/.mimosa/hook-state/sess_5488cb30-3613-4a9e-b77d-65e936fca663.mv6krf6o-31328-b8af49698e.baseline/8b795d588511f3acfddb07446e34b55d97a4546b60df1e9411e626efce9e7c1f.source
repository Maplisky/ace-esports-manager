/**
 * 赛程生成（GDD §4.2 v0.1）：揭幕杯（单败）+ Stage1 双循环联赛。
 * 联赛用循环赛轮转法；杯赛整棵树一次生成，后轮 teamA/teamB 留空由日推进回填。
 */
import { Rng } from "../rng.ts";
import type { Fixture } from "../types.ts";

let fixtureSeq = 0;

export function resetFixtureSeq(): void {
  fixtureSeq = 0;
}

function mkFixture(f: Omit<Fixture, "id" | "played">): Fixture {
  return { ...f, id: `F${fixtureSeq++}`, played: false };
}

/** 单循环（轮转法），返回每轮的对阵；rng 决定主队顺序洗牌 */
export function roundRobin(teamIds: string[], rng: Rng): [string, string][][] {
  const ids = rng.shuffle(teamIds);
  const n = ids.length;
  const rounds: [string, string][][] = [];
  if (n < 2) return rounds;
  const arr = ids.slice();
  const half = n / 2;
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i] as string;
      const b = arr[n - 1 - i] as string;
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

/** 杯赛回填：某场打完后把胜者写进下一轮空位 */
export function fillNextSlot(fixtures: Fixture[], finished: Fixture, winnerTeamId: string): void {
  if (!finished.nextFixtureId) return;
  const next = fixtures.find((f) => f.id === finished.nextFixtureId);
  if (!next) return;
  if (next.teamA === "") next.teamA = winnerTeamId;
  else if (next.teamB === "") next.teamB = winnerTeamId;
}
