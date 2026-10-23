using Godot;
using System.Collections.Generic;

namespace Kairo.M0;

/// <summary>
/// 程序化像素小人工厂：12×16 索引色小人 + 调色板换装（开罗本家做法）。
/// 帧索引：0-3 = 走路循环，4 = 庆祝（双臂高举）。
/// 索引色：0=透明 1=深色(眼/描边) 2=皮肤 3=头发 4=上衣 5=裤子 6=鞋
/// </summary>
public static class ChibiFactory
{
    public const int W = 12, H = 16;

    public static Color[] Palette(string skin, string hair, string shirt, string pants, string shoe) =>
        new[]
        {
            Colors.Transparent,
            Color.FromHtml("#181826"),
            Color.FromHtml(skin),
            Color.FromHtml(hair),
            Color.FromHtml(shirt),
            Color.FromHtml(pants),
            Color.FromHtml(shoe),
        };

    /// <summary>六套演示队色（走路带用）：红/蓝/绿/金/紫/青。</summary>
    public static readonly Color[][] TeamPalettes =
    {
        Palette("#f0c8a0", "#3a2a20", "#d04040", "#28303e", "#1a1a24"),
        Palette("#e8b890", "#201810", "#3a6ad0", "#2a2e3a", "#16161e"),
        Palette("#f4d0ac", "#503018", "#38a058", "#303a44", "#1a1a24"),
        Palette("#d8a880", "#604022", "#d0a020", "#3a3428", "#201c14"),
        Palette("#f0c8a0", "#282830", "#9048c0", "#2c2a38", "#181826"),
        Palette("#e8c0a0", "#40281c", "#30a8b0", "#28323c", "#181822"),
    };

    private static readonly string[] SkinVariants = { "#f0c8a0", "#e0b088", "#c89068", "#a87050" };
    private static readonly string[] HairVariants = { "#3a2a20", "#201810", "#604022", "#807060", "#282830", "#a05018" };

    /// <summary>队伍 palette：队服固定，皮肤/头发按选手序号变化（量产换装）。</summary>
    public static Color[] TeamPalette(bool teamA, int i)
    {
        Color[] p = TeamPalettes[teamA ? 0 : 1];
        var copy = (Color[])p.Clone();
        copy[2] = Color.FromHtml(SkinVariants[i % SkinVariants.Length]);
        copy[3] = Color.FromHtml(HairVariants[(i * 2 + (teamA ? 0 : 1)) % HairVariants.Length]);
        return copy;
    }

    private static readonly string[] HairColors = { "#3a2a20", "#201810", "#604022", "#807060", "#282830", "#a05018" };

    /// <summary>
    /// 玩家 pid 确定性调色板（M3 扩容）：队服从六套演示色取一，肤色/发色由 pid 哈希派生——
    /// 同 id 永远同一套（与 AvatarFactory 同理念），跨场景可对照。
    /// </summary>
    public static Color[] PlayerPalette(string pid, int shirtShade = 0)
    {
        uint h = Kairo.Core.Rng.HashString("chibi:" + pid);
        var p = (Color[])TeamPalettes[h % (uint)TeamPalettes.Length].Clone();
        p[2] = Color.FromHtml(SkinVariants[h / (uint)SkinVariants.Length % (uint)SkinVariants.Length]);
        p[3] = Color.FromHtml(HairColors[h / (uint)HairColors.Length % (uint)HairColors.Length]);
        if (shirtShade % 2 == 1) p[4] = p[4].Lightened(0.12f); // 同队选手两档明度
        return p;
    }

    public static Texture2D[] BuildFrames(Color[] pal)
    {
        var frames = new Texture2D[5];
        for (int f = 0; f < 5; f++)
        {
            int[,] px = Draw(f);
            var img = Image.CreateEmpty(W, H, false, Image.Format.Rgba8);
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                    img.SetPixel(x, y, pal[px[x, y]]);
            frames[f] = ImageTexture.CreateFromImage(img);
        }
        return frames;
    }

    private static void Fill(int[,] px, int x0, int y0, int x1, int y1, int c)
    {
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
                px[x, y] = c;
    }

    private static int[,] Draw(int frame)
    {
        bool cheer = frame == 4;
        int step = frame;
        var px = new int[W, H];

        // 头（开罗式大头）
        Fill(px, 2, 1, 9, 7, 2);
        Fill(px, 2, 1, 9, 2, 3);          // 头发
        px[2, 3] = 3; px[9, 3] = 3;       // 侧发
        px[4, 5] = 1; px[7, 5] = 1;       // 眼睛

        // 身体
        Fill(px, 3, 8, 8, 12, 4);

        // 手臂
        if (cheer)
        {
            Fill(px, 1, 5, 1, 7, 2);
            Fill(px, 10, 5, 10, 7, 2);
        }
        else
        {
            int swing = step == 1 ? 1 : step == 3 ? -1 : 0;
            for (int y = 0; y <= 2; y++)
            {
                px[2, 8 + swing + y] = 2;
                px[9, 8 - swing + y] = 2;
            }
        }

        // 腿与鞋（走路时左右腿交替抬起）
        if (cheer)
        {
            Fill(px, 4, 13, 7, 13, 5);
            Fill(px, 4, 14, 7, 14, 6);
        }
        else
        {
            Fill(px, 3, 13, 4, 13, 5);
            Fill(px, 7, 13, 8, 13, 5);
            if (step != 1) Fill(px, 3, 14, 4, 14, 6);
            if (step != 3) Fill(px, 7, 14, 8, 14, 6);
        }
        return px;
    }
}
