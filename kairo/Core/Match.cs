using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 比赛引擎（GDD §5.2/§5.3）— C# 移植自 ace/src/core/sim/match.ts（权威实现）。
/// BP → 逐图逐回合模拟 → MatchRecord 事件流。模拟纯函数化：生涯/状态入账走 ApplyMatchEffects。
/// 确定性红线：确定性 hash 选择（开局战术/IGL 阅读）与玩家干预不消耗 RNG（重模拟逐位一致）。
/// </summary>
public static class Match
{
    private const double UltBonusCap = 2.5;
    private const int MaxRounds = 80;
    private static readonly string[] DutyOrder = { "duelist", "initiator", "controller", "sentinel" };
    private static readonly Dictionary<string, double> BuyMod = new() { ["full"] = 0, ["force"] = -6.5, ["eco"] = -15 };

    // ---------- 确定性开局战术（hash 选择，不消耗 RNG） ----------

    public static string TacticForAtk(string mapId, int round, string buy, string iglId, double aware)
    {
        uint r = Rng.HashString($"{mapId}:{round}:{buy}:{iglId}:atk") % 100;
        if (buy == "eco") return r < 55 ? "atk:ecoStack" : r < 80 ? "atk:rush:A" : "atk:rush:B";
        if (buy == "force") return r < 45 ? "atk:rush:A" : r < 90 ? "atk:rush:B" : "atk:ecoStack";
        if (aware >= 70) return r < 30 ? "atk:midSplit" : r < 60 ? "atk:rush:A" : r < 85 ? "atk:rush:B" : "atk:default";
        return r < 20 ? "atk:midSplit" : r < 45 ? "atk:rush:A" : r < 65 ? "atk:rush:B" : "atk:default";
    }

    public static string TacticForDef(string mapId, int round, string iglId, double aware)
    {
        uint h = Rng.HashString($"{mapId}:{round}:{iglId}:def");
        uint r = h % 100;
        string site = h % 2 == 0 ? "A" : "B";
        if (aware >= 70) return r < 25 ? "def:aggro" : r < 55 ? $"def:stack:{site}" : "def:standard";
        return r < 15 ? "def:aggro" : r < 40 ? $"def:stack:{site}" : "def:standard";
    }

    /// <summary>队内指挥的意识值与 id（无指挥用队长位=首发第一人）。</summary>
    public static (string Id, double Aware) IglInfo(Team team, GameState state)
    {
        foreach (var pid in team.Roster)
        {
            var p = state.Players.TryGetValue(pid, out var pl) ? pl : null;
            if (p is { IsIgl: true }) return (p.Id, p.Attrs.Awareness);
        }
        foreach (var pid in team.Roster)
        {
            if (state.Players.TryGetValue(pid, out var first)) return (first.Id, first.Attrs.Awareness);
        }
        return (team.Id, 50);
    }

    /// <summary>特质乘数：kind 决定查询维度；无特质 = 1。</summary>
    public static double TraitMul(Player p, string kind)
    {
        var ts = p.Traits;
        if (ts == null || ts.Count == 0) return 1;
        bool Has(string k) => ts.Contains(k);
        double m = 1;
        if (kind == "first")
        {
            if (Has("entry")) m *= 1.35;
            if (Has("baiter")) m *= 0.5;
        }
        else if (kind == "kill")
        {
            if (Has("carry")) m *= 1.25;
            if (Has("headshot")) m *= 1.1;
            if (Has("glass")) m *= 1.15;
        }
        else if (kind == "death")
        {
            if (Has("survivor")) m *= 0.8;
            if (Has("glass")) m *= 1.3;
            if (Has("anchor")) m *= 0.9;
        }
        else if (kind == "assist")
        {
            if (Has("enabler")) m *= 1.3;
        }
        else if (kind == "clutch")
        {
            if (Has("clutch")) m *= 3;
        }
        return m;
    }

    public static string AttackSideOf(int round, bool aAttacksFirst)
    {
        string first = aAttacksFirst ? "A" : "B";
        string second = aAttacksFirst ? "B" : "A";
        if (round <= 12) return first;
        if (round <= 24) return second;
        return (round - 25) % 2 == 0 ? first : second;
    }

    public static string DecideBuy(int money, bool pistol, Rng rng)
    {
        if (pistol) return "eco";
        if (money >= 3900) return "full";
        if (money >= 2200 && rng.Chance(0.55)) return "force";
        return "eco";
    }

    private static Player PickWeighted(IReadOnlyList<Player> players, HashSet<string> alive, Func<Player, double> weight, Rng rng)
    {
        var candidates = players.Where(p => alive.Contains(p.Id)).ToList();
        var weights = candidates.Select(p => Math.Max(0.01, weight(p))).ToList();
        return candidates[rng.WeightedIndex(weights)];
    }

