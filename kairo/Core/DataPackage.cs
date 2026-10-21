using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Kairo.Core;

// 数据包模型（对应 kairo/Core.Data/*.json，由 ace/tools/export-data-package.mjs 导出）
public sealed class AgentDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public DutyVector Duty { get; set; } = new();
    public string[] UltTiers { get; set; } = System.Array.Empty<string>();
    public int UltCost { get; set; }
    public string[] MechTags { get; set; } = System.Array.Empty<string>();
    public string? NewUntilVersion { get; set; }
}

public sealed class MapDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Sites { get; set; }
    public double Openness { get; set; }
    public double Vertical { get; set; }
    public double Corridor { get; set; }
}

public sealed class VlrTeamStat
{
    public int VlrId { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Tag { get; set; } = "";
    public string Region { get; set; } = "";
    public string Country { get; set; } = "";
    public int Rank { get; set; }
    public int Rating { get; set; }
    public string? Logo { get; set; }
    public bool Partnered { get; set; }
    public VlrCoach? Coach { get; set; }
    public List<VlrStaff> Staff { get; set; } = new();
    public List<int> Roster { get; set; } = new();
}

public sealed class VlrCoach
{
    public string Alias { get; set; } = "";
    public string Real { get; set; } = "";
    public string Country { get; set; } = "";
    public string Avatar { get; set; } = "";
}

public sealed class VlrStaff
{
    public string Alias { get; set; } = "";
    public string Role { get; set; } = "";
    public string Avatar { get; set; } = "";
}

public sealed class VlrPlayerStat
{
    public int VlrId { get; set; }
    public int TeamVlrId { get; set; }
    public string Alias { get; set; } = "";
    public string Real { get; set; } = "";
    public string Country { get; set; } = "";
    public string? Avatar { get; set; }
    public bool Captain { get; set; }
    public List<VlrAgentStat> Stats { get; set; } = new();
}

public sealed class VlrAgentStat
{
    public string Agent { get; set; } = "";
    public int Maps { get; set; }
    public int Rounds { get; set; }
    public double Rating { get; set; }
    public double Acs { get; set; }
    public double Kd { get; set; }
    public double Kast { get; set; }
    public double Adr { get; set; }
    public double Kpr { get; set; }
    public double Apr { get; set; }
    public int Fk { get; set; }
    public int Fd { get; set; }
}

/// <summary>数据包装载（C# 只读，TS 仓库为唯一数据源）。</summary>
public static class DataPackage
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static (List<AgentDef> Agents, List<MapDef> Maps, List<VlrTeamStat> Teams, List<VlrPlayerStat> Players) Load(string dir)
    {
        var agents = JsonSerializer.Deserialize<List<AgentDef>>(File.ReadAllText(Path.Combine(dir, "agents.json")), JsonOpts)!;
        var maps = JsonSerializer.Deserialize<List<MapDef>>(File.ReadAllText(Path.Combine(dir, "maps.json")), JsonOpts)!;
        var teams = JsonSerializer.Deserialize<List<VlrTeamStat>>(File.ReadAllText(Path.Combine(dir, "real-teams.json")), JsonOpts)!;
        var players = JsonSerializer.Deserialize<List<VlrPlayerStat>>(File.ReadAllText(Path.Combine(dir, "real-players.json")), JsonOpts)!;
        return (agents, maps, teams, players);
    }
}
