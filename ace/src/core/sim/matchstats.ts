/**
 * 比赛数据面板（v0.9-5 对局美术打磨，GDD §5.4）：
 * 实时战绩（播放进度内已揭示事件聚合）与赛后总结（跨图 lines 汇总：KDA/ACS/FK/FD/残局）。
 * 只吃 MatchRecord——与模拟分离（§5.1）。
 */
import type { MapRecord } from "../types.ts";

/** 实时一行：击杀/死亡/助攻/首杀/伤害（实时 ACS 的原料） */
export interface LiveLine {
  k: number;
  d: number;
  a: number;
  fk: number;
  dmg: number;
}

/** 实时 ACS：伤害 ÷ 已完成回合 × 1.45（与引擎赛后同式；rounds=0 时为 0） */
export function liveAcs(dmg: number, rounds: number): number {
  return rounds > 0 ? Math.round((dmg / rounds) * 1.45) : 0;
}

/**
 * 播放进度 (mi, ri, ei) 内已揭示内容的实时战绩。
 * 击杀事件即时计（旧档 dmg 缺省按 150）；回合残伤与助攻随回合结果揭示（end.dmgBonus/end.assists）。
 * 返回已完成回合数——实时 ACS 的分母（进行中的回合不计入，与转播口径一致）。
 */
export function liveLines(
  maps: MapRecord[],
  upTo: { mi: number; ri: number; ei: number },
): { lines: Record<string, LiveLine>; rounds: number } {
  const out: Record<string, LiveLine> = {};
  const add = (pid: string, patch: Partial<LiveLine>) => {
    const cur = out[pid] ?? { k: 0, d: 0, a: 0, fk: 0, dmg: 0 };
    cur.k += patch.k ?? 0;
    cur.d += patch.d ?? 0;
    cur.a += patch.a ?? 0;
    cur.fk += patch.fk ?? 0;
    cur.dmg += patch.dmg ?? 0;
    out[pid] = cur;
  };
  let rounds = 0;
  for (let mi = 0; mi < maps.length && mi <= upTo.mi; mi++) {
    const m = maps[mi]!;
    const roundsHere = mi < upTo.mi ? m.rounds.length : upTo.ri + 1;
    for (let ri = 0; ri < roundsHere; ri++) {
      const r = m.rounds[ri]!;
      const isCurrent = mi === upTo.mi && ri === upTo.ri;
      const events = isCurrent ? r.events.slice(0, Math.max(0, upTo.ei + 1)) : r.events;
      for (const e of events) {
        if (e.t !== "kill" || !e.s || !e.v) continue;
        add(e.s, { k: 1, dmg: e.dmg ?? 150 });
        add(e.v, { d: 1 });
        if (e.first) add(e.s, { fk: 1 });
      }
      // 回合完成（历史回合，或当前回合结果已揭示）→ 残伤与助攻揭晓
      const completed = !isCurrent || upTo.ei >= r.events.length;
      if (completed) {
        rounds++;
        for (const [pid, n] of Object.entries(r.end.dmgBonus ?? {})) add(pid, { dmg: n });
        for (const pid of r.end.assists ?? []) add(pid, { a: 1 });
      }
    }
  }
  return { lines: out, rounds };
}

export interface StatRow {
  pid: string;
  team: "A" | "B";
  k: number;
  d: number;
  a: number;
  fk: number;
  fd: number;
  clutches: number;
  rounds: number;
  /** 跨图 ACS：按图回合数加权平均 */
  acs: number;
}

/** 赛后总结：全部已打地图的 lines 汇总，按 ACS 降序。teamAPids 用于标注队属（lines 不带队属） */
export function summarizeMatch(maps: MapRecord[], teamAPids: Set<string>): StatRow[] {
  const agg = new Map<string, StatRow>();
  for (const m of maps) {
    for (const [pid, line] of Object.entries(m.lines ?? {})) {
      const cur = agg.get(pid) ?? {
        pid, team: (teamAPids.has(pid) ? "A" : "B") as "A" | "B", k: 0, d: 0, a: 0, fk: 0, fd: 0, clutches: 0, rounds: 0, acs: 0,
      };
      cur.k += line.kills;
      cur.d += line.deaths;
      cur.a += line.assists;
      cur.fk += line.firstKills;
      cur.fd += line.firstDeaths;
      cur.clutches += line.clutches;
      cur.rounds += line.rounds;
      cur.acs += line.acs * line.rounds;
      agg.set(pid, cur);
    }
  }
  const rows = [...agg.values()].map((r) => ({
    ...r,
    acs: r.rounds > 0 ? Math.round(r.acs / r.rounds) : 0,
  }));
  rows.sort((x, y) => y.acs - x.acs);
  return rows;
}

/** 结算 MVP 派生：总 MVP = 胜方最佳（引擎 record.mvp 同规则），SMVP = 败方最佳 */
export function pickMvps(rows: StatRow[], winnerTeam: "A" | "B"): { mvp: string | null; smvp: string | null } {
  const bestOf = (team: "A" | "B") =>
    rows
      .filter((r) => r.team === team)
      .sort((a, b) => b.acs - a.acs || b.k - a.k)[0]?.pid ?? null;
  return { mvp: bestOf(winnerTeam), smvp: bestOf(winnerTeam === "A" ? "B" : "A") };
}