    private static void AddUlt(OrderedDict<string, double> ult, string pid, int n, SimTeam team, List<RoundEvent> events)
    {
        if (team.UltReady.Contains(pid)) return;
        double cur = (ult.TryGetValue(pid, out var v) ? v : 0) + n;
        var agentId = team.Str?.Agents.TryGetValue(pid, out var ag) == true ? ag : null;
        int cost = CoreData.UltCostOf(agentId ?? "");
        if (cur >= cost)
        {
            team.UltReady.Add(pid);
            string tier = agentId != null ? (CoreData.AgentById.TryGetValue(agentId, out var a) && a.UltTiers.Length > 0 ? a.UltTiers[0] : "utility") : "utility";
            events.Add(new RoundEvent { T = "ultReady", S = pid, Tier = tier, Side = team.Side });
        }
        else
        {
            ult[pid] = cur;
        }
    }

    // ---------- 招牌战术指纹（模拟只读，结算写入） ----------

    public static double PatternLeakOf(string? prev, string key, int usage)
    {
        if (usage <= 0) return 0;
        double baseVal = Math.Min(1.2, usage * 0.12);
        return prev == null || prev == key ? baseVal : baseVal * 0.25;
    }

    public static OrderedDict<string, string>? PresetAgents(GameState state, Team team, string mapId)
    {
        if (!team.Presets.TryGetValue(mapId, out var presets) || presets.Count == 0) return null;
        var preferred = presets.FirstOrDefault(p => p.Preferred) ?? presets[0];
        return preferred.Agents;
    }

    public static string PatternKeyOfTeam(GameState state, Team team, string mapId, IReadOnlyDictionary<string, OrderedDict<string, string>>? agentLock = null)
    {
        var preset = PresetAgents(state, team, mapId);
        OrderedDict<string, string>? lockMap = null;
        if (agentLock != null && agentLock.TryGetValue(mapId, out var lk)) lockMap = lk;
        var merged = new OrderedDict<string, string>();
        if (preset != null) foreach (var kv in preset) merged[kv.Key] = kv.Value;
        if (lockMap != null) foreach (var kv in lockMap) merged[kv.Key] = kv.Value;
        return string.Join("|", merged.Keys.OrderBy(k => k).Select(k => merged[k]));
    }

    public static void RecordPatternFingerprint(GameState state, string teamId, string mapId, IReadOnlyDictionary<string, OrderedDict<string, string>>? agentLock = null)
    {
        if (!state.Teams.TryGetValue(teamId, out var team)) return;
        team.LastPattern[mapId] = PatternKeyOfTeam(state, team, mapId, agentLock);
    }

    /// <summary>当日可用首发（伤员剔除、缺员从替补顶替）。</summary>
    public static List<Player> ResolveMatchRoster(GameState state, Team team)
    {
        var roster = team.Starters
            .Select(id => state.Players.TryGetValue(id, out var p) ? p : null)
            .Where(p => p != null && p.InjuredUntilDay <= state.Day)
            .Cast<Player>()
            .ToList();
        var bench = team.Roster
            .Select(id => state.Players.TryGetValue(id, out var p) ? p : null)
            .Where(p => p != null && !roster.Contains(p!) && p.InjuredUntilDay <= state.Day)
            .Cast<Player>()
            .OrderByDescending(p => Strength.EffectiveOverall(p, state.Day))
            .ToList();
        while (roster.Count < 5 && bench.Count > 0)
        {
            var p = bench[0];
            bench.RemoveAt(0);
            roster.Add(p);
        }
        return roster.Take(5).ToList();
    }

    /// <summary>赛后效果入账（模拟纯函数化拆分）：生涯累计（逐图）+ 图 MVP + 疲劳/状态/士气。</summary>
    public static void ApplyMatchEffects(GameState state, MatchRecord rec)
    {
        foreach (var mapRec in rec.Maps)
        {
            foreach (var kv in mapRec.Lines)
            {
                if (!state.Players.TryGetValue(kv.Key, out var p)) continue;
                var line = kv.Value;
                p.Career.Maps++;
                p.Career.Rounds += line.Rounds;
                p.Career.Kills += line.Kills;
                p.Career.Deaths += line.Deaths;
                p.Career.Assists += line.Assists;
                p.Career.FirstKills += line.FirstKills;
                p.Career.FirstDeaths += line.FirstDeaths;
                p.Career.Clutches += line.Clutches;
            }
            if (mapRec.Mvp != null && state.Players.TryGetValue(mapRec.Mvp, out var mvp)) mvp.Career.Mvps++;
        }
        foreach (var teamId in new[] { rec.TeamA, rec.TeamB })
        {
            if (!state.Teams.TryGetValue(teamId, out var team)) continue;
            bool won = (rec.Winner == "A" && teamId == rec.TeamA) || (rec.Winner == "B" && teamId == rec.TeamB);
            foreach (var p in ResolveMatchRoster(state, team))
            {
                p.Fatigue = Math.Min(100, Math.Max(0, p.Fatigue + rec.Maps.Count * 5));
                p.Form = Math.Min(99, Math.Max(30, p.Form + (won ? 1 : -1)));
                p.Morale = Math.Min(100, Math.Max(10, p.Morale + (won ? 2 : -2)));
            }
            if (teamId == state.MyTeamId)
            {
                state.Manager.Life.Mood = (int)Math.Min(100, Math.Max(0, state.Manager.Life.Mood + (won ? 10 : -10)));
            }
        }
    }

