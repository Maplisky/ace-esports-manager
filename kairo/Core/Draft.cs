using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 年度选秀（GDD §18-2，v1.0-4）— C# 移植自 ace/src/core/sim/draft.ts（权威实现）。
/// 按上赛季冠军积分倒序选人（弱队先拿 1 号签）；我的 t1 队收到选秀卡 7 选 1；
/// 选秀权交易（v1.0-8）：转会窗内买卖下届签位。
/// </summary>
public static class Draft
{
    public const string DraftCardId = "draft";
    public const int DraftOptions = 7;

    public static string DutyLabel(string duty) => duty switch
    {
        "duelist" => "决斗", "initiator" => "先锋", "controller" => "控场", "sentinel" => "哨卫",
        _ => "",
    };

    /// <summary>选手主位置：主职责英雄（agentPool 首位）的职责。</summary>
    public static string PositionOf(Player p)
    {
        var main = CoreData.AgentById.GetValueOrDefault(p.AgentPool.Count > 0 ? p.AgentPool[0] : "");
        return main != null ? Worldgen.PrimaryDuty(main.Duty) : "duelist";
    }

    /// <summary>队伍对该新秀的需求评分：潜力 0.6 + 即战力 0.4 + 位置缺口 +8。</summary>
    private static double ScoreOf(GameState state, Team team, Player p)
    {
        string pos = PositionOf(p);
        int count = team.Roster.Concat(team.Academy)
            .Select(pid => state.Players.TryGetValue(pid, out var q) ? q : null)
            .Count(q => q != null && PositionOf(q!) == pos);
        return p.Potential * 0.6 + p.Overall * 0.4 + (count < 2 ? 8 : 0);
    }

    /// <summary>新秀签约入队：18 岁且一线有空位 → roster；否则入青训营。</summary>
    private static bool SignRookie(GameState state, Team team, Player p)
    {
        p.TeamId = team.Id;
        p.ContractYears = 3; // 新秀合同 3 年
        p.Salary = (int)DetMath.JsRound(Worldgen.SalaryFor(p.Overall, 1) * 0.55); // 新秀折扣价
        p.Morale = 72;
        if (p.Age >= 18 && team.Roster.Count < 7)
        {
            team.Roster.Add(p.Id);
            p.PromisedRole = "bench";
        }
        else
        {
            team.Academy.Add(p.Id);
        }
        return team.Roster.Contains(p.Id);
    }

    /// <summary>基础顺位：t1 按冠军积分升序（战绩越差顺位越靠前），平手按队 id 序。</summary>
    private static List<Team> BaseOrderOf(GameState state)
    {
        return state.Teams.Values
            .Where(t => t.Tier == 1)
            .OrderBy(t => state.CircuitPoints.TryGetValue(t.Id, out var v) ? v : 0)
            .ThenBy(t => string.CompareOrdinal(t.Id, "0") >= 0 ? t.Id : t.Id)
            .ToList();
    }

    /// <summary>应用选秀权交易后的实际签位归属（每条 move 把 from 的一个签位转给 to）。</summary>
    public static List<string> ResolveDraftSlots(GameState state)
    {
        var slots = BaseOrderOf(state).Select(t => t.Id).ToList();
        foreach (var mv in state.DraftPickMoves)
        {
            int idx = slots.IndexOf(mv.From);
            if (idx >= 0) slots[idx] = mv.To;
        }
        return slots;
    }

    /// <summary>签位估值：1 号签 $500K 起，每顺位 −$25K，地板 $120K。</summary>
    public static int DraftPickValue(int pickNo) =>
        (int)Math.Max(120_000, 500_000 - (Math.Max(1, pickNo) - 1) * 25_000);

    public sealed class PickInfo
    {
        public int MySlots;
        public int? MyProjected;
        public int? SellPrice;
        public (string TeamId, int SlotNo, int Price)? BuyOffer;
        public bool WindowOpen;
    }

