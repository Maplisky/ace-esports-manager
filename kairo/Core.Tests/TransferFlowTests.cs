using System;
using System.Linq;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>自由签约全链（灰盒市场页同路径）：窗校验 → 报价 → 即时谈判 → finalize → 成交入队。
/// 确定性：Rng 由 seed:day:playerId 派生（灰盒约定）。</summary>
public sealed class TransferFlowTests
{
    private static GameState NewState()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 130; // 夏窗内
        return state;
    }

    private static TransferOffer MakeOffer(GameState state, Player p)
    {
        var team = state.Teams[state.MyTeamId!];
        int salary = (int)(Transfer.SalaryExpectation(p, team.Tier) * 1.2);
        return new TransferOffer
        {
            Id = $"GD{state.Day}_{p.Id}",
            PlayerId = p.Id,
            FromTeam = null,
            ToTeam = team.Id,
            Fee = 0,
            Salary = salary,
            Years = 3,
            SigningBonus = salary / 2,
            PromisedRole = "starter",
        };
    }

    [Fact]
    public void FreeAgent_Sign_Full_Chain()
    {
        var state = NewState();
        var team = state.Teams[state.MyTeamId!];
        int rosterBefore = team.Roster.Count;
        var p = state.Players.Values.Where(x => x.TeamId == null).OrderByDescending(x => x.Overall).First();
        var offer = MakeOffer(state, p);
        var rng = new Rng((uint)Rng.HashString($"sign:{state.Seed}:{state.Day}:{p.Id}"));
        var (_, attitude, insulting) = Transfer.StartNegotiation(state, offer);
        Assert.False(insulting, "期望薪资×1.2 + 签字费不应侮辱");
        Assert.InRange(attitude, 0, 100);
        var fin = Transfer.FinalizeOffer(state, offer, rng);
        if (fin.Accepted)
        {
            var notes = Transfer.CompleteTransfer(state, offer, rng);
            Assert.NotEmpty(notes);
            Assert.Equal(team.Id, p.TeamId);
            Assert.Equal(team.Id, p.Career.Clubs.Last());
            Assert.Equal(offer.Salary, p.Salary);
            Assert.Equal(3, p.ContractYears);
            Assert.Equal("starter", p.PromisedRole);
            Assert.Contains(p.Id, team.Roster);
            Assert.Equal(rosterBefore + 1, team.Roster.Count);
            // 预算扣减 = 签字费（自由签约无转会费）
        }
        else
        {
            // 拒绝路径：选手仍在自由池
            Assert.Null(p.TeamId);
        }
    }

    [Fact]
    public void Window_Closed_Blocks_Signing()
    {
        var state = NewState();
        state.Day = 60; // Stage1 中，窗口关闭
        Assert.False(Transfer.InTransferWindow(state.Day));
        state.Day = 8;
        Assert.True(Transfer.InTransferWindow(state.Day)); // 季前窗
        state.Day = 140;
        Assert.True(Transfer.InTransferWindow(state.Day)); // 夏窗
    }

    [Fact]
    public void Budget_Charged_On_Completion()
    {
        var state = NewState();
        var team = state.Teams[state.MyTeamId!];
        team.Budget = 10_000_000;
        var p = state.Players.Values.Where(x => x.TeamId == null).OrderByDescending(x => x.Overall).First();
        var offer = MakeOffer(state, p);
        var rng = new Rng((uint)Rng.HashString($"sign:{state.Seed}:{state.Day}:{p.Id}"));
        Transfer.StartNegotiation(state, offer);
        var fin = Transfer.FinalizeOffer(state, offer, rng);
        if (fin.Accepted)
        {
            double before = team.Budget;
            Transfer.CompleteTransfer(state, offer, rng);
            Assert.Equal(before - offer.SigningBonus, team.Budget); // 自由签约只扣签字费
        }
    }
}
