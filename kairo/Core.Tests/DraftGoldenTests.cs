using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>draft 黄金轨迹回放：选秀日全流程（多签多卡/AI 选人/满员弃权/落选入池）+ 卡结算 + 签位交易 逐位。</summary>
public sealed class DraftGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "draft.golden.json")))!.AsObject());

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        return state;
    }

    private static JsonObject DumpCard(PendingEventCard c) => new()
    {
        ["uid"] = c.Uid,
        ["cardId"] = c.CardId,
        ["title"] = c.Title,
        ["negative"] = c.Negative,
        ["day"] = c.Day,
        ["options"] = new JsonArray(c.Options.Select(o => (JsonNode)new JsonObject
        {
            ["label"] = o.Label,
            ["result"] = o.Result,
        }).ToArray()),
        ["payload"] = new JsonObject
        {
            ["pickNo"] = (int)(c.Payload?["pickNo"] as int? ?? 0),
            ["playerIds"] = c.Payload?["playerIds"] is List<string> ls
                ? new JsonArray(ls.Select(x => JsonValue.Create(x)).ToArray())
                : null,
        },
    };

    [Fact]
    public void RunDraft_BitExact()
    {
        var state = BuildWorld();
        var notes = new List<NewsItem>();
        Draft.RunDraft(state, notes);
        var c = Golden.Value["cases"]!["runDraft"]!;
        var bad = new List<string>();
        var notesExp = string.Join("|", c["notes"]!.AsArray().Select(n => (n!["text"]!.GetValue<string>(), n["important"]?.GetValue<bool>() ?? false)));
        var notesAct = string.Join("|", notes.Select(n => (n.Text, (bool)(n.Important ?? false))));
        if (notesExp != notesAct) bad.Add($"notes: {notesExp} vs {notesAct}");
        var picksExp = string.Join("|", c["picks"]!.AsArray().Select(p => $"{p!["pickNo"]!.GetValue<int>()}:{p["teamId"]!.GetValue<string>()}:{p["playerId"]!.GetValue<string>()}"));
        var picksAct = string.Join("|", state.LastDraft!.Picks.Select(p => $"{p.PickNo}:{p.TeamId}:{p.PlayerId}"));
        if (picksExp != picksAct) bad.Add($"picks: {picksExp} vs {picksAct}");
        var cardsExp = string.Join("||", c["myCards"]!.AsArray().Select(x => x!.ToJsonString()));
        var cardsAct = string.Join("||", state.PendingEvents.Select(DumpCard).Select(x => x.ToJsonString()));
        if (cardsExp != cardsAct) bad.Add($"myCards: {cardsExp} vs {cardsAct}");
        var rookiesExp = string.Join("|", c["rookies"]!.AsArray().Select(r => (
            r!["pid"]!.GetValue<string>(), r["overall"]!.GetValue<int>(), r["potential"]!.GetValue<int>(),
            r["age"]!.GetValue<int>(), r["salary"]!.GetValue<int>(), r["teamId"]?.GetValue<string>() ?? "")));
        var rookiesAct = string.Join("|", c["rookies"]!.AsArray().Select(r => r!["pid"]!.GetValue<string>())
            .Select(pid => { var p = state.Players[pid]; return (p.Id, p.Overall, p.Potential, p.Age, p.Salary, p.TeamId ?? ""); }));
        if (rookiesExp != rookiesAct) bad.Add($"rookies: {rookiesExp} vs {rookiesAct}");
        Assert.True(bad.Count == 0, string.Join(";\n", bad));
    }

    [Fact]
    public void ResolveCard_BitExact()
    {
        var state = BuildWorld();
        var notes = new List<NewsItem>();
        Draft.RunDraft(state, notes);
        var card = state.PendingEvents[0];
        var r = Draft.ResolveDraftCard(state, card, 2);
        var c = Golden.Value["cases"]!["resolveCard"]!;
        Assert.Equal(c["r"]!["result"]!.GetValue<string>(), r.Result);
        Assert.Equal(c["r"]!["note"]!.GetValue<string>(), r.Note);
        var row = state.LastDraft!.Picks.First(x => x.TeamId == state.MyTeamId && x.PlayerId.Length > 0);
        Assert.Equal(c["rowFilled"]!["pickNo"]!.GetValue<int>(), row.PickNo);
        Assert.Equal(c["rowFilled"]!["playerId"]!.GetValue<string>(), row.PlayerId);
    }

    [Fact]
    public void ResolveDecline_BitExact()
    {
        var state = BuildWorld();
        var notes = new List<NewsItem>();
        Draft.RunDraft(state, notes);
        var card = state.PendingEvents[0];
        var frozen = ((List<string>)card.Payload!["playerIds"]!).ToList();
        var r = Draft.ResolveDraftCard(state, card, 7);
        var c = Golden.Value["cases"]!["resolveDecline"]!;
        Assert.Equal(c["r"]!["result"]!.GetValue<string>(), r.Result);
        Assert.Equal(c["r"]!["note"]!.GetValue<string>(), r.Note);
        Assert.True(frozen.All(pid => state.Players[pid].TeamId == null), "冻结名单应回归自由市场");
    }

    [Fact]
    public void Trade_BitExact()
    {
        var state = BuildWorld();
        state.Day = 150;
        var my = state.Teams[state.MyTeamId!];
        my.Budget = 2_000_000;
        var notes = new List<NewsItem>();
        var info0 = Draft.DraftPickInfo(state);
        string sell1 = Draft.DraftPickTrade(state, "sell", notes);
        string sell2 = Draft.DraftPickTrade(state, "sell", notes);
        var info1 = Draft.DraftPickInfo(state);
        string buy1 = Draft.DraftPickTrade(state, "buy", notes);
        var slots = Draft.ResolveDraftSlots(state);

        var c = Golden.Value["cases"]!["trade"]!;
        var bad = new List<string>();
        static JsonNode? StrNode(string? s) => s == null ? null : JsonValue.Create(s);
        static JsonNode? IntNode(int? v) => v == null ? null : JsonValue.Create(v.Value);
        static JsonNode? BoolNode(bool? v) => v == null ? null : JsonValue.Create(v.Value);
        void CheckS(string name, JsonNode? expNode, JsonNode? actNode)
        {
            var expected = expNode?.ToJsonString() ?? "null";
            var actual = actNode?.ToJsonString() ?? "null";
            if (expected != actual) bad.Add($"{name}: {expected} vs {actual}");
        }
        CheckS("value1", c["value1"], IntNode(Draft.DraftPickValue(1)));
        CheckS("value5", c["value5"], IntNode(Draft.DraftPickValue(5)));
        CheckS("info0.mySlots", c["info0"]!["mySlots"], IntNode(info0.MySlots));
        CheckS("info0.myProjected", c["info0"]!["myProjected"], IntNode(info0.MyProjected));
        CheckS("info0.sellPrice", c["info0"]!["sellPrice"], IntNode(info0.SellPrice));
        CheckS("info0.buyOffer.teamId", c["info0"]!["buyOffer"]?["teamId"], StrNode(info0.BuyOffer?.TeamId));
        CheckS("info0.buyOffer.slotNo", c["info0"]!["buyOffer"]?["slotNo"], IntNode(info0.BuyOffer?.SlotNo));
        CheckS("info0.buyOffer.price", c["info0"]!["buyOffer"]?["price"], IntNode(info0.BuyOffer?.Price));
        CheckS("info0.windowOpen", c["info0"]!["windowOpen"], BoolNode(info0.WindowOpen));
        CheckS("sell1", c["sell1"], StrNode(sell1));
        CheckS("sell2", c["sell2"], StrNode(sell2));
        CheckS("info1.mySlots", c["info1"]!["mySlots"], IntNode(info1.MySlots));
        CheckS("info1.sellPrice", c["info1"]!["sellPrice"], IntNode(info1.SellPrice));
        CheckS("buy1", c["buy1"], StrNode(buy1));
        var slotsExp = string.Join(",", c["slotsAfter"]!.AsArray().Select(x => x!.GetValue<string>()));
        var slotsAct = string.Join(",", slots);
        if (slotsExp != slotsAct) bad.Add($"slotsAfter: {slotsExp} vs {slotsAct}");
        var budgetsExp = string.Join(",", c["budgets"]!.AsArray().Select(x => x!.GetValue<int>()));
        var budgetsAct = string.Join(",", new[] { my.Budget, state.Teams[c["info0"]!["buyOffer"]!["teamId"]!.GetValue<string>()].Budget });
        if (budgetsExp != budgetsAct) bad.Add($"budgets: {budgetsExp} vs {budgetsAct}");
        var finExp = string.Join("|", c["finLog"]!.AsArray().Select(e => e!.ToJsonString()));
        var finAct = string.Join("|", state.Finances.Log.Select(e => new JsonObject { ["day"] = e.Day, ["label"] = e.Label, ["amount"] = e.Amount }.ToJsonString()));
        if (finExp != finAct) bad.Add($"finLog: {finExp} vs {finAct}");
        var notesExp = string.Join("|", c["notes"]!.AsArray().Select(n => n!["text"]!.GetValue<string>()));
        var notesAct = string.Join("|", notes.Select(n => n.Text));
        if (notesExp != notesAct) bad.Add($"notes: {notesExp} vs {notesAct}");
        Assert.True(bad.Count == 0, string.Join(";\n", bad));
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
