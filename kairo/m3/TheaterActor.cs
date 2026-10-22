using Godot;
using Kairo.M0;

namespace Kairo.M3;

/// <summary>四层分镜场馆选手（复用 ChibiFactory 帧）：存活呼吸帧 / 阵亡压暗 / 庆祝弹跳 / 受击闪光。</summary>
public sealed class Actor
{
    private Sprite2D _sprite = null!;
    private Texture2D[] _frames = null!;
    private Vector2 _home;
    private float _t;
    private float _cheerTtl;
    private bool _dead;
    private float _flash;

    public void Init(Node2D host, bool sideA, int k)
    {
        var pal = ChibiFactory.TeamPalette(sideA, k);
        _frames = ChibiFactory.BuildFrames(pal);
        float x = sideA ? 90 + k * 52 : 430 + k * 52;
        float y = sideA ? 560 : 820;
        _home = new Vector2(x, y);
        _sprite = new Sprite2D { Texture = _frames[0], Scale = new Vector2(4, 4), Position = _home };
        host.AddChild(_sprite);
        // 桌椅层次（画在选手前 → 视觉坐在桌后）
        host.AddChild(new ColorRect { Position = new Vector2(x - 12, y + 18), Size = new Vector2(26, 16), Color = Color.FromHtml("#3a4152") });
        host.AddChild(new ColorRect { Position = new Vector2(x - 8, y + 21), Size = new Vector2(18, 10), Color = Color.FromHtml("#7fd4c8") });
        host.AddChild(new ColorRect { Position = new Vector2(x - 30, y + 38), Size = new Vector2(64, 14), Color = Color.FromHtml("#6b4a32") });
    }

    public void Die()
    {
        _dead = true;
        _cheerTtl = 0;
    }

    public void Revive()
    {
        _dead = false;
        _sprite.Modulate = Colors.White;
    }

    public void Flash() => _flash = 0.4f;

    public void Cheer() => _cheerTtl = 2.2f;

    public void Update(float dt)
    {
        _t += dt;
        if (_flash > 0)
        {
            _flash -= dt;
            _sprite.Modulate = new Color(2.2f, 2.2f, 2.2f);
        }
        else if (_dead)
        {
            _sprite.Modulate = new Color(0.35f, 0.35f, 0.4f);
            _sprite.Texture = _frames[0];
            return;
        }
        else
        {
            _sprite.Modulate = Colors.White;
        }
        if (_cheerTtl > 0)
        {
            _cheerTtl -= dt;
            _sprite.Position = _home + new Vector2(0, -Mathf.Abs(Mathf.Sin(_t * 8)) * 9);
            _sprite.Texture = _frames[1 + (int)(_t * 6) % 2];
        }
        else
        {
            _sprite.Position = _home;
            _sprite.Texture = _frames[1 + (int)(_t * 4) % 2];
        }
    }
}
