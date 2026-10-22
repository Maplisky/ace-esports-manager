using Godot;
using Kairo.Core;
using System;
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

    // 设施详情面板（点格子弹出）：容器节点集，Visible 切换
    private readonly List<CanvasItem> _panel = new();
    private readonly List<Button> _buildBtns = new();
    private Button _upgBtn = null!;
    private Button _demolishBtn = null!;
    private Label _panelInfo = null!;
    private (int X, int Y)? _selected;

    public const int CellW = 156;
    public const int CellH = 116;
    public const int GridX = 30;
    public const int GridY = 110;

    public override void _Ready()
    {
        // 资产与数据装载（桌面：res:// 即工程目录；设备端由应用层 GlobalizePath 解析）
        string dataDir = ProjectSettings.GlobalizePath("res://Core.Data");
        Worldgen.LoadData(dataDir);
        BaseOps.DataDirOverride = dataDir;

        _font = new SystemFont { FontNames = new[] { "Microsoft YaHei UI", "Microsoft YaHei", "sans-serif" } };
        Sfx.Init(this);
        _life = new BaseLife(this, _font);
        LoadWorld();
        BuildUi();
        BuildStartMenu();
        Redraw();
        if (OS.GetCmdlineUserArgs().Contains("--graybox-auto"))
        {
            // 自动审计走自定义开局（覆盖最长的代码路径：建队/签约/赛程重建）
            DoStart(new StartConfig { Mode = StartMode.Custom, TeamName = "自动验证队" });
            RunAutoAudit();
        }
    }

    private BaseLife _life = null!;

    private void LoadWorld()
    {
        Fixtures.ResetFixtureSeq();
        _state = Worldgen.GenerateWorld(42, resetSeq: true);
        DaySim.InitSeasonFixtures(_state);
        _logLines.Clear();
    }

    /// <summary>启动实验（m0 方法论）：headless 脚本化跑一段赛季 + 经济自检 + 自退。</summary>
    private void RunAutoAudit()
    {
        Log("[auto] 脚本化灰盒实验开始");
        BuyPlot();
        BuildRange();   // 空地 → range
        BuildRange();   // 第二座（升级其一）
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

    // ── 开档菜单（立项 §3.1 三选：2026-10-22 拍板 a/b/c 全开放）──

    private readonly List<CanvasItem> _menu = new();
    private LineEdit _nameInput = null!;

    private void BuildStartMenu()
    {
        var back = new ColorRect { Position = new Vector2(0, 0), Size = new Vector2(720, 1280), Color = Color.FromHtml("#0d141b") };
        AddChild(back);
        _menu.Add(back);
        var title = new Label { Position = new Vector2(0, 200), Size = new Vector2(720, 90), Text = "VCT冠军经理", HorizontalAlignment = HorizontalAlignment.Center };
        title.AddThemeFontOverride("font", _font);
        title.AddThemeFontSizeOverride("font_size", 52);
        AddChild(title);
        _menu.Add(title);
        var sub = new Label { Position = new Vector2(0, 292), Size = new Vector2(720, 40), Text = "—— 白手起家 · 基地从零到有 ——", HorizontalAlignment = HorizontalAlignment.Center };
        sub.AddThemeFontOverride("font", _font);
        sub.AddThemeFontSizeOverride("font_size", 20);
        AddChild(sub);
        _menu.Add(sub);

        _nameInput = new LineEdit { Position = new Vector2(160, 400), Size = new Vector2(400, 70), Text = "我的战队", PlaceholderText = "输入战队名" };
        _nameInput.AddThemeFontOverride("font", _font);
        _nameInput.AddThemeFontSizeOverride("font_size", 24);
        AddChild(_nameInput);
        _menu.Add(_nameInput);

        MenuButton("(a) 原创加盟 · $5M · 自由市场签 5 人", 520, () =>
            DoStart(new StartConfig { Mode = StartMode.Custom, TeamName = _nameInput.Text }));
        MenuButton("(b) 接管最弱挑战者队 · 改名", 620, () =>
            DoStart(new StartConfig { Mode = StartMode.Takeover, TeamName = _nameInput.Text }));
        MenuButton("(c) 剧本「欠薪弱旅」· 仅 $800K", 720, () =>
            DoStart(new StartConfig { Mode = StartMode.Script }));
        MenuButton("重开世界（换 seed 前的占位）", 860, () => { LoadWorld(); Redraw(); });
    }

    private void MenuButton(string text, int y, System.Action onClick)
    {
        var b = new Button { Position = new Vector2(110, y), Size = new Vector2(500, 80), Text = text };
        b.AddThemeFontOverride("font", _font);
        b.AddThemeFontSizeOverride("font_size", 20);
        b.Pressed += onClick;
        AddChild(b);
        _menu.Add(b);
    }

    private StartMode _startMode = StartMode.Script;

    private void DoStart(StartConfig cfg)
    {
        _startMode = cfg.Mode;
        var log = NewGame.Start(_state, cfg);
        Career.InitCareer(_state, "analyst");
        foreach (var line in log) Log(line);
        SetMenuVisible(false);
        Redraw();
    }

    private void SetMenuVisible(bool visible)
    {
        foreach (var n in _menu) n.Visible = visible;
    }

    // 旧 NewGame() 已由 LoadWorld() + 开档菜单（DoStart）取代

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

        _log = new Label { Position = new Vector2(20, 928), Size = new Vector2(680, 96) };
        _log.AddThemeFontOverride("font", _font);
        _log.AddThemeFontSizeOverride("font_size", 15);
        AddChild(_log);

        // 赛程/财务分页视图（覆盖网格+日志区；ShowPage 切换可见性）
        _pageView = new Label { Position = new Vector2(20, 110), Size = new Vector2(680, 914), Visible = false };
        _pageView.AddThemeFontOverride("font", _font);
        _pageView.AddThemeFontSizeOverride("font_size", 18);
        AddChild(_pageView);

        // 设施详情面板（默认隐藏；点格子弹出——立项 §11-6：详情走点按面板，不依赖缩放）
        var back = new ColorRect { Position = new Vector2(20, 640), Size = new Vector2(680, 276), Color = Color.FromHtml("#101820ee") };
        AddChild(back);
        _panel.Add(back);
        _panelInfo = new Label { Position = new Vector2(36, 650), Size = new Vector2(648, 90) };
        _panelInfo.AddThemeFontOverride("font", _font);
        _panelInfo.AddThemeFontSizeOverride("font_size", 18);
        AddChild(_panelInfo);
        _panel.Add(_panelInfo);
        PanelButton("升级", new Vector2(36, 748), () => UpgradeAt(_selected!.Value.X, _selected!.Value.Y), isBuild: false);
        PanelButton("拆除", new Vector2(216, 748), () => DemolishAt(_selected!.Value.X, _selected!.Value.Y), isBuild: false);
        PanelButton("射击房", new Vector2(36, 748), () => BuildAt(_selected!.Value.X, _selected!.Value.Y, "range"));
        PanelButton("商店", new Vector2(216, 748), () => BuildAt(_selected!.Value.X, _selected!.Value.Y, "shop"));
        PanelButton("场馆", new Vector2(396, 748), () => BuildAt(_selected!.Value.X, _selected!.Value.Y, "arena"));
        PanelButton("宿舍", new Vector2(556, 748), () => BuildAt(_selected!.Value.X, _selected!.Value.Y, "dorm"));
        PanelButton("关闭", new Vector2(556, 838), () => { _selected = null; Redraw(); }, isBuild: false);
        SetPanelVisible(false);

        AddButton("推进 1 天", new Vector2(20, 1032), () => Advance(1));
        AddButton("推进 7 天", new Vector2(260, 1032), () => Advance(7));
        AddButton("推进 30 天", new Vector2(500, 1032), () => Advance(30));
        AddButton("购地", new Vector2(20, 1120), BuyPlot);
        AddButton("建射击房", new Vector2(260, 1120), BuildRange);
        AddButton("全队练意识", new Vector2(500, 1120), TrainAwareness);
        AddButton("基地", new Vector2(20, 1208), () => ShowPage("base"));
        AddButton("观赏", new Vector2(160, 1208), () => ShowPage("watch"));
        AddButton("赛程", new Vector2(300, 1208), () => ShowPage("schedule"));
        AddButton("财务", new Vector2(500, 1208), () => ShowPage("finance"));
        AddButton("选手", new Vector2(20, 1120), () => ShowPage("squad"));
        AddButton("市场", new Vector2(260, 1120), () => ShowPage("market"));
        AddButton("赞助", new Vector2(500, 1120), () => ShowPage("biz"));
        // 行动按钮（基地页=推进/购地/建造/课表；选手页=选择/课表/续约/挂牌/解约；市场页=选择/出价/答复报价；赞助页=签赞助/接邀约）
        _act1 = AddButton("推进 1 天", new Vector2(20, 1032), () => { if (_page == "market") SelectNextFree(); else if (_page == "squad" || _page == "biz") SelectNextSquad(); else Advance(1); });
        _act2 = AddButton("推进 7 天", new Vector2(260, 1032), () => { if (_page == "market") SignFree(); else if (_page == "squad") CycleFocus(); else if (_page == "biz") SignSponsor(); else Advance(7); });
        _act3 = AddButton("推进 30 天", new Vector2(500, 1032), () => { if (_page == "market") RespondBid(true); else if (_page == "squad") RenewContract(); else if (_page == "biz") AcceptGigOne(); else Advance(30); });
        _act4 = AddButton("购地", new Vector2(20, 1120), () => { if (_page == "market") RespondBid(false); else if (_page == "squad") ToggleListed(); else BuyPlot(); });
        _act5 = AddButton("建射击房", new Vector2(260, 1120), () => { if (_page == "squad") ReleaseOne(); else BuildRange(); });
        _act6 = AddButton("全队练意识", new Vector2(500, 1120), TrainAwareness);
        _restartBtn = AddButton("菜单", new Vector2(560, 1208), () => { LoadWorld(); SetMenuVisible(true); });
        // 存档槽位按钮（1-3：点按=保存；Shift+点按=读档——灰盒简式；正式版走存档菜单）
        for (int i = 0; i < 3; i++)
        {
            int slot = i + 1;
            var b = AddButton($"存{sLotLabel(slot)}", new Vector2(20 + i * 220, 960), () => DoSave(slot));
            _saveBtns.Add(b);
        }
    }

    private static string sLotLabel(int slot) => slot switch { 1 => "①", 2 => "②", 3 => "③", _ => slot.ToString() };
    private readonly List<Button> _saveBtns = new();

    /// <summary>保存到槽位（user://saves；SaveSystem 目录由宿主解析）。</summary>
    private void DoSave(int slot)
    {
        try
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(ProjectSettings.GlobalizePath("user://")) ?? ".", "saves");
            SaveSystem.Save(_state, dir, slot, _startMode.ToString());
            Sfx.Play("save");
            Log($"已存入槽位 {sLotLabel(slot)}（Y{_state.Year} D{_state.Day}）");
        }
        catch (Exception ex)
        {
            Log($"存档失败：{ex.Message}");
        }
    }

    private Button _act1 = null!, _act2 = null!, _act3 = null!, _act4 = null!, _act5 = null!, _act6 = null!;

    // ── 分页视图（立项 §3.3：赛事/财务概览开罗化轻量版）──

    private string _page = "base";
    private Label _pageView = null!;
    private Button _restartBtn = null!;

    private void ShowPage(string page)
    {
        // 观赏页：点按时编译最近一场已打比赛的真实 MatchRecord → 回放时间轴
        if (page == "watch") StartWatch();
        if (page != "squad")
        {
            foreach (var a in _avatars) a.QueueFree(); // 头像列只属于选手页
            _avatars.Clear();
        }
        _page = page;
        _pageView.Visible = page != "base";
        _restartBtn.Visible = page == "base";
        Redraw();
    }

    // ── 选手页（开罗式经营核心环：阵容/属性/合同/课表）──

    /// <summary>选手页 + 行动菜单复合状态：选中选手 id。</summary>
    private string? _selPlayer;
    /// <summary>市场页选中的自由人 id。</summary>
    private string? _selFree;

    private string SquadPageText()
    {
        RefreshAvatars();
        var team = _state.Teams[_state.MyTeamId!];
        var lines = new List<string> { $"── {team.Name} · 阵容 {team.Roster.Count}/7（资金 ${team.Budget / 1000.0:F0}K）──" };
        foreach (var pid in team.Roster)
        {
            if (!_state.Players.TryGetValue(pid, out var p)) continue;
            string mark = pid == _selPlayer ? "▶" : " ";
            lines.Add($"{mark}{p.Ign} {p.Overall} ({p.Potential})｜{p.Age}岁 ${p.Salary / 1000.0:F0}K×{p.ContractYears}年｜{RoleCn(p.PromisedRole)}｜疲劳 {(int)p.Fatigue} 士气 {(int)p.Morale}｜课表 {FocusCn(_state.Schedules.TryGetValue(pid, out var f) ? f : "rest")}");
        }
        if (_selPlayer != null && _state.Players.TryGetValue(_selPlayer, out var sel) && sel.TeamId == _state.MyTeamId)
        {
            lines.Add($"── {sel.Ign} 明细 ──");
            lines.Add($"八维：枪法 {(int)sel.Attrs.Aim} 反应 {(int)sel.Attrs.Reaction} 意识 {(int)sel.Attrs.Awareness} 服务 {(int)sel.Attrs.Utility} 残局 {(int)sel.Attrs.Clutch} 配合 {(int)sel.Attrs.Teamwork} 沟通 {(int)sel.Attrs.Communication} 指挥 {(int)sel.Attrs.Igl}");
            lines.Add($"经验：{string.Join(" ", sel.Xp.Select(kv => $"{CnAttr(kv.Key)}{kv.Value:F0}").Take(4))}｜身价 ${Transfer.MarketValue(sel, team.Tier) / 1000}K");
            lines.Add($"期望薪资（t{team.Tier}）${Transfer.SalaryExpectation(sel, team.Tier) / 1000.0:F0}K/年");
        }
        lines.Add("── 底部按钮：课表/续约/挂牌/解约 ──");
        return string.Join("\n", lines);
    }

    private static string RoleCn(string role) => role switch
    {
        "core" => "核心", "starter" => "首发", "rotation" => "轮换", _ => "替补",
    };

    private static string FocusCn(string key) => key switch
    {
        "aim" => "枪法", "reaction" => "反应", "awareness" => "意识", "utility" => "服务",
        "clutch" => "残局", "teamwork" => "配合", "communication" => "沟通", "igl" => "指挥",
        "rest" => "休息", _ => key,
    };

    private static string CnAttr(string key) => key switch
    {
        "aim" => "枪", "reaction" => "反", "awareness" => "识", "utility" => "务",
        "clutch" => "残", "teamwork" => "配", "communication" => "通", "igl" => "指", _ => key,
    };

    /// <summary>选手行动按钮动作（对选中选手循环切课表 / 续约 / 挂牌 / 解约）。</summary>
    private void CycleFocus()
    {
        if (_selPlayer == null) { Log("先在选手列表选中一人。"); return; }
        var keys = new[] { "aim", "reaction", "awareness", "utility", "clutch", "teamwork", "communication", "igl", "rest" };
        var cur = _state.Schedules.TryGetValue(_selPlayer, out var f) ? f : "rest";
        int idx = (System.Array.IndexOf(keys, cur) + 1) % keys.Length;
        _state.Schedules[_selPlayer] = keys[idx];
        Log($"{_state.Players[_selPlayer].Ign} 课表 → {FocusCn(keys[idx])}（周结算生效）");
    }

    private void RenewContract()
    {
        if (_selPlayer == null || !_state.Players.TryGetValue(_selPlayer, out var p)) return;
        int cost = p.Salary; // 续约签字费 = 一年年薪（开罗式简单口径）
        var team = _state.Teams[_state.MyTeamId!];
        if (team.Budget < cost) { Log($"资金不足（续约需 ${cost / 1000}K 签字费）。"); return; }
        team.Budget -= cost;
        Finance.LogFinance(_state, $"续约 · {p.Ign}", -cost);
        p.ContractYears = Math.Min(5, p.ContractYears + 2);
        p.Morale = MathUtil.Clamp(p.Morale + 5, 10, 100);
        Log($"{p.Ign} 续约 +2 年（${p.Salary / 1000.0:F0}K/年），签字费 ${cost / 1000}K，士气 +5");
        Redraw();
    }

    private void ToggleListed()
    {
        if (_selPlayer == null || !_state.Players.TryGetValue(_selPlayer, out var p)) return;
        p.Listed = !p.Listed;
        p.ListedWeeks = 0;
        Log(p.Listed == true ? $"{p.Ign} 放上挂牌名单（AI 摘牌概率上升，士气 -3）" : $"{p.Ign} 撤下挂牌名单");
        if (p.Listed == true) p.Morale = MathUtil.Clamp(p.Morale - 3, 10, 100);
        Redraw();
    }

    private void ReleaseOne()
    {
        if (_selPlayer == null) return;
        string text = Transfer.ReleasePlayer(_state, _selPlayer);
        Log(text);
        _selPlayer = null;
        Redraw();
    }

    // ── 市场页（自由签约 + 谈判环）──

    private List<Player> FreePool()
    {
        return _state.Players.Values
            .Where(p => p.TeamId == null)
            .OrderByDescending(p => p.Overall)
            .ThenBy(p => p.Id, StringComparer.Ordinal)
            .Take(12)
            .ToList();
    }

    /// <summary>选手页头像列（右侧 x=660；程序化像素脸，同 id 同脸）。离开页签即清除。</summary>
    private readonly List<TextureRect> _avatars = new();

    private void RefreshAvatars()
    {
        foreach (var a in _avatars) a.QueueFree();
        _avatars.Clear();
        var roster = _state.Teams[_state.MyTeamId!].Roster;
        for (int i = 0; i < roster.Count; i++)
        {
            if (!_state.Players.TryGetValue(roster[i], out var p)) continue;
            var rect = new TextureRect
            {
                Texture = AvatarFactory.Build(p.Id),
                Position = new Vector2(660, 160 + i * 46),
                CustomMinimumSize = new Vector2(32, 32),
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspect,
            };
            AddChild(rect);
            _avatars.Add(rect);
        }
    }

    private string MarketPageText()
    {
        bool window = Transfer.InTransferWindow(_state.Day);
        var grace = Transfer.GraceRemain(_state);
        var lines = new List<string>
        {
            $"── 自由市场（{(window ? $"开放，窗余 {grace} 天" : "未开放——季前 8-24 / 夏窗 123-152 / 休赛 233+")}）──",
        };
        foreach (var p in FreePool())
        {
            string mark = p.Id == _selFree ? "▶" : " ";
            lines.Add($"{mark}{p.Ign} {p.Overall} ({p.Potential}) {p.Age}岁｜身价 ${Transfer.MarketValue(p, 2) / 1000}K｜期望 ${Transfer.SalaryExpectation(p, 2) / 1000.0:F0}K/年");
        }
        if (_selFree != null && _state.Players.TryGetValue(_selFree, out var sel))
        {
            lines.Add($"── 报价 {sel.Ign} ──：底部「出价签约」按 期望薪资×1.2 · 3 年 · 核心位 直接开谈（态度实时评估）。");
        }
        // 我队收到的 AI 报价
        if (_state.IncomingBids.Count > 0)
        {
            lines.Add("── AI 对我队报价 ──");
            foreach (var b in _state.IncomingBids)
            {
                var p = _state.Players.TryGetValue(b.PlayerId, out var bp) ? bp : null;
                lines.Add($"{p?.Ign ?? b.PlayerId}｜${b.Fee / 1000}K｜「接受/拒绝」见按钮");
            }
        }
        return string.Join("\n", lines);
    }

    private void SelectNextSquad()
    {
        var roster = _state.Teams[_state.MyTeamId!].Roster;
        if (roster.Count == 0) return;
        int idx = _selPlayer == null ? -1 : roster.IndexOf(_selPlayer);
        _selPlayer = roster[(idx + 1) % roster.Count];
        Redraw();
    }

    private void SelectNextFree()
    {
        var pool = FreePool();
        if (pool.Count == 0) return;
        int idx = _selFree == null ? -1 : pool.FindIndex(p => p.Id == _selFree);
        _selFree = pool[(idx + 1) % pool.Count].Id;
        Redraw();
    }

    /// <summary>自由签约：报价 → 即时谈判（StartNegotiation）→ FinalizeOffer → 成交 CompleteTransfer。</summary>
    private void SignFree()
    {
        if (_selFree == null || !_state.Players.TryGetValue(_selFree, out var p)) { Log("先在市场列表选中一名自由人。"); return; }
        var team = _state.Teams[_state.MyTeamId!];
        if (!Transfer.InTransferWindow(_state.Day)) { Log("转会窗未开放。"); return; }
        if (team.Roster.Count >= 7) { Log("阵容已满（7 人）。"); return; }
        int salary = (int)(Transfer.SalaryExpectation(p, team.Tier) * 1.2);
        var offer = new TransferOffer
        {
            Id = $"GD{_state.Day}_{p.Id}",
            PlayerId = p.Id,
            FromTeam = null, // 自由签约
            ToTeam = team.Id,
            Fee = 0,
            Salary = salary,
            Years = 3,
            SigningBonus = salary / 2,
            PromisedRole = "starter",
        };
        var rng = new Rng((uint)Rng.HashString($"sign:{_state.Seed}:{_state.Day}:{p.Id}"));
        var (_, attitude, insulting) = Transfer.StartNegotiation(_state, offer);
        if (insulting) { Log($"{p.Ign} 认为报价缺乏诚意（态度 {attitude}）。"); return; }
        var fin = Transfer.FinalizeOffer(_state, offer, rng);
        if (!fin.Accepted) { Log(fin.Reason); return; }
        var notes = Transfer.CompleteTransfer(_state, offer, rng);
        foreach (var n in notes) Log(n);
        Log($"{p.Ign} 加盟：${salary / 1000.0:F0}K/年 × 3 年（签字费 ${offer.SigningBonus / 1000}K，态度 {attitude}）");
        _selFree = null;
        Redraw();
    }

    private void RespondBid(bool accept)
    {
        var bid = _state.IncomingBids.FirstOrDefault();
        if (bid == null) { Log("没有待答复的报价。"); return; }
        var p = _state.Players.TryGetValue(bid.PlayerId, out var bp) ? bp : null;
        if (accept)
        {
            var rng = new Rng((uint)Rng.HashString($"bid:{_state.Seed}:{_state.Day}:{bid.PlayerId}"));
            var notes = Transfer.CompleteTransfer(_state, bid, rng);
            foreach (var n in notes) Log(n);
        }
        else
        {
            if (p != null) p.Morale = MathUtil.Clamp(p.Morale - 4, 10, 100);
            Log($"已拒绝对 {p?.Ign ?? bid.PlayerId} 的报价（士气 -4）。");
        }
        _state.IncomingBids.Remove(bid);
        Redraw();
    }

    // ── 赞助页（商务环：意向签约 + 邀约处理）──

    private string BizPageText()
    {
        var team = _state.Teams[_state.MyTeamId!];
        int slots = team.Reputation >= 60 ? 4 : team.Reputation >= 35 ? 3 : 2;
        var lines = new List<string> { $"── 赞助 {team.Sponsors.Count}/{slots}（声望 {team.Reputation}）──" };
        foreach (var s in team.Sponsors)
        {
            lines.Add($"{s.Name}｜{(s.Tier == 3 ? "国际" : s.Tier == 2 ? "国民" : "地方")}品牌｜${s.PerSeason / 1000}K/赛季×{s.Years}年");
        }
        lines.Add("── 意向池（底部「签赞助」逐一检定）──");
        foreach (var o in _state.SponsorOffers)
        {
            lines.Add($"{o.Name}｜{o.Tier} 档｜${o.PerSeason / 1000}K/赛季×{o.Years}年（{Math.Max(0, o.Expires - _state.Day)} 天后过期）");
        }
        lines.Add($"── 商务邀约 {_state.GigOffers.Count} 条（「接邀约」= 进账+占训练日）──");
        foreach (var g in _state.GigOffers.Take(4))
        {
            var p = _state.Players.TryGetValue(g.PlayerId, out var gp) ? gp : null;
            lines.Add($"{g.Brand} × {p?.Ign ?? "?"}｜${g.Pay / 1000}K");
        }
        return string.Join("\n", lines);
    }

    private void SignSponsor()
    {
        var rng = new Rng((uint)Rng.HashString($"sp:{_state.Seed}:{_state.Day}"));
        var offer = _state.SponsorOffers.FirstOrDefault();
        if (offer == null) { Log("意向池为空（随周刷新）。"); return; }
        var (ok, text) = Business.SignSponsorOffer(_state, offer, rng);
        Log(text);
        _ = ok;
        Redraw();
    }

    private void AcceptGigOne()
    {
        var gig = _state.GigOffers.FirstOrDefault();
        if (gig == null) { Log("没有待处理的邀约。"); return; }
        var (ok, text) = Business.AcceptGig(_state, gig.Id);
        Log(text);
        _ = ok;
        Redraw();
    }

    // ── 观赏页（M3 动画管线预研）：真实 MatchRecord → ReplayStream 时间轴驱动小人演出 ──

    private List<ReplayEvent> _stream = new();
    private float _watchT;
    private int _watchCursor;
    private string _watchTitle = "";
    private int _watchKillsA, _watchKillsB, _watchAliveA = 5, _watchAliveB = 5, _watchRoundA, _watchRoundB;
    private readonly List<Chibi.MiniActor> _watchActors = new();
    private bool _watchActive;

    private void StartWatch()
    {
        var last = _state.Fixtures
            .Where(f => f.Played && (f.TeamA == _state.MyTeamId || f.TeamB == _state.MyTeamId))
            .OrderByDescending(f => f.Day).FirstOrDefault();
        if (last == null) { Log("还没有已完成的比赛。"); return; }
        long seed = Rng.HashString($"{_state.Seed}:{last.Id}");
        var rec = Match.SimMatch(_state, last.TeamA, last.TeamB, last.Bo, seed, last.Id, last.MapLock, last.AgentLock);
        _stream = ReplayStream.Compile(rec, _state.Players.Values.ToDictionary(p => p.Id, p => p.Ign));
        _watchT = 0;
        _watchCursor = 0;
        _watchKillsA = _watchKillsB = 0;
        _watchAliveA = _watchAliveB = 5;
        _watchRoundA = _watchRoundB = 0;
        _watchTitle = $"{_state.Teams[last.TeamA].Tag} vs {_state.Teams[last.TeamB].Tag}（重模拟同 seed 回放）";
        if (_watchActors.Count == 0)
        {
            for (int i = 0; i < 10; i++)
            {
                var actor = new Chibi.MiniActor();
                actor.Init(this, i < 5);
                _watchActors.Add(actor);
            }
        }
        foreach (var a in _watchActors) a.Reset();
        _watchActive = true;
        Log($"观赏：重放 {_watchTitle}，时间轴 {_stream.Count} 事件 / {_stream.Count} 条");
    }

    /// <summary>观赏页时间轴推进（每帧）。</summary>
    private void WatchTick(float dt)
    {
        if (!_watchActive) return;
        _watchT += dt;
        while (_watchCursor < _stream.Count && _stream[_watchCursor].T <= _watchT)
        {
            ApplyWatchEvent(_stream[_watchCursor]);
            _watchCursor++;
        }
        foreach (var a in _watchActors) a.Update(dt);
        var last = _watchCursor > 0 ? _stream[Math.Min(_watchCursor, _stream.Count) - 1] : null;
        string lastText = last == null ? "" : last.Kind switch
        {
            "kill" => $"{(last.IgnA.Length > 0 ? last.IgnA : $"P{last.A}")} 击倒 {(last.IgnB.Length > 0 ? last.IgnB : $"P{last.B}")}{(last.Tag.Length > 0 ? " · " + last.Tag : "")}",
            "ace" => $"{(last.IgnA.Length > 0 ? last.IgnA : $"P{last.A}")} 五杀 ACE！",
            "clutch" => $"{(last.IgnA.Length > 0 ? last.IgnA : $"P{last.A}")} 残局 {last.Tag}",
            _ => last.Tag,
        };
        _pageView.Text = _watchTitle + "\n\n" + string.Join("\n", _watchActors.Select((a, i) =>
            $"{(i < 5 ? "A" : "B")}{i % 5 + 1} {(a.Dead ? "✖" : "●")}").Chunk(5).Select(g => string.Join("  ", g))) +
            $"\n\n回合 {_watchRoundA}-{_watchRoundB}｜击杀 {_watchKillsA}-{_watchKillsB}｜存活 {_watchAliveA}-{_watchAliveB}" +
            $"\n\n播报：{lastText}";
        if (_watchCursor >= _stream.Count)
        {
            _watchActive = false;
            _pageView.Text += "\n\n—— 回放结束 ——";
        }
    }

    private void ApplyWatchEvent(ReplayEvent e)
    {
        switch (e.Kind)
        {
            case "kill":
                var victim = _watchActors[e.B];
                victim.Dead = true;
                if (e.A < 5) { _watchKillsA++; _watchAliveB--; } else { _watchKillsB++; _watchAliveA--; }
                _watchActors[e.A].Flash();
                break;
            case "round_win":
                if (e.Side == "A") { _watchRoundA++; _watchAliveA = 5; _watchAliveB = 5; }
                else { _watchRoundB++; _watchAliveA = 5; _watchAliveB = 5; }
                for (int i = e.Side == "A" ? 0 : 5; i < (e.Side == "A" ? 5 : 10); i++) _watchActors[i].Cheer();
                for (int i = e.Side == "A" ? 5 : 0; i < (e.Side == "A" ? 10 : 5); i++) _watchActors[i].Dead = false;
                break;
            case "map_end":
                foreach (var a in _watchActors) { a.Dead = false; a.Cheer(); }
                _watchKillsA = _watchKillsB = 0;
                break;
        }
    }

    /// <summary>赛程页：我的比赛前后 4 场 + 积分榜前 4（联赛主视角）。</summary>
    private string SchedulePageText()
    {
        var lines = new List<string>();
        var my = _state.MyTeamId!;
        var upcoming = _state.Fixtures
            .Where(f => !f.Played && (f.TeamA == my || f.TeamB == my))
            .OrderBy(f => f.Day).Take(4);
        foreach (var f in upcoming)
        {
            string home = f.TeamA == my ? "主" : "客";
            var oppId = f.TeamA == my ? f.TeamB : f.TeamA;
            lines.Add($"D{f.Day} {home} vs {(_state.Teams.TryGetValue(oppId, out var ot) ? ot.Tag : oppId)}｜{f.Label}");
        }
        var past = _state.Fixtures
            .Where(f => f.Played && (f.TeamA == my || f.TeamB == my) && f.WinnerTeamId != null)
            .OrderByDescending(f => f.Day).Take(4);
        foreach (var f in past)
        {
            bool won = f.WinnerTeamId == my;
            lines.Add($"（{f.Day}日）{(won ? "胜" : "负")}｜{f.Label}");
        }
        // 我队所在挑战者联赛积分榜前 4
        var compKey = $"stage2-{_state.Teams[my].RegionId}-t2";
        if (_state.Comps.TryGetValue(compKey, out var comp))
        {
            var table = comp.Standings.Values
                .OrderByDescending(s => s.Pts).ThenByDescending(s => s.MapW - s.MapL)
                .Take(4).ToList();
            lines.Add("── 挑战者联赛积分 ──");
            foreach (var s in table)
            {
                string mark = s.TeamId == my ? "▶" : " ";
                lines.Add($"{mark}{(_state.Teams.TryGetValue(s.TeamId, out var t) ? t.Tag : s.TeamId)} {s.W}胜{s.L}负 {s.Pts}分");
            }
        }
        return string.Join("\n", lines);
    }

    /// <summary>财务页：30 天窗口流水瀑布（期初→末笔）+ 分类占比。</summary>
    private string FinancePageText()
    {
        var win = Finance.GetFinanceWindow(_state);
        var lines = new List<string>
        {
            $"── 30 天现金流（期末 ${win.End / 1000.0:F0}K）──",
        };
        foreach (var (day, balance, label, amount) in win.Steps.Skip(1).TakeLast(10))
        {
            lines.Add($"D{day} {(amount >= 0 ? "+" : "")}{amount / 1000.0:F1}K {label}（余 {balance / 1000.0:F0}K）");
        }
        var breakdown = Finance.FinanceBreakdown(win.Entries);
        if (breakdown.Count > 0)
        {
            lines.Add("── 分类（收入/支出）──");
            foreach (var (cat, income, expense) in breakdown)
            {
                lines.Add($"{Finance.CatCn(cat)} +{income / 1000.0:F0}K / -{expense / 1000.0:F0}K");
            }
        }
        return string.Join("\n", lines);
    }

    private Button PanelButton(string text, Vector2 pos, System.Action onClick, bool isBuild = true)
    {
        var b = new Button { Position = pos, Size = new Vector2(150, 64), Text = text };
        b.AddThemeFontOverride("font", _font);
        b.AddThemeFontSizeOverride("font_size", 19);
        b.Pressed += onClick;
        AddChild(b);
        _panel.Add(b);
        if (isBuild) _buildBtns.Add(b);
        else if (text == "升级") _upgBtn = b;
        else if (text == "拆除") _demolishBtn = b;
        return b;
    }

    private void SetPanelVisible(bool visible)
    {
        foreach (var n in _panel) n.Visible = visible;
    }

    /// <summary>格子点击 → 换算网格坐标弹详情面板（空地给快捷建造，设施给升级/拆除）。</summary>
    public override void _Input(InputEvent e)
    {
        if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } click)
        {
            var pos = GetGlobalMousePosition();
            int gx = (int)((pos.X - GridX) / (CellW + 12));
            int gy = (int)((pos.Y - GridY) / (CellH + 12));
            if (gx >= 0 && gx < 4 && gy >= 0 && gy < 4
                && pos.X >= GridX + gx * (CellW + 12) && pos.X <= GridX + gx * (CellW + 12) + CellW
                && pos.Y >= GridY + gy * (CellH + 12) && pos.Y <= GridY + gy * (CellH + 12) + CellH)
            {
                _selected = (gx, gy);
                Redraw();
            }
        }
    }

    private void BuildAt(int x, int y, string facilityId)
    {
        var err = BaseOps.StartBuild(_state, _state.Base!, x, y, facilityId);
        Log(err ?? $"({x},{y}) 开工 {BaseOps.Table.Facility(facilityId)!.Name}");
        Redraw();
    }    private void UpgradeAt(int x, int y)
    {
        var plot = _state.Base!.Plots[BaseState.KeyOf(x, y)];
        if (plot.BuildingId == null) { Log("空地请先选择设施。"); return; }
        var err = BaseOps.StartBuild(_state, _state.Base!, x, y, plot.BuildingId);
        Log(err ?? $"({x},{y}) 升工 {plot.BuildingId} {plot.PendingLevel} 级");
        Redraw();
    }

    private void DemolishAt(int x, int y)
    {
        var err = BaseOps.Demolish(_state, _state.Base!, x, y);
        Log(err ?? $"({x},{y}) 已拆除（返还 30%）");
        Redraw();
    }

    private Button AddButton(string text, Vector2 pos, System.Action onClick)
    {
        var b = new Button { Position = pos, Size = new Vector2(200, 76), Text = text };
        b.AddThemeFontOverride("font", _font);
        b.AddThemeFontSizeOverride("font_size", 22);
        b.Pressed += onClick;
        AddChild(b);
        return b;
    }

    // ── 操作 ──

    private void Advance(int days)
    {
        var before = SnapshotGrowth();
        var r = AppLoop.Advance(_state, days);
        foreach (var n in r.Notes.TakeLast(6)) Log(n);
        if (_state.Manager.Career?.Ending != null)
            Log($"—— 生涯终局（{_state.Manager.Career.Ending.Kind}）——世界冻结");
        if (_page == "base" || _page == "squad") _life.ShowGrowth(_state, before); // 开罗式成长弹字
        _life.Rebuild(_state); // 施工落成/阵容变动 → 小人重新就位
        Redraw();
    }

    /// <summary>成长快照（弹字 diff 用）：roster 每人经验总量 + overall。</summary>
    private Dictionary<string, (double Xp, int Overall)> SnapshotGrowth()
    {
        var snap = new Dictionary<string, (double, int)>();
        foreach (var pid in _state.Teams[_state.MyTeamId!].Roster)
        {
            if (!_state.Players.TryGetValue(pid, out var p)) continue;
            snap[pid] = (p.Xp.Values.Sum(), p.Overall);
        }
        return snap;
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
        if (_state?.MyTeamId == null || _state.Base == null) return; // 开档菜单阶段：世界未定主队
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
        _log.Text = string.Join("\n", _logLines.TakeLast(12));
        // 行动按钮按页签改语义标签
        switch (_page)
        {
            case "market":
                _act1.Text = "下一位"; _act2.Text = "出价签约"; _act3.Text = "接受报价"; _act4.Text = "拒绝报价";
                break;
            case "biz":
                _act1.Text = "下一位"; _act2.Text = "签赞助"; _act3.Text = "接邀约"; _act4.Text = "—"; _act5.Text = "—"; _act6.Text = "—";
                break;
            case "squad":
                _act1.Text = "下一位"; _act2.Text = "课表"; _act3.Text = "续约"; _act4.Text = "挂牌"; _act5.Text = "解约"; _act6.Text = "—";
                break;
            default:
                _act1.Text = "推进 1 天"; _act2.Text = "推进 7 天"; _act3.Text = "推进 30 天"; _act4.Text = "购地"; _act5.Text = "建射击房"; _act6.Text = "全队练意识";
                break;
        }
        // 分页视图联动（观赏页由 WatchTick 自绘）
        if (_page == "watch" || !_pageView.Visible) return;
        _pageView.Text = _page switch
        {
            "schedule" => SchedulePageText(),
            "finance" => FinancePageText(),
            "squad" => SquadPageText(),
            "market" => MarketPageText(),
            "biz" => BizPageText(),
            _ => "",
        };

        // 详情面板：选中格 → 信息 + 按钮组（空地=建造四选，设施=升级/拆除）
        if (_selected is { } sel && _state.Base!.Plots.TryGetValue(BaseState.KeyOf(sel.X, sel.Y), out var sp))
        {
            SetPanelVisible(true);
            var def = sp.BuildingId != null ? BaseOps.Table.Facility(sp.BuildingId) : null;
            if (def == null)
            {
                _panelInfo.Text = $"({sel.X},{sel.Y}) 空地——选择设施开工：";
                foreach (var btn in _buildBtns) btn.Visible = true;
                _upgBtn.Visible = false;
                _demolishBtn.Visible = false;
            }
            else
            {
                var eff = def.Effects;
                string effText = string.Join(" · ", new[]
                {
                    eff.Facilities.Count > 0 ? $"训练加成 {eff.Get("facilities", Math.Max(1, sp.Level))}" : null,
                    eff.RestBonus.Count > 0 ? $"恢复 +{eff.Get("restBonus", Math.Max(1, sp.Level))}" : null,
                    eff.Morale.Count > 0 ? $"士气 +{eff.Get("morale", Math.Max(1, sp.Level))}" : null,
                    eff.Capacity.Count > 0 ? $"容量 {eff.Get("capacity", Math.Max(1, sp.Level))}" : null,
                    eff.WeeklyIncome.Count > 0 ? $"周收入 {eff.Get("weeklyIncome", Math.Max(1, sp.Level))}" : null,
                }.Where(s => s != null));
                string status = sp.BuildRemainDays > 0 ? $"施工中（剩 {sp.BuildRemainDays} 天，按 {sp.Level} 级产出）" : $"{sp.Level} 级";
                _panelInfo.Text = $"({sel.X},{sel.Y}) {def.Name} · {status}\n{effText}\n下一级造价 {(sp.Level < 3 ? def.Cost[sp.Level].ToString() : "—")}（满 3 级）";
                foreach (var btn in _buildBtns) btn.Visible = false;
                _upgBtn.Visible = sp.Level < 3;
                _demolishBtn.Visible = true;
            }
        }
        else
        {
            SetPanelVisible(false);
        }
    }

    public override void _Process(double delta)
    {
        if (_watchActive) WatchTick((float)delta);
        _life.Update(_state, (float)delta, pageVisible: _page == "base" && _state.Base != null && _state.MyTeamId != null);
    }

    private void Log(string line)
    {
        _logLines.Add(line);
        if (_logLines.Count > 200) _logLines.RemoveRange(0, _logLines.Count - 200);
        if (_log != null) _log.Text = string.Join("\n", _logLines.TakeLast(16));
    }
}
