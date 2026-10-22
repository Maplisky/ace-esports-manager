using Godot;
using System.IO;

namespace Kairo.M2;

/// <summary>
/// 资产桥（M4 打包路径）：编辑器内 Core.Data 是源码目录（GlobalizePath 可直读）；
/// 导出后 res:// 进 PCK 虚拟文件系统，System.IO.File 不可直读而 Godot FileAccess 可以。
/// 统一策略：用 FileAccess 把 Core.Data 导出到 user://core-data/，把该物理目录交给 Core
/// （Core 保持 File API 与引擎无关）。幂等：每次启动覆盖导出（表随版本更新）。
/// </summary>
public static class AssetBridge
{
    public static string ExportDataDir(string resDir)
    {
        var target = new DirectoryInfo(Path.Combine(
            System.IO.Path.GetDirectoryName(ProjectSettings.GlobalizePath("user://")) ?? ".", "core-data"));
        target.Create();
        using var dir = DirAccess.Open(resDir);
        if (dir == null)
            throw new DirectoryNotFoundException($"res dir not found: {resDir} ({DirAccess.GetOpenError()})");
        dir.ListDirBegin();
        string name = dir.GetNext();
        while (name.Length > 0)
        {
            if (!dir.CurrentIsDir() && name.EndsWith(".json"))
            {
                using var src = Godot.FileAccess.Open($"{resDir}/{name}", Godot.FileAccess.ModeFlags.Read);
                string text = src.GetAsText();
                File.WriteAllText(Path.Combine(target.FullName, name), text);
            }
            name = dir.GetNext();
        }
        dir.ListDirEnd();
        return target.FullName;
    }
}
