/** Transfer 折叠 part2：名单/自由市场/有主问价/动态 四卡 */
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("src/app/components/Transfer.tsx", "utf8");

// 1) 我的名单卡（默认收起）
s = s.replace(
  `      {/* 我的名单 */}
      <div className="card">
        <h3>👥 我的名单 · 挂牌与解约
          <span className={\`tag\${inWindow ? " green" : " red"}\`} style={{ marginLeft: 10 }}>{inWindow ? "转会窗开启" : grace ?? "窗口已关"}</span>
        </h3>`,
  `      {/* 我的名单 */}
      <CollapsibleCard
        title={<>👥 我的名单 · 挂牌与解约 <span className={\`tag\${inWindow ? " green" : " red"}\`} style={{ marginLeft: 10 }}>{inWindow ? "转会窗开启" : grace ?? "窗口已关"}</span></>}
        defaultOpen={false}
        collapsedSummary={<span className="muted small">{team.roster.length} 人</span>}
      >`,
);
s = s.replace(
  `          解约赔付剩余合同 40% · 挂牌身价 ×0.75 但更容易收到报价 · 长期坐板凳的选手会被人盯上
        </div>
      </div>

      {/* 自由市场 */}`,
  `          解约赔付剩余合同 40% · 挂牌身价 ×0.75 但更容易收到报价 · 长期坐板凳的选手会被人盯上
        </div>
      </CollapsibleCard>

      {/* 自由市场（含他队挂牌选手，v0.8 用户反馈） */}`,
);

// 2) 自由市场卡
s = s.replace(
  `      <div className="card">
        <h3>
          🛒 自由市场（{freeAgents.length}/{allFreeAgents.length} 人 · 报价花 1 行动力 · 问价免费）
          <button className="small" style={{ marginLeft: 12 }} onClick={() => freeMkt.setShow(!freeMkt.show)}>
            ⚙ 筛选器{freeMkt.activeCount > 0 && <span className="tag" style={{ marginLeft: 6 }}>{freeMkt.activeCount} 项生效</span>}
          </button>
        </h3>`,
  `      <CollapsibleCard
        title={\`🛒 自由市场（\${freeAgents.length}/\${allFreeAgents.length} 人 · 报价花 1 行动力 · 问价免费）\`}
        defaultOpen
        collapsedSummary={<span className="muted small">前 3：{freeAgents.slice(0, 3).map((p) => p.ign).join("、")}</span>}
      >
        <div className="row" style={{ marginBottom: 10, alignItems: "center" }}>
          <button className="small" onClick={() => freeMkt.setShow(!freeMkt.show)}>
            ⚙ 筛选器{freeMkt.activeCount > 0 && <span className="tag" style={{ marginLeft: 6 }}>{freeMkt.activeCount} 项生效</span>}
          </button>
        </div>`,
);

// 3) 有主问价卡（默认收起）
s = s.replace(
  `      <div className="card">
        <h3>
          🎯 问价 · 找有主选手（{underContract.length}/{rosteredOthers.length} 人 · 问价花 1 行动力）
          <button className="small" style={{ marginLeft: 12 }} onClick={() => underMkt.setShow(!underMkt.show)}>
            ⚙ 筛选器{underMkt.activeCount > 0 && <span className="tag" style={{ marginLeft: 6 }}>{underMkt.activeCount} 项生效</span>}
          </button>
        </h3>`,
  `      <CollapsibleCard
        title={\`🎯 问价 · 找有主选手（\${underContract.length}/\${rosteredOthers.length} 人 · 问价花 1 行动力）\`}
        defaultOpen={false}
        collapsedSummary={<span className="muted small">选俱乐部后逐人问价，2-5 天反馈要价与意向</span>}
      >
        <div className="row" style={{ marginBottom: 10, alignItems: "center" }}>
          <button className="small" onClick={() => underMkt.setShow(!underMkt.show)}>
            ⚙ 筛选器{underMkt.activeCount > 0 && <span className="tag" style={{ marginLeft: 6 }}>{underMkt.activeCount} 项生效</span>}
          </button>
        </div>`,
);

// 4) 转会动态卡（默认收起）
s = s.replace(
  `      <div className="card">
        <h3>📰 转会动态</h3>`,
  `      <CollapsibleCard title="📰 转会动态" defaultOpen={false} collapsedSummary={<span className="muted small">{feed.length} 条</span>}>`,
);

writeFileSync("src/app/components/Transfer.tsx", s);
console.log("part2 ok");
