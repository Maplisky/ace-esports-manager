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
            _loaded = true;
        }
    }

    public static AgentDef? Agent(string id) => AgentById.GetValueOrDefault(id);
}
