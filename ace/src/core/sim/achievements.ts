/**
 * 成就系统（v1.0-10，GDD §10.4 v2.5 剧本路径）：四条剧本线 + 跨路径通用层。
 * 判定只读既有账本（career / retireLog / lastDraft / 球员标记），机制零新增——
 * 教学局（v1.0-11 §3 scripted）不计生涯统计与成就：其结算不走 noteMatchResult，天然排除。
 */
import type { GameState, NewsItem } from "../types.ts";
import { discipleCount } from "./career.ts";

export type AchPath = "general" | "rebuilder" | "dynasty" | "academy" | "mercenary";

export interface AchievementDef {
  id: string;
  path: AchPath;
  name: string;
  desc: string;
  /** 路径终点史诗 */
  epic?: boolean;
  check: (s: GameState) => boolean;
}

export const PATH_LABEL: Record<AchPath, string> = {
  general: "通用",
  rebuilder: "重建者",
  dynasty: "王朝缔造者",
  academy: "青训教父",
  mercenary: "雇佣兵",
};

/** 我队亲手培养的弟子中最高 overall（青训/选秀/接班人标记） */
function bestDiscipleOverall(s: GameState): number {
  const my = s.myTeamId;
  if (!my) return 0;
  let best = 0;
  for (const p of Object.values(s.players)) {
    if (p.teamId !== my) continue;
    if (p.homegrown || p.synthetic === "academy" || p.synthetic === "rookie" || p.track === "successor") {
      best = Math.max(best, p.overall);
    }
  }
  return best;
}

/** 我队最近一届选中的新秀最高潜力 */
function bestDraftPotential(s: GameState): number {
  const my = s.myTeamId;
  const picks = (s.lastDraft?.picks ?? []).filter((x) => x.teamId === my && x.playerId);
  let best = 0;
  for (const x of picks) {
    const p = s.players[x.playerId!];
    if (p) best = Math.max(best, p.potential);
  }
  return best;
}

const career = (s: GameState) => s.manager.career;

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- 通用层（跨路径） ----
  { id: "g-firstwin", path: "general", name: "首胜", desc: "赢下执教生涯第一场正式比赛", check: (s) => (career(s)?.wins ?? 0) >= 1 },
  { id: "g-firsttitle", path: "general", name: "首冠", desc: "捧起执教生涯第一座奖杯", check: (s) => (career(s)?.titles ?? 0) >= 1 },
  {
    id: "g-slam", path: "general", name: "生涯大满贯", epic: true,
    desc: "联赛、Masters、Champions 冠军各至少一座（分类账本 v1.0-10 起记录；旧档夺冠不计入分类）",
    check: (s) => {
      const k = career(s)?.titleKinds ?? {};
      return (k.league ?? 0) >= 1 && (k.masters ?? 0) >= 1 && (k.champions ?? 0) >= 1;
    },
  },
  { id: "g-decade", path: "general", name: "十年执教", desc: "在教练席上度过十个赛季", check: (s) => (career(s)?.seasons ?? 0) >= 10 },

  // ---- 重建者：接手低谷，把队伍拉起来 ----
  { id: "r-hundred", path: "rebuilder", name: "百战老兵", desc: "执教满 100 场正式比赛", check: (s) => (career(s)?.wins ?? 0) + (career(s)?.losses ?? 0) >= 100 },
  { id: "r-steady", path: "rebuilder", name: "稳定器", desc: "执教 60 场以上且胜率 ≥60%", check: (s) => { const c = career(s); const n = (c?.wins ?? 0) + (c?.losses ?? 0); return n >= 60 && c!.wins / Math.max(1, n) >= 0.6; } },
  { id: "r-comeback", path: "rebuilder", name: "绝境翻盘", desc: "吃过董事会最后通牒之后仍然夺冠", check: (s) => !!career(s)?.warned && (career(s)?.titles ?? 0) >= 1 },
  { id: "r-phoenix", path: "rebuilder", name: "凤凰涅槃", epic: true, desc: "警告后续命并累计三冠", check: (s) => !!career(s)?.warned && (career(s)?.titles ?? 0) >= 3 },

  // ---- 王朝缔造者：赢，然后一直赢 ----
  { id: "d-defend", path: "dynasty", name: "卫冕", desc: "累计两座奖杯", check: (s) => (career(s)?.titles ?? 0) >= 2 },
  { id: "d-intl", path: "dynasty", name: "国际舞台", desc: "夺得 Masters 或 Champions 冠军", check: (s) => { const k = career(s)?.titleKinds ?? {}; return (k.masters ?? 0) + (k.champions ?? 0) >= 1; } },
  { id: "d-threepeat", path: "dynasty", name: "三冠王朝", desc: "累计三座奖杯", check: (s) => (career(s)?.titles ?? 0) >= 3 },
  { id: "d-dynasty", path: "dynasty", name: "王朝缔造者", epic: true, desc: "累计五座奖杯", check: (s) => (career(s)?.titles ?? 0) >= 5 },

  // ---- 青训教父：亲手把年轻人带成明星 ----
  { id: "a-gold", path: "academy", name: "点石成金", desc: "亲手培养出一名 overall ≥75 的弟子（青训/选秀/接班人）", check: (s) => discipleCount(s) >= 1 },
  { id: "a-pipeline", path: "academy", name: "青训流水线", desc: "同时拥有三名 ≥75 的亲传弟子", check: (s) => discipleCount(s) >= 3 },
  { id: "a-eye", path: "academy", name: "选秀眼光", desc: "选中的新秀潜力 ≥86", check: (s) => bestDraftPotential(s) >= 86 },
  { id: "a-legacy", path: "academy", name: "一城终身", epic: true, desc: "亲手带出 overall ≥85 的巨星且为俱乐部夺冠（选手与教头的双重荣耀）", check: (s) => bestDiscipleOverall(s) >= 85 && (career(s)?.titles ?? 0) >= 1 },

  // ---- 雇佣兵：履历就是武器 ----
  { id: "m-hop", path: "mercenary", name: "跳槽达人", desc: "成功跳槽一次", check: (s) => (career(s)?.jobHops ?? 0) >= 1 },
  { id: "m-tour", path: "mercenary", name: "名帅巡回", desc: "累计跳槽两次", check: (s) => (career(s)?.jobHops ?? 0) >= 2 },
  { id: "m-rep", path: "mercenary", name: "名满江湖", desc: "个人声望 ≥85", check: (s) => s.manager.reputation >= 85 },
  { id: "m-fireman", path: "mercenary", name: "救火专家", epic: true, desc: "三次跳槽仍在执教", check: (s) => (career(s)?.jobHops ?? 0) >= 3 },
];

/** 评估并解锁（幂等）：worker 在日推进与比赛结算后调用；新解锁进新闻流 */
export function evaluateAchievements(state: GameState, notes: NewsItem[]): number {
  const unlocked = state.achievements ?? (state.achievements = {});
  const c = state.manager.career;
  if (!c) return 0;
  // 终局后世界冻结、不再推进，但「十年执教」恰在第 10 年退休时点亮——不做 ending 早退
  let n = 0;
  for (const def of ACHIEVEMENTS) {
    if (unlocked[def.id]) continue;
    let ok = false;
    try {
      ok = def.check(state);
    } catch {
      ok = false;
    }
    if (ok) {
      unlocked[def.id] = { year: state.year, day: state.day };
      n++;
      notes.push({
        day: state.day,
        kind: "club",
        important: def.epic === true,
        text: `🏆 解锁成就${def.epic ? "（史诗）" : ""}：「${def.name}」——${def.desc}`,
      });
    }
  }
  return n;
}
