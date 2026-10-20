# kairo/ — ACE 开罗版（Godot 4 .NET）

立项与设计口径见 `../design/ACE-电竞经理-开罗版立项方案.md`（当前 v0.3）。仅出 Android APK，不做网页版。

**M0 已完成（2026-10-20）**：出包链路 + 动画管线双验证通过，C# 已在 Android 模拟器（API35）实际执行。真机闸门待补。

## 工具链（本机已装，均不入库）

- **Godot 4.7.2 .NET（mono）便携版**：`G:\WorkLoad\tools\godot\Godot_v4.7.2-stable_mono_win64\`（官方 GitHub Releases 下载）。
- **mono 导出模板**：`%APPDATA%\Godot\export_templates\4.7.2.stable.mono\`（注意目录名带 `.mono`）。
- **Android 构建模板**（本项目内 `android/build/`，已 ignore）：从 mono 模板包的 `android_source.zip` 解压到 `android/build/`，并手放两个标记文件：
  - `android/.build_version`，内容一行：`4.7.2.stable.mono`
  - `android/build/.gdignore`，空文件（防 Godot 扫描）
- **签名**：debug keystore `%USERPROFILE%\.android\debug.keystore`；release keystore `G:\WorkLoad\tools\keys\kairo-release.keystore`（storepass/alias 见方案 §8；**不入库**）。
- **TLS 信任库**（本机 SteamTools 对 github 中间人所致）：`G:\WorkLoad\tools\keys\kairo-cacerts.p12`（JDK cacerts 副本 + SteamTools/GTS 根，storepass `changeit`），经 `android/build/gradle.properties` 的 `systemProp.javax.net.ssl.trustStore*` 注入 gradle。

## 常用命令

```bash
cd /g/WorkLoad/vct/kairo

# 桌面运行 demo（约 9.2s 自退，截图存 %APPDATA%\Godot\app_userdata\kairo\m0\）
G:/WorkLoad/tools/godot/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe --path .

# 像素审计截图（地面真值）
G:/WorkLoad/tools/godot/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe --headless --path . --script res://m0/audit_m0.gd

# Android 导出（必须带 .sln；见下方坑清单）
G:/WorkLoad/tools/godot/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe --editor --path . --export-release "Android" builds/kairo-m0.apk

# 模拟器（API30 镜像 GPU 层仅 ES2 跑不动 Godot4，必须用 API35+）
%LOCALAPPDATA%/Android/Sdk/emulator/emulator.exe -avd Android_API35 -no-window -no-audio -no-boot-anim -gpu host -no-snapshot
adb install -r builds/kairo-m0.apk && adb shell monkey -p com.maplisky.kairo 1
```

## 坑清单（每条都真实踩过）

1. **没有 `kairo.sln` 就静默回退 Standard 模板**：C# 不进 APK、无任何 mono 报错，仅报"实验性"。CLI 导出不生成 sln——用 `dotnet new sln -n kairo && dotnet sln add kairo.csproj` 手动建。
2. **标准版导出会把 .cs 复制进 `android/build/src/main/assets/`**，dotnet 通配再编译一次 → CS0101 重复定义。csproj 已加 `<Compile Remove="android/**/*.cs" />`；`rm -rf android/build/src` 可清残留。
3. **`.build_version` 位置与内容**：放 `android/`（不是 android/build/），内容必须是 `4.7.2.stable.mono`（不带 official hash）。
4. **release 导出必须配 release keystore**（只配 debug 会报"找不到发布密钥库"）。
5. **Java/gradle 证书错误（PKIX）**：本机 SteamTools 中间人 github；用上面的信任库注入。判别方法：`openssl s_client` 看证书 issuer 是不是 `SteamTools Certificate`。
6. **API30 模拟器镜像跑不了 Godot 4**：GPU 翻译层只有 GLES2，报 `EGL_BAD_CONFIG: no ES 3 support`。用 API35+ 镜像 + `-gpu host`。
7. **导出输出目录**（`builds/`）必须预先存在。

## M0 场景结构（m0/）

`Main.tscn` = §3.5 四层分镜微缩版：顶部小地图事件窗 / 调色板小人走路带 / 场馆双方选手+击杀播报 / 底部战绩板。硬编码回放事件流驱动，演出层只消费事件（红线）。桌面像素审计脚本 `audit_m0.gd`（9 项断言）；截图存档 `shots/`。
