using System;
using System.IO;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>存档多槽：保存/读档往返逐字段 + 槽位列表 + 删除。
/// JSON 往返验证聚焦玩法关键字段（OrderedDict 序/基地区块/合同/金钱），不追求 STJ 全图同构。</summary>
public sealed class SaveSystemTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "kairo-save-test-" + Guid.NewGuid().ToString("N")[..8]);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static GameState NewState()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 0;
        DaySim.InitSeasonFixtures(state);
        Career.InitCareer(state, "analyst");
        NewGame.Start(state, new StartConfig { Mode = StartMode.Custom, TeamName = "存档测试队" });
        AppLoop.Advance(state, 30);
        return state;
    }

    [Fact]
    public void Save_List_Load_Roundtrip()
    {
        var state = NewState();
        var team = state.Teams[state.MyTeamId!];
        int day = state.Day;
        double budget = team.Budget;
        int roster = team.Roster.Count;
        int plots = state.Base!.Plots.Count;
        int comps = state.Comps.Count;
        int fixtures = state.Fixtures.Count;
        string firstRoster = team.Roster[0];

        SaveSystem.Save(state, _dir, 1, "custom");

        var list = SaveSystem.List(_dir);
        Assert.Equal(3, list.Count);
        Assert.Equal("存档测试队", list[0].TeamName);
        Assert.Equal(day, list[0].Day);
        Assert.Equal("", list[1].TeamName); // 空槽
        Assert.Equal("", list[2].TeamName);

        var loaded = SaveSystem.Load(_dir, 1);
        Assert.NotNull(loaded);
        var s2 = loaded!.Value.State;
        Assert.Equal(state.Year, s2.Year);
        Assert.Equal(day, s2.Day);
        Assert.Equal(state.MyTeamId, s2.MyTeamId);
        var team2 = s2.Teams[s2.MyTeamId!];
        Assert.Equal(budget, team2.Budget);
        Assert.Equal(roster, team2.Roster.Count);
        Assert.Equal(firstRoster, team2.Roster[0]); // 插入序保持
        Assert.Equal(plots, s2.Base!.Plots.Count);
        Assert.Equal(comps, s2.Comps.Count);
        Assert.Equal(fixtures, s2.Fixtures.Count);
        // 读档后可继续推进（Day+1 且不抛）
        var r = AppLoop.Advance(s2, 1);
        Assert.Equal(day + 1, s2.Day);
        _ = r;
    }

    [Fact]
    public void Overwrite_And_Delete()
    {
        var state = NewState();
        SaveSystem.Save(state, _dir, 2, "custom");
        Assert.Equal("存档测试队", SaveSystem.List(_dir)[1].TeamName);
        state.Day += 5;
        SaveSystem.Save(state, _dir, 2, "custom"); // 覆盖
        Assert.Equal(state.Day, SaveSystem.List(_dir)[1].Day);
        SaveSystem.Delete(_dir, 2);
        Assert.Equal("", SaveSystem.List(_dir)[1].TeamName);
    }
}
