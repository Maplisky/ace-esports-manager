using Godot;
using System;
using System.Collections.Generic;

namespace Kairo.M0;

/// <summary>
/// M0 竖版验证场景：§3.5 四层分镜的微缩版，全部由硬编码回放事件流驱动。
/// 红线：本场景只消费 Stream 事件做反应动画，不产生任何比赛事实。
/// 运行约 9 秒：三张截图存 user://m0/，随后对截图做像素自审计并把 PASS/FAIL 打到控制台（桌面控制台 / 设备 logcat），自动退出。
/// </summary>
public partial class Main : Node2D
{
    private sealed record Ev(float T, string Kind, int A, int B, string Tag);

    private static readonly string[] Names = { "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5" };

    /// <summary>硬编码回放事件流（时间秒）。未来替换为共享内核的确定性回放流。</summary>
    private static readonly List<Ev> Stream = new()
    {
        new(2.0f, "round_start", 0, 0, "第 1 回合 · ASCENT"),
        new(3.2f, "kill", 0, 5, "爆头"),
        new(4.2f, "kill", 1, 6, ""),
        new(5.2f, "kill", 7, 2, "回敬"),
        new(6.0f, "kill", 3, 8, "残局 1v2"),
        new(6.9f, "round_win", 0, 0, "A 队拿下第 1 回合"),
    };

    private readonly List<ChibiActor> _walkers = new();
    private readonly List<ChibiActor> _players = new();
    private readonly List<Sprite2D> _dots = new();
    private readonly List<(Vector2 Home, float Phase, float Spd)> _dotMotion = new();
    private readonly List<(Sprite2D Dot, float Ttl)> _dotFlash = new();
    private readonly List<(float At, string Name)> _shots = new()
    {
        (1.2f, "shot1_walk_palette.png"),
        (4.6f, "shot2_kill_feed.png"),
        // shot3（庆祝）为相位锁定捕获：_t≥7.0 后等 A1 离屏瞬间再拍，见 _Process
    };

    private SystemFont _font = null!;
    private Label _banner = null!;
    private Label _score = null!;
    private float _bannerTtl;
    private float _t;
    private int _cursor;
    private int _shotCursor;
    private int _killsA, _killsB, _aliveA = 5, _aliveB = 5, _roundA, _roundB;
    private bool _auditDone, _shot3Done;

