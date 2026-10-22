using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 训练赛系统（GDD §5.6 v1.1 重做版）：约战（对手/地图/目标三选一）→ AI 接受判定 →
/// 单图先到 13 模拟（无 BP、不计个人数据、不产生 MatchRecord）→ 收益按陪练系数结算。
/// 情报生态（§7.2）：负场情报进度全量增加。TS 权威：ace/src/core/sim/scrim.ts。
/// </summary>
public static class Scrim
{
    /// <summary>队伍实力口径：首发平均 overall（与选队界面「阵容强度」同一直觉）。</summary>
    public static double TeamAvgOverall(GameState state, string teamId)
    {
        if (!state.Teams.TryGetValue(teamId, out var t)) return 50;
        var ps = t.Starters.Select(id => state.Players.TryGetValue(id, out var p) ? p : null).Where(p => p != null).ToList();
        if (ps.Count == 0) return 50;
        double s = 0;
        foreach (var p in ps!) s += p!.Overall;
        return s / ps.Count;
    }

    /// <summary>陪练系数（§12 调参表）：1 + clamp((对手−我方)/40, −0.35, +0.20)。</summary>
    public static double ScrimSparringCoef(double mine, double opp) =>
        1 + MathUtil.Clamp((opp - mine) / 40, -0.35, 0.2);

    /// <summary>对手临近正赛判定（≤2 天有正式赛 → 怕暴露战术拒约）。</summary>
    private static bool OppBusySoon(GameState state, string oppId) =>
        state.Fixtures.Any(f => !f.Played && f.Day > state.Day && f.Day <= state.Day + 2 && (f.TeamA == oppId || f.TeamB == oppId));

    /// <summary>
    /// AI 约战接受判定（GDD §5.6，显式 Rng——同 seed 双跑逐位一致）：
    /// 基础 0.74；强队婉拒弱队 −0.45；临近正赛 −0.55；宿敌 +0.18。
    /// </summary>
    public static double ScrimAcceptChance(GameState state, string myId, string oppId)
    {
        double my = TeamAvgOverall(state, myId);
        double opp = TeamAvgOverall(state, oppId);
        double chance = 0.74;
        if (opp - my >= 12) chance -= 0.45; // 强队更婉拒弱队
        if (OppBusySoon(state, oppId)) chance -= 0.55; // 临近正赛怕暴露
        bool rival = state.Teams.TryGetValue(oppId, out var ot) && state.Teams.TryGetValue(myId, out var mt)
            && ot.RegionId == mt.RegionId && Intel.IntelOf(state, oppId) >= 1;
        if (rival) chance += 0.18; // 宿敌互约（互相侦察）
        return MathUtil.Clamp(chance, 0.05, 0.95);
    }

    public sealed class ScrimRequest
    {
        public string OppId { get; set; } = "";
        public string MapId { get; set; } = "";
        /// <summary>blend/style/mappool</summary>
        public string Goal { get; set; } = "";
        /// <summary>goal == "style" 时指定目标风格</summary>
        public string? GoalStyle { get; set; }
    }

    public sealed class ScrimResult
    {
        public bool Accepted { get; set; }
        public string Reason { get; set; } = "";
        public bool Won { get; set; }
        public int ScoreA { get; set; }
        public int ScoreB { get; set; }
        public double Coef { get; set; }
    }

    private static ScrimResult Reject(string reason) => new() { Accepted = false, Reason = reason, Won = false, Coef = 1 };

