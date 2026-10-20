using Godot;
using System.Collections.Generic;

namespace Kairo.M0;

/// <summary>
/// M0 竖版验证场景：§3.5 四层分镜的微缩版，全部由硬编码回放事件流驱动。
/// 红线：本场景只消费 Stream 事件做反应动画，不产生任何比赛事实。
/// 自动截图到 user://m0/（约 9 秒后自动退出）。
/// </summary>
public partial class Main : Node2D
{
    private sealed record Ev(float T, string Kind, int A, int B, string Tag);

    private static readonly string[] Names = { "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5" };

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
        (7.42f, "shot3_cheer.png"),
    };

    private SystemFont _font;
    private Label _banner;
    private Label _score;
    private float _bannerTtl;
    private float _t;
    private int _cursor;
    private int _shotCursor;
    private int _killsA, _killsB, _aliveA = 5, _aliveB = 5, _roundA, _roundB;

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

        if (_t >= 9.2f)
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
