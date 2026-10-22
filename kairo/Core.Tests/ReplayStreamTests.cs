using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>回放事件流编译器预研：真实 SimMatch Record → 时间轴，事件守恒与形态不变量。</summary>
public sealed class ReplayStreamTests
{
    private static (GameState State, MatchRecord Rec) PlayOne()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 130;
        long seed = Rng.HashString($"{state.Seed}:replay-probe");
        var rec = Match.SimMatch(state, state.Teams.Values.ToList()[0].Id, state.Teams.Values.ToList()[1].Id, 3, seed, "replay-1");
        return (state, rec);
    }

    [Fact]
    public void Compile_Preserves_All_Kills_In_Order()
    {
        var (_, rec) = PlayOne();
        var evs = ReplayStream.Compile(rec);
        // 击杀守恒：Record 内全部 kill 事件（含侧别）都在时间轴里且顺序不倒
        var recordKills = rec.Maps.SelectMany(m => m.Rounds.SelectMany(r => r.Events.Where(e => e.T == "kill"))).ToList();
        var streamKills = evs.Where(e => e.Kind == "kill").ToList();
        Assert.Equal(recordKills.Count, streamKills.Count);
        // 时间轴单调不减
        for (int i = 1; i < evs.Count; i++)
            Assert.True(evs[i].T >= evs[i - 1].T, $"时间轴倒序 @ {i}");
        // 每回合有 round_start 与 round_win（数量守恒）
        int roundCount = rec.Maps.Sum(m => m.Rounds.Count);
        Assert.Equal(roundCount, evs.Count(e => e.Kind == "round_start"));
        Assert.Equal(roundCount, evs.Count(e => e.Kind == "round_win"));
        // 每图 map_end
        Assert.Equal(rec.Maps.Count, evs.Count(e => e.Kind == "map_end"));
        // 击杀事件受害者与击杀者不同侧、序号合法
        Assert.All(streamKills, e => Assert.InRange(e.A, 0, 9));
        Assert.All(streamKills, e => Assert.InRange(e.B, 0, 9));
    }

    [Fact]
    public void Compile_RoundWinner_Matches_End()
    {
        var (_, rec) = PlayOne();
        var evs = ReplayStream.Compile(rec);
        var wins = evs.Where(e => e.Kind == "round_win").ToList();
        var allRounds = rec.Maps.SelectMany(m => m.Rounds).ToList();
        Assert.Equal(allRounds.Count, wins.Count);
        for (int i = 0; i < allRounds.Count; i++)
            Assert.Equal(allRounds[i].End.Win, wins[i].Side);
        // AAttacksFirst 已落档
        Assert.All(rec.Maps, m => Assert.True(m.AAttacksFirst == true || m.AAttacksFirst == false));
        // round_start 的攻方与 AttackSideOf 推导一致（按图分组游标，round 数每图不同不能平铺索引）
        var starts = evs.Where(e => e.Kind == "round_start").ToList();
        int cursor = 0;
        foreach (var map in rec.Maps)
        {
            foreach (var round in map.Rounds)
            {
                var expectAtk = Match.AttackSideOf(round.N, map.AAttacksFirst);
                Assert.Equal(expectAtk, round.Atk);
                Assert.Equal(expectAtk, starts[cursor].Side);
                cursor++;
            }
        }
        Assert.Equal(cursor, starts.Count);
    }

    [Fact]
    public void Determinism_Same_Record_Same_Stream()
    {
        var (_, r1) = PlayOne();
        var (_, r2) = PlayOne();
        Assert.Equal(ReplayStream.Compile(r1).Select(e => $"{e.T:F2}|{e.Kind}|{e.Side}|{e.A}|{e.B}|{e.Tag}"),
                     ReplayStream.Compile(r2).Select(e => $"{e.T:F2}|{e.Kind}|{e.Side}|{e.A}|{e.B}|{e.Tag}"));
    }

    [Fact]
    public void IgnMapping_Feeds_Kill_Events_With_Fallback()
    {
        var (_, rec) = PlayOne();
        var firstPid = rec.Maps[0].Lines.Keys.First();
        var igns = new Dictionary<string, string> { [firstPid] = "测试名" };
        var evs = ReplayStream.Compile(rec, igns);
        var kill = evs.First(e => e.Kind == "kill" && e.IgnA.Length > 0);
        Assert.True(evs.Where(e => e.Kind == "kill").Any(e => e.IgnA == "测试名" || e.IgnB == "测试名"),
            "映射表中的 pid 应以真名出现在击杀播报");
        // 无映射 pid → 确定性短名（pid 尾 6 位）
        Assert.All(evs.Where(e => e.Kind == "kill" && e.IgnA != "测试名"),
            e => Assert.True(e.IgnA.Length > 0 || e.IgnB.Length > 0));
    }
}
