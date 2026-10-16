/**
 * 转会传闻与意向生态（v1.x 优化，对齐原作「转会新闻」页的活性）：
 * - AI 强队关注强选手（rumor 三档浓度：绯闻→有消息称→谈判中）；
 * - 战绩差的 AI 队好球员提出离队（wants 意向 → 自动挂牌）；
 * - 谈判中的传闻一周后见分晓（成交「传闻成真」done / 谈崩 off）。
 * 全部确定性（显式 Rng）、零新状态（feed 即账本）。
 */
import type { GameState, NewsItem, TransferFeedItem } from "../types.ts";
import { Rng, clamp } from "../rng.ts";
import { logFinance } from "./finance.ts";

const RUMOR_LABEL: Record<1 | 2 | 3, string> = { 1: "绯闻", 2: "有消息称", 3: "谈判中" };

function pushFeed(state: GameState, item: TransferFeedItem): void {
  state.transferFeed.push(item);
  if (state.transferFeed.length > 300) state.transferFeed.splice(0, state.transferFeed.length - 300);
}

/** 战绩口径：我方全部赛程胜负（弱队判定用）；无赛程队返回中性 */
function seasonRecord(state: GameState, teamId: string): { w: number; l: number } {
  let w = 0, l = 0;
  for (const f of state.fixtures) {
    if (!f.played || !f.winnerTeamId || (f.teamA !== teamId && f.teamB !== teamId)) continue;
    if (f.winnerTeamId === teamId) w++;
    else l++;
  }
  return { w, l };
}

/**
 * 周传闻生成（windowTick 调用，rng 为当周显式流）：
 * 1) 强队（rating ≥78）关注强选手（overall ≥82 且非我队）→ rumor c1/c2；
 * 2) 已有 c2 传闻 30%/周升 c3（进入谈判）；
 * 3) c3 一周后判定：55% 成交（复用 AI 互挖成交逻辑的轻量版）→ done「传闻成真」，否则 off「告吹」（双方不满 ±）。
 */
