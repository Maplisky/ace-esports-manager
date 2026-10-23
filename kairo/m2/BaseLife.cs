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
        /// <summary>走位补间：非 null 时向该点匀速移动（walk 帧），到达后回作业态。</summary>
        public Vector2? Walking;
        public Vector2 WalkFrom;
        public float WalkT;
        public float WalkDur = 1.2f;
        /// <summary>D4 课表气泡（头顶 8×8 像素图标，随 Focus 变化）。</summary>
        public Sprite2D Bubble = null!;
        /// <summary>场景气泡剩余显示时间（>0 可见，归零隐藏）。</summary>
        public float BubbleTtl;
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

    private readonly Dictionary<string, Texture2D> _bubbleCache = new();

    /// <summary>D4 课表气泡：8×8 白底气泡 + 属性图标（枪=准星/床=Zzz…），同 key 缓存。</summary>
    private Texture2D BubbleTex(string focus)
    {
        if (_bubbleCache.TryGetValue(focus, out var cached)) return cached;
        var img = Godot.Image.CreateEmpty(8, 8, false, Godot.Image.Format.Rgba8);
        var ink = Color.FromHtml("#181826");
        var bg = Color.FromHtml("#f4f6f8");
        for (int y = 0; y < 6; y++)
            for (int x = 0; x < 8; x++)
                img.SetPixel(x, y, bg);
        img.SetPixel(2, 6, bg); img.SetPixel(3, 7, bg); // 气泡尾巴
        // 图标（按课表画 2-4 px 特征）
        switch (focus)
        {
            case "aim": img.SetPixel(4, 3, ink); img.SetPixel(3, 3, ink); img.SetPixel(5, 3, ink); img.SetPixel(4, 2, ink); break; // 靶心
            case "reaction": img.SetPixel(3, 3, ink); img.SetPixel(4, 2, ink); img.SetPixel(4, 4, ink); img.SetPixel(5, 3, ink); break; // 闪电
            case "awareness": img.SetPixel(4, 2, ink); img.SetPixel(3, 3, ink); img.SetPixel(4, 3, ink); img.SetPixel(5, 3, ink); img.SetPixel(4, 4, ink); break; // 眼
            case "igl": img.SetPixel(4, 2, ink); img.SetPixel(4, 3, ink); img.SetPixel(3, 4, ink); img.SetPixel(5, 4, ink); break; // 旗
            default: img.SetPixel(3, 3, ink); img.SetPixel(4, 3, ink); break; // 通用两点
        }
        var tex = Godot.ImageTexture.CreateFromImage(img);
        _bubbleCache[focus] = tex;
        return tex;
    }

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

    /// <summary>基地小人按课表分化就位（细化版）走位 + 气泡更新。</summary>
    /// <summary>基地小人按课表分化就位（细化版）走位 + 气泡更新；SetVisible 控制基地页外隐藏。</summary>
    public void SetVisible(bool visible)
    {
        foreach (var w in _workers)
        {
            w.Sprite.Visible = visible;
            w.Bubble.Visible = visible;
        }
    }

    public void Update(GameState state, float dt, bool pageVisible)
    {
        _t += dt;
        foreach (var w in _workers)
        {
            if (!pageVisible)
            {
                w.Sprite.Visible = false;
                w.Bubble.Visible = false;
                continue;
            }
            w.Sprite.Visible = true;
            w.Bubble.Visible = true;
            Vector2 drift;
            if (w.Walking != null)
            {
                // 走位补间：walk 循环帧 + 匀速直线，到达回作业态
                w.WalkT += dt;
                float k = Math.Clamp(w.WalkT / w.WalkDur, 0f, 1f);
                w.Sprite.Position = w.WalkFrom.Lerp(w.Home, k);
                w.Sprite.Texture = w.Frames[(int)(_t * 6) % 4]; // 走路循环帧 0-3
                drift = Vector2.Zero;
            }
            else
            {
                double period = w.Focus == "rest" ? 1.2 : 3.0; // 休息者动作更慢
                drift = new Vector2(Mathf.Sin(_t * w.Speed + w.Phase) * 9f, Mathf.Cos(_t * w.Speed * 0.7f + w.Phase) * 5f);
                w.Sprite.Position = w.Home + drift;
                w.Sprite.Texture = w.Frames[1 + (int)(_t * period + w.Phase) % 3];
            }
            w.Bubble.Position = w.Sprite.Position + new Vector2(10, -26); // D4 头顶气泡随漂移
            if (w.BubbleTtl > 0)
            {
                w.BubbleTtl -= dt;
                if (w.BubbleTtl <= 0) w.Bubble.Visible = false;
            }
        }
    }

    /// <summary>重建小人位（开档/购地/建造/课表变更后调用）：
    /// 按**新课表**重算全员工位——已有小人保留 Sprite 走位补间（walk 帧移动到新工位），
    /// 新增者直接落位，离队者移除。同类别优先，每格 2 工位，溢出落画面外集合。</summary>
    public void Rebuild(GameState state)
    {
        var myTeam = state.Teams[state.MyTeamId!];
        var occupied = new Dictionary<string, int>(); // plotKey → 已占位数（每格 2 工位）
        var built = state.Base!.Plots.Values.Where(p => p.BuildingId != null && p.Level >= 1).ToList();
        static string Key(PlotState p) => BaseState.KeyOf(p.X, p.Y);

        // 目标工位表：pid → Home（按新分配计算）
        var targets = new Dictionary<string, Vector2>();
        int i = 0;
        foreach (var pid in myTeam.Roster)
        {
            if (!state.Players.TryGetValue(pid, out var p)) continue;
            var focus = state.Schedules.TryGetValue(pid, out var f) ? f : "rest";
            var cat = CategoryFor(focus);
            var match = built.FirstOrDefault(pl =>
                BaseOps.Table.Facility(pl.BuildingId!)?.Cat == CatTable(cat)
                && occupied.GetValueOrDefault(Key(pl)) < 2);
            var any = built.FirstOrDefault(pl => occupied.GetValueOrDefault(Key(pl)) < 2);
            var plot = match ?? any;
            if (plot == null) { targets[pid] = CellCenter(0, 0) + new Vector2(-200, 80); continue; }
            string key = Key(plot);
            occupied[key] = occupied.GetValueOrDefault(key) + 1;
            int nth = occupied[key] - 1;
            targets[pid] = CellCenter(plot.X, plot.Y) + new Vector2(nth == 0 ? -16 : 16, (nth % 2 == 0 ? -6 : 10));
            i++;
        }

        // ① 更新/保留已有小人（目标变 → 走位补间；pi 变 → 换装帧）
        var retired = new List<Worker>();
        foreach (var w in _workers)
        {
            if (targets.TryGetValue(w.PlayerId, out var home))
            {
                w.Focus = state.Schedules.TryGetValue(w.PlayerId, out var f) ? f : "rest";
                if ((w.Home - home).LengthSquared() > 1)
                {
                    w.WalkFrom = w.Sprite.Position;
                    w.Home = home;
                    w.WalkT = 0;
                    w.Walking = home;
                }
                targets.Remove(w.PlayerId);
            }
            else retired.Add(w);
        }
        foreach (var w in retired)
        {
            w.Sprite.QueueFree();
            _workers.Remove(w);
        }
        // ② 新增小人（直接落位）
        foreach (var (pid, home) in targets)
        {
            var pal = ChibiFactory.PlayerPalette(pid, shirtShade: i - 1);
            i++;
            var frames = ChibiFactory.BuildFrames(pal);
            var sprite = new Sprite2D { Texture = frames[1], Scale = new Vector2(2.6f, 2.6f), Position = home };
            _host.AddChild(sprite);
            var bubble = new Sprite2D { Texture = BubbleTex(state.Schedules.TryGetValue(pid, out var f3) ? f3 : "rest"), Scale = new Vector2(2, 2), Position = home + new Vector2(10, -26) };
            _host.AddChild(bubble);
            _workers.Add(new Worker
            {
                Sprite = sprite, Frames = frames, Home = home,
                Phase = (float)(_rng.NextDouble() * Math.PI * 2), Speed = 0.9f + (float)_rng.NextDouble() * 0.5f,
                PlayerId = pid,
                Focus = state.Schedules.TryGetValue(pid, out var f2) ? f2 : "rest",
                Bubble = bubble,
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

    /// <summary>E2 场景气泡：确定性轮换让 2 个小人头顶冒课表气泡 4 秒（对照开罗 Practice time! 气泡；演出非随机源）。</summary>
    public void ShowSceneBubbles(GameState state, int day)
    {
        var visible = _workers.Where(w => !w.Bubble.Visible).ToList();
        if (visible.Count == 0) return;
        // 确定性轮换：day 作为相位，避免每次同批人
        int start = day % visible.Count;
        int count = Math.Min(2, visible.Count);
        for (int i = 0; i < count; i++)
        {
            var w = visible[(start + i) % visible.Count];
            w.Bubble.Visible = true;
            w.BubbleTtl = 4f;
        }
    }

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
