using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 转会市场 v1（GDD §8.2）— C# 移植自 ace/src/core/sim/transfer.ts（权威实现）。
/// 四窗口 · 身价/薪资期望 · logistic 谈判（即时三轮 + 态度条）· 挂牌/解约金/noPoach · AI 挖角与紧急补位。
/// noteTacticsChanged（scrim.ts）随本文件移植（completeTransfer 依赖）。
/// </summary>
public static class Transfer
{
    private const int FeedCap = 300;

    /// <summary>转会窗口（[起, 止] 天；Deadline Day 逻辑同源）。</summary>
    public static readonly int[][] TransferWindows =
    {
        new[] { 1, 24 }, new[] { 123, 152 }, new[] { 233, 366 },
    };

    public static bool InTransferWindow(int day) =>
        TransferWindows.Any(w => day >= w[0] && day <= w[1]);

    /// <summary>窗口宽限（v1.1）：关窗后 3 天内仍可完成在谈交易。</summary>
    public static int? GraceRemain(GameState state)
    {
        if (InTransferWindow(state.Day)) return null;
        foreach (var w in TransferWindows)
        {
            if (state.Day > w[1] && state.Day <= w[1] + 3) return w[1] + 3 - state.Day;
        }
        return 0;
    }

    /// <summary>对手战术变化衰减（GDD §7.2）：情报点减半并返回新闻文本（零 RNG）。</summary>
    public static string? NoteTacticsChanged(GameState state, string teamId)
    {
        if (!state.Scouting.TryGetValue(teamId, out var entry) || entry.Points <= 0) return null;
        double before = entry.Points;
        entry.Points = Math.Max(0, entry.Points / 2);
        if (before < 2) return null;
        var t = state.Teams.GetValueOrDefault(teamId);
        return $"🔀 {t?.Name ?? "对手"} 阵容变动、战术打法生变——对其情报部分过时（{(int)DetMath.JsRound(before)} → {(int)DetMath.JsRound(entry.Points)}）。";
    }

    /// <summary>身价（调参见 GDD §12）：基础 × 潜力溢价 × 年龄系数 × 级别系数。detPow 保证双端一致。</summary>
    public static int MarketValue(Player p, int tier)
    {
        double baseV = DetMath.Pow(Math.Max(4, p.Overall - 48), 2.2) * 300;
        double potF = 1 + Math.Max(0, p.Potential - p.Overall) * 0.03;
        double ageF = p.Age <= 21 ? 1.25 : p.Age <= 25 ? 1.1 : p.Age <= 29 ? 0.9 : 0.65;
        double tierF = tier == 1 ? 1 : 0.45;
        double v = baseV * potF * ageF * tierF * (p.Listed ? 0.75 : 1);
        return (int)(DetMath.JsRound(v / 1000) * 1000);
    }

    /// <summary>薪资期望（求购方视角）；按目标级别与当前薪资取高者上浮 10%。</summary>
    public static int SalaryExpectation(Player p, int targetTier)
    {
        double market = 0.06 * DetMath.PowInt(1.21, Math.Min(95, Math.Max(50, p.Overall + 2)));
        int cur = Math.Max(p.Salary, 0);
        return (int)Math.Max(DetMath.JsRound(Math.Max(market, cur) * 1.1), 12000);
    }

    public sealed class OfferTerms
    {
        public double Fee;
        public int Salary;
        public int Years;
        public int SigningBonus;
        /// <summary>core/starter/rotation/bench</summary>
        public string PromisedRole = "bench";
        /// <summary>替补三正路：successor/mentor/learner</summary>
        public string? Track;
    }

    private static int RoleRank(string role) => role switch
    {
        "bench" => 0, "rotation" => 1, "starter" => 2, "core" => 3, _ => 0,
    };

    public sealed class NegotiationEval
    {
        public bool Insulting;
        public double Chance;
        /// <summary>最短板（谈判 UI 的主要诉求提示）</summary>
        public string? Objection;
        public double Score;
    }

