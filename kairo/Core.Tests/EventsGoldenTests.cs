using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>events + finance 黄金轨迹回放：多日抽取/结算/生日/Deadline/保底/抑制器 + 财务窗口逐位。</summary>
public sealed class EventsGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "events.golden.json")))!.AsObject());

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[2].Id;
        return state;
    }

    [Fact]
    public void RegularAndDeadline_BitExact()
    {
        var caseRegular = Golden.Value["cases"]!.AsArray().First(c => c!["name"]!.GetValue<string>() == "regular")!;
        var state = BuildWorld();
        var rng = new Rng(555);
        var actualTrace = new List<JsonObject>();
        for (int d = 0; d < 12; d++)
        {
            state.Day = 5 + d * 2;
            Events.SpawnDailyEvents(state, rng);
            Events.SpawnBirthdays(state);
            while (state.PendingEvents.Count > 0)
            {
                var card = state.PendingEvents[0];
                var r = Events.ResolveEvent(state, card.Uid, 0, rng);
                actualTrace.Add(new JsonObject
                {
                    ["day"] = state.Day,
                    ["resolved"] = card.Uid,
                    ["result"] = r?.Result,
                });
            }
            actualTrace.Add(new JsonObject
            {
                ["day"] = state.Day,
                ["queue"] = state.PendingEvents.Count,
                ["budget"] = state.Teams[state.MyTeamId!].Budget,
                ["lastEventDay"] = state.LastEventDay,
            });
        }
        AssertDeepEqual(caseRegular["trace"]!, new JsonArray(actualTrace.Select(t => (JsonNode)t).ToArray()), "regular.trace");
    }

    [Fact]
    public void DeadlineStarveSuppress_BitExact()
    {
        var caseD = Golden.Value["cases"]!.AsArray().First(c => c!["name"]!.GetValue<string>() == "deadline-starve-suppress")!;
        var state = BuildWorld();
        var rng = new Rng(777);
        var trace = new List<JsonNode>();
        state.Day = 10;
        Events.SpawnDailyEvents(state, rng);
        trace.Add(new JsonObject { ["tag"] = "starved-day10", ["queue"] = state.PendingEvents.Count, ["lastEventDay"] = state.LastEventDay });
        state.Day = 19;
        Events.SpawnDailyEvents(state, rng);
        trace.Add(new JsonObject { ["tag"] = "starved-day19", ["queue"] = state.PendingEvents.Count });
        state.Day = 150;
        state.PendingEvents.Clear();
        foreach (var d in new[] { 150, 151, 152 })
        {
            state.Day = d;
            Events.SpawnDailyEvents(state, rng);
            trace.Add(new JsonObject { ["tag"] = $"deadline-{d}", ["uids"] = new JsonArray(state.PendingEvents.Select(c => JsonValue.Create(c.Uid)).ToArray()) });
        }
        while (state.PendingEvents.Count > 0)
        {
            var card = state.PendingEvents[0];
            if (card.Negative) state.Day += 1;
            Events.ResolveEvent(state, card.Uid, 0, rng);
        }
        AssertDeepEqual(caseD["trace"]!, new JsonArray(trace.ToArray()), "deadline.trace");
        Assert.Equal(0, state.PendingEvents.Count);
    }

    [Fact]
    public void FinanceWindow_BitExact()
    {
        var state = BuildWorld();
        var team = state.Teams[state.MyTeamId!];
        team.Budget = 5_000_000;
        state.Day = 100;
        var labels = new[]
        {
            ("事件 · 品牌广告拍摄", 8000), ("商务 · 赞助结算", 120000), ("转会 · 签字费", -450000),
            ("事件 · 设备故障", -1500), ("解约 · 补偿", -80000), ("选秀权 · 交易", 60000),
            ("事件 · 生日礼物", -2500), ("商务 · 直播分成", 30000), ("other · 杂项", -5000),
        };
        for (int i = 0; i < labels.Length; i++)
        {
            state.Day = 70 + i * 3;
            Finance.LogFinance(state, labels[i].Item1, labels[i].Item2);
        }
        state.Day = 100;
        var win = Finance.GetFinanceWindow(state, 30);
        var e = Golden.Value["cases"]!.AsArray().First(c => c!["name"]!.GetValue<string>() == "finance")!;

        Assert.Equal(e["w30"]!["start"]!.GetValue<int>(), win.Start);
        Assert.Equal(e["w30"]!["end"]!.GetValue<int>(), win.End);
        AssertDeepEqual(e["w30"]!["entries"], new JsonArray(win.Entries.Select(x => (JsonNode)new JsonObject
        {
            ["day"] = x.Day, ["label"] = x.Label, ["amount"] = x.Amount, ["cat"] = x.Cat,
        }).ToArray()), "fin.entries");
        AssertDeepEqual(e["w30"]!["steps"], new JsonArray(win.Steps.Select(s => (JsonNode)new JsonObject
        {
            ["day"] = s.Day, ["balance"] = s.Balance, ["label"] = s.Label, ["amount"] = s.Amount,
        }).ToArray()), "fin.steps");
        AssertDeepEqual(e["breakdown"], new JsonArray(Finance.FinanceBreakdown(win.Entries).Select(b => (JsonNode)new JsonObject
        {
            ["cat"] = b.Cat, ["income"] = b.Income, ["expense"] = b.Expense,
        }).ToArray()), "fin.breakdown");
        var forecast = Finance.CashFlowForecast(state, 7);
        Assert.NotNull(forecast);
        Assert.Equal(e["forecast"]!["perDay"]!.GetValue<string>(), Hex(forecast!.Value.PerDay));
        Assert.Equal(e["forecast"]!["week"]!.GetValue<int>(), forecast.Value.Week);
    }

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

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
            Assert.True(ek.SequenceEqual(ak), $"{path}: keys differ ({string.Join(",", ek)} vs {string.Join(",", ak)})");
            foreach (var (kv, i) in ek.WithIndex())
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }
}
