using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>白手起家开档三选（立项 §3.1，2026-10-22 拍板 a/b/c 全开放）：
/// 自定义加盟 / 接管改名 / 剧本弱旅——确定性、赛程重建、内核衔接。</summary>
public sealed class NewGameTests
{
    private static GameState NewWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.Day = 0;
        DaySim.InitSeasonFixtures(state);
        return state;
    }

    [Fact]
    public void Custom_Start_Signs_Squad_And_Rebuilds_Fixtures()
    {
        var state = NewWorld();
        var freeBefore = state.Players.Values.Count(p => p.TeamId == null);
        var log = NewGame.Start(state, new StartConfig { Mode = StartMode.Custom, TeamName = "星火电竞", Region = "americas" });

        var team = state.Teams[NewGame.CustomTeamId];
        Assert.NotNull(team);
        Assert.Equal("星火电竞", team.Name);
        Assert.Equal(2, team.Tier);
        Assert.Equal(NewGame.CustomBudget, (long)team.Budget);
        Assert.Equal(5, team.Roster.Count);
        Assert.Equal(5, team.Starters.Count);
        Assert.All(team.Roster, id => Assert.Equal(team.Id, state.Players[id].TeamId));
        Assert.Equal(freeBefore - 5, state.Players.Values.Count(p => p.TeamId == null));
        Assert.Equal(state.MyTeamId, team.Id);
        // 赛程重建：新队进入 americas 挑战者联赛（原 5 队 + 新队 = 6）
        var comp = state.Comps["stage2-americas-t2"];
        Assert.Contains(NewGame.CustomTeamId, comp.TeamIds);
        Assert.Equal(6, comp.TeamIds.Count);
        Assert.Single(state.Base!.Plots); // 基地从零：1 块空地
        Assert.Contains("星火电竞", log[0]);
    }

    [Fact]
    public void Custom_Deterministic_Squad()
    {
        var a = NewWorld();
        var b = NewWorld();
        NewGame.Start(a, new StartConfig { Mode = StartMode.Custom, TeamName = "A队" });
        NewGame.Start(b, new StartConfig { Mode = StartMode.Custom, TeamName = "B队" });
        var ra = a.Teams[NewGame.CustomTeamId].Roster;
        var rb = b.Teams[NewGame.CustomTeamId].Roster;
        Assert.Equal(ra, rb); // 自由池排序确定 → 两局签同一批人
    }

    [Fact]
    public void Takeover_Keeps_Squad_Renames()
    {
        var state = NewWorld();
        var target = state.Teams.Values.Where(t => t.Tier == 2).OrderBy(t => t.Budget).First();
        var rosterBefore = target.Roster.ToList();
        double budgetBefore = target.Budget;
        var log = NewGame.Start(state, new StartConfig { Mode = StartMode.Takeover, TeamName = "涅槃电竞", TakeoverTeamId = target.Id });
        Assert.Equal(target.Id, state.MyTeamId);
        Assert.Equal("涅槃电竞", target.Name);
        Assert.Equal(rosterBefore, target.Roster);
        Assert.Equal(budgetBefore, (long)target.Budget); // 接管：保留原班底与预算
        Assert.Contains("接管", log[0]);
    }

    [Fact]
    public void Script_Mode_Cuts_Budget()
    {
        var state = NewWorld();
        var target = state.Teams.Values.Where(t => t.Tier == 2).OrderBy(t => t.Budget).First();
        var rosterBefore = target.Roster.ToList();
        NewGame.Start(state, new StartConfig { Mode = StartMode.Script });
        Assert.Equal(target.Id, state.MyTeamId);
        Assert.Equal(NewGame.ScriptBudget, (long)target.Budget);
        Assert.Equal(rosterBefore, target.Roster);
    }

    [Fact]
    public void Custom_Then_Week_Advance_Sanity()
    {
        var state = NewWorld();
        NewGame.Start(state, new StartConfig { Mode = StartMode.Custom, TeamName = "星火电竞" });
        var r = AppLoop.Advance(state, 7);
        Assert.Equal(7, state.Day);
        Assert.True(r.Notes.Count > 0);
        // 自定义队无赞助/无赛事：一周无收支
        Assert.Equal(NewGame.CustomBudget, (long)state.Teams[NewGame.CustomTeamId].Budget);
    }
}
