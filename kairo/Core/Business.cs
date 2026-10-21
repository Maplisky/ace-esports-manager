using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 商务系统 v1（GDD §8.4）— C# 移植自 ace/src/core/sim/business.ts（权威实现）。
/// 赞助（三档/声望门槛/业绩条款）· 商务日（选手层）· 直播合同（60/40 分成）。
/// </summary>
public static class Business
{
    public sealed class TierDef
    {
        public int Tier;
        public string Name = "";
        public int Min, Max, RepNeed;
    }

    public static readonly TierDef[] TierDefs =
    {
        new() { Tier = 1, Name = "地方品牌", Min = 80_000, Max = 150_000, RepNeed = 45 },
        new() { Tier = 2, Name = "国民品牌", Min = 200_000, Max = 300_000, RepNeed = 60 },
        new() { Tier = 3, Name = "国际品牌", Min = 350_000, Max = 450_000, RepNeed = 75 },
    };

    private static readonly string[] BrandsT1 = { "晨光乳业", "飞毛腿快递", "街角咖啡", "雷霆文具", "滨江健身房" };
    private static readonly string[] BrandsT2 = { "星火运动", "长城汽车", "云杉银行", "银河电子", "巨浪饮料" };
    private static readonly string[] BrandsT3 = { "HyperTech", "VoltEnergy", "ApexAir", "NovaTel" };
    private static readonly string[] GigBrands = { "星火运动", "闪电外设", "锐魄饮料", "极风体育", "晨风能源" };

    private static int SponsorSlotsFor(int reputation) =>
        reputation >= 60 ? 4 : reputation >= 35 ? 3 : 2;

    private static Team? MyTeam(GameState state) =>
        state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t : null;

    /// <summary>生成 1-2 条赞助意向（档位按声望门槛过滤）+ 过期清理。</summary>
    private static void RefreshSponsorOffers(GameState state, Rng rng)
    {
        var myTeam = MyTeam(state);
        if (myTeam == null) return;
        int slots = SponsorSlotsFor(myTeam.Reputation);
        int open = slots - myTeam.Sponsors.Count;
        if (open <= 0) return;
        var pool = TierDefs.Where(t => myTeam.Reputation >= t.RepNeed).ToList();
        if (pool.Count == 0) return;
        int count = Math.Min(open, rng.Int(1, 2));
        for (int i = 0; i < count; i++)
        {
            var def = rng.Pick(pool);
            int perSeason = (int)(DetMath.JsRound(rng.Range(def.Min, def.Max) / 1000) * 1000);
            var brands = def.Tier == 1 ? BrandsT1 : def.Tier == 2 ? BrandsT2 : BrandsT3;
            state.SponsorOffers.Add(new SponsorOffer
            {
                Id = $"SP{state.Year}_{state.Day}_{i}_{rng.Int(100, 999)}",
                Name = rng.Pick(brands),
                Tier = def.Tier,
                PerSeason = perSeason,
                Years = rng.Int(1, 2),
                SignedYear = state.Year,
                Expires = state.Day + 21,
            });
        }
        state.SponsorOffers = state.SponsorOffers.Where(o => o.Expires > state.Day).ToList();
    }

    /// <summary>签约成功率：声望档位差 + 商务技能 + 商务经理 − 同档竞品。</summary>
    public static double SponsorSignChance(GameState state, int tier)
    {
        var myTeam = MyTeam(state);
        int rep = myTeam?.Reputation ?? 40;
        var def = TierDefs.First(t => t.Tier == tier);
        double bizSkill = state.Manager?.Skills.Business ?? 50;
        double bizManager = 0; // v0.5-5 教练组接入后由商务经理提供
        int need = def.RepNeed;
        int sameTierCount = (myTeam?.Sponsors ?? new List<Sponsor>()).Count(s => s.Tier == tier);
        return Math.Min(0.9, Math.Max(0.1, 0.3 + (rep - need) * 0.01 + bizSkill * 0.005 + bizManager * 0.002 - sameTierCount * 0.05));
    }

