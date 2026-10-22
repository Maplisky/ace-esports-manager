using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;

namespace Kairo.Core;

public enum StartMode
{
    /// <summary>(a) 全自定义：原创队名 + 从自由池签 5 人 + 1 块空地</summary>
    Custom,
    /// <summary>(b) 接管改名：接手 t2 现成队（保留班底与预算），改为新队名</summary>
    Takeover,
    /// <summary>(c) 剧本弱旅：接手「欠薪」t2 队（预算削至 800K），班底不动</summary>
    Script,
}

/// <summary>开档配置（立项 §3.1 白手起家三选，2026-10-22 拍板：三选全开放）。</summary>
public sealed class StartConfig
{
    public StartMode Mode { get; set; } = StartMode.Script;
    /// <summary>(a) 新队名 / (b) 改名后的新名；(c) 忽略</summary>
    public string TeamName { get; set; } = "";
    /// <summary>(a) 加盟赛区（默认 americas）</summary>
    public string Region { get; set; } = "americas";
    /// <summary>(b/c) 接管目标队 id；null = 自动取全赛区预算最低的 t2 队</summary>
    public string? TakeoverTeamId { get; set; }
}

/// <summary>
/// 白手起家开档（GDD 开罗版立项 §3.1）：三选开局，全部以 t2 挑战者联赛起步、基地从零（1 块空地）。
/// 自由签约走内核语义（免转会费、按 overall 定薪）；新队加盟后须重建赛程（同 seed，新队进入对应挑战者联赛）。
/// 确定性：自由池排序 overall 降序 + id 升序裁决；零隐式 RNG。
/// </summary>
public static class NewGame
{
    public const string CustomTeamId = "H0";
    public const long CustomBudget = 5_000_000;
    public const long ScriptBudget = 800_000;
    public const int SquadSize = 5;

    /// <summary>执行开档；返回叙事日志。调用方须在 GenerateWorld + InitSeasonFixtures 之后调用（本方法会按需重建赛程）。</summary>
    public static List<string> Start(GameState state, StartConfig cfg)
    {
        var log = new List<string>();
        var myTeam = cfg.Mode switch
        {
            StartMode.Custom => CreateCustomTeam(state, cfg, log),
            StartMode.Takeover => Takeover(state, cfg, log),
            StartMode.Script => ScriptWeakSquad(state, cfg, log),
            _ => throw new ArgumentException($"unknown mode {cfg.Mode}"),
        };
        state.MyTeamId = myTeam.Id;
        state.Base = BaseOps.NewBase(); // 基地从零：1 块空地
        state.Day = 0;
        log.Add($"—— {myTeam.Name} · {myTeam.RegionId} 挑战者联赛 · 资金 ${myTeam.Budget / 1000}K · 基地 1 块空地 ——");
        return log;
    }

    private static Team CreateCustomTeam(GameState state, StartConfig cfg, List<string> log)
    {
        var name = string.IsNullOrWhiteSpace(cfg.TeamName) ? "我的战队" : cfg.TeamName.Trim();
        var team = new Team
        {
            Id = CustomTeamId,
            Name = name,
            Tag = name.Length >= 2 ? name[..2] : name,
            Tier = 2,
            RegionId = cfg.Region,
            Coach = new Coach { Name = "新任教练", Tactics = 45, Development = 48, Motivation = 45 },
            Budget = CustomBudget,
            Reputation = 30,
            Personality = "steady",
        };
        foreach (var m in CoreData.Maps) team.MapPref[m.Id] = 50;
        state.Teams.Add(team.Id, team); // 插入序尾部（新加盟）
        // 自由池签约：overall 降序 + id 裁决（确定性），签满 SquadSize
        var pool = state.Players.Values
            .Where(p => p.TeamId == null)
            .OrderByDescending(p => p.Overall)
            .ThenBy(p => p.Id, StringComparer.Ordinal)
            .Take(SquadSize)
            .ToList();
        foreach (var p in pool)
        {
            p.TeamId = team.Id;
            p.Salary = Worldgen.SalaryFor(p.Overall, 2);
            p.ContractYears = 2;
            p.PromisedRole = team.Roster.Count < 5 ? "starter" : "bench";
            p.Morale = 65;
            p.Career.Clubs.Add(team.Id);
            team.Roster.Add(p.Id);
        }
        team.Starters = team.Roster.Take(5).ToList();
        RebuildFixtures(state);
        log.Add($"原创战队「{name}」加盟 {cfg.Region} 挑战者联赛：从自由市场签下 {string.Join("、", pool.Select(p => $"{p.Ign}({p.Overall})"))}");
        return team;
    }

    private static Team Takeover(GameState state, StartConfig cfg, List<string> log)
    {
        var team = ResolveTakeoverTarget(state, cfg);
        if (!string.IsNullOrWhiteSpace(cfg.TeamName)) team.Name = cfg.TeamName.Trim();
        log.Add($"接管「{team.Name}」：保留原班底（{team.Roster.Count} 人）与预算，基地从零起步");
        return team;
    }

    private static Team ScriptWeakSquad(GameState state, StartConfig cfg, List<string> log)
    {
        var team = ResolveTakeoverTarget(state, cfg);
        team.Budget = ScriptBudget; // 欠薪剧本：资金削至 800K，班底不动
        log.Add($"剧本「欠薪弱旅」：接手 {team.Name}（账上仅 ${ScriptBudget / 1000}K），带队绝地翻身");
        return team;
    }

    private static Team ResolveTakeoverTarget(GameState state, StartConfig cfg)
    {
        if (cfg.TakeoverTeamId != null && state.Teams.TryGetValue(cfg.TakeoverTeamId, out var specified)) return specified;
        // 自动：全赛区预算最低的 t2 队（最弱接手位）；并列按 id 裁决
        return state.Teams.Values
            .Where(t => t.Tier == 2)
            .OrderBy(t => t.Budget)
            .ThenBy(t => t.Id, StringComparer.Ordinal)
            .First();
    }

    private static void RebuildFixtures(GameState state)
    {
        // 新队加盟后赛程须重建：清空后同 seed 重跑 initSeasonFixtures（确定性；仅开档期调用）
        state.Fixtures = new List<Fixture>();
        DaySim.InitSeasonFixtures(state);
    }
}
