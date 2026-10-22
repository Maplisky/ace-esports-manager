using Godot;
using Kairo.Core;
using Kairo.M0;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.M2;

/// <summary>基地页训练演出：设施内选手小人（作业呼吸/换格走动）+ 周结算成长弹字（开罗式反馈）。</summary>
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

    /// <summary>同步训练小人到我队 roster（按设施就位；缺设施时在空地集合）。每帧调用。</summary>
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
            // 作业动画：站位小幅漂移 + 呼吸帧（walk 循环低速 = 干活摆动）
            var drift = new Vector2(Mathf.Sin(_t * w.Speed + w.Phase) * 9f, Mathf.Cos(_t * w.Speed * 0.7f + w.Phase) * 5f);
            w.Sprite.Position = w.Home + drift;
            w.Sprite.Texture = w.Frames[1 + (int)(_t * 3 + w.Phase) % 3];
        }
    }

    /// <summary>重建小人位（开档/购地/建造后调用）：roster 前 5 名分配到已建成设施格。</summary>
    public void Rebuild(GameState state)
    {
        foreach (var w in _workers) w.Sprite.QueueFree();
        _workers.Clear();
        var myTeam = state.Teams[state.MyTeamId!];
        var plots = state.Base!.Plots.Values.Where(p => p.BuildingId != null).ToList();
        if (plots.Count == 0) return;
        int i = 0;
        foreach (var pid in myTeam.Roster.Take(5))
        {
            if (!state.Players.TryGetValue(pid, out var p)) continue;
            var plot = plots[i % plots.Count];
            i++;
            var pal = ChibiFactory.TeamPalette(true, i - 1);
            var frames = ChibiFactory.BuildFrames(pal);
            var home = CellCenter(plot.X, plot.Y) + new Vector2((i % 2 == 0 ? -1 : 1) * 14, (i % 3 - 1) * 10);
            var sprite = new Sprite2D { Texture = frames[1], Scale = new Vector2(2.6f, 2.6f), Position = home };
            _host.AddChild(sprite);
            _workers.Add(new Worker
            {
                Sprite = sprite, Frames = frames, Home = home,
                Phase = (float)(_rng.NextDouble() * Math.PI * 2), Speed = 0.9f + (float)_rng.NextDouble() * 0.5f,
                PlayerId = pid,
            });
        }
    }

    /// <summary>
    /// 周结算成长弹字：before/after 快照 diff，对每名成长选手在其小人位置弹出浮字
    /// （overall↑ 用醒目金色，经验增益用青色）。上限 6 条防刷屏。
    /// </summary>
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
