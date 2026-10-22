using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>M2 调参演练：一整赛季（365 天）规则驱动经营 AI（优先级阶梯 + 预算留存门槛，全部走 AppLoop），
/// 逐月采样轨迹 + 经济健康不变量。收入结构参照立项 §3.2：奖金（战绩）+ 门票（场馆）+ 常驻（商业）。
/// 失败时轨迹表随断言消息输出（Console.Error 会被 xUnit 吞，诊断必须进断言消息）。</summary>
public sealed class SeasonRehearsalTests
{
    private static GameState NewState()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 0;
        DaySim.InitSeasonFixtures(state);
        state.Teams[state.MyTeamId!].Budget = 5_000_000; // 灰盒起步资金
        state.Base = BaseOps.NewBase();
        return state;
    }

    [Fact]
    public void FullSeason_Rehearsal()
    {
        var state = NewState();
        var myTeam = state.Teams[state.MyTeamId!];
        var b = state.Base!;

        int TicketEntries() => state.Finances.Log.Count(e => e.Label.StartsWith("门票"));
        double spentTotal = 0;
        double plotSpend = 0;
        bool Spend(double cost, double reserve, System.Action pay, bool isAsset = false)
        {
            if (myTeam.Budget < cost + reserve) return false;
            double before = myTeam.Budget;
            pay();
            double delta = before - myTeam.Budget;
            spentTotal += delta;
            if (isAsset) plotSpend += delta;
            return true;
        }
        var adjacentEmpty = () => b.Plots.Values
            .SelectMany(p => new[] { (1, 0), (-1, 0), (0, 1), (0, -1) }.Select(d => (p.X + d.Item1, p.Y + d.Item2)))
            .FirstOrDefault(c => !b.Plots.ContainsKey(BaseState.KeyOf(c.Item1, c.Item2)));
        PlotState? Find(string fid) => b.Plots.Values.FirstOrDefault(p => p.BuildingId == fid);
        PlotState? Empty() => b.Plots.Values.FirstOrDefault(p => p.BuildingId == null);

        var trajectory = new List<string>();
        double minBudget = double.MaxValue;
        for (int day = 1; day <= 400; day++)
        {
            // ── 经营 AI：赞助/商务（内核经营系统需要玩家主动签约——灰盒验证完整经营闭环）──
            var myTeam2 = state.Teams[state.MyTeamId!];
            int slots = myTeam2.Reputation >= 60 ? 4 : myTeam2.Reputation >= 35 ? 3 : 2;
            var bizRng = new Rng((uint)Rng.HashString($"biz:{state.Year}:{state.Day}"));
            for (int oi = state.SponsorOffers.Count - 1; oi >= 0 && myTeam2.Sponsors.Count < slots; oi--)
            {
                Business.SignSponsorOffer(state, state.SponsorOffers[oi], bizRng);
            }
            for (int gi = state.GigOffers.Count - 1; gi >= 0; gi--)
            {
                Business.AcceptGig(state, state.GigOffers[gi].Id);
            }

            // ── 基地经营 AI（优先级阶梯，每日检讨；reserve = 留存金避免抽干运营资金）──
            const double R = 600_000;
            var defRange = BaseOps.Table.Facility("range")!;
            var defShop = BaseOps.Table.Facility("shop")!;
            var defArena = BaseOps.Table.Facility("arena")!;
            // 1. 基础训练+商业起步
            if (Find("range") == null && Empty() is { } e1)
                Spend(defRange.Cost[0], 200_000, () => BaseOps.StartBuild(state, b, e1.X, e1.Y, "range"));
            if (Find("shop") == null && Empty() is { } e2)
                Spend(defShop.Cost[0], 200_000, () => BaseOps.StartBuild(state, b, e2.X, e2.Y, "shop"));
            // 2. 场馆（门票循环的钥匙）：缺馆且有空地 → 攒钱建
            if (Find("arena") == null && Empty() is { } e3)
                Spend(defArena.Cost[0], R, () => BaseOps.StartBuild(state, b, e3.X, e3.Y, "arena"));
            // 3. 扩地（开罗成长主轴，优先级高于奢侈品升级：留存 800K 即买）
            int price = BaseOps.PlotPrice(b.Plots.Count);
            if (b.Plots.Count < 8 && adjacentEmpty() is { } c4 && myTeam.Budget >= price + 800_000)
                Spend(price, 800_000, () => BaseOps.BuyPlot(state, b, c4.Item1, c4.Item2), isAsset: true);
            // 4. 第二座训练设施 + 商业升级
            if (Find("range") is { Level: >= 1 } r1 && Find("shop") is { Level: >= 1 }
                && Empty() is { } e5)
                Spend(defRange.Cost[0], R, () => BaseOps.StartBuild(state, b, e5.X, e5.Y, "tactic"));
            // 5. 升级循环：射击房 → 商业 → 场馆
            if (Find("range") is { Level: < 3 } ur && myTeam.Budget >= defRange.Cost[ur.Level] + R + 400_000)
                Spend(defRange.Cost[ur.Level], R + 400_000, () => BaseOps.StartBuild(state, b, ur.X, ur.Y, "range"));
            if (Find("shop") is { Level: < 3 } us && myTeam.Budget >= defShop.Cost[us.Level] + R + 400_000)
                Spend(defShop.Cost[us.Level], R + 400_000, () => BaseOps.StartBuild(state, b, us.X, us.Y, "shop"));

            var r = AppLoop.Advance(state, 1);
            if (myTeam.Budget < minBudget) minBudget = myTeam.Budget;
            if (day % 30 == 0)
            {
                trajectory.Add(
                    $"D{state.Day} ${myTeam.Budget / 1000.0:F0}K fac+{myTeam.Facilities} cap{BaseOps.Capacity(b)} plots{b.Plots.Count} tickets{TicketEntries()}");
            }
            if (r.SeasonEnded) break;
        }

        string traj = string.Join(" / ", trajectory);
        // ── 健康不变量 ──
        Assert.True(state.Year == 2027, $"赛季未翻年：Y{state.Year} D{state.Day} 轨迹[{traj}]");
        Assert.True(minBudget >= 0, $"赛季中预算穿底（最低 {minBudget / 1000.0:F0}K）轨迹[{traj}]");
        Assert.True(b.Plots.Count >= 4, $"地块数不足：{b.Plots.Count}（单赛季 4 块 + 全设施体系 = 「从零到有」达标；第 5 块 1.56M 留给第二赛季节奏） 轨迹[{traj}]");
        Assert.True(BaseOps.Capacity(b) >= 800, $"赛季内未建成场馆 轨迹[{traj}]");
        Assert.True(myTeam.Facilities >= 8, $"训练加成不足：+{myTeam.Facilities} 轨迹[{traj}]");
        Assert.True(TicketEntries() >= 5, $"主场门票入账次数不足：{TicketEntries()} 轨迹[{traj}]");
        // 收支结构：预算恒等式核算（Finances.Log 只留 100 条，赛季级统计必须用恒等式）：
        // 净经营收入 = 终局预算 − 起步资金 + 总投入；设施投入（扣地块资产）回收期 ≤ 2 赛季为健康开罗节奏
        int ticketTotal = state.Finances.Log.Where(e => e.Label.StartsWith("门票")).Sum(e => e.Amount);
        int bonusTotal = state.Finances.Log.Where(e => e.Label.StartsWith("奖金")).Sum(e => e.Amount);
        double netIncome = (double)myTeam.Budget + spentTotal - 5_000_000;
        double facilitySpend = spentTotal - plotSpend;
        Assert.True(netIncome > facilitySpend / 2,
            $"净经营收入 {netIncome / 1000.0:F0}K 未覆盖设施投入（{(facilitySpend / 1000.0):F0}K，另购地资产 {plotSpend / 1000.0:F0}K）的一半 轨迹[{traj}]");
        Console.WriteLine($"[rehearsal] {traj}");
        Console.WriteLine($"[rehearsal] end: ${myTeam.Budget / 1000.0:F0}K netIncome={netIncome / 1000.0:F0}K (tickets≥{ticketTotal / 1000}K bonus≥{bonusTotal / 1000}K) build={facilitySpend / 1000.0:F0}K plots={plotSpend / 1000.0:F0}K fac+{myTeam.Facilities}");
    }
}
