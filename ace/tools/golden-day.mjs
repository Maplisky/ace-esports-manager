/**
 * day 黄金轨迹记录器：initSeasonFixtures + advanceDay 全年（季前/揭幕杯/两段联赛/夏窗 Masters/休赛期/Champions/选秀/翻年）
 * + 交互式比赛管线（mineHold 拦截 → playHeldMatch → interveneHeldMatch → settleMatch）。
 * 逐日摘要（notes/playedMine/matches/stage/关键计数）+ 年末全量状态摘要；match 内部由 match.golden 逐位覆盖。
 * 运行：node tools/golden-day.mjs（ace/ 下）
 */
import { generateWorld } from '../src/core/worldgen.ts';
import { initSeasonFixtures, advanceDay, playHeldMatch, interveneHeldMatch, settleMatch } from '../src/core/sim/day.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = generateWorld(42);
const teams = Object.values(state.teams);
state.myTeamId = teams[0].id;
state.day = 0; // advanceDay 先自增：首日为 1

initSeasonFixtures(state);

let heldDone = false;
const heldTrace = [];
const days = [];
const matchDigest = (rec, id, mine) => ({
  id, mine,
  winner: rec.winner, score: rec.score,
  maps: rec.maps.map((m) => ({ map: m.map, score: m.score })),
});

for (let step = 0; step < 372; step++) {
  const matches = [];
  const res = advanceDay(
    state,
    [],
    (rec, id, mine) => matches.push(matchDigest(rec, id, mine)),
    (fixtureId) => {
      if (heldDone) return false;
      heldDone = true;
      return true; // 拦截我的第一场：走交互式管线
    },
  );
  // 交互式管线：playHeldMatch（首发确认）→ interveneHeldMatch（第 1 图第 5 回合战术喊话）→ settleMatch
  for (const fid of res.playedMine) {
    const f = state.fixtures.find((x) => x.id === fid);
    if (!f || f.played) continue; // 已补打/已结算的跳过
    const myTeam = state.teams[state.myTeamId];
    const starters = myTeam.roster.slice(0, 5);
    const rec1 = playHeldMatch(state, fid, { starters });
    const rec2 = interveneHeldMatch(state, fid, { map: 0, round: 5, tactic: 'atk:rush' });
    const settleNotes = [];
    settleMatch(state, fid, rec2, (ns) => settleNotes.push(...ns.map((n) => n.text)));
    heldTrace.push({
      fixtureId: fid,
      rec1: rec1 ? { winner: rec1.winner, score: rec1.score, maps: rec1.maps.map((m) => ({ map: m.map, score: m.score })) } : null,
      rec2: rec2 ? { winner: rec2.winner, score: rec2.score, maps: rec2.maps.map((m) => ({ map: m.map, score: m.score })) } : null,
      settleNotes,
    });
  }
  days.push({
    step,
    day: res.day,
    stage: state.stage,
    notes: res.notes,
    playedMine: res.playedMine,
    seasonEnded: res.seasonEnded,
    matches,
    ap: state.actionPoints,
    bc: state.boardConfidence,
    budget: state.teams[state.myTeamId].budget,
    newsLen: state.news.length,
    feedLen: state.transferFeed.length,
    peCount: state.pendingEvents.length,
    inqLen: state.inquiries.length,
    bidLen: state.incomingBids.length,
    sponsorMult: state.sponsorMult ?? null,
  });
}

const myTeam = state.teams[state.myTeamId];
const dumpPlayer = (p) => ({
  id: p.id, age: p.age, overall: p.overall, potential: p.potential, peak: p.peakOverall,
  attrs: { ...p.attrs }, xp: { ...p.xp },
  form: p.form, morale: p.morale, fatigue: p.fatigue,
  salary: p.salary, contractYears: p.contractYears, benchedWeeks: p.benchedWeeks,
  listed: p.listed ?? null, listedWeeks: p.listedWeeks ?? null, track: p.track ?? null,
  teamId: p.teamId, wallet: p.wallet ?? null, popularity: p.popularity ?? null,
  agentPool: [...p.agentPool], agentPro: { ...p.agentPro }, commercialDays: p.commercialDays ?? null,
  career: { titles: p.career?.titles, clubs: p.career ? [...p.career.clubs] : null },
});
const myRoster = myTeam.roster.map((id) => state.players[id]).filter(Boolean);

