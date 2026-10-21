/**
 * career 黄金轨迹记录器：天赋/出身/进修/胜负下课/周检查/冠军账本/跳槽/五年之约与十年退休 全路径。
 * 世界夹具 generateWorld(42)。运行：node tools/golden-career.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import {
  applyTalents, selfStudy, initCareer, noteMatchResult, careerWeeklyTick,
  noteManagerTitle, jobOffers, discipleCount, applyJob, checkCareerMilestone,
  resolveMilestoneCard, MILESTONE_CARD_ID, TALENT_PRESETS,
} from '../src/core/sim/career.ts';
import { Rng } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const buildState = () => {
  resetWorldSeq();
  const s = generateWorld(42);
  s.myTeamId = Object.values(s.teams)[2].id;
  return s;
};
// worldgen 序列重置（与 C# resetSeq 对齐）
import { resetPlayerSeq } from '../src/core/worldgen.ts';
function resetWorldSeq() { resetPlayerSeq(); }

const out = { meta: { generator: 'ace/tools/golden-career.mjs', authority: 'ace/src/core/sim/career.ts' }, cases: {} };

// ① 天赋四套预设快照 + 应用 + 出身三选（skills/rep/wallet/budget 差异）
{
  const state = buildState();
  const presets = TALENT_PRESETS.map((p) => ({ key: p.key, points: Object.fromEntries(Object.entries(p.points)) }));
  applyTalents(state, presets[1].points);
  initCareer(state, 'legend');
  out.cases.talents = {
    presets,
    skills: { ...state.manager.skills },
    reputation: state.manager.reputation,
    wallet: state.manager.life.wallet,
    career: state.manager.career,
  };
}
{
  const state = buildState();
  initCareer(state, 'grassroots');
  out.cases.originGrassroots = { skills: { ...state.manager.skills }, budget: state.teams[state.myTeamId].budget };
}
{
  const state = buildState();
  initCareer(state, 'analyst');
  out.cases.originAnalyst = { skills: { ...state.manager.skills }, reputation: state.manager.reputation };
}

// ② 进修：正常 / 钱包不足 / 达上限
{
  const state = buildState();
  state.manager.life.wallet = 12_000;
  const r1 = selfStudy(state, 'tactics');
  const r2 = selfStudy(state, 'youth'); // 钱包剩 7K → 成功；再试不足
  const r3 = selfStudy(state, 'youth');
  const r4 = selfStudy(state, 'business');
  out.cases.selfStudy = { r1, r2, r3, r4, wallet: state.manager.life.wallet, tactics: state.manager.skills.tactics };
}

// ③ 下课双路径：警告后三连败 / 信心谷底
{
  const state = buildState();
  state.manager.career = { startYear: 2026, seasons: 1, titles: 0, wins: 3, losses: 5, loseStreak: 0, warned: false };
  const notes = [];
  state.boardConfidence = 18;
  careerWeeklyTick(state, notes); // 触发警告
  noteMatchResult(state, false, notes);
  noteMatchResult(state, false, notes);
  noteMatchResult(state, false, notes); // 警告后三连败 → 下课
  out.cases.fireWarn = { notes: notes.map((n) => ({ text: n.text, important: n.important ?? null })), ending: state.manager.career.ending };
}
{
  const state = buildState();
  state.manager.career = { startYear: 2026, seasons: 1, titles: 0, wins: 0, losses: 0, loseStreak: 0, warned: false };
  const notes = [];
  state.boardConfidence = 5;
  careerWeeklyTick(state, notes); // 谷底直接下课
  out.cases.fireBottom = { notes: notes.map((n) => ({ text: n.text })), ending: state.manager.career.ending };
}

// ④ 冠军账本 + 跳槽 + 门下弟子
{
  const state = buildState();
  state.manager.career = { startYear: 2026, seasons: 1, titles: 0, wins: 0, losses: 0, loseStreak: 0, warned: false };
  noteManagerTitle(state, state.myTeamId, 'league');
  noteManagerTitle(state, 'other-team', 'cup'); // 不计
  noteManagerTitle(state, state.myTeamId, 'league');
  const offers = jobOffers(state).map((t) => ({ id: t.id, rep: t.reputation }));
  const disciples = discipleCount(state);
  const notes = [];
  const rng = new Rng(99);
  const results = [];
  for (const offer of offers.slice(0, 3)) {
    results.push({ team: offer.id, ...applyJob(state, offer.id, rng, notes) });
    if (results[results.length - 1].ok) break; // 成功即换队，后续 offer 作废
  }
  out.cases.titleJob = {
    titleKinds: Object.fromEntries(Object.entries(state.manager.career.titleKinds)),
    titles: state.manager.career.titles,
    jobHops: state.manager.career.jobHops ?? 0,
    offers, disciples, results,
    notes: notes.map((n) => ({ text: n.text, important: n.important ?? null })),
    myTeamId: state.myTeamId,
  };
}

// ⑤ 五年之约 + 十年退休 + 里程碑结算
{
  const state = buildState();
  state.day = 300;
  state.manager.career = { startYear: 2022, seasons: 1, titles: 1, wins: 0, losses: 0, loseStreak: 0, warned: false };
  const notes = [];
  checkCareerMilestone(state, notes); // 2026-2022+1=5 → 五年之约卡
  const card = state.pendingEvents.find((e) => e.cardId === MILESTONE_CARD_ID);
  const rContinue = resolveMilestoneCard(state, card, 0);
  state.year = 2027;
  checkCareerMilestone(state, notes);
  state.year = 2031;
  checkCareerMilestone(state, notes); // seasons ≥10 → 退休
  out.cases.milestone = {
    notes: notes.map((n) => ({ text: n.text, important: n.important ?? null })),
    rContinue,
    cardUid: card ? card.uid : null,
    ending: state.manager.career.ending,
    seasons: state.manager.career.seasons,
  };
}

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/career.golden.json', JSON.stringify(out));
console.log(`career golden written: ${Object.keys(out.cases).length} cases`);
