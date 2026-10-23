using Godot;
using System;

namespace Kairo.M2;

/// <summary>
/// 设施立面像素小图（ART-POLISH D2）：16×16 索引图，每设施一张——
/// 射击房=靶心 / 战术室=黑板 / 体能房=哑铃 / 宿舍=床 / 场馆=拱门 / 商店=货架 /
/// 餐饮车=餐车 / 赞助位=广告牌 / 医疗室=十字 / 数据室=屏幕 / 休息室=沙发 / 工作室=摄像机。
/// 风格与小人工厂同源（整数像素、深色描边），放大 4x 铺设施格。
/// </summary>
public static class FacilityArtFactory
{
    public static Texture2D Build(string facilityId, int level)
    {
        var img = Godot.Image.CreateEmpty(16, 16, false, Godot.Image.Format.Rgba8);
        var ink = Color.FromHtml("#181826");
        var wall = Color.FromHtml(level switch { 3 => "#c8b48a", 2 => "#a89878", _ => "#887a60" }); // 等级越高墙越亮
        var roof = Color.FromHtml("#6a4a32");
        var accent = Color.FromHtml("#d05a5a");
        var glass = Color.FromHtml("#7fd4c8");

        // 通用墙体 + 屋顶轮廓
        Fill(img, 2, 6, 13, 14, wall);
        Fill(img, 1, 4, 14, 5, roof);

        switch (facilityId)
        {
            case "range": // 射击房：门 + 靶心
                Fill(img, 6, 9, 9, 14, ink);
                img.SetPixel(7, 10, accent); img.SetPixel(8, 10, accent);
                img.SetPixel(7, 12, accent); img.SetPixel(8, 12, accent);
                img.SetPixel(7, 11, Color.FromHtml("#f4f6f8"));
                break;
            case "tactic": // 战术室：黑板 + 粉笔线
                Fill(img, 3, 8, 12, 13, ink);
                img.SetPixel(5, 10, Color.FromHtml("#7fd4c8")); img.SetPixel(6, 10, Color.FromHtml("#7fd4c8"));
                img.SetPixel(6, 11, Color.FromHtml("#ffd75e"));
                break;
            case "gym": // 体能房：哑铃
                Fill(img, 5, 10, 10, 11, ink);
                Fill(img, 3, 8, 4, 13, ink);
                Fill(img, 11, 8, 12, 13, ink);
                img.SetPixel(7, 9, accent);
                break;
            case "dorm": // 宿舍：床 + 窗
                Fill(img, 3, 8, 12, 13, ink);
                Fill(img, 4, 9, 7, 12, Color.FromHtml("#f4f6f8"));
                img.SetPixel(10, 9, glass); img.SetPixel(11, 9, glass);
                break;
            case "arena": // 场馆：大拱门 + 看台点
                Fill(img, 2, 3, 13, 14, wall);
                Fill(img, 5, 8, 10, 14, ink);
                img.SetPixel(3, 5, accent); img.SetPixel(12, 5, accent);
                img.SetPixel(4, 4, Color.FromHtml("#ffd75e")); img.SetPixel(11, 4, Color.FromHtml("#ffd75e"));
                break;
            case "shop": // 周边店：雨棚 + 货架
                for (int x = 2; x <= 13; x += 2) Fill(img, x, 6, x, 7, accent);
                Fill(img, 3, 9, 12, 13, ink);
                img.SetPixel(5, 11, Color.FromHtml("#ffd75e")); img.SetPixel(9, 11, Color.FromHtml("#7fd4c8"));
                break;
            case "cafe": // 餐饮车：车轮 + 遮阳伞
                Fill(img, 2, 7, 13, 12, wall);
                img.SetPixel(5, 14, ink); img.SetPixel(10, 14, ink);
                Fill(img, 1, 5, 14, 6, accent);
                break;
            case "billboard": // 赞助位：立柱广告牌
                Fill(img, 2, 3, 13, 10, Color.FromHtml("#f4f6f8"));
                Fill(img, 6, 11, 7, 14, ink);
                img.SetPixel(5, 6, accent); img.SetPixel(8, 7, accent);
                break;
            case "clinic": // 医疗室：红十字
                Fill(img, 6, 8, 9, 13, Color.FromHtml("#f4f6f8"));
                Fill(img, 7, 9, 8, 12, accent);
                Fill(img, 6, 10, 9, 11, accent);
                break;
            case "data": // 数据室：屏幕柱
                Fill(img, 4, 6, 11, 13, ink);
                img.SetPixel(5, 8, Color.FromHtml("#7fd4c8")); img.SetPixel(7, 9, Color.FromHtml("#7fd4c8"));
                img.SetPixel(9, 8, Color.FromHtml("#ffd75e"));
                break;
            case "lounge": // 休息室：沙发
                Fill(img, 3, 9, 12, 13, accent);
                Fill(img, 3, 7, 4, 12, accent);
                Fill(img, 11, 7, 12, 12, accent);
                break;
            case "studio": // 工作室：摄像机
                Fill(img, 4, 8, 10, 12, ink);
                Fill(img, 11, 9, 13, 11, ink);
                img.SetPixel(6, 10, Color.FromHtml("#ffd75e"));
                break;
            default: // 未知设施：问号方块
                Fill(img, 3, 5, 12, 14, wall);
                img.SetPixel(7, 8, ink); img.SetPixel(8, 9, ink); img.SetPixel(8, 10, ink);
                img.SetPixel(7, 12, ink);
                break;
        }
        _ = ink; // ink 在部分分支外使用，保留
        return Godot.ImageTexture.CreateFromImage(img);
    }

    private static void Fill(Godot.Image img, int x0, int y0, int x1, int y1, Color c)
    {
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
                img.SetPixel(x, y, c);
    }
}
