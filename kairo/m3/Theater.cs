using Godot;
using Kairo.Core;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.M3;

/// <summary>
/// M3 四层分镜完整场景（立项 §3.5）：顶端小地图事件窗 / 中部场馆双方选手+击杀播报 /
/// 赛季横幅小人带 / 底部战绩板——全部由 ReplayStream 时间轴驱动（演出层只消费，红线）。
/// 与 m0 微缩版的差异：事件流来自真实内核比赛（灰盒任意已打比赛同 seed 重模拟），选手名真实。
/// 运行：选「观赏」页签进入；--watch-auto 自动选最近一场并完整播完打印自检。
/// </summary>
public partial class Theater : Node2D
{
    private GameState _state = null!;
    private List<ReplayEvent> _stream = new();
    private Dictionary<string, string> _igns = new();
    private string _recSeedInfo = "";
    private string _tagA = "A";
    private string _tagB = "B";
    private float _t;
    private int _cursor;
    private readonly List<Actor> _players = new();
    private readonly List<(Control Row, float Ttl)> _feed = new();
    /// <summary>演出序号 0-9 → 选手 pid（头像生成键；Load 时从 Record.Lines 插入序建表）。</summary>
    private readonly Dictionary<int, string> _slotPid = new();
    private SystemFont _font = null!;
    private Label _mapWin = null!;
    private Label _score = null!;
    private Label _title = null!;
    private int _killsA, _killsB, _aliveA = 5, _aliveB = 5, _roundA, _roundB;
    private readonly Queue<string> _mapLog = new();
    private bool _done;
    private int _mapCount;

    public override void _Ready()
    {
        string dataDir = Kairo.M2.AssetBridge.ExportDataDir("res://Core.Data");
        Worldgen.LoadData(dataDir);
        BaseOps.DataDirOverride = dataDir;

        _font = new SystemFont { FontNames = new[] { "Microsoft YaHei UI", "Microsoft YaHei", "sans-serif" } };
        Kairo.M2.Sfx.Init(this);
        BuildScene();
        // auto 检测双来源：桌面 -- 后进 user args；Android extra_args 进完整参数表（坑 23）
        var allArgs = OS.GetCmdlineArgs().Concat(OS.GetCmdlineUserArgs());
        if (allArgs.Any(a => a.Contains("watch-auto"))) AutoPlay();
    }

    private void BuildScene()
    {
        // 四层底板（§3.5 竖屏分层）
        Panel(0, 0, 720, 1280, "#0e1018");
        Panel(10, 10, 700, 250, "#0c2416");   // ① 小地图窗
        Panel(10, 270, 700, 110, "#181a26");  // 走路带（赛季小人）
        Panel(10, 390, 700, 560, "#221e30");  // ③ 场馆
        Panel(10, 960, 700, 220, "#14161f");  // ④ 战绩板

        Caption(24, 18, "① 小地图窗 · 实时击杀");
        Caption(24, 278, "② 程序化小人带");
        Caption(24, 398, "③ 场馆 · 双方选手 + 播报");
        Caption(24, 968, "④ 战绩板");

        _title = new Label { Position = new Vector2(20, 40), Size = new Vector2(680, 40) };
        _title.AddThemeFontOverride("font", _font);
        _title.AddThemeFontSizeOverride("font_size", 26);
        AddChild(_title);

        // ① 小地图事件点（A 红 / B 蓝）
        for (int i = 0; i < 10; i++)
        {
            bool a = i < 5;
            var dot = new ColorRect
            {
                Position = new Vector2(60 + (i % 5) * 120, a ? 90 : 170),
                Size = new Vector2(26, 26),
                Color = a ? Color.FromHtml("#e05a5a") : Color.FromHtml("#5a7ae0"),
            };
            AddChild(dot);
        }

        // ③ 场馆双方选手（真实 roster 名）
        for (int i = 0; i < 10; i++)
        {
            bool sideA = i < 5;
            var actor = new Actor();
            actor.Init(this, sideA, i % 5);
            _players.Add(actor);
        }

        _mapWin = new Label { Position = new Vector2(24, 200), Size = new Vector2(660, 52) };
        _mapWin.AddThemeFontOverride("font", _font);
        _mapWin.AddThemeFontSizeOverride("font_size", 18);
        AddChild(_mapWin);

        _score = new Label { Position = new Vector2(24, 990), Size = new Vector2(672, 170) };
        _score.AddThemeFontOverride("font", _font);
        _score.AddThemeFontSizeOverride("font_size", 30);
        AddChild(_score);
    }

    private void Caption(string text, float x, float y) => Caption(x, y, text);