    // ---------- 单图模拟 ----------

    private sealed class SimTeam
    {
        public string Side = "A";
        public Team Team = null!;
        public Strength.SideStrength? Str;
        public List<Player> Players = new();
        public int Money;
        public int LossStreak;
        public int Score;
        public HashSet<string> UltReady = new();
        public int Timeouts;
        public SimCall? Call;
    }

    private sealed class SimCall
    {
        public double AtkMod;
        public double DefMod;
        public bool CounterRush;
        public int RoundsLeft;
        public string? TacticId;
        /// <summary>TS 可选字段语义：AI 暂停不写这些键（null=缺省）</summary>
        public bool? Player;
        public bool? Igl;
    }

    private static SimTeam SideOf(SimTeam a, SimTeam b, string s) => s == "A" ? a : b;

    private static double DutyGet(DutyVector d, string k) => k switch
    {
        "duelist" => d.Duelist, "initiator" => d.Initiator, "controller" => d.Controller, "sentinel" => d.Sentinel,
        _ => throw new ArgumentException(k),
    };

    private static IglReading? IglReadingFn(GameState state, string mapId, SimTeam mySim, SimTeam oppSim, double myIntel, int round, bool aAttacksFirst, List<RoundRecord> rounds)
    {
        var (iglId, aware) = IglInfo(mySim.Team, state);
        double coachVal = mySim.Team.Staff.Match?.Value ?? 0;
        int quality = (int)DetMath.JsRound(Math.Min(95, Math.Max(5, 20 + (aware - 50) * 0.9 + myIntel * 4 + coachVal * 0.25)));
        bool myAtkNext = AttackSideOf(round + 1, aAttacksFirst) == mySim.Side;
        var trend = rounds.Skip(Math.Max(0, rounds.Count - 3))
            .Select(r => r.Atk == oppSim.Side ? (r.TacticAtk ?? "atk:default") : (r.TacticDef ?? "def:standard"))
            .ToList();
        string site = Rng.HashString($"{mapId}:{round}:{iglId}:site") % 2 == 0 ? "A" : "B";
        string correctTactic;
        if (myAtkNext)
        {
            correctTactic = trend.Any(t => t.StartsWith("def:stack"))
                ? "atk:fakeRotate"
                : trend.Contains("def:aggro")
                    ? "atk:slowDefault"
                    : $"atk:rush:{site}";
        }
        else
        {
            int rushy = trend.Count(t => t.StartsWith("atk:rush") || t.StartsWith("atk:ecoStack"));
            correctTactic = rushy >= 2 ? "def:sentinelTunnel" : trend.Contains("atk:midSplit") ? "def:rotate131" : $"def:stackPush:{site}";
        }
        bool hit = Rng.HashString($"{mapId}:{round}:{iglId}:read") % 100 < (uint)quality;
        string suggested = correctTactic;
        if (!hit)
        {
            var pool = new[] { "atk:rush", "atk:fakeRotate", "atk:slowDefault", "def:stackPush", "def:rotate131", "def:giveSite", "def:sentinelTunnel" }
                .Where(t => Tactics.CallSideOf(t) == Tactics.CallSideOf(correctTactic) && t != StripSite(correctTactic))
                .ToList();
            if (pool.Count > 0)
            {
                suggested = pool[(int)(Rng.HashString($"{mapId}:{round}:{iglId}:miss") % (uint)pool.Count)];
                if (Tactics.CallDefOf(suggested)?.PickSite == true) suggested += $":{site}";
            }
        }
        return new IglReading { Round = round, IglId = iglId, Suggested = suggested, Quality = quality, Correct = hit };
    }

    private static string StripSite(string id) =>
        id.Length >= 2 && id[^2] == ':' && (id[^1] == 'A' || id[^1] == 'B' || id[^1] == 'C') ? id[..^2] : id;

