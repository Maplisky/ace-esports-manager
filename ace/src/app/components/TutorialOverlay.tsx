/**
 * 新手教程浮层（v1.0-16）：文明6式真实存档引导。
 * 读 store.tutorial(active/idx) 消费 TUTORIAL_STEPS：先切页 → 等 data-tut 锚点渲染 →
 * scrollIntoView + 挖孔高亮 + 说明卡。z-index 120：盖过 PreMatch/MatchPlayer(100)，让位事件卡(130)。
 * 引导待命（pause=awaitMatch）/实战章由 App 事件驱动续走，本组件只负责展示与前进。
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { useStore } from "../store.ts";
import { TUTORIAL_STEPS, TUTORIAL_GRADUATION, type TutId } from "../tutorial/content.ts";

interface Rect { x: number; y: number; w: number; h: number }

export function TutorialOverlay() {
  const { tutorial, page, state, setPage, tutorialNext, tutorialSkip } = useStore();
  const [rect, setRect] = useState<Rect | null>(null);
  const step = tutorial.active ? TUTORIAL_STEPS[tutorial.idx] : null;

  // 步骤所在页与当前页不同 → 先切页（Overlay 渲染在 App 主界面之上）
  useEffect(() => {
    if (step && step.page !== page) setPage(step.page);
  }, [step, page, setPage]);

  // 定位锚点：等元素出现（切页/弹层渲染都是异步的），resize 时重算
  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const locate = () => {
      if (cancelled) return;
      const el = step.anchor ? document.querySelector<HTMLElement>(`[data-tut="${step.anchor satisfies TutId}"]`) : null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      } else {
        setRect(null); // 无锚点/未找到 → 居中卡
      }
    };
    const tryLocate = () => {
      locate();
      // 锚点可能晚几拍渲染（切页后子组件挂载）：短重试若干次
      if (step.anchor && !document.querySelector(`[data-tut="${step.anchor satisfies TutId}"]`)) {
        raf = window.setTimeout(tryLocate, 250);
      }
    };
    raf = window.setTimeout(tryLocate, 60);
    const onResize = () => locate();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.clearTimeout(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [step, page, tutorial.idx]);

  // 待命步：首场已可打（held 出现由 App 续走）；若玩家已在待命步停留且没有比赛，只显示常规下一步
  if (!step) return null;

  const first = tutorial.idx === 0;
  const nextLabel = tutorial.idx >= TUTORIAL_STEPS.length - 1 ? "完成引导" : step.pause === "awaitMatch" ? "知道了，引导待命" : "下一步 →";

  // 挖孔：全屏暗幕 + 目标处透明洞（box-shadow spread 技巧）
  const holeStyle: React.CSSProperties | null = rect
    ? {
        position: "fixed",
        left: rect.x - 8,
        top: rect.y - 8,
        width: rect.w + 16,
        height: rect.h + 16,
        borderRadius: 10,
        boxShadow: "0 0 0 9999px rgba(4,5,9,0.78)",
        pointerEvents: "none",
        zIndex: 120,
        transition: "all 0.25s ease",
      }
    : null;

  // 说明卡：有锚点时贴在洞下方（放不下则上方），无锚点时屏幕居中
  const cardStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        zIndex: 121,
        width: "min(430px, 92vw)",
        left: Math.max(12, Math.min(rect.x, window.innerWidth - 450)),
        top: rect.y + rect.h + 18 + 130 > window.innerHeight ? Math.max(12, rect.y - 210) : rect.y + rect.h + 18,
      }
    : {
        position: "fixed", zIndex: 121, width: "min(520px, 92vw)",
        left: "50%", top: "18%", transform: "translateX(-50%)",
      };

  return (
    <>
      {/* 无锚点时也要有暗幕；有锚点时洞外由 box-shadow 遮罩负责 */}
      {!holeStyle && <div style={{ position: "fixed", inset: 0, background: "rgba(4,5,9,0.78)", zIndex: 120 }} onClick={() => tutorialNext()} />}
      {holeStyle && <div style={holeStyle} onClick={() => tutorialNext()} />}
      <div className="card" style={{ ...cardStyle, padding: "14px 18px", borderColor: "var(--accent)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <b style={{ color: "var(--accent)" }}>🎓 新手引导 · {tutorial.idx + 1}/{TUTORIAL_STEPS.length}</b>
          <button className="small muted" style={{ border: "none", background: "none", cursor: "pointer" }} onClick={() => tutorialSkip()}>
            跳过教程 ✕
          </button>
        </div>
        <b style={{ fontSize: 16 }}>{step.title}</b>
        <div className="small" style={{ marginTop: 6, lineHeight: 1.65 }}>{step.body}</div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
          <span className="muted small">{first ? "共 6 章 · 约 5 分钟" : ""}</span>
          <button className="primary small" onClick={() => tutorialNext()}>
            {nextLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/** 毕业卡：首场结算后由 App 在 tutorial.graduate 置位时渲染 */
export function TutorialGraduation() {
  const { tutorial, setTutorial } = useStore();
  if (!tutorial.graduate) return null;
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(4,5,9,0.78)", zIndex: 120 }} />
      <div className="card" style={{ position: "fixed", zIndex: 121, width: "min(520px, 92vw)", left: "50%", top: "22%", transform: "translateX(-50%)", padding: "16px 20px", borderColor: "var(--gold)" }}>
        <b style={{ fontSize: 18 }}>{TUTORIAL_GRADUATION.title}</b>
        <div className="small" style={{ marginTop: 8, lineHeight: 1.7 }}>{TUTORIAL_GRADUATION.body}</div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="primary small" onClick={() => void setTutorial(undefined, true)}>
            开始我的生涯
          </button>
        </div>
      </div>
    </>
  );
}
