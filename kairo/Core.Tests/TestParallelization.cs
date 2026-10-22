using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Kairo.Core.Tests;

/// <summary>禁用测试并行：世界生成/fixture 序列是模块级状态，fixture id 参与比赛种子——
/// 并行测试类会互相污染（README 坑 15 的并行形态）。套件总时长 ~25s 可接受。</summary>
public static class TestParallelization
{
}