    private void Caption(float x, float y, string text)
    {
        var l = new Label { Position = new Vector2(x, y), Text = text };
        l.AddThemeFontOverride("font", _font);
        l.AddThemeFontSizeOverride("font_size", 16);
        l.Modulate = new Color(1, 1, 1, 0.55f);
        AddChild(l);
    }

    private void Panel(int x, int y, int w, int h, string hex) =>
        AddChild(new ColorRect { Position = new Vector2(x, y), Size = new Vector2(w, h), Color = Color.FromHtml(hex) });

    /// <summary>自动模式：重开世界 → 自定义开局 → 打完揭幕杯一轮 → 挑最近比赛回放 → 自检自退。</summary>
    private void AutoPlay()
    {
        GD.Print("[theater] auto: generating world");
        Fixtures.ResetFixtureSeq();
        _state = Worldgen.GenerateWorld(42, resetSeq: true);
        DaySim.InitSeasonFixtures(_state);
        NewGame.Start(_state, new StartConfig { Mode = StartMode.Custom, TeamName = "演出测试队" });
        GD.Print("[theater] auto: advancing 70 days");
        AppLoop.Advance(_state, 70); // 打到揭幕杯+联赛初段
        var last = _state.Fixtures
            .Where(f => f.Played && (f.TeamA == _state.MyTeamId || f.TeamB == _state.MyTeamId))
            .OrderByDescending(f => f.Day).FirstOrDefault();
        GD.Print($"[theater] auto: last={last?.Id ?? "none"}");
        if (last == null)
        {
            GD.Print("[theater-audit] FAIL: no played match");
            GetTree().Quit(1);
            return;
        }
        long seed = Rng.HashString($"{_state.Seed}:{last.Id}");
        var rec = Match.SimMatch(_state, last.TeamA, last.TeamB, last.Bo, seed, last.Id, last.MapLock, last.AgentLock);
        GD.Print($"[theater] auto: sim done maps={rec.Maps.Count} rounds0={rec.Maps[0].Rounds.Count}");
        GD.Print("[theater] auto: compiling stream");
        var igns = _state.Players.Values.ToDictionary(p => p.Id, p => p.Ign);
        var stream = ReplayStream.Compile(rec, igns);
        GD.Print($"[theater] auto: compiled {stream.Count} events");
        Load(rec, $"{_state.Teams[last.TeamA].Tag} vs {_state.Teams[last.TeamB].Tag}", igns,
            (_state.Teams[last.TeamA].Tag, _state.Teams[last.TeamB].Tag));
        GD.Print($"[theater] auto: stream={_stream.Count} playing");
    }

    /// <summary>装载一场比赛回放（宿主入口）。</summary>
    public void Load(MatchRecord rec, string title, IReadOnlyDictionary<string, string>? igns = null, (string A, string B)? sideTags = null)
    {
        _stream = ReplayStream.Compile(rec, igns);
        _igns = igns?.ToDictionary(kv => kv.Key, kv => kv.Value) ?? new Dictionary<string, string>();
        (_tagA, _tagB) = sideTags ?? ("A", "B");
        // 演出序号 → pid（头像键）：Lines 插入序前 5 = A 队，其后 = B 队（与 Compile 同规则）
        _slotPid.Clear();
        int i = 0;
        foreach (var pid in (rec.Maps.Count > 0 ? rec.Maps[0].Lines.Keys : Enumerable.Empty<string>()).Take(10))
            _slotPid[i++] = pid;
        _recSeedInfo = title;
        _title.Text = $"{title}｜BO{rec.Format}";
        _t = 0;
        _cursor = 0;
        _killsA = _killsB = 0;
        _aliveA = _aliveB = 5;
        _roundA = _roundB = 0;
        _mapCount = rec.Maps.Count;
        _mapLog.Clear();
        RefreshScore();
    }

    public override void _Process(double delta)
    {
        // auto 审计加速播放（headless 无观感需求；24s/回合 × 56 回合 ≈ 800 实秒远超 CI 超时）
        var allArgs = OS.GetCmdlineArgs().Concat(OS.GetCmdlineUserArgs());
        float dt = (float)delta * (allArgs.Any(a => a.Contains("watch-auto")) ? 20f : 1f);
        _t += dt;
        while (_cursor < _stream.Count && _stream[_cursor].T <= _t)
        {
            Apply(_stream[_cursor]);
            _cursor++;
        }
        foreach (var p in _players) p.Update(dt);
        for (int i = _feed.Count - 1; i >= 0; i--)
        {
            var (row, ttl) = _feed[i];
            float left = ttl - dt;
            if (left <= 0)
            {
                row.QueueFree();
                _feed.RemoveAt(i);
            }
            else
            {
                row.Modulate = new Color(1, 1, 1, Mathf.Min(1, left));
                _feed[i] = (row, left);
            }
        }
        if (!_done && _cursor >= _stream.Count)
        {
            _done = true;
            OnPlaybackDone();
        }
    }

