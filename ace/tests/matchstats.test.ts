import { test } from "node:test";
import assert from "node:assert/strict";
import { liveLines, summarizeMatch } from "../src/core/sim/matchstats.ts";
import type { MapRecord, PlayerLine } from "../src/core/types.ts";

function line(p: Partial<PlayerLine>): PlayerLine {
  return { kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, damage: 0, rounds: 0, acs: 0, ...p };
}

function mapRec(lines: Record<string, PlayerLine>, events: { t: "kill"; s: string; v: string; first?: boolean }[][]): MapRecord {
  return {
    map: "ascent",
    score: [13, 9],
    rounds: events.map((evs, i) => ({
      n: i + 1, atk: "A" as const, buys: { A: "full" as const, B: "eco" as const }, events: evs as never,
      end: { win: "A" as const, how: "elim" as const, alive: { A: 3, B: 1 }, score: [13, 9] },
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
  // 第 2 回合只揭示到 0 号事件：b1 的击杀应计入，之前 a1 两杀一 FK
  const live = liveLines(maps, { mi: 0, ri: 1, ei: 0 });
  assert.equal(live.a1?.k, 2);
  assert.equal(live.a1?.fk, 1);
  assert.equal(live.b1?.d, 1);
  assert.equal(live.b2?.d, 1);
  assert.equal(live.b1?.k, 1);
  assert.equal(live.a2?.d, 1);
  // 回退到第 1 回合：b1 无死亡
  const live2 = liveLines(maps, { mi: 0, ri: 0, ei: -1 });
  assert.equal(live2.b1?.d ?? 0, 0);
  assert.equal(live2.a1?.k ?? 0, 0);
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