    public override void _Ready()
    {
        DirAccess.MakeDirRecursiveAbsolute("user://m0");
        GD.Print($"[m0] screenshots -> {ProjectSettings.GlobalizePath("user://m0")}");
        BuildScene();
        RefreshScoreboard();
    }

    private void BuildScene()
    {
        _font = new SystemFont { FontNames = new[] { "Microsoft YaHei UI", "Microsoft YaHei", "sans-serif" } };

        Panel(0, 0, 720, 1280, "#101018");
        Panel(12, 12, 696, 236, "#0c2416");
        Panel(12, 258, 696, 210, "#181a26");
        Panel(12, 680, 696, 390, "#221e30");
        Panel(12, 1082, 696, 186, "#14161f");

        Caption(24, 20, "① 小地图窗 · 事件回放（顶端独立小窗）");
        Caption(24, 266, "② 程序化小人 · 调色板换装（6 队色）");
        Caption(24, 688, "③ 场馆演出 · 双方选手坐电脑前 + 击杀播报");
        Caption(24, 1090, "④ 战绩板 · 像素风（底部，操作区上方）");

        var dotTexA = MakeDot(Color.FromHtml("#e05a5a"));
        var dotTexB = MakeDot(Color.FromHtml("#5a7ae0"));
        for (int i = 0; i < 10; i++)
        {
            var s = new Sprite2D { Texture = i < 5 ? dotTexA : dotTexB, Position = new Vector2(80 + (i % 5) * 130, i < 5 ? 90 : 180) };
            AddChild(s);
            _dots.Add(s);
            _dotMotion.Add((s.Position, i * 1.7f, 0.6f + (i % 3) * 0.25f));
        }
        Marker(90, 150, "A");
        Marker(610, 220, "B");

        for (int i = 0; i < 6; i++)
        {
            var frames = ChibiFactory.BuildFrames(ChibiFactory.TeamPalettes[i]);
            var s = new Sprite2D { Texture = frames[0], Scale = new Vector2(4, 4), Position = new Vector2(40 + i * 105, 380) };
            AddChild(s);
            _walkers.Add(new ChibiActor
            {
                Sprite = s, Frames = frames, State = ChibiState.Walk,
                Home = new Vector2(40 + i * 105, 380), Speed = 55 + i * 9,
            });
        }

        for (int i = 0; i < 10; i++)
        {
            bool a = i < 5;
            int k = i % 5;
            float x = a ? 150 + k * 42 : 470 + k * 42;
            float y = a ? 800 : 990;
            var frames = ChibiFactory.BuildFrames(ChibiFactory.TeamPalette(a, k));
            var s = new Sprite2D { Texture = frames[0], Scale = new Vector2(4, 4), Position = new Vector2(x, y) };
            AddChild(s);
            // 显示器与桌子后添加 → 画在选手前面，形成"坐在桌后"层次
            Panel(x - 10, y + 16, 22, 15, "#3a4152");
            Panel(x - 7, y + 19, 16, 9, "#7fd4c8");
            Panel(x - 26, y + 34, 60, 14, "#6b4a32");
            _players.Add(new ChibiActor { Sprite = s, Frames = frames, Home = new Vector2(x, y) });
        }

        _banner = new Label
        {
            Position = new Vector2(12, 555),
            Size = new Vector2(696, 70),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _banner.AddThemeFontOverride("font", _font);
        _banner.AddThemeFontSizeOverride("font_size", 34);
        _banner.Visible = false;
        AddChild(_banner);

        _score = new Label { Position = new Vector2(24, 1130), Size = new Vector2(672, 120) };
        _score.AddThemeFontOverride("font", _font);
        _score.AddThemeFontSizeOverride("font_size", 30);
        AddChild(_score);
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;
        _t += dt;

        while (_cursor < Stream.Count && Stream[_cursor].T <= _t)
        {
            Apply(Stream[_cursor]);
            _cursor++;
        }
        while (_shotCursor < _shots.Count && _shots[_shotCursor].At <= _t)
        {
            Capture(_shots[_shotCursor].Name);
            _shotCursor++;
        }
        // 庆祝截图相位锁定：等弹跳离屏（跨帧率确定性），8.8s 兜底强制拍
        if (!_shot3Done && _t >= 7.0f && (_players.Count > 0 && _players[0].Airborne || _t >= 8.8f))
        {
            _shot3Done = true;
            Capture("shot3_cheer.png");
        }

        foreach (var w in _walkers) w.Update(dt);
        foreach (var p in _players) p.Update(dt);

        for (int i = 0; i < _dots.Count; i++)
        {
            var (home, phase, spd) = _dotMotion[i];
            _dots[i].Position = home + new Vector2(Mathf.Sin(_t * spd + phase) * 26f, Mathf.Cos(_t * spd * 0.8f + phase) * 16f);
        }
        for (int i = _dotFlash.Count - 1; i >= 0; i--)
        {
            var (dot, ttl) = _dotFlash[i];
            if (ttl - dt <= 0) { dot.Scale = Vector2.One; _dotFlash.RemoveAt(i); }
            else _dotFlash[i] = (dot, ttl - dt);
        }

        if (_bannerTtl > 0)
        {
            _bannerTtl -= dt;
            _banner.Modulate = new Color(1, 1, 1, Mathf.Max(_bannerTtl / 0.9f, 0f));
            if (_bannerTtl <= 0) _banner.Visible = false;
        }

        if (!_auditDone && _shot3Done && _t >= 9.0f)
        {
            _auditDone = true;
            SelfAudit();
        }
        if (_t >= 9.8f)
        {
            GD.Print("[m0] done");
            GetTree().Quit();
        }
    }

    private void Apply(Ev e)
    {
        switch (e.Kind)
        {
            case "round_start":
                ShowBanner(e.Tag, 1.4f);
                break;
            case "kill":
                _players[e.B].Kill();
                _dots[e.B].Modulate = new Color(1, 1, 1, 0.15f);
                _dots[e.A].Scale = new Vector2(1.7f, 1.7f);
                _dotFlash.Add((_dots[e.A], 0.4f));
                if (e.A < 5) { _killsA++; _aliveB--; } else { _killsB++; _aliveA--; }
                ShowBanner($"{Names[e.A]} 击倒 {Names[e.B]}{(e.Tag.Length > 0 ? " · " + e.Tag : "")}");
                RefreshScoreboard();
                break;
            case "round_win":
                _roundA++;
                for (int i = 0; i < 5; i++) _players[i].Cheer();
                ShowBanner(e.Tag, 1.6f);
                RefreshScoreboard();
                break;
        }
    }

    private void RefreshScoreboard()
    {
        _score.Text = $"A {_roundA} - {_roundB} B      存活 A×{_aliveA}  B×{_aliveB}      击杀 {_killsA} : {_killsB}";
    }

    private void ShowBanner(string text, float ttl = 0.9f)
    {
        _banner.Text = text;
        _banner.Visible = true;
        _banner.Modulate = Colors.White;
        _bannerTtl = ttl;
    }

    private async void Capture(string name)
    {
        await ToSignal(RenderingServer.Singleton, "frame_post_draw");
        GetViewport().GetTexture().GetImage().SavePng($"user://m0/{name}");
        GD.Print($"[m0] saved {name}");
    }

    // ---------- 像素自审计（与桌面基线同源断言；设备端在 logcat 出结果） ----------

    private static int Count(Image img, int x0, int y0, int x1, int y1, Func<Color, bool> pred)
    {
        int hits = 0;
        for (int y = y0; y < y1; y++)
            for (int x = x0; x < x1; x++)
                if (pred(img.GetPixel(x, y)))
                    hits++;
        return hits;
    }

    private static bool Near(Color c, string hex, int tol) =>
        Mathf.Abs(c.R8 - Color.FromHtml(hex).R8) <= tol &&
        Mathf.Abs(c.G8 - Color.FromHtml(hex).G8) <= tol &&
        Mathf.Abs(c.B8 - Color.FromHtml(hex).B8) <= tol;

    private static bool Light(Color c) => c.R8 > 100 && c.G8 > 100 && c.B8 > 100 && Mathf.Abs(c.R8 - c.B8) < 40;

    /// <summary>变暗的蓝衣（阵亡压暗）：蓝主导且显著偏暗。兼容 sRGB 空间压暗（桌面）与线性空间压暗（GLES3 设备）两种渲染结果。</summary>
    private static bool DeadBlue(Color c) => c.R8 < 60 && c.G8 < 90 && c.B8 > 90 && c.B8 < 190 && c.B8 - c.R8 > 40;
    private static bool ScoreBg(Color c) => Near(c, "#14161f", 6);

    private void Check(string id, float value, float min, float max, ref int pass)
    {
        bool ok = value >= min && value <= max;
        if (ok) pass++;
        GD.Print($"[audit] {id}={value:0} {(ok ? "PASS" : "FAIL")} (expect {min:0}..{max:0})");
    }

    /// <summary>
    /// 加载三张自存截图做像素断言。断言全部用 720×1280 内容坐标表达，按截图实际分辨率等比映射
    /// （设备窗口尺寸≠视口设计尺寸，如模拟器横屏信箱 607×1080），计数阈值按面积因子缩放。
    /// 阈值基准：2026-10-20 桌面 720×1280 基线实测值。
    /// </summary>
    private void SelfAudit()
    {
        int pass = 0, total = 0;
        var s1 = Image.LoadFromFile(ProjectSettings.GlobalizePath("user://m0/shot1_walk_palette.png"));
        var s2 = Image.LoadFromFile(ProjectSettings.GlobalizePath("user://m0/shot2_kill_feed.png"));
        var s3 = Image.LoadFromFile(ProjectSettings.GlobalizePath("user://m0/shot3_cheer.png"));

        if (s1 == null || s2 == null || s3 == null)
        {
            GD.Print("[audit] SUMMARY 0/10 PASS (screenshots missing)");
            return;
        }

        float kx = s1.GetWidth() / 720f, ky = s1.GetHeight() / 1280f;
        float area = kx * ky;
        GD.Print($"[audit] shot size {s1.GetWidth()}x{s1.GetHeight()} (content 720x1280, area factor {area:0.000})");

        int CountC(Image img, float x0, float y0, float x1, float y1, Func<Color, bool> pred) =>
            Count(img, (int)(x0 * kx), (int)(y0 * ky), (int)(x1 * kx), (int)(y1 * ky), pred);
        float T(float v) => v * area;

        string[] shirts = { "#d04040", "#3a6ad0", "#38a058", "#d0a020", "#9048c0", "#30a8b0" };
        foreach (var shirt in shirts)
        {
            string hex = shirt;
            Check($"palette-{hex}", CountC(s1, 0, 270, 720, 465, c => Near(c, hex, 12)), T(60), 1e6f, ref pass); total++;
        }
        Check("minimap-red", CountC(s1, 0, 0, 720, 250, c => Near(c, "#e05a5a", 10)), T(50), 1e6f, ref pass); total++;
        Check("minimap-blue", CountC(s1, 0, 0, 720, 250, c => Near(c, "#5a7ae0", 10)), T(50), 1e6f, ref pass); total++;
        Check("desks-wood", CountC(s1, 0, 680, 720, 1070, c => Near(c, "#6b4a32", 8)), T(500), 1e6f, ref pass); total++;
        Check("baseline-no-cheer", CountC(s1, 100, 770, 320, 795, c => Near(c, "#d04040", 12)), 0, 0, ref pass); total++;
        Check("banner-text", CountC(s2, 0, 555, 720, 625, Light), T(80), 1e6f, ref pass); total++;
        Check("dead-dim", CountC(s2, 420, 930, 620, 1070, DeadBlue), T(80), 1e6f, ref pass); total++;
        Check("cheer-jump", CountC(s3, 100, 770, 320, 795, c => Near(c, "#d04040", 12)), T(40), 1e6f, ref pass); total++;
        Check("board-bg-top", CountC(s1, 0, 0, 720, 640, ScoreBg), 0, T(999), ref pass); total++;
        Check("board-bg-bottom", CountC(s1, 0, 640, 720, 1280, ScoreBg), T(100000), 1e7f, ref pass); total++;

        GD.Print($"[audit] SUMMARY {pass}/{total} PASS");
    }

    // ---------- 布景工具 ----------

    private void Panel(float x, float y, float w, float h, string hex)
    {
        AddChild(new ColorRect { Position = new Vector2(x, y), Size = new Vector2(w, h), Color = Color.FromHtml(hex) });
    }

    private void Caption(float x, float y, string text)
    {
        var l = new Label { Position = new Vector2(x, y), Text = text };
        l.AddThemeFontOverride("font", _font);
        l.AddThemeFontSizeOverride("font_size", 22);
        l.Modulate = new Color(0.8f, 0.85f, 0.95f);
        AddChild(l);
    }

    private void Marker(float x, float y, string tag)
    {
        Panel(x - 14, y - 14, 28, 28, "#2e5c3c");
        var l = new Label
        {
            Position = new Vector2(x - 14, y - 12),
            Size = new Vector2(28, 28),
            Text = tag,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        l.AddThemeFontOverride("font", _font);
        l.AddThemeFontSizeOverride("font_size", 20);
        AddChild(l);
    }

    private static Texture2D MakeDot(Color c)
    {
        var img = Image.CreateEmpty(8, 8, false, Image.Format.Rgba8);
        for (int y = 0; y < 8; y++)
            for (int x = 0; x < 8; x++)
            {
                bool edge = x == 0 || y == 0 || x == 7 || y == 7;
                img.SetPixel(x, y, edge ? Colors.Transparent : c);
            }
        return ImageTexture.CreateFromImage(img);
    }
}
