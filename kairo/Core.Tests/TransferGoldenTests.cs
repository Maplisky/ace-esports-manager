using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>transfer 黄金轨迹回放：身价/期望/报价评估（全分支）/谈判/成交/解约/AI 周动态/问价 逐位。</summary>
public sealed class TransferGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "transfer.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 130;
        return state;
    }

    /// <summary>录制器 ③ 的谈判终态 offer（两轮加价后 $8.2M × 3 年）；finalizeOffer 是纯函数不改状态。</summary>
    private static TransferOffer MakeCompletedOffer(Player target, Team buyer) => new()
    {
        Id = "M1", PlayerId = target.Id, FromTeam = target.TeamId, ToTeam = buyer.Id,
        Fee = 8200000, Salary = Transfer.SalaryExpectation(target, 1) * 2, Years = 3,
        SigningBonus = 400000, PromisedRole = "starter",
    };

    /// <summary>录制器 ⑥ 的 AI 周动态静默复放（供 inquiries 延续同一世界：日期推进至窗末 152）。</summary>
    private static void ApplyAiWeeks(GameState state)
    {
        var rng = new Rng(66);
        foreach (var w in Golden.Value["aiWeeks"]!.AsArray())
        {
            state.Day = w!["day"]!.GetValue<int>();
            Transfer.AiWeeklyTransfers(state, rng, _ => { });
        }
    }

    [Fact]
    public void MarketValue_SalaryExpectation_BitExact()
    {
        var state = BuildWorld();
        var vec = Golden.Value["mvVec"]!.AsArray();
        for (int i = 0; i < vec.Count; i++)
        {
            var v = vec[i]!;
            var p = state.Players.Values.ToList()[i];
            Assert.Equal(v!["id"]!.GetValue<string>(), p.Id);
            Assert.Equal(v["mv1"]!.GetValue<int>(), Transfer.MarketValue(p, 1));
            Assert.Equal(v["mv2"]!.GetValue<int>(), Transfer.MarketValue(p, 2));
            Assert.Equal(v["se1"]!.GetValue<int>(), Transfer.SalaryExpectation(p, 1));
            Assert.Equal(v["se2"]!.GetValue<int>(), Transfer.SalaryExpectation(p, 2));
        }
    }

    [Fact]
    public void EvaluateOffer_BitExact()
    {
        var state = BuildWorld();
        var target = state.Players.Values.ToList()[0];
        target.ReleaseClause = 0;
        target.NoPoach = false;
        var buyer = state.Teams.Values.ToList()[3];
        var cases = Golden.Value["offerCases"]!.AsArray();
        for (int i = 0; i < cases.Count; i++)
        {
            var e = cases[i]!;
            // 每案例变异与录制器一致：case 3 前设解约金 300 万，case 4 前清除并置 noPoach
            if (i == 3) target.ReleaseClause = 3000000;
            if (i == 4) { target.ReleaseClause = 0; target.NoPoach = true; }
            var offer = new Transfer.OfferTerms
            {
                Fee = e["offer"]!["fee"]!.GetValue<double>(),
                Salary = e["offer"]!["salary"]!.GetValue<int>(),
                Years = e["offer"]!["years"]!.GetValue<int>(),
                SigningBonus = e["offer"]!["signingBonus"]!.GetValue<int>(),
                PromisedRole = e["offer"]!["promisedRole"]!.GetValue<string>(),
                Track = e["offer"]!["track"]?.GetValue<string>(),
            };
            var ev = Transfer.EvaluateOffer(state, target, offer, buyer);
            Assert.True(
                e["insulting"]!.GetValue<bool>() == ev.Insulting
                && e["chance"]!.GetValue<string>() == Hex(ev.Chance)
                && (e["objection"]?.GetValue<string>() ?? "") == (ev.Objection ?? "")
                && e["score"]!.GetValue<string>() == Hex(ev.Score),
                $"offerCase[{i}]: {e.ToJsonString()} vs insulting={ev.Insulting} chance={Hex(ev.Chance)} objection={ev.Objection ?? "null"} score={Hex(ev.Score)}");
        }
    }

    [Fact]
    public void NegotiationAndFinalize_BitExact()
    {
        var state = BuildWorld();
        var target = state.Players.Values.ToList()[0];
        target.ReleaseClause = 0;
        target.NoPoach = false;
        var buyer = state.Teams.Values.ToList()[3];
        var c = Golden.Value["negotiation"]!;
        var offer = MakeOffer(target, buyer);
        var r1 = Transfer.StartNegotiation(state, offer);
        Assert.Equal(c["n1"]!["demand"]!.GetValue<string>(), r1.Demand);
        Assert.Equal(c["n1"]!["attitude"]!.GetValue<int>(), r1.Attitude);
        Assert.Equal(c["n1"]!["insulting"]!.GetValue<bool>(), r1.Insulting);
        offer.Round = 1;
        offer.Fee = 5200000;
        offer.Salary = Transfer.SalaryExpectation(target, 1) + 15000;
        var r2 = Transfer.ReNegotiate(state, offer);
        Assert.Equal(c["n2"]!["demand"]!.GetValue<string>(), r2.Demand);
        Assert.Equal(c["n2"]!["attitude"]!.GetValue<int>(), r2.Attitude);
        offer.Fee += 3000000;
        offer.Salary = Transfer.SalaryExpectation(target, 1) * 2;
        var r3 = Transfer.ReNegotiate(state, offer);
        Assert.Equal(c["n3"]!["demand"]!.GetValue<string>(), r3.Demand);
        Assert.Equal(c["n3"]!["attitude"]!.GetValue<int>(), r3.Attitude);
        var fin = Transfer.FinalizeOffer(state, offer, new Rng(21));
        Assert.Equal(c["fin"]!["accepted"]!.GetValue<bool>(), fin.Accepted);
        Assert.Equal(c["fin"]!["reason"]!.GetValue<string>(), fin.Reason);
    }

    private static TransferOffer MakeOffer(Player target, Team buyer) => new()
    {
        Id = "M1", PlayerId = target.Id, FromTeam = target.TeamId, ToTeam = buyer.Id,
        Fee = 5200000, Salary = Transfer.SalaryExpectation(target, 1) + 15000, Years = 3,
        SigningBonus = 400000, PromisedRole = "starter",
    };

    [Fact]
    public void CompleteRelease_BitExact()
    {
        var state = BuildWorld();
        var target = state.Players.Values.ToList()[0];
        target.ReleaseClause = 0;
        var buyer = state.Teams.Values.ToList()[3];
        var notes = Transfer.CompleteTransfer(state, MakeCompletedOffer(target, buyer), new Rng(33));
        Assert.Equal(Golden.Value["transferNotes"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray(), notes);
        var relText = Transfer.ReleasePlayer(state, state.Players.Values.First(p => p.TeamId == buyer.Id).Id);
        Assert.Equal(Golden.Value["releaseText"]!.GetValue<string>(), relText);
    }

    [Fact]
    public void AiWeekly_BitExact()
    {
        var state = BuildWorld();
        var target = state.Players.Values.ToList()[0];
        var buyer = state.Teams.Values.ToList()[3];
        Transfer.CompleteTransfer(state, MakeCompletedOffer(target, buyer), new Rng(33));
        Transfer.ReleasePlayer(state, state.Players.Values.First(p => p.TeamId == buyer.Id).Id);
        var rng = new Rng(66);
        var bidsSeen = new List<JsonObject>();
        var weeks = Golden.Value["aiWeeks"]!.AsArray();
        for (int wi = 0; wi < weeks.Count; wi++)
        {
            var w = weeks[wi]!;
            state.Day = w["day"]!.GetValue<int>();
            var notes = Transfer.AiWeeklyTransfers(state, rng, (offer) => bidsSeen.Add(new JsonObject
            {
                ["id"] = offer.Id, ["playerId"] = offer.PlayerId, ["fromTeam"] = offer.FromTeam ?? "",
                ["toTeam"] = offer.ToTeam, ["fee"] = (int)offer.Fee,
            }));
            Assert.Equal(w["notes"]!.AsArray().Select(x => x!.GetValue<string>()), notes);
            Assert.Equal(w["bids"]!.AsArray().Select(b => (b!["id"]!.GetValue<string>(), b["playerId"]!.GetValue<string>(), b["fromTeam"]!.GetValue<string>(), b["toTeam"]!.GetValue<string>(), b["fee"]!.GetValue<int>())).ToArray(),
                bidsSeen.Select(b => (b["id"]!.GetValue<string>(), b["playerId"]!.GetValue<string>(), b["fromTeam"]!.GetValue<string>(), b["toTeam"]!.GetValue<string>(), b["fee"]!.GetValue<int>())).ToArray());
            Assert.Equal(w["incoming"]!.AsArray().Select(o => (o!["id"]!.GetValue<string>(), o["fee"]!.GetValue<int>())).ToArray(),
                state.IncomingBids.Select(o => (o.Id, o.Fee)).ToArray());
        }
    }

    [Fact]
    public void Inquiries_BitExact()
    {
        var state = BuildWorld();
        var pool = state.Players.Values.ToList();
        var buyer = state.Teams.Values.ToList()[3];
        Transfer.CompleteTransfer(state, MakeCompletedOffer(pool[0], buyer), new Rng(33));
        Transfer.ReleasePlayer(state, state.Players.Values.First(p => p.TeamId == buyer.Id).Id);
        ApplyAiWeeks(state);
        var rng = new Rng(70);
        var trace = Golden.Value["inqTrace"]!.AsArray();
        var q1 = Transfer.AskInquiry(state, pool[2].Id, rng);
        var q2 = Transfer.AskInquiry(state, pool[3].Id, rng);
        Assert.Equal(trace[0]!["q1"]!.GetValue<string>(), q1);
        Assert.Equal(trace[0]!["q2"]!.GetValue<string>(), q2);
        state.Day = 131;
        Transfer.ResolveInquiries(state);
        AssertDeepEqual(trace[1]!["inquiries"]!, new JsonArray(state.Inquiries.Select(q => (JsonNode)new JsonObject
        {
            ["id"] = q.Id, ["playerId"] = q.PlayerId, ["done"] = q.Done,
            ["askingFee"] = q.AskingFee, ["intent"] = q.Intent,
        }).ToArray()), "inq");
        state.Day = 200;
        Transfer.ResolveInquiries(state);
        Assert.Equal(trace[2]!["remaining"]!.GetValue<int>(), state.Inquiries.Count);
        Assert.Equal(trace[2]!["grace"]!.GetValue<int>(), Transfer.GraceRemain(state));
    }

    private static void AssertDeepEqual(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null || actual == null)
        {
            Assert.True(expected == null && actual == null,
                $"{path}: one side null (expected={expected?.ToJsonString()}, actual={actual?.ToJsonString()})");
            return;
        }
        if (expected.ToJsonString() == actual.ToJsonString()) return;
        if (expected is JsonArray earr && actual is JsonArray aarr)
        {
            Assert.True(earr.Count == aarr.Count, $"{path}: array count {earr.Count} vs {aarr.Count}");
            for (int i = 0; i < earr.Count; i++)
                AssertDeepEqual(earr[i], aarr[i], $"{path}[{i}]");
            return;
        }
        if (expected is JsonObject eobj && actual is JsonObject aobj)
        {
            var ek = eobj.Select(kv => kv.Key).ToArray();
            var ak = aobj.Select(kv => kv.Key).ToArray();
            Assert.True(ek.SequenceEqual(ak), $"{path}: keys differ");
            foreach (var (kv, i) in ek.WithIndex())
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }
}
