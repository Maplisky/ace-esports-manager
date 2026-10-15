/** 回放分享回归（v1.0-12，GDD §9.4/§14）：编解码往返 / 匿名化脱敏与确定性 / 坏输入拒绝。
 *  Node ≥18 提供 CompressionStream（deflate 路径真实覆盖）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, playHeldMatch } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { buildReplayPayload, anonymizeReplay, encodeReplay, decodeReplay } from "../src/core/sim/share.ts";
import type { GameState } from "../src/core/types.ts";

function build(seed = 141): GameState {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).find((t) => t.tier === 1)!.id;
  return state;
}

test("编解码往返：deflate 与明文两条路径均逐位还原（他人点开即看同一比赛）", async () => {
  const s = build();
  const f = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId))!;
  const rec = playHeldMatch(s, f.id, {})!;
  const p = buildReplayPayload(s, rec);
  const code = await encodeReplay(p);
  assert.ok(code.length > 100);
  console.log(`[share] BO${f.bo} 压缩编码长度 = ${(code.length / 1024).toFixed(1)}KB（GDD 目标 ≤8KB，BO1 达标）`);
  const back = await decodeReplay(code);
  assert.ok(back, "deflate 路径解码成功");
  assert.equal(JSON.stringify(back!.rec), JSON.stringify(rec), "Record 逐位一致");
  assert.equal(back!.teams.A.tag, p.teams.A.tag);
  // 明文回退路径（前缀 0）：手工构造
  const plain = "0" + Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  const back2 = await decodeReplay(plain);
  assert.ok(back2, "明文路径解码成功");
  assert.equal(JSON.stringify(back2!.rec), JSON.stringify(rec));
});

test("匿名化：真实选手/队名零残留；确定性（两次导出同名）", async () => {
  const s = build(142);
  const f = s.fixtures.find((x) => !x.played && x.teamA !== "" && x.teamB !== "" && (x.teamA === s.myTeamId || x.teamB === s.myTeamId))!;
  const rec = playHeldMatch(s, f.id, {})!;
  const p = buildReplayPayload(s, rec);
  const anon = anonymizeReplay(p);
  const text = JSON.stringify(anon);
  for (const pid of Object.keys(p.players)) {
    const ign = p.players[pid]!.ign;
    assert.notEqual(anon.players[pid]!.ign, ign, `选手 ${ign} 必须换名`);
  }
  assert.ok(!text.includes(p.teams.A.name) && !text.includes(p.teams.B.name), "队名脱敏");
  assert.ok(!text.includes(`"${p.teams.A.tag}"`) && !text.includes(`"${p.teams.B.tag}"`), "队标脱敏（带引号精确匹配，避开 how:spike 等枚举值）");
  const anon2 = anonymizeReplay(buildReplayPayload(s, rec));
  assert.equal(JSON.stringify(anon2.players), JSON.stringify(anon.players), "同 id 稳定同名");
  // 匿名编码可解码
  const code = await encodeReplay(anon);
  const back = await decodeReplay(code);
  assert.ok(back);
  assert.equal(back!.players[Object.keys(anon.players)[0]!]!.ign, anon.players[Object.keys(anon.players)[0]!]!.ign);
});

test("坏输入拒绝：非法前缀/坏 base64/坏 JSON/缺结构", async () => {
  assert.equal(await decodeReplay(""), null);
  assert.equal(await decodeReplay("2abcd"), null, "未知版本前缀拒绝");
  assert.equal(await decodeReplay("1!!!not-base64!!!"), null);
  assert.equal(await decodeReplay("0" + Buffer.from("not json").toString("base64url")), null);
  assert.equal(await decodeReplay("0" + Buffer.from(JSON.stringify({ v: 1, rec: { maps: [] } })).toString("base64url")), null, "缺 teams/players 拒绝");
});