    /// <summary>
    /// 发起训练赛（worker 已校验行动力 ≥1；请求即扣 1 点——被婉拒也算打过电话）。
    /// 确定性：接受判定用传入 rng；对局 seed 由 (世界种子, 天, 对手, 图, 目标) 哈希派生。
    /// </summary>
    public static ScrimResult RequestScrim(GameState state, ScrimRequest req, Rng rng, List<NewsItem> notes)
    {
        string myId = state.MyTeamId!;
        var my = state.Teams.GetValueOrDefault(myId);
        var opp = state.Teams.GetValueOrDefault(req.OppId);
        if (my == null || opp == null || req.OppId == myId) return Reject("对手无效。");
        var mapDef = CoreData.Maps.FirstOrDefault(m => m.Id == req.MapId);
        if (mapDef == null) return Reject("地图无效。");

        state.ActionPoints = Math.Max(0, state.ActionPoints - 1);

        double chance = ScrimAcceptChance(state, myId, req.OppId);
        if (!rng.Chance(chance))
        {
            notes.Add(new NewsItem { Day = state.Day, Kind = "club", Text = $"📵 {opp.Name} 婉拒了训练赛邀请（约战消耗 1 行动力）。" });
            return Reject($"{opp.Name} 婉拒了邀请。");
        }

        double myStr = TeamAvgOverall(state, myId);
        double oppStr = TeamAvgOverall(state, req.OppId);
        double coef = ScrimSparringCoef(myStr, oppStr);
        // 图池特训：对手该图为强图（★3）→ 陪练系数额外 +0.15
        if (req.Goal == "mappool" && Intel.StarsOf(Intel.EstimateMapStrength(state, opp, mapDef)) == 3) coef += 0.15;

        // 单图先到 13（无 BP、无干预）：mapLock 锁图，simMatch 结果仅取回合比分后丢弃
        long matchSeed = Rng.HashString($"{state.Seed}:scrim:{state.Day}:{req.OppId}:{req.MapId}:{req.Goal}");
        var rec = Match.SimMatch(state, myId, req.OppId, 1, matchSeed, $"scrim-{state.Day}-{req.OppId}", new List<string> { req.MapId });
        var map = rec.Maps[0];
        bool won = rec.Winner == "A";
        double gainMul = won ? coef : 0.45 * coef; // 负场收益 ×0.45（情报另算全量）

        // ── 目标收益（GDD §5.6 三选一）──
        var oppStyle = Strength.StyleOf(Strength.AggrOfLineup(
            opp.Starters.Select(id => state.Players.TryGetValue(id, out var sp) ? sp : null).Where(p => p != null).Select(p => p!).ToList()));
        string effectText;
        if (req.Goal == "blend")
        {
            my.Bond = MathUtil.Clamp(my.Bond + 2 * gainMul, 0, 100);
            my.MapPref[req.MapId] = MathUtil.Clamp((my.MapPref.TryGetValue(req.MapId, out var mp) ? mp : 50) + 0.5 * gainMul, 20, 95);
            foreach (var p in Match.ResolveMatchRoster(state, my))
            {
                p.Xp["teamwork"] = (p.Xp.TryGetValue("teamwork", out var tw) ? tw : 0) + 1.5 * gainMul;
                p.Xp["communication"] = (p.Xp.TryGetValue("communication", out var cm) ? cm : 0) + 1.5 * gainMul;
            }
            effectText = "磨合训练：羁绊与图池熟练提升";
        }
        else if (req.Goal == "style")
        {
            if (req.GoalStyle != null && oppStyle == req.GoalStyle)
            {
                state.StyleCounter[req.GoalStyle] = MathUtil.Clamp((state.StyleCounter.TryGetValue(req.GoalStyle, out var sc) ? sc : 0) + 0.5, 0, 10);
                effectText = $"风格特训生效：对「{(Strength.StyleLabel.TryGetValue(oppStyle, out var lb) ? lb : oppStyle)}」应对熟练度 +0.5";
            }
            else
            {
                my.Bond = MathUtil.Clamp(my.Bond + 0.5 * gainMul, 0, 100);
                effectText = $"风格不匹配（对手实际为「{(Strength.StyleLabel.TryGetValue(oppStyle, out var lb2) ? lb2 : oppStyle)}」），仅少量磨合收益";
            }
        }
        else
        {
            // 图池特训：目标图熟练收益 ×1.5（0.4 跑图当量 → 0.6），另计系数
            my.MapPref[req.MapId] = MathUtil.Clamp((my.MapPref.TryGetValue(req.MapId, out var mp2) ? mp2 : 50) + 0.6 * gainMul, 20, 95);
            effectText = "图池特训：目标图熟练 +0.6 × 系数";
        }

        // ── 状态结算：疲劳按正式赛公式 ×0.6（单图 5 → 3）；士气胜负 ±2/−4，输给强队 ≥10 减半 ──
        double gap = oppStr - myStr;
        foreach (var p in Match.ResolveMatchRoster(state, my))
        {
            p.Fatigue = MathUtil.Clamp(p.Fatigue + 3, 0, 100);
            if (won) p.Morale = MathUtil.Clamp(p.Morale + 2, 10, 100);
            else p.Morale = MathUtil.Clamp(p.Morale - (gap >= 10 ? 2 : 4), 10, 100); // 虽败有得
            p.Form = MathUtil.Clamp(p.Form + (won ? 0.5 : -0.5), 30, 99);
        }
        // 负场 → 该对手情报进度全量增加（GDD §5.6：输局是情报的大来源）
        if (!won) Intel.AddIntel(state, req.OppId, Intel.IntelCap);

        state.ScrimLog.Add(new ScrimLogEntry { Day = state.Day, OppId = req.OppId, MapId = req.MapId, Goal = req.Goal, ScoreA = map.ScoreA, ScoreB = map.ScoreB, Won = won });
        if (state.ScrimLog.Count > 20) state.ScrimLog.RemoveRange(0, state.ScrimLog.Count - 20);

        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "match",
            Text = $"🤝 训练赛 vs {opp.Name}（{mapDef.Name}·{(req.Goal == "blend" ? "磨合" : req.Goal == "style" ? "风格特训" : "图池特训")}）：{(won ? "胜" : "负")} {Math.Max(map.ScoreA, map.ScoreB)}-{Math.Min(map.ScoreA, map.ScoreB)}。{effectText}{(!won ? "；情报进度全量增加" : "")}。",
        });
        return new ScrimResult { Accepted = true, Reason = "", Won = won, ScoreA = map.ScoreA, ScoreB = map.ScoreB, Coef = coef };
    }
}
