using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kairo.Core;

/// <summary>存档槽位元信息（列表页用；不载入整个世界即可显示）。</summary>
public sealed class SaveSlotInfo
{
    public int Slot { get; set; }
    public string TeamName { get; set; } = "";
    public int Year { get; set; }
    public int Day { get; set; }
    public string Stage { get; set; } = "";
    public string Mode { get; set; } = "";
    public DateTime SavedAt { get; set; }
}

/// <summary>OrderedDict 的 STJ 工厂：反序列化按声明顺序重建（TS 插入序语义的存档往返关键）。</summary>
public sealed class OrderedDictFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) =>
        typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(OrderedDict<,>);

    public override JsonConverter? CreateConverter(Type type, JsonSerializerOptions options)
    {
        var args = type.GetGenericArguments();
        return (JsonConverter?)Activator.CreateInstance(typeof(OrderedDictConverter<,>).MakeGenericType(args));
    }

    private sealed class OrderedDictConverter<K, V> : JsonConverter<OrderedDict<K, V>> where K : notnull
    {
        public override OrderedDict<K, V> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var dict = new OrderedDict<K, V>();
            if (reader.TokenType != JsonTokenType.StartObject) throw new JsonException("expected object");
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject) return dict;
                string key = reader.GetString()!;
                reader.Read();
                var value = JsonSerializer.Deserialize<V>(ref reader, options)!;
                dict[ParseKey(key)] = value;
            }
            throw new JsonException("unterminated object");
        }

        private static K ParseKey(string raw)
        {
            // K = string 直接用；数值键走 ChangeType（GameState 当前仅 string 键，保留扩展位）
            if (typeof(K) == typeof(string)) return (K)(object)raw;
            return (K)System.Convert.ChangeType(raw, typeof(K));
        }

        public override void Write(Utf8JsonWriter writer, OrderedDict<K, V> value, JsonSerializerOptions options)
        {
            writer.WriteStartObject();
            foreach (var kv in value) // 插入序枚举——存档序 = 运行序
            {
                writer.WritePropertyName(kv.Key.ToString() ?? "");
                JsonSerializer.Serialize(writer, kv.Value, options);
            }
            writer.WriteEndObject();
        }
    }
}

/// <summary>
/// 存档多槽（立项 §9 存档）：3 槽 + 覆盖保存；文件 = 头行 JSON \n GameState 全量 JSON
/// （宿主传目录：桌面 = Godot user://saves；Core 保持引擎无关）。
/// 读档用 camelCase + OrderedDict 保序 converter；列表页只解析头行（不载入世界）。
/// </summary>
public static class SaveSystem
{
    public const int SlotCount = 3;
    private const string Ext = ".json";

    private static JsonSerializerOptions PayloadOpts { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new OrderedDictFactory() },
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>列出全部槽位（空槽 TeamName=""）；宿主传存档目录。</summary>
    public static List<SaveSlotInfo> List(string dir)
    {
        var list = new List<SaveSlotInfo>();
        for (int i = 1; i <= SlotCount; i++)
        {
            var info = new SaveSlotInfo { Slot = i };
            string path = Path.Combine(dir, $"slot{i}{Ext}");
            if (File.Exists(path))
            {
                try
                {
                    string raw = File.ReadAllText(path);
                    int nl = raw.IndexOf('\n');
                    using var doc = JsonDocument.Parse(nl > 0 ? raw[..nl] : raw);
                    var root = doc.RootElement;
                    info.TeamName = root.GetProperty("teamName").GetString() ?? "";
                    info.Year = root.GetProperty("year").GetInt32();
                    info.Day = root.GetProperty("day").GetInt32();
                    info.Stage = root.GetProperty("stage").GetString() ?? "";
                    info.Mode = root.TryGetProperty("mode", out var m) ? m.GetString() ?? "" : "";
                    info.SavedAt = root.TryGetProperty("savedAt", out var sa) && sa.TryGetDateTime(out var dt) ? dt : DateTime.MinValue;
                }
                catch
                {
                    info.TeamName = "（损坏存档）";
                }
            }
            list.Add(info);
        }
        return list;
    }

    /// <summary>保存：GameState 序列化 + 槽位头（临时文件 + 原子替换）。</summary>
    public static void Save(GameState state, string dir, int slot, string mode)
    {
        Directory.CreateDirectory(dir);
        var header = new
        {
            teamName = state.MyTeamId != null && state.Teams.TryGetValue(state.MyTeamId, out var t) ? t.Name : "",
            year = state.Year,
            day = state.Day,
            stage = state.Stage,
            mode,
            savedAt = DateTime.Now,
        };
        string payload = JsonSerializer.Serialize(state, PayloadOpts);
        string head = JsonSerializer.Serialize(header, PayloadOpts);
        string final = Path.Combine(dir, $"slot{slot}{Ext}");
        string tmp = final + ".tmp";
        File.WriteAllText(tmp, head + "\n" + payload);
        File.Move(tmp, final, overwrite: true);
    }

    /// <summary>读档：解析头 + 载入 GameState。</summary>
    public static (SaveSlotInfo Info, GameState State)? Load(string dir, int slot)
    {
        string path = Path.Combine(dir, $"slot{slot}{Ext}");
        if (!File.Exists(path)) return null;
        string raw = File.ReadAllText(path);
        int nl = raw.IndexOf('\n');
        if (nl < 0) throw new InvalidDataException("存档缺头");
        var info = JsonSerializer.Deserialize<SaveSlotInfo>(raw[..nl], PayloadOpts)!;
        info.Slot = slot;
        var state = JsonSerializer.Deserialize<GameState>(raw[(nl + 1)..], PayloadOpts)!;
        return (info, state);
    }

    /// <summary>删除槽位。</summary>
    public static void Delete(string dir, int slot)
    {
        string path = Path.Combine(dir, $"slot{slot}{Ext}");
        if (File.Exists(path)) File.Delete(path);
    }
}