    /// <summary>签约（检定通过后调用）：写档 + 意向消费（标准业绩条款）。</summary>
    public static (bool Ok, string Text) SignSponsorOffer(GameState state, SponsorOffer offer, Rng rng)
    {
        var myTeam = MyTeam(state);
        if (myTeam == null) return (false, "无俱乐部。");
        if (offer.Expires <= state.Day) return (false, "该赞助意向已过期。");
        if (myTeam.Sponsors.Count >= SponsorSlotsFor(myTeam.Reputation)) return (false, "赞助栏位已满。");
        double chance = SponsorSignChance(state, offer.Tier);
        if (!rng.Chance(chance)) return (false, $"{offer.Name} 婉拒了合作（态度 + 档位门槛）。");
        var sponsor = new Sponsor
        {
            Id = offer.Id, Name = offer.Name, Tier = offer.Tier, PerSeason = offer.PerSeason,
            Years = offer.Years, SignedYear = state.Year, Bonus = true, // 标准业绩条款（§8.4 v1.4）
        };
        myTeam.Sponsors.Add(sponsor);
        state.SponsorOffers = state.SponsorOffers.Where(o => o.Id != offer.Id).ToList(); // 签成即消费
        return (true, $"与 {offer.Name} 签下 {offer.Years} 年赞助（{FmtMoney(sponsor.PerSeason)}/赛季，含业绩条款：联赛四强 +20% / 夺冠 +50%），周收入即刻生效。");
    }

    public static string CancelSponsorById(GameState state, string sponsorId)
    {
        var myTeam = MyTeam(state);
        if (myTeam == null) return "无俱乐部。";
        int idx = myTeam.Sponsors.FindIndex(s => s.Id == sponsorId);
        if (idx < 0) return "找不到该赞助。";
        var s = myTeam.Sponsors[idx];
        myTeam.Sponsors.RemoveAt(idx);
        myTeam.Reputation = (int)Math.Min(99, Math.Max(20, myTeam.Reputation - 2));
        return $"与 {s.Name} 解约（声望 -2）。";
    }

    /// <summary>周收入：赞助 perSeason/48（带业绩条款者 ×联赛倍率）+ 直播俱乐部 40%（另 60% 入选手钱包）。</summary>
    public static int WeeklySponsorIncome(GameState state)
    {
        var myTeam = MyTeam(state);
        if (myTeam == null) return 0;
        double income = 0;
        double mult = state.SponsorMult ?? 1;
        foreach (var s in myTeam.Sponsors)
            income += (int)DetMath.JsRound(s.PerSeason / 48.0 * (s.Bonus == false ? 1 : mult));
        foreach (var pid in myTeam.Roster)
        {
            if (!state.Players.TryGetValue(pid, out var p) || p.Stream == null || p.Stream.UntilDay <= state.Day) continue;
            income += (int)DetMath.JsRound(p.Stream.Weekly * 0.4);
            p.Wallet += (int)DetMath.JsRound(p.Stream.Weekly * 0.6); // 选手 60% 分成
            p.Popularity = (int)Math.Min(100, Math.Max(0, (p.Popularity ?? 0) + 2)); // 人气值随直播上涨
        }
        return (int)income;
    }

    private static string FmtMoney(int v) =>
        v >= 1_000_000 ? $"${DetMath.ToFixed2(v / 1_000_000.0)}M" : $"${(int)DetMath.JsRound(v / 1000.0)}K";

