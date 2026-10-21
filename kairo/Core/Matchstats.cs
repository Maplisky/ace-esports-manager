using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 比赛数据面板 — C# 移植自 ace/src/core/sim/matchstats.ts（权威实现）。
/// 只吃 MapRecord，与模拟分离（§5.1）。
/// </summary>
public static class Matchstats
{
    public sealed class LiveLine
    {
        public int K;
        public int D;
        public int A;
        public int Fk;
        public double Dmg;
    }

    public sealed class UpTo
    {
        public int Mi;
        public int Ri;
        public int Ei;
    }

    public sealed class LiveResult
    {
        public OrderedDict<string, LiveLine> Lines { get; set; } = new();
        public int Rounds { get; set; }
    }

    /// <summary>实时 ACS：伤害 ÷ 已完成回合 × 1.45（rounds=0 时为 0）。</summary>
    public static double LiveAcs(double dmg, int rounds) =>
        rounds > 0 ? DetMath.JsRound((dmg / rounds) * 1.45) : 0;

    private static void Add(OrderedDict<string, LiveLine> outMap, string pid, int k, int d, int a, int fk, double dmg)
    {
        if (!outMap.TryGetValue(pid, out var cur))
        {
            cur = new LiveLine();
            outMap[pid] = cur;
        }
        cur.K += k;
        cur.D += d;
        cur.A += a;
        cur.Fk += fk;
        cur.Dmg += dmg;
    }

    /// <summary>
    /// 播放进度 (mi, ri, ei) 内已揭示内容的实时战绩。
    /// 返回已完成回合数——实时 ACS 的分母（进行中的回合不计入）。
    /// </summary>
    public static LiveResult LiveLines(IReadOnlyList<MapRecord> maps, UpTo upTo)
    {
        var outMap = new OrderedDict<string, LiveLine>();
        int rounds = 0;
        for (int mi = 0; mi < maps.Count && mi <= upTo.Mi; mi++)
        {
            var m = maps[mi];
            int roundsHere = mi < upTo.Mi ? m.Rounds.Count : upTo.Ri + 1;
            for (int ri = 0; ri < roundsHere; ri++)
            {
                var r = m.Rounds[ri];
                bool isCurrent = mi == upTo.Mi && ri == upTo.Ri;
                var events = isCurrent ? r.Events.Take(Math.Max(0, upTo.Ei + 1)).ToList() : r.Events;
                foreach (var e in events)
                {
                    if (e.T != "kill" || e.S == null || e.V == null) continue;
                    Add(outMap, e.S, 1, 0, 0, 0, e.Dmg ?? 150);
                    Add(outMap, e.V, 0, 1, 0, 0, 0);
                    if (e.First == true) Add(outMap, e.S, 0, 0, 0, 1, 0);
                }
                // 回合完成（历史回合，或当前回合结果已揭示）→ 残伤与助攻揭晓
                bool completed = !isCurrent || upTo.Ei >= r.Events.Count;
                if (completed)
                {
                    rounds++;
                    foreach (var kv in r.End.DmgBonus) Add(outMap, kv.Key, 0, 0, 0, 0, kv.Value);
                    foreach (var pid in r.End.Assists) Add(outMap, pid, 0, 0, 1, 0, 0);
                }
            }
        }
        return new LiveResult { Lines = outMap, Rounds = rounds };
    }

    public sealed class LiveMetaResult
    {
        /// <summary>大招进度快照（0-6 = 点数，7 = 就绪；来自最后已揭示回合）</summary>
        public OrderedDict<string, int> Ults { get; set; } = new();
        /// <summary>回合末经济池（null = 无已揭示数据）</summary>
        public MoneyPool? Money { get; set; }
    }

    /// <summary>随回合结果揭示的元数据：大招进度与经济池（与 LiveLines 的「已完成回合」口径一致）。</summary>
    public static LiveMetaResult LiveMeta(IReadOnlyList<MapRecord> maps, UpTo upTo)
    {
        OrderedDict<string, int> ults = new();
        MoneyPool? money = null;
        for (int mi = 0; mi < maps.Count && mi <= upTo.Mi; mi++)
        {
            var m = maps[mi];
            int roundsHere = mi < upTo.Mi ? m.Rounds.Count : upTo.Ri + 1;
            for (int ri = 0; ri < roundsHere; ri++)
            {
                var r = m.Rounds[ri];
                bool isCurrent = mi == upTo.Mi && ri == upTo.Ri;
                if (!isCurrent || upTo.Ei >= r.Events.Count)
                {
                    if (r.End.Ults != null) ults = r.End.Ults; // TS truthy 语义：存在（含空对象）即替换
                    if (r.End.Money != null) money = r.End.Money;
                }
            }
        }
        return new LiveMetaResult { Ults = ults, Money = money };
    }

    public sealed class StatRow
    {
        public string Pid = "";
        /// <summary>"A" / "B"</summary>
        public string Team = "B";
        public int K, D, A, Fk, Fd, Clutches, Rounds;
        /// <summary>跨图 ACS：按图回合数加权平均</summary>
        public double Acs;
    }

    /// <summary>赛后总结：全部已打地图的 lines 汇总，按 ACS 降序（稳定序）。</summary>
    public static List<StatRow> SummarizeMatch(IReadOnlyList<MapRecord> maps, IReadOnlySet<string> teamAPids)
    {
        var agg = new OrderedDict<string, StatRow>();
        foreach (var m in maps)
        {
            foreach (var kv in m.Lines)
            {
                var pid = kv.Key;
                var line = kv.Value;
                if (!agg.TryGetValue(pid, out var cur))
                {
                    cur = new StatRow
                    {
                        Pid = pid,
                        Team = teamAPids.Contains(pid) ? "A" : "B",
                    };
                    agg[pid] = cur;
                }
                cur.K += line.Kills;
                cur.D += line.Deaths;
                cur.A += line.Assists;
                cur.Fk += line.FirstKills;
                cur.Fd += line.FirstDeaths;
                cur.Clutches += line.Clutches;
                cur.Rounds += line.Rounds;
                cur.Acs += line.Acs * line.Rounds;
            }
        }
        return agg.Values
            .Select(r => new StatRow
            {
                Pid = r.Pid, Team = r.Team, K = r.K, D = r.D, A = r.A, Fk = r.Fk, Fd = r.Fd,
                Clutches = r.Clutches, Rounds = r.Rounds,
                Acs = r.Rounds > 0 ? DetMath.JsRound(r.Acs / r.Rounds) : 0,
            })
            .OrderByDescending(r => r.Acs) // 稳定序 = ES2019+ sort
            .ToList();
    }

    /// <summary>结算 MVP 派生：总 MVP = 胜方最佳，SMVP = 败方最佳。</summary>
    public static (string? Mvp, string? Smvp) PickMvps(IReadOnlyList<StatRow> rows, string winnerTeam)
    {
        string? BestOf(string team) =>
            rows.Where(r => r.Team == team)
                .OrderByDescending(r => r.Acs).ThenByDescending(r => r.K)
                .Select(r => r.Pid)
                .FirstOrDefault();
        var mvp = BestOf(winnerTeam);
        var smvp = BestOf(winnerTeam == "A" ? "B" : "A");
        return (mvp == null ? null : mvp, smvp);
    }
}
