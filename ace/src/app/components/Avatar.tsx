/** 头像组件（v0.7 真实数据包）：队徽/选手头像来自 vlr.gg 快照，缺失回退首字母；虚拟生成选手带角标 */
import type { Player } from "../../core/types.ts";

export interface TeamLike { name: string; tag: string; logo?: string }

const initials = (s: string) => s.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "").slice(0, 2).toUpperCase();

export function TeamLogo({ team, size = 22 }: { team: TeamLike; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 4, background: "#2a2a33", color: "#ccc",
        fontSize: Math.max(9, size * 0.4), display: "inline-flex", alignItems: "center",
        justifyContent: "center", flex: "0 0 auto", overflow: "hidden",
      }}
    >
      {team.logo ? (
        <img
          src={team.logo}
          alt={team.name}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            (e.currentTarget.parentElement as HTMLElement).innerText = initials(team.tag || team.name);
          }}
        />
      ) : (
        initials(team.tag || team.name)
      )}
    </span>
  );
}

export function PlayerFace({ p, size = 30, showTag = true }: { p: Player; size?: number; showTag?: boolean }) {
  const badge =
    p.synthetic === "academy" ? { text: "青", title: "青训补充（无 vlr.gg 数据，虚拟生成）", bg: "#2e7d32" }
    : p.synthetic === "free" ? { text: "虚", title: "虚构选手（自由人池生成）", bg: "#8d6e63" }
    : null;
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "0 0 auto", width: size, height: size }}>
      <span
        style={{
          width: size, height: size, borderRadius: "50%", background: "#3a3a4a", color: "#eee",
          fontSize: Math.max(8, size * 0.34), display: "inline-flex", alignItems: "center",
          justifyContent: "center", overflow: "hidden",
        }}
      >
        {p.avatar ? (
          <img
            src={p.avatar}
            alt={p.ign}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.currentTarget.parentElement as HTMLElement).innerText = initials(p.ign);
            }}
          />
        ) : (
          initials(p.ign)
        )}
      </span>
      {showTag && badge && (
        <span
          title={badge.title}
          style={{
            position: "absolute", right: -3, bottom: -2, fontSize: Math.max(8, size * 0.3),
            background: badge.bg, color: "#fff", borderRadius: 6, padding: "0 3px", lineHeight: 1.3,
          }}
        >
          {badge.text}
        </span>
      )}
    </span>
  );
}

/** 虚拟选手文字徽章（列表行内用） */
export function SyntheticBadge({ p }: { p: Player }) {
  if (!p.synthetic) return null;
  return (
    <span
      title={p.synthetic === "academy" ? "青训补充（虚拟生成）" : "虚构选手"}
      style={{ fontSize: 10, background: p.synthetic === "academy" ? "#1b5e20" : "#5d4037", color: "#fff", borderRadius: 4, padding: "0 4px", marginLeft: 4 }}
    >
      {p.synthetic === "academy" ? "青训" : "虚构"}
    </span>
  );
}
