/**
 * 常驻本页导读卡（v1.0-16）：每个页面顶部的可折叠帮助，内容来自 tutorial/content.ts 的
 * PAGE_HELP（与引擎口径一致）。默认折叠不吵老玩家；教程进行中对应页自动展开。
 * 仅在引导开启时显示（系统页可关——老玩家极简模式）。
 */
import { CollapsibleCard } from "./CollapsibleCard.tsx";
import { useStore } from "../store.ts";
import { PAGE_HELP, TUTORIAL_STEPS, type TutPage } from "../tutorial/content.ts";

export function PageHelpCard(props: { page: TutPage }) {
  const { tutorial, state } = useStore();
  const items = PAGE_HELP[props.page];
  if (!items || items.length === 0) return null;
  if (state?.tutorial?.mode !== true) return null;
  const tutActiveHere = tutorial.active && TUTORIAL_STEPS[tutorial.idx]?.page === props.page;
  return (
    <CollapsibleCard
      title="📖 本页导读"
      defaultOpen={tutActiveHere}
      collapsedSummary="点开查看本页每个元素的作用与用法"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {items.map((h) => (
          <div key={h.q} className="small" style={{ lineHeight: 1.6 }}>
            <b>{h.q}</b>
            <div className="muted">{h.a}</div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}