    private static MapRecord SimMap(
        GameState state,
        string mapId,
        SimTeam A,
        SimTeam B,
        Rng rng,
        IReadOnlyDictionary<string, OrderedDict<string, string>>? agentLock = null,
        bool intlPlayoff = false,
        int mapIdx = 0,
        List<MatchIntervention>? interventions = null)
    {
        var map = CoreData.MapById.TryGetValue(mapId, out var md) ? md : CoreData.Maps[0];
        int aiIntelOf = state.Difficulty == "pro" ? 4 : state.Difficulty == "hard" ? 2 : 0;
        double intelA = A.Team.Id == state.MyTeamId ? Intel.IntelOf(state, B.Team.Id)
            : B.Team.Id == state.MyTeamId ? aiIntelOf : 0;
        double intelB = B.Team.Id == state.MyTeamId ? Intel.IntelOf(state, A.Team.Id)
            : A.Team.Id == state.MyTeamId ? aiIntelOf : 0;

        var assignFor = (Team team) =>
        {
            var preset = PresetAgents(state, team, mapId);
            OrderedDict<string, string>? lockMap = null;
            if (agentLock != null && agentLock.TryGetValue(mapId, out var lk)) lockMap = lk;
            if (lockMap == null) return preset;
            var merged = new OrderedDict<string, string>();
            if (preset != null) foreach (var kv in preset) merged[kv.Key] = kv.Value;
            foreach (var kv in lockMap) merged[kv.Key] = kv.Value;
            return merged;
        };
        var patternKeyOf = (Team team) =>
        {
            var assign = assignFor(team) ?? new OrderedDict<string, string>();
            return string.Join("|", assign.Keys.OrderBy(k => k).Select(k => assign[k]));
        };
        var leakOf = (Team team) =>
        {
            if (team.Id != state.MyTeamId) return 0;
            int usage = team.PatternUsage.TryGetValue(mapId, out var u) ? u : 0;
            if (usage == 0) return 0;
            return PatternLeakOf(team.LastPattern.TryGetValue(mapId, out var prev) ? prev : null, patternKeyOf(team), usage);
        };
        double leakToB = leakOf(A.Team);
        double leakToA = leakOf(B.Team);

        var patchMetaMap = new Dictionary<string, double>();
        var lastPatch = state.PatchNotes.Count > 0 ? state.PatchNotes[^1] : null;
        if (lastPatch != null)
            foreach (var c in lastPatch.Changes) patchMetaMap[c.AgentId] = c.Meta;

        bool crossRegion = A.Team.RegionId != B.Team.RegionId;
        string styleA = Strength.StyleOf(Strength.AggrOfLineup(A.Players));
        string styleB = Strength.StyleOf(Strength.AggrOfLineup(B.Players));
        double counterA = Strength.StyleCounterOf(styleA, styleB) * (crossRegion ? 0.5 : 1);
        double counterB = Strength.StyleCounterOf(styleB, styleA) * (crossRegion ? 0.5 : 1);
        double StyleTrainingShift(SimTeam t, string theirStyle)
        {
            if (t.Team.Id != state.MyTeamId) return 0;
            return Math.Min(0.9, (state.StyleCounter.TryGetValue(theirStyle, out var v) ? v : 0) * 0.09);
        }
        double counterA2 = counterA + StyleTrainingShift(A, styleB);
        double counterB2 = counterB + StyleTrainingShift(B, styleA);

        var chokeOf = (SimTeam t) =>
        {
            if (!intlPlayoff) return 0;
            double sources = 0;
            foreach (var p in t.Players)
            {
                if (p.Age <= 19) sources += 0.5;
                if (p.Traits.Contains("choker")) sources += 1;
            }
            if (sources == 0) return 0;
            bool anchored = t.Players.Any(p => p.IsIgl && p.Age >= 28) || t.Team.Coach.Motivation >= 70;
            return -Math.Min(1.2, sources) * (anchored ? 0.5 : 1);
        };

        A.Str = Strength.ComputeSide(new Strength.SideInput
        {
            Team = A.Team, Players = state.Players, Map = map, Day = state.Day,
            AgentAssign = assignFor(A.Team), Intel = intelA, PatchMeta = patchMetaMap,
            StyleCounter = counterA2, ChokeMod = chokeOf(A),
        });
        B.Str = Strength.ComputeSide(new Strength.SideInput
        {
            Team = B.Team, Players = state.Players, Map = map, Day = state.Day,
            AgentAssign = assignFor(B.Team), Intel = intelB, PatchMeta = patchMetaMap,
            StyleCounter = counterB2, ChokeMod = chokeOf(B),
        });

        var lines = new OrderedDict<string, PlayerLine>();
        var allPlayers = A.Players.Concat(B.Players).ToList();
        foreach (var p in allPlayers)
            lines[p.Id] = new PlayerLine();
        var ultPoints = new OrderedDict<string, double>();
        int a = 0, b = 0;
        int halfA = 0, halfB = 0;
        var rounds = new List<RoundRecord>();
        var readings = new List<IglReading>();
        double swingA = rng.Norm(0, Strength.SwingSd);
        double swingB = rng.Norm(0, Strength.SwingSd);
        bool aAttacksFirst = rng.Chance(0.5);
        string? mySide = A.Team.Id == state.MyTeamId ? "A" : B.Team.Id == state.MyTeamId ? "B" : null;
        SimTeam? mySim = mySide != null ? SideOf(A, B, mySide) : null;
        SimTeam? oppSim = mySide != null ? SideOf(A, B, mySide == "A" ? "B" : "A") : null;
        double myIntel = mySim == A ? intelA : intelB;

        for (int round = 1; round <= MaxRounds; round++)
        {
            if ((a >= 13 && a - b >= 2) || (b >= 13 && b - a >= 2)) break;

            string atkSide = AttackSideOf(round, aAttacksFirst);
            var atkSim = SideOf(A, B, atkSide);
            var defSim = SideOf(A, B, atkSide == "A" ? "B" : "A");
            bool pistol = round == 1 || round == 13 || round == 25;
            if (pistol)
            {
                A.Money = 800;
                B.Money = 800;
                A.LossStreak = 0;
                B.LossStreak = 0;
            }
            string buyA = DecideBuy(A.Money, pistol, rng);
            string buyB = DecideBuy(B.Money, pistol, rng);
            var atkIgl = IglInfo(atkSide == "A" ? A.Team : B.Team, state);
            var defIgl = IglInfo(atkSide == "A" ? B.Team : A.Team, state);
            string tacticAtk = TacticForAtk(mapId, round, atkSide == "A" ? buyA : buyB, atkIgl.Id, atkIgl.Aware);
            string tacticDef = TacticForDef(mapId, round, defIgl.Id, defIgl.Aware);
            if (!pistol)
            {
                A.Money = Math.Max(0, A.Money - (buyA == "full" ? 3900 : buyA == "force" ? 2300 : 500));
                B.Money = Math.Max(0, B.Money - (buyB == "full" ? 3900 : buyB == "force" ? 2300 : 500));
            }

            double UltBonus(SimTeam t)
            {
                double bonus = 0;
                foreach (var pid in t.UltReady)
                {
                    var agentId = t.Str!.Agents.TryGetValue(pid, out var ag) ? ag : null;
                    string tier = agentId != null ? (CoreData.AgentById.TryGetValue(agentId, out var ad) && ad.UltTiers.Length > 0 ? ad.UltTiers[0] : "utility") : "utility";
                    bonus += CoreData.UltTierBonus.GetValueOrDefault(tier, 0.4);
                }
                return Math.Min(UltBonusCap, bonus);
            }

            // 玩家喊话：干预命中本图本回合 → 我方喊话（不消耗 RNG——重模拟红线）
            if (mySim != null)
            {
                var iv = interventions?.FirstOrDefault(x => x.Map == mapIdx && x.Round == round);
                if (iv != null && mySim.Call == null)
                {
                    var def = Tactics.CallDefOf(iv.Tactic);
                    int myBuy = mySim == A ? (buyA == "full" ? 1 : buyA == "force" ? 2 : 3) : (buyB == "full" ? 1 : buyB == "force" ? 2 : 3);
                    int coreReady = mySim.UltReady.Count(pid =>
                    {
                        var aid = mySim.Str!.Agents.TryGetValue(pid, out var ag) ? ag : null;
                        return aid != null && CoreData.AgentById.TryGetValue(aid, out var ad) && ad.UltTiers.Length > 0 && ad.UltTiers[0] == "core";
                    });
                    bool gateOk = (!def?.NeedsCoreUlts ?? true) && (!def?.NeedsFullBuy ?? true) ||
                                  (def != null && ((!def.NeedsCoreUlts || coreReady >= 2) && (!def.NeedsFullBuy || myBuy == 1)));
                    if (def != null && gateOk && (iv.Igl == true || mySim.Timeouts > 0))
                    {
                        if (iv.Igl != true) mySim.Timeouts--;
                        double scale = iv.Igl == true ? 0.8 : 1;
                        mySim.Call = new SimCall
                        {
                            AtkMod = def.AtkMod * scale,
                            DefMod = def.DefMod * scale,
                            CounterRush = def.CounterRush,
                            RoundsLeft = iv.Igl == true ? 2 : 3,
                            TacticId = iv.Tactic,
                            Player = true,
                            Igl = iv.Igl, // 透传可空（TS 语义：undefined 时 JSON 序列化缺省）
                        };
                    }
                }
            }

            // AI 暂停：连败 ≥3 且有暂停 → 按性格 50% 喊战术，持续 3 回合
            foreach (var t in new[] { A, B })
            {
                if (t.LossStreak >= 3 && t.Timeouts > 0 && t.Call == null && rng.Chance(0.5))
                {
                    t.Timeouts--;
                    string kind = t.Team.Personality == "steady" ? "steady" : "rush";
                    var def = Tactics.CallDefOf(kind)!;
                    t.Call = new SimCall { AtkMod = def.AtkMod, DefMod = def.DefMod, RoundsLeft = 3 };
                }
            }
            if (atkSim.Call?.TacticId != null && Tactics.CallSideOf(atkSim.Call.TacticId) == "atk") tacticAtk = atkSim.Call.TacticId;
            if (defSim.Call?.TacticId != null && Tactics.CallSideOf(defSim.Call.TacticId) == "def") tacticDef = defSim.Call.TacticId;
            double CallMod(SimTeam t, bool isAtk) => t.Call == null ? 0 : isAtk ? t.Call.AtkMod : t.Call.DefMod;

            double atkStr = atkSim.Str!.Atk + UltBonus(atkSim);
            double defStr = defSim.Str!.Def + UltBonus(defSim);
            double counterBonus = defSim.Call?.CounterRush == true && tacticAtk.StartsWith("atk:rush") ? 1.2 : 0;
            double atkTerms = atkSide == "A"
                ? atkStr + BuyMod[buyA] + CallMod(A, true) + swingA
                : atkStr + BuyMod[buyB] + CallMod(B, true) + swingB;
            double defTerms = atkSide == "A"
                ? defStr + BuyMod[buyB] + CallMod(B, false) + counterBonus + swingB
                : defStr + BuyMod[buyA] + CallMod(A, false) + counterBonus + swingA;
            string? trailing = a > b ? "B" : b > a ? "A" : null;
            double comeback = trailing != null ? 0.35 * SideOf(A, B, trailing).Str!.Mid : 0;
            double m = atkTerms - defTerms
                       + (trailing == atkSide ? comeback : trailing != null ? -comeback : 0)
                       + (atkSide == "A" ? leakToA : leakToB);

            double pAtk = 1 / (1 + DetMath.Exp(-m / Strength.LogisticK));
            bool attackerWins = rng.Chance(pAtk);
            string winSide = attackerWins ? atkSide : atkSide == "A" ? "B" : "A";
            var winSim = SideOf(A, B, winSide);
            var loseSim = SideOf(A, B, winSide == "A" ? "B" : "A");

            double c = Math.Abs(pAtk - 0.5) * 2;
            int loserAlive = rng.WeightedIndex(new List<double> { 2.0 - 1.5 * c, 1.4, 1.0 + 0.5 * c, 0.6 + 0.7 * c, 0.3 + c });
            int winnerDeaths = Math.Min(rng.WeightedIndex(new List<double> { 2.6 - 1.4 * c, 1.6, 0.9 + 0.5 * c, 0.4 + 0.6 * c, 0.2 + 0.8 * c }), 4);
            int winnerAlive = 5 - winnerDeaths;

            var winAlive = new HashSet<string>(winSim.Players.Select(p => p.Id));
            var loseDead = rng.Shuffle(loseSim.Players)
                .OrderByDescending(p => TraitMul(p, "death")) // 稳定序
                .Take(5 - loserAlive)
                .ToList();
            var winDead = rng.Shuffle(winSim.Players)
                .OrderByDescending(p => TraitMul(p, "death"))
                .Take(winnerDeaths)
                .ToList();
            var loseAll = new HashSet<string>(loseSim.Players.Select(p => p.Id));
            var atkAliveSet = attackerWins ? winAlive : loseAll;
            var atkPlayers = atkSide == "A" ? A.Players : B.Players;
            var defPlayers = atkSide == "A" ? B.Players : A.Players;

            var events = new List<RoundEvent>();
            if (A.Call != null || B.Call != null)
            {
                string caller = A.Call != null ? "A" : "B";
                var call = A.Call ?? B.Call!;
                var te = new RoundEvent { T = "timeout", Side = caller };
                if (call.Player == true)
                {
                    te.Player = true;
                    te.Tactic = call.TacticId;
                    te.Igl = call.Igl;
                }
                events.Add(te);
            }

            // 击杀分配
            var killsThisRound = new OrderedDict<string, int>();
            var firstKiller = PickWeighted(atkPlayers, atkAliveSet, p => Strength.DutyEntryWeight(Strength.DutyVectorOf(p)) * (p.Attrs.Aim / 60) * TraitMul(p, "first"), rng);
            var firstVictim = loseDead.Count > 0 ? loseDead[0] : defPlayers[0];
            events.Add(new RoundEvent { T = "kill", S = firstKiller.Id, V = firstVictim.Id, First = true, Dmg = 150 });
            killsThisRound[firstKiller.Id] = 1;
            AddUlt(ultPoints, firstKiller.Id, 1, winSim, events);

            void Credit(Player killer, Player victim)
            {
                killsThisRound[killer.Id] = (killsThisRound.TryGetValue(killer.Id, out var v) ? v : 0) + 1;
                events.Add(new RoundEvent { T = "kill", S = killer.Id, V = victim.Id, Dmg = 150 });
                AddUlt(ultPoints, killer.Id, 1, winSim, events);
            }
            for (int i = 1; i < loseDead.Count; i++)
            {
                var victim = loseDead[i];
                var killer = PickWeighted(winSim.Players, winAlive, p => Strength.DutyKillWeight(Strength.DutyVectorOf(p)) * (p.Attrs.Aim / 70) * TraitMul(p, "kill"), rng);
                Credit(killer, victim);
            }
            foreach (var victim in winDead)
            {
                var killer = PickWeighted(loseSim.Players, loseAll, p => Strength.DutyKillWeight(Strength.DutyVectorOf(p)) * (p.Attrs.Aim / 70) * TraitMul(p, "kill"), rng);
                Credit(killer, victim);
            }

            // 包点
            bool planted = false;
            if (attackerWins && rng.Chance(0.6))
            {
                planted = true;
                var planter = PickWeighted(atkPlayers, atkAliveSet, p => Strength.DutyEntryWeight(Strength.DutyVectorOf(p)), rng);
                events.Add(new RoundEvent { T = "plant", S = planter.Id });
                AddUlt(ultPoints, planter.Id, 1, winSim, events);
            }

            // 高光：ACE / 残局 / 零封
            foreach (var kv in killsThisRound)
            {
                if (kv.Value >= 5) events.Add(new RoundEvent { T = "ace", S = kv.Key });
            }
            if (winnerDeaths >= 4)
            {
                var clutchHero = winSim.Players.Where(p => winAlive.Contains(p.Id))
                    .OrderByDescending(p => TraitMul(p, "clutch"))
                    .FirstOrDefault() ?? winSim.Players[0];
                lines[clutchHero.Id].Clutches++;
                events.Add(new RoundEvent { T = "clutch", S = clutchHero.Id, Vs = Math.Max(1, loserAlive) });
            }
            if (loserAlive == 0 && winnerAlive == 5) events.Add(new RoundEvent { T = "flawless", Side = winSide });

            // 回合结束方式
            string how;
            if (attackerWins)
            {
                if (planted && rng.Chance(0.65)) how = "spike";
                else if (!planted && rng.Chance(0.15)) how = "time";
                else how = "elim";
            }
            else
            {
                how = planted && rng.Chance(0.55) ? "defuse" : "elim";
            }
            if (how == "defuse")
            {
                var defuser = PickWeighted(defPlayers, atkSide == "A" ? loseAll : winAlive, p => p.Attrs.Awareness, rng);
                events.Add(new RoundEvent { T = "defuse", S = defuser.Id });
            }

            // 计分与经济
            if (winSide == "A") a++;
            else b++;
            winSim.Money = Math.Min(9000, winSim.Money + 3000 + 200 * loserAlive);
            loseSim.Money = Math.Min(9000, loseSim.Money + 1900 + 500 * Math.Min(loseSim.LossStreak, 2) + 200 * loserAlive);
            winSim.LossStreak = 0;
            loseSim.LossStreak++;
            foreach (var t in new[] { A, B })
            {
                if (t.Call != null)
                {
                    t.Call.RoundsLeft--;
                    if (t.Call.RoundsLeft <= 0) t.Call = null;
                }
            }

            // lines 累计（残伤与助攻同步记入 end）
            var endDmg = new OrderedDict<string, double>();
            var endAssists = new List<string>();
            foreach (var p in allPlayers)
            {
                var line = lines[p.Id];
                line.Rounds++;
                var mySideAlive = A.Players.Contains(p)
                    ? (winSide == "A" ? winAlive : loseAll)
                    : (winSide == "B" ? winAlive : loseAll);
                int k = killsThisRound.TryGetValue(p.Id, out var kv) ? kv : 0;
                line.Kills += k;
                double chip = mySideAlive.Contains(p.Id) ? rng.Range(20, 55) : rng.Range(0, 15);
                line.Damage += k * 150 + chip;
                endDmg[p.Id] = chip; // 原始小数入 end——实时 ACS 求和必须与 line.Damage 完全一致
            }
            foreach (var victim in loseDead.Concat(winDead))
            {
                var line = lines[victim.Id];
                line.Deaths++;
                ultPoints[victim.Id] = (ultPoints.TryGetValue(victim.Id, out var uv) ? uv : 0) + 1;
            }
            lines[firstKiller.Id].FirstKills++;
            lines[firstVictim.Id].FirstDeaths++;
            foreach (var p in winSim.Players)
            {
                if (winAlive.Contains(p.Id) && !(killsThisRound.TryGetValue(p.Id, out var k0) && k0 > 0) && rng.Chance(0.42 * TraitMul(p, "assist")))
                {
                    lines[p.Id].Assists++;
                    endAssists.Add(p.Id);
                }
            }
            if (round == 12)
            {
                halfA = a;
                halfB = b;
            }

            var endUlts = new OrderedDict<string, int>();
            foreach (var p in allPlayers)
            {
                bool ready = (A.Players.Any(q => q.Id == p.Id) ? A.UltReady : B.UltReady).Contains(p.Id);
                endUlts[p.Id] = ready
                    ? CoreData.UltCostOf((A.Str!.Agents.TryGetValue(p.Id, out var aa) ? aa : null) ?? (B.Str!.Agents.TryGetValue(p.Id, out var ab) ? ab : null) ?? "")
                    : (int)(ultPoints.TryGetValue(p.Id, out var up) ? up : 0);
            }

            rounds.Add(new RoundRecord
            {
                N = round,
                Atk = atkSide,
                BuyA = buyA,
                BuyB = buyB,
                TacticAtk = tacticAtk,
                TacticDef = tacticDef,
                Events = events,
                End = new RoundEnd
                {
                    Win = winSide,
                    How = how,
                    AliveA = winSide == "A" ? winnerAlive : loserAlive,
                    AliveB = winSide == "B" ? winnerAlive : loserAlive,
                    ScoreA = a,
                    ScoreB = b,
                    Assists = endAssists,
                    DmgBonus = endDmg,
                    Ults = endUlts,
                    Money = new MoneyPool { A = A.Money, B = B.Money },
                    Timeouts = new MoneyPool { A = A.Timeouts, B = B.Timeouts },
                },
            });

            // IGL 场上阅读：第 7/14 回合末（hash 命中，零 RNG）
            if (mySim != null && oppSim != null && (round == 7 || round == 14))
            {
                var reading = IglReadingFn(state, mapId, mySim, oppSim, myIntel, round, aAttacksFirst, rounds);
                if (reading != null) readings.Add(reading);
            }
            _ = halfA + halfB; // half 记录保留口径（TS 同名变量仅用于翻盘标记）
        }

        int totalRounds = a + b;
        foreach (var line in lines.Values)
        {
            line.Rounds = totalRounds;
            line.Acs = totalRounds > 0 ? DetMath.JsRound((line.Damage / totalRounds) * 1.45) : 0;
        }
        var winnerIds = new HashSet<string>((a > b ? A.Players : B.Players).Select(p => p.Id));
        string? mvp = null;
        double bestScore = -1;
        foreach (var kv in lines)
        {
            double score = kv.Value.Acs + (winnerIds.Contains(kv.Key) ? 18 : 0);
            if (score > bestScore)
            {
                bestScore = score;
                mvp = kv.Key;
            }
        }
        var agents = new OrderedDict<string, string>();
        foreach (var kv in A.Str!.Agents) agents[kv.Key] = kv.Value;
        foreach (var kv in B.Str!.Agents) agents[kv.Key] = kv.Value;
        return new MapRecord
        {
            Map = mapId,
            ScoreA = a,
            ScoreB = b,
            AAttacksFirst = aAttacksFirst,
            Rounds = rounds,
            Lines = lines,
            Mvp = mvp,
            Agents = agents,
            EdgesA = A.Str.Edge,
            EdgesB = B.Str.Edge,
            Readings = readings,
        };
    }

