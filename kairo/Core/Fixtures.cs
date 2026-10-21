using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 赛程生成（GDD §4.2 v0.1）— C# 移植自 ace/src/core/sim/fixtures.ts（权威实现）。
/// 揭幕杯（单败）+ 双循环联赛（轮转法）+ 瑞士轮 + 8 队双败淘汰树。
/// </summary>
public static class Fixtures
{
    private static int _fixtureSeq;
    /// <summary>生成闸门：fixtureSeq 为模块级状态（TS 同款）。</summary>
    private static readonly object SeqGate = new();

    public static void ResetFixtureSeq()
    {
        lock (SeqGate) { _fixtureSeq = 0; }
    }

    private static Fixture MkFixture(Fixture f)
    {
        lock (SeqGate)
        {
            f.Id = $"F{_fixtureSeq++}";
            f.Played = false;
            return f;
        }
    }

    /// <summary>供动态赛程安全创建 fixture：id 全局唯一。</summary>
    public static Fixture CreateFixture(Fixture f) => MkFixture(f);

    /// <summary>单循环（轮转法），rng 决定主队顺序洗牌；奇数队补 BYE 轮空。</summary>
    private static List<List<(string A, string B)>> RoundRobin(List<string> teamIds, Rng rng)
    {
        var ids = rng.Shuffle(teamIds);
        int n0 = ids.Length;
        var rounds = new List<List<(string, string)>>();
        if (n0 < 2) return rounds;
        const string BYE = "__BYE__";
        var ids2 = n0 % 2 == 1 ? ids.Concat(new[] { BYE }).ToList() : ids.ToList();
        int n = ids2.Count;
        var arr = ids2.ToList();
        int half = n / 2;
        for (int r = 0; r < n - 1; r++)
        {
            var pairs = new List<(string, string)>();
            for (int i = 0; i < half; i++)
            {
                string a = arr[i];
                string b = arr[n - 1 - i];
                if (a == BYE || b == BYE) continue;
                pairs.Add(r % 2 == 0 ? (a, b) : (b, a));
            }
            rounds.Add(pairs);
            // 轮转：固定首位，其余顺移
            string fixedHead = arr[0];
            var rest = arr.Skip(1).ToList();
            string last = rest[^1];
            rest.RemoveAt(rest.Count - 1);
            rest.Insert(0, last);
            arr = new List<string> { fixedHead };
            arr.AddRange(rest);
        }
        return rounds;
    }

    /// <summary>双循环联赛赛程。</summary>
    public static void BuildLeague(
        List<Fixture> stateFixtures,
        string comp, string name, string stage, List<string> teamIds, int startDay, int endDay, int bo, Rng rng)
    {
        var first = RoundRobin(teamIds, rng);
        var allRounds = new List<List<(string, string)>>(first);
        allRounds.AddRange(first.Select(round => round.Select(p => (p.B, p.A)).ToList()));
        int rounds = allRounds.Count;
        int step = Math.Max(1, (endDay - startDay) / Math.Max(1, rounds - 1));
        foreach (var (pairs, ri) in allRounds.WithIndex())
        {
            int day = startDay + ri * step;
            foreach (var (a, b) in pairs)
            {
                stateFixtures.Add(MkFixture(new Fixture
                {
                    Day = day, Stage = stage, Comp = comp, TeamA = a, TeamB = b,
                    Bo = bo, Label = $"{name} 第{ri + 1}轮",
                }));
            }
        }
    }

