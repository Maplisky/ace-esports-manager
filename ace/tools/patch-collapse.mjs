/** Transfer 三板块+两卡折叠（用户反馈：减少版面占用） */
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("src/app/components/Transfer.tsx", "utf8");
if (!s.includes("CollapsibleCard")) {
  s = s.replace(
    'import { PlayerDossier } from "./PlayerDossier.tsx";',
    'import { PlayerDossier } from "./PlayerDossier.tsx";\nimport { CollapsibleCard } from "./CollapsibleCard.tsx";',
  );
}

// 1) 问价结果卡
s = s.replace(
  `        <div className="card">
          <h3>📋 问价结果（{state.inquiries.filter((q) => q.done).length} 人可以报价 · {pendingInquiryCount} 人问价中）</h3>`,
  `        <CollapsibleCard
          title={\`📋 问价结果（\${state.inquiries.filter((q) => q.done).length} 人可以报价 · \${pendingInquiryCount} 人问价中）\`}
          defaultOpen
        >`,
);
s = s.replace(
  `            );
          })}
        </div>
      )}

      {/* 待答复挖角（有内容才显示） */}`,
  `            );
          })}
        </CollapsibleCard>
      )}

      {/* 待答复挖角（有内容才显示） */}`,
);

// 2) 待答复卡
s = s.replace(
  `        <div className="card">
          <h3>💼 待答复报价（7 天内答复，逾期视为拒绝）</h3>`,
  `        <CollapsibleCard title="💼 待答复报价（7 天内答复，逾期视为拒绝）" defaultOpen>`,
);
s = s.replace(
  `              </div>
            );
          })}
        </div>
      )}

      {/* 我的名单 */}`,
  `              </div>
            );
          })}
        </CollapsibleCard>
      )}

      {/* 我的名单 */}`,
);
writeFileSync("src/app/components/Transfer.tsx", s);
console.log("part1 ok");