    /// <summary>模拟一场比赛（含 BP；mapLock/agentLock 优先）。纯模拟：入账走 ApplyMatchEffects。</summary>
    public static MatchRecord SimMatch(
        GameState state,
        string teamAId,
        string teamBId,
        int bo,
        long seed,
        string matchId,
        List<string>? mapLock = null,
        IReadOnlyDictionary<string, OrderedDict<string, string>>? agentLock = null,
        List<MatchIntervention>? interventions = null)
    {
        var rng = new Rng((uint)seed);
        var teamA = state.Teams[teamAId];
        var teamB = state.Teams[teamBId];
        var veto = mapLock is { Count: > 0 }
            ? new Veto.VetoResult { Maps = mapLock.ToList(), Log = new List<string> { "手动 BP" } }
            : Veto.RunVeto(teamA, teamB, bo, rng, state.Difficulty == "pro" ? 3 : 6);

        var A = MakeSim("A", teamA, state);
        var B = MakeSim("B", teamB, state);

        var fx = state.Fixtures.FirstOrDefault(f => f.Id == matchId);
        bool intlPlayoff = fx != null && (fx.Comp == "masters" || fx.Comp == "champions")
                           && (fx.Label.Contains("胜者组") || fx.Label.Contains("败者组") || fx.Label.Contains("总决赛"));

        int winsA = 0, winsB = 0;
        var maps = new List<MapRecord>();
        for (int mi = 0; mi < veto.Maps.Count; mi++)
        {
            if (winsA >= (bo + 1) / 2 || winsB >= (bo + 1) / 2) break;
            string mapId = veto.Maps[mi];
            var mapRec = SimMap(state, mapId, A, B, rng, agentLock, intlPlayoff, mi, interventions);
            if (mapRec.ScoreA > mapRec.ScoreB) winsA++;
            else if (mapRec.ScoreB > mapRec.ScoreA) winsB++;
            maps.Add(mapRec);
        }

        string? matchMvp = null;
        double matchMvpScore = -1;
        var mvpAggregate = new OrderedDict<string, double>();
        foreach (var m in maps)
            foreach (var kv in m.Lines)
                mvpAggregate[kv.Key] = (mvpAggregate.TryGetValue(kv.Key, out var v) ? v : 0) + kv.Value.Acs;
        var winnerPlayers = winsA > winsB ? A.Players : B.Players;
        foreach (var kv in mvpAggregate)
        {
            if (!winnerPlayers.Any(p => p.Id == kv.Key)) continue;
            if (kv.Value > matchMvpScore)
            {
                matchMvpScore = kv.Value;
                matchMvp = kv.Key;
            }
        }

        return new MatchRecord
        {
            Id = matchId,
            Seed = seed,
            Format = bo,
            TeamA = teamAId,
            TeamB = teamBId,
            Stage = state.Stage,
            Day = state.Day,
            Maps = maps,
            ScoreA = winsA,
            ScoreB = winsB,
            Winner = winsA > winsB ? "A" : "B",
            Mvp = matchMvp,
            Interventions = interventions is { Count: > 0 } ? interventions.ToList() : null,
        };
    }

    private static SimTeam MakeSim(string side, Team team, GameState state)
    {
        return new SimTeam
        {
            Side = side,
            Team = team,
            Str = null,
            Players = ResolveMatchRoster(state, team),
            Money = 800,
            LossStreak = 0,
            Score = 0,
            UltReady = new HashSet<string>(),
            Timeouts = 2 + ((team.Staff.Match?.Value ?? 0) >= 85 ? 1 : 0),
            Call = null,
        };
    }
}