    /// <summary>选秀权行情（UI 卡）：我方持签数/预计顺位/卖出价/可买进的最高顺位报价。</summary>
    public static PickInfo DraftPickInfo(GameState state)
    {
        var slots = ResolveDraftSlots(state);
        var counts = new OrderedDict<string, int>();
        foreach (var id in slots) counts[id] = (counts.TryGetValue(id, out var c) ? c : 0) + 1;
        string myId = state.MyTeamId ?? "";
        int myIdx = slots.IndexOf(myId);
        int mySlots = counts.TryGetValue(myId, out var mc) ? mc : 0;
        int? sellPrice = mySlots > 0 && myIdx >= 0 ? (int)DetMath.JsRound(DraftPickValue(myIdx + 1) * 0.9) : null;
        (string, int, int)? buyOffer = null;
        if (mySlots < 3)
        {
            for (int i = 0; i < Math.Min(8, slots.Count); i++)
            {
                string owner = slots[i];
                if (owner == myId || (counts.TryGetValue(owner, out var oc) ? oc : 0) > 1) continue;
                buyOffer = (owner, i + 1, (int)DetMath.JsRound(DraftPickValue(i + 1) * 1.15));
                break;
            }
        }
        return new PickInfo
        {
            MySlots = mySlots,
            MyProjected = myIdx >= 0 ? myIdx + 1 : null,
            SellPrice = sellPrice,
            BuyOffer = buyOffer,
            WindowOpen = Transfer.InTransferWindow(state.Day),
        };
    }

