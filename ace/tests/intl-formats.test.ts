/** 国际赛真实赛制回归（v1.0-3b）：Masters 瑞士轮+双败 / Champions GSL 小组+双败 / 冠军积分年度清零 / 确定性 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, resetPlayerSeq } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay, playHeldMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
/** 快进到指定日（翻年即停：day 回卷后条件自然不满足） */
function runTo(state: ReturnType<typeof generateWorld>, targetDay: number): void {
  const y0 = state.year;
  for (let d = 0; d < 500 && state.year === y0 && state.day < targetDay; d++) {
    advanceDay(state);
  }
}

test("Champions 年末赛（真实赛制）：16 队 4 组 GSL → 8 队双败，冠军记荣誉，翻年积分清零", () => {
  const state = generateWorld(7);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  runTo(state, 238); // 抽签日 236 已过
  const champ = state.comps["champions"];
  assert.ok(champ, "冠军赛应完成抽签");
  assert.equal(champ!.teamIds.length, 16, "每赛区积分前 4 × 4 赛区");
  for (const rid of ["americas", "emea", "pacific", "china"]) {
    const fromRegion = champ!.teamIds.filter((id) => state.teams[id]?.regionId === rid);
    assert.equal(fromRegion.length, 4, `${rid} 应 4 队`);
    assert.ok(fromRegion.every((id) => state.teams[id]?.tier === 1));
  }
  // 打完全程（小组 3 轮 + 淘汰赛，至 ~269 天；推进为次日检测制，固定推进到 330 天）
  for (let d = 0; d < 95; d++) {
    advanceDay(state);
  }
  const fx = state.fixtures.filter((f) => f.comp === "champions");
  assert.ok(fx.every((f) => f.played), "Champions 应全部打完");
  assert.equal(fx.filter((f) => f.label.endsWith("组 揭幕战")).length, 8, "4 组 × 2 场揭幕战");
  assert.equal(fx.filter((f) => /组 胜者组决赛$/.test(f.label)).length, 4);
  assert.equal(fx.filter((f) => /组 败者组决赛$/.test(f.label)).length, 4);
  assert.equal(fx.filter((f) => f.label.endsWith("组 出线决定赛")).length, 4);
  assert.equal(fx.filter((f) => f.label.endsWith("胜者组第1轮")).length, 4, "淘汰赛 8 队");
  assert.equal(fx.length, 34, "小组 20 + 双败树 14");
  const gf = fx.find((f) => f.label.includes("总决赛"))!;
  assert.equal(gf.bo, 5, "总决赛 BO5");
  const champId = gf.winnerTeamId!;
  assert.ok(champId, "世界冠军已决出");
  assert.ok(state.teams[champId]!.roster.every((pid) => state.players[pid]!.career.titles > 0), "冠军全队荣誉 +1");
  assert.ok(state.news.some((n) => n.text.includes("Champions 世界冠军赛冠军")), "世界冠军新闻");
  // 翻年：积分清零、旧赛程清空、新赛季开排
  runTo(state, 400); // 365 天翻年 → year+1, day 回卷
  assert.equal(state.year, 2027);
  assert.deepEqual(state.circuitPoints, {}, "冠军积分年度清零");
  assert.equal(state.comps["champions"], undefined, "旧年 comp 已清");
  assert.equal(state.comps["masters"], undefined, "旧年 Masters comp 已清");
  assert.ok(state.fixtures.some((f) => f.comp === "cup"), "新年揭幕杯已排");
});

test("确定性：同种子两次模拟，Masters/Champions 冠军逐位一致", () => {
  const run = (seed: number): { m: string; c: string } => {
    resetPlayerSeq();
    resetFixtureSeq();
    const s = generateWorld(seed);
    initSeasonFixtures(s);
    for (let d = 0; d < 340; d++) advanceDay(s); // 1→340 天覆盖两赛全程
    const m = s.fixtures.find((f) => f.comp === "masters" && f.label.includes("总决赛"));
    const c = s.fixtures.find((f) => f.comp === "champions" && f.label.includes("总决赛"));
    return { m: m?.winnerTeamId ?? "", c: c?.winnerTeamId ?? "" };
  };
  const a = run(42);
  const b = run(42);
  assert.ok(a.m && a.c, `两赛冠军都应决出（实际 m=${a.m} c=${a.c}）`);
  assert.deepEqual(a, b);
});

test("玩家全程停车路径：mineHold 拦截我的国际赛，赛后重放不卡赛程（次年两赛照常开打）", () => {
  const state = generateWorld(11);
  initSeasonFixtures(state);
  // 选一个大概率进国际赛的强队（揭幕杯参赛队 = 全局前 8）
  state.myTeamId = state.comps["cup"]!.teamIds[0]!;
  // 全年推进：我的每场比赛都停车，隔天补上（模拟玩家逐场 PreMatch）
  let pending: string | null = null;
  for (let d = 0; d < 700; d++) {
    advanceDay(
      state,
      [],
      undefined,
      (fixtureId) => {
        pending = fixtureId;
        return true;
      },
    );
    if (pending) {
      const rec = playHeldMatch(state, pending, {});
      assert.ok(rec, "停车比赛应可重放");
      pending = null;
    }
    // 第一年打完两赛即可收口（GF 后断言），翻年后再跑一小段验证次年开赛
    if (state.day > 300 && state.year === 2026) break;
  }
  const y1m = state.fixtures.find((f) => f.comp === "masters" && f.label.includes("总决赛"));
  const y1c = state.fixtures.find((f) => f.comp === "champions" && f.label.includes("总决赛"));
  assert.ok(y1m?.played && y1m.winnerTeamId, "停车路径下 Masters 决出冠军");
  assert.ok(y1c?.played && y1c.winnerTeamId, "停车路径下 Champions 决出冠军");
  // 冠军积分发过账（停车重放路径同样入账——v1.0-3b 检错修复点）
  assert.ok(Object.keys(state.circuitPoints ?? {}).length > 0, "冠军积分已入账");
  // 继续翻年：次年 Masters/Champions 照常
  for (let d = 0; d < 400 && state.year === 2026; d++) {
    advanceDay(state, []);
  }
  assert.equal(state.year, 2027, "已翻年");
  for (let d = 0; d < 340; d++) advanceDay(state, []);
  const y2m = state.fixtures.find((f) => f.comp === "masters" && f.label.includes("总决赛"));
  const y2c = state.fixtures.find((f) => f.comp === "champions" && f.label.includes("总决赛"));
  assert.ok(y2m?.played && y2m.winnerTeamId, "次年 Masters 决出冠军");
  assert.ok(y2c?.played && y2c.winnerTeamId, "次年 Champions 决出冠军");
});
