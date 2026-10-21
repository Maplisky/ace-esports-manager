using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.Core;

/// <summary>
/// 插入序字典 — TS Record/Map 的确定性对应物（JS 对象枚举按插入序，C# Dictionary 无序）。
/// 模拟内核中一切"键值集合"语义必须用此类型，保证遍历序跨语言一致。
/// </summary>
public sealed class OrderedDict<K, V> : IReadOnlyDictionary<K, V> where K : notnull
{
    private readonly Dictionary<K, V> _map = new();
    private readonly List<K> _order = new();

    public int Count => _order.Count;
    public IEnumerable<K> Keys => _order;
    public IEnumerable<V> Values => _order.Select(k => _map[k]);

    public V this[K key]
    {
        get => _map[key];
        set
        {
            if (!_map.ContainsKey(key)) _order.Add(key);
            _map[key] = value;
        }
    }

    public void Add(K key, V value)
    {
        if (_map.ContainsKey(key)) throw new ArgumentException($"duplicate key {key}");
        _order.Add(key);
        _map[key] = value;
    }

    public bool ContainsKey(K key) => _map.ContainsKey(key);
    public bool TryGetValue(K key, out V value) => _map.TryGetValue(key, out value!);
    public bool Remove(K key)
    {
        if (_map.Remove(key)) { _order.Remove(key); return true; }
        return false;
    }

    public IEnumerator<KeyValuePair<K, V>> GetEnumerator()
    {
        foreach (var k in _order) yield return new KeyValuePair<K, V>(k, _map[k]);
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class LinqExt
{
    /// <summary>C# Select 带下标（对应 JS forEach(arr, i) 场景）。</summary>
    public static IEnumerable<(T Item, int Index)> WithIndex<T>(this IEnumerable<T> source)
    {
        int i = 0;
        foreach (var item in source) yield return (item, i++);
    }
}
