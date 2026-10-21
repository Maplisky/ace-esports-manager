using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 数据包运行时持有者（对应 TS 的 AGENTS/AGENT_BY_ID/MAPS/REAL_* 模块级常量）。
/// 模拟内核一律从此读取；Load 后不可变。
/// </summary>
public static class CoreData
{
    public static List<AgentDef> Agents { get; private set; } = new();
    public static List<MapDef> Maps { get; private set; } = new();
    public static List<VlrTeamStat> RealTeams { get; private set; } = new();
    public static Dictionary<int, VlrPlayerStat> RealPlayersByVlr { get; private set; } = new();
    public static Dictionary<string, AgentDef> AgentById { get; private set; } = new();
    public static Dictionary<string, MapDef> MapById { get; private set; } = new();

    /// <summary>大招就绪加成（GDD §5.4 v1.5 调参表；未知档位缺省 0.4）。</summary>
    public static readonly Dictionary<string, double> UltTierBonus = new()
    {
        ["core"] = 0.6, ["harvest"] = 0.5, ["combo"] = 0.5, ["utility"] = 0.4, ["info"] = 0.25,
    };

    /// <summary>大招所需点数（按特工区分；未知 id 缺省 7）。</summary>
    public static int UltCostOf(string agentId) => AgentById.TryGetValue(agentId, out var a) ? a.UltCost : 7;

    private static readonly object Gate = new();
    private static bool _loaded;

    public static void Load(string dataDir)
    {
        if (_loaded) return;
        lock (Gate)
        {
            if (_loaded) return;
            var (agents, maps, teams, players) = DataPackage.Load(dataDir);
            Agents = agents;
            Maps = maps;
            RealTeams = teams;
            RealPlayersByVlr = players.ToDictionary(p => p.VlrId);
            AgentById = agents.ToDictionary(a => a.Id);
            MapById = maps.ToDictionary(m => m.Id);
            _loaded = true;
        }
    }

    public static AgentDef? Agent(string id) => AgentById.GetValueOrDefault(id);
}
