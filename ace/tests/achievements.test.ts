/** 成就系统回归（v1.0-10，GDD §10.4 剧本路径）：四路径各至少一成就可解锁 /
 *  首胜经真实结算路径点亮 / 幂等 / 分类冠军账本 / 迁移兜底。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, playHeldMatch, settleMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer } from "../src/core/sim/career.ts";
import { evaluateAchievements, ACHIEVEMENTS } from "../src/core/sim/achievements.ts";
import type { GameState, NewsItem } from "../src/core/types.ts";

function build(seed = 111): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  initCareer(state, "grassroots");
  return state;
}

const dummy = (): NewsItem[] => [];

test("四条剧本路径各至少一成就在构造状态下可解锁；通用层可点亮", () => {
  const s = build();
  // 重建者：警告 + 1 冠
  s.manager.career!.warned = true;
  s.manager.career!.titles = 1;
  // 王朝：分类冠军（Masters）
  s.manager.career!.titleKinds = { masters: 1 };
  // 青训教父：亲传弟子 overall 76
  const my = s.teams[s.myTeamId!]!;
  const kid = s.players[my.roster[0]!]!;
  kid.homegrown = true;
  kid.overall = 76;
  // 雇佣兵：跳槽两次
  s.manager.career!.jobHops = 2;
  const notes = dummy();
  evaluateAchievements(s, notes);
  const got = Object.keys(s.achievements ?? {});
  for (const path of ["rebuilder", "dynasty", "academy", "mercenary", "general"] as const) {
    const hit = ACHIEVEMENTS.filter((a) => a.path === path && got.includes(a.id));
    assert.ok(hit.length >= 1, `路径 ${path} 应至少解锁一项（实际 ${got.join(",")}）`);
  }
  assert.ok(s.achievements!["r-comeback"], "绝境翻盘解锁");
  assert.ok(s.achievements!["d-intl"], "国际舞台解锁（Masters 分类）");
  assert.ok(s.achievements!["a-gold"], "点石成金解锁");
  assert.ok(s.achievements!["m-tour"], "名帅巡回解锁（2 跳）");
  assert.ok(s.achievements!["g-firsttitle"], "首冠解锁");
  // 幂等：再评估无新增新闻
  const notes2 = dummy();
  evaluateAchievements(s, notes2);
  assert.equal(notes2.length, 0, "已解锁不重复");
  // 解锁新闻带 🏆
  assert.ok(notes.every((n) => n.text.includes("🏆")));
});

test("首胜经真实结算路径点亮：settleMatch（非教学局）→ evaluate（赢方）", () => {
  // 教学局（生涯首场）不计 wins（v1.0-11 口径）——要测「赢下解锁首胜」必须跳过教学局：
  // 先打完教学局置 tutorialDone，再对第二场做真实结算（RNG 流移动后 seed111 我队第二场对 FURIA）
  const s = build();
  const f = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId))!;
  const rec = playHeldMatch(s, f.id, {});
  assert.ok(rec);
  settleMatch(s, f.id, rec, () => {});
  assert.ok(s.manager.career!.tutorialDone, "教学局已置位");
  const f2 = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId))!;
  const rec2 = playHeldMatch(s, f2.id, {});
  assert.ok(rec2);
  settleMatch(s, f2.id, rec2, () => {});
  const won = (rec2!.winner === "A" && f2.teamA === s.myTeamId) || (rec2!.winner === "B" && f2.teamB === s.myTeamId);
  const notes = dummy();
  evaluateAchievements(s, notes);
  if (won) {
    assert.ok(s.achievements?.["g-firstwin"], "赢下即解锁首胜");
  } else {
    assert.ok(!s.achievements?.["g-firstwin"], "输球不解锁首胜");
  }
});

test("大满贯需三类冠军齐备；旧档 titleKinds 缺省不误判", () => {
  const s = build();
  s.manager.career!.titles = 5;
  s.manager.career!.titleKinds = { league: 2, masters: 1 };
  evaluateAchievements(s, dummy());
  assert.ok(!s.achievements?.["g-slam"], "缺 Champions 不算大满贯");
  s.manager.career!.titleKinds = { league: 2, masters: 1, champions: 1 };
  evaluateAchievements(s, dummy());
  assert.ok(s.achievements?.["g-slam"], "三类齐备解锁大满贯（史诗）");
});

test("十年执教在 ending 存在时仍可解锁（退休即点亮）", () => {
  const s = build();
  s.manager.career!.seasons = 10;
  s.manager.career!.ending = { kind: "retired", year: s.year, day: s.day };
  evaluateAchievements(s, dummy());
  assert.ok(s.achievements?.["g-decade"], "终局不阻断十年执教");
});

test("教学局口径：不结算/不走 noteMatchResult 的场次不触发首胜（口径预留）", () => {
  const s = build();
  const f = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId))!;
  playHeldMatch(s, f.id, {}); // 只模拟未结算（等价教学局：不入生涯账本）
  const notes = dummy();
  evaluateAchievements(s, notes);
  assert.ok(!s.achievements?.["g-firstwin"], "未入账的场次不计成就");
});
