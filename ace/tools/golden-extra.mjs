/**
 * M1 收尾五模块黄金轨迹：scrim（约战/陪练系数/情报）/ achievements（解锁幂等）/
 * retirement（检定/劝留五选项/教练签约解雇挖角）/ challenge（挑战包校验/计分）/ share（回放投影+匿名化）。
 * 双精度一律 hex 承载。运行：node tools/golden-extra.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import { initCareer } from '../src/core/sim/career.ts';
import {
  teamAvgOverall, scrimSparringCoef, scrimAcceptChance, requestScrim, noteTacticsChanged,
} from '../src/core/sim/scrim.ts';
import { evaluateAchievements } from '../src/core/sim/achievements.ts';
import {
  fameOf, coachValueOf, retireProb, seasonRetirements, resolveRetireCard,
  signCoach, fireCoach, coachCompensation, poachCoach,
} from '../src/core/sim/retirement.ts';
import {
  loadChallengePack, validateChallengeStart, challengeScore, challengeReport,
} from '../src/core/sim/challenge.ts';
import { buildReplayPayload, anonymizeReplay } from '../src/core/sim/share.ts';
import { simMatch } from '../src/core/sim/match.ts';
import { Rng, hashString } from '../src/core/rng.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const hex64 = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id;
state.day = 130;
initCareer(state, 'analyst');
state.achievements ??= {};
state.retireLog ??= []; // TS 由 App 层初始化的可选字段（CS 侧默认空列表，语义一致）

const out = { meta: { generator: 'ace/tools/golden-extra.mjs', authority: 'ace/src/core/sim/{scrim,achievements,retirement,challenge,share}.ts' } };

// ── ① scrim ──
{
  const myId = state.myTeamId;
  const t1 = teams.filter((t) => t.tier === 1 && t.id !== myId);
  const ranked = t1.slice().sort((a, b) => teamAvgOverall(state, b.id) - teamAvgOverall(state, a.id));
  const strong = ranked[0].id;
  const weak = ranked[ranked.length - 1].id;
  const rival = t1.find((t) => t.regionId === teams.find((x) => x.id === myId).regionId) ?? ranked[1];
  out.scrim = {
    avg: ranked.slice(0, 4).map((t) => ({ id: t.id, avg: hex64(teamAvgOverall(state, t.id)) })),
    coefs: [[70, 50], [50, 70], [80, 88], [55, 55]].map(([m, o]) => hex64(scrimSparringCoef(m, o))),
    accept: [strong, weak, rival.id].map((id) => hex64(scrimAcceptChance(state, myId, id))),
    requests: [],
  };
  const notes = [];
  const reqs = [
    { oppId: weak, mapId: 'ascent', goal: 'blend' },
    { oppId: rival.id, mapId: 'split', goal: 'style', goalStyle: 'balanced' },
    { oppId: strong, mapId: 'ascent', goal: 'mappool' },
  ];
  const rng = new Rng(301);
  for (const req of reqs) {
    const r = requestScrim(state, req, rng, notes);
    out.scrim.requests.push({
      req,
      accepted: r.accepted, reason: r.reason, won: r.won, score: r.score, coef: hex64(r.coef),
    });
  }
  out.scrim.notes = notes.map((n) => n.text);
  out.scrim.myBond = hex64(state.teams[myId].bond);
  out.scrim.mapPrefAscent = hex64(state.teams[myId].mapPref.ascent ?? 50);
  out.scrim.mapPrefSplit = hex64(state.teams[myId].mapPref.split ?? 50);
  out.scrim.styleCounter = Object.fromEntries(Object.entries(state.styleCounter ?? {}).map(([k, v]) => [k, hex64(v)]));
  out.scrim.scrimLog = state.scrimLog ?? [];
  out.scrim.ap = state.actionPoints;
  out.scrim.intelStrong = hex64(state.scouting?.[strong]?.points ?? 0);
  out.scrim.intelWeak = hex64(state.scouting?.[weak]?.points ?? 0);
  // 战术变化衰减（零 RNG）：给我队对 strong 的情报置 5 再触发
  state.scouting ??= {};
  state.scouting[strong] = { points: 5, last: state.day };
  out.scrim.tacticsChanged = noteTacticsChanged(state, strong);
  out.scrim.intelStrongAfter = hex64(state.scouting[strong].points);
  out.scrim.tacticsChangedAgain = noteTacticsChanged(state, strong);
}

// ── ② achievements ──
{
  const notes = [];
  const c = state.manager.career;
  c.wins = 65; c.losses = 20; c.titles = 2; c.warned = true; c.seasons = 5;
  c.titleKinds = { league: 1, masters: 1 };
  const my = state.teams[state.myTeamId];
  // 造一名青训标记的 ≥75 弟子
  const young = Object.values(state.players).find((p) => p.teamId === my.id && p.overall >= 75);
  if (young) young.homegrown = true;
  state.lastDraft = { year: state.year, picks: [{ pickNo: 1, teamId: my.id, playerId: young?.id ?? '' }] };
  const n1 = evaluateAchievements(state, notes);
  out.achievements = {
    round1: { unlocked: Object.keys(state.achievements), notes: notes.map((x) => ({ important: x.important ?? false, text: x.text })) },
    n1,
  };
  c.titles = 5;
  notes.length = 0;
  const n2 = evaluateAchievements(state, notes);
  out.achievements.round2 = { unlocked: Object.keys(state.achievements), notes: notes.map((x) => ({ important: x.important ?? false, text: x.text })), n2 };
  out.achievements.rep = state.manager.reputation;
  out.achievements.disciples = young?.overall ?? 0;
}

// ── ③ retirement ──
{
  const pool = Object.values(state.players).slice(0, 16);
  out.retirement = {
    fame: pool.map((p) => ({ id: p.id, fame: fameOf(p) })),
    coachValue: pool.slice(0, 8).map((p) => ({ id: p.id, v: coachValueOf(p) })),
    retireProb: pool.map((p) => ({ id: p.id, age: p.age, prob: hex64(retireProb(p)) })),
  };
  const notes = [];
  seasonRetirements(state, new Rng(402), notes);
  out.retirement.notes = notes.map((n) => ({ text: n.text }));
  out.retirement.pendingRetireCards = state.pendingEvents
    .filter((e) => e.cardId === 'retire')
    .map((e) => ({ uid: e.uid, title: e.title, text: e.text, targetPlayerId: e.targetPlayerId, options: e.options.map((o) => o.label) }));
  out.retirement.coachPool = state.coachPool.map((c) => ({ id: c.id, name: c.name, fame: c.fame, comm: hex64(c.comm), titles: c.titles, mvps: c.mvps, isIgl: c.isIgl, homegrownClubId: c.homegrownClubId ?? null, retiredYear: c.retiredYear, value: c.value }));
  out.retirement.retireLog = state.retireLog.map((r) => ({ year: r.year, ign: r.ign, name: r.name, age: r.age, titles: r.titles, mvps: r.mvps, overall: r.overall, path: r.path, teamName: r.teamName ?? null, coachId: r.coachId ?? null }));
  out.retirement.feedRetire = state.transferFeed.filter((f) => f.kind === 'retire').map((f) => ({ day: f.day, text: f.text }));
  // 劝留卡结算：第一张卡走「加薪 30%」（Rng 403）
  const card = state.pendingEvents.find((e) => e.cardId === 'retire');
  if (card) {
    const res = resolveRetireCard(state, card, 0, new Rng(403));
    out.retirement.resolveOpt0 = res;
  }
  // 第二张卡（若有）走「挂牌」（Rng 404，选项本身零 RNG 但保持同构）
  const card2 = state.pendingEvents.find((e) => e.cardId === 'retire' && e.uid !== card?.uid);
  if (card2) {
    const res = resolveRetireCard(state, card2, 2, new Rng(404));
    out.retirement.resolveOpt2 = res;
  }
  // 签约/解雇/挖角教练
  const freeFirst = state.coachPool[0]?.id;
  out.retirement.signErr = signCoach(state, 'nonexistent', 'training');
  if (freeFirst) out.retirement.sign = signCoach(state, freeFirst, 'training') ?? 'ok';
  out.retirement.staffTraining = state.teams[state.myTeamId].staff.training;
  out.retirement.fire = fireCoach(state, 'training');
  out.retirement.repAfterFire = state.manager.reputation;
  out.retirement.coachComp = [40, 55, 70, 95].map(coachCompensation);
  // 挖角：找一个有教练的 AI 队
  const target = teams.find((t) => t.id !== state.myTeamId && t.staff.training);
  if (target) {
    const offer = coachCompensation(target.staff.training.value) * 2;
    out.retirement.poach = poachCoach(state, target.id, 'training', offer, new Rng(405));
    out.retirement.poachTargetBudget = hex64(target.budget);
  } else {
    out.retirement.poach = 'no-target';
  }
  out.retirement.myBudget = hex64(state.teams[state.myTeamId].budget);

  // 强制劝留卡路径（seasonRetirements 依赖随机检定，这里直接构造卡驱动专属结算）：
  const myId2 = state.myTeamId;
  const oldGuy = Object.values(state.players).find((p) => p.teamId === myId2 && p.age >= 29)
    ?? Object.values(state.players).find((p) => p.teamId === myId2);
  if (oldGuy) {
    const mkCard = (uid) => ({
      uid, cardId: 'retire', title: `退役劝留 · ${oldGuy.ign}`, text: 'x',
      negative: false, targetPlayerId: oldGuy.id, day: state.day,
      options: [
        { label: `加薪 30% 留队（$${Math.round(oldGuy.salary * 0.3 / 1000)}K/季）`, result: '' },
        { label: '转导师型替补', result: '' },
        { label: '放上挂牌名单', result: '' },
        { label: '举办退役仪式', result: '' },
        { label: '深夜长谈', result: '' },
      ],
    });
    out.retirement.forceCard = { player: oldGuy.id, age: oldGuy.age, salary: oldGuy.salary };
    const c1 = mkCard('retire_test_1');
    state.pendingEvents.push(c1);
    out.retirement.forceOpt4 = resolveRetireCard(state, c1, 4, new Rng(406)); // 深夜长谈
    if (state.players[oldGuy.id]) { // 长谈成功仍在队 → 再来一张走退役仪式
      const c2 = mkCard('retire_test_2');
      state.pendingEvents.push(c2);
      out.retirement.forceOpt3 = resolveRetireCard(state, c2, 3, new Rng(407));
      out.retirement.forceOpt3StillOnRoster = !!state.players[oldGuy.id];
    }
  }
  // 教练签约/解雇闭环：手动入池驱动
  state.coachPool.push({ id: 'coach_test', name: '测试名宿', fame: 60, comm: 71.5, titles: 2, mvps: 3, isIgl: true, homegrownClubId: null, retiredYear: state.year, value: 66 });
  out.retirement.sign2 = signCoach(state, 'coach_test', 'training') ?? 'ok';
  out.retirement.staffTraining2 = state.teams[state.myTeamId].staff.training;
  out.retirement.coachPoolAfterSign = state.coachPool.map((c) => c.id);
  out.retirement.fire2 = fireCoach(state, 'training');
  out.retirement.coachPoolAfterFire = state.coachPool.map((c) => ({ id: c.id, value: c.value }));
}

// ── ④ challenge ──
{
  const good = loadChallengePack({ id: 'CH1', name: '新手试炼', desc: '两赛季一冠', seed: 42, seasons: 2, goal: 'titles', constraints: { origin: 'analyst', tier: 1 } });
  const bad1 = loadChallengePack({ id: 'X', name: 'x', seed: 1.5, goal: 'titles' });
  const bad2 = loadChallengePack({ id: 'X', name: 'x', seed: 42, goal: 'nope' });
  out.challenge = {
    good: good && {
      id: good.id, name: good.name, desc: good.desc, seed: good.seed, seasons: good.seasons, goal: good.goal,
      constraints: { origin: good.constraints.origin ?? null, difficulty: good.constraints.difficulty ?? null, tier: good.constraints.tier ?? null, maxAge: good.constraints.maxAge ?? null },
    },
    bad1: bad1 === null, bad2: bad2 === null,
  };
  if (good) {
    const wrongSeed = validateChallengeStart({ ...state, seed: 43 }, good);
    const ok = validateChallengeStart(state, good);
    const wrongOrigin = validateChallengeStart(state, { ...good, constraints: { ...good.constraints, origin: 'legend' } });
    const score = challengeScore(state, good);
    out.challenge.validate = { wrongSeed, ok, wrongOrigin };
    out.challenge.score = { goal: score.goal, value: score.value, seasonsPlayed: score.seasonsPlayed, qualified: score.qualified };
    out.challenge.report = challengeReport(state, good);
  }
}

// ── ⑤ share ──
{
  const my = state.teams[state.myTeamId];
  const opp = teams.find((t) => t.id !== state.myTeamId);
  const seed = hashString(`42:share:${state.day}`);
  const rec = simMatch(state, my.id, opp.id, 3, seed, 'share-1');
  const payload = buildReplayPayload(state, rec);
  const anon = anonymizeReplay(payload);
  const dumpPayload = (p) => ({
    teams: {
      A: { tag: p.teams.A.tag, name: p.teams.A.name, roster: p.teams.A.roster },
      B: { tag: p.teams.B.tag, name: p.teams.B.name, roster: p.teams.B.roster },
    },
    players: Object.fromEntries(Object.entries(p.players).map(([k, v]) => [k, v.ign])),
    rec: { id: p.rec.id, seed: p.rec.seed, format: p.rec.format, teamA: p.rec.teamA, teamB: p.rec.teamB, stage: p.rec.stage, day: p.rec.day, winner: p.rec.winner, score: p.rec.score },
  });
  out.share = { payload: dumpPayload(payload), anon: dumpPayload(anon) };
}

mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/extra.golden.json', JSON.stringify(out));
console.log(`extra golden written: scrim ${out.scrim.requests.length} reqs, retirement log ${out.retirement.retireLog.length}, ach r1 ${out.achievements.round1.unlocked.length} r2 ${out.achievements.round2.unlocked.length}`);
