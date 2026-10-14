import { test } from "node:test";
import assert from "node:assert/strict";
import { liveLines, liveAcs, liveMeta, summarizeMatch, pickMvps } from "../src/core/sim/matchstats.ts";
import type { MapRecord, PlayerLine } from "../src/core/types.ts";

function line(p: Partial<PlayerLine>): PlayerLine {
  return { kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, damage: 0, rounds: 0, acs: 0, ...p };
}

function mapRec(lines: Record<string, PlayerLine>, events: { t: "kill"; s: string; v: string; first?: boolean; dmg?: number }[][]): MapRecord {
  return {
    map: "ascent",
    score: [13, 9],
    rounds: events.map((evs, i) => ({
      n: i + 1, atk: "A" as const, buys: { A: "full" as const, B: "eco" as const }, events: evs as never,
      end: { win: "A" as const, how: "elim" as const, alive: { A: 3, B: 1 }, score: [13, 9], assists: [] as string[], dmgBonus: {} as Record<string, number> },
    })),
    lines,
    mvp: null,
    agents: {},
    edges: { A: {}, B: {} } as never,
  };
}

test("实时战绩：播放进度内已揭示事件聚合，进度外不计", () => {
  const maps = [mapRec({}, [
    [{ t: "kill", s: "a1", v: "b1", first: true }, { t: "kill", s: "a1", v: "b2" }],
    [{ t: "kill", s: "b1", v: "a2" }],
  ])];
  // 第 2 回合只揭示到 0 号事件：b1 的击杀应计入，之前 a1 两杀一 FK（旧档击杀 dmg 缺省 150）
  const { lines: live, rounds } = liveLines(maps, { mi: 0, ri: 1, ei: 0 });
  assert.equal(live.a1?.k, 2);
  assert.equal(live.a1?.fk, 1);
  assert.equal(live.a1?.dmg, 300);
  assert.equal(live.b1?.d, 1);
  assert.equal(live.b2?.d, 1);
  assert.equal(live.b1?.k, 1);
  assert.equal(live.a2?.d, 1);
  assert.equal(rounds, 1); // 第 2 回合未完成，不计入 ACS 分母
  // 回退到第 1 回合：b1 无死亡
  const live2 = liveLines(maps, { mi: 0, ri: 0, ei: -1 });
  assert.equal(live2.lines.b1?.d ?? 0, 0);
  assert.equal(live2.lines.a1?.k ?? 0, 0);
  assert.equal(live2.rounds, 0);
});

test("实时 ACS：残伤与助攻随回合结果揭示，与赛后口径一致", () => {
  const maps = [mapRec({}, [
    [{ t: "kill", s: "a1", v: "b1", first: true, dmg: 150 }],
    [{ t: "kill", s: "b1", v: "a2" }],
  ])];
  maps[0]!.rounds[0]!.end.dmgBonus = { a1: 40 };
  maps[0]!.rounds[0]!.end.assists = ["b2"];
  maps[0]!.rounds[1]!.end.dmgBonus = { a1: 10 };
  // ei=1 ≥ events.length(1) → 第 2 回合结果已揭示：两回合全部计入
  const { lines: live, rounds } = liveLines(maps, { mi: 0, ri: 1, ei: 1 });
  assert.equal(rounds, 2);
  assert.equal(live.a1?.dmg, 200);
  assert.equal(live.b2?.a, 1);
  assert.equal(liveAcs(live.a1!.dmg, rounds), Math.round((200 / 2) * 1.45));
  // ei=-1 → 第 2 回合结果未揭示：残伤/助攻不计，分母 = 1
  const mid = liveLines(maps, { mi: 0, ri: 1, ei: -1 });
  assert.equal(mid.rounds, 1);
  assert.equal(mid.lines.a1?.dmg, 190);
  assert.equal(mid.lines.b2?.a ?? 0, 1); // 第 1 回合的助攻已揭示
});