    /// <summary>单败杯赛：整棵树生成（8 队，QF→SF→Final），后轮对阵留空待回填；总决赛固定 BO5。</summary>
    public static List<List<string>> BuildCup(
        List<Fixture> stateFixtures,
        string comp, string name, string stage, List<string> teamIds, int startDay, int gapDays, int bo, Rng rng)
    {
        var seeded = rng.Shuffle(teamIds);
        var qf = new List<Fixture>();
        var sf = new List<Fixture>();
        var final = new List<Fixture>();
        for (int i = 0; i < 4; i++)
        {
            qf.Add(MkFixture(new Fixture
            {
                Day = startDay, Stage = stage, Comp = comp,
                TeamA = seeded[i * 2], TeamB = seeded[i * 2 + 1],
                Bo = bo, Label = $"{name} 四分之一决赛",
            }));
        }
        for (int i = 0; i < 2; i++)
        {
            sf.Add(MkFixture(new Fixture
            {
                Day = startDay + gapDays, Stage = stage, Comp = comp,
                TeamA = "", TeamB = "", Bo = bo, Label = $"{name} 半决赛",
            }));
        }
        final.Add(MkFixture(new Fixture
        {
            Day = startDay + gapDays * 2, Stage = stage, Comp = comp,
            TeamA = "", TeamB = "", Bo = 5, Label = $"{name} 总决赛",
        }));
        qf[0].NextFixtureId = sf[0].Id;
        qf[1].NextFixtureId = sf[0].Id;
        qf[2].NextFixtureId = sf[1].Id;
        qf[3].NextFixtureId = sf[1].Id;
        sf[0].NextFixtureId = final[0].Id;
        sf[1].NextFixtureId = final[0].Id;
        stateFixtures.AddRange(qf);
        stateFixtures.AddRange(sf);
        stateFixtures.AddRange(final);
        return new List<List<string>> { qf.Select(x => x.Id).ToList(), sf.Select(x => x.Id).ToList(), final.Select(x => x.Id).ToList() };
    }

    /// <summary>杯赛回填：胜者进 nextFixtureId；双败树败者进 nextLoserFixtureId。</summary>
    public static void FillNextSlot(List<Fixture> fixtures, Fixture finished, string winnerTeamId)
    {
        var loserTeamId = finished.TeamA == winnerTeamId ? finished.TeamB : finished.TeamA;
        void Route(string? targetId, string teamId)
        {
            if (targetId == null) return;
            var next = fixtures.FirstOrDefault(f => f.Id == targetId);
            if (next == null) return;
            if (next.TeamA == "") next.TeamA = teamId;
            else if (next.TeamB == "") next.TeamB = teamId;
        }
        Route(finished.NextFixtureId, winnerTeamId);
        Route(finished.NextLoserFixtureId, loserTeamId);
    }

    /// <summary>
    /// 瑞士轮配对（v1.0-3b）：同战绩一组、组内相邻配对，优先避同赛区与重赛。
    /// 确定性：组内按败场升序 + 队 id 稳定排序，不耗 rng。
    /// </summary>
    public static List<(string A, string B)> PairSwissRound(
        IReadOnlyList<(string TeamId, int Wins, int Losses)> entries,
        Func<string, string> regionOf,
        IReadOnlySet<string> playedPairs)
    {
        string Pk(string x, string y) => string.CompareOrdinal(x, y) < 0 ? $"{x}|{y}" : $"{y}|{x}";
        var byWins = new SortedDictionary<int, List<(string TeamId, int Wins, int Losses)>>();
        foreach (var e in entries)
        {
            if (!byWins.TryGetValue(e.Wins, out var arr)) { arr = new List<(string, int, int)>(); byWins[e.Wins] = arr; }
            arr.Add(e);
        }
        var pairs = new List<(string, string)>();
        foreach (var w in byWins.Keys.OrderByDescending(k => k))
        {
            var pool = byWins[w]
                .OrderBy(e => e.Losses)
                .ThenBy(e => string.CompareOrdinal(e.TeamId, "0") >= 0 ? e.TeamId : e.TeamId) // 稳定：按队 id 升序
                .Select(e => e.TeamId)
                .ToList();
            while (pool.Count >= 2)
            {
                string a = pool[0];
                pool.RemoveAt(0);
                int idx = pool.FindIndex(b => regionOf(b) != regionOf(a) && !playedPairs.Contains(Pk(a, b)));
                if (idx < 0) idx = pool.FindIndex(b => !playedPairs.Contains(Pk(a, b)));
                if (idx < 0) idx = 0;
                pairs.Add((a, pool[idx]));
                pool.RemoveAt(idx);
            }
        }
        return pairs;
    }

