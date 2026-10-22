using Godot;
using Kairo.Core;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.M2;

/// <summary>
/// M2 灰盒主循环场景（GDD 开罗版立项 §9 M2：地块/设施/课表训练/比赛日/财务灰盒可玩，
/// 一个赛季 + 基地从零到有跑通）。竖屏 720×1280：顶部状态条 / 中部基地网格 / 下部日志与按钮。
/// 全部经 AppLoop（确定性内核）；无 RNG、无存档——灰盒验证经济曲线与交互闭环。
/// </summary>
public partial class GrayBox : Node2D
{
    private GameState _state = null!;
    private SystemFont _font = null!;
    private Label _top = null!;
    private Label _log = null!;
    private readonly List<string> _logLines = new();
    private readonly List<(ColorRect Rect, Label Text)> _cells = new();

    private const int CellW = 156;
    private const int CellH = 116;
    private const int GridX = 30;
    private const int GridY = 110;

    public override void _Ready()
    {
        // 资产与数据装载（桌面：res:// 即工程目录；设备端由应用层 GlobalizePath 解析）
        string dataDir = ProjectSettings.GlobalizePath("res://Core.Data");
        Worldgen.LoadData(dataDir);
        BaseOps.DataDirOverride = dataDir;

        _font = new SystemFont { FontNames = new[] { "Microsoft YaHei UI", "Microsoft YaHei", "sans-serif" } };
        NewGame();
        BuildUi();
        Redraw();
        if (OS.GetCmdlineUserArgs().Contains("--graybox-auto")) RunAutoAudit();
    }

    /// <summary>启动实验（m0 方法论）：headless 脚本化跑一段赛季 + 经济自检 + 自退。</summary>
    private void RunAutoAudit()
    {
        Log("[auto] 脚本化灰盒实验开始");
        BuyPlot();
        BuildRange();   // (1,0) 或 (0,1) 空地 → range
        BuildRange();   // 另一块空地 → range（升级其中一块）
        TrainAwareness();
        Advance(90);
        var myTeam = _state.Teams[_state.MyTeamId!];
        int facilities = myTeam.Facilities;
        var anyPlayer = _state.Players.Values.First(p => p.TeamId == _state.MyTeamId);
        double xp = anyPlayer.Xp.TryGetValue("awareness", out var aw) ? aw : 0;
        bool ok = facilities >= 3 && _state.Base!.Plots.Count >= 2 && xp > 0 && _state.Day >= 90;
        GD.Print($"[graybox-audit] day={_state.Day} budget={myTeam.Budget:F0} facilities={facilities} plots={_state.Base!.Plots.Count} rosterXpAwareness={xp:F1} ok={ok}");
        GD.Print($"[graybox-audit] {(ok ? "PASS" : "FAIL")}");
        GetTree().Quit(ok ? 0 : 1);
    }

    private void NewGame()
    {
        Fixtures.ResetFixtureSeq();
        _state = Worldgen.GenerateWorld(42, resetSeq: true);
        _state.MyTeamId = _state.Teams.Values.ToList()[0].Id;
        _state.Day = 0;
        Career.InitCareer(_state, "analyst");
        _state.Teams[_state.MyTeamId!].Budget = 5_000_000; // 灰盒起步资金
        _state.Base = BaseOps.NewBase();
        _logLines.Clear();
        Log("灰盒开局：分析师出身 · $5M 起步资金 · 一块空地");
        Log("目标：一个赛季内把基地从零建到有");
    }

    private void BuildUi()
    {
        _top = new Label { Position = new Vector2(20, 14), Size = new Vector2(680, 88) };
        _top.AddThemeFontOverride("font", _font);
        _top.AddThemeFontSizeOverride("font_size", 24);
        AddChild(_top);

        // 基地网格 4×4 底板
        AddChild(new ColorRect { Position = new Vector2(GridX - 6, GridY - 6), Size = new Vector2(CellW * 4 + 18 * 4 + 12, CellH * 4 + 12 * 4 + 12), Color = Color.FromHtml("#20303c") });
        for (int gy = 0; gy < 4; gy++)
        {
            for (int gx = 0; gx < 4; gx++)
            {
                int x = GridX + gx * (CellW + 12);
                int y = GridY + gy * (CellH + 12);
                var rect = new ColorRect { Position = new Vector2(x, y), Size = new Vector2(CellW, CellH), Color = Color.FromHtml("#1a2630") };
                AddChild(rect);
                var text = new Label { Position = new Vector2(x + 6, y + 8), Size = new Vector2(CellW - 12, CellH - 16) };
                text.AddThemeFontOverride("font", _font);
                text.AddThemeFontSizeOverride("font_size", 17);
                AddChild(text);
                _cells.Add((rect, text));
            }
        }

        _log = new Label { Position = new Vector2(20, 720), Size = new Vector2(680, 300) };
        _log.AddThemeFontOverride("font", _font);
        _log.AddThemeFontSizeOverride("font_size", 16);
        AddChild(_log);

        AddButton("推进 1 天", new Vector2(20, 1032), () => Advance(1));
        AddButton("推进 7 天", new Vector2(260, 1032), () => Advance(7));
        AddButton("推进 30 天", new Vector2(500, 1032), () => Advance(30));
        AddButton("购地", new Vector2(20, 1120), BuyPlot);
        AddButton("建射击房", new Vector2(260, 1120), BuildRange);
        AddButton("全队练意识", new Vector2(500, 1120), TrainAwareness);
        AddButton("重开", new Vector2(20, 1208), () => { NewGame(); Redraw(); });
    }

