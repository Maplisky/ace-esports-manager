using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Kairo.M2;

/// <summary>
/// 程序合成音效（零外部素材）：8-bit 风短音——方波/正弦 + 指数衰减包络。
/// kill=下扫方波 / roundWin=双音上行 / build=低频 thud / save=软 click / levelUp=三音上行。
/// headless 或 --mute 时静音（合成仍可用，播放为 no-op）。
/// </summary>
public static class Sfx
{
    private const int Rate = 22050;

    private static readonly Dictionary<string, AudioStreamWav> Cache = new();
    private static readonly List<AudioStreamPlayer> Players = new();
    private static Node? _host;
    private static bool _muted;

    public static void Init(Node host)
    {
        _host = host;
        var args = Godot.OS.GetCmdlineUserArgs();
        _muted = DisplayServer.GetName() == "headless" || System.Linq.Enumerable.Contains(args, "--mute");
    }

    public static void Play(string kind)
    {
        if (_muted || _host == null) return;
        var stream = Cache.TryGetValue(kind, out var s) ? s : Cache[kind] = Synth(kind);
        var player = Players.FirstOrDefault(p => !p.Playing && GodotObject.IsInstanceValid(p));
        if (player == null)
        {
            if (Players.Count >= 6) return; // 并发上限，防叠加爆音
            player = new AudioStreamPlayer();
            _host.AddChild(player);
            Players.Add(player);
        }
        player.Stream = stream;
        player.VolumeDb = VolumeFor(kind); // 分型调优：高频事件压低、奖励事件抬高
        player.Play();
    }

    /// <summary>分型音量（dB）：kill 高频压制防疲劳；奖励/里程碑音突出。</summary>
    private static float VolumeFor(string kind) => kind switch
    {
        "kill" => -15f,      // 每场百余次，压到衬托层
        "save" => -16f,      // 确认音，轻
        "build" => -10f,
        "roundWin" => -7f,   // 回合奖励，突出
        "cheer" => -6f,      // ACE/升级，最亮
        "levelUp" => -7f,
        _ => -12f,
    };

    private static AudioStreamWav Synth(string kind)
    {
        short[] tone;
        switch (kind)
        {
            case "kill": tone = Sweep(320, 90, 0.16, 0.55); break;
            case "roundWin": tone = TwoTone(523, 784, 0.09); break;
            case "build": tone = Sweep(180, 60, 0.22, 0.9); break;
            case "save": tone = Blip(880, 0.05, 0.3); break;
            case "levelUp": tone = Arp(new double[] { 523, 659, 784 }, 0.07); break;
            case "cheer": tone = Arp(new double[] { 659, 784, 988, 1175 }, 0.06); break;
            default: tone = Blip(440, 0.06, 0.3); break;
        }
        var wav = new AudioStreamWav
        {
            Format = AudioStreamWav.FormatEnum.Format16Bits,
            MixRate = Rate,
            Data = new byte[tone.Length * 2],
        };
        System.Buffer.BlockCopy(tone, 0, wav.Data, 0, wav.Data.Length);
        return wav;
    }

    /// <summary>单音 + 指数衰减。</summary>
    private static short[] Blip(double freq, double dur, double decay)
    {
        int n = (int)(Rate * dur);
        var outp = new short[n];
        for (int i = 0; i < n; i++)
        {
            double t = i / (double)Rate;
            double env = Math.Exp(-t / decay * 6);
            outp[i] = (short)(Math.Sin(2 * Math.PI * freq * t) * env * 12000);
        }
        return outp;
    }

    /// <summary>方波下滑（击杀的"pew"感）。</summary>
    private static short[] Sweep(double from, double to, double dur, double decay)
    {
        int n = (int)(Rate * dur);
        var outp = new short[n];
        double phase = 0;
        for (int i = 0; i < n; i++)
        {
            double t = i / (double)n;
            double f = from + (to - from) * t;
            phase += 2 * Math.PI * f / Rate;
            double env = Math.Exp(-t * decay * 6);
            double v = Math.Sign(Math.Sin(phase)) * env * 8000;
            outp[i] = (short)v;
        }
        return outp;
    }

    /// <summary>双音上行 chime。</summary>
    private static short[] TwoTone(double f1, double f2, double segDur)
    {
        var a = Blip(f1, segDur, 0.5);
        var b = Blip(f2, segDur, 0.5);
        var outp = new short[a.Length + b.Length];
        Array.Copy(a, outp, a.Length);
        Array.Copy(b, 0, outp, a.Length, b.Length);
        return outp;
    }

    /// <summary>琶音（升级/胜利）。</summary>
    private static short[] Arp(double[] freqs, double segDur)
    {
        var parts = new List<short[]>();
        foreach (var f in freqs) parts.Add(Blip(f, segDur, 0.4));
        int total = parts.Sum(p => p.Length);
        var outp = new short[total];
        int at = 0;
        foreach (var p in parts) { Array.Copy(p, 0, outp, at, p.Length); at += p.Length; }
        return outp;
    }
}
