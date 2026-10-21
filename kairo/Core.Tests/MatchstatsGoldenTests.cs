using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Kairo.Core;
using Xunit;

namespace Kairo.Core.Tests;

/// <summary>
/// matchstats 黄金轨迹回放：夹具由两侧各自的 Rng(999) 确定性重建（rng 调用序逐一对齐），
/// 再对 liveAcs/liveLines/liveMeta/summarizeMatch/pickMvps 的输出做逐项比对（全整数字段）。
/// </summary>
public sealed class MatchstatsGoldenTests
{
    private static readonly string[] Pids = { "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5" };
    private static readonly string[] MapNames = { "ascent", "haven" };
    private static readonly int[] RoundCounts = { 12, 9 };
    private static readonly string[] Hows = { "elim", "spike", "defuse", "time" };
    private static readonly string[] Tiers = { "core", "harvest", "combo" };
    private static readonly string[] Tactics = { "default", "fast", "slow", "stack" };

    private static List<MapRecord> BuildFixture(int seed)
    {
        var rng = new Rng(seed);
        return MapNames.Select((mapName, mi) =>
        {
            int total = RoundCounts[mi];
            int scoreA = 0, scoreB = 0;
            var rounds = new List<RoundRecord>();
            for (int ri = 0; ri < total; ri++)
            {
                string atk = ri % 2 == 0 ? "A" : "B";
                string winner = rng.Chance(0.55) ? "A" : "B";
                if (winner == "A") scoreA++; else scoreB++;
                int killCount = rng.Int(3, 6);
                var dead = new HashSet<string>();
                var events = new List<RoundEvent>();
                for (int ei = 0; ei < killCount; ei++)
                {
                    string side = rng.Chance(0.5) ? "A" : "B";
                    var pool = Pids.Where(p => p[0] == side[0] && !dead.Contains(p)).ToList();
                    var victims = Pids.Where(p => p[0] != side[0] && !dead.Contains(p)).ToList();
                    if (pool.Count == 0 || victims.Count == 0) break;
                    string s = rng.Pick(pool);
                    string v = rng.Pick(victims);
                    dead.Add(v);
                    var e = new RoundEvent { T = "kill", S = s, V = v, First = ei == 0, Dmg = rng.Chance(0.7) ? rng.Int(80, 300) : null };
                    if (rng.Chance(0.25)) e.Vs = rng.Int(1, 3);
                    events.Add(e);
                }
                foreach (string side in new[] { "A", "B" })
                {
                    _ = side; // alive 计数不进 golden（可由事件推导），保持 rng 序一致即可
                }
                if (rng.Chance(0.4)) events.Add(new RoundEvent { T = "plant", S = rng.Pick(Pids.Where(p => p[0] == atk[0]).ToList()), Side = atk });
                if (rng.Chance(0.3)) events.Add(new RoundEvent { T = "ultReady", Tier = rng.Pick(Tiers), Side = rng.Chance(0.5) ? "A" : "B" });
                if (rng.Chance(0.2)) events.Add(new RoundEvent { T = "clutch", S = rng.Pick(Pids.ToList()), Vs = rng.Int(1, 3), Side = winner });
                var dmgBonus = new OrderedDict<string, double>();
                int nBonus = rng.Int(0, 3);
                for (int b = 0; b < nBonus; b++)
                {
                    var pid = rng.Pick(Pids.ToList());
                    dmgBonus[pid] = (dmgBonus.TryGetValue(pid, out var cur) ? cur : 0) + rng.Int(10, 150);
                }
                var assists = Pids.Where(p => rng.Chance(0.15)).ToList();
                var ults = new OrderedDict<string, int>();
                foreach (var p in Pids) ults[p] = rng.Int(0, 7);
                rounds.Add(new RoundRecord
                {
                    N = ri + 1,
                    Atk = atk,
                    BuyA = rng.Pick(new[] { "full", "force", "eco" }),
                    BuyB = rng.Pick(new[] { "full", "force", "eco" }),
                    TacticAtk = rng.Pick(Tactics),
                    TacticDef = rng.Pick(Tactics),
                    Events = events,
                    End = new RoundEnd
                    {
                        Win = winner,
                        How = rng.Pick(Hows),
                        ScoreA = scoreA,
                        ScoreB = scoreB,
                        Assists = assists,
                        DmgBonus = dmgBonus,
                        Ults = ults,
                        Money = new MoneyPool { A = rng.Int(500, 60000), B = rng.Int(500, 60000) },
                        Timeouts = new MoneyPool { A = rng.Int(0, 2), B = rng.Int(0, 2) },
                    },
                });
            }
            var lines = new OrderedDict<string, PlayerLine>();
            foreach (var pid in Pids)
            {
                lines[pid] = new PlayerLine
                {
                    Kills = rng.Int(5, 30), Deaths = rng.Int(5, 25), Assists = rng.Int(0, 12),
                    FirstKills = rng.Int(0, 6), FirstDeaths = rng.Int(0, 5), Clutches = rng.Int(0, 3),
                    Damage = rng.Int(1000, 5000), Rounds = rng.Int(15, 25),
                    Acs = rng.Int(120, 320),
                };
            }
            var agents = new OrderedDict<string, string>();
            foreach (var p in Pids) agents[p] = rng.Pick(new[] { "jett", "sova", "omen", "sage" });
            return new MapRecord
            {
                Map = mapName, ScoreA = scoreA, ScoreB = scoreB, Rounds = rounds, Lines = lines, Mvp = null, Agents = agents,
            };
        }).ToList();
    }

