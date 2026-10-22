# KERNEL-SYNC — 共享内核版本快照（M1 收口固化）

- **快照基准**：本仓库 commit `6208fda`（v0.2-m1s，2026-10-22）。TS 侧内核（`ace/src/core/`）最后一次改动在 m1q（detmath/transfer 切 detPow）。
- **状态**：TS 201/201 绿；C# 84/84 绿（+1 skip 诊断工具）。全部 24 个 sim 模块 + rng/worldgen/detmath 逐位一致。
- **红线**：TS（`ace/src/core`）是唯一权威实现。改任何 TS 内核函数 → 重录对应黄金 → C# 回放必须仍逐位一致。

## 模块对照表

| TS 权威（ace/src/core） | CS 移植（kairo/Core） | 录制器（ace/tools） | 黄金（Core.Tests/Golden） |
| --- | --- | --- | --- |
| rng.ts | Rng.cs（+OrderedDict.cs） | golden-rng.mjs | rng.golden.json |
| detmath.ts | DetMath.cs | （探针内置于测试） | — |
| worldgen.ts + data/* | Worldgen.cs + CoreData.cs + Core.Data/*.json | golden-worldgen.mjs | worldgen.golden.json |
| types.ts | Types.cs、MatchTypes.cs | — | — |
| sim/matchstats.ts | Matchstats.cs | golden-matchstats.mjs | matchstats.golden.json |
| sim/intel.ts | Intel.cs | golden-trainpatch.mjs（合并） | trainpatch.golden.json |
| sim/veto.ts | Veto.cs | golden-matchpre.mjs（合并） | matchpre.golden.json |
| sim/tactics.ts | Tactics.cs | golden-matchpre.mjs（合并） | matchpre.golden.json |
| sim/match.ts | Match.cs | golden-match.mjs | match.golden.json |
| sim/strength.ts | Strength.cs | golden-strength.mjs | strength.golden.json |
| sim/fit.ts | Fit.cs | golden-strength.mjs（合并） | strength.golden.json |
| sim/fixtures.ts | Fixtures.cs | golden-fixtures.mjs | fixtures.golden.json |
| sim/training.ts | Training.cs | golden-trainpatch.mjs（合并） | trainpatch.golden.json |
| sim/patch.ts | Patch.cs | golden-trainpatch.mjs（合并） | trainpatch.golden.json |
| sim/events.ts | Events.cs + EventPool.cs | golden-events.mjs | events.golden.json |
| sim/finance.ts | Finance.cs | golden-events.mjs（合并） | events.golden.json |
| sim/rumors.ts | Rumors.cs | golden-rumors.mjs | rumors.golden.json |
| sim/narrative.ts | Narrative.cs | golden-narrative.mjs | narrative.golden.json |
| sim/business.ts | Business.cs | golden-business.mjs | business.golden.json |
| sim/career.ts | Career.cs | golden-career.mjs | career.golden.json |
| sim/draft.ts | Draft.cs | golden-draft.mjs | draft.golden.json |
| sim/transfer.ts | Transfer.cs | golden-transfer.mjs | transfer.golden.json |
| sim/day.ts | Day.cs | golden-day.mjs | day.golden.json（372 天逐日+年末摘要） |
| sim/scrim.ts | Scrim.cs | golden-extra.mjs | extra.golden.json |
| sim/achievements.ts | Achievements.cs | golden-extra.mjs（合并） | extra.golden.json |
| sim/retirement.ts | Retirement.cs | golden-extra.mjs（合并） | extra.golden.json |
| sim/challenge.ts | Challenge.cs | golden-extra.mjs（合并） | extra.golden.json |
| sim/share.ts | Share.cs | golden-extra.mjs（合并） | extra.golden.json |

测试类：`Core.Tests/*GoldenTests.cs`（命名 = 模块 + GoldenTests）。

## 已知的刻意差异（记录在案）

1. **Share.ReplayUrl**：TS 读浏览器 `location`；CS 由宿主传 `origin/path`（Godot 侧无 URL）。
2. **Share.DecodeReplay**：只还原 rec 首层字段 + teams/players（回放播放层未移植；TS 返回全量 JSON.parse 载荷）。deflate 字节依平台实现而异——跨端只保证可互解，编码结果不逐位比对。
3. **retireLog / coachPool / scrimLog / achievements**：TS 为 App 层初始化的可选字段；CS 为非空默认集合（语义等价：使用前恒为空集合起步）。

## 双端同步工作流

```bash
# 1. 改 TS 内核（ace/src/core/...）后重录黄金（ace/ 下；node 24 需 glob 形式跑测试）
node tools/golden-<module>.mjs

# 2. C# 回放（kairo/ 下）
dotnet test Core.Tests

# 3. TS 自测（ace/ 下）
node --test tests/*.test.ts
```

## M1 之后待办（不阻塞快照有效性）

- Mimosa 完整安全审计重跑（历次 hook 扫描缓冲不足，未宣称项目安全）。
- release keystore 密码更换（当前 kairo-m0-dev 临时值）。
- 真机闸门（README M0 计划）：mono APK 在实体 Android 设备启动实验。
