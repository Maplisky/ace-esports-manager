using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>
/// 回放分享（v1.0-12，GDD §9.4）：MatchRecord + 最小队伍/选手投影 → 压缩编码 → URL hash。
/// 匿名化开关（§14）：真实选手名/队名 → 确定性生成名。
/// 链接只读既有 Record——不重模拟、不触碰 RNG（回放红线）。
/// TS 权威：ace/src/core/sim/share.ts；deflate 字节依平台实现而异，跨端只保证可互解。
/// </summary>
public static class Share
{
    public sealed class ReplaySide
    {
        public string Tag { get; set; } = "";
        public string Name { get; set; } = "";
        public List<string> Roster { get; set; } = new();
    }

    public sealed class ReplayPayload
    {
        public MatchRecord Rec { get; set; } = new();
        public ReplaySide A { get; set; } = new();
        public ReplaySide B { get; set; } = new();
        /// <summary>插入序 = 首次出现在 lines 的选手序</summary>
        public OrderedDict<string, string> Players { get; set; } = new();
    }

    /// <summary>从存档世界提取回放最小投影（播放器渲染所需：队徽信息 + 选手名）。</summary>
    public static ReplayPayload BuildReplayPayload(GameState state, MatchRecord rec)
    {
        var payload = new ReplayPayload { Rec = rec };
        foreach (var (side, teamId) in new[] { ("A", rec.TeamA), ("B", rec.TeamB) })
        {
            if (!state.Teams.TryGetValue(teamId, out var t)) continue;
            var s = side == "A" ? payload.A : payload.B;
            s.Tag = t.Tag;
            s.Name = t.Name;
            s.Roster = t.Roster.ToList();
        }
        foreach (var m in rec.Maps)
        {
            foreach (var pid in m.Lines.Keys)
            {
                if (!payload.Players.ContainsKey(pid))
                    payload.Players[pid] = state.Players.TryGetValue(pid, out var p) ? p.Ign : pid;
            }
        }
        return payload;
    }

    private static readonly string[] AnonSur = { "岚", "霜", "星", "烬", "潮", "曜", "弦", "岩", "雾", "澈", "凛", "翎" };
    private static readonly string[] AnonGiven = { "Zero", "Vex", "Kite", "Onyx", "Rune", "Fable", "Echo", "Nova", "Pike", "Wren", "Jolt", "Saga" };
    private static readonly string[] AnonTeam = { "北辰", "白鲸", "赤霄", "苍梧", "晚枫", "断云", "孤峰", "远雷", "寒鸦", "平湖", "青崖", "细雨" };

    /// <summary>确定性匿名名：同 id 永远同名（多次导出可对照）。</summary>
    private static string AnonIgn(string pid, int i)
    {
        uint h = Rng.HashString(pid);
        return $"{AnonSur[h % AnonSur.Length]}{AnonGiven[(h >> 7) % AnonGiven.Length]}{(i > 0 ? i.ToString() : "")}";
    }

    /// <summary>匿名化载荷：选手名→生成名、队名→虚构、保留 id/结构（回放渲染不变）。</summary>
    public static ReplayPayload AnonymizeReplay(ReplayPayload p)
    {
        var alias = new OrderedDict<string, string>();
        var pids = p.Players.Keys.OrderBy(x => x, StringComparer.Ordinal).ToList();
        for (int i = 0; i < pids.Count; i++)
            alias[pids[i]] = AnonIgn(pids[i], (int)Math.Floor(i / (double)(AnonSur.Length * AnonGiven.Length)));
        var players = new OrderedDict<string, string>();
        foreach (var pid in pids) players[pid] = alias[pid];
        return new ReplayPayload
        {
            Rec = p.Rec,
            A = new ReplaySide { Tag = AnonTeam[Rng.HashString(p.A.Name) % AnonTeam.Length], Name = "匿名战队 A", Roster = p.A.Roster.ToList() },
            B = new ReplaySide { Tag = AnonTeam[Rng.HashString(p.B.Name) % AnonTeam.Length], Name = "匿名战队 B", Roster = p.B.Roster.ToList() },
            Players = players,
        };
    }

