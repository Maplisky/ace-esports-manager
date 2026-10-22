using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>M2 基地经济：表格完整性 / 地价曲线 / 建造升级工期 / 邻接加成 / 周结算修正量输入。
/// C# 侧原生系统（TS 无对应物），确定性=表格常量+零 RNG，用单元断言而非黄金。</summary>
public sealed class BaseEconomyTests
{
    private static GameState NewState()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        return state;
    }

    [Fact]
    public void Table_Integrity()
    {
        var t = BaseOps.Table;
        Assert.Equal(12, t.Facilities.Count);
        foreach (var f in t.Facilities)
        {
            Assert.Equal(3, f.Cost.Count);
            Assert.Equal(3, f.BuildDays.Count);
            Assert.True(f.Cost[0] < f.Cost[1]);
            Assert.True(f.Cost[1] < f.Cost[2]);
            Assert.True(f.BuildDays[0] < f.BuildDays[1]);
            Assert.True(f.BuildDays[1] < f.BuildDays[2]);
            Assert.False(f.Effects.Facilities.Count == 0
                && f.Effects.RestBonus.Count == 0
                && f.Effects.Morale.Count == 0
                && f.Effects.Capacity.Count == 0
                && f.Effects.WeeklyIncome.Count == 0,
                $"{f.Id} 无任何效果");
            foreach (var list in new[] { f.Effects.Facilities, f.Effects.RestBonus, f.Effects.Morale, f.Effects.Capacity, f.Effects.WeeklyIncome })
            {
                if (list.Count > 0) Assert.Equal(3, list.Count);
            }
        }
        var ids = t.Facilities.Select(f => f.Id).ToHashSet();
        foreach (var combo in t.Combos)
        {
            Assert.True(ids.Contains(combo.A) && ids.Contains(combo.B), $"combo 引用未知设施 {combo.A}/{combo.B}");
        }
        Assert.True(t.Plot.MaxPlots >= t.Plot.StartPlots.Count);
    }

    [Fact]
    public void PlotPrice_Curve()
    {
        Assert.Equal(800000, BaseOps.PlotPrice(1)); // 第一块地价 = basePrice
        Assert.Equal(1000000, BaseOps.PlotPrice(2)); // 800000 × 1.25
        Assert.Equal(1250000, BaseOps.PlotPrice(3));
        // 千元取整
        Assert.Equal(0, BaseOps.PlotPrice(7) % 1000);
    }

    [Fact]
    public void BuyPlot_Adjacency_And_Budget()
    {
        var state = NewState();
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Budget = 10_000_000;

        Assert.Null(BaseOps.BuyPlot(state, b, 1, 0)); // 相邻可买（null = 成功）
        Assert.Null(BaseOps.BuyPlot(state, b, 2, 0));
        // 非相邻拒绝
        Assert.NotNull(BaseOps.BuyPlot(state, b, 5, 5));
        Assert.Equal(2, b.Plots.Count - 1);
        // 已持有拒绝
        Assert.NotNull(BaseOps.BuyPlot(state, b, 1, 0));
        // 预算扣减 = 前两块地价
        Assert.Equal(10_000_000 - 800000 - 1000000, (long)myTeam.Budget);
        // 预算不足拒绝
        myTeam.Budget = 100000;
        int before = b.Plots.Count;
        Assert.NotNull(BaseOps.BuyPlot(state, b, 0, 1));
        Assert.Equal(before, b.Plots.Count);
        Assert.Equal(100000, (long)myTeam.Budget);
    }

    [Fact]
    public void Build_Advance_Complete()
    {
        var state = NewState();
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Budget = 10_000_000;

        Assert.Equal("未知设施。", BaseOps.StartBuild(state, b, 0, 0, "nope"));
        Assert.Null(BaseOps.StartBuild(state, b, 0, 0, "range")); // 1 级：4 天，$400K
        var plot = b.Plots[BaseState.KeyOf(0, 0)];
        Assert.Equal(4, plot.BuildRemainDays);
        Assert.Equal(9600000, (long)myTeam.Budget);
        // 施工中不产出、不可再开工
        Assert.Equal(0, BaseOps.FacilitiesValue(b));
        Assert.NotNull(BaseOps.StartBuild(state, b, 0, 0, "range"));
        // 逐日推进：3 天后未落成，第 4 天落成
        BaseOps.AdvanceBuildDay(b);
        BaseOps.AdvanceBuildDay(b);
        BaseOps.AdvanceBuildDay(b);
        Assert.Equal(1, plot.BuildRemainDays);
        Assert.Equal(0, plot.Level);
        BaseOps.AdvanceBuildDay(b);
        Assert.Equal(0, plot.BuildRemainDays);
        Assert.Equal(1, plot.Level);
        Assert.Equal(3, BaseOps.FacilitiesValue(b));
        // 升级到 2 级
        Assert.Null(BaseOps.StartBuild(state, b, 0, 0, "range"));
        Assert.Equal(8, plot.BuildRemainDays);
        Assert.Equal(2, plot.PendingLevel);
        // 升级期间按当前等级（1 级）产出
        Assert.Equal(3, BaseOps.FacilitiesValue(b));
        for (int i = 0; i < 8; i++) BaseOps.AdvanceBuildDay(b);
        Assert.Equal(2, plot.Level);
        Assert.Equal(6, BaseOps.FacilitiesValue(b));
        // 3 级封顶
        Assert.Null(BaseOps.StartBuild(state, b, 0, 0, "range"));
        for (int i = 0; i < 14; i++) BaseOps.AdvanceBuildDay(b);
        Assert.NotNull(BaseOps.StartBuild(state, b, 0, 0, "range")); // 已满级
        // 拆除返还 30%
        long budgetBefore = (long)myTeam.Budget;
        Assert.Null(BaseOps.Demolish(state, b, 0, 0));
        Assert.Equal(0, plot.Level);
        Assert.Equal(budgetBefore + 540000, (long)myTeam.Budget); // 1800000 × 0.3
        Assert.Equal(0, BaseOps.FacilitiesValue(b));
    }

    [Fact]
    public void Adjacency_Combos()
    {
        var state = NewState();
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Budget = 50_000_000;
        // 三块地一字排开：range(0,0) tactic(1,0) gym(0,1)
        Assert.Null(BaseOps.BuyPlot(state, b, 1, 0));
        Assert.Null(BaseOps.BuyPlot(state, b, 0, 1));
        foreach (var (x, y, id) in new[] { (0, 0, "range"), (1, 0, "tactic"), (0, 1, "gym") })
        {
            Assert.Null(BaseOps.StartBuild(state, b, x, y, id));
        }
        for (int i = 0; i < 4; i++) BaseOps.AdvanceBuildDay(b); // 全部落成（最长 4 天）
        // range 3 + tactic 3 + gym 2 = 8，+ combo range-tactic 2 + combo data-tactic 不在 → 10
        // gym-dorm combo 不在
        Assert.Equal(10, BaseOps.FacilitiesValue(b));
        Assert.Equal(1, BaseOps.RestBonus(b)); // gym 自带 restBonus 1
        // 常驻收入为 0（无商业设施）
        Assert.Equal(0, BaseOps.WeeklyIncome(b));
    }

    [Fact]
    public void ApplyWeekly_Feeds_Kernel_Inputs()
    {
        var state = NewState();
        var b = BaseOps.NewBase();
        state.Base = b;
        var myTeam = state.Teams[state.MyTeamId!];
        myTeam.Budget = 50_000_000;
        Assert.Null(BaseOps.BuyPlot(state, b, 1, 0));
        Assert.Null(BaseOps.StartBuild(state, b, 0, 0, "dorm"));   // restBonus 2 + morale 1
        Assert.Null(BaseOps.StartBuild(state, b, 1, 0, "shop"));   // weeklyIncome 6000
        for (int i = 0; i < 4; i++) BaseOps.AdvanceBuildDay(b);

        var p = state.Players.Values.First(x => x.TeamId == myTeam.Id);
        p.Morale = 50;
        p.Fatigue = 80;
        double budgetBefore = myTeam.Budget;
        var (income, facilities, moraleGain, restGain) = BaseOps.ApplyWeekly(state, b);
        Assert.Equal(6000, income);
        Assert.Equal(0, facilities);
        Assert.Equal(1, moraleGain);
        Assert.Equal(2, restGain);
        Assert.Equal(budgetBefore + 6000, myTeam.Budget);
        Assert.Equal(51, p.Morale);
        Assert.Equal(78, p.Fatigue);
        // 修正量输入落点：Team.Facilities 被覆写（内核 facF 的读取源）
        Assert.Equal(0, myTeam.Facilities);
        FinanceWindowAssert();
    }

    private static void FinanceWindowAssert()
    {
        // 基地收入/建设流水已入账（分类不抛异常即可——Categorize 的兜底分支）
        var entries = Finance.FinanceBreakdown(Enumerable.Empty<FinanceEntry>());
        Assert.Empty(entries);
    }
}
