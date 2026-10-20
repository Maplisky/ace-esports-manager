using Godot;

namespace Kairo.M0;

public enum ChibiState { Walk, Idle, Dead, Cheer }

/// <summary>演出层小人：只对事件做反应动画，不产生比赛事实（§3.5 红线）。</summary>
public sealed class ChibiActor
{
    public Sprite2D Sprite = null!;
    public Texture2D[] Frames = null!;
    public ChibiState State = ChibiState.Idle;
    public Vector2 Home;
    public float Speed = 70f;

    private float _anim;
    private float _bounce;

    /// <summary>庆祝弹跳是否处于离屏相位（≥6px）。供相位锁定的截图捕获使用。</summary>
    public bool Airborne => State == ChibiState.Cheer && Mathf.Abs(Mathf.Sin(_bounce)) * 9f >= 6f;

    public void Update(float dt)
    {
        int frame;
        switch (State)
        {
            case ChibiState.Walk:
                _anim += dt * 8f;
                frame = (int)_anim % 4;
                Sprite.Position += new Vector2(Speed * dt, 0);
                if (Sprite.Position.X > 800) Sprite.Position = new Vector2(-60, Home.Y);
                break;
            case ChibiState.Cheer:
                _bounce += dt * 9f;
                frame = 4;
                Sprite.Position = Home - new Vector2(0, Mathf.Abs(Mathf.Sin(_bounce)) * 9f);
                break;
            default:
                frame = 0;
                break;
        }
        Sprite.Texture = Frames[frame];
    }

    /// <summary>阵亡：趴桌（放倒+压暗）。</summary>
    public void Kill()
    {
        State = ChibiState.Dead;
        Sprite.RotationDegrees = 90;
        Sprite.Modulate = new Color(0.5f, 0.5f, 0.58f);
        Sprite.Position = Home + new Vector2(14, 10);
    }

    public void Cheer()
    {
        if (State == ChibiState.Dead) return; // 阵亡者不参与庆祝
        State = ChibiState.Cheer;
    }
}
