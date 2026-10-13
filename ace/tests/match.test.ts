import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/core/rng.ts";
import { generateWorld, makeSyntheticTeam, resetPlayerSeq } from "../src/core/worldgen.ts";
import { simMatch } from "../src/core/sim/match.ts";

function buildTwoTeamState(a: number, b: number, seed = 1) {
  resetPlayerSeq();
  const rng = new Rng(seed);
  const t1 = makeSyntheticTeam("TA", "强队", a, rng);
  const t2 = makeSyntheticTeam("TB", "弱队", b, rng);
  const state = generateWorld(seed);
  state.teams["TA"] = t1.team;
  state.teams["TB"] = t2.team;
  for (const p of t1.players) state.players[p.id] = p;
  for (const p of t2.players) state.players[p.id] = p;
  state.day = 30;
  return { state, teamA: t1.team, teamB: t2.team };
}

test("比赛引擎：确定性（同 seed 同结果，各自从干净状态出发）", () => {
  const build = () => {
    const s = buildTwoTeamState(80, 78, 99);
    return s;
  };
  const s1 = build();
  const s2 = build();
  const r1 = simMatch(s1.state, "TA", "TB", 3, 5555, "M1");
  const r2 = simMatch(s2.state, "TA", "TB", 3, 5555, "M1");
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test("比赛引擎：不同 seed 结果发散", () => {
  const { state } = buildTwoTeamState(80, 78, 99);
  const scores = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const r = simMatch(state, "TA", "TB", 3, 1000 + i, `M${i}`);
    scores.add(r.score.join("-"));
  }
  assert.ok(scores.size > 1, "30 场只有一个比分说明 RNG 失效");
});

test("比赛引擎：结构与规则健全", () => {
  const { state } = buildTwoTeamState(80, 76, 5);
  for (let i = 0; i < 20; i++) {
    const r = simMatch(state, "TA", "TB", 3, i * 13 + 1, `S${i}`);
    // 比分合法：胜方 ≥2 图，BO3 无 3 图全胜
    assert.ok(r.score[0] === 2 || r.score[1] === 2, `比分 ${r.score.join("-")}`);
    assert.ok(r.score[0] <= 2 && r.score[1] <= 2);
    for (const m of r.maps) {
      const [a, b] = m.score;
      assert.ok(a >= 0 && b >= 0);
      // 先到 13 且领先 2（或 80 回合上限的极端截断）
      const done = (a >= 13 && a - b >= 2) || (b >= 13 && b - a >= 2) || a + b >= 80;
      assert.ok(done, `地图未结束 ${a}-${b}`);
      // 回合事件流健全
      for (const rd of m.rounds) {
        assert.ok(rd.n >= 1 && rd.n <= 80);
        const kills = rd.events.filter((e) => e.t === "kill").length;
        assert.ok(kills >= 1, "每回合至少一次击杀");
        const deathsInEvents = rd.events.filter((e) => e.t === "kill").length;
        assert.ok(deathsInEvents <= 10);
        assert.ok(["elim", "spike", "defuse", "time"].includes(rd.end.how));
      }
      // lines 守恒：总击杀 = 总死亡
      let tk = 0;
      let td = 0;
      for (const line of Object.values(m.lines)) {
        tk += line.kills;
        td += line.deaths;
      }
      assert.equal(tk, td, "击杀/死亡守恒");
      assert.ok(m.mvp !== null && state.players[m.mvp] !== undefined);
    }
    // 每方恰赢 2 图
    assert.ok(r.score[0] === 2 || r.score[1] === 2);
  }
});

test("比赛引擎：大招就绪事件存在且档位合法", () => {
  const { state } = buildTwoTeamState(80, 78, 42);
  let sawUlt = false;
  for (let i = 0; i < 10; i++) {
    const r = simMatch(state, "TA", "TB", 3, 9000 + i, `U${i}`);
    for (const m of r.maps) {
      for (const rd of m.rounds) {
        for (const e of rd.events) {
          if (e.t === "ultReady") {
            sawUlt = true;
            assert.ok(["core", "harvest", "combo", "utility", "info"].includes(e.tier ?? ""));
          }
        }
      }
    }
  }
  assert.ok(sawUlt, "40+ 回合里应出现大招就绪");
});
