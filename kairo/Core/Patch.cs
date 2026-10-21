using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 版本系统（meta 二维化，GDD §4.3 v0.9）— C# 移植自 ace/src/core/sim/patch.ts（权威实现）。
/// meta[agent]：版本系数（0.85-1.15），每赛段随机重掷（同 seed 确定性）。
/// </summary>
public static class Patch
{
    /// <summary>当前生效的 Patch（GameState.patchNotes 末条）。</summary>
    public static PatchNote? CurrentPatch(GameState state) =>
        state.PatchNotes.Count > 0 ? state.PatchNotes[^1] : null;

    /// <summary>发布新版本：每赛段调用一次。重掷 4-6 名英雄 meta，产出 Patch 公告。</summary>
    public static PatchNote RollPatch(GameState state, string segKey, Rng rng)
    {
        var prev = CurrentPatch(state);
        var prevMeta = new Dictionary<string, double>();
        if (prev != null)
            foreach (var c in prev.Changes)
                prevMeta[c.AgentId] = c.Meta;
        int n = rng.Int(4, 6);
        var pool = rng.Shuffle(CoreData.Agents.Select(x => x.Id).ToList()).Take(n).ToList();
        var changes = new List<PatchChange>();
        var mapNotes = new List<(string MapId, string Text)>();

        foreach (var id in pool)
        {
            // 变化幅度 ±5%~±12%；沿上次方向延续的概率更高（版本惯性）
            double pct = rng.Range(5, 12) / 100;
            bool was = prevMeta.TryGetValue(id, out var prevVal);
            string? prevDir = !was ? null : prevVal > 1 ? "buff" : prevVal < 1 ? "nerf" : null;
            string dir = prevDir ?? (rng.Chance(0.5) ? "buff" : "nerf");
            double meta = dir == "buff" ? 1 + pct : 1 - pct;
            changes.Add(new PatchChange { AgentId = id, Meta = meta, Dir = dir, Pct = (int)DetMath.JsRound(pct * 100) });
        }

        // 地图级影响：挑 2 张图，找被改英雄中该图 fit×meta 最高者写地图结论
        foreach (var m in rng.Shuffle(CoreData.Maps.Select(x => x.Id).ToList()).Take(2))
        {
            var mapDef = CoreData.MapById.GetValueOrDefault(m);
            if (mapDef == null) continue;
            var best = changes
                .Select(c => (c, fit: Fit.ComputeFit(c.AgentId, mapDef)))
                .OrderByDescending(t => t.fit * t.c.Meta) // 稳定序
                .FirstOrDefault();
            if (best.c != null)
            {
                string name = CoreData.AgentById.TryGetValue(best.c.AgentId, out var ad) ? ad.Name : best.c.AgentId;
                mapNotes.Add((m, $"在「{mapDef.Name}」其适配 {DetMath.ToFixed2(best.fit)}，{(best.c.Dir == "nerf" ? "控图价值仍高于平替——平替不成立" : "加强后优先级进一步上升")}"));
            }        }

        var note = new PatchNote
        {
            Version = $"{state.Year}.{segKey}",
            Changes = changes,
            MapNotes = new OrderedDict<string, string>(),
        };
        foreach (var (mapId, text) in mapNotes) note.MapNotes[mapId] = text;
        state.PatchNotes = state.PatchNotes.Count > 7 ? state.PatchNotes.Skip(state.PatchNotes.Count - 7).ToList() : state.PatchNotes;
        state.PatchNotes.Add(note);
        return note;
    }

    /// <summary>平替推荐：cut 被削弱时，按 fit×meta×职责覆盖在池内找顶替者（按图给出）。</summary>
    public static (string AgentId, double Score)? RecommendReplacement(GameState state, string cutAgentId, string mapId, IReadOnlyList<string> pool)
    {
        var patch = CurrentPatch(state);
        double MetaOf(string id) => patch?.Changes.FirstOrDefault(c => c.AgentId == id)?.Meta ?? 1;
        var cutDef = CoreData.AgentById.GetValueOrDefault(cutAgentId);
        if (cutDef == null) return null;
        var mapDef = CoreData.MapById.GetValueOrDefault(mapId);
        if (mapDef == null) return null;
        (string AgentId, double Score)? best = null;
        foreach (var id in pool)
        {
            if (id == cutAgentId) continue;
            var def = CoreData.AgentById.GetValueOrDefault(id);
            if (def == null) continue;
            // 职责覆盖：主职责相同 = 1，否则按职责向量夹角衰减；<0.3 的跨职责平替不成立
            double overlap = DutyOverlap(cutDef, def);
            if (overlap < 0.3) continue;
            double fit = Fit.ComputeFit(id, mapDef);
            double score = fit * MetaOf(id) * overlap;
            if (best == null || score > best.Value.Score) best = (id, score);
        }
        return best;
    }

    /// <summary>简易职责覆盖度：duty 向量点积归一（sqrt 为 IEEE 正确舍入，双端一致）。</summary>
    private static double DutyOverlap(AgentDef a, AgentDef b)
    {
        double dot = 0, na = 0, nb = 0;
        foreach (var k in new[] { "duelist", "initiator", "controller", "sentinel" })
        {
            double av = DutyGet(a.Duty, k);
            double bv = DutyGet(b.Duty, k);
            dot += av * bv;
            na += av * av;
            nb += bv * bv;
        }
        double denom = Math.Sqrt(na) * Math.Sqrt(nb);
        return denom > 0 ? dot / denom : 0;
    }

    private static double DutyGet(DutyVector d, string k) => k switch
    {
        "duelist" => d.Duelist, "initiator" => d.Initiator, "controller" => d.Controller, "sentinel" => d.Sentinel,
        _ => throw new ArgumentException(k),
    };
}