const end = {
  year: state.year,
  day: state.day,
  stage: state.stage,
  compKeys: Object.keys(state.comps),
  fixturesCount: state.fixtures.length,
  fixturesPlayed: state.fixtures.filter((f) => f.played).length,
  circuitPoints: { ...state.circuitPoints },
  boardConfidence: state.boardConfidence,
  objective: state.objective ? { ...state.objective } : null,
  managerLife: state.manager?.life ? { ...state.manager.life } : null,
  managerCareer: state.manager?.career ? { ...state.manager.career } : null,
  managerSkills: state.manager?.skills ? { ...state.manager.skills } : null,
  myTeamBudget: myTeam.budget,
  mySponsors: myTeam.sponsors.map((s) => ({ id: s.id, name: s.name, tier: s.tier, perSeason: s.perSeason, years: s.years })),
  myMapPref: { ...myTeam.mapPref },
  myStarters: [...myTeam.starters],
  myAcademy: [...myTeam.academy],
  myPatternUsage: { ...myTeam.patternUsage },
  lastPattern: { ...myTeam.lastPattern },
  myRoster: myRoster.map(dumpPlayer),
  teamBudgets: teams.slice(0, 6).map((t) => ({ id: t.id, budget: t.budget })),
  regionMeta: Object.fromEntries(Object.entries(state.regionMeta ?? {}).map(([k, v]) => [k, { style: v.style, aggr: v.aggr }])),
  transferFeed: state.transferFeed.map((f) => ({ day: f.day, kind: f.kind, c: f.c ?? null, toTeamId: f.toTeamId ?? null, playerId: f.playerId ?? null, text: f.text })),
  newsImportant: state.news.filter((n) => n.important).slice(0, 60).map((n) => ({ day: n.day, kind: n.kind, text: n.text })),
  lastDraft: state.lastDraft ? { year: state.lastDraft.year, picks: state.lastDraft.picks } : null,
  retireLog: (state.retireLog ?? []).map((r) => ({ year: r.year, ign: r.ign, name: r.name, age: r.age, titles: r.titles, mvps: r.mvps })),
  pendingEvents: state.pendingEvents.map((e) => ({ uid: e.uid, cardId: e.cardId, title: e.title })),
  inquiries: state.inquiries.map((q) => ({ id: q.id, playerId: q.playerId, done: q.done, askingFee: q.askingFee, intent: q.intent })),
  incomingBids: state.incomingBids.map((b) => ({ id: b.id, playerId: b.playerId, fee: b.fee, day: b.day })),
  sponsorOffers: state.sponsorOffers.map((o) => ({ id: o.id, name: o.name, perSeason: o.perSeason, expires: o.expires })),
  gigOffers: state.gigOffers.map((g) => ({ id: g.id, playerId: g.playerId, brand: g.brand, pay: g.pay, day: g.day })),
  financesTail: state.finances.log.slice(-8).map((e) => ({ day: e.day, label: e.label, amount: e.amount })),
  scouting: Object.fromEntries(Object.entries(state.scouting ?? {}).map(([k, v]) => [k, { points: v.points, last: v.last }])),
  patchNotes: (state.patchNotes ?? []).map((p) => ({ version: p.version, changes: p.changes.map((c) => ({ agentId: c.agentId, dir: c.dir, pct: c.pct, meta: c.meta })) })),
  heldTrace,
};

const out = {
  meta: { generator: 'ace/tools/golden-day.mjs', authority: 'ace/src/core/sim/day.ts', seed: 42 },
  days,
  end,
};
mkdirSync('../kairo/Core.Tests/Golden', { recursive: true });
writeFileSync('../kairo/Core.Tests/Golden/day.golden.json', JSON.stringify(out));
console.log(`day golden written: ${days.length} days, ${heldTrace.length} held traces, seasonEnded@${days.findIndex((d) => d.seasonEnded)}`);