test("赛后汇总：跨图求和、ACS 按回合加权、队属标注正确", () => {
  const maps = [
    mapRec({
      a1: line({ kills: 20, deaths: 12, assists: 5, firstKills: 3, firstDeaths: 2, clutches: 1, rounds: 22, acs: 280 }),
      b1: line({ kills: 14, deaths: 18, assists: 4, firstKills: 1, firstDeaths: 3, rounds: 22, acs: 200 }),
    }, []),
    mapRec({
      a1: line({ kills: 18, deaths: 14, assists: 7, firstKills: 2, firstDeaths: 1, rounds: 24, acs: 260 }),
      b1: line({ kills: 15, deaths: 16, assists: 6, firstKills: 2, firstDeaths: 2, clutches: 1, rounds: 24, acs: 220 }),
    }, []),
  ];
  const rows = summarizeMatch(maps, new Set(["a1"]));
  const a1 = rows.find((r) => r.pid === "a1")!;
  assert.equal(a1.k, 38);
  assert.equal(a1.d, 26);
  assert.equal(a1.a, 12);
  assert.equal(a1.fk, 5);
  assert.equal(a1.fd, 3);
  assert.equal(a1.clutches, 1);
  assert.equal(a1.team, "A");
  assert.equal(a1.acs, Math.round((280 * 22 + 260 * 24) / 46));
  const b1 = rows.find((r) => r.pid === "b1")!;
  assert.equal(b1.team, "B");
  // 按 ACS 降序
  assert.ok(rows[0]!.acs >= rows[rows.length - 1]!.acs);
});

test("结算 MVP 派生：总 MVP=胜方最佳，SMVP=败方最佳", () => {
  const maps = [mapRec({
    a1: line({ kills: 18, deaths: 14, rounds: 22, acs: 260 }),
    a2: line({ kills: 20, deaths: 12, rounds: 22, acs: 290 }),
    b1: line({ kills: 22, deaths: 11, rounds: 22, acs: 310 }),
  }, [])];
  const rows = summarizeMatch(maps, new Set(["a1", "a2"]));
  // 全局 ACS 最高是败方 b1（310），但总 MVP 必须取胜方最佳 a2，b1 标 SMVP
  const { mvp, smvp } = pickMvps(rows, "A");
  assert.equal(mvp, "a2");
  assert.equal(smvp, "b1");
});


test("实时元数据：大招进度与经济随回合结果揭示，旧档缺省安全", () => {
  const maps = [mapRec({}, [
    [{ t: "kill", s: "a1", v: "b1" }],
    [{ t: "kill", s: "b1", v: "a2" }],
  ])];
  maps[0]!.rounds[0]!.end.ults = { a1: 7, b1: 3 };
  maps[0]!.rounds[0]!.end.money = { A: 3900, B: 1900 };
  maps[0]!.rounds[1]!.end.ults = { a1: 7, b1: 4 };
  maps[0]!.rounds[1]!.end.money = { A: 5000, B: 2800 };
  // ei=-1 → 第 2 回合未完成：元数据停留在第 1 回合快照
  const m1 = liveMeta(maps, { mi: 0, ri: 1, ei: -1 });
  assert.equal(m1.ults.b1, 3);
  assert.equal(m1.money?.A, 3900);
  // ei=0 ≥ events.length(1) → 第 2 回合完成：快照推进
  const m2 = liveMeta(maps, { mi: 0, ri: 1, ei: 1 });
  assert.equal(m2.ults.b1, 4);
  assert.equal(m2.ults.a1, 7);
  assert.equal(m2.money?.A, 5000);
  // 旧档：无 ults/money 字段 → 空对象与 null
  const bare = [mapRec({}, [[{ t: "kill", s: "a1", v: "b1" }]])];
  const m3 = liveMeta(bare, { mi: 0, ri: 0, ei: 0 });
  assert.deepEqual(m3.ults, {});
  assert.equal(m3.money, null);
});