    /// <summary>接受选手商务邀约：进账 + 占 1 个训练日（人气值加成报酬）。</summary>
    public static (bool Ok, string Text) AcceptGig(GameState state, string gigId)
    {
        int idx = state.GigOffers.FindIndex(g => g.Id == gigId);
        if (idx < 0) return (false, "邀约已过期。");
        var gig = state.GigOffers[idx];
        if (!state.Players.TryGetValue(gig.PlayerId, out var p) || p.TeamId != state.MyTeamId) return (false, "选手已不在阵中。");
        state.GigOffers.RemoveAt(idx);
        var myTeam = MyTeam(state);
        int pay = (int)DetMath.JsRound(gig.Pay * (1 + (p.Popularity ?? 0) * 0.002));
        if (myTeam != null) myTeam.Budget += pay;
        Finance.LogFinance(state, $"商务活动 · {gig.Brand}（{p.Ign}）", pay);
        p.CommercialDays += 1;
        string text = $"{p.Ign} 出席 {gig.Brand} 活动：+{FmtMoney(pay)}（本周训练日 -1{((p.Popularity ?? 0) >= 30 ? " · 人气加成" : "")}）。";
        return (true, text);
    }

    public static void DeclineGig(GameState state, string gigId)
    {
        state.GigOffers = state.GigOffers.Where(g => g.Id != gigId).ToList();
    }

    /// <summary>选手直播合同（2-3 个月）：俱乐部 40%，选手 60% 入个人钱包；每周占 1 训练日。</summary>
    public static (bool Ok, string Text) SignStream(GameState state, string playerId, int months, Rng rng)
    {
        if (!state.Players.TryGetValue(playerId, out var p)) return (false, "找不到选手。");
        if (p.Stream != null && p.Stream.UntilDay > state.Day) return (false, $"{p.Ign} 已有直播合同在身。");
        int weekly = (int)(DetMath.JsRound((1200 + p.Overall * 60) * rng.Range(0.8, 1.3) / 100) * 100);
        p.Stream = new StreamContract { Weekly = weekly, UntilDay = state.Day + months * 30 };
        p.Popularity = (int)Math.Min(100, Math.Max(0, (p.Popularity ?? 0) + 5));
        return (true, $"{p.Ign} 签下直播合同：周收入 {FmtMoney(weekly)}（选手 60% 入个人钱包 / 俱乐部 40%），每周占 1 个训练日，人气 +5。");
    }

    public static string CancelStream(GameState state, string playerId)
    {
        if (!state.Players.TryGetValue(playerId, out var p) || p.Stream == null) return "无直播合同。";
        p.Stream = null;
        return $"{p.Ign} 的直播合同已终止。";
    }

    /// <summary>每周商务刷新：邀约 0-3 条 + 赞助意向 + 商务占用清零（周结算末尾调用）。</summary>
    public static void RefreshCommercialWeek(GameState state, Rng rng)
    {
        var myTeam = MyTeam(state);
        if (myTeam == null) return;
        foreach (var pid in myTeam.Roster)
        {
            if (state.Players.TryGetValue(pid, out var p)) p.CommercialDays = 0;
        }
        state.GigOffers = state.GigOffers.Where(g => state.Day - g.Day <= 7).ToList();
        int gigCount = rng.Int(0, 3);
        for (int i = 0; i < gigCount; i++)
        {
            var pid = rng.Pick(myTeam.Roster);
            if (!state.Players.TryGetValue(pid, out var p) || p.InjuredUntilDay > state.Day) continue;
            string brand = rng.Pick(GigBrands);
            state.GigOffers.Add(new GigOffer
            {
                Id = $"GIG{state.Day}_{p.Id}_{i}",
                PlayerId = p.Id,
                Brand = brand,
                Pay = (int)(DetMath.JsRound(rng.Range(2_000, 15_000) * (1 + (state.Manager?.Skills.Business ?? 50) * 0.004) / 100) * 100),
                Day = state.Day,
            });
        }
        int slots = SponsorSlotsFor(myTeam.Reputation);
        if (myTeam.Sponsors.Count < slots && rng.Chance(0.5))
        {
            RefreshSponsorOffers(state, rng);
        }
    }
}