    private void AddButton(string text, Vector2 pos, System.Action onClick)
    {
        var b = new Button { Position = pos, Size = new Vector2(200, 76), Text = text };
        b.AddThemeFontOverride("font", _font);
        b.AddThemeFontSizeOverride("font_size", 22);
        b.Pressed += onClick;
        AddChild(b);
    }

    // ── 操作 ──

    private void Advance(int days)
    {
        var r = AppLoop.Advance(_state, days);
        foreach (var n in r.Notes.TakeLast(6)) Log(n);
        if (_state.Manager.Career?.Ending != null)
            Log($"—— 生涯终局（{_state.Manager.Career.Ending.Kind}）——世界冻结");
        Redraw();
    }

    private void BuyPlot()
    {
        var b = _state.Base!;
        // 环扫：从已有地块向外找第一块相邻空地
        for (int radius = 1; radius <= 4; radius++)
        {
            foreach (var plot in b.Plots.Values.ToList())
            {
                foreach (var (dx, dy) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
                {
                    int x = plot.X + dx * radius, y = plot.Y + dy * radius;
                    if (!b.Plots.ContainsKey(BaseState.KeyOf(x, y)))
                    {
                        var err = BaseOps.BuyPlot(_state, b, x, y);
                        Log(err ?? $"购入地块 ({x},{y})，价 ${BaseOps.PlotPrice(b.Plots.Count - 1) / 1000}K");
                        Redraw();
                        return;
                    }
                }
            }
        }
        Log("没有可购的相邻空地。");
    }

    private void BuildRange()
    {
        var b = _state.Base!;
        // 优先空地新建；全满则升级第一座射击房
        var empty = b.Plots.Values.FirstOrDefault(p => p.BuildingId == null);
        if (empty != null)
        {
            var err = BaseOps.StartBuild(_state, b, empty.X, empty.Y, "range");
            Log(err ?? $"({empty.X},{empty.Y}) 开工射击房 1 级");
        }
        else
        {
            var range = b.Plots.Values.FirstOrDefault(p => p.BuildingId == "range" && p.Level < 3)
                ?? b.Plots.Values.FirstOrDefault(p => p.BuildingId != null && p.Level < 3);
            if (range == null) Log("没有可升级的设施。");
            else
            {
                var err = BaseOps.StartBuild(_state, b, range.X, range.Y, range.BuildingId!);
                Log(err ?? $"({range.X},{range.Y}) 升工 {range.BuildingId} {range.PendingLevel} 级");
            }
        }
        Redraw();
    }

    private void TrainAwareness()
    {
        var myTeam = _state.Teams[_state.MyTeamId!];
        int n = 0;
        foreach (var pid in myTeam.Roster)
        {
            if (_state.Players.TryGetValue(pid, out var p))
            {
                _state.Schedules[pid] = "awareness";
                n++;
            }
        }
        Log($"全队 {n} 人课表 → 意识特训（周结算生效）");
    }

    // ── 渲染 ──

    private static readonly Dictionary<string, string> CatColor = new()
    {
        ["training"] = "#2d6a4f", ["rest"] = "#40597c", ["arena"] = "#7c4067",
        ["commerce"] = "#8a6d1f", ["support"] = "#4c5c8a",
    };

    private void Redraw()
    {
        var myTeam = _state.Teams[_state.MyTeamId!];
        _top.Text = $"Y{_state.Year} D{_state.Day} · {_state.Stage}｜${myTeam.Budget / 1000.0:F0}K｜信任 {_state.BoardConfidence}｜训练加成 +{myTeam.Facilities}";
        int cap = _state.Base != null ? BaseOps.Capacity(_state.Base) : 0;
        if (cap > 0) _top.Text += $"｜场馆 {cap} 座";

        var byKey = new Dictionary<string, PlotState>();
        foreach (var p in _state.Base!.Plots.Values) byKey[BaseState.KeyOf(p.X, p.Y)] = p;
        int i = 0;
        for (int gy = 0; gy < 4; gy++)
        {
            for (int gx = 0; gx < 4; gx++)
            {
                var (rect, text) = _cells[i++];
                string key = BaseState.KeyOf(gx, gy);
                if (!byKey.TryGetValue(key, out var plot))
                {
                    rect.Color = Color.FromHtml("#14202a");
                    text.Text = "";
                    continue;
                }
                if (plot.BuildingId == null)
                {
                    rect.Color = Color.FromHtml("#28394a");
                    text.Text = $"({gx},{gy}) 空地";
                    continue;
                }
                var def = BaseOps.Table.Facility(plot.BuildingId);
                string name = def?.Name ?? plot.BuildingId;
                string cat = def?.Cat ?? "";
                rect.Color = Color.FromHtml(CatColor.GetValueOrDefault(cat, "#3a4a5a"));
                string status = plot.BuildRemainDays > 0 ? $"施工 {plot.BuildRemainDays}天" : $"{plot.Level}级";
                text.Text = $"{name}\n{status}";
            }
        }
        _log.Text = string.Join("\n", _logLines.TakeLast(16));
    }

    private void Log(string line)
    {
        _logLines.Add(line);
        if (_logLines.Count > 200) _logLines.RemoveRange(0, _logLines.Count - 200);
        if (_log != null) _log.Text = string.Join("\n", _logLines.TakeLast(16));
    }
}
