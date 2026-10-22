using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>M2 日循环包装：钩子时序（门票/施工/周结算/成就/翻年退役）+ 确定性 + 终局冻结 + 停车管线。
/// C# 侧原生编排（TS worker 的对应物 + 开罗钩子），单元断言而非黄金。</summary>
public sealed class AppLoopTests
{
    private static GameState NewState(long budget = 50_000_000)
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 0;
        DaySim.InitSeasonFixtures(state);
        state.Teams[state.MyTeamId!].Budget = budget;
        return state;
    }

    [Fact]
    public void Ending_Freezes_World()
    {
        var state = NewState();
        state.Manager.Career = new ManagerCareer { Ending = new CareerEnding { Kind = "fired", Year = 1, Day = 100 } };
        int day = state.Day;
        var r = AppLoop.Advance(state, 5);
        Assert.Equal(day, state.Day);
        Assert.Empty(r.Notes);
    }

    [Fact]
    public void Determinism_Same_Seed_Same_Trajectory()
    {
        var a = NewState();
        var b = NewState();
        var ra = AppLoop.Advance(a, 30);
        var rb = AppLoop.Advance(b, 30);
        Assert.Equal(ra.Notes, rb.Notes);
        Assert.Equal((long)a.Teams[a.MyTeamId!].Budget, (long)b.Teams[b.MyTeamId!].Budget);
        Assert.Equal(a.Players.Values.First(p => p.TeamId == a.MyTeamId).Morale,
                     b.Players.Values.First(p => p.TeamId == b.MyTeamId).Morale);
    }

    [Fact]
    public void Base_Weekly_Feeds_Facilities_And_Income()
    {
        var state = NewState();
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        BaseOps.BuyPlot(state, b, 1, 0);
        BaseOps.StartBuild(state, b, 0, 0, "range"); // facilities 3
        BaseOps.StartBuild(state, b, 1, 0, "shop");  // weeklyIncome 3000
        var r = AppLoop.Advance(state, 7);           // 7 天：施工 4 天落成，末日触发周结算
        Assert.Equal(3, myTeam.Facilities);          // 修正量输入落点
        // 预算精确账：50M − 地 800K − 射击房 400K − 周边店 250K + 基地周收入 3000 + 内核商务周收入 4833
        Assert.Equal(50_000_000L - 1_450_000 + 7_833, (long)myTeam.Budget);
        Assert.True(r.Notes.Any(n => n.Contains("基地周报")));
    }

    [Fact]
    public void Ticket_HomeMatch_WithArena()
    {
        var state = NewState(budget: 50_000_000);
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        BaseOps.BuyPlot(state, b, 1, 0);
        BaseOps.StartBuild(state, b, 0, 0, "arena"); // 容量 800，8 天
        // 推进 10 天：场馆落成，且尚在季前（无比赛）
        AppLoop.Advance(state, 10);
        Assert.Equal(1, b.Plots[BaseState.KeyOf(0, 0)].Level);
        // 联赛首轮 day 55，我的主场（worldgen 排期 KRÜ 为 teamA）
        double budgetBefore = myTeam.Budget;
        var r = AppLoop.Advance(state, 50); // 推进到首轮之后
        Assert.Equal(800, BaseOps.Capacity(b));
        // 首轮主场票房已入账（财务流水锚定，金额=容量×票价）
        var ticketEntry = state.Finances.Log.FirstOrDefault(e => e.Label.StartsWith("门票"));
        Assert.NotNull(ticketEntry);
        Assert.Equal(800 * 20, ticketEntry!.Amount);
        _ = budgetBefore;
        Assert.True(r.Notes.Count > 0);
    }

    [Fact]
    public void Held_Parking_Pipeline_With_Settle_Tickets()
    {
        var state = NewState(budget: 50_000_000);
        var b = BaseOps.NewBase();
        state.Base = b;
        BaseOps.BuyPlot(state, b, 1, 0);
        BaseOps.StartBuild(state, b, 0, 0, "arena");
        AppLoop.Advance(state, 10);
        var myTeam = state.Teams[state.MyTeamId!];
        double budgetBefore = myTeam.Budget;
        // 直接构造我的已排期比赛场景：跳到联赛首轮前一天（day 54），拦 dunk 提前备赛
        while (state.Day < 54) AppLoop.Advance(state, 1);
        string? held = null;
        while (held == null)
        {
            var r = AppLoop.Advance(state, 1, null, (_f, _a, _b2, _bo, _l) => true);
            held = r.HeldFixtureId;
            if (state.Day > 70) break; // 防御
        }
        Assert.NotNull(held);
        var f = state.Fixtures.First(x => x.Id == held);
        Assert.False(f.Played);
        // 赛前准备 → 干预 → 结算
        var rec1 = AppLoop.PlayHeld(state, held!, new DaySim.HeldMatchOptions { Starters = myTeam.Roster.Take(5).ToList() });
        Assert.NotNull(rec1);
        var rec2 = AppLoop.InterveneHeld(state, held!, new MatchIntervention { Map = 0, Round = 5, Tactic = "atk:rush" });
        Assert.NotNull(rec2);
        bool settled = AppLoop.SettleHeld(state, held!, rec2);
        Assert.True(settled);
        Assert.True(f.Settled == true);
        // 主场结算 → 门票入账（KRÜ 首轮为主队 teamA）
        if (f.TeamA == state.MyTeamId)
        {
            long diff = (long)myTeam.Budget - (long)budgetBefore;
            Assert.True(diff > 800 * 20 - 1, $"主场门票未入账？diff={diff}");
        }
    }

    [Fact]
    public void SeasonEnd_Triggers_Retirements_And_Year_Rollover()
    {
        var state = NewState();
        var r = AppLoop.Advance(state, 400); // 赛季收官即停（365 天 + 翻年附加结算）
        Assert.True(state.Day < 100, $"应在赛季末停止推进（day={state.Day}）");
        Assert.Equal(2027, state.Year);
        // 世界中存在 ≥29 岁 AI 选手 → 检定必有退役流（留档/劝留卡/续约新闻至少其一）
        Assert.True(state.RetireLog.Count > 0 || state.PendingEvents.Any(e => e.CardId == "retire"),
            "赛季末退役检定未触发");
        _ = r;
    }
}
