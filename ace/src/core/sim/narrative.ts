/**
 * 中期生涯叙事（v1.5，GDD §9.5 v2.5）：旧部重逢 / 弟子反戈 / 王朝里程碑 / 名宿告别巡演。
 * 全部由既有账本（retireLog / career / transferFeed 的 clubs 痕迹）驱动的文案模板——
 * 机制零新增、零 RNG：金句从模板池按 hashString(ign) 确定性选取。
 */
import { hashString } from "../rng.ts";
import type { GameState, MatchRecord, NewsItem, RetireLogItem, Team } from "../types.ts";

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
export const MVP_QUOTES = [
  "「状态来了谁都拦不住，今晚的准度你们也看到了。」",
  "「战术是教练给的，但扣扳机的是我。」",
  "「个人奖放在柜子里，赢下的地图放在履历里——今晚两样都进账了。」",
];
export const ROOKIE_DEBUT_QUOTES = [
  "「上场前手一直在抖，第一枪打完就好了。」",
  "「教练让我当普通训练赛打。我信了，也没掉链子。」",
  "「这是第一步。下一步是让首发名单里再也写上别人的名字。」",
];
export const LOCKER_WIN_QUOTES = [
  "「照这个势头打下去，谁碰上我们都得掉层皮。」",
  "「今天赢得干净，但复盘会上一个回合都逃不掉。」",
  "「更衣室在放歌。赢球的日子，连训练房都是亮的。」",
];
export const LOCKER_LOSS_QUOTES = [
  "「没人想谈这场录像。但明天十点，还是要一帧一帧过。」",
  "「我们输给了自己。对面没有变强，是我们掉线了。」",
  "「沉默的返程大巴。有人说了一句『下把赢回来』——没人接话，但都听见了。」",
];
export const LOCKER_GRIM_QUOTES = [
  "「更衣室气氛很僵，有人开始公开质疑轮换——这是危险的信号。」",
  "「连续的失利正在侵蚀信任。再输下去，问题就不再是战术了。」",
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

/** 首秀名单捕获（资讯活水②的前置）：在赛后入账（applyMatchEffects）之前调用，
 *  返回我队 career.maps===0 的首发——入账后无法再区分首秀，必须先拍快照。 */
export function captureDebuts(state: GameState): string[] {
  const myId = state.myTeamId;
  const my = myId ? state.teams[myId] : null;
  if (!myId || !my) return [];
  return my.starters.filter((pid) => (state.players[pid]?.career.maps ?? 1) === 0);
}

/**
 * 资讯活水（v1.x 用户反馈④）：我队正式赛后的三类软新闻——MVP 高光 / 小将首战 / 更衣室舆论。
 * 零新增状态、零 RNG：发言人与金句由 hashString(fixtureId/ign) 确定性选取，回放安全。
 * 挂在 settleMatch（applyMatchEffects 之后）：士气已是赛后真值，低谷更衣室可触发尖锐文案。
 * debutPids 由调用方在入账前经 captureDebuts 捕获。
 */
export function narrativeOnMyMatch(state: GameState, fixtureId: string, rec: MatchRecord, notes: NewsItem[], debutPids?: ReadonlySet<string>): void {
  const myId = state.myTeamId;
  const my = myId ? state.teams[myId] : null;
  if (!myId || !my) return;
  const won = (rec.winner === "A" ? rec.teamA : rec.teamB) === myId;

  // ① MVP 高光：系列赛 MVP 是我队选手（含败方 MVP 的「虽败犹荣」），附系列赛场均 ACS
  const mvp = rec.mvp ? state.players[rec.mvp] : null;
  if (mvp && mvp.teamId === myId) {
    const acsAll = rec.maps.map((m) => m.lines[mvp.id]?.acs ?? 0);
    const avgAcs = Math.round(acsAll.reduce((x, y) => x + y, 0) / Math.max(1, acsAll.length));
    notes.push({
      day: state.day, kind: "match",
      text: `⭐ MVP 高光：${mvp.ign} ${won ? "率队取胜" : "虽败犹荣"}——系列赛场均 ${avgAcs} ACS。${pick(MVP_QUOTES, mvp.ign)}`,
    });
  }

  // ② 小将首战：入账前捕获的首秀首发（≤19 岁）；新档全队齐首秀 → 只讲最年轻的一个，避免刷屏
  const kids = [...(debutPids ?? [])]
    .map((pid) => state.players[pid])
    .filter((p): p is NonNullable<typeof p> => !!p && p.age <= 19)
    .sort((x, y) => x.age - y.age || x.ign.localeCompare(y.ign));
  const kid = kids[0];
  if (kid) {
    notes.push({
      day: state.day, kind: "club",
      text: `🌱 小将首战：${kid.ign}（${kid.age} 岁）迎来职业生涯首场正式比赛——${won ? "用一场胜利纪念出道" : "结果苦涩，但天赋藏不住"}。${pick(ROOKIE_DEBUT_QUOTES, kid.ign)}`,
    });
  }

  // ③ 更衣室舆论：发言人由 fixtureId 哈希选定；败局且发言人士气 <40 → 尖锐版（低谷警号）
  const starters = my.starters.map((pid) => state.players[pid]).filter((p): p is NonNullable<typeof p> => !!p);
  if (starters.length > 0) {
    const voice = starters[hashString(fixtureId) % starters.length]!;
    const grim = !won && voice.morale < 40;
    const quote = grim ? pick(LOCKER_GRIM_QUOTES, fixtureId) : won ? pick(LOCKER_WIN_QUOTES, fixtureId) : pick(LOCKER_LOSS_QUOTES, fixtureId);
    notes.push({
      day: state.day, kind: "club",
      text: `🎙 更衣室：${voice.ign}${grim ? "（士气低落）" : ""}——「${quote.replace(/^[「"]|[」"]$/g, "")}」`,
    });
  }
}
