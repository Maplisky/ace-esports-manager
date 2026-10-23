using Godot;
using System;
using System.Collections.Generic;
using System.IO;

namespace Kairo.M2;

/// <summary>
/// 程序化像素头像（GDD §美术管线：特征驱动量产）：16×16 索引脸，从 pid 哈希确定性生成——
/// 肤色 4 / 发型 6 / 发色 6 / 瞳色 3 / 嘴型 3；人人戴电竞耳机（队色头梁，开罗式统一配件）。
/// 同 id 永远同一张脸（多次导出/跨场景可对照）。
/// AI 精修管线（§7）：精修图放 覆盖目录/{pid}.png 即自动替换程序化生成（宿主经 SetOverrideDir 注入；
/// 缺目录/缺文件回退程序化——量产保底、精修可选，逐实例目检只覆盖小批量）。
/// </summary>
public static class AvatarFactory
{
    public const int Size = 16;

    private static string? _overrideDir;

    /// <summary>精修头像覆盖目录注入点（宿主启动时调用一次；null = 无覆盖，全程序化）。</summary>
    public static void SetOverrideDir(string? dir) => _overrideDir = dir;

    private static readonly string[] SkinTones = { "#f0c8a0", "#e0b088", "#c89068", "#a87050" };
    private static readonly string[] HairColors = { "#3a2a20", "#201810", "#604022", "#807060", "#282830", "#a05018" };
    private static readonly string[] EyeColors = { "#2a3a5a", "#3a5a2a", "#5a2a2a" };
    private static readonly string[] HeadsetColors = { "#d04040", "#3a6ad0", "#38a058", "#d0a020" };

    public static Texture2D Build(string pid)
    {
        // AI 精修覆盖：覆盖目录存在 {pid}.png 时优先用（美术精修路径，小批量目检后入库）
        if (_overrideDir != null)
        {
            string path = System.IO.Path.Combine(_overrideDir, pid + ".png");
            if (File.Exists(path)) return ImageTexture.CreateFromImage(Image.LoadFromFile(path));
        }
        uint h = Kairo.Core.Rng.HashString("avatar:" + pid);
        var skin = Color.FromHtml(SkinTones[h % SkinTones.Length]); h /= (uint)SkinTones.Length;
        var hair = Color.FromHtml(HairColors[h % HairColors.Length]); h /= (uint)HairColors.Length;
        var eye = Color.FromHtml(EyeColors[h % EyeColors.Length]); h /= (uint)EyeColors.Length;
        var headset = Color.FromHtml(HeadsetColors[h % HeadsetColors.Length]); h /= (uint)HeadsetColors.Length;
        int style = (int)(h % 6);
        int mouth = (int)((h / 6) % 3);

        var img = Image.CreateEmpty(Size, Size, false, Image.Format.Rgba8);
        var ink = Color.FromHtml("#181826");
        var white = Color.FromHtml("#f4f6f8");

        // 头型（圆角矩形：x3-12, y3-11）
        Fill(img, 3, 4, 12, 10, skin);
        Fill(img, 4, 3, 11, 3, skin);
        Fill(img, 4, 11, 11, 11, skin);

        // 发型（六式：寸头/短发/刺猬/中分/长发/光头）
        switch (style)
        {
            case 0: Fill(img, 3, 3, 12, 4, hair); break;                    // 寸头
            case 1: Fill(img, 3, 2, 12, 5, hair); break;                    // 短发
            case 2:                                                          // 刺猬
                Fill(img, 3, 2, 12, 4, hair);
                for (int x = 4; x <= 11; x += 2) img.SetPixel(x, 1, hair);
                break;
            case 3:                                                          // 中分
                Fill(img, 3, 2, 12, 4, hair);
                Fill(img, 7, 5, 8, 5, hair);
                break;
            case 4:                                                          // 长发
                Fill(img, 2, 2, 13, 5, hair);
                Fill(img, 2, 6, 3, 12, hair);
                Fill(img, 12, 6, 13, 12, hair);
                break;
                // case 5: 光头（不画发）
        }

        // 眼（白底 + 瞳 + 单像素高光）
        img.SetPixel(5, 7, white); img.SetPixel(6, 7, white);
        img.SetPixel(9, 7, white); img.SetPixel(10, 7, white);
        img.SetPixel(6, 7, eye); img.SetPixel(10, 7, eye);
        img.SetPixel(5, 6, ink); img.SetPixel(10, 6, ink); // 眉

        // 嘴（抿/微笑/张）
        if (mouth == 0) img.SetPixel(7, 10, ink);
        else if (mouth == 1) { img.SetPixel(6, 10, ink); img.SetPixel(7, 10, skin); img.SetPixel(8, 10, ink); }
        else Fill(img, 6, 10, 8, 10, ink);

        // 电竞耳机：头顶横梁 + 双侧耳罩（队色）
        Fill(img, 2, 5, 2, 9, headset);
        Fill(img, 13, 5, 13, 9, headset);
        Fill(img, 1, 6, 1, 8, ink);
        Fill(img, 14, 6, 14, 8, ink);

        return ImageTexture.CreateFromImage(img);
    }

    private static void Fill(Image img, int x0, int y0, int x1, int y1, Color c)
    {
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
                img.SetPixel(x, y, c);
    }
}