    /// <summary>生成瑞士轮一轮 fixtures（对阵由调用方给出）。</summary>
    public static void BuildSwissRound(
        List<Fixture> stateFixtures,
        string comp, string name, string stage, List<(string A, string B)> pairs, int day, int roundNo, int bo)
    {
        foreach (var (a, b) in pairs)
        {
            stateFixtures.Add(MkFixture(new Fixture
            {
                Day = day, Stage = stage, Comp = comp, TeamA = a, TeamB = b,
                Bo = bo, Label = $"{name} 瑞士轮第{roundNo}轮",
            }));
        }
    }

    /// <summary>
    /// 8 队双败淘汰树（Masters/Champions 淘汰赛共用）：胜者组 3 轮 + 败者组 4 轮 + BO5 总决赛。
    /// </summary>
    public static List<List<string>> BuildDoubleElim(
        List<Fixture> stateFixtures,
        string comp, string name, string stage, List<(string A, string B)> pairs, int startDay, int gapDays, int bo)
    {
        Fixture Mk(int day, string label, string a = "", string b = "", int? forcedBo = null)
        {
            var f = MkFixture(new Fixture { Day = day, Stage = stage, Comp = comp, TeamA = a, TeamB = b, Bo = forcedBo ?? bo, Label = $"{name} {label}" });
            stateFixtures.Add(f);
            return f;
        }
        var ubR1 = pairs.Select(p => Mk(startDay, "胜者组第1轮", p.A, p.B)).ToList();
        var ubSf = new[] { Mk(startDay + gapDays, "胜者组半决赛"), Mk(startDay + gapDays, "胜者组半决赛") };
        var ubF = Mk(startDay + gapDays * 2, "胜者组决赛");
        var lbR1 = new[] { Mk(startDay + gapDays, "败者组第1轮"), Mk(startDay + gapDays, "败者组第1轮") };
        var lbR2 = new[] { Mk(startDay + gapDays * 2, "败者组第2轮"), Mk(startDay + gapDays * 2, "败者组第2轮") };
        var lbR3 = Mk(startDay + gapDays * 3, "败者组第3轮");
        var lbF = Mk(startDay + gapDays * 4, "败者组决赛");
        var final = Mk(startDay + gapDays * 5, "总决赛", forcedBo: 5);
        for (int i = 0; i < ubR1.Count; i++)
        {
            ubR1[i].NextFixtureId = ubSf[i >> 1].Id;
            ubR1[i].NextLoserFixtureId = lbR1[i >> 1].Id;
        }
        for (int i = 0; i < ubSf.Length; i++)
        {
            ubSf[i].NextFixtureId = ubF.Id;
            ubSf[i].NextLoserFixtureId = lbR2[i].Id;
        }
        ubF.NextFixtureId = final.Id;
        ubF.NextLoserFixtureId = lbF.Id;
        for (int i = 0; i < lbR1.Length; i++) { lbR1[i].NextFixtureId = lbR2[i].Id; }
        foreach (var f in lbR2) { f.NextFixtureId = lbR3.Id; }
        lbR3.NextFixtureId = lbF.Id;
        lbF.NextFixtureId = final.Id;
        return new List<List<string>>
        {
            ubR1.Select(f => f.Id).ToList(), ubSf.Select(f => f.Id).ToList(), new List<string> { ubF.Id },
            lbR1.Select(f => f.Id).ToList(), lbR2.Select(f => f.Id).ToList(), new List<string> { lbR3.Id },
            new List<string> { lbF.Id }, new List<string> { final.Id },
        };
    }
}
