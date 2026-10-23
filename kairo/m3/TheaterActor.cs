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
    private bool _walker;
    private float _walkSpeed;
    private float _anim;

    public bool Dead => _dead;

    public Vector2 Position => _sprite != null ? _sprite.Position : Vector2.Zero;

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

    /// <summary>C2 走路带变体：小尺寸 + 横向环绕行走（到边折返）。speed 单位 px/s。</summary>
    public void InitWalker(Node2D host, int k, float y, float speed)
    {
        var pal = ChibiFactory.TeamPalette(k % 2 == 0, k / 2);
        _frames = ChibiFactory.BuildFrames(pal);
        _home = new Vector2(30 + k * 20, y);
        _sprite = new Sprite2D { Texture = _frames[1], Scale = new Vector2(3, 3), Position = _home, FlipH = true };
        _walkSpeed = speed;
        _walker = true;
        host.AddChild(_sprite);
    }

    /// <summary>走路带推进（InitWalker 场景专用）：横走到边折返（FlipH 转向）。</summary>
    public void WalkStep(float dt)
    {
        if (!_walker || _dead) return;
        float x = _sprite.Position.X + _walkSpeed * dt;
        if (x > 690) { x = 30; _sprite.Position = new Vector2(x, _sprite.Position.Y); }
        _sprite.Position = new Vector2(x, _sprite.Position.Y);
        _sprite.Texture = _frames[1 + (int)(_anim * 8) % 2];
        _anim += dt;
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
        if (_walker) { WalkStep(dt); return; } // 走路带模式：横走循环
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
