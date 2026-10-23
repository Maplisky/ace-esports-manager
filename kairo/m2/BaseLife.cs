using Godot;
using Kairo.Core;
using Kairo.M0;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.M2;

/// <summary>
/// 基地页训练演出（细化版）：设施内选手小人按**本人课表**分化就位——
/// 课表指向训练/休息属性时优先去对应类别的已建成设施（战术室/宿舍…），
/// 无匹配设施则落在任意建成设施或空地；每格最多 2 人（工位感），作业动画带换位徘徊。
/// 周结算成长弹字：overall↑ 金色 / 经验青色，在人头顶上飘。
/// </summary>
public sealed class BaseLife
{
    private sealed class Worker
    {
        public Sprite2D Sprite = null!;
        public Texture2D[] Frames = null!;
        public Vector2 Home;
        public float Phase;
        public float Speed;
        public string PlayerId = "";
        public string Focus = "rest";
    }

    private readonly Node2D _host;
    private readonly Font _font;
    private readonly List<Worker> _workers = new();
    private float _t;
    private readonly System.Random _rng = new(42);

    public BaseLife(Node2D host, Font font)
    {
        _host = host;
        _font = font;
    }

    private const int CellW = GrayBox.CellW;
    private const int CellH = GrayBox.CellH;
    private const int GridX = GrayBox.GridX;
    private const int GridY = GrayBox.GridY;

    /// <summary>格中心（与 Redraw 网格同公式）。</summary>
    public static Vector2 CellCenter(int gx, int gy) =>
        new(GridX + gx * (CellW + 12) + CellW / 2, GridY + gy * (CellH + 12) + CellH / 2);

    /// <summary>课表 key → 设施类别偏好（无匹配 = 任意建成设施）。</summary>
    private static string CategoryFor(string focus) => focus switch
    {
        "awareness" or "utility" or "igl" => "tactic",
        "aim" or "reaction" => "range",
        "clutch" or "teamwork" or "communication" => "gym",
        "rest" => "dorm",
        _ => "",
    };

    /// <summary>每帧：作业动画（漂移 + 呼吸帧；休息者在宿舍侧改为躺平慢帧节奏）。</summary>
    public void Update(GameState state, float dt, bool pageVisible)
    {
        _t += dt;
        foreach (var w in _workers)
        {
            if (!pageVisible)
            {
                w.Sprite.Visible = false;
                continue;
            }
            w.Sprite.Visible = true;
            double period = w.Focus == "rest" ? 1.2 : 3.0; // 休息者动作更慢
            var drift = new Vector2(Mathf.Sin(_t * w.Speed + w.Phase) * 9f, Mathf.Cos(_t * w.Speed * 0.7f + w.Phase) * 5f);
            w.Sprite.Position = w.Home + drift;
            w.Sprite.Texture = w.Frames[1 + (int)(_t * period + w.Phase) % 3];
        }
    }

