/**
 * 设计 playtest（v1.0-14 发布闸门，GDD §12 验收基准）：
 *  1) 三档难度 × t2 开局整赛季——我的胜率（普通 45-60% 目标）、预算低谷（无意外破产）、教练存活；
 *  2) 全 AI 世界 10 季——冠军分散度 HHI < 0.18（防一家独大）。
 * 用法：node tools/playtest.mjs
 */
import { resetPlayerSeq, generateWorld } from "../src/core/worldgen.ts";
import { initSeasonFixtures, advanceDay } from "../src/core/sim/day.ts";
import { resetFixtureSeq } from "../src/core/sim/fixtures.ts";
import { initCareer } from "../src/core/sim/career.ts";

function seasonOnce(seed, difficulty, tier = 2) {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  initSeasonFixtures(state);
  state.myTeamId = Object.values(state.teams).filter((t) => t.tier === tier).sort((a, b) => a.id.localeCompare(b.id))[0].id;
  initCareer(state, "grassroots");
  state.difficulty = difficulty;
  const startYear = state.year;
  const my = state.teams[state.myTeamId];
  let minBudget = my.budget;
  let days = 0;
  while (state.year === startYear && days < 400) {
    advanceDay(state, []);
    minBudget = Math.min(minBudget, my.budget);
    days++;
  }
  const c = state.manager.career;
  const n = c.wins + c.losses;
  return {
    difficulty, seed, days,
    wins: c.wins, losses: c.losses, n,
    winrate: n > 0 ? +(c.wins / n * 100).toFixed(1) : null,
    titles: c.titles,
    minBudget,
    ending: c.ending?.kind ?? null,
  };
}

function hhiTenSeasons(seed) {
  resetPlayerSeq();
  resetFixtureSeq();
  const state = generateWorld(seed);
  state.myTeamId = null; // 全 AI 世界
  initSeasonFixtures(state);
  const titles = new Map();
  const startYear = state.year;
  let guard = 0;
  while (state.year < startYear + 10 && guard < 4200) {
    const notes = [];
    advanceDay(state, notes);
    for (const item of notes) {
      const m = /^🏆 (.+?) (?:摘得|夺得)/.exec(item.text ?? "");
      if (m) titles.set(m[1], (titles.get(m[1]) ?? 0) + 1);
    }
    guard++;
  }
  const total = [...titles.values()].reduce((s, v) => s + v, 0);
  const hhi = total > 0 ? [...titles.values()].reduce((s, v) => s + (v / total) ** 2, 0) : 1;
  return { seasons: state.year - startYear, distinctChamps: titles.size, totalTitles: total, hhi: +hhi.toFixed(4) };
}

const rows = [];
for (const diff of ["normal", "hard", "pro"]) {
  for (const seed of [2026, 4096, 515, 8126]) rows.push(seasonOnce(seed, diff));
}
console.table(rows.map(({ difficulty, seed, days, wins, losses, winrate, titles, minBudget, ending }) => ({
  难度: difficulty, seed, 天数: days, 胜: wins, 负: losses, 胜率: winrate === null ? "—" : winrate + "%", 冠军: titles,
  预算低谷: "$" + Math.round(minBudget / 1000) + "K", 终局: ending ?? "在任",
})));

const normal = rows.filter((r) => r.difficulty === "normal");
const normalAgg = normal.reduce((s, r) => s + r.wins, 0) / Math.max(1, normal.reduce((s, r) => s + r.n, 0));
console.log(`\n[gate] 普通难度 t2 综合胜率 = ${(normalAgg * 100).toFixed(1)}%（目标 45-60%）`);
console.log(`[gate] 预算低谷（全部档） = $${Math.min(...rows.map((r) => r.minBudget)).toLocaleString()}（无深度破产=不显著低于 -$100K）`);
const endings = rows.filter((r) => r.ending);
console.log(`[gate] 首季下课/终局 = ${endings.length ? endings.map((e) => `${e.difficulty}/${e.seed}:${e.ending}`).join(", ") : "无"}`);

const hhi = hhiTenSeasons(777);
console.log(`\n[gate] 全 AI 十季 HHI = ${hhi.hhi}（< 0.18 目标）；${hhi.seasons} 季 ${hhi.totalTitles} 冠分布给 ${hhi.distinctChamps} 队`);
