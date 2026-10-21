using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>business 黄金轨迹回放：商务刷新/签约检定/解约/周收入（业绩条款+直播 60/40）/邀约/直播合同 全链逐位。</summary>
public sealed class BusinessGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "business.golden.json")))!.AsObject());

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[2].Id;
        return state;
    }

    private static JsonObject DumpOffer(SponsorOffer o) => new()
    {
        ["id"] = o.Id, ["name"] = o.Name, ["tier"] = o.Tier, ["perSeason"] = o.PerSeason,
        ["years"] = o.Years, ["signedYear"] = o.SignedYear, ["expires"] = o.Expires,
    };

    private static JsonObject DumpSponsor(Sponsor s) => new()
    {
        ["id"] = s.Id, ["name"] = s.Name, ["tier"] = s.Tier, ["perSeason"] = s.PerSeason,
        ["years"] = s.Years, ["signedYear"] = s.SignedYear, ["bonus"] = s.Bonus,
    };

    private static JsonObject DumpGig(GigOffer g) => new()
    {
        ["id"] = g.Id, ["playerId"] = g.PlayerId, ["brand"] = g.Brand, ["pay"] = g.Pay, ["day"] = g.Day,
    };

    [Fact]
    public void FullFlow_BitExact()
    {
        var state = BuildWorld();
        var myTeam = state.Teams[state.MyTeamId!];
        var rng = new Rng(4242);
        var trace = Golden.Value["trace"]!.AsArray();

        // 第 1-3 周：商务刷新（gigOffers/sponsorOffers 快照逐位）
        for (int w = 0; w < 3; w++)
        {
            state.Day = 100 + w * 7;
            Business.RefreshCommercialWeek(state, rng);
            var t = trace[w]!; // 录制顺序：3 个 refresh 连续在前
            Assert.Equal($"refresh-w{w}", t["tag"]!.GetValue<string>());
            AssertDeepEqual(t["gigOffers"]!, new JsonArray(state.GigOffers.Select(g => (JsonNode)DumpGig(g)).ToArray()), $"w{w}.gigs");
            AssertDeepEqual(t["sponsorOffers"]!, new JsonArray(state.SponsorOffers.Select(o => (JsonNode)DumpOffer(o)).ToArray()), $"w{w}.offers");
        }

        // 签约：对快照逐意向签（ok/text 逐位）
        var signEntries = trace.Where(t => t!["tag"]!.GetValue<string>().StartsWith("sign-")).ToList();
        foreach (var signNode in signEntries)
        {
            var offerId = signNode!["tag"]!.GetValue<string>()["sign-".Length..];
            var offer = state.SponsorOffers.FirstOrDefault(o => o.Id == offerId);
            Assert.NotNull(offer);
            var (ok, text) = Business.SignSponsorOffer(state, offer!, rng);
            Assert.Equal(signNode["ok"]!.GetValue<bool>(), ok);
            Assert.Equal(signNode["text"]!.GetValue<string>(), text);
        }

        // 解约
        var cancelNode = trace.FirstOrDefault(t => t!["tag"]!.GetValue<string>() == "cancel-sponsor");
        if (cancelNode != null && myTeam.Sponsors.Count > 0)
        {
            Assert.Equal(cancelNode["text"]!.GetValue<string>(), Business.CancelSponsorById(state, myTeam.Sponsors[0].Id));
        }

        // 周收入 × 3（业绩条款倍率 undefined/1.2/1.5）
        var incomes = Golden.Value["incomes"]!.AsArray();
        var mults = new double?[] { null, 1.2, 1.5 };
        for (int i = 0; i < incomes.Count; i++)
        {
            state.SponsorMult = mults[i];
            Assert.Equal(incomes[i]!["income"]!.GetValue<int>(), Business.WeeklySponsorIncome(state));
        }
        state.SponsorMult = null;

        // 直播合同：签 → 周收入（钱包/人气）→ 取消
        var streamNode = Golden.Value["stream"]!;
        string streamPid = myTeam.Roster[0];
        var sr = Business.SignStream(state, streamPid, 3, rng);
        Assert.Equal(streamNode["text"]!.GetValue<string>(), sr.Text);
        state.Day = 130;
        Assert.Equal(streamNode["incomeWithStream"]!.GetValue<int>(), Business.WeeklySponsorIncome(state));
        Assert.Equal(streamNode["walletAfter"]!.GetValue<int>(), state.Players[streamPid].Wallet);
        Assert.Equal(streamNode["popAfter"]!.GetValue<int>(), state.Players[streamPid].Popularity);
        Assert.Equal(streamNode["cancelText"]!.GetValue<string>(), Business.CancelStream(state, streamPid));

        // 邀约接受/婉拒
        var gigOk = Golden.Value["gigOk"];
        if (gigOk is JsonObject go && state.GigOffers.Count > 0)
        {
            var g = state.GigOffers[0];
            Assert.Equal(go["id"]!.GetValue<string>(), g.Id);
            var (ok, text) = Business.AcceptGig(state, g.Id);
            Assert.Equal(go["ok"]!.GetValue<bool>(), ok);
            Assert.Equal(go["text"]!.GetValue<string>(), text);
            AssertDeepEqual(go["finLog"]!, new JsonArray(state.Finances.Log.Select(e => (JsonNode)new JsonObject
            {
                ["day"] = e.Day, ["label"] = e.Label, ["amount"] = e.Amount,
            }).ToArray()), "gigOk.finLog");
        }
        var gigDecline = Golden.Value["gigDecline"];
        if (gigDecline is JsonObject gd && state.GigOffers.Count > 0)
        {
            var id = gd["declined"]!.GetValue<string>();
            Business.DeclineGig(state, id);
            Assert.Equal(gd["remaining"]!.GetValue<int>(), state.GigOffers.Count);
        }

        // 终态赞助栏
        AssertDeepEqual(Golden.Value["finalSponsors"]!, new JsonArray(myTeam.Sponsors.Select(s => (JsonNode)DumpSponsor(s)).ToArray()), "finalSponsors");
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