    /// <summary>重建小人位（开档/购地/建造/课表变更后调用）：
    /// 按课表类别把 roster 分配到设施格——同类别优先，容量每格 2 人，溢出落空地（画面边缘不露）。</summary>
    public void Rebuild(GameState state)
    {
        foreach (var w in _workers) w.Sprite.QueueFree();
        _workers.Clear();
        var myTeam = state.Teams[state.MyTeamId!];
        var occupied = new Dictionary<string, int>(); // plotKey → 已占位数（每格 2 工位）
        var built = state.Base!.Plots.Values.Where(p => p.BuildingId != null && p.Level >= 1).ToList();

        Vector2 PlaceFor(string focus, out string plotKey)
        {
            // 1) 类别匹配设施（同类别有空位的格）
            var cat = CategoryFor(focus);
            var match = built.FirstOrDefault(p =>
                BaseOps.Table.Facility(p.BuildingId!)?.Cat == CatTable(cat)
                && occupied.GetValueOrDefault(Key(p)) < 2);
            // 2) 任意建成设施有空位
            var any = built.FirstOrDefault(p => occupied.GetValueOrDefault(Key(p)) < 2);
            var plot = match ?? any;
            if (plot == null) { plotKey = ""; return CellCenter(0, 0) + new Vector2(-200, 80); } // 画面外集合（不露脸）
            string key = Key(plot);
            occupied[key] = occupied.GetValueOrDefault(key) + 1;
            plotKey = key;
            int nth = occupied[key] - 1;
            return CellCenter(plot.X, plot.Y) + new Vector2(nth == 0 ? -16 : 16, (nth % 2 == 0 ? -6 : 10));
        }
        static string Key(PlotState p) => BaseState.KeyOf(p.X, p.Y);

        int i = 0;
        foreach (var pid in myTeam.Roster)
        {
            if (!state.Players.TryGetValue(pid, out var p)) continue;
            var focus = state.Schedules.TryGetValue(pid, out var f) ? f : "rest";
            var home = PlaceFor(focus, out _);
            if (occupied.Values.Sum() >= built.Count * 2 + 6) { /* 满员溢出保护 */ }
            i++;
            var pal = ChibiFactory.PlayerPalette(pid, shirtShade: i - 1); // pid 确定性换装（M3 扩容）
            var frames = ChibiFactory.BuildFrames(pal);
            var sprite = new Sprite2D { Texture = frames[1], Scale = new Vector2(2.6f, 2.6f), Position = home };
            _host.AddChild(sprite);
            _workers.Add(new Worker
            {
                Sprite = sprite, Frames = frames, Home = home,
                Phase = (float)(_rng.NextDouble() * Math.PI * 2), Speed = 0.9f + (float)_rng.NextDouble() * 0.5f,
                PlayerId = pid, Focus = focus,
            });
        }
    }

    /// <summary>课表设施类别 → 设施表 cat 值的映射表（CategoryFor 产出 → economy 表 cat）。</summary>
    private static string CatTable(string preferred) => preferred switch
    {
        "tactic" => "training", // 战术室（id=tactic，cat=training）优先；射击房同类别兜底由 Facility 筛选容错
        "range" => "training",
        "gym" => "training",
        "dorm" => "rest",
        _ => "",
    };

    /// <summary>周结算成长弹字：overall↑ 金色 / 经验青色，在人头顶上飘；上限 6 条。</summary>
    public void ShowGrowth(GameState state, Dictionary<string, (double Xp, int Overall)> before)
    {
        var myTeam = state.Teams[state.MyTeamId!];
        var pops = new List<(Vector2 Pos, string Text, Color Col)>();
        foreach (var pid in myTeam.Roster)
        {
            if (!state.Players.TryGetValue(pid, out var p)) continue;
            double total = p.Xp.Values.Sum();
            var (oldXp, oldOverall) = before.TryGetValue(pid, out var b) ? b : (total, p.Overall);
            var w = _workers.FirstOrDefault(x => x.PlayerId == pid);
            var pos = w?.Home ?? CellCenter(0, 0);
            if (p.Overall > oldOverall)
            {
                pops.Add((pos, $"{p.Ign} overall+{p.Overall - oldOverall}↑", Color.FromHtml("#ffd75e")));
            }
            else if (total - oldXp >= 0.05)
            {
                pops.Add((pos, $"{p.Ign} +{total - oldXp:F1} 经验", Color.FromHtml("#7fd4c8")));
            }
            if (pops.Count >= 6) break;
        }
        for (int i = 0; i < pops.Count; i++)
        {
            var (pos, text, col) = pops[i];
            var label = new Label { Position = pos + new Vector2(-40, -34 - i * 2), Size = new Vector2(180, 24), Text = text };
            label.AddThemeFontOverride("font", _font);
            label.AddThemeFontSizeOverride("font_size", 16);
            label.Modulate = col;
            _host.AddChild(label);
            var tween = _host.CreateTween();
            tween.TweenProperty(label, "position:y", label.Position.Y - 30, 2.2).SetEase(Tween.EaseType.Out);
            tween.Parallel().TweenProperty(label, "modulate:a", 0f, 2.2).SetEase(Tween.EaseType.In);
            tween.TweenCallback(Callable.From(label.QueueFree));
        }
    }
}
