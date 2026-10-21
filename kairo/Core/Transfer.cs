using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 转会系统 — 增量移植（完整 transfer.ts 401 行待移植；先落 day/events 依赖的窗口常量）。
/// 移植自 ace/src/core/sim/transfer.ts。
/// </summary>
public static class Transfer
{
    /// <summary>转会窗口（[起, 止] 天；Deadline Day 逻辑同源）。</summary>
    public static readonly int[][] TransferWindows =
    {
        new[] { 1, 24 }, new[] { 123, 152 }, new[] { 233, 366 },
    };

    public static bool InTransferWindow(int day) =>
        TransferWindows.Any(w => day >= w[0] && day <= w[1]);
}