    private static string B64Url(byte[] bytes)
    {
        string b64 = Convert.ToBase64String(bytes);
        return b64.Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static byte[] B64UrlDecode(string text)
    {
        string norm = text.Replace('-', '+').Replace('_', '/');
        int pad = (4 - norm.Length % 4) % 4;
        return Convert.FromBase64String(norm + new string('=', pad));
    }

    /// <summary>编码：deflate（zlib 包裹，对齐 Web CompressionStream "deflate"）+ base64url（前缀 1）。
    /// 解码端兼容前缀 0（明文 UTF-8）——TS 无压缩环境的回退格式。</summary>
    public static string EncodeReplay(ReplayPayload p)
    {
        string json = JsonOf(p).ToJsonString();
        byte[] bytes;
        using (var ms = new MemoryStream())
        {
            using (var zlib = new ZLibStream(ms, CompressionLevel.Optimal, leaveOpen: true))
            using (var writer = new StreamWriter(zlib, new UTF8Encoding(false)))
            {
                writer.Write(json);
            }
            bytes = ms.ToArray();
        }
        return "1" + B64Url(bytes);
    }

    /// <summary>解码（前缀 1 = deflate / 0 = 明文 UTF-8）；结构校验失败返回 null。</summary>
    public static ReplayPayload? DecodeReplay(string code)
    {
        try
        {
            if (string.IsNullOrEmpty(code) || (code[0] != '0' && code[0] != '1')) return null;
            byte[] bytes = B64UrlDecode(code.Substring(1));
            string json;
            if (code[0] == '1')
            {
                using var ms = new MemoryStream(bytes);
                using var zlib = new ZLibStream(ms, CompressionMode.Decompress);
                using var reader = new StreamReader(zlib, new UTF8Encoding(false));
                json = reader.ReadToEnd();
            }
            else
            {
                json = Encoding.UTF8.GetString(bytes);
            }
            if (string.IsNullOrEmpty(json)) return null;
            var node = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject;
            if (node == null) return null;
            if (node["v"]?.GetValue<int>() != 1 || node["rec"] == null || node["teams"]?["A"] == null || node["teams"]?["B"] == null) return null;
            if (node["players"] is not System.Text.Json.Nodes.JsonObject) return null;
            var recNode = node["rec"]!;
            var scoreArr = recNode["score"] as System.Text.Json.Nodes.JsonArray;
            return new ReplayPayload
            {
                Rec = new MatchRecord
                {
                    Id = recNode["id"]?.GetValue<string>() ?? "",
                    Seed = recNode["seed"]?.GetValue<long>() ?? 0,
                    Format = recNode["format"]?.GetValue<int>() ?? 3,
                    TeamA = recNode["teamA"]?.GetValue<string>() ?? "",
                    TeamB = recNode["teamB"]?.GetValue<string>() ?? "",
                    Stage = recNode["stage"]?.GetValue<string>() ?? "",
                    Day = recNode["day"]?.GetValue<int>() ?? 0,
                    Winner = recNode["winner"]?.GetValue<string>() ?? "A",
                    ScoreA = scoreArr != null && scoreArr.Count > 0 ? scoreArr[0]!.GetValue<int>() : 0,
                    ScoreB = scoreArr != null && scoreArr.Count > 1 ? scoreArr[1]!.GetValue<int>() : 0,
                },
                A = SideOf(node["teams"]!["A"]),
                B = SideOf(node["teams"]!["B"]),
                Players = NodeToPlayers(node["players"]!),
            };
        }
        catch
        {
            return null;
        }
    }

    private static System.Text.Json.Nodes.JsonObject JsonOf(ReplayPayload p) => new()
    {
        ["v"] = 1,
        ["rec"] = new System.Text.Json.Nodes.JsonObject
        {
            ["id"] = p.Rec.Id,
            ["seed"] = p.Rec.Seed,
            ["format"] = p.Rec.Format,
            ["teamA"] = p.Rec.TeamA,
            ["teamB"] = p.Rec.TeamB,
            ["stage"] = p.Rec.Stage,
            ["day"] = p.Rec.Day,
            ["winner"] = p.Rec.Winner,
            ["score"] = new System.Text.Json.Nodes.JsonArray(p.Rec.ScoreA, p.Rec.ScoreB),
        },
        ["teams"] = new System.Text.Json.Nodes.JsonObject
        {
            ["A"] = new System.Text.Json.Nodes.JsonObject { ["tag"] = p.A.Tag, ["name"] = p.A.Name, ["roster"] = new System.Text.Json.Nodes.JsonArray(p.A.Roster.Select(r => (System.Text.Json.Nodes.JsonNode)r).ToArray()) },
            ["B"] = new System.Text.Json.Nodes.JsonObject { ["tag"] = p.B.Tag, ["name"] = p.B.Name, ["roster"] = new System.Text.Json.Nodes.JsonArray(p.B.Roster.Select(r => (System.Text.Json.Nodes.JsonNode)r).ToArray()) },
        },
        ["players"] = new System.Text.Json.Nodes.JsonObject(p.Players.Select(kv => new KeyValuePair<string, System.Text.Json.Nodes.JsonNode?>(kv.Key, kv.Value))),
    };

    private static ReplaySide SideOf(System.Text.Json.Nodes.JsonNode? n) => new()
    {
        Tag = n?["tag"]?.GetValue<string>() ?? "",
        Name = n?["name"]?.GetValue<string>() ?? "",
        Roster = (n?["roster"] as System.Text.Json.Nodes.JsonArray)?.Select(x => x!.GetValue<string>()).ToList() ?? new List<string>(),
    };

    private static OrderedDict<string, string> NodeToPlayers(System.Text.Json.Nodes.JsonNode n)
    {
        var players = new OrderedDict<string, string>();
        if (n is System.Text.Json.Nodes.JsonObject obj)
        {
            foreach (var kv in obj) players[kv.Key] = kv.Value?.GetValue<string>() ?? "";
        }
        return players;
    }

    /// <summary>完整分享 URL（hash 承载；CS 侧由宿主传 origin/path——无浏览器 location）。</summary>
    public static string ReplayUrl(string origin, string path, string code) => $"{origin}{path}#replay={code}";
}
