using System;
using System.Text.Json.Nodes;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 种子挑战赛（GDD §11.5 v2.5，零服务端模拟的轻竞技）：官方以静态 JSON 发挑战包
/// （固定 seed + 开局约束 + 赛季数 + 计分目标）；玩家本地确定性跑同一世界。
/// 服务端只做「发种子、收成绩」——本模块纯本地、零 RNG。TS 权威：ace/src/core/sim/challenge.ts。
/// </summary>
public static class Challenge
{
    public sealed class ChallengeConstraints
    {
        public string? Origin { get; set; }
        public string? Difficulty { get; set; }
        /// <summary>限定俱乐部档位（1=VCT 合作队 / 2=挑战者）</summary>
        public int? Tier { get; set; }
        /// <summary>全队年龄上限（如 U22 挑战）</summary>
        public int? MaxAge { get; set; }
    }

    public sealed class ChallengeDef
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Desc { get; set; } = "";
        public long Seed { get; set; }
        public int Seasons { get; set; }
        /// <summary>titles / circuit</summary>
        public string Goal { get; set; } = "";
        public ChallengeConstraints Constraints { get; set; } = new();
    }

    /// <summary>稳健数值读取：STJ 的 JsonValue 不跨数值类型 TryGetValue（int 承载读 double 失败）。</summary>
    private static bool TryNum(JsonValue? v, out double d)
    {
        d = 0;
        if (v == null) return false;
        if (v.TryGetValue<double>(out d)) return true;
        if (v.TryGetValue<int>(out var i)) { d = i; return true; }
        if (v.TryGetValue<long>(out var l)) { d = l; return true; }
        return false;
    }

    /// <summary>解析并校验挑战包 JSON（静态下发；坏包返回 null——UI 显示加载失败）。</summary>
    public static ChallengeDef? LoadChallengePack(JsonNode? raw)
    {
        if (raw is not JsonObject c) return null;
        if (c["id"] is not JsonValue idV || idV.GetValueKind() != System.Text.Json.JsonValueKind.String) return null;
        if (c["name"] is not JsonValue nameV || nameV.GetValueKind() != System.Text.Json.JsonValueKind.String) return null;
        if (c["seed"] is not JsonValue seedV || seedV.GetValueKind() != System.Text.Json.JsonValueKind.Number) return null;
        if (!TryNum(seedV, out var seedD) || seedD != Math.Floor(seedD)) return null;
        if (c["goal"] is not JsonValue goalV || goalV.GetValueKind() != System.Text.Json.JsonValueKind.String) return null;
        var goal = goalV.GetValue<string>();
        if (goal != "titles" && goal != "circuit") return null;
        int seasons = 1;
        if (TryNum(c["seasons"] as JsonValue, out var sd) && sd >= 1 && sd <= 10)
            seasons = (int)Math.Floor(sd);
        var cons = new ChallengeConstraints();
        if (c["constraints"] is JsonObject co)
        {
            if (co["origin"] is JsonValue ov)
            {
                var o = ov.GetValue<string>();
                if (o is "legend" or "grassroots" or "analyst") cons.Origin = o;
            }
            if (co["difficulty"] is JsonValue dv)
            {
                var d = dv.GetValue<string>();
                if (d is "normal" or "hard" or "pro") cons.Difficulty = d;
            }
            if (TryNum(co["tier"] as JsonValue, out var tier) && ((int)tier == 1 || (int)tier == 2)) cons.Tier = (int)tier;
            if (TryNum(co["maxAge"] as JsonValue, out var ma)) cons.MaxAge = (int)Math.Floor(ma);
        }
        string desc = c["desc"] is JsonValue dsc && dsc.GetValueKind() == System.Text.Json.JsonValueKind.String ? dsc.GetValue<string>() : "";
        return new ChallengeDef
        {
            Id = idV.GetValue<string>(),
            Name = nameV.GetValue<string>(),
            Desc = desc,
            Seed = (long)seedD,
            Seasons = seasons,
            Goal = goal,
            Constraints = cons,
        };
    }

    private static readonly System.Collections.Generic.IReadOnlyDictionary<string, string> OriginCn = new System.Collections.Generic.Dictionary<string, string>
    {
        ["legend"] = "前豪门名宿", ["grassroots"] = "次级联赛草根", ["analyst"] = "数据分析师出身",
    };
    private static readonly System.Collections.Generic.IReadOnlyDictionary<string, string> DifficultyCn = new System.Collections.Generic.Dictionary<string, string>
    {
        ["normal"] = "普通", ["hard"] = "困难", ["pro"] = "职业",
    };

    /// <summary>开局约束校验：返回违规说明（null = 合规）。种子相等是硬条件。</summary>
    public static string? ValidateChallengeStart(GameState state, ChallengeDef ch)
    {
        if (state.Seed != ch.Seed) return $"种子不符（需 {ch.Seed}）";
        var my = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        if (my == null) return "未选队";
        if (ch.Constraints.Tier != null && my.Tier != ch.Constraints.Tier)
            return $"俱乐部档位不符（需 {(ch.Constraints.Tier == 2 ? "挑战者" : "VCT 合作队")}）";
        var c = state.Manager.Career;
        if (ch.Constraints.Origin != null && c?.Origin != ch.Constraints.Origin)
            return $"出身不符（需 {OriginCn[ch.Constraints.Origin]}）";
        if (ch.Constraints.Difficulty != null && state.Difficulty != ch.Constraints.Difficulty)
            return $"难度不符（需 {DifficultyCn[ch.Constraints.Difficulty]}）";
        if (ch.Constraints.MaxAge != null)
        {
            bool over = false;
            foreach (var pid in my.Roster)
            {
                if (state.Players.TryGetValue(pid, out var p) && p.Age > ch.Constraints.MaxAge) { over = true; break; }
            }
            if (over) return $"阵容年龄超限（需全员 ≤{ch.Constraints.MaxAge} 岁——当前名单含超龄者，请换队）";
        }
        return null;
    }

    public sealed class ChallengeScore
    {
        public string Goal { get; set; } = "";
        /// <summary>titles：生涯冠军数 / circuit：当前冠军积分合计</summary>
        public double Value { get; set; }
        public int SeasonsPlayed { get; set; }
        public bool Qualified { get; set; }
    }

    /// <summary>成绩演算（确定性纯派生）：按目标计分；赛季数达标即 qualified。</summary>
    public static ChallengeScore ChallengeScoreOf(GameState state, ChallengeDef ch)
    {
        var c = state.Manager.Career;
        int seasonsPlayed = c?.Seasons ?? 1;
        double value = ch.Goal == "titles" ? (c?.Titles ?? 0) : (state.CircuitPoints.TryGetValue(state.MyTeamId ?? "", out var p) ? p : 0);
        return new ChallengeScore { Goal = ch.Goal, Value = value, SeasonsPlayed = seasonsPlayed, Qualified = seasonsPlayed >= ch.Seasons };
    }

    /// <summary>成绩摘要（玩家提交的文本凭证；回放链接由分享面板另行生成附上）。</summary>
    public static string ChallengeReport(GameState state, ChallengeDef ch)
    {
        var s = ChallengeScoreOf(state, ch);
        var my = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;
        string goalName = ch.Goal == "titles" ? "冠军数" : "冠军积分";
        string valueText = s.Value == Math.Floor(s.Value) ? ((long)s.Value).ToString() : DetMath.ToFixed2(s.Value);
        return $"【种子挑战赛 {ch.Id}·{ch.Name}】{my?.Name ?? "?"}｜{goalName} {valueText}｜已赛 {s.SeasonsPlayed}/{ch.Seasons} 赛季{(s.Qualified ? "（完赛）" : "")}｜种子 {ch.Seed}。成绩以回放链接为凭证。";
    }
}