export function weeklyRumors(state: GameState, rng: Rng, notes: NewsItem[]): void {
  const myId = state.myTeamId ?? "";
  const windowOpen = [1, 24, 123, 152, 233, 366].some((d, i, a) => i % 2 === 0 && state.day >= d && state.day <= a[i + 1]);
  // 意向（wants）不限窗口——烂队好球员随时想走； rumor 只在窗内活跃
  // 1) 战绩差 AI 队的好球员提离队（意向）——不满口径：士气 <55（本作用 morale 低代表怨气，GDD §6.2）
  for (const t of Object.values(state.teams)) {
    if (t.id === myId || t.tier !== 1) continue;
    const rec = seasonRecord(state, t.id);
    if (rec.w + rec.l < 6 || rec.w >= rec.l) continue; // 至少 6 场且胜率 <50%
    const stars = t.roster
      .map((id) => state.players[id])
      .filter((p): p is NonNullable<typeof p> => !!p && p.overall >= 78 && !p.listed && p.morale < 55);
    if (!stars.length || !rng.chance(0.15)) continue;
    const star = stars.reduce((a, b) => (b.overall - a.overall) || (a.morale - b.morale) > 0 ? b : a);
    const buyers = Object.values(state.teams).filter((x) => x.id !== t.id && x.reputation > t.reputation);
    const to = buyers.length ? rng.pick(buyers) : null;
    star.listed = true;
    star.morale = clamp(star.morale - 5, 10, 100);
    const why = `战绩 ${rec.w} 胜 ${rec.l} 负`;
    pushFeed(state, { day: state.day, year: state.year, kind: "wants", playerId: star.id, toTeamId: to?.id, text: `${star.ign}（${t.tag} · ${star.overall}）对球队战绩不满，提出离队意向${to ? `，想去 ${to.tag}` : ""}（${why}），已被挂牌。` });
    if (star.overall >= 80) notes.push({ day: state.day, kind: "transfer", text: `📋 ${star.ign}（${t.tag} · ${star.overall}）因战绩申请转会，已被挂牌${to ? `，他想去 ${to.tag}` : ""}。` });
  }
  // 2) 新关注传闻（不限窗——原作休赛期绯闻照飞；升格/成交才限窗）
  const strongTeams = Object.values(state.teams).filter((t) => t.id !== myId && (t.reputation ?? 50) >= 70);
  const stars = Object.values(state.players).filter((p) => p.teamId && p.teamId !== myId && p.overall >= 82 && !p.listed);
  if (strongTeams.length && stars.length && rng.chance(0.3)) {
    const buyer = rng.pick(strongTeams);
    const star = rng.pick(stars);
    if (star.teamId !== buyer.id) {
      pushFeed(state, { day: state.day, year: state.year, kind: "rumor", c: 1, playerId: star.id, toTeamId: buyer.id, text: `${RUMOR_LABEL[1]}：${buyer.tag} 正在关注 ${star.ign}（${state.teams[star.teamId!]?.tag ?? "?"} · ${star.overall}）。` });
      // 野心大的人听到传闻会飘（对齐原作：士气 +2 / 不满 +4）
      if ((star.ambition ?? 60) > 70) {
        star.morale = clamp(star.morale - 3, 10, 100);
      }
    }
  }
  if (!windowOpen) return;
  // 2) 升级既有传闻（c1→c2→c3）；选手已退役/易主则静默过期
  const open = state.transferFeed.filter((f) => f.kind === "rumor" && state.day - f.day <= 21);
  for (const f of open) {
    if (f.c === 3 || !f.playerId) continue;
    const p = state.players[f.playerId];
    if (!p || !p.teamId) continue;
    if (f.c === 2 && rng.chance(0.3)) {
      f.c = 3;
      f.day = state.day; // 谈判中起始日
      pushFeed(state, { ...f, kind: "rumor", c: 3, day: state.day, text: `${RUMOR_LABEL[3]}：${f.toTeamId ?? "?"} 与 ${p.ign} 方面正式接触，约一周后见分晓。` });
    } else if (f.c === 1 && rng.chance(0.25)) {
      f.c = 2;
      pushFeed(state, { ...f, kind: "rumor", c: 2, day: state.day, text: `${RUMOR_LABEL[2]} ${f.toTeamId ?? "?"} 正在关注 ${p.ign}。` });
    }
  }
  // 3) c3 一周后见分晓
  const deals = state.transferFeed.filter((f) => f.kind === "rumor" && f.c === 3 && state.day - f.day >= 7);
  for (const f of deals) {
    const p = f.playerId ? state.players[f.playerId] : null;
    const to = f.toTeamId ? state.teams[f.toTeamId] : null;
    if (!p || !to || !p.teamId || p.teamId === myId) { f.kind = "off"; f.text = `${f.text}（涉事选手已易主）`; continue; }
    const from = state.teams[p.teamId];
    if (rng.chance(0.55) && to.budget > 500_000 && to.roster.length < 7 && from.roster.length > 5) {
      // 成交：轻量成交（复用资金/名单/情报衰减主路径）
      const fee = Math.round((p.overall * 9000 * (1 + (p.contractYears ?? 1) * 0.12)) / 1000) * 1000;
      to.budget -= fee;
      from.budget += fee;
      from.roster = from.roster.filter((id) => id !== p.id);
      from.starters = from.starters.filter((id) => id !== p.id);
      to.roster.push(p.id);
      if (to.starters.length < 5) to.starters.push(p.id);
      p.teamId = to.id;
      p.listed = false;
      p.morale = clamp(p.morale + 8, 10, 100);
      logFinance(state, `转会收入 · ${p.ign}`, fee);
      pushFeed(state, { day: state.day, year: state.year, kind: "done", playerId: p.id, toTeamId: to.id, text: `传闻成真：${to.name} 以 ${fmtFee(fee)} 从 ${from.name} 签下 ${p.ign}（${p.overall}）。` });
      notes.push({ day: state.day, kind: "transfer", text: `✅ 传闻成真：${to.tag} 签下 ${p.ign}（${from.tag} → ${to.tag}，${fmtFee(fee)}）。` });
    } else {
      f.kind = "off";
      p.morale = clamp(p.morale + 3, 10, 100); // 留队安抚
      pushFeed(state, { day: state.day, year: state.year, kind: "off", playerId: p.id, toTeamId: to.id, text: `告吹：${to.name} 与 ${p.ign} 的谈判未能达成一致。` });
    }
  }
  // （新关注传闻已上移至窗口判定前——窗外绯闻照飞，休赛期新闻流不断）
}

function fmtFee(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`;
}

/** 传闻条目显示前缀（UI 与 core 同源） */
export function rumorPrefix(c: 1 | 2 | 3 | undefined): string {
  return c ? RUMOR_LABEL[c] : "";
}
