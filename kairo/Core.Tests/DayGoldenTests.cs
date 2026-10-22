using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>day 黄金轨迹回放：initSeasonFixtures + advanceDay 全年 372 天逐日摘要逐位 + 交互式比赛管线 + 年末全量状态。</summary>
public sealed class DayGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "day.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static JsonNode? HexOrNull(double? v) => v == null ? null : Hex(v.Value);

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq(); // fixture id 是比赛种子的一部分：测试间必须重置模块级序列
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 0; // AdvanceDay 先自增：首日为 1
        DaySim.InitSeasonFixtures(state);
        return state;
    }

    // ── 摘要构造（与 golden-transfer 同风格：所有 double 以 16-hex 字符串承载）──

    private static JsonArray StrArr(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode)x).ToArray());

    private static JsonObject MatchDigest(MatchRecord rec, string id, bool mine) => new()
    {
        ["id"] = id,
        ["mine"] = mine,
        ["winner"] = rec.Winner,
        ["score"] = new JsonArray(rec.ScoreA, rec.ScoreB),
        ["maps"] = new JsonArray(rec.Maps.Select(m => (JsonNode)new JsonObject
        {
            ["map"] = m.Map,
            ["score"] = new JsonArray(m.ScoreA, m.ScoreB),
        }).ToArray()),
    };

    private static JsonObject PlayerDigest(Player p) => new()
    {
        ["id"] = p.Id,
        ["age"] = p.Age,
        ["overall"] = p.Overall,
        ["potential"] = p.Potential,
        ["peak"] = p.PeakOverall,
        ["attrs"] = new JsonObject
        {
            ["aim"] = Hex(p.Attrs.Aim), ["reaction"] = Hex(p.Attrs.Reaction), ["awareness"] = Hex(p.Attrs.Awareness), ["utility"] = Hex(p.Attrs.Utility),
            ["clutch"] = Hex(p.Attrs.Clutch), ["teamwork"] = Hex(p.Attrs.Teamwork), ["communication"] = Hex(p.Attrs.Communication), ["igl"] = Hex(p.Attrs.Igl),
        },
        ["xp"] = new JsonObject(p.Xp.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, Hex(kv.Value)))),
        ["form"] = Hex(p.Form),
        ["morale"] = Hex(p.Morale),
        ["fatigue"] = Hex(p.Fatigue),
        ["salary"] = p.Salary,
        ["contractYears"] = p.ContractYears,
        ["benchedWeeks"] = p.BenchedWeeks,
        ["listed"] = p.Listed,
        ["listedWeeks"] = p.ListedWeeks,
        ["track"] = p.Track,
        ["teamId"] = p.TeamId,
        ["wallet"] = p.Wallet,
        ["popularity"] = p.Popularity,
        ["agentPool"] = StrArr(p.AgentPool),
        ["agentPro"] = new JsonObject(p.AgentPro.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, Hex(kv.Value)))),
        ["commercialDays"] = p.CommercialDays,
        ["career"] = new JsonObject
        {
            ["titles"] = p.Career.Titles,
            ["clubs"] = StrArr(p.Career.Clubs),
        },
    };

    private static JsonObject DayDigest(GameState state, AdvanceResult res, List<JsonObject> matches, int step) => new()
    {
        ["step"] = step,
        ["day"] = res.Day,
        ["stage"] = state.Stage,
        ["notes"] = StrArr(res.Notes),
        ["playedMine"] = StrArr(res.PlayedMine),
        ["seasonEnded"] = res.SeasonEnded,
        ["matches"] = new JsonArray(matches.Select(m => (JsonNode)m).ToArray()),
        ["ap"] = state.ActionPoints,
        ["bc"] = state.BoardConfidence,
        ["budget"] = state.Teams[state.MyTeamId!].Budget,
        ["newsLen"] = state.News.Count,
        ["feedLen"] = state.TransferFeed.Count,
        ["peCount"] = state.PendingEvents.Count,
        ["inqLen"] = state.Inquiries.Count,
        ["bidLen"] = state.IncomingBids.Count,
        ["sponsorMult"] = HexOrNull(state.SponsorMult),
    };

    private static JsonObject EndDigest(GameState state, List<JsonObject> heldTrace)
    {
        var myTeam = state.Teams[state.MyTeamId!];
        var obj = new JsonObject
        {
            ["year"] = state.Year,
            ["day"] = state.Day,
            ["stage"] = state.Stage,
            ["compKeys"] = StrArr(state.Comps.Keys),
            ["fixturesCount"] = state.Fixtures.Count,
            ["fixturesPlayed"] = state.Fixtures.Count(f => f.Played),
            ["circuitPoints"] = new JsonObject(state.CircuitPoints.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, Hex(kv.Value)))),
            ["boardConfidence"] = state.BoardConfidence,
            ["objective"] = state.Objective == null ? null : new JsonObject
            {
                ["stage"] = state.Objective.Stage,
                ["placeAtLeast"] = state.Objective.PlaceAtLeast,
                ["text"] = state.Objective.Text,
            },
            ["managerLife"] = new JsonObject
            {
                ["wallet"] = state.Manager.Life.Wallet,
                ["hunger"] = state.Manager.Life.Hunger,
                ["mood"] = state.Manager.Life.Mood,
            },
            ["managerCareer"] = state.Manager.Career == null ? null : new JsonObject
            {
                ["startYear"] = state.Manager.Career.StartYear,
                ["seasons"] = state.Manager.Career.Seasons,
                ["titles"] = state.Manager.Career.Titles,
                ["wins"] = state.Manager.Career.Wins,
                ["losses"] = state.Manager.Career.Losses,
                ["loseStreak"] = state.Manager.Career.LoseStreak,
                ["warned"] = state.Manager.Career.Warned,
                ["origin"] = state.Manager.Career.Origin,
            },
            ["managerSkills"] = new JsonObject
            {
                ["training"] = state.Manager.Skills.Training, ["negotiation"] = state.Manager.Skills.Negotiation,
                ["tactics"] = state.Manager.Skills.Tactics, ["scouting"] = state.Manager.Skills.Scouting,
                ["medical"] = state.Manager.Skills.Medical, ["business"] = state.Manager.Skills.Business,
                ["locker"] = state.Manager.Skills.Locker, ["youth"] = state.Manager.Skills.Youth,
            },
            ["myTeamBudget"] = myTeam.Budget,
            ["mySponsors"] = new JsonArray(myTeam.Sponsors.Select(s => (JsonNode)new JsonObject
            {
                ["id"] = s.Id, ["name"] = s.Name, ["tier"] = s.Tier, ["perSeason"] = s.PerSeason, ["years"] = s.Years,
            }).ToArray()),
            ["myMapPref"] = new JsonObject(myTeam.MapPref.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, Hex(kv.Value)))),
            ["myStarters"] = StrArr(myTeam.Starters),
            ["myAcademy"] = StrArr(myTeam.Academy),
            ["myPatternUsage"] = new JsonObject(myTeam.PatternUsage.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
            ["lastPattern"] = new JsonObject(myTeam.LastPattern.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
            ["myRoster"] = new JsonArray(myTeam.Roster.Select(id => (JsonNode)PlayerDigest(state.Players[id])).ToArray()),
            ["teamBudgets"] = new JsonArray(state.Teams.Values.Take(6).Select(t => (JsonNode)new JsonObject
            {
                ["id"] = t.Id, ["budget"] = t.Budget,
            }).ToArray()),
            ["regionMeta"] = new JsonObject(state.RegionMeta.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, new JsonObject
            {
                ["style"] = kv.Value.Style, ["aggr"] = Hex(kv.Value.Aggr),
            }))),
            ["transferFeed"] = new JsonArray(state.TransferFeed.Select(f => (JsonNode)new JsonObject
            {
                ["day"] = f.Day, ["kind"] = f.Kind, ["c"] = f.C, ["toTeamId"] = f.ToTeamId, ["playerId"] = f.PlayerId, ["text"] = f.Text,
            }).ToArray()),
            ["newsImportant"] = new JsonArray(state.News.Where(n => (n.Important ?? false)).Take(60).Select(n => (JsonNode)new JsonObject
            {
                ["day"] = n.Day, ["kind"] = n.Kind, ["text"] = n.Text,
            }).ToArray()),
            ["lastDraft"] = state.LastDraft == null ? null : new JsonObject
            {
                ["year"] = state.LastDraft.Year,
                ["picks"] = new JsonArray(state.LastDraft.Picks.Select(p => (JsonNode)new JsonObject
                {
                    ["pickNo"] = p.PickNo, ["teamId"] = p.TeamId, ["playerId"] = p.PlayerId,
                }).ToArray()),
            },
            ["retireLog"] = new JsonArray(state.RetireLog.Select(r => (JsonNode)new JsonObject
            {
                ["year"] = r.Year, ["ign"] = r.Ign, ["name"] = r.Name, ["age"] = r.Age, ["titles"] = r.Titles, ["mvps"] = r.Mvps,
            }).ToArray()),
            ["pendingEvents"] = new JsonArray(state.PendingEvents.Select(e => (JsonNode)new JsonObject
            {
                ["uid"] = e.Uid, ["cardId"] = e.CardId, ["title"] = e.Title,
            }).ToArray()),
            ["inquiries"] = new JsonArray(state.Inquiries.Select(q => (JsonNode)new JsonObject
            {
                ["id"] = q.Id, ["playerId"] = q.PlayerId, ["done"] = q.Done, ["askingFee"] = q.AskingFee, ["intent"] = q.Intent,
            }).ToArray()),
            ["incomingBids"] = new JsonArray(state.IncomingBids.Select(b => (JsonNode)new JsonObject
            {
                ["id"] = b.Id, ["playerId"] = b.PlayerId, ["fee"] = b.Fee, ["day"] = b.Day,
            }).ToArray()),
            ["sponsorOffers"] = new JsonArray(state.SponsorOffers.Select(o => (JsonNode)new JsonObject
            {
                ["id"] = o.Id, ["name"] = o.Name, ["perSeason"] = o.PerSeason, ["expires"] = o.Expires,
            }).ToArray()),
            ["gigOffers"] = new JsonArray(state.GigOffers.Select(g => (JsonNode)new JsonObject
            {
                ["id"] = g.Id, ["playerId"] = g.PlayerId, ["brand"] = g.Brand, ["pay"] = g.Pay, ["day"] = g.Day,
            }).ToArray()),
            ["financesTail"] = new JsonArray(state.Finances.Log.TakeLast(8).Select(e => (JsonNode)new JsonObject
            {
                ["day"] = e.Day, ["label"] = e.Label, ["amount"] = e.Amount,
            }).ToArray()),
            ["scouting"] = new JsonObject(state.Scouting.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, new JsonObject
            {
                ["points"] = Hex(kv.Value.Points), ["last"] = kv.Value.Last,
            }))),
            ["patchNotes"] = new JsonArray(state.PatchNotes.Select(p => (JsonNode)new JsonObject
            {
                ["version"] = p.Version,
                ["changes"] = new JsonArray(p.Changes.Select(c => (JsonNode)new JsonObject
                {
                    ["agentId"] = c.AgentId, ["dir"] = c.Dir, ["pct"] = c.Pct, ["meta"] = Hex(c.Meta),
                }).ToArray()),
            }).ToArray()),
            ["heldTrace"] = new JsonArray(heldTrace.Select(h => (JsonNode)h).ToArray()),
        };
        return obj;
    }

    /// <summary>复放 maxSteps 天并与 golden 逐日深比；终局 state 传出供年末摘要。</summary>
    private static GameState ReplayAndCompare(JsonObject goldenDays, int maxSteps, List<JsonObject> heldTrace)
    {
        var state = BuildWorld();
        bool heldDone = false;
        var days = goldenDays["days"]!.AsArray();
        for (int step = 0; step < maxSteps; step++)
        {
            var expected = days[step]!.AsObject();
            var matches = new List<JsonObject>();
            var res = DaySim.AdvanceDay(
                state,
                new List<NewsItem>(),
                (rec, id, mine) => matches.Add(MatchDigest(rec, id, mine)),
                (_f, _a, _b, _bo, _l) =>
                {
                    if (heldDone) return false;
                    heldDone = true;
                    return true; // 拦截我的第一场：走交互式管线
                });
            // 交互式管线：PlayHeldMatch（首发确认）→ InterveneHeldMatch（第 1 图第 5 回合战术喊话）→ SettleMatch
            foreach (var fid in res.PlayedMine)
            {
                var f = state.Fixtures.FirstOrDefault(x => x.Id == fid);
                if (f == null || f.Played) continue; // 已补打/已结算的跳过
                var myTeam = state.Teams[state.MyTeamId!];
                var starters = myTeam.Roster.Take(5).ToList();
                var rec1 = DaySim.PlayHeldMatch(state, fid, new DaySim.HeldMatchOptions { Starters = starters });
                var rec2 = DaySim.InterveneHeldMatch(state, fid, new MatchIntervention { Map = 0, Round = 5, Tactic = "atk:rush" });
                var settleNotes = new List<string>();
                DaySim.SettleMatch(state, fid, rec2, ns => settleNotes.AddRange(ns.Select(n => n.Text)));
                heldTrace.Add(new JsonObject
                {
                    ["fixtureId"] = fid,
                    ["rec1"] = rec1 == null ? null : new JsonObject
                    {
                        ["winner"] = rec1.Winner,
                        ["score"] = new JsonArray(rec1.ScoreA, rec1.ScoreB),
                        ["maps"] = new JsonArray(rec1.Maps.Select(m => (JsonNode)new JsonObject
                        {
                            ["map"] = m.Map, ["score"] = new JsonArray(m.ScoreA, m.ScoreB),
                        }).ToArray()),
                    },
                    ["rec2"] = rec2 == null ? null : new JsonObject
                    {
                        ["winner"] = rec2.Winner,
                        ["score"] = new JsonArray(rec2.ScoreA, rec2.ScoreB),
                        ["maps"] = new JsonArray(rec2.Maps.Select(m => (JsonNode)new JsonObject
                        {
                            ["map"] = m.Map, ["score"] = new JsonArray(m.ScoreA, m.ScoreB),
                        }).ToArray()),
                    },
                    ["settleNotes"] = StrArr(settleNotes),
                });
            }
            AssertDeepEqual(expected, DayDigest(state, res, matches, step), $"day[{step}]");
        }
        return state;
    }

    [Fact]
    public void AdvanceDays_First60_BitExact()
    {
        ReplayAndCompare(Golden.Value, 60, new List<JsonObject>());
    }

    [Fact]
    public void AdvanceDays_FullYear_BitExact()
    {
        var golden = Golden.Value;
        var heldTrace = new List<JsonObject>();
        int total = golden["days"]!.AsArray().Count;
        var endState = ReplayAndCompare(golden, total, heldTrace);
        AssertDeepEqual(golden["end"], EndDigest(endState, heldTrace), "end");
    }

    [Fact]
    public void HeldPipeline_SingleDay_BitExact()
    {
        // 独立快速闸门：只复放到首场我的比赛（杯赛第 2 天）并校验 heldTrace
        var golden = Golden.Value;
        var state = BuildWorld();
        bool heldDone = false;
        string? heldFixture = null;
        for (int step = 0; step < 60 && heldFixture == null; step++)
        {
            var res = DaySim.AdvanceDay(state, new List<NewsItem>(), null, (_f, _a, _b, _bo, _l) =>
            {
                if (heldDone) return false;
                heldDone = true;
                return true;
            });
            foreach (var fid in res.PlayedMine)
            {
                var f = state.Fixtures.FirstOrDefault(x => x.Id == fid);
                if (f == null || f.Played) continue;
                heldFixture = fid;
                var myTeam = state.Teams[state.MyTeamId!];
                var rec1 = DaySim.PlayHeldMatch(state, fid, new DaySim.HeldMatchOptions { Starters = myTeam.Roster.Take(5).ToList() });
                var rec2 = DaySim.InterveneHeldMatch(state, fid, new MatchIntervention { Map = 0, Round = 5, Tactic = "atk:rush" });
                var settleNotes = new List<string>();
                DaySim.SettleMatch(state, fid, rec2, ns => settleNotes.AddRange(ns.Select(n => n.Text)));
                var expected = golden["end"]!["heldTrace"]!.AsArray()[0]!.AsObject();
                var actual = new JsonObject
                {
                    ["fixtureId"] = fid,
                    ["rec1"] = rec1 == null ? null : new JsonObject
                    {
                        ["winner"] = rec1.Winner,
                        ["score"] = new JsonArray(rec1.ScoreA, rec1.ScoreB),
                        ["maps"] = new JsonArray(rec1.Maps.Select(m => (JsonNode)new JsonObject
                        {
                            ["map"] = m.Map, ["score"] = new JsonArray(m.ScoreA, m.ScoreB),
                        }).ToArray()),
                    },
                    ["rec2"] = rec2 == null ? null : new JsonObject
                    {
                        ["winner"] = rec2.Winner,
                        ["score"] = new JsonArray(rec2.ScoreA, rec2.ScoreB),
                        ["maps"] = new JsonArray(rec2.Maps.Select(m => (JsonNode)new JsonObject
                        {
                            ["map"] = m.Map, ["score"] = new JsonArray(m.ScoreA, m.ScoreB),
                        }).ToArray()),
                    },
                    ["settleNotes"] = StrArr(settleNotes),
                };
                AssertDeepEqual(expected, actual, "heldTrace[0]");
            }
        }
        Assert.NotNull(heldFixture);
    }

    private static void AssertDeepEqual(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null || actual == null)
        {
            Assert.True(expected == null && actual == null,
                $"{path}: one side null (expected={expected?.ToJsonString()}, actual={actual?.ToJsonString()})");
            return;
        }
        if (expected is JsonValue ev && actual is JsonValue av)
        {
            if (ev.ToJsonString() == av.ToJsonString()) return;
            // TS 数字 ↔ CS 16-hex 字符串：按 IEEE754 位型比较
            if (ev.TryGetValue<double>(out var de) && av.TryGetValue<string>(out var hex)
                && BitConverter.DoubleToInt64Bits(de).ToString("x16") == hex) return;
            Assert.Fail($"{path}: {ev.ToJsonString()} vs {av.ToJsonString()}");
            return;
        }
        if (expected is JsonArray earr && actual is JsonArray aarr)
        {
            Assert.True(earr.Count == aarr.Count,
                $"{path}: array count {earr.Count} vs {aarr.Count}\nexpected={earr.ToJsonString()}\nactual  ={aarr.ToJsonString()}");
            for (int i = 0; i < earr.Count; i++)
                AssertDeepEqual(earr[i], aarr[i], $"{path}[{i}]");
            return;
        }
        if (expected is JsonObject eobj && actual is JsonObject aobj)
        {
            var ek = eobj.Select(kv => kv.Key).ToArray();
            var ak = aobj.Select(kv => kv.Key).ToArray();
            Assert.True(ek.SequenceEqual(ak), $"{path}: keys differ (expected=[{string.Join(",", ek)}] actual=[{string.Join(",", ak)}])");
            foreach (var kv in ek)
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }
}
