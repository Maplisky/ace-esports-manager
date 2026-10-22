using System;
using System.Collections.Generic;
using System.Linq;
using Kairo.Core;

namespace Kairo.Core;

/// <summary>回放演出事件（时间轴秒）：演出层只消费、不产生比赛事实（§3.5 红线）。</summary>
public sealed class ReplayEvent
{
    public float T { get; init; }
    /// <summary>round_start/kill/plant/defuse/ult/clutch/ace/round_win/map_end/flawless</summary>
    public string Kind { get; init; } = "";
    /// <summary>事件主体队（kill=击杀方 / round_win=胜方；A/B）</summary>
    public string Side { get; init; } = "";
    /// <summary>主体（击杀者 pid / 回合号）；kill 事件填序号 0-9（A0-4 → 0-4，B0-4 → 5-9）</summary>
    public int A { get; init; }
    /// <summary>kill=受害者序号；其余 0</summary>
    public int B { get; init; }
    /// <summary>播报文本（爆头/残局/回合标题等）</summary>
    public string Tag { get; init; } = "";
}

/// <summary>
/// M3 动画管线预研：MatchRecord → 回放事件流编译器（确定性纯派生，零 RNG）。
/// 时间轴：每回合 24s 预算（round_start 起手 → 事件按序均布 → round_win 收束），
/// 演出层按 T 消费；每图结尾 map_end。A0-4/B0-4 序号 = Record.Lines 插入序前 5（A 队）/后 5（B 队）。
/// 缺口记录：SimMatch 未落 AAttacksFirst（已补 MapRecord 字段）；旧档缺省 false 仅影响攻防横幅。
/// </summary>
public static class ReplayStream
{
    private const float RoundBudget = 24f;
    private const float RoundGap = 2.5f;

    public static List<ReplayEvent> Compile(MatchRecord rec)
    {
        var evs = new List<ReplayEvent>();
        float t = 1.0f;
        // 序号映射：lines 前 5 = A（teamA），其后 = B（插入序即 ResolveMatchRoster 顺序）
        var pids = rec.Maps.Count > 0 ? rec.Maps[0].Lines.Keys.ToList() : new List<string>();
        var slot = new Dictionary<string, int>();
        for (int i = 0; i < pids.Count && i < 10; i++) slot[pids[i]] = i;

        foreach (var map in rec.Maps)
        {
            // 每图 lines 序一致（同一 roster）；缺失时退化用本图
            var mapSlots = map.Lines.Count >= pids.Count ? map.Lines.Keys.ToList() : pids;
            foreach (var round in map.Rounds)
            {
                float roundT = t;
                evs.Add(new ReplayEvent
                {
                    T = roundT, Kind = "round_start", Side = round.Atk,
                    A = round.N,
                    Tag = $"第 {round.N} 回合 · {map.Map}（{round.Atk} 攻）",
                });
                // 事件按序均布在预算 70% 内（留 30% 给击杀播报余韵）
                var evts = round.Events;
                float span = RoundBudget * 0.7f / Math.Max(1, evts.Count);
                for (int i = 0; i < evts.Count; i++)
                {
                    var e = evts[i];
                    float et = roundT + 1.5f + i * span;
                    int s = e.S != null && slot.TryGetValue(e.S, out var s1) ? s1 : 0;
                    int v = e.V != null && slot.TryGetValue(e.V, out var v1) ? v1 : 0;
                    string kind = e.T switch
                    {
                        "kill" => "kill",
                        "ace" => "ace",
                        "clutch" => "clutch",
                        "plant" => "plant",
                        "defuse" => "defuse",
                        _ => "",
                    };
                    if (kind.Length == 0) continue; // ultReady 等非演出事件不进时间轴
                    string tag = e.T switch
                    {
                        "kill" => (e.First == true ? "首杀 " : "") + (e.Vs != null ? $"残局 1v{e.Vs}" : "") + (e.Dmg != null && e.Dmg >= 200 ? " · 重炮" : ""),
                        "clutch" => "残局！",
                        "ace" => "五杀 ACE！",
                        "plant" => "下包",
                        "defuse" => "拆包",
                        _ => "",
                    };
                    evs.Add(new ReplayEvent { T = et, Kind = kind, Side = e.Side ?? round.Atk, A = s, B = v, Tag = tag });
                }
                // 回合结束
                bool aWon = round.End.Win == "A";
                evs.Add(new ReplayEvent
                {
                    T = roundT + RoundBudget, Kind = "round_win", Side = round.End.Win,
                    A = round.N,
                    Tag = $"{(round.End.Win == "A" ? "A" : "B")} 队拿下第 {round.N} 回合（{HowCn(round.End.How)}）",
                });
                // flawless 加成播报
                if ((aWon && round.End.AliveB == 0) || (!aWon && round.End.AliveA == 0))
                {
                    evs.Add(new ReplayEvent { T = roundT + RoundBudget + 0.8f, Kind = "flawless", Side = round.End.Win, Tag = "完美团灭！" });
                }
                t = roundT + RoundBudget + RoundGap;
            }
            evs.Add(new ReplayEvent
            {
                T = t, Kind = "map_end", Side = map.ScoreA > map.ScoreB ? "A" : "B",
                Tag = $"{map.Map} {map.ScoreA}-{map.ScoreB}{(map.Mvp != null ? " · MVP " + IgnOf(rec, map, map.Mvp) : "")}",
            });
            t += RoundGap * 2;
        }
        return evs;
    }

    private static string IgnOf(MatchRecord rec, MapRecord map, string pid)
    {
        // Record 不带 ign（最小投影）；回放器由 Share.BuildReplayPayload 补名——此处仅返回 pid 尾段可读性占位
        return pid.Length > 6 ? pid[..6] : pid;
    }

    private static string HowCn(string how) => how switch
    {
        "elim" => "歼灭", "spike" => "爆弹", "defuse" => "拆包", "time" => "超时", _ => how,
    };
}
