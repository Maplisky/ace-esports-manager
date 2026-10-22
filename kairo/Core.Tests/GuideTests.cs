using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>解锁节奏（§9.1）：首赛季按天出提示、第二赛季静默、幂等。</summary>
public sealed class GuideTests
{
    private static GameState NewState()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 0;
        DaySim.InitSeasonFixtures(state);
        state.Base = BaseOps.NewBase();
        Career.InitCareer(state, "analyst");
        return state;
    }

    [Fact]
    public void UnlockNotes_OnScheduledDays_FirstSeasonOnly()
    {
        var state = NewState();
        // 首赛季：D3/D8/D12/D17/D20 各出一条
        var hits = new System.Collections.Generic.List<string>();
        for (int i = 0; i < 25; i++)
        {
            var r = AppLoop.Advance(state, 1);
            hits.AddRange(r.Notes.Where(n => n.Contains("📖")));
        }
        Assert.Equal(5, hits.Count);
        Assert.Contains(hits, n => n.Contains("D3"));
        Assert.Contains(hits, n => n.Contains("D20"));
        Assert.All(hits, n => Assert.Contains(state.News, x => x.Text == n)); // 已入档
    }

    [Fact]
    public void SecondSeason_Silent()
    {
        var state = NewState();
        state.Manager.Career!.StartYear = state.Year - 1; // 模拟第二赛季
        state.Manager.Career!.Seasons = 2;
        state.Day = 2;
        var r = AppLoop.Advance(state, 2); // 推过 D3
        Assert.DoesNotContain(r.Notes, n => n.Contains("📖"));
    }

    [Fact]
    public void NoCareer_Silent()
    {
        var state = NewState();
        state.Manager.Career = null;
        state.Day = 2;
        var r = AppLoop.Advance(state, 2);
        Assert.DoesNotContain(r.Notes, n => n.Contains("📖"));
    }
}
