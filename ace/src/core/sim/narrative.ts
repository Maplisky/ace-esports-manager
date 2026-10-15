/**
 * 中期生涯叙事（v1.5，GDD §9.5 v2.5）：旧部重逢 / 弟子反戈 / 王朝里程碑 / 名宿告别巡演。
 * 全部由既有账本（retireLog / career / transferFeed 的 clubs 痕迹）驱动的文案模板——
 * 机制零新增、零 RNG：金句从模板池按 hashString(ign) 确定性选取。
 */
import { hashString } from "../rng.ts";
import type { GameState, NewsItem, RetireLogItem, Team } from "../types.ts";

/** 模板池快照常量（测试锁文案） */
export const REUNION_QUOTES = [
  "「教练，那天在训练房说的话我还记得——但今天，请让我赢。」",
  "「他把我的枪法磨出来了，现在我用它打败他。这很公平。」",
  "「离开不是为了报复。但赢下这一刻，感觉确实很好。」",
];
export const TURNCOAT_QUOTES = [
  "「我在这里学到了一切。现在，是时候亲手把它翻过去了。」",
  "「他教我的第一课是尊重比赛——所以我用了全力。」",
];
export const DYNASTY_QUOTES = [
  "全联盟的教练组都在连夜拆解你的比赛录像——王朝的代价，是所有人都在研究你。",
  "解说席开始用「时代」这个词形容你的球队。而挖角的电话，已经打进了更衣室。",
  "「击败他们」成了每支队赛季动员会上唯一的目标。你已经成为别人的梦想。",
];
export const FAREWELL_QUOTES = [
  "「最后一舞，我想留给这身队服。」——赛季结束后，他将挂起鼠标。",
  "「我打过最重要的比赛，都穿着这件衣服。」——告别巡演，从这一站开始。",
  "「年轻人们，场地交给你们了。」——老将的最后一季，每一场都是主场。",
];

const pick = <T>(pool: T[], key: string): T => pool[hashString(key) % pool.length]!;

/**
 * 旧部重逢 + 弟子反戈（我的正式赛败局后调用）：
 * - 旧部：胜方阵容中有曾效力我队的选手（career.clubs 痕迹）→ 赛后金句；
 * - 反戈：胜方教练是曾从我队退役转教练的名宿（retireLog: path=coach 且 teamName=我队名）→ 金句。
 * 国际赛淘汰局额外加「淘汰了你」后缀。此包装由 settleMatch 调用。
 */
export function narrativeAfterMyLoss(state: GameState, f: { label: string; teamA: string; teamB: string }, rec: { winner: "A" | "B" }, notes: NewsItem[]): void {
  const myId = state.myTeamId;
  if (!myId) return;
  const iWon = rec.winner === "A" ? f.teamA === myId : f.teamB === myId;
  if (iWon) return;
  const winnerTeam = state.teams[rec.winner === "A" ? f.teamA : f.teamB];
  if (!winnerTeam) return;
  const knockout = /淘汰|败者组|胜者组|总决赛|瑞士轮/.test(f.label) ? f.label : null;
  narrativeOnMyLoss(state, winnerTeam, notes, knockout);
}

export function narrativeOnMyLoss(state: GameState, winnerTeam: Team, notes: NewsItem[], knockoutLabel: string | null): void {
  const myId = state.myTeamId;
  const myName = myId ? state.teams[myId]?.name : null;
  if (!myId || !myName) return;

  const oldBoys = winnerTeam.roster
    .map((pid) => state.players[pid])
    .filter((p): p is NonNullable<typeof p> => !!p && p.career.clubs.includes(myId));
  if (oldBoys.length > 0) {
    const star = oldBoys.reduce((a, b) => (b.career.titles > a.career.titles ? b : a), oldBoys[0]!);
    notes.push({
      day: state.day, kind: "club",
      text: `🤝 旧部重逢：${star.ign}（${winnerTeam.tag}，曾效力 ${myName}）${knockoutLabel ? `在${knockoutLabel}` : ""}亲手淘汰了老东家。${pick(REUNION_QUOTES, star.ign)}`,
      important: !!knockoutLabel,
    });
  }

  const coachName = winnerTeam.coach?.name;
  if (coachName) {
    const disciple = (state.retireLog ?? []).find(
      (r) => r.path === "coach" && r.name === coachName && r.teamName === myName,
    );
    if (disciple) {
      notes.push({
        day: state.day, kind: "club", important: true,
        text: `🗡 弟子反戈：${winnerTeam.name} 主帅 ${coachName}——${myName} 退役名宿、你亲手送上的教练席——${knockoutLabel ? `在${knockoutLabel}` : ""}击败了你。${pick(TURNCOAT_QUOTES, coachName)}`,
      });
    }
  }
}

/** 王朝里程碑（我夺冠后调用）：生涯冠军数抵达 2 / 3 / 5 时各触发一次全联盟反应文案 */
const DYNASTY_STAGES = [2, 3, 5] as const;
export function narrativeOnTitle(state: GameState, notes: NewsItem[]): void {
  const c = state.manager.career;
  if (!c || !state.myTeamId) return;
  const stage = DYNASTY_STAGES.find((s) => c.titles === s);
  if (stage === undefined) return;
  const myName = state.teams[state.myTeamId]?.name ?? "你的球队";
  notes.push({
    day: state.day, kind: "league", important: true,
    text: `👑 王朝里程碑：${myName} 第 ${c.titles} 冠。${pick(DYNASTY_QUOTES, `${myName}:${stage}`)}`,
  });
}

/** 名宿告别巡演（我队功勋选手退役留档时调用）：32+ 岁、2+ 冠、从我这退役 → 末季事件链开场文案 */
export function narrativeOnRetire(state: GameState, entry: RetireLogItem, notes: NewsItem[]): void {
  const myName = state.myTeamId ? state.teams[state.myTeamId]?.name : null;
  if (!myName || entry.teamName !== myName) return;
  if (entry.age < 32 || entry.titles < 2) return;
  notes.push({
    day: state.day, kind: "transfer", important: true,
    text: `🎖 名宿告别巡演：${entry.ign}（${entry.titles} 冠 · ${myName}）确认这是他的最后一个赛季。${pick(FAREWELL_QUOTES, entry.ign)}`,
  });
}
