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

# 桌面运行 demo（约 9.2s 自退；截图存 %APPDATA%\Godot\app_userdata\kairo\m0\；末尾打印 15 项像素自审计结果）
G:/WorkLoad/tools/godot/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe --path .

# Android 导出（必须带 .sln；headless / --editor 均可，见坑清单 8）
G:/WorkLoad/tools/godot/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe --headless --path . --export-release "Android" builds/kairo-m0.apk

# 模拟器（API30 镜像 GPU 层仅 ES2 跑不动 Godot4，必须用 API35+）
%LOCALAPPDATA%/Android/Sdk/emulator/emulator.exe -avd Android_API35 -no-window -no-audio -no-boot-anim -gpu host -no-snapshot
adb install -r builds/kairo-m0.apk && adb shell monkey -p com.maplisky.kairo 1
```

## 启动实验方法（2026-10-20 检错轮沉淀）

1. `adb logcat -c` 后启动，收 `[m0]`（引擎生命周期）与 `[audit]`（10 组 15 项像素断言，内容坐标自适应分辨率，阈值来自桌面基线）两组日志，`[audit] SUMMARY 15/15 PASS` 为过。
2. 错误扫查：按进程 pid 过滤 logcat 的 E/W 级，排除模拟器噪音源（`EGL_emulation`/`eglCodecCommon`/`OpenGLRenderer`/输入法与 Surface 类）。
3. 中断面：HOME（进程应存活、回前台同进程）、BACK（优雅退出，约 2-3s 延迟属正常）、`am force-stop` 连杀连启 ×3（零 FATAL）。
4. 冷启动计时：`am start -W` 的 TotalTime（API35 模拟器基线 ≈475-620ms，含引擎与 mono 初始化）；稳态内存 PSS ≈188MB。

## 坑清单（每条都真实踩过）

1. **没有 `kairo.sln` 就静默回退 Standard 模板**：C# 不进 APK、无任何 mono 报错，仅报"实验性"。CLI 导出不生成 sln——用 `dotnet new sln -n kairo && dotnet sln add kairo.csproj` 手动建。
2. **标准版导出会把 .cs 复制进 `android/build/src/main/assets/`**，dotnet 通配再编译一次 → CS0101 重复定义。csproj 已加 `<Compile Remove="android/**/*.cs" />`；`rm -rf android/build/src` 可清残留。
3. **`.build_version` 位置与内容**：放 `android/`（不是 android/build/），内容必须是 `4.7.2.stable.mono`（不带 official hash）。
4. **release 导出必须配 release keystore**（只配 debug 会报"找不到发布密钥库"）。
5. **Java/gradle 证书错误（PKIX）**：本机 SteamTools 中间人 github；用上面的信任库注入。判别方法：`openssl s_client` 看证书 issuer 是不是 `SteamTools Certificate`。
6. **API30 模拟器镜像跑不了 Godot 4**：GPU 翻译层只有 GLES2，报 `EGL_BAD_CONFIG: no ES 3 support`。用 API35+ 镜像 + `-gpu host`。
7. **导出输出目录**（`builds/`）必须预先存在。
8. **导出用 `--headless` 或 `--editor` 均可**（2026-10-20 实测：两者在 .sln 齐备后都能走通 mono 管线）；CI 用 headless。
9. **归档图目录要放 `.gdignore`**（如 `m0/shots/`），否则 `all_resources` 导出会把截图打进 APK。
10. **设备上视口纹理 = 窗口分辨率 ≠ 内容设计分辨率**（模拟器横屏信箱下实测 607×1080 vs 内容 720×1280）。任何按内容坐标写的像素断言/取色都必须按实际分辨率等比映射（见 `SelfAudit()` 的 kx/ky 处理）。
11. **GLES3 设备的 Modulate 压暗在线性色彩空间**（桌面 GL 在 sRGB 空间直接乘），同参数压暗结果更亮；颜色断言要兼容两种空间（见 `DeadBlue` 谓词）。

## M0 场景结构（m0/）

`Main.tscn` = §3.5 四层分镜微缩版：顶部小地图事件窗 / 调色板小人走路带 / 场馆双方选手+击杀播报 / 底部战绩板。硬编码回放事件流驱动，演出层只消费事件（红线）。运行末尾对自存截图做 15 项像素自审计（`SelfAudit()`，桌面与设备同一实现，设备端结果在 logcat）；`shots/` 为桌面截图存档（已 .gdignore，不进包）。