    private void Apply(ReplayEvent e)
    {
        switch (e.Kind)
        {
            case "kill":
                var victim = _players[e.B];
                var killer = _players[e.A];
                victim.Die();
                if (e.A < 5) { _killsA++; _aliveB--; } else { _killsB++; _aliveA--; }
                killer.Flash();
                Kairo.M2.Sfx.Play("kill");
                Banner($"{(e.IgnA.Length > 0 ? e.IgnA : SideName(e.A))} 击倒 {(e.IgnB.Length > 0 ? e.IgnB : SideName(e.B))}{(e.Tag.Length > 0 ? " · " + e.Tag : "")}", avatarPid: _slotPid.GetValueOrDefault(e.A));
                _mapLog.Enqueue($"{SideTag(e.A)}✕{SideTag(e.B)}");
                while (_mapLog.Count > 6) _mapLog.Dequeue();
                _mapWin.Text = string.Join("  ", _mapLog);
                RefreshScore();
                break;
            case "round_win":
                if (e.Side == "A") { _roundA++; _aliveA = 5; _aliveB = 5; } else { _roundB++; _aliveA = 5; _aliveB = 5; }
                for (int i = e.Side == "A" ? 0 : 5; i < (e.Side == "A" ? 5 : 10); i++) _players[i].Cheer();
                for (int i = e.Side == "A" ? 5 : 0; i < (e.Side == "A" ? 10 : 5); i++) _players[i].Revive();
                Kairo.M2.Sfx.Play("roundWin");
                Banner(e.Tag, 1.6f);
                RefreshScore();
                break;
            case "ace":
                Kairo.M2.Sfx.Play("cheer");
                Banner($"{(e.IgnA.Length > 0 ? e.IgnA : SideName(e.A))} 五杀 ACE！", 1.8f, _slotPid.GetValueOrDefault(e.A));
                break;
            case "clutch":
                Banner($"{(e.IgnA.Length > 0 ? e.IgnA : SideName(e.A))} 残局 {e.Tag}", 1.8f, _slotPid.GetValueOrDefault(e.A));
                break;
            case "flawless":
                Banner("完美团灭！", 1.6f);
                break;
            case "map_end":
                Banner(e.Tag, 2.4f);
                _killsA = _killsB = 0;
                _mapLog.Clear();
                _mapWin.Text = "";
                break;
        }
    }

    /// <summary>序号 → 真实 ign（由 Load 传入的全局 ign 表；事件流也带 IgnA/IgnB 直用）。</summary>
    private string SideName(int idx)
    {
        // 序号由 Compile 按 lines 插入序分配；宿主无逐事件 roster 映射时用事件自带 ign。
        return $"P{idx}";
    }

    /// <summary>小地图窗击杀记号：真实队 Tag（Load 时由 sideTags 注入；未注入退化为 A/B）。</summary>
    private string SideTag(int idx) => idx < 5 ? _tagA : _tagB;

    /// <summary>播报行（可带击杀者像素头像）；行容器统一渐隐回收。</summary>
    private void Banner(string text, float ttl = 1.4f, string? avatarPid = null)
    {
        var row = new Control { Position = new Vector2(20, 430 + _feed.Count * 40), Size = new Vector2(680, 36) };
        int textX = 0;
        if (avatarPid != null)
        {
            var av = new TextureRect
            {
                Texture = Kairo.M2.AvatarFactory.Build(avatarPid),
                Position = new Vector2(0, 2),
                Size = new Vector2(32, 32),
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspect,
            };
            row.AddChild(av);
            textX = 40;
        }
        var b = new Label { Position = new Vector2(textX, 0), Size = new Vector2(680 - textX, 36), Text = text };
        b.AddThemeFontOverride("font", _font);
        b.AddThemeFontSizeOverride("font_size", 22);
        row.AddChild(b);
        AddChild(row);
        _feed.Add((row, ttl));
    }

    private void RefreshScore() =>
        _score.Text = $"回合 {_tagA} {_roundA} - {_roundB} {_tagB}\n存活 {_tagA}×{_aliveA}  {_tagB}×{_aliveB}\n击杀 {_killsA} : {_killsB}";

    private void OnPlaybackDone()
    {
        int events = _stream.Count;
        int kills = _stream.Count(e => e.Kind == "kill");
        bool ok = events > 0 && kills > 0 && _roundA + _roundB > 0;
        GD.Print($"[theater-audit] events={events} kills={kills} rounds={_roundA}-{_roundB} ok={ok}");
        GD.Print($"[theater-audit] {(ok ? "PASS" : "FAIL")}");
        GetTree().Quit(ok ? 0 : 1);
    }
}
