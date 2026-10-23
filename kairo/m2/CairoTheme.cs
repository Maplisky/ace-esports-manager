using Godot;

namespace Kairo.M2;

/// <summary>
/// 开罗风格主题色板（ART-POLISH A1）：全局从冷蓝黑转暖棕系——
/// 深暖棕底 + 奶油面板 + 棕描边 + 金色强调 + 粉色标题条（对照开罗《温泉乡 2》《电影物语》官方截图）。
/// 所有场景（GrayBox/Theater/开档/存档/挑队菜单）统一引用本类，保证色彩一致。
/// </summary>
public static class CairoTheme
{
    /// <summary>最深底色（菜单/覆盖层背景）：深暖棕。</summary>
    public static Color BgDeep => Color.FromHtml("#241a10");
    /// <summary>次深底色（面板/日志区）：暗棕。</summary>
    public static Color BgPanel => Color.FromHtml("#332416");
    /// <summary>面板标题条：开罗粉。</summary>
    public static Color TitlePink => Color.FromHtml("#d05a8c");
    /// <summary>奶油面板/按钮底。</summary>
    public static Color Cream => Color.FromHtml("#f5e7c8");
    /// <summary>棕描边。</summary>
    public static Color BorderBrown => Color.FromHtml("#8a5a2a");
    /// <summary>深色文字（奶油底上）。</summary>
    public static Color InkOnCream => Color.FromHtml("#3a2a18");
    /// <summary>暖奶油文字（深底上，替代纯白）。</summary>
    public static Color TextCream => Color.FromHtml("#f4e3c0");
    /// <summary>金色强调（关键数字/胜利）。</summary>
    public static Color AccentGold => Color.FromHtml("#ffd75e");
    /// <summary>暗金描边底（outline 用深棕）。</summary>
    public static Color OutlineDark => Color.FromHtml("#241609");
    /// <summary>格底板（网格外框）：中暖木色。</summary>
    public static Color GridBoard => Color.FromHtml("#5a4028");
    /// <summary>未拥有格：深暖。</summary>
    public static Color CellLocked => Color.FromHtml("#241a10");
    /// <summary>已拥有空地格底：暖褐。</summary>
    public static Color CellEmpty => Color.FromHtml("#4a3826");
    /// <summary>默认格底：暖中褐。</summary>
    public static Color CellDefault => Color.FromHtml("#3a2c1e");
    /// <summary>设施分类色（训练/休息/场馆/商业/辅助——暖移后保留辨识度）。</summary>
    public static System.Collections.Generic.Dictionary<string, Color> CatColors => new()
    {
        ["training"] = Color.FromHtml("#3f8a4f"),
        ["rest"] = Color.FromHtml("#7a6ac0"),
        ["arena"] = Color.FromHtml("#c05a78"),
        ["commerce"] = Color.FromHtml("#c8982f"),
        ["support"] = Color.FromHtml("#4f8ac0"),
    };
}