    private static readonly Lazy<JsonObject> Golden = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Golden", "matchstats.golden.json")))!.AsObject());

    private static readonly Lazy<List<MapRecord>> Fixture = new(() => BuildFixture(999));

    [Fact]
    public void LiveAcs_MatchesVectors()
    {
        foreach (var v in Golden.Value["acsVec"]!.AsArray())
            Assert.Equal(v!["r"]!.GetValue<int>(), Matchstats.LiveAcs(v["dmg"]!.GetValue<int>(), v["rounds"]!.GetValue<int>()));
    }

    [Fact]
    public void LiveLinesAndMeta_MatchProbes()
    {
        var maps = Fixture.Value;
        foreach (var probe in Golden.Value["liveOut"]!.AsArray())
        {
            var upTo = new Matchstats.UpTo
            {
                Mi = probe!["upTo"]!["mi"]!.GetValue<int>(),
                Ri = probe["upTo"]!["ri"]!.GetValue<int>(),
                Ei = probe["upTo"]!["ei"]!.GetValue<int>(),
            };
            var lines = Matchstats.LiveLines(maps, upTo);
            var meta = Matchstats.LiveMeta(maps, upTo);

            Assert.Equal(probe["rounds"]!.GetValue<int>(), lines.Rounds);
            var expectedLines = probe["lines"]!.AsArray()
                .Select(l => (l!["pid"]!.GetValue<string>(), l["k"]!.GetValue<int>(), l["d"]!.GetValue<int>(),
                    l["a"]!.GetValue<int>(), l["fk"]!.GetValue<int>(), l["dmg"]!.GetValue<double>()))
                .ToArray();
            Assert.Equal(expectedLines, lines.Lines.Select(kv => (kv.Key, kv.Value.K, kv.Value.D, kv.Value.A, kv.Value.Fk, kv.Value.Dmg)));
            var expectedUlts = probe["ults"]!.AsArray().Select(x => (x![0]!.GetValue<string>(), x[1]!.GetValue<int>())).ToArray();
            Assert.Equal(expectedUlts, meta.Ults.Select(kv => (kv.Key, kv.Value)));
            var expMoney = probe["money"];
            if (expMoney is JsonObject moneyNode)
                Assert.Equal((moneyNode["A"]!.GetValue<int>(), moneyNode["B"]!.GetValue<int>()), (meta.Money!.A, meta.Money.B));
            else
                Assert.Null(meta.Money);
        }
    }

    [Fact]
    public void SummarizeAndMvps_Match()
    {
        var teamAPids = new HashSet<string>(Pids.Where(p => p[0] == 'A'));
        var rows = Matchstats.SummarizeMatch(Fixture.Value, teamAPids);
        var expected = Golden.Value["summary"]!.AsArray()
            .Select(r => (r!["pid"]!.GetValue<string>(), r["team"]!.GetValue<string>(), r["k"]!.GetValue<int>(), r["d"]!.GetValue<int>(),
                r["a"]!.GetValue<int>(), r["fk"]!.GetValue<int>(), r["fd"]!.GetValue<int>(), r["clutches"]!.GetValue<int>(),
                r["rounds"]!.GetValue<int>(), r["acs"]!.GetValue<int>()))
            .ToArray();
        Assert.Equal(expected, rows.Select(r => (r.Pid, r.Team, r.K, r.D, r.A, r.Fk, r.Fd, r.Clutches, r.Rounds, (int)r.Acs)));
        var mvps = Matchstats.PickMvps(rows, "A");
        Assert.Equal(Golden.Value["mvps"]!["mvp"]!.GetValue<string>(), mvps.Mvp);
        Assert.Equal(Golden.Value["mvps"]!["smvp"]!.GetValue<string>(), mvps.Smvp);
    }
}
