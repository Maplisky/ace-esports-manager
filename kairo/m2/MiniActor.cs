using Godot;
using Kairo.M0;

namespace Kairo.Chibi;

/// <summary>灰盒观赏页小人（M3 预研）：状态机轻量版——存活/阵亡/庆祝，复用 m0 ChibiFactory 帧。</summary>
public sealed class MiniActor
{
    public int Idx { get; init; }
    public bool Dead { get; set; }
    private Sprite2D _sprite = null!;
    private Texture2D[] _idle = null!;
    private Texture2D[] _cheer = null!;
    private float _t;
    private float _cheerTtl;
    private bool _cheering;

    /// <summary>由宿主场景创建精灵（A 队上排 / B 队下排）。</summary>
    public void Init(Node2D host, bool sideA)
    {
        int pal = Idx % ChibiFactory.TeamPalettes.Length;
        var frames = ChibiFactory.BuildFrames(ChibiFactory.TeamPalettes[pal]);
        _idle = frames;
        _cheer = frames;
        int k = Idx % 5;
        float x = sideA ? 120 + k * 96 : 420 + k * 52;
        float y = sideA ? 700 : 760;
        _sprite = new Sprite2D { Texture = frames[0], Scale = new Vector2(3, 3), Position = new Vector2(x, y) };
        host.AddChild(_sprite);
    }

    public void Reset()
    {
        Dead = false;
        _cheering = false;
        _cheerTtl = 0;
        _sprite.Visible = true;
        _sprite.Modulate = Colors.White;
        _sprite.Texture = _idle[0];
    }

    public void Flash()
    {
        _sprite.Modulate = new Color(2, 2, 2);
    }

    public void Cheer()
    {
        _cheering = true;
        _cheerTtl = 2.0f;
    }

    public void Update(float dt)
    {
        _t += dt;
        if (_cheering)
        {
            _cheerTtl -= dt;
            _sprite.Texture = _cheer[1 + (int)(_t * 6) % 2];
            if (_cheerTtl <= 0) _cheering = false;
        }
        else if (!Dead)
        {
            _sprite.Texture = _idle[1 + (int)(_t * 4) % 2];
        }
        else
        {
            _sprite.Modulate = new Color(0.4f, 0.4f, 0.45f);
            _sprite.Texture = _idle[0];
        }
        // Flash 渐隐回白
        if (_sprite.Modulate.R > 1)
        {
            float v = Mathf.Max(1, _sprite.Modulate.R - dt * 3);
            _sprite.Modulate = new Color(v, v, v);
        }
    }
}