    /// <summary>报价评估（调研报告 §5.2 logistic 模型 + 经理谈判技能）。</summary>
    public static NegotiationEval EvaluateOffer(GameState state, Player p, OfferTerms offer, Team toTeam)
    {
        var curTeam = p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var ct) ? ct : null;
        int salaryExp = SalaryExpectation(p, toTeam.Tier);
        double insultLine = salaryExp * 0.7;
        if (offer.Salary < insultLine)
        {
            return new NegotiationEval { Insulting = true, Chance = 0, Objection = $"薪资远低于他的期望（约 {Fmt(salaryExp)}/年）", Score = -99 };
        }
        // 违约金条款：报价 ≥ 解约金 → 强制放人
        if (p.ReleaseClause > 0 && offer.Fee >= p.ReleaseClause)
        {
            return new NegotiationEval { Insulting = false, Chance = 1, Objection = $"触发解约金条款（{Fmt(p.ReleaseClause)}）——原队不得拒绝", Score = 99 };
        }
        // 抢人保护：noPoach 在解约金触发前不可被挖
        if (p.NoPoach)
        {
            return new NegotiationEval { Insulting = false, Chance = 0, Objection = "原队已激活抢人保护条款（noPoach），解约金触发前不接受报价", Score = -80 };
        }
        var fs = new List<(double V, string Why)>();
        fs.Add(((offer.Salary / (double)salaryExp - 1) * 60, "薪资低于他的期望"));
        fs.Add((offer.SigningBonus / (double)Math.Max(1, salaryExp) * 26, "签字费缺乏吸引力"));
        double roleDelta = RoleRank(offer.PromisedRole) - RoleRank(p.PromisedRole);
        double roleV = roleDelta >= 0 ? roleDelta * 11 : roleDelta * 16;
        string roleWhy = offer.PromisedRole is "starter" or "core" ? "他希望更核心的位置" : "不接受替补定位";
        // 替补三正路（GDD §6.4）
        if (roleV < 0 && offer.Track != null && offer.PromisedRole == "bench")
        {
            if (offer.Track == "successor" && p.Age <= 21)
            {
                roleV = 8;
                roleWhy = "接班人计划：替补定位是承诺的成长路径";
            }
            else if (offer.Track == "mentor" && p.Age >= 28)
            {
                roleV = roleV / 2;
                roleWhy = "导师型替补：传帮带定位可以接受";
            }
        }
        fs.Add((roleV, roleWhy));
        fs.Add(((toTeam.Reputation - (curTeam?.Reputation ?? 40)) * 0.9, "认为这支球队不如他现在的平台"));
        if (curTeam != null)
            fs.Add((toTeam.Tier < curTeam.Tier ? 18 : toTeam.Tier > curTeam.Tier ? -22 : 0, "不愿意降级去次级联赛"));
        fs.Add((p.Listed ? 7 : 0, ""));
        fs.Add((Math.Min(p.BenchedWeeks, 6) * 1.5, ""));
        fs.Add((offer.Years >= 3 ? (p.Age >= 27 ? 8 : 3) : 0, ""));
        if (p.NoPoach) fs.Add((-13, "不愿接受转会限制条款"));
        double neg = state.Manager?.Skills.Negotiation ?? 50;
        fs.Add(((neg - 50) * 0.6, ""));
        double score = fs.Sum(f => f.V);
        double chance = 1 / (1 + DetMath.Exp(-score / 14));
        var worst = fs.Where(f => f.Why.Length > 0).OrderBy(f => f.V).FirstOrDefault();
        return new NegotiationEval
        {
            Insulting = false,
            Chance = Math.Min(0.92, Math.Max(0.02, chance)),
            Objection = worst.Why.Length > 0 && worst.V < 0 ? worst.Why : null,
            Score = score,
        };
    }

    private static string Fmt(int v) =>
        v >= 1_000_000 ? $"${DetMath.ToFixed2(v / 1_000_000.0)}M" : $"${(int)DetMath.JsRound(v / 1000.0)}K";

    /// <summary>开启即时谈判会话（1-3 轮，态度条实时评估）。</summary>
    public static (string Demand, int Attitude, bool Insulting) StartNegotiation(GameState state, TransferOffer offer)
    {
        var p = state.Players[offer.PlayerId];
        var toTeam = state.Teams[offer.ToTeam];
        var ev = EvaluateOffer(state, p, ToTerms(offer), toTeam);
        offer.Round = 1;
        offer.Demand = ev.Insulting ? "这份报价缺乏诚意。" : ev.Objection ?? "他在认真考虑。";
        offer.Attitude = (int)DetMath.JsRound(ev.Chance * 100);
        return (offer.Demand, offer.Attitude, ev.Insulting);
    }

    /// <summary>调整后的再谈（第 2/3 轮）。</summary>
    public static (string Demand, int Attitude) ReNegotiate(GameState state, TransferOffer offer)
    {
        var p = state.Players[offer.PlayerId];
        var toTeam = state.Teams[offer.ToTeam];
        offer.Round = Math.Min(3, offer.Round + 1);
        var ev = EvaluateOffer(state, p, ToTerms(offer), toTeam);
        offer.Demand = ev.Insulting ? "他拒绝继续对话。" : ev.Objection ?? "他接近被说服了。";
        offer.Attitude = (int)DetMath.JsRound(ev.Chance * 100);
        return (offer.Demand, offer.Attitude);
    }

    private static OfferTerms ToTerms(TransferOffer offer) => new()
    {
        Fee = offer.Fee, Salary = offer.Salary, Years = offer.Years, SigningBonus = offer.SigningBonus,
        PromisedRole = offer.PromisedRole, Track = offer.Track,
    };

    /// <summary>最终检定（seed 由选手/日期派生）。返回是否接受。</summary>
    public static (bool Accepted, string Reason) FinalizeOffer(GameState state, TransferOffer offer, Rng rng)
    {
        var p = state.Players[offer.PlayerId];
        var toTeam = state.Teams[offer.ToTeam];
        var ev = EvaluateOffer(state, p, ToTerms(offer), toTeam);
        if (ev.Insulting) return (false, $"{p.Ign} 认为这份报价缺乏诚意，谈判破裂。");
        // 解约金强制：不受 logistic 拒绝
        if (p.ReleaseClause > 0 && offer.Fee >= p.ReleaseClause)
        {
            return (true, $"{p.Ign} 的解约金条款被触发（{Fmt(p.ReleaseClause)}）——原队不得拒绝，交易强制完成。");
        }
        bool accepted = rng.Chance(ev.Chance);
        string demandText = offer.Demand.Length > 0 ? offer.Demand : "他对条款不满意";
        return accepted
            ? (true, $"{p.Ign} 接受了报价（{Fmt(offer.Fee)}，年薪 {Fmt(offer.Salary)} × {offer.Years} 年）。")
            : (false, $"{p.Ign} 拒绝了报价：{demandText}。");
    }

    /// <summary>完成转会：资金/名单/新闻（卖方 &lt;5 人自动紧急补位；买方上限 7）。</summary>
    public static List<string> CompleteTransfer(GameState state, TransferOffer offer, Rng rng)
    {
        var notes = new List<string>();
        var p = state.Players[offer.PlayerId];
        var fromTeam = p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var ft) ? ft : null;
        var toTeam = state.Teams[offer.ToTeam];
        // 情报随对手战术变化衰减：涉及队伍阵容变化 → 我对其情报减半
        if (state.MyTeamId != null)
        {
            foreach (var tid in new[] { p.TeamId ?? "", offer.ToTeam })
            {
                if (tid.Length == 0 || tid == state.MyTeamId) continue;
                var n = NoteTacticsChanged(state, tid);
                if (n != null) notes.Add(n);
            }
        }
        if (fromTeam != null)
        {
            fromTeam.Budget += offer.Fee;
            fromTeam.Roster = fromTeam.Roster.Where(id => id != p.Id).ToList();
            fromTeam.Starters = fromTeam.Starters.Where(id => id != p.Id).ToList();
            if (fromTeam.Roster.Count < 5)
            {
                var fa = state.Players.Values.FirstOrDefault(x => x.TeamId == null && x.InjuredUntilDay <= state.Day);
                if (fa != null)
                {
                    fa.TeamId = fromTeam.Id;
                    fa.Salary = SalaryExpectation(fa, fromTeam.Tier);
                    fromTeam.Roster.Add(fa.Id);
                    notes.Add($"🚨 {fromTeam.Name} 紧急签下自由人 {fa.Ign} 补足名单。");
                }
            }
        }
        toTeam.Budget -= offer.Fee + offer.SigningBonus;
        if (toTeam.Id == state.MyTeamId)
        {
            Finance.LogFinance(state, $"转会支出 · {p.Ign}（含签字费）", -(offer.Fee + offer.SigningBonus));
        }
        else if (fromTeam?.Id == state.MyTeamId)
        {
            Finance.LogFinance(state, $"转会收入 · {p.Ign}", offer.Fee);
        }
        toTeam.Roster.Add(p.Id);
        if (toTeam.Starters.Count < 5) toTeam.Starters.Add(p.Id);
        p.TeamId = toTeam.Id;
        p.Salary = offer.Salary;
        p.ContractYears = offer.Years;
        p.PromisedRole = offer.PromisedRole; // 承诺定位落地
        p.Morale = Math.Min(100, Math.Max(10, p.Morale + 8));
        p.BenchedWeeks = 0;
        p.Listed = false;
        // 替补三正路：签约落 track（bench/rotation 才有意义）
        p.Track = offer.PromisedRole is "bench" or "rotation" ? offer.Track : null;
        p.Career.Clubs.Add(toTeam.Id);
        state.TransferFeed.Add(new TransferFeedItem
        {
            Day = state.Day, Year = state.Year, Kind = "done",
            Text = $"{toTeam.Name} 以 {Fmt(offer.Fee)} 从 {fromTeam?.Name ?? "自由市场"} 签下 {p.Ign}（{p.Overall}）。",
        });
        if (state.TransferFeed.Count > 300)
            state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
        notes.Add(state.TransferFeed[^1].Text);
        return notes;
    }

    /// <summary>解约：赔付剩余合同 40%，成为自由人；阵容只剩 5 人时禁止。</summary>
    public static string ReleasePlayer(GameState state, string playerId)
    {
        if (!state.Players.TryGetValue(playerId, out var p)) return "他已是自由人。";
        var team = p.TeamId != null && state.Teams.TryGetValue(p.TeamId, out var t) ? t : null;
        if (team == null) return "他已是自由人。";
        if (team.Roster.Count <= 5) return "阵容只剩五人，再放走就凑不齐首发了——先补人。";
        int cost = (int)DetMath.JsRound(p.Salary * Math.Max(0, p.ContractYears) * 0.4);
        team.Budget -= cost;
        if (team.Id == state.MyTeamId) Finance.LogFinance(state, $"解约赔付 · {p.Ign}", -cost);
        team.Roster = team.Roster.Where(id => id != playerId).ToList();
        team.Starters = team.Starters.Where(id => id != playerId).ToList();
        p.TeamId = null;
        p.ContractYears = 0;
        p.Morale = Math.Min(100, Math.Max(10, p.Morale - 6));
        state.TransferFeed.Add(new TransferFeedItem
        {
            Day = state.Day, Year = state.Year, Kind = "release",
            Text = $"{team.Name} 与 {p.Ign} 解约（赔付 {Fmt(cost)}），他成为自由人。",
        });
        if (state.TransferFeed.Count > 300)
            state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
        return $"{p.Ign} 已解约，赔付 {Fmt(cost)}。";
    }

    /// <summary>每周 AI 转会动态：挖角我方 + AI 自由签约 + 挂牌/摘牌 + 互挖（仅窗内）。</summary>
    public static List<string> AiWeeklyTransfers(GameState state, Rng rng, Action<TransferOffer> onBid)
    {
        var notes = new List<string>();
        string? myId = state.MyTeamId;
        if (myId != null && InTransferWindow(state.Day))
        {
            // AI 挖角我方：优先长期板凳/高整体值钱货
            var team = state.Teams[myId];
            var candidates = team.Roster
                .Select(id => state.Players.GetValueOrDefault(id))
                .Where(p => p != null && p.InjuredUntilDay <= state.Day)
                .Select(p => (P: p!, W: 1 + Math.Min(6, p!.BenchedWeeks) * 1.2 + Math.Max(0, p.Overall - 74) * 0.4 + (p.Listed ? 3 : 0)))
                .ToList();
            if (candidates.Count > 0 && rng.Chance(0.25))
            {
                var target = candidates[rng.WeightedIndex(candidates.Select(c => c.W).ToList())].P;
                // 挖角不限买方名单；只看预算与意愿
                var suitors = state.Teams.Values.Where(t => t.Id != myId && t.Tier == team.Tier && t.Budget > MarketValue(target, team.Tier)).ToList();
                if (suitors.Count > 0)
                {
                    var from = rng.Pick(suitors);
                    int fee = (int)(DetMath.JsRound(MarketValue(target, team.Tier) * rng.Range(0.85, 1.25) / 1000) * 1000);
                    var offer = new TransferOffer
                    {
                        Id = $"BID{state.Day}_{target.Id}",
                        PlayerId = target.Id,
                        FromTeam = from.Id,
                        ToTeam = myId,
                        Fee = fee,
                        Salary = SalaryExpectation(target, from.Tier),
                        Years = rng.Int(2, 3),
                        SigningBonus = 0,
                        PromisedRole = target.PromisedRole,
                        Day = state.Day,
                        Round = 0,
                        Demand = $"{from.Name} 报价求购，7 天内答复，逾期视为拒绝。",
                        Attitude = 1,
                    };
                    state.IncomingBids.Add(offer);
                    onBid(offer);
                    notes.Add($"💼 {from.Name} 报价 {Fmt(fee)} 求购 {target.Ign}，7 天内答复。");
                }
            }
        }
        // AI 自由签约：自由池按需补强（仅窗内；每周概率触发）
        var fas = state.Players.Values.Where(p => p.TeamId == null && p.InjuredUntilDay <= state.Day).ToList();
        if (fas.Count > 0 && rng.Chance(0.4) && InTransferWindow(state.Day))
        {
            var fa = rng.Pick(fas);
            var suitors = state.Teams.Values.Where(t => t.Id != myId && t.Roster.Count < 7).ToList();
            if (suitors.Count > 0)
            {
                var to = rng.Pick(suitors);
                if (to.Roster.Count < 7)
                {
                    fa.TeamId = to.Id;
                    fa.Salary = SalaryExpectation(fa, to.Tier);
                    to.Roster.Add(fa.Id);
                    state.TransferFeed.Add(new TransferFeedItem
                    {
                        Day = state.Day, Year = state.Year, Kind = "done",
                        Text = $"{to.Name} 免转会费签下自由人 {fa.Ign}（{fa.Overall}）。",
                    });
                    if (state.TransferFeed.Count > 300)
                        state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
                    notes.Add(state.TransferFeed[^1].Text);
                }
            }
        }

        // AI 挂牌/摘牌（v0.8）——仅他队；性格定概率，换血型最活跃
        if (InTransferWindow(state.Day))
        {
            // Deadline Day：窗口末 3 天挂牌与互挖密度 ×2
            bool deadlineSoon = TransferWindows.Any(w => state.Day >= w[1] - 2 && state.Day <= w[1]);
            double dlMul = deadlineSoon ? 2 : 1;
            var listPersonality = new Dictionary<string, double> { ["wheeler"] = 0.35, ["spender"] = 0.1, ["youth"] = 0.08, ["steady"] = 0.03 };
            foreach (var t in state.Teams.Values)
            {
                if (t.Id == myId) continue;
                var listedNow = t.Roster.Select(id => state.Players.GetValueOrDefault(id)).Where(p => p?.Listed == true).Cast<Player>().ToList();
                // 摘牌：挂牌 ≥6 周 → 静默撤牌（截止期不摘）
                foreach (var p in listedNow)
                {
                    p.ListedWeeks = (p.ListedWeeks ?? 0) + 1;
                    if (p.ListedWeeks >= 6 && !deadlineSoon)
                    {
                        p.Listed = false;
                        p.ListedWeeks = 0;
                    }
                }
                // 新挂牌：性格概率（每队同时 ≤1 人，截止期 ×2）
                if (listedNow.Count == 0 && rng.Chance(listPersonality.GetValueOrDefault(t.Personality, 0.08) * dlMul))
                {
                    var pool = t.Roster
                        .Select(id => state.Players.GetValueOrDefault(id))
                        .Where(p => p != null && !p.IsIgl && !p.NoPoach && (p.Age >= 27 || p.Potential - p.Overall <= 2 || p.BenchedWeeks >= 4))
                        .Cast<Player>()
                        .ToList();
                    if (pool.Count > 0)
                    {
                        var target = rng.Pick(pool);
                        target.Listed = true;
                        target.ListedWeeks = 0;
                        state.TransferFeed.Add(new TransferFeedItem
                        {
                            Day = state.Day, Year = state.Year, Kind = "list",
                            Text = $"{t.Name} 挂牌 {target.Ign}（{target.Overall}，身价约 {Fmt(MarketValue(target, t.Tier))}）。",
                        });
                        if (state.TransferFeed.Count > 300)
                            state.TransferFeed.RemoveRange(0, state.TransferFeed.Count - 300);
                        notes.Add(state.TransferFeed[^1].Text);
                    }
                }
            }
            // AI 互挖挂牌选手：预算够的他队按 30%/周出价，直接成交
            var listedPlayers = state.Players.Values
                .Where(p => p.TeamId != null && p.TeamId != myId && p.Listed && p.InjuredUntilDay <= state.Day)
                .ToList();
            if (listedPlayers.Count > 0 && rng.Chance(deadlineSoon ? 0.6 : 0.3))
            {
                var target = rng.Pick(listedPlayers);
                string fromId = target.TeamId!;
                var seller = state.Teams[fromId];
                var suitors = state.Teams.Values.Where(
                    t => t.Id != myId && t.Id != fromId && t.Budget > MarketValue(target, t.Tier) && t.Roster.Count < 7).ToList();
                if (suitors.Count > 0 && seller != null)
                {
                    var to = rng.Pick(suitors);
                    var offer = new TransferOffer
                    {
                        Id = $"AIL{state.Day}_{target.Id}",
                        PlayerId = target.Id,
                        FromTeam = fromId,
                        ToTeam = to.Id,
                        Fee = (int)(DetMath.JsRound(MarketValue(target, to.Tier) * rng.Range(0.8, 1.1) / 1000) * 1000),
                        Salary = SalaryExpectation(target, to.Tier),
                        Years = rng.Int(2, 3),
                        SigningBonus = 0,
                        PromisedRole = target.PromisedRole,
                        Day = state.Day,
                        Round = 0,
                        Demand = "",
                        Attitude = 0,
                    };
                    notes.AddRange(CompleteTransfer(state, offer, rng));
                }
            }
        }
        return notes;
    }

    /// <summary>问价（原作式异步）：花 1 行动力不花钱；2-5 天后给要价 + 本人意向。</summary>
    public static string AskInquiry(GameState state, string playerId, Rng rng)
    {
        if (!state.Players.TryGetValue(playerId, out var p)) return "选手不存在。";
        if (!InTransferWindow(state.Day)) return "转会窗口已关闭，不能新报价或问价，只能答复在谈的事。";
        if (state.Inquiries.Any(q => q.PlayerId == playerId && !q.Done)) return "该选手问价中，等待答复。";
        int resolveDay = state.Day + rng.Int(2, 5);
        state.Inquiries.Add(new TransferInquiry
        {
            Id = $"INQ_{state.Day}_{playerId}",
            PlayerId = playerId,
            AskDay = state.Day,
            ResolveDay = resolveDay,
            Done = false,
        });
        return $"已就 {p.Ign} 问价，等待答复（约 {resolveDay - state.Day} 天后）。";
    }

    /// <summary>日推进结算：到反馈日的问价出要价 + 意向（id 哈希定浮动、评估器定意向）。</summary>
    public static void ResolveInquiries(GameState state)
    {
        foreach (var q in state.Inquiries)
        {
            if (q.Done || state.Day < q.ResolveDay) continue;
            var p = state.Players.GetValueOrDefault(q.PlayerId);
            q.Done = true;
            if (p == null)
            {
                q.Intent = "选手已不知所踪。";
                continue;
            }
            int baseV = MarketValue(p, 1);
            // 有主选手：俱乐部溢价 ×1.15（挂牌 ×0.75、noPoach 天价非卖）
            double premium = p.TeamId == null ? 1 : p.NoPoach ? 2.2 : p.Listed ? 0.75 : 1.15;
            q.AskingFee = (int)DetMath.JsRound(baseV * premium * (0.9 + Rng.HashString(q.Id) % 40 / 100.0));
            var clauses = new List<string>();
            if (p.ReleaseClause > 0) clauses.Add($"合同含解约金 {Fmt(p.ReleaseClause)}（报价≥即强制放人）");
            bool willing = p.TeamId == null || p.Morale >= 45;
            string intent = willing ? (p.Morale >= 65 ? "本人意愿强烈，愿谈。" : "本人愿意接触。") : "本人倾向留队，需要更大诚意。";
            if (p.NoPoach && p.TeamId != null) clauses.Add("俱乐部明确表示非卖（noPoach）");
            if (p.PromisedRole == "core" && p.TeamId != null) clauses.Add("他是队内核心，挖角难度极高");
            q.Intent = intent + (clauses.Count > 0 ? "（" + string.Join("；", clauses) + "）" : "");
        }
        // 保留最近 20 条；完成超 30 天的清掉
        state.Inquiries = state.Inquiries.Where(q => !q.Done || state.Day - q.ResolveDay <= 30).ToList();
        if (state.Inquiries.Count > 20) state.Inquiries = state.Inquiries.GetRange(state.Inquiries.Count - 20, 20);
    }
}