    /// <summary>选秀权交易（转会窗内买卖下届签位——豪门「未来换现在」）。</summary>
    public static string DraftPickTrade(GameState state, string action, List<NewsItem> notes)
    {
        var my = MyTeam(state);
        if (my == null) return "我队已不存在。";
        if (!Transfer.InTransferWindow(state.Day)) return "选秀权交易只在转会窗内开放（季前/赛中/休赛期）。";
        state.DraftPickMoves ??= new List<DraftPickMove>();
        var slots = ResolveDraftSlots(state);
        var counts = new OrderedDict<string, int>();
        foreach (var id in slots) counts[id] = (counts.TryGetValue(id, out var c) ? c : 0) + 1;
        static string Fmt(int n) => "$" + n.ToString("N0", new CultureInfo("en-US"));

        if (action == "sell")
        {
            int myIdx = slots.IndexOf(my.Id);
            if (myIdx < 0) return "我队已没有可卖的选秀权。";
            // 接盘方：顺位靠后（战绩较好）且持签 ≤1 的 t1 队
            var buyer = BaseOrderOf(state)
                .AsEnumerable()
                .Reverse()
                .FirstOrDefault(t => t.Id != my.Id
                    && (counts.TryGetValue(t.Id, out var bc) ? bc : 0) >= 1
                    && bc < 2
                    && t.Budget >= DraftPickValue(myIdx + 1));
            if (buyer == null) return "没有球队愿意接手这个选秀权。";
            int price = (int)DetMath.JsRound(DraftPickValue(myIdx + 1) * 0.9);
            state.DraftPickMoves.Add(new DraftPickMove { From = my.Id, To = buyer.Id });
            my.Budget += price;
            buyer.Budget -= price;
            Finance.LogFinance(state, $"选秀权出售（预计第 {myIdx + 1} 顺位）", price);
            notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"🗳 {my.Name} 将下届选秀权出售给 {buyer.Name}，入账 {Fmt(price)}（未来换现在）。" });
            return $"已将下届选秀权（预计第 {myIdx + 1} 顺位）出售给 {buyer.Name}，入账 {Fmt(price)}。";
        }

        if ((counts.TryGetValue(my.Id, out var myCount) ? myCount : 0) >= 3)
            return "联盟规则：单队最多持有 3 个选秀签。";
        var info = DraftPickInfo(state);
        if (info.BuyOffer == null) return "市场上没有可买进的选秀权。";
        var seller = state.Teams.GetValueOrDefault(info.BuyOffer.Value.TeamId);
        if (seller == null) return "卖家已不存在。";
        if (my.Budget < info.BuyOffer.Value.Price) return $"资金不足：该签要价 {Fmt(info.BuyOffer.Value.Price)}。";
        state.DraftPickMoves.Add(new DraftPickMove { From = info.BuyOffer.Value.TeamId, To = my.Id });
        my.Budget -= info.BuyOffer.Value.Price;
        seller.Budget += info.BuyOffer.Value.Price;
        Finance.LogFinance(state, $"选秀权买进（预计第 {info.BuyOffer.Value.SlotNo} 顺位）", -info.BuyOffer.Value.Price);
        notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"🗳 {my.Name} 从 {seller.Name} 买入选秀权（预计第 {info.BuyOffer.Value.SlotNo} 顺位），支付 {Fmt(info.BuyOffer.Value.Price)}。" });
        return $"从 {seller.Name} 买入选秀权（预计第 {info.BuyOffer.Value.SlotNo} 顺位），支付 {Fmt(info.BuyOffer.Value.Price)}。";
    }

    private static Team? MyTeam(GameState state) =>
        state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;

    /// <summary>选秀日主流程（确定性独立 rng 流 = hash(seed:draft:year)）。</summary>
    public static void RunDraft(GameState state, List<NewsItem> notes)
    {
        var rng = new Rng(Rng.HashString($"{state.Seed}:draft:{state.Year}"));
        var order = ResolveDraftSlots(state)
            .Select(id => state.Teams.TryGetValue(id, out var t) ? t : null)
            .Where(t => t != null)
            .Cast<Team>()
            .ToList();
        state.DraftPickMoves = new List<DraftPickMove>();
        if (order.Count == 0) return;
        // 新秀池：每队 1 签 + 40% 富余（落选者进自由市场）
        var pool = Worldgen.SpawnRookieClass(state, rng, order.Count + (int)Math.Round(order.Count * 0.4));
        var taken = new HashSet<string>();
        var picks = new List<DraftPickRow>();
        string? myId = state.MyTeamId;
        int pickNo = 0;
        var myCards = new List<PendingEventCard>();

        foreach (var team in order)
        {
            bool capacity = team.Roster.Count + team.Academy.Count < 10; // 员额上限：满员队弃权
            if (team.Id == myId)
            {
                // 我的签：冻结按我队视角推荐前 N（AI 不可截胡）
                var ranked = pool
                    .Where(p => !taken.Contains(p.Id))
                    .OrderByDescending(p => ScoreOf(state, team, p)) // 稳定序
                    .ThenBy(p => p.Id)
                    .ToList();
                var frozen = ranked.Take(DraftOptions).ToList();
                foreach (var p in frozen) taken.Add(p.Id); // 冻结 = 暂离池
                var card = new PendingEventCard
                {
                    Uid = $"draft-{state.Year}-{pickNo}",
                    CardId = DraftCardId,
                    Title = $"🎯 {state.Year} 年度选秀 · 第 {pickNo + 1} 顺位",
                    Text = $"联盟新秀选秀大会：{(state.Teams.TryGetValue(myId!, out var mt) ? mt.Name : "我队")} 手握第 {pickNo + 1} 顺位。以下是球探部按阵容缺口与潜力给出的推荐名单（其余新秀已各归其主）。",
                    Negative = false,
                    Day = state.Day,
                };
                foreach (var p in frozen)
                {
                    card.Options.Add(new PendingEventOption
                    {
                        Label = $"{p.Ign}（{DutyLabel(PositionOf(p))} · {p.Age} 岁 · {p.Overall}/{p.Potential}）",
                        Result = $"欢迎 {p.Ign}！",
                    });
                }
                card.Options.Add(new PendingEventOption { Label = "放弃本签（名单已满/无人看中）", Result = "我队放弃本次选秀权。" });
                card.Payload = new OrderedDict<string, object>
                {
                    ["pickNo"] = pickNo + 1,
                    ["playerIds"] = frozen.Select(p => p.Id).ToList(),
                };
                myCards.Add(card);
                picks.Add(new DraftPickRow { PickNo = pickNo + 1, TeamId = myId ?? "", PlayerId = "" }); // 我队签位占位（决策后补记）
                pickNo++;
                continue;
            }
            if (!capacity) continue; // 满员队跳过（弃权）
            var rankedAi = pool
                .Where(p => !taken.Contains(p.Id))
                .OrderByDescending(p => ScoreOf(state, team, p)) // 稳定序
                .ThenBy(p => p.Id)
                .ToList();
            if (rankedAi.Count == 0) break; // 池空
            var choice = rankedAi[0];
            taken.Add(choice.Id);
            SignRookie(state, team, choice);
            picks.Add(new DraftPickRow { PickNo = pickNo + 1, TeamId = team.Id, PlayerId = choice.Id });
            if (pickNo == 0)
            {
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Important = true, Text = $"🎯 {state.Year} 选秀大会开幕：{team.Name} 用 1 号签选中 {choice.Ign}（{DutyLabel(PositionOf(choice))}，{choice.Age} 岁，潜力 {choice.Potential}）。" });
            }
            else if (choice.Potential >= 88)
            {
                notes.Add(new NewsItem { Day = state.Day, Kind = "transfer", Text = $"👀 {team.Name} 在第 {pickNo + 1} 顺位捡到高潜新秀 {choice.Ign}（潜力 {choice.Potential}）。" });
            }
            pickNo++;
        }

        // 落选新秀 → 自由市场（teamId 保持 null 即入池）
        state.LastDraft = new LastDraftRecord { Year = state.Year, Picks = picks };
        foreach (var c in myCards) state.PendingEvents.Add(c); // 多签多卡
        notes.Add(new NewsItem
        {
            Day = state.Day, Kind = "transfer",
            Text = $"🎯 {state.Year} 年度选秀落幕：共 {picks.Count(x => x.PlayerId.Length > 0)} 支签位兑现，落选新秀进入自由市场。",
        });
    }

    /// <summary>选秀卡结算（7 选 1 签入我队，或放弃——冻结新秀回归自由市场）。</summary>
    public static (string Result, string Note) ResolveDraftCard(GameState state, PendingEventCard card, int optionIndex)
    {
        int? pickNo = null;
        var playerIds = new List<string>();
        if (card.Payload != null)
        {
            if (card.Payload.TryGetValue("pickNo", out var pn) && pn is int i) pickNo = i;
            if (card.Payload.TryGetValue("playerIds", out var pl) && pl is List<string> ls) playerIds = ls;
        }
        var mine = MyTeam(state);
        if (mine == null) return ("我队已不存在，选秀权作废。", "");
        if (optionIndex >= 0 && optionIndex < playerIds.Count)
        {
            var p = state.Players.GetValueOrDefault(playerIds[optionIndex]);
            if (p != null && p.TeamId == null)
            {
                bool toFirst = SignRookie(state, mine, p);
                // 补记选秀留档（我队占位行）
                var row = state.LastDraft?.Picks.Find(x => x.TeamId == mine.Id && x.PlayerId.Length == 0);
                if (row != null) row.PlayerId = p.Id;
                return (
                    $"🎯 我队用第 {pickNo?.ToString() ?? "?"} 号签选中 {p.Ign}（{DutyLabel(PositionOf(p))}，{p.Age} 岁，{p.Overall}/{p.Potential}）{(toFirst ? "，直接进入一线名单。" : "，先入青训营培养。")}",
                    $"选中新秀 {p.Ign}");
            }
            return ($"{p?.Ign ?? "该新秀"}已被其它队捷足先登。", "");
        }
        return ("我队放弃本次选秀权，冻结名单中的新秀回归自由市场。", "放弃选秀签");
    }
}
