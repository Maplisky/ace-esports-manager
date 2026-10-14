/** 可折叠卡片（v0.8 用户反馈：转会区版面收缩）：点标题行折叠/展开 */
import { useState, type ReactNode } from "react";

export function CollapsibleCard(props: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** 折叠时仍要展示的摘要（如「3 人待答复」） */
  collapsedSummary?: ReactNode;
}) {
  const { title, defaultOpen = true, children, collapsedSummary } = props;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: open ? undefined : "8px 14px" }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(!open)}
        title={open ? "点击收起" : "点击展开"}
      >
        <h3 style={{ margin: 0 }}>
          {open ? "▾ " : "▸ "}
          {title}
          {!open && collapsedSummary != null && <span className="muted small" style={{ marginLeft: 10 }}>{collapsedSummary}</span>}
        </h3>
        <span className="muted small">{open ? "收起 ▴" : "展开 ▾"}</span>
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
