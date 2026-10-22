using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>M1 收尾五模块黄金回放：scrim/achievements/retirement/challenge/share 逐位。</summary>
public sealed class ExtraGoldenTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "extra.golden.json")))!.AsObject());

    private static string Hex(double v) => BitConverter.DoubleToInt64Bits(v).ToString("x16");

    private static GameState BuildWorld()
    {
        WorldgenTestsState.EnsureLoaded();
        Fixtures.ResetFixtureSeq();
        var state = Worldgen.GenerateWorld(42, resetSeq: true);
        state.MyTeamId = state.Teams.Values.ToList()[0].Id;
        state.Day = 130;
        Career.InitCareer(state, "analyst");
        return state;
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
            Assert.True(ek.SequenceEqual(ak), $"{path}: keys differ");
            foreach (var kv in ek)
                AssertDeepEqual(eobj[kv], aobj[kv], $"{path}.{kv}");
            return;
        }
        Assert.Fail($"{path}: {expected.ToJsonString()} vs {actual.ToJsonString()}");
    }

    [Fact]
    public void Scrim_Achievements_Retirement_Challenge_Share_BitExact()
    {
        var g = Golden.Value;
        var state = BuildWorld();
        var teams = state.Teams.Values.ToList();
        string myId = state.MyTeamId!;

        // ── ① scrim ──
        {
            var t1 = teams.Where(t => t.Tier == 1 && t.Id != myId).ToList();
            var ranked = t1.OrderByDescending(t => Scrim.TeamAvgOverall(state, t.Id)).ToList();
            string strong = ranked[0].Id;
            string weak = ranked[^1].Id;
            string rivalId = t1.FirstOrDefault(t => t.RegionId == state.Teams[myId].RegionId)?.Id ?? ranked[1].Id;
            var expectedScrim = g["scrim"]!;
            AssertDeepEqual(expectedScrim["avg"], new JsonArray(ranked.Take(4).Select(t => (JsonNode)new JsonObject
            {
                ["id"] = t.Id, ["avg"] = Hex(Scrim.TeamAvgOverall(state, t.Id)),
            }).ToArray()), "scrim.avg");
            AssertDeepEqual(expectedScrim["coefs"], new JsonArray(new[] { (70.0, 50.0), (50.0, 70.0), (80.0, 88.0), (55.0, 55.0) }
                .Select(p => (JsonNode)Hex(Scrim.ScrimSparringCoef(p.Item1, p.Item2))).ToArray()), "scrim.coefs");
            AssertDeepEqual(expectedScrim["accept"], new JsonArray(new[] { strong, weak, rivalId }
                .Select(id => (JsonNode)Hex(Scrim.ScrimAcceptChance(state, myId, id))).ToArray()), "scrim.accept");

            var notes = new List<NewsItem>();
            var reqs = new[]
            {
                new Scrim.ScrimRequest { OppId = weak, MapId = "ascent", Goal = "blend" },
                new Scrim.ScrimRequest { OppId = rivalId, MapId = "split", Goal = "style", GoalStyle = "balanced" },
                new Scrim.ScrimRequest { OppId = strong, MapId = "ascent", Goal = "mappool" },
            };
            var rng = new Rng(301);
            for (int i = 0; i < reqs.Length; i++)
            {
                var r = Scrim.RequestScrim(state, reqs[i], rng, notes);
                var reqDigest = new JsonObject
                {
                    ["oppId"] = reqs[i].OppId, ["mapId"] = reqs[i].MapId, ["goal"] = reqs[i].Goal,
                };
                if (reqs[i].GoalStyle != null) reqDigest["goalStyle"] = reqs[i].GoalStyle; // TS JSON.stringify 省略 undefined 键
                AssertDeepEqual(expectedScrim["requests"]![i], new JsonObject
                {
                    ["req"] = reqDigest,
                    ["accepted"] = r.Accepted, ["reason"] = r.Reason, ["won"] = r.Won,
                    ["score"] = new JsonArray(r.ScoreA, r.ScoreB), ["coef"] = Hex(r.Coef),
                }, $"scrim.requests[{i}]");            }
            AssertDeepEqual(expectedScrim["notes"], new JsonArray(notes.Select(n => (JsonNode)n.Text).ToArray()), "scrim.notes");
            AssertDeepEqual(expectedScrim["myBond"], Hex(state.Teams[myId].Bond), "scrim.myBond");
            AssertDeepEqual(expectedScrim["mapPrefAscent"], Hex(state.Teams[myId].MapPref.TryGetValue("ascent", out var a) ? a : 50), "scrim.mapPrefAscent");
            AssertDeepEqual(expectedScrim["mapPrefSplit"], Hex(state.Teams[myId].MapPref.TryGetValue("split", out var s) ? s : 50), "scrim.mapPrefSplit");
            AssertDeepEqual(expectedScrim["styleCounter"], new JsonObject(state.StyleCounter.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, Hex(kv.Value)))), "scrim.styleCounter");
            AssertDeepEqual(expectedScrim["scrimLog"], new JsonArray(state.ScrimLog.Select(e => (JsonNode)new JsonObject
            {
                ["day"] = e.Day, ["oppId"] = e.OppId, ["mapId"] = e.MapId, ["goal"] = e.Goal,
                ["score"] = new JsonArray(e.ScoreA, e.ScoreB), ["won"] = e.Won,
            }).ToArray()), "scrim.scrimLog");
            Assert.Equal(expectedScrim["ap"]!.GetValue<int>(), state.ActionPoints);
            AssertDeepEqual(expectedScrim["intelStrong"], Hex(state.Scouting.TryGetValue(strong, out var i1) ? i1.Points : 0), "scrim.intelStrong");
            AssertDeepEqual(expectedScrim["intelWeak"], Hex(state.Scouting.TryGetValue(weak, out var i2) ? i2.Points : 0), "scrim.intelWeak");
            state.Scouting[strong] = new ScoutEntry { Points = 5, Last = state.Day };
            Assert.Equal(expectedScrim["tacticsChanged"]!.GetValue<string>(), Transfer.NoteTacticsChanged(state, strong));
            AssertDeepEqual(expectedScrim["intelStrongAfter"], Hex(state.Scouting[strong].Points), "scrim.intelStrongAfter");
            Assert.True(expectedScrim["tacticsChangedAgain"] == null
                ? Transfer.NoteTacticsChanged(state, strong) == null
                : expectedScrim["tacticsChangedAgain"]!.GetValue<string>() == Transfer.NoteTacticsChanged(state, strong),
                "scrim.tacticsChangedAgain");
        }

        // ── ② achievements ──
        {
            var expectedAch = g["achievements"]!;
            var notes = new List<NewsItem>();
            var c = state.Manager.Career!;
            c.Wins = 65; c.Losses = 20; c.Titles = 2; c.Warned = true; c.Seasons = 5;
            c.TitleKinds = new OrderedDict<string, int>();
            c.TitleKinds["league"] = 1;
            c.TitleKinds["masters"] = 1;
            var my = state.Teams[myId];
            var young = state.Players.Values.FirstOrDefault(p => p.TeamId == my.Id && p.Overall >= 75);
            if (young != null) young.Homegrown = true;
            state.LastDraft = new LastDraftRecord
            {
                Year = state.Year,
                Picks = new List<DraftPickRow> { new() { PickNo = 1, TeamId = my.Id, PlayerId = young?.Id ?? "" } },
            };
            int n1 = Achievements.EvaluateAchievements(state, notes);
            AssertDeepEqual(expectedAch["round1"], new JsonObject
            {
                ["unlocked"] = new JsonArray(state.Achievements.Keys.Select(k => (JsonNode)k).ToArray()),
                ["notes"] = new JsonArray(notes.Select(x => (JsonNode)new JsonObject
                {
                    ["important"] = x.Important ?? false, ["text"] = x.Text,
                }).ToArray()),
            }, "achievements.round1");
            Assert.Equal(expectedAch["n1"]!.GetValue<int>(), n1);
            c.Titles = 5;
            notes.Clear();
            int n2 = Achievements.EvaluateAchievements(state, notes);
            AssertDeepEqual(expectedAch["round2"], new JsonObject
            {
                ["unlocked"] = new JsonArray(state.Achievements.Keys.Select(k => (JsonNode)k).ToArray()),
                ["notes"] = new JsonArray(notes.Select(x => (JsonNode)new JsonObject
                {
                    ["important"] = x.Important ?? false, ["text"] = x.Text,
                }).ToArray()),
                ["n2"] = n2,
            }, "achievements.round2");
            Assert.Equal(expectedAch["rep"]!.GetValue<int>(), state.Manager.Reputation);
            Assert.Equal(expectedAch["disciples"]!.GetValue<int>(), young?.Overall ?? 0);
        }

        // ── ③ retirement ──
        {
            var expectedR = g["retirement"]!;
            var pool = state.Players.Values.Take(16).ToList();
            AssertDeepEqual(expectedR["fame"], new JsonArray(pool.Select(p => (JsonNode)new JsonObject
            {
                ["id"] = p.Id, ["fame"] = Retirement.FameOf(p),
            }).ToArray()), "retirement.fame");
            AssertDeepEqual(expectedR["coachValue"], new JsonArray(pool.Take(8).Select(p => (JsonNode)new JsonObject
            {
                ["id"] = p.Id, ["v"] = Retirement.CoachValueOf(p),
            }).ToArray()), "retirement.coachValue");
            AssertDeepEqual(expectedR["retireProb"], new JsonArray(pool.Select(p => (JsonNode)new JsonObject
            {
                ["id"] = p.Id, ["age"] = p.Age, ["prob"] = Hex(Retirement.RetireProb(p)),
            }).ToArray()), "retirement.retireProb");

            var notes = new List<NewsItem>();
            Retirement.SeasonRetirements(state, new Rng(402), notes);
            AssertDeepEqual(expectedR["notes"], new JsonArray(notes.Select(n => (JsonNode)new JsonObject
            {
                ["text"] = n.Text,
            }).ToArray()), "retirement.notes");
            AssertDeepEqual(expectedR["pendingRetireCards"], new JsonArray(state.PendingEvents
                .Where(e => e.CardId == "retire")
                .Select(e => (JsonNode)new JsonObject
                {
                    ["uid"] = e.Uid, ["title"] = e.Title, ["text"] = e.Text, ["targetPlayerId"] = e.TargetPlayerId,
                    ["options"] = new JsonArray(e.Options.Select(o => (JsonNode)o.Label).ToArray()),
                }).ToArray()), "retirement.pendingRetireCards");
            AssertDeepEqual(expectedR["coachPool"], new JsonArray(state.CoachPool.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id, ["name"] = c.Name, ["fame"] = c.Fame, ["comm"] = Hex(c.Comm), ["titles"] = c.Titles,
                ["mvps"] = c.Mvps, ["isIgl"] = c.IsIgl, ["homegrownClubId"] = c.HomegrownClubId,
                ["retiredYear"] = c.RetiredYear, ["value"] = c.Value,
            }).ToArray()), "retirement.coachPool");
            AssertDeepEqual(expectedR["retireLog"], new JsonArray(state.RetireLog.Select(r => (JsonNode)new JsonObject
            {
                ["year"] = r.Year, ["ign"] = r.Ign, ["name"] = r.Name, ["age"] = r.Age, ["titles"] = r.Titles,
                ["mvps"] = r.Mvps, ["overall"] = r.Overall, ["path"] = r.Path, ["teamName"] = r.TeamName, ["coachId"] = r.CoachId,
            }).ToArray()), "retirement.retireLog");
            AssertDeepEqual(expectedR["feedRetire"], new JsonArray(state.TransferFeed.Where(f => f.Kind == "retire")
                .Select(f => (JsonNode)new JsonObject { ["day"] = f.Day, ["text"] = f.Text }).ToArray()), "retirement.feedRetire");

            var card = state.PendingEvents.FirstOrDefault(e => e.CardId == "retire");
            if (card != null)
            {
                var res = Retirement.ResolveRetireCard(state, card, 0, new Rng(403));
                AssertDeepEqual(expectedR["resolveOpt0"], new JsonObject { ["result"] = res.Result, ["note"] = res.Note }, "retirement.resolveOpt0");
            }
            var card2 = state.PendingEvents.FirstOrDefault(e => e.CardId == "retire" && e.Uid != card?.Uid);
            if (card2 != null)
            {
                var res = Retirement.ResolveRetireCard(state, card2, 2, new Rng(404));
                AssertDeepEqual(expectedR["resolveOpt2"], new JsonObject { ["result"] = res.Result, ["note"] = res.Note }, "retirement.resolveOpt2");
            }

            string? freeFirst = state.CoachPool.Count > 0 ? state.CoachPool[0].Id : null;
            Assert.Equal(expectedR["signErr"]!.GetValue<string>(), Retirement.SignCoach(state, "nonexistent", "training"));
            if (freeFirst != null)
            {
                var sign = Retirement.SignCoach(state, freeFirst, "training") ?? "ok";
                Assert.Equal(expectedR["sign"]!.GetValue<string>(), sign);
            }
            AssertDeepEqual(expectedR["staffTraining"], SlotJson(state.Teams[myId].Staff.Training), "retirement.staffTraining");
            Assert.Equal(expectedR["fire"]!.GetValue<string>(), Retirement.FireCoach(state, "training"));
            Assert.Equal(expectedR["repAfterFire"]!.GetValue<int>(), state.Manager.Reputation);
            AssertDeepEqual(expectedR["coachComp"], new JsonArray(new[] { 40, 55, 70, 95 }
                .Select(v => (JsonNode)Retirement.CoachCompensation(v)).ToArray()), "retirement.coachComp");

            var target = teams.FirstOrDefault(t => t.Id != myId && t.Staff.Training != null);
            if (target != null)
            {
                int offer = Retirement.CoachCompensation(target.Staff.Training!.Value) * 2;
                Assert.Equal(expectedR["poach"]!.GetValue<string>(), Retirement.PoachCoach(state, target.Id, "training", offer, new Rng(405)));
                AssertDeepEqual(expectedR["poachTargetBudget"], Hex(target.Budget), "retirement.poachTargetBudget");
            }
            else
            {
                Assert.Equal("no-target", expectedR["poach"]!.GetValue<string>());
            }
            AssertDeepEqual(expectedR["myBudget"], Hex(state.Teams[myId].Budget), "retirement.myBudget");

            // 强制劝留卡路径
            var oldGuy = state.Players.Values.FirstOrDefault(p => p.TeamId == myId && p.Age >= 29)
                ?? state.Players.Values.FirstOrDefault(p => p.TeamId == myId);
            Assert.NotNull(oldGuy);
            AssertDeepEqual(expectedR["forceCard"], new JsonObject
            {
                ["player"] = oldGuy!.Id, ["age"] = oldGuy.Age, ["salary"] = oldGuy.Salary,
            }, "retirement.forceCard");
            PendingEventCard MkCard(string uid) => new()
            {
                Uid = uid, CardId = "retire", Title = $"退役劝留 · {oldGuy.Ign}", Text = "x",
                Negative = false, TargetPlayerId = oldGuy.Id, Day = state.Day,
                Options =
                {
                    new PendingEventOption { Label = $"加薪 30% 留队（${(int)DetMath.JsRound(oldGuy.Salary * 0.3 / 1000.0)}K/季）", Result = "" },
                    new PendingEventOption { Label = "转导师型替补", Result = "" },
                    new PendingEventOption { Label = "放上挂牌名单", Result = "" },
                    new PendingEventOption { Label = "举办退役仪式", Result = "" },
                    new PendingEventOption { Label = "深夜长谈", Result = "" },
                },
            };
            var c1 = MkCard("retire_test_1");
            state.PendingEvents.Add(c1);
            var r4 = Retirement.ResolveRetireCard(state, c1, 4, new Rng(406));
            AssertDeepEqual(expectedR["forceOpt4"], new JsonObject { ["result"] = r4.Result, ["note"] = r4.Note }, "retirement.forceOpt4");
            if (state.Players.ContainsKey(oldGuy.Id))
            {
                var c2 = MkCard("retire_test_2");
                state.PendingEvents.Add(c2);
                var r3 = Retirement.ResolveRetireCard(state, c2, 3, new Rng(407));
                AssertDeepEqual(expectedR["forceOpt3"], new JsonObject { ["result"] = r3.Result, ["note"] = r3.Note }, "retirement.forceOpt3");
                Assert.Equal(expectedR["forceOpt3StillOnRoster"]!.GetValue<bool>(), state.Players.ContainsKey(oldGuy.Id));
            }

            // 教练签约/解雇闭环
            state.CoachPool.Add(new CoachFreeAgent { Id = "coach_test", Name = "测试名宿", Fame = 60, Comm = 71.5, Titles = 2, Mvps = 3, IsIgl = true, HomegrownClubId = null, RetiredYear = state.Year, Value = 66 });
            var sign2 = Retirement.SignCoach(state, "coach_test", "training") ?? "ok";
            Assert.Equal(expectedR["sign2"]!.GetValue<string>(), sign2);
            AssertDeepEqual(expectedR["staffTraining2"], SlotJson(state.Teams[myId].Staff.Training), "retirement.staffTraining2");
            AssertDeepEqual(expectedR["coachPoolAfterSign"], new JsonArray(state.CoachPool.Select(c => (JsonNode)c.Id).ToArray()), "retirement.coachPoolAfterSign");
            Assert.Equal(expectedR["fire2"]!.GetValue<string>(), Retirement.FireCoach(state, "training"));
            AssertDeepEqual(expectedR["coachPoolAfterFire"], new JsonArray(state.CoachPool.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id, ["value"] = c.Value,
            }).ToArray()), "retirement.coachPoolAfterFire");
        }

        // ── ④ challenge ──
        {
            var expectedC = g["challenge"]!;
            var good = Challenge.LoadChallengePack(new JsonObject
            {
                ["id"] = "CH1", ["name"] = "新手试炼", ["desc"] = "两赛季一冠", ["seed"] = 42, ["seasons"] = 2,
                ["goal"] = "titles", ["constraints"] = new JsonObject { ["origin"] = "analyst", ["tier"] = 1 },
            });
            Assert.NotNull(good);
            AssertDeepEqual(expectedC["good"], new JsonObject
            {
                ["id"] = good!.Id, ["name"] = good.Name, ["desc"] = good.Desc, ["seed"] = good.Seed,
                ["seasons"] = good.Seasons, ["goal"] = good.Goal,
                ["constraints"] = new JsonObject
                {
                    ["origin"] = good.Constraints.Origin, ["difficulty"] = good.Constraints.Difficulty,
                    ["tier"] = good.Constraints.Tier, ["maxAge"] = good.Constraints.MaxAge,
                },
            }, "challenge.good");
            Assert.True(Challenge.LoadChallengePack(new JsonObject { ["id"] = "X", ["name"] = "x", ["seed"] = 1.5, ["goal"] = "titles" }) == null == expectedC["bad1"]!.GetValue<bool>(), "challenge.bad1");
            Assert.True(Challenge.LoadChallengePack(new JsonObject { ["id"] = "X", ["name"] = "x", ["seed"] = 42, ["goal"] = "nope" }) == null == expectedC["bad2"]!.GetValue<bool>(), "challenge.bad2");

            long savedSeed = state.Seed;
            state.Seed = 43;
            string? wrongSeed = Challenge.ValidateChallengeStart(state, good);
            state.Seed = savedSeed;
            string? ok = Challenge.ValidateChallengeStart(state, good);
            var legendPack = new Challenge.ChallengeDef
            {
                Id = good.Id, Name = good.Name, Desc = good.Desc, Seed = good.Seed, Seasons = good.Seasons,
                Goal = good.Goal, Constraints = new Challenge.ChallengeConstraints { Origin = "legend", Tier = good.Constraints.Tier },
            };
            string? wrongOrigin = Challenge.ValidateChallengeStart(state, legendPack);
            AssertDeepEqual(expectedC["validate"], new JsonObject
            {
                ["wrongSeed"] = wrongSeed, ["ok"] = ok, ["wrongOrigin"] = wrongOrigin,
            }, "challenge.validate");
            var score = Challenge.ChallengeScoreOf(state, good);
            AssertDeepEqual(expectedC["score"], new JsonObject
            {
                ["goal"] = score.Goal, ["value"] = Hex(score.Value),
                ["seasonsPlayed"] = score.SeasonsPlayed, ["qualified"] = score.Qualified,
            }, "challenge.score");
            Assert.Equal(expectedC["report"]!.GetValue<string>(), Challenge.ChallengeReport(state, good));
        }

        // ── ⑤ share ──
        {
            var expectedS = g["share"]!;
            var my = state.Teams[myId];
            var opp = teams.First(t => t.Id != myId);
            long seed = Rng.HashString($"42:share:{state.Day}");
            var rec = Match.SimMatch(state, my.Id, opp.Id, 3, seed, "share-1");
            var payload = Share.BuildReplayPayload(state, rec);
            var anon = Share.AnonymizeReplay(payload);
            AssertDeepEqual(expectedS["payload"], PayloadDigest(payload), "share.payload");
            AssertDeepEqual(expectedS["anon"], PayloadDigest(anon), "share.anon");

            // CS 内部编解码往返（deflate 字节依平台实现，不入 golden）
            var code = Share.EncodeReplay(payload);
            Assert.Equal('1', code[0]);
            var decoded = Share.DecodeReplay(code);
            Assert.NotNull(decoded);
            Assert.Equal(payload.Rec.Id, decoded!.Rec.Id);
            Assert.Equal(payload.Players.Keys, decoded.Players.Keys);
            Assert.Null(Share.DecodeReplay("9garbage"));
        }
    }

    private static JsonNode? SlotJson(StaffSlot? s)
    {
        if (s == null) return null; // TS undefined → JSON 键省略
        var o = new JsonObject { ["name"] = s.Name, ["value"] = s.Value };
        if (s.CoachId != null) o["coachId"] = s.CoachId; // TS worldgen 槽位无 coachId 键
        return o;
    }

    private static JsonObject PayloadDigest(Share.ReplayPayload p) => new()
    {
        ["teams"] = new JsonObject
        {
            ["A"] = new JsonObject { ["tag"] = p.A.Tag, ["name"] = p.A.Name, ["roster"] = new JsonArray(p.A.Roster.Select(r => (JsonNode)r).ToArray()) },
            ["B"] = new JsonObject { ["tag"] = p.B.Tag, ["name"] = p.B.Name, ["roster"] = new JsonArray(p.B.Roster.Select(r => (JsonNode)r).ToArray()) },
        },
        ["players"] = new JsonObject(p.Players.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
        ["rec"] = new JsonObject
        {
            ["id"] = p.Rec.Id, ["seed"] = p.Rec.Seed, ["format"] = p.Rec.Format,
            ["teamA"] = p.Rec.TeamA, ["teamB"] = p.Rec.TeamB, ["stage"] = p.Rec.Stage,
            ["day"] = p.Rec.Day, ["winner"] = p.Rec.Winner,
            ["score"] = new JsonArray(p.Rec.ScoreA, p.Rec.ScoreB),
        },
    };
}
