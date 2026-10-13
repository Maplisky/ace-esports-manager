var ut = Object.defineProperty;
var pt = (e, t, s) => t in e ? ut(e, t, {
    enumerable: !0,
    configurable: !0,
    writable: !0,
    value: s
}) : e[t] = s;
var j = (e, t, s) => pt(e, typeof t != "symbol" ? t + "" : t, s);
import {
    I as R,
    bS as Ue,
    N as V,
    h as z,
    W as Ve,
    bP as fe,
    bQ as qe,
    bT as ce,
    bU as gt,
    bV as yt,
    bO as xt,
    bW as vt,
    ao as U,
    ag as le,
    t as jt,
    bX as G,
    b3 as Ne,
    bi as bt,
    b0 as Mt,
    T as wt,
    Z as At,
    bp as Nt,
    bq as kt,
    ah as Xe,
    _ as ke,
    al as $t,
    bY as O,
    n as Y,
    bZ as Ze,
    b_ as he,
    m as T,
    az as St,
    g as ue,
    aL as Je,
    b$ as Tt,
    c0 as Ot,
    c1 as Bt,
    c2 as Ct,
    c3 as Et,
    R as It,
    j as Lt,
    k as Pt,
    c4 as _t
} from "./cards-Cmwwaaa1.js";
import {
    w as Dt,
    r as Rt,
    i as Ft,
    c as Wt,
    M as $e
} from "./roster-DhYuV0hG.js";
import {
    j as i,
    r as B
} from "./vendor-DH-k1TvH.js";
import {
    A as Ht
} from "./ThemeToggle-DqVcvr0E.js";
import {
    aF as oe
} from "./account-6f7K7jcb.js";
import {
    F as pe,
    a as Gt
} from "./Card-sR3-EjAu.js";
import {
    u as Kt
} from "./useDialogFocus-CcqilB6b.js";

function Yt(e) {
    return Math.round(6e4 + e * e * 90)
}

function dn(e) {
    const t = e.teams[e.myTeam];
    if (!t) return "找不到俱乐部。";
    if (t.facilities >= 95) return "训练设施已经是顶级水平了。";
    const s = Yt(t.facilities);
    return e.finances.balance < s ? `资金不足，需要 ${Math.round(s/1e3)}K。` : (e.finances.balance -= s, e.finances.log.push({
        day: e.day,
        label: "训练设施升级",
        amount: -s
    }), t.facilities = R(t.facilities + 1, 0, 95), `训练设施升级到 ${t.facilities}。`)
}

function Ut(e) {
    const t = new Set([...(e.staff ?? []).map(s => s.name), ...Object.values(e.teams).flatMap(s => (s.supportStaff ?? []).map(n => n.name)), ...Object.values(e.teams).map(s => {
        var n;
        return (n = s.coach) == null ? void 0 : n.name
    }).filter(Boolean)]);
    return Ue.filter(s => !t.has(s.name)).map(s => ({
        ...s,
        spec: s.spec,
        salary: Math.round(4e4 + Math.pow(Math.max(0, (s.tactics + s.development + s.motivation) / 3 - 40), 2) * 120 * .45)
    })).sort((s, n) => n.tactics - s.tactics)
}

function Vt(e) {
    var n;
    const t = new Set([...(e.staff ?? []).map(a => a.name), ...Object.values(e.teams).flatMap(a => (a.supportStaff ?? []).map(r => r.name)), ...Object.values(e.teams).map(a => {
            var r;
            return (r = a.coach) == null ? void 0 : r.name
        }).filter(Boolean)]),
        s = [];
    for (const a of Ve)
        for (const r of ((n = a.coach) == null ? void 0 : n.assistants) ?? []) {
            if (t.has(r)) continue;
            const l = new V(z(`staff:${r}`)),
                c = a.coach ? (a.coach.tactics + a.coach.development + a.coach.motivation) / 3 : 58,
                h = () => R(Math.round(c - l.range(4, 16) + l.range(-5, 5)), 30, 88);
            s.push({
                name: r,
                from: a.name,
                tactics: h(),
                development: h(),
                motivation: h(),
                salary: 0
            })
        }
    for (const a of s) {
        const r = (a.tactics + a.development + a.motivation) / 3;
        a.salary = Math.round(4e4 + Math.pow(Math.max(0, r - 40), 2) * 120)
    }
    return s.sort((a, r) => r.tactics + r.development + r.motivation - (a.tactics + a.development + a.motivation))
}
const fn = {
        maps: {
            label: "图池分析",
            blurb: "「跑图」训练的地图熟练度收益 +60%"
        },
        opponent: {
            label: "对手研究",
            blurb: "比赛中的战术加成提升，相当于多半个主教练"
        },
        potential: {
            label: "数据建模",
            blurb: "潜力看得更准，相当于额外的「眼光」"
        },
        economy: {
            label: "经济分析",
            blurb: "道具与经济运用更高效，全场小幅加成"
        },
        review: {
            label: "复盘专家",
            blurb: "「教练复盘」训练的意识与指挥收益翻倍"
        }
    },
    F = {
        head: "主教练",
        assistant: "助理教练",
        analyst: "数据分析师"
    },
    ee = {
        head: 1,
        assistant: .55,
        analyst: .45
    };

function qt(e) {
    return Object.values(e.teams).filter(t => t.id !== e.myTeam && t.coach).map(t => {
        const s = t.coach,
            n = (s.tactics + s.development + s.motivation) / 3,
            a = Math.round((3e4 + Math.pow(Math.max(0, n - 45), 2) * 220) * (.6 + t.reputation / 110));
        return {
            team: t,
            coach: s,
            ask: a
        }
    }).sort((t, s) => s.coach.tactics + s.coach.development + s.coach.motivation - (t.coach.tactics + t.coach.development + t.coach.motivation))
}

function un(e, t, s) {
    var r;
    const n = e.teams[t];
    if (!(n != null && n.coach)) return "这支球队没有主教练。";
    if ((r = e.staffApproaches) != null && r.some(l => l.teamId === t && !l.answer)) return `已经在等 ${n.name} 的答复了。`;
    if (e.finances.balance < s) return "资金不足，无法支付这笔补偿。";
    const a = new V(z(`approach:${e.seed}:${e.day}:${t}`));
    return e.staffApproaches = [...e.staffApproaches ?? [], {
        id: `AP${e.day}_${t}`,
        teamId: t,
        name: n.coach.name,
        fee: s,
        day: e.day,
        replyOn: e.day + a.int(2, 6)
    }], `已向 ${n.name} 提出接触 ${n.coach.name} 的请求，等待答复。`
}

function pn(e, t) {
    var n, a, r, l;
    const s = [];
    for (const c of e.staffApproaches ?? []) {
        if (c.answer || c.replyOn > e.day) continue;
        const h = e.teams[c.teamId];
        if (c.role) {
            const f = (n = h == null ? void 0 : h.supportStaff) == null ? void 0 : n.find(x => x.name === c.name);
            if (!h || !f) {
                c.answer = "refused", c.reason = "这名成员已经不在那支球队了";
                continue
            }
            const y = c.fee / Math.max(1, Qe(h, f)),
                p = R(.45 + (y - 1) * .8 + ((((a = e.manager) == null ? void 0 : a.reputation) ?? 50) - h.reputation) * .004, .05, .95);
            t.chance(p) ? (c.answer = "granted", s.push(`✅ ${h.name} 同意你接触${F[f.role]} ${c.name}，接下来和他谈合同。`)) : (c.answer = "refused", c.reason = y < .85 ? "补偿金太低" : "暂时不想放人", s.push(`❌ ${h.name} 拒绝了接触 ${c.name} 的请求：${c.reason}`));
            continue
        }
        if (!(h != null && h.coach) || h.coach.name !== c.name) {
            c.answer = "refused", c.reason = "这名教练已经不在那支球队了";
            continue
        }
        const o = ((r = qt(e).find(f => f.team.id === c.teamId)) == null ? void 0 : r.ask) ?? c.fee,
            m = c.fee / Math.max(1, o);
        let d = .12 + (m - 1) * .7 + ((((l = e.manager) == null ? void 0 : l.reputation) ?? 50) - h.reputation) * .006;
        e.boardConfidence > 70 && (d += .05), d = R(d, .02, .9), t.chance(d) ? (c.answer = "granted", s.push(`✅ ${h.name} 同意你接触 ${c.name}，接下来和他谈合同。`)) : (c.answer = "refused", c.reason = m < .85 ? "补偿金太低" : "不愿意放走现任主教练", s.push(`❌ ${h.name} 拒绝了接触 ${c.name} 的请求：${c.reason}`))
    }
    return e.staffApproaches = (e.staffApproaches ?? []).filter(c => !c.answer || c.replyOn > e.day - 30), s
}

function gn(e) {
    return Object.values(e.teams).filter(t => t.id !== e.myTeam).flatMap(t => (t.supportStaff ?? []).map(s => ({
        team: t,
        member: s,
        ask: Qe(t, s)
    }))).sort((t, s) => s.member.tactics + s.member.development + s.member.motivation - (t.member.tactics + t.member.development + t.member.motivation))
}
const Qe = (e, t) => Math.round(t.salary * R(t.years, .5, 3) * .5 * (.6 + e.reputation / 110) / 1e3) * 1e3;

function yn(e, t, s, n) {
    var c, h;
    const a = e.teams[t],
        r = (c = a == null ? void 0 : a.supportStaff) == null ? void 0 : c.find(o => o.name === s);
    if (!a || !r) return "这名成员已经不在那支球队了。";
    if ((h = e.staffApproaches) != null && h.some(o => o.teamId === t && o.name === s && !o.answer)) return `已经在等 ${a.name} 的答复了。`;
    if (!Number.isFinite(n) || n < 0) return "补偿金不对。";
    if (e.finances.balance < n) return "资金不足，无法支付这笔补偿。";
    const l = new V(z(`approach:${e.seed}:${e.day}:${t}:${s}`));
    return e.staffApproaches = [...e.staffApproaches ?? [], {
        id: `AP${e.day}_${t}_${s}`,
        teamId: t,
        name: s,
        fee: n,
        role: r.role,
        day: e.day,
        replyOn: e.day + l.int(2, 6)
    }], `已向 ${a.name} 提出接触${F[r.role]} ${s} 的请求，等待答复。`
}

function Xt(e) {
    var s;
    const t = [];
    for (const n of e.staffApproaches ?? []) {
        if (n.answer !== "granted") continue;
        const a = e.teams[n.teamId];
        if (n.role) {
            const c = (s = a == null ? void 0 : a.supportStaff) == null ? void 0 : s.find(h => h.name === n.name);
            if (!a || !c) continue;
            t.push({
                name: c.name,
                from: a.name,
                spec: c.spec,
                tactics: c.tactics,
                development: c.development,
                motivation: c.motivation,
                salary: Math.round(c.salary * 1.1 / ee[c.role])
            });
            continue
        }
        const r = a == null ? void 0 : a.coach;
        if (!r || r.name !== n.name) continue;
        const l = (r.tactics + r.development + r.motivation) / 3;
        t.push({
            name: r.name,
            from: a.name,
            tactics: r.tactics,
            development: r.development,
            motivation: r.motivation,
            salary: Math.round(4e4 + Math.pow(Math.max(0, l - 40), 2) * 150)
        })
    }
    return t
}

function xn(e, t, s, n, a) {
    var h;
    const r = (s === "analyst" ? Ut(e).find(o => o.name === t) : Vt(e).find(o => o.name === t)) ?? Xt(e).find(o => o.name === t);
    if (!r) return "这位人选已经不在市场上了。";
    if ((h = e.staffOffers) != null && h.some(o => o.name === t && !o.answer)) return `已经在等 ${t} 的答复了。`;
    const l = e.teams[e.myTeam] ? Dt(e, e.myTeam) : 0;
    if (n > Math.max(0, e.finances.balance) + l) return "这个薪资超出了俱乐部的承受范围。";
    const c = new V(z(`staffoffer:${e.seed}:${e.day}:${t}`));
    return e.staffOffers = [...e.staffOffers ?? [], {
        id: `SO${e.day}_${t}`,
        name: t,
        from: r.from,
        role: s,
        salary: n,
        years: a,
        day: e.day,
        replyOn: e.day + c.int(1, 7),
        tactics: r.tactics,
        development: r.development,
        motivation: r.motivation
    }], `已向 ${t} 发出${F[s]}邀请，等待答复（最多 7 天）。`
}

function Zt(e, t) {
    return Math.round(e.salary * ee[t])
}

function vn(e, t) {
    var a, r, l, c, h;
    const s = [],
        n = e.teams[e.myTeam];
    if (!n) return s;
    for (const o of e.staffOffers ?? []) {
        if (o.answer || o.replyOn > e.day) continue;
        const m = Zt({
                name: o.name,
                from: o.from,
                tactics: o.tactics,
                development: o.development,
                motivation: o.motivation,
                salary: 0
            }, o.role),
            d = (o.tactics + o.development + o.motivation) / 3,
            f = Math.round((4e4 + Math.pow(Math.max(0, d - 40), 2) * 120) * ee[o.role]),
            y = m || f,
            p = o.salary / Math.max(1, y);
        let x = (p - 1) * 100 + (n.reputation - 55) * .8 + (o.years >= 2 ? 6 : 0);
        x += ((((a = e.manager) == null ? void 0 : a.reputation) ?? 50) - 50) * .35, Object.values(e.teams).some(v => {
            var A;
            return v.id !== e.myTeam && ((A = v.supportStaff) == null ? void 0 : A.some(M => M.name === o.name))
        }) && (x += 10);
        const u = x > t.range(-12, 12);
        if (o.answer = u ? "accept" : "reject", !u) {
            o.reason = p < .9 ? "薪资达不到他的预期" : n.reputation < 55 ? "认为俱乐部平台不够" : "暂时不想离开现在的岗位", s.push(`❌ ${o.name} 拒绝了${F[o.role]}邀请：${o.reason}`);
            continue
        }
        const g = Math.round(o.salary * .5);
        e.finances.balance -= g, e.finances.log.push({
            day: e.day,
            label: `签约 ${o.name}`,
            amount: -g
        });
        let b;
        const w = Object.values(e.teams).find(v => {
            var A;
            return v.id !== e.myTeam && ((A = v.supportStaff) == null ? void 0 : A.some(M => M.name === o.name))
        });
        if (w) {
            const v = (r = e.staffApproaches) == null ? void 0 : r.find(M => M.teamId === w.id && M.name === o.name && M.answer === "granted"),
                A = (v == null ? void 0 : v.fee) ?? 0;
            b = (l = w.supportStaff.find(M => M.name === o.name)) == null ? void 0 : l.spec, e.finances.balance -= A, e.finances.log.push({
                day: e.day,
                label: `补偿 ${w.name}`,
                amount: -A
            }), w.supportStaff = w.supportStaff.filter(M => M.name !== o.name), s.push(`💼 ${o.name} 离开 ${w.name} 加盟，补偿金 ${Math.round(A/1e3)}K。`)
        }
        const N = Object.values(e.teams).find(v => {
            var A;
            return v.id !== e.myTeam && ((A = v.coach) == null ? void 0 : A.name) === o.name
        });
        if (N) {
            const v = (c = e.staffApproaches) == null ? void 0 : c.find(M => M.teamId === N.id && M.answer === "granted"),
                A = (v == null ? void 0 : v.fee) ?? 0;
            e.finances.balance -= A, e.finances.log.push({
                day: e.day,
                label: `补偿 ${N.name}`,
                amount: -A
            }), N.coach = null, s.push(`💼 ${o.name} 离开 ${N.name} 加盟，补偿金 ${Math.round(A/1e3)}K。`)
        }
        if (o.role === "head") {
            const v = n.coach,
                A = {
                    name: o.name,
                    tactics: o.tactics,
                    development: o.development,
                    motivation: o.motivation,
                    salary: o.salary
                };
            n.coach = A, v && (e.staff = [...e.staff ?? [], {
                name: v.name,
                role: "assistant",
                tactics: v.tactics,
                development: v.development,
                motivation: v.motivation,
                salary: v.salary ?? Math.round(o.salary * .4),
                years: 1
            }], s.push(`🔁 ${v.name} 转为助理教练，可在教练组解约。`))
        } else e.staff = [...e.staff ?? [], {
            name: o.name,
            role: o.role,
            spec: b ?? ((h = Ue.find(v => v.name === o.name)) == null ? void 0 : h.spec),
            tactics: o.tactics,
            development: o.development,
            motivation: o.motivation,
            salary: o.salary,
            years: o.years
        }];
        e.tally ?? (e.tally = {
            signed: 0,
            hired: 0,
            earned: 0,
            commercial: 0
        }), e.tally.hired += 1, s.push(`✅ ${o.name} 接受了邀请，出任${F[o.role]}。`)
    }
    return e.staffOffers = (e.staffOffers ?? []).filter(o => !o.answer || o.replyOn > e.day - 5), s
}

function jn(e, t) {
    var a;
    const s = (a = e.staff) == null ? void 0 : a.find(r => r.name === t);
    if (!s) return "找不到这名成员。";
    const n = Math.round(s.salary * .35);
    return e.finances.balance -= n, e.finances.log.push({
        day: e.day,
        label: `解约 ${t}`,
        amount: -n
    }), e.staff = (e.staff ?? []).filter(r => r.name !== t), `${t} 已离队，支付违约金 ${Math.round(n/1e3)}K。`
}
const Jt = 14,
    Se = {
        analyst: {
            tactics: .5,
            development: .15,
            motivation: .15
        },
        other: {
            tactics: .2,
            development: .45,
            motivation: .2
        }
    },
    Qt = (e, t) => Math.max(0, e[t] - 55) * (e.role === "analyst" ? Se.analyst[t] : Se.other[t]),
    zt = (e, t) => (e.staff ?? []).reduce((s, n) => s + Qt(n, t), 0);

function bn(e, t) {
    return Math.min(Jt, zt(e, t))
}

function me(e, t) {
    const s = (e.staff ?? []).find(n => n.role === "analyst" && n.spec === t);
    return s ? Math.max(0, s.tactics - 45) / 45 : 0
}
const ze = e => {
    const t = (e.tactics + e.development + e.motivation) / 3;
    return Math.round(4e4 + Math.pow(Math.max(0, t - 40), 2) * 120)
};

function Mn(e, t) {
    var h;
    const s = e.teams[e.myTeam];
    if (!s) return "找不到俱乐部。";
    const n = (h = e.staff) == null ? void 0 : h.find(o => o.name === t);
    if (!n) return "找不到这名成员。";
    if (n.role !== "assistant") return `${t} 是${F[n.role]}，不是助理教练。`;
    const a = s.coach,
        r = Math.max(n.salary, ze(n));
    s.coach = {
        name: n.name,
        tactics: n.tactics,
        development: n.development,
        motivation: n.motivation,
        salary: r
    };
    const l = (e.staff ?? []).filter(o => o.name !== t);
    a && l.push({
        name: a.name,
        role: "assistant",
        tactics: a.tactics,
        development: a.development,
        motivation: a.motivation,
        salary: a.salary ?? Math.round(r * .4),
        years: 1
    }), e.staff = l;
    const c = `年薪 ${Math.round(r/1e3)}K`;
    return a ? `${t} 升任主教练（${c}），${a.name} 转为助理教练。` : `${t} 升任主教练（${c}）。`
}

function wn(e) {
    var n;
    const t = e.teams[e.myTeam];
    if (!t) return "找不到俱乐部。";
    const s = t.coach;
    return s ? (n = e.staff) != null && n.some(a => a.name === s.name) ? `${s.name} 已经在教练组里了。` : (e.staff = [...e.staff ?? [], {
        name: s.name,
        role: "assistant",
        tactics: s.tactics,
        development: s.development,
        motivation: s.motivation,
        salary: s.salary ?? Math.round(ze(s) * ee.assistant),
        years: 1
    }], t.coach = null, `${s.name} 降为助理教练。现在没有主教练，加成按队伍整体水平算，可从助教里升任一人。`) : "现在没有主教练。"
}
const es = {},
    An = e => {
        const t = Math.abs(e),
            s = e < 0 ? "-" : "";
        return t >= 1e6 ? `${s}$${(t/1e6).toFixed(t>=1e7?1:2)}M` : t >= 1e3 ? `${s}$${(t/1e3).toFixed(0)}K` : `${s}$${t.toFixed(0)}`
    },
    et = e => `${e<0?"-":""}$${Math.abs(Math.round(e)).toLocaleString("en-US")}`;

function Nn({
    value: e
}) {
    const t = e >= 88 ? "elite" : e >= 78 ? "good" : e >= 68 ? "ok" : "";
    return i.jsx("span", {
        className: `ovr ${t}`,
        children: e
    })
}

function ts({
    role: e
}) {
    return i.jsx("span", {
        className: "role",
        style: {
            background: ce(e)
        },
        children: e
    })
}

function kn({
    p: e
}) {
    var s;
    const t = (s = e.roles) != null && s.length ? e.roles : [e.role];
    return i.jsxs("span", {
        className: "row",
        style: {
            gap: 3
        },
        children: [i.jsx(ts, {
            role: t[0]
        }), t.slice(1).map(n => i.jsx("span", {
            className: "role",
            style: {
                background: "transparent",
                color: ce(n),
                boxShadow: `inset 0 0 0 1px ${ce(n)}`
            },
            title: `兼任 ${n}`,
            children: n
        }, n))]
    })
}

function tt({
    value: e,
    max: t = 100,
    color: s
}) {
    const n = Math.max(0, Math.min(100, e / t * 100)),
        a = s ?? (n >= 75 ? "var(--win)" : n >= 45 ? "var(--warn)" : "var(--loss)");
    return i.jsx("div", {
        className: "bar",
        children: i.jsx("i", {
            style: {
                width: `${n}%`,
                background: a
            }
        })
    })
}

function $n({
    p: e,
    game: t
}) {
    const s = gt(t.manager, e.id, e.potential, me(t, "potential"));
    return i.jsx("span", {
        className: s.exact ? "mono" : "mono faint",
        title: s.exact ? "眼光足够，潜力看得准" : `眼光有限，只能看出在 ${s.text} 之间`,
        children: s.text
    })
}

function ss({
    id: e,
    size: t = 18,
    className: s
}) {
    const n = jt(e);
    return n ? i.jsx("img", {
        className: `crest${s?" "+s:""}`,
        src: n,
        alt: "",
        "aria-hidden": "true",
        loading: "lazy",
        width: t,
        height: t,
        style: {
            width: t,
            height: t
        }
    }) : null
}

function Sn({
    p: e,
    rust: t = !0
}) {
    const s = e.comeback;
    if (!s) return null;
    const n = yt(e);
    return i.jsxs(i.Fragment, {
        children: [s.kind === "retired" && i.jsxs("span", {
            className: "tag",
            title: s.lastClub ? `最后一站 ${s.lastClub}（${s.lastYear}）` : void 0,
            children: ["退役", s.lastYear ? ` ${s.lastYear}` : ""]
        }), s.fame > 0 && i.jsx("span", {
            className: "tag",
            style: {
                borderColor: "var(--accent)",
                color: "var(--accent)"
            },
            title: "人气：直播合同更值钱，在队时俱乐部声望慢慢上涨；要价更高，训练少一些",
            children: xt[s.fame]
        }), t && e.teamId && n < 1 && i.jsxs("span", {
            className: "tag warn",
            title: "复出后每周找回一部分状态",
            children: ["状态 ", Math.round(n * 100), "%"]
        })]
    })
}

function Tn({
    id: e,
    size: t = 20
}) {
    const s = e ? fe(e) : void 0;
    return s != null && s.img ? i.jsx("img", {
        className: "face",
        src: qe(s.img, s.v),
        alt: "",
        "aria-hidden": "true",
        loading: "lazy",
        decoding: "async",
        width: t,
        height: t,
        style: {
            width: t,
            height: t
        }
    }) : i.jsx("span", {
        className: "face",
        "aria-hidden": "true",
        style: {
            width: t,
            height: t
        }
    })
}
const st = () => "./",
    On = e => `${st()}maps/${e}.webp`;

function ns({
    name: e,
    size: t = 24,
    title: s
}) {
    const n = vt(e) ?? e;
    return i.jsx("img", {
        className: "agent-icon",
        src: `${st()}agents/${n.replace(/[^A-Za-z]/g,"")}.webp`,
        alt: le(n),
        title: s ?? `${le(n)}${U[n]?`（${U[n]}）`:""}`,
        loading: "lazy",
        width: t,
        height: t,
        style: {
            width: t,
            height: t,
            borderRadius: 4,
            background: "var(--panel-3)",
            display: "block"
        }
    })
}

function Bn({
    id: e,
    game: t,
    full: s = !1,
    crest: n = !1
}) {
    const a = e ? t.teams[e] : null;
    if (!a) return i.jsx("span", {
        className: "muted",
        children: "自由人"
    });
    const r = s ? a.name : a.tag;
    return n ? i.jsxs("span", {
        className: "club",
        title: s ? a.tag : a.name,
        children: [i.jsx(ss, {
            id: e
        }), i.jsx("span", {
            children: r
        })]
    }) : i.jsx("span", {
        title: s ? a.tag : a.name,
        children: r
    })
}

function Cn(e, t) {
    if (!e) return !1;
    const s = t.toLowerCase();
    return e.tag.toLowerCase().includes(s) || e.name.toLowerCase().includes(s)
}

function D({
    title: e,
    children: t,
    actions: s,
    flush: n,
    className: a,
    tut: r
}) {
    return i.jsxs("div", {
        className: `panel${a?` ${a}`:""}`,
        "data-tut": r,
        children: [(e || s) && i.jsxs("div", {
            className: "panel-head",
            children: [e && i.jsx("h2", {
                children: e
            }), i.jsx("div", {
                className: "spacer"
            }), s]
        }), i.jsx("div", {
            className: `panel-body${n?" flush":""}`,
            children: t
        })]
    })
}

function En({
    k: e,
    v: t,
    small: s
}) {
    return i.jsxs("div", {
        className: "stat",
        children: [i.jsx("span", {
            className: "k",
            children: e
        }), i.jsx("span", {
            className: `v${s?" sm":""}`,
            children: t
        })]
    })
}

function In({
    title: e,
    onClose: t,
    onBgClose: s,
    children: n,
    wide: a
}) {
    const r = Kt(t),
        l = B.useId();
    return i.jsx("div", {
        className: "modal-bg",
        onClick: s ?? t,
        children: i.jsxs("div", {
            ref: r,
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": l,
            tabIndex: -1,
            className: "modal",
            style: a ? {
                maxWidth: 1020
            } : void 0,
            onClick: c => c.stopPropagation(),
            children: [i.jsxs("div", {
                className: "modal-head",
                children: [i.jsx("h3", {
                    id: l,
                    children: e
                }), i.jsx("div", {
                    className: "spacer",
                    style: {
                        flex: 1
                    }
                }), i.jsx("button", {
                    className: "sm ghost",
                    onClick: t,
                    children: "关闭 ✕"
                })]
            }), i.jsx("div", {
                className: "modal-body",
                children: n
            })]
        })
    })
}

function Ln({
    p: e,
    day: t
}) {
    if (e.injuredUntil > t) return i.jsxs("span", {
        className: "neg tiny",
        children: ["⚕ 伤停 ", e.injuredUntil - t, "天"]
    });
    const s = Math.round(100 - e.fatigue),
        n = s >= 75 ? "var(--win)" : s >= 50 ? "var(--warn)" : "var(--loss)";
    return i.jsxs("span", {
        className: "row",
        style: {
            gap: 6
        },
        children: [i.jsx(tt, {
            value: s,
            color: n
        }), i.jsx("span", {
            className: "tiny mono muted",
            children: s
        })]
    })
}
const Pn = (e, t = 2026) => {
    const s = new Date(Date.UTC(t, 0, 1));
    return s.setUTCDate(s.getUTCDate() + e), `${s.getUTCMonth()+1}/${s.getUTCDate()}`
};

function _n({
    traits: e,
    max: t
}) {
    if (!(e != null && e.length)) return null;
    const s = t ? e.slice(0, t) : e;
    return i.jsx("span", {
        className: "row wrap",
        style: {
            gap: 4
        },
        children: s.map(n => i.jsx("span", {
            className: "trait",
            "data-good": n.good ? "y" : "n",
            title: n.good ? "该项处于职业选手前列" : "该项明显低于职业平均",
            children: n.label
        }, n.key))
    })
}

function Dn({
    axes: e,
    series: t,
    size: s = 300
}) {
    const n = s / 2,
        a = s / 2,
        r = s / 2 - 44,
        l = e.length,
        c = (h, o) => {
            const m = Math.PI * 2 * h / l - Math.PI / 2;
            return [n + Math.cos(m) * r * o, a + Math.sin(m) * r * o]
        };
    return i.jsxs("svg", {
        width: s,
        height: s,
        role: "img",
        "aria-label": "表现对比雷达图",
        children: [
            [.25, .5, .75, 1].map(h => i.jsx("polygon", {
                points: e.map((o, m) => c(m, h).join(",")).join(" "),
                fill: "none",
                stroke: "var(--line)",
                strokeWidth: 1
            }, h)), e.map((h, o) => {
                const [m, d] = c(o, 1);
                return i.jsx("line", {
                    x1: n,
                    y1: a,
                    x2: m,
                    y2: d,
                    stroke: "var(--line)"
                }, o)
            }), t.map(h => i.jsx("polygon", {
                points: h.values.map((o, m) => c(m, Math.max(.04, Math.min(1, o / 100))).join(",")).join(" "),
                fill: h.color,
                fillOpacity: .22,
                stroke: h.color,
                strokeWidth: 2
            }, h.label)), t.map(h => h.values.map((o, m) => {
                const [d, f] = c(m, Math.max(.04, Math.min(1, o / 100)));
                return i.jsx("circle", {
                    cx: d,
                    cy: f,
                    r: 2.6,
                    fill: h.color
                }, `${h.label}-${m}`)
            })), e.map((h, o) => {
                var f, y;
                const [m, d] = c(o, 1.2);
                return i.jsxs("g", {
                    children: [i.jsx("text", {
                        x: m,
                        y: d - 6,
                        fill: "var(--muted)",
                        fontSize: 11,
                        fontWeight: 600,
                        textAnchor: "middle",
                        dominantBaseline: "middle",
                        children: h
                    }), i.jsxs("text", {
                        x: m,
                        y: d + 7,
                        fontSize: 10,
                        textAnchor: "middle",
                        dominantBaseline: "middle",
                        fontFamily: "var(--mono)",
                        fill: ((f = t[0]) == null ? void 0 : f.color) ?? "var(--faint)",
                        children: [Math.round(((y = t[0]) == null ? void 0 : y.values[o]) ?? 0), t[1] ? i.jsxs("tspan", {
                            fill: t[1].color,
                            children: [" / ", Math.round(t[1].values[o])]
                        }) : null]
                    })]
                }, h)
            })
        ]
    })
}

function Rn({
    values: e,
    labels: t,
    size: s = 210
}) {
    const n = s / 2,
        a = s / 2,
        r = s / 2 - 26,
        l = e.length,
        c = (o, m) => {
            const d = Math.PI * 2 * o / l - Math.PI / 2;
            return [n + Math.cos(d) * r * m, a + Math.sin(d) * r * m]
        },
        h = e.map((o, m) => c(m, Math.max(.05, o / 100)).join(",")).join(" ");
    return i.jsxs("svg", {
        width: s,
        height: s,
        role: "img",
        "aria-label": "能力雷达图",
        children: [
            [.25, .5, .75, 1].map(o => i.jsx("polygon", {
                points: e.map((m, d) => c(d, o).join(",")).join(" "),
                fill: "none",
                stroke: "var(--line)",
                strokeWidth: 1
            }, o)), e.map((o, m) => {
                const [d, f] = c(m, 1);
                return i.jsx("line", {
                    x1: n,
                    y1: a,
                    x2: d,
                    y2: f,
                    stroke: "var(--line)",
                    strokeWidth: 1
                }, m)
            }), i.jsx("polygon", {
                points: h,
                fill: "rgba(255,70,85,.28)",
                stroke: "var(--accent)",
                strokeWidth: 2
            }), e.map((o, m) => {
                const [d, f] = c(m, Math.max(.05, o / 100));
                return i.jsx("circle", {
                    cx: d,
                    cy: f,
                    r: 2.5,
                    fill: "var(--accent)"
                }, m)
            }), t.map((o, m) => {
                const [d, f] = c(m, 1.2);
                return i.jsx("text", {
                    x: d,
                    y: f,
                    fill: "var(--muted)",
                    fontSize: 10,
                    textAnchor: "middle",
                    dominantBaseline: "middle",
                    children: o
                }, o)
            })
        ]
    })
}
const ge = {
        normal: {
            label: "普通",
            blurb: "对手会研究你的比赛录像。",
            prepMax: 6,
            topKnee: 90,
            topSlope: .6,
            aiPolishStop: 97,
            rivalryCap: 2,
            aiFamiliarity: 50,
            payGrievance: 2
        },
        hard: {
            label: "困难",
            blurb: "AI 练得更满、打得更熟，顶尖数值的收益变小。",
            prepMax: 8,
            topKnee: 88,
            topSlope: .5,
            aiPolishStop: 99,
            rivalryCap: 3,
            aiFamiliarity: 62,
            payGrievance: 3
        },
        pro: {
            label: "职业",
            blurb: "全世界都在针对你。练满也不保证赢。",
            prepMax: 10,
            topKnee: 86,
            topSlope: .4,
            aiPolishStop: 99,
            rivalryCap: 4,
            aiFamiliarity: 70,
            payGrievance: 4
        }
    },
    Te = ["normal", "hard", "pro"],
    nt = e => e.difficulty && ge[e.difficulty] ? e.difficulty : "normal",
    te = e => ge[nt(e)],
    Fn = e => Math.min(Math.max(e.rivalry ?? 0, 0), te(e).rivalryCap);

function as(e, t) {
    const {
        topKnee: s,
        topSlope: n
    } = te(e);
    return t <= s ? t : s + (t - s) * n
}

function Wn(e, t) {
    const s = Te.indexOf(nt(e)),
        n = Te.indexOf(t);
    return n < 0 ? "没有这个难度。" : n <= s ? "难度只能往上调。" : (e.difficulty = t, e.news.push({
        day: e.day,
        kind: "club",
        important: !0,
        text: `难度调到「${ge[t].label}」。`
    }), null)
}

function is(e) {
    const t = {
        决斗者: 0,
        先锋: 0,
        控场: 0,
        哨卫: 0
    };
    for (const s of e) {
        const n = U[s];
        n && n in t && t[n]++
    }
    return t
}

function os(e) {
    const t = is(e);
    return t.决斗者 >= 2 ? "rush" : t.哨卫 >= 2 ? "hold" : t.控场 >= 2 ? "control" : "standard"
}
const Hn = {
        rush: {
            label: "双决斗",
            blurb: "两个突破手：节奏快、进攻硬，防守端薄。",
            advice: "节奏和侵略性往右拉，拉在左边等于白带两个决斗者。暂停时「强攻」更猛。",
            counter: "侵略性别拉高，激进的防守会被两个决斗者冲穿；中局应变拉高。"
        },
        hold: {
            label: "双哨卫",
            blurb: "两个守点位：防守端厚，节奏慢，进攻端要靠道具慢推。",
            advice: "节奏和侵略性往左拉，拉快了两个哨卫就是两个没枪的人。暂停时「稳守」更稳。",
            counter: "节奏放慢，冲两个哨卫的布置就是送；道具拉高慢慢拆。"
        },
        control: {
            label: "双控场",
            blurb: "两套烟：控图打法，攻防两端都受益，靠道具喂。",
            advice: "道具拉高，节奏和侵略性放中间。",
            counter: "道具拉高，节奏别太慢，等他们的烟铺开就晚了。"
        },
        standard: {
            label: "标准",
            blurb: "一决斗、双先锋、一控场、一哨卫，最不挑的公式。",
            advice: "滑杆按对手来调：对双哨卫放慢节奏，对双决斗别把侵略性拉满。",
            counter: "没有特别要针对的，按自己阵容的打法来。"
        }
    },
    rs = {
        rush: {
            paceAtk: 1.35,
            paceDef: .8,
            aggAtk: 1.35,
            aggDef: .8,
            util: .9
        },
        hold: {
            paceAtk: .5,
            paceDef: 2.2,
            aggAtk: .5,
            aggDef: 2.2,
            util: 1
        },
        control: {
            paceAtk: 1,
            paceDef: 1,
            aggAtk: 1,
            aggDef: 1,
            util: 1.2
        },
        standard: {
            paceAtk: 1,
            paceDef: 1,
            aggAtk: 1,
            aggDef: 1,
            util: 1
        }
    },
    cs = {
        rush: {
            atk: 1.3,
            def: -.9,
            mid: 0
        },
        hold: {
            atk: -.8,
            def: 1.4,
            mid: 0
        },
        control: {
            atk: .5,
            def: .5,
            mid: .9
        },
        standard: {
            atk: 0,
            def: 0,
            mid: 0
        }
    },
    K = 30 / 17;

function ls(e, t, s, n) {
    const a = rs[t],
        r = cs[t],
        l = (e.pace - 50) * K,
        c = (e.aggression - 50) * K,
        h = (e.utility - 50) * K,
        o = l * .035 * a.paceAtk + c * .028 * a.aggAtk,
        m = -l * .022 * a.paceDef - c * .015 * a.aggDef,
        d = h * .02 * a.util * (.5 + n / 130);
    let f = 0,
        y = 0,
        p = 0;
    switch (s) {
        case "hold":
            f = -l * .03 + h * .015;
            break;
        case "rush":
            y = -c * .03, p = (e.adaptability - 50) * K * .02;
            break;
        case "control":
            f = h * .02 + l * .015, y = h * .01;
            break
    }
    return {
        styleAtk: r.atk,
        styleDef: r.def,
        styleMid: r.mid,
        tacticsAtk: o,
        tacticsDef: m,
        utility: d,
        matchupAtk: f,
        matchupDef: y,
        matchupMid: p
    }
}

function Oe(e, t) {
    return e === "rush" ? t === "rush" ? 1.4 : t === "hold" ? .7 : 1 : t === "hold" ? 1.4 : t === "rush" ? .7 : 1
}
const ye = 50,
    hs = 100,
    Gn = 12,
    Kn = 8,
    Yn = 6,
    se = e => Object.values(e).slice().sort().join("|"),
    ms = (e, t) => {
        const s = t.split("|");
        let n = 0;
        for (const a of e.split("|")) {
            const r = s.indexOf(a);
            r >= 0 && (n++, s.splice(r, 1))
        }
        return n / 5
    };

function at(e, t, s, n) {
    var l;
    if (t !== e.myTeam) return te(e).aiFamiliarity;
    const a = (l = e.compPro) == null ? void 0 : l[s];
    if (!a) return ye;
    const r = se(n);
    return a.key === r ? a.value : a.value * ms(a.key, r)
}
const ds = e => (e - ye) * .06;

function Un(e, t, s, n) {
    const a = se(s);
    if (!a) return ye;
    const r = at(e, e.myTeam, t, s),
        l = Math.min(hs, r + n);
    return e.compPro = {
        ...e.compPro ?? {},
        [t]: {
            key: a,
            value: l
        }
    }, l
}
const fs = ["快攻", "消耗", "控制"],
    us = {
        Jett: [3, 0, 0],
        Raze: [2, 1, 0],
        Phoenix: [2, 1, 0],
        Reyna: [3, 0, 0],
        Yoru: [2, 1, 0],
        Neon: [3, 0, 0],
        Iso: [2, 0, 1],
        Waylay: [3, 0, 0],
        Sova: [0, 2, 1],
        Breach: [3, 0, 0],
        Skye: [1, 2, 0],
        "KAY/O": [1, 2, 0],
        Fade: [1, 2, 0],
        Gekko: [0, 3, 0],
        Tejo: [2, 1, 0],
        Brimstone: [1, 0, 2],
        Viper: [0, 1, 2],
        Omen: [0, 1, 2],
        Astra: [0, 2, 1],
        Harbor: [0, 0, 3],
        Clove: [0, 1, 2],
        Miks: [0, 1, 2],
        Sage: [0, 1, 2],
        Cypher: [0, 0, 3],
        Killjoy: [0, 0, 3],
        Chamber: [0, 1, 2],
        Deadlock: [0, 0, 3],
        Vyse: [0, 0, 3],
        Veto: [0, 0, 3]
    },
    ps = {
        Ascent: [.36, .31, .33],
        Bind: [.29, .41, .3],
        Breeze: [.17, .28, .55],
        Corrode: [.27, .33, .4],
        Fracture: [.54, .2, .26],
        Haven: [.34, .32, .34],
        Icebox: [.24, .26, .5],
        Lotus: [.36, .28, .36],
        Pearl: [.23, .38, .38],
        Split: [.39, .16, .45],
        Summit: [.25, .36, .39],
        Sunset: [.34, .3, .36],
        Abyss: [.47, .23, .29]
    },
    it = [1 / 3, 1 / 3, 1 / 3];

function Be(e) {
    const t = [0, 0, 0];
    for (const n of e) {
        const a = us[n];
        a && (t[0] += a[0], t[1] += a[1], t[2] += a[2])
    }
    const s = t[0] + t[1] + t[2];
    return s ? [t[0] / s, t[1] / s, t[2] / s] : it
}
const Ce = e => (Math.max(...e) - 1 / 3) / (2 / 3),
    Ee = e => Math.max(...e) - Math.min(...e) < .05 ? "均衡" : fs[e.indexOf(Math.max(...e))],
    gs = [
        [0, -1, 1],
        [1, 0, -1],
        [-1, 1, 0]
    ];

function ys(e, t) {
    let s = 0;
    for (let n = 0; n < 3; n++)
        for (let a = 0; a < 3; a++) s += e[n] * gs[n][a] * t[a];
    return s
}
const xs = (e, t) => {
        const s = ps[t] ?? it;
        return e[0] * s[0] + e[1] * s[1] + e[2] * s[2]
    },
    vs = 1 / 3,
    js = .075,
    bs = .3,
    ne = e => Math.max(-1, Math.min(1, e)),
    Ie = (e, t) => ne(2 * (xs(e, t) - vs) / js),
    Ms = (e, t) => ne(ys(e, t) / bs),
    re = {
        version: 2.05,
        map: 1.45,
        counter: 1.01
    },
    ws = .8;

function Le(e, t) {
    if (!t) return 0;
    let s = 0,
        n = 0;
    for (const a of e) s += t.coef[a] ?? 0, n++;
    return n ? ne(s / n / ws) : 0
}

function Vn(e, t, s, n, a, r) {
    const l = {};
    for (const [m, d] of Object.entries((e == null ? void 0 : e.coef) ?? {})) {
        const f = d * (a ? .6 : .82);
        Math.abs(f) > .05 && (l[m] = f)
    }
    const c = [],
        h = [],
        o = new Set;
    for (let m = 0; m < (a ? 9 : 3); m++) {
        const d = t[r.int(0, t.length - 1)];
        if (!d || o.has(d)) continue;
        o.add(d);
        const f = l[d] ?? 0,
            y = ne(f + r.norm(0, a ? .6 : .35));
        l[d] = y, y - f > .15 ? c.push(d) : f - y > .15 && h.push(d)
    }
    return {
        since: s,
        name: n,
        coef: l,
        buffed: c,
        nerfed: h,
        big: a
    }
}

function As(e, t, s, n) {
    const a = Array.from(e),
        r = Array.from(t),
        l = Be(a),
        c = Be(r),
        h = re.version * (Le(a, n) - Le(r, n)),
        o = re.map * (Ie(l, s) - Ie(c, s)),
        m = 2 * re.counter * Ms(l, c);
    return {
        total: h + o + m,
        version: h,
        map: o,
        counter: m,
        mix: l,
        foe: c
    }
}
const Ns = 3,
    Pe = {
        regional: 8,
        international: 15
    },
    ks = .6,
    J = 3,
    _e = .35,
    $s = 1.4,
    Ss = 50,
    Ts = 15e5,
    ot = 10,
    xe = e => e.scout ?? (e.scout = {
        heat: 0,
        reads: {},
        beat: {}
    }),
    rt = e => [e.pace, e.aggression, e.utility, e.adaptability],
    ct = (e, t) => {
        const s = t.split("|");
        let n = 0;
        for (const a of e.split("|")) {
            const r = s.indexOf(a);
            r >= 0 && (n++, s.splice(r, 1))
        }
        return n / 5
    };

function Os(e, t, s, n) {
    var m;
    const a = (m = e.scout) == null ? void 0 : m.reads[t];
    if (!a) return {
        read: 0,
        sheet: 0,
        dials: 0
    };
    const r = se(s),
        l = Math.min(1, a.nSheet / J) * (r === a.key ? 1 : ct(r, a.key)),
        o = rt(n).every((d, f) => Math.abs(d - a.dials[f]) <= ot) ? Math.min(1, a.nDial / J) : 0;
    return {
        read: .65 * l + .35 * o,
        sheet: l,
        dials: o
    }
}
const Bs = (e, t) => {
    var s;
    return ((s = e.nemesis) == null ? void 0 : s.teamId) === t && e.nemesis.year === e.year
};

function Cs(e, t, s, n, a, r, l) {
    var m;
    if (!l || !s || s !== e.myTeam || t === e.myTeam) return 0;
    const c = ((m = e.scout) == null ? void 0 : m.heat) ?? 0;
    if (c <= 0) return 0;
    const {
        read: h
    } = Os(e, n, a, r), o = Bs(e, t) ? $s : 1;
    return te(e).prepMax * (c / 100) * (_e + (1 - _e) * h) * o
}
const lt = (e, t, s) => Math.max(t, Math.min(s, e));

function qn(e, t, s, n) {
    if (t.scrim || !t.result) return;
    const a = xe(e);
    for (const h of t.result.maps) {
        const o = s[h.map];
        if (!o) continue;
        const m = se(o.agents),
            d = rt(o.tactics),
            f = a.reads[h.map];
        if (!f) {
            a.reads[h.map] = {
                key: m,
                dials: d,
                nSheet: 1,
                nDial: 1
            };
            continue
        }
        const y = d.every((p, x) => Math.abs(p - f.dials[x]) <= ot);
        f.nSheet = f.key === m ? Math.min(J + 1, f.nSheet + 1) : Math.floor(f.nSheet * ct(m, f.key)) + 1, f.nDial = y ? Math.min(J + 1, f.nDial + 1) : 1, f.key = m, f.dials = d
    }
    const r = t.teamA === e.myTeam,
        l = t.result.mapsWonA > t.result.mapsWonB === r,
        c = r ? t.teamB : t.teamA;
    a.heat = lt(a.heat + (l ? Ns : -8), 0, 100), l && e.teams[c] && (a.beat[c] = (a.beat[c] ?? 0) + (n ? 2 : 1))
}

function Xn(e, t) {
    const s = xe(e);
    s.heat = lt(s.heat + (t ? Pe.international : Pe.regional), 0, 100)
}

function Zn(e, t, s) {
    var c;
    const n = xe(e),
        a = n.heat >= Ss,
        r = e.teams[e.myTeam];
    let l;
    if (a && r && (l = (c = Object.entries(n.beat).filter(([h]) => {
            var o;
            return h !== e.myTeam && ((o = e.teams[h]) == null ? void 0 : o.tier) === 1
        }).sort((h, o) => o[1] - h[1] || e.teams[o[0]].rating - e.teams[h[0]].rating)[0]) == null ? void 0 : c[0]), l) {
        const h = e.teams[l];
        e.nemesis = {
            teamId: l,
            year: t
        }, h.budget += Ts;
        const o = `⚔️ ${h.name} 把我们列为头号对手：新赛季加倍研究我们的比赛，休赛期砸钱补强。`;
        s.push(o), e.news.push({
            day: e.day,
            kind: "league",
            important: !0,
            text: o
        })
    } else e.nemesis = void 0;
    n.heat = Math.round(n.heat * ks);
    for (const h of Object.values(n.reads)) h.nSheet = Math.floor(h.nSheet / 2), h.nDial = Math.floor(h.nDial / 2);
    n.beat = {}
}

function Jn(e) {
    return e >= 75 ? "重点针对" : e >= 45 ? "很受关注" : e >= 20 ? "有人研究" : "没人盯"
}
const De = 6,
    Re = 30,
    Es = {
        决斗者: 1.08,
        自由人: 1.03,
        先锋: .98,
        哨卫: .96,
        控场: .93
    },
    Is = {
        决斗者: 1.28,
        先锋: 1.08,
        自由人: 1,
        控场: .9,
        哨卫: .88
    },
    Fe = {
        决斗者: 2,
        先锋: 1.3,
        自由人: 1,
        哨卫: .6,
        控场: .5
    };

function ve(e, t) {
    const s = (e.form - 70) * .0028,
        n = (e.morale - 70) * .0016,
        a = -e.fatigue * .0016,
        r = t != null && e.injuredUntil > t ? -.22 : 0;
    return e.overall * (1 + s + n + a + r)
}
const Ls = e => (42 + (e.attrs.aim * .55 + e.attrs.reaction * .3 + e.attrs.clutch * .15) * .78) * Es[e.role],
    Ps = e => {
        const t = ve(e) / Math.max(1, e.overall);
        return t * t
    };

function ht(e, t) {
    const s = e.teams[t],
        n = s.roster.map(r => e.players[r]).filter(r => !!r && r.injuredUntil <= e.day && !Ne(e, r)),
        a = [];
    for (const r of s.starters) {
        const l = n.find(c => c.id === r);
        l && a.length < 5 && a.push(l)
    }
    if (a.length < 5) {
        const r = s.roster.map(c => e.players[c]).filter(c => !!c && !a.includes(c) && !Ne(e, c)),
            l = .15;
        for (; a.length < 5 && r.length;) {
            const c = o => ve(o, e.day) * l + mt([...a, o]),
                h = r.reduce((o, m) => c(m) > c(o) ? m : o);
            a.push(h), r.splice(r.indexOf(h), 1)
        }
    }
    if (a.length < 5) {
        const r = s.roster.map(l => e.players[l]).filter(l => !!l && !a.includes(l)).sort((l, c) => c.overall - l.overall);
        for (const l of r) {
            if (a.length >= 5) break;
            a.push(l)
        }
    }
    return a
}
const de = ["决斗者", "先锋", "控场", "哨卫"],
    Q = {
        控场: 7,
        哨卫: 5,
        先锋: 4,
        决斗者: 4
    };

function _s(e) {
    let t = 0;
    for (const s of de) {
        const n = e.filter(a => U[a] === s).length;
        n > 2 && (t += (n - 2) * Q[s] * .6)
    }
    return e.length >= 5 && !e.some(s => U[s] === "控场") && (t += Q.控场 * .6), t
}

function mt(e) {
    const t = l => (l.roles ?? [l.role]).filter(c => de.includes(c)),
        s = new Set(e.flatMap(t)),
        n = e.filter(l => t(l).length === 0).length;
    let a = 0,
        r = n;
    for (const l of de) s.has(l) || (r > 0 ? (r -= 1, a -= Q[l] * .5) : a -= Q[l]);
    return a += Math.min(e.filter(l => t(l).length > 1).length, 3) * .6, n > 2 && (a -= (n - 2) * 1.5), a
}

function We(e, t, s, n = ht(e, t)) {
    var r, l;
    const a = Nt(e, t, n, s, (t === e.myTeam ? ((r = e.agentPicks) == null ? void 0 : r[s]) ?? ((l = e.mapAgents) == null ? void 0 : l[s]) : void 0) ?? kt(e, t, n, s));
    return {
        agents: a,
        style: os(Object.values(a))
    }
}
const He = (e, t, s) => {
    var n;
    return (t === e.myTeam ? (n = e.mapTactics) == null ? void 0 : n[s] : void 0) ?? e.teams[t].tactics
};

function Ge(e, t, s, n, a = !1) {
    var Ae;
    const r = e.teams[t],
        l = ht(e, t),
        {
            agents: c,
            style: h
        } = We(e, t, s, l),
        o = n && e.teams[n] ? We(e, n, s) : void 0,
        m = (o == null ? void 0 : o.style) ?? "standard",
        d = G(e) ? (Ae = e.cardMatchStrength) == null ? void 0 : Ae[t] : void 0;
    if (d !== void 0) {
        const S = d,
            I = d + 1.6,
            L = [1 / 3, 1 / 3, 1 / 3];
        return {
            team: r,
            players: l,
            agents: c,
            style: h,
            atk: S,
            def: I,
            chem: 65,
            midRound: 0,
            edge: {
                base: d,
                igl: 0,
                chem: 0,
                coach: 0,
                comp: 0,
                map: 0,
                utility: 0,
                tacticsAtk: 0,
                tacticsDef: 1.6,
                atk: S,
                def: I
            },
            mix: L,
            mixName: Ee(L),
            purity: Ce(L)
        }
    }
    const f = G(e) ? {
            total: 0,
            version: 0,
            map: 0,
            counter: 0,
            mix: [1 / 3, 1 / 3, 1 / 3]
        } : As(Object.values(c), Object.values((o == null ? void 0 : o.agents) ?? {}), s, e.patch),
        p = l.map(S => ve(S, e.day) * (G(e) ? 1 : bt(S, c[S.id]))).slice().sort((S, I) => I - S),
        x = [1.24, 1.1, 1, .9, .76];
    let u = 0,
        g = 0;
    p.forEach((S, I) => {
        const L = x[I] ?? .8;
        u += S * L, g += L
    }), u = g > 0 ? u / g : 55, u = as(e, u);
    const b = S => l.length ? l.reduce((I, L) => I + L.attrs[S], 0) / l.length : 55,
        w = Ft(e, r.id, l),
        N = w ? (w.attrs.igl - 60) * .09 : -4,
        v = Mt(e, r.id),
        A = R((b("teamwork") + b("communication")) / 2 + (v - wt) * .18, 20, 99),
        M = (A - 65) * .07,
        C = r.id === e.myTeam,
        $ = (Wt(r, "tactics") - 60) * .05 + (C ? At(e.manager, "tactics", .06) - 1 : 0) + (C ? me(e, "opponent") * 2.4 : 0),
        P = mt(l) - (G(e) ? 0 : _s(Object.values(c))),
        q = ((r.mapPrefs[s] ?? 50) - 50) * .07,
        E = He(e, t, s),
        k = ls(E, h, m, b("utility")),
        ae = k.utility + (b("utility") - 65) * .05 + (C ? me(e, "economy") * 1.8 : 0),
        X = at(e, t, s, c),
        H = ds(X),
        _ = k.styleAtk + k.matchupAtk,
        Z = k.styleDef + k.matchupDef,
        je = -Math.max(0, 5 - l.length) * 18,
        ie = n && o ? Cs(e, t, n, s, o.agents, He(e, n, s), a) : 0,
        be = u + N + M + $ + P + q + ae + je + H + f.total + ie,
        Me = be + k.tacticsAtk + _ + (b("aim") - 65) * .05,
        we = be + k.tacticsDef + Z + (b("awareness") - 65) * .05 + 1.6,
        dt = (E.adaptability - 50) * K * .05 + (w ? (w.attrs.igl - 60) * .06 : -3) + (b("clutch") - 65) * .05 + k.styleMid + k.matchupMid,
        ft = {
            base: u,
            igl: N,
            chem: M,
            coach: $,
            comp: P,
            shortHanded: je,
            map: q,
            utility: ae,
            tacticsAtk: k.tacticsAtk,
            tacticsDef: k.tacticsDef,
            style: (k.styleAtk + k.styleDef) / 2,
            matchup: (k.matchupAtk + k.matchupDef) / 2,
            familiarity: H,
            ...ie ? {
                prep: ie
            } : {},
            version: f.version,
            mapFit: f.map,
            counter: f.counter,
            atk: Me,
            def: we
        };
    return {
        team: r,
        players: l,
        agents: c,
        style: h,
        atk: Me,
        def: we,
        chem: A,
        midRound: dt,
        edge: ft,
        mix: f.mix,
        mixName: Ee(f.mix),
        purity: Ce(f.mix)
    }
}
const Ds = e => e === "stage1" || e === "masters2" ? 1 : e === "stage2" || e === "champions" || e === "offseason" ? 2 : 0;

function Rs(e, t = 0, s) {
    const n = new V(e ^ 24301),
        a = n.shuffle($t.slice()),
        r = a.slice(0, 7),
        l = a.slice(7);
    for (let c = 1; c <= t; c++) {
        const h = 1 + n.int(0, 1);
        for (let o = 0; o < h; o++) {
            const m = n.int(0, r.length - 1),
                d = n.int(0, l.length - 1),
                f = r[m];
            r[m] = l[d], l[d] = f
        }
    }
    if (s !== void 0) {
        const c = `${s}-${Fs[t]}`,
            h = o => !!$e[o] && $e[o] > c;
        for (let o = 0; o < r.length; o++) {
            if (!h(r[o])) continue;
            const m = l.findIndex(f => !h(f));
            if (m < 0) continue;
            const d = r[o];
            r[o] = l[m], l[m] = d
        }
    }
    return r.sort()
}
const Fs = ["01-01", "04-01", "07-01"],
    Ws = e => Rt(e) ?? Rs(e.seed + e.year, Ds(e.stage), G(e) ? void 0 : e.year);

function Hs(e) {
    return e === 1 ? ["ban", "ban", "ban", "ban", "ban", "ban"] : e === 3 ? ["ban", "ban", "pick", "pick", "ban", "ban"] : ["ban", "ban", "pick", "pick", "pick", "pick"]
}
const Gs = e => !!e && e.includes("总决赛");

function Ks(e, t = !1) {
    return Hs(e).map((s, n) => ({
        action: s,
        actor: t ? n < 3 ? 0 : (n - 3) % 2 === 0 ? 1 : 0 : n % 2
    }))
}

function Qn(e, t, s, n, a, r) {
    const l = e.teams[t],
        c = e.teams[s],
        h = (o, m) => (o.mapPrefs[m] ?? 50) + r.range(-6, 6);
    return n === "ban" ? a.reduce((o, m) => h(c, m) - h(l, m) > h(c, o) - h(l, o) ? m : o) : a.reduce((o, m) => h(l, m) > h(l, o) ? m : o)
}

function Ys(e, t, s, n, a, r, l = !1) {
    const c = e.teams[t],
        h = e.teams[s];
    let o = a.slice();
    const m = [],
        d = [],
        f = Ks(n, l);
    l && d.push(`${c.name} 从胜者组决赛上来，拿 2 ban 1 选的优先权`);
    const y = (x, u) => (x.mapPrefs[u] ?? 50) + r.range(-6, 6);
    for (let x = 0; x < f.length && o.length > 1; x++) {
        const u = f[x].actor === 0 ? c : h,
            g = f[x].actor === 0 ? h : c,
            b = f[x].action;
        let w;
        b === "ban" ? (w = o.reduce((N, v) => y(g, v) - y(u, v) > y(g, N) - y(u, N) ? v : N), d.push(`${u.name} ban 掉 ${w}`)) : (w = o.reduce((N, v) => y(u, v) > y(u, N) ? v : N), m.push(w), d.push(`${u.name} 选下 ${w}`)), o = o.filter(N => N !== w)
    }
    const p = n;
    for (; m.length < p && o.length;) {
        const x = o[r.int(0, o.length - 1)];
        m.push(x), o = o.filter(u => u !== x), d.push(`决胜图：${x}`)
    }
    return {
        maps: m.slice(0, n),
        log: d
    }
}
class Ke {
    constructor() {
        j(this, "money", 800);
        j(this, "lossStreak", 0)
    }
    decide(t) {
        return this.money >= 3900 ? "full" : this.money >= 2200 && t.chance(.55) ? "force" : "eco"
    }
    spend(t) {
        t === "full" ? this.money -= 3900 : t === "force" ? this.money -= 2300 : this.money -= 500, this.money = Math.max(0, this.money)
    }
    onWin(t) {
        this.money += 3e3 + t * 200, this.lossStreak = 0, this.money = Math.min(this.money, 9e3)
    }
    onLoss(t) {
        this.money += 1900 + Math.min(this.lossStreak, 2) * 500 + t * 200, this.lossStreak++, this.money = Math.min(this.money, 9e3)
    }
    reset() {
        this.money = 800, this.lossStreak = 0
    }
}
const Ye = {
    full: 0,
    force: -6.5,
    eco: -15
};

function Us() {
    return {
        kills: 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        firstKills: 0,
        firstDeaths: 0,
        clutches: 0,
        rounds: 0,
        acs: 0
    }
}

function Vs(e, t, s, n, a, r, l, c) {
    const h = {},
        o = (d, f, y, p) => {
            if (!d.length) return;
            const x = f.slice();
            for (let u = 0; u < y && x.length; u++) {
                const g = d.map(M => Ls(M) * Ps(M) * (M.id === c ? 1.55 : 1)),
                    b = x.map(M => (120 - M.attrs.awareness * .35 - M.attrs.clutch * .2) * Is[M.role]),
                    w = r.weighted(d, g),
                    N = r.weighted(x, b),
                    v = a.lines[w.id],
                    A = a.lines[N.id];
                if (v.kills++, h[w.id] = (h[w.id] ?? 0) + 1, v.damage += 120 + r.range(0, 55), A.deaths++, p && u === 0) {
                    const M = r.weighted(d, d.map($ => Fe[$.role] * ($.attrs.aim / 60))),
                        C = r.weighted(x, x.map($ => Fe[$.role]));
                    a.lines[M.id].firstKills++, a.lines[C.id].firstDeaths++
                }
                if (r.chance(.42)) {
                    const M = d.filter(C => C.id !== w.id);
                    if (M.length) {
                        const C = M.map($ => $.attrs.utility * .7 + $.attrs.communication * .3);
                        a.lines[r.weighted(M, C).id].assists++
                    }
                }
                x.splice(x.indexOf(N), 1)
            }
        };
    o(e, t, n, !0), o(t, e, s, !1);
    for (const d of [...e, ...t]) a.lines[d.id].damage += r.range(20, 60) * (.75 + d.attrs.utility / 260), a.lines[d.id].rounds++;
    const m = () => a.highlights.length < 9;
    for (const d of e) {
        const f = h[d.id] ?? 0;
        f >= 5 && m() ? a.highlights.push(O.ace(d.ign, l)) : f === 4 && m() && r.chance(.5) && a.highlights.push(O.quad(d.ign))
    }
    if (s === 4) {
        const d = r.weighted(e, e.map(y => y.attrs.clutch * .6 + y.attrs.awareness * .4));
        a.lines[d.id].clutches++;
        const f = Math.max(1, Math.min(h[d.id] ?? 1, n));
        m() && (f >= 3 || r.chance(.4)) && a.highlights.push(O.clutch(d.ign, f))
    }
}
class qs {
    constructor(t, s, n, a, r = "first13") {
        j(this, "map");
        j(this, "A");
        j(this, "B");
        j(this, "a", 0);
        j(this, "b", 0);
        j(this, "round", 0);
        j(this, "timeouts", {
            a: 2,
            b: 2
        });
        j(this, "calls", {
            a: null,
            b: null
        });
        j(this, "rng");
        j(this, "ctx");
        j(this, "ecoA", new Ke);
        j(this, "ecoB", new Ke);
        j(this, "halfA", 0);
        j(this, "halfB", 0);
        j(this, "otAnnounced", !1);
        j(this, "streak", 0);
        j(this, "streakSide", null);
        j(this, "mapPointSaid", !1);
        j(this, "format");
        j(this, "swingA");
        j(this, "swingB");
        this.format = r, this.map = t, this.A = s, this.B = n, this.rng = a, this.swingA = a.norm(0, De), this.swingB = a.norm(0, De), this.ctx = {
            lines: {},
            highlights: [],
            rounds: []
        };
        for (const l of [...s.players, ...n.players]) this.ctx.lines[l.id] = Us()
    }
    phase() {
        const t = this.round + 1;
        return t <= 12 ? {
            aAttack: !0,
            pistol: t === 1,
            half: 1
        } : t <= 24 ? {
            aAttack: !1,
            pistol: t === 13,
            half: 2
        } : {
            aAttack: (t - 25) % 2 === 0,
            pistol: !1,
            half: 3
        }
    }
    get over() {
        return this.format === "full24" ? this.round >= 24 : (this.a >= 13 || this.b >= 13) && Math.abs(this.a - this.b) >= 2
    }
    get rounds() {
        return this.ctx.rounds
    }
    get highlights() {
        return this.ctx.highlights
    }
    liveLines() {
        const t = {};
        for (const [s, n] of Object.entries(this.ctx.lines)) {
            const a = Math.round(n.damage);
            t[s] = {
                ...n,
                damage: a,
                rounds: this.round,
                acs: this.round ? Math.round(a / this.round * 1.45) : 0
            }
        }
        return t
    }
    canTimeout(t) {
        return !this.over && this.timeouts[t] > 0 && this.round > 0
    }
    callTimeout(t, s) {
        return this.canTimeout(t) ? (this.timeouts[t]--, this.calls[t] = {
            ...s,
            roundsLeft: 3
        }, !0) : !1
    }
    callMod(t, s, n) {
        return t ? t.kind === "rush" ? (s ? 2.4 : -1.6) * Oe("rush", n) : t.kind === "steady" ? (s ? -1.2 : 2) * Oe("steady", n) : .6 : 0
    }
    playRound() {
        var X, H;
        if (this.over) return;
        const {
            aAttack: t,
            pistol: s
        } = this.phase();
        this.round++, (this.round === 1 || this.round === 13 || this.round >= 25 && (this.round - 25) % 2 === 0) && (this.ecoA.reset(), this.ecoB.reset()), this.round === 13 && (this.halfA = this.a, this.halfB = this.b), this.round === 25 && this.format !== "full24" && !this.otAnnounced && (this.otAnnounced = !0, this.ctx.highlights.push(O.overtime()), this.timeouts.a++, this.timeouts.b++);
        const n = this.rng,
            a = s ? "eco" : this.ecoA.decide(n),
            r = s ? "eco" : this.ecoB.decide(n);
        s || (this.ecoA.spend(a), this.ecoB.spend(r));
        const l = (t ? this.A.atk : this.A.def) + (s ? 0 : Ye[a]) + this.callMod(this.calls.a, t, this.A.style) + this.swingA,
            c = (t ? this.B.def : this.B.atk) + (s ? 0 : Ye[r]) + this.callMod(this.calls.b, !t, this.B.style) + this.swingB,
            h = this.a < this.b ? this.A.midRound * .35 : 0,
            o = this.b < this.a ? this.B.midRound * .35 : 0,
            m = l + h - (c + o),
            d = s ? Re + 5 : Re,
            f = 1 / (1 + Math.exp(-m / d)),
            y = n.chance(f),
            p = ((X = y ? this.calls.a : this.calls.b) == null ? void 0 : X.kind) === "rush",
            x = ((H = y ? this.calls.a : this.calls.b) == null ? void 0 : H.kind) === "steady",
            u = n.chance(p ? .82 : .75),
            g = Math.abs(f - .5),
            b = y ? this.A.players : this.B.players,
            w = y ? this.B.players : this.A.players,
            N = _ => Math.min(1, _.length / 5),
            v = Math.min(w.length, Math.round((u ? 5 : n.int(2, 4)) * N(b))),
            A = Math.min(b.length, Math.round(n.weighted([0, 1, 2, 3, 4], [(1.2 - g) * (x ? 1.6 : 1), 2.6, 3.4, 2.8, (1.6 + g * 1.5) * (p ? 1.4 : x ? .7 : 1)]) * N(w))),
            M = y ? this.calls.a : this.calls.b;
        Vs(b, w, A, v, this.ctx, n, Xe(this.map), (M == null ? void 0 : M.kind) === "focus" ? M.playerId : void 0), y ? (this.a++, this.ecoA.onWin(v), this.ecoB.onLoss(A)) : (this.b++, this.ecoB.onWin(v), this.ecoA.onLoss(A));
        const $ = u ? "elim" : y === t ? "spike" : n.chance(.55) ? "defuse" : "time";
        this.ctx.rounds.push({
            n: this.round,
            winner: y ? "A" : "B",
            aAttack: t,
            end: $,
            buyA: a,
            buyB: r
        });
        const P = y ? this.A.team.name : this.B.team.name,
            q = y ? this.B.team.name : this.A.team.name,
            E = () => this.ctx.highlights.length < 9;
        s && E() && n.chance(.3) && this.ctx.highlights.push(O.eco(P)), !s && (y ? a : r) === "eco" && (y ? r : a) === "full" && E() && n.chance(.14) && this.ctx.highlights.push(O.antiEco(P, q)), A === 0 && v === 5 && E() && n.chance(.22) && this.ctx.highlights.push(O.flawless(P)), this.streak = this.streakSide === (y ? "A" : "B") ? this.streak + 1 : 1, this.streakSide = y ? "A" : "B", this.streak === 5 && E() && this.ctx.highlights.push(O.streak(P, this.streak)), this.mapPointSaid || (!y && this.a === 12 && this.b < 12 ? (this.mapPointSaid = !0, E() && this.ctx.highlights.push(O.mapPoint(this.B.team.name))) : y && this.b === 12 && this.a < 12 && (this.mapPointSaid = !0, E() && this.ctx.highlights.push(O.mapPoint(this.A.team.name))));
        for (const _ of ["a", "b"]) {
            const Z = this.calls[_];
            Z && --Z.roundsLeft <= 0 && (this.calls[_] = null)
        }
    }
    result() {
        if (this.halfA <= 3 && this.a > this.b || this.halfB <= 3 && this.b > this.a) {
            const s = this.a > this.b ? this.A.team.name : this.B.team.name,
                n = this.a > this.b ? this.halfA : this.halfB;
            this.ctx.highlights.length < 8 && this.ctx.highlights.push(O.comeback(s, n))
        }
        const t = this.a + this.b;
        for (const s of Object.keys(this.ctx.lines)) {
            const n = this.ctx.lines[s];
            n.damage = Math.round(n.damage), n.rounds = t, n.acs = t ? Math.round(n.damage / t * 1.45) : 0
        }
        return {
            score: {
                map: this.map,
                scoreA: this.a,
                scoreB: this.b,
                edge: {
                    a: this.A.edge,
                    b: this.B.edge
                },
                lines: this.ctx.lines,
                rounds: this.ctx.rounds,
                agents: {
                    ...this.A.agents,
                    ...this.B.agents
                }
            },
            highlights: this.ctx.highlights
        }
    }
    runOut() {
        let t = 0;
        for (; !this.over && t++ < 80;) this.playRound()
    }
}
class Xs {
    constructor(t, s, n, a, r, l, c) {
        j(this, "maps");
        j(this, "vetoLog");
        j(this, "need");
        j(this, "aId");
        j(this, "bId");
        j(this, "wonA", 0);
        j(this, "wonB", 0);
        j(this, "played", []);
        j(this, "highlights", []);
        j(this, "current", null);
        j(this, "mapIndex", -1);
        j(this, "state");
        j(this, "rng");
        j(this, "seenA", new Set);
        j(this, "seenB", new Set);
        j(this, "format");
        j(this, "scrim");
        if (this.state = t, this.aId = s, this.bId = n, this.rng = r, this.need = Math.ceil(a / 2), this.format = (l == null ? void 0 : l.format) ?? "first13", this.scrim = !!l, l) this.maps = [l.map], this.vetoLog = [];
        else if (t.vetoPlan && t.vetoPlan.maps.length === a) this.maps = t.vetoPlan.maps.slice(), this.vetoLog = t.vetoPlan.log.slice();
        else {
            const h = Ws(t),
                {
                    maps: o,
                    log: m
                } = Ys(t, s, n, a, h, r, Gs(c));
            this.maps = o, this.vetoLog = m
        }
    }
    get decided() {
        return this.wonA >= this.need || this.wonB >= this.need
    }
    sideOf(t) {
        return t === this.aId ? "a" : t === this.bId ? "b" : null
    }
    nextMap() {
        if (this.decided || this.mapIndex + 1 >= this.maps.length) return !1;
        this.mapIndex++;
        const t = this.maps[this.mapIndex],
            s = Ge(this.state, this.aId, t, this.bId, !this.scrim),
            n = Ge(this.state, this.bId, t, this.aId, !this.scrim);
        for (const a of s.players) this.seenA.add(a.id);
        for (const a of n.players) this.seenB.add(a.id);
        return this.current = new qs(t, s, n, this.rng, this.format), !0
    }
    closeMap() {
        if (!this.current) return;
        const {
            score: t,
            highlights: s
        } = this.current.result();
        this.played.push(t);
        for (const n of s) this.highlights.length < 10 && this.highlights.push(`[${Xe(t.map)}] ${n}`);
        t.scoreA > t.scoreB ? this.wonA++ : t.scoreB > t.scoreA && this.wonB++, this.current = null
    }
    finish() {
        var r;
        const t = {};
        for (const l of this.played)
            for (const [c, h] of Object.entries(l.lines)) {
                const o = t[c] ?? (t[c] = {
                    acs: 0,
                    maps: 0
                });
                o.acs += h.acs, o.maps++
            }
        const s = new Set(((r = this.wonA > this.wonB ? this.state.teams[this.aId] : this.state.teams[this.bId]) == null ? void 0 : r.roster) ?? []);
        let n = null,
            a = -1;
        for (const [l, c] of Object.entries(t)) {
            if (!c.maps) continue;
            const h = c.acs / c.maps + (s.has(l) ? 18 : 0);
            h > a && (a = h, n = l)
        }
        return {
            mapsWonA: this.wonA,
            mapsWonB: this.wonB,
            maps: this.played,
            vetoLog: this.vetoLog,
            mvp: n,
            highlights: this.highlights,
            lineups: {
                a: [...this.seenA],
                b: [...this.seenB]
            }
        }
    }
    runOut() {
        for (; !this.decided && this.nextMap();) this.current.runOut(), this.closeMap();
        return this.finish()
    }
}

function zn(e) {
    for (const t of e.maps) delete t.rounds, delete t.edge
}

function ea(e) {
    const t = e.day - 10,
        s = e.day - 45;
    for (const n of e.fixtures)
        if (!(!n.played || !n.result)) {
            if (n.teamA === e.myTeam || n.teamB === e.myTeam) {
                if (n.day >= s) continue;
                for (const a of n.result.maps) delete a.rounds, delete a.edge;
                continue
            }
            if (!(n.day >= t) && !(!n.result.vetoLog.length && !n.result.highlights.length && !n.result.lineups && !n.result.maps.some(a => a.agents || a.edge || a.rounds || Object.keys(a.lines).length))) {
                n.result.vetoLog = [], n.result.highlights = [], delete n.result.lineups;
                for (const a of n.result.maps) a.lines = {}, delete a.edge, delete a.rounds, delete a.agents
            }
        }
}

function ta(e) {
    for (const t of e.fixtures)
        if (t.result) {
            if (t.result.vetoLog = [], t.result.highlights = [], delete t.result.lineups, t.teamA !== e.myTeam && t.teamB !== e.myTeam) {
                t.result.maps = [];
                continue
            }
            for (const s of t.result.maps) s.lines = {}, delete s.edge, delete s.rounds, delete s.agents
        } if (e.news.length > 100 && e.news.splice(0, e.news.length - 100), e.transferFeed && e.transferFeed.length > 300) {
        const t = ke(e) - 30,
            s = e.transferFeed.filter(n => n.k === "done" || n.k === "free" || n.k === "release" || ke({
                year: n.y,
                day: n.d
            }) >= t);
        e.transferFeed = s.slice(-300)
    }
    e.finances.log.length > 100 && e.finances.log.splice(0, e.finances.log.length - 100)
}

function sa(e, t, s, n, a, r, l) {
    return new Xs(e, t, s, n, a, r, l).runOut()
}

function na(e, t) {
    for (const s of t.maps)
        for (const [n, a] of Object.entries(s.lines)) {
            const r = e.players[n];
            if (r)
                for (const l of [r.season, r.career]) l.maps++, l.rounds += a.rounds, l.kills += a.kills, l.deaths += a.deaths, l.assists += a.assists, l.firstKills += a.firstKills, l.firstDeaths += a.firstDeaths, l.damage += a.damage, l.clutches += a.clutches
        }
    if (t.mvp) {
        const s = e.players[t.mvp];
        s && (s.season.mvps++, s.career.mvps++)
    }
}

function aa(e, t) {
    const s = new Set(e.scoreA > e.scoreB ? (t == null ? void 0 : t.a) ?? [] : (t == null ? void 0 : t.b) ?? []);
    let n = -1,
        a = null;
    for (const [r, l] of Object.entries(e.lines)) {
        const c = l.acs + (s.has(r) ? 18 : 0);
        c > n && (n = c, a = r)
    }
    return a
}
const Zs = ["FranX", "Song", "IDIOT", "simon", "睡在song上铺的戈门"];

function ia() {
    return i.jsxs("p", {
        className: "tiny faint",
        style: {
            textAlign: "center",
            margin: "10px 0 0"
        },
        children: ["感谢名单 ", i.jsx("b", {
            children: Zs.join("、")
        })]
    })
}

function oa() {
    return i.jsxs("footer", {
        className: "credit",
        children: [i.jsxs("span", {
            children: [i.jsx("b", {
                children: "猪之家"
            }), "出品"]
        }), i.jsx("span", {
            className: "sep",
            children: "·"
        }), i.jsxs("span", {
            children: ["小红书", i.jsx("b", {
                children: "@点点点点点点点点"
            })]
        }), i.jsx("span", {
            className: "sep",
            children: "·"
        }), i.jsxs("span", {
            children: ["抖音", i.jsx("b", {
                children: "@点点点点点点点点"
            })]
        }), i.jsx("span", {
            className: "sep",
            children: "·"
        }), i.jsx("span", {
            children: i.jsx("a", {
                href: Ht,
                target: "_blank",
                rel: "noreferrer noopener",
                children: "支持作者"
            })
        })]
    })
}
const Js = ["决斗者", "先锋", "控场", "哨卫", "自由人"],
    Qs = new Map(Ze.map(e => [e.playerId, e])),
    W = new Map;
for (const e of _t) {
    const t = W.get(e.playerId) ?? [];
    t.push(e), W.set(e.playerId, t)
}
const zs = new Map(Ve.map(e => [e.id, e]));

function ra({
    playerId: e,
    onOpen: t,
    onClose: s
}) {
    const [n, a] = B.useState(""), [r, l] = B.useState("all"), [c, h] = B.useState("all"), [o, m] = B.useState("rating"), [d, f] = B.useState("active"), y = B.useMemo(() => {
        const u = n.trim().toLowerCase();
        return oe.filter(g => r !== "all" && g.region !== r || c !== "all" && c !== "igl" && !(g.roles ?? [g.role]).includes(c) ? !1 : u ? `${g.ign} ${g.real??""} ${g.peakClub??""} ${g.lastClub??""} ${Y(g.nat)} ${g.nat??""}`.toLowerCase().includes(u) : !0).sort((g, b) => (o === "age" ? g.age - b.age : 0) || b.peak - g.peak)
    }, [n, r, c, o]), p = B.useMemo(() => {
        const u = n.trim().toLowerCase();
        return Ze.filter(g => {
            if (r !== "all" && g.region !== r) return !1;
            if (c === "igl") {
                if (!g.isIgl) return !1
            } else if (c !== "all" && !g.roles.includes(c)) return !1;
            return u ? `${g.ign} ${g.realName??""} ${g.clubTag??""} ${Y(g.nat)} ${g.nat??""}`.toLowerCase().includes(u) : !0
        }).map(g => {
            var b;
            return {
                card: g,
                titles: he(g.playerId),
                winnings: ((b = fe(g.playerId)) == null ? void 0 : b.win) ?? 0
            }
        }).sort((g, b) => o === "honours" ? b.titles - g.titles || b.card.rating - g.card.rating : o === "winnings" ? b.winnings - g.winnings || b.card.rating - g.card.rating : o === "age" && g.card.age - b.card.age || b.card.rating - g.card.rating)
    }, [n, r, c, o]), x = e ? Qs.get(e) : null;
    return x ? i.jsx(tn, {
        card: x,
        onBack: () => t(null)
    }) : i.jsxs(D, {
        title: "选手资料库",
        actions: i.jsxs("div", {
            className: "row",
            style: {
                gap: 8
            },
            children: [i.jsx("span", {
                className: "tiny muted mono",
                children: d === "retired" ? `${y.length} / ${oe.length}` : `${p.length} / ${Je.length}`
            }), s && i.jsx("button", {
                className: "ghost sm",
                onClick: s,
                children: "返回"
            })]
        }),
        children: [i.jsxs("p", {
            className: "tiny faint",
            style: {
                marginTop: 0,
                lineHeight: 1.7
            },
            children: [T.meta.players, " 名选手的照片、国籍、生涯队伍、荣誉与赛事记录。 名次、奖金与 ", T.meta.photos + T.meta.histPhotos - T.meta.lpPhotos - T.meta.hjPhotos - T.meta.spikePhotos, " 张照片取自 vlr.gg； 队伍履历与另外 ", T.meta.lpPhotos, " 张照片取自 Liquipedia（图片依 CC BY-SA 3.0 使用）；", T.meta.hjPhotos, " 张照片取自号角 HOJO（haojiao.cc）", `，${T.meta.spikePhotos} 张取自 THESPIKE.GG`, "。 共收录 ", T.meta.events, " 项赛事。"]
        }), i.jsxs("div", {
            className: "seg",
            style: {
                marginTop: 4
            },
            children: [i.jsx("button", {
                className: d === "active" ? "on" : "",
                onClick: () => f("active"),
                children: "现役"
            }), i.jsxs("button", {
                className: d === "retired" ? "on" : "",
                onClick: () => f("retired"),
                children: ["退役 · ", oe.length]
            })]
        }), i.jsxs("div", {
            className: "row wrap",
            style: {
                gap: 8,
                margin: "12px 0"
            },
            children: [i.jsx("input", {
                style: {
                    width: 200
                },
                type: "search",
                "aria-label": "搜索选手资料",
                placeholder: "搜 ID / 真名 / 战队 / 国籍",
                value: n,
                onChange: u => a(u.target.value)
            }), i.jsxs("select", {
                "aria-label": "资料库赛区",
                style: {
                    width: "auto"
                },
                value: r,
                onChange: u => l(u.target.value),
                children: [i.jsx("option", {
                    value: "all",
                    children: "全部赛区"
                }), St.map(u => i.jsx("option", {
                    value: u,
                    children: ue[u]
                }, u))]
            }), i.jsxs("select", {
                "aria-label": "资料库位置",
                style: {
                    width: "auto"
                },
                value: c,
                onChange: u => h(u.target.value),
                children: [i.jsx("option", {
                    value: "all",
                    children: "全部位置"
                }), Js.map(u => i.jsx("option", {
                    value: u,
                    children: u
                }, u)), d === "active" && i.jsx("option", {
                    value: "igl",
                    children: "指挥（IGL）"
                })]
            }), i.jsxs("div", {
                className: "seg",
                children: [i.jsx("button", {
                    className: o === "rating" || d === "retired" && o !== "age" ? "on" : "",
                    onClick: () => m("rating"),
                    children: "能力"
                }), d === "active" && i.jsx("button", {
                    className: o === "honours" ? "on" : "",
                    onClick: () => m("honours"),
                    children: "冠军"
                }), d === "active" && i.jsx("button", {
                    className: o === "winnings" ? "on" : "",
                    onClick: () => m("winnings"),
                    children: "奖金"
                }), i.jsx("button", {
                    className: o === "age" ? "on" : "",
                    onClick: () => m("age"),
                    children: "年龄"
                })]
            })]
        }), d === "retired" ? i.jsx(en, {
            list: y
        }) : i.jsxs(i.Fragment, {
            children: [i.jsx("div", {
                className: "table-wrap",
                children: i.jsxs("table", {
                    children: [i.jsx("thead", {
                        children: i.jsxs("tr", {
                            children: [i.jsx("th", {
                                children: "选手"
                            }), i.jsx("th", {
                                children: "真名"
                            }), i.jsx("th", {
                                children: "国籍"
                            }), i.jsx("th", {
                                children: "战队"
                            }), i.jsx("th", {
                                children: "位置"
                            }), i.jsx("th", {
                                className: "right",
                                children: "能力"
                            }), i.jsx("th", {
                                className: "right",
                                children: "冠军"
                            }), i.jsx("th", {
                                className: "right",
                                children: "奖金"
                            })]
                        })
                    }), i.jsx("tbody", {
                        children: p.slice(0, 300).map(({
                            card: u,
                            titles: g,
                            winnings: b
                        }) => i.jsxs("tr", {
                            style: {
                                cursor: "pointer"
                            },
                            onClick: () => t(u.playerId),
                            children: [i.jsxs("td", {
                                children: [i.jsx("button", {
                                    className: "ghost sm",
                                    onClick: w => {
                                        w.stopPropagation(), t(u.playerId)
                                    },
                                    "aria-label": `查看 ${u.ign} 的资料`,
                                    children: u.ign
                                }), W.has(u.playerId) && i.jsx("span", {
                                    className: "cf-star",
                                    style: {
                                        position: "static",
                                        marginLeft: 5,
                                        fontSize: 11
                                    },
                                    title: W.get(u.playerId).map(w => w.legend.title).join("、"),
                                    children: "★"
                                }), u.isIgl && i.jsx("span", {
                                    className: "tag t2",
                                    style: {
                                        marginLeft: 5
                                    },
                                    children: "IGL"
                                })]
                            }), i.jsx("td", {
                                className: "muted small",
                                children: u.realName ?? "—"
                            }), i.jsxs("td", {
                                className: "small",
                                children: [i.jsx(pe, {
                                    nat: u.nat
                                }), " ", Y(u.nat)]
                            }), i.jsx("td", {
                                children: u.clubTag ?? i.jsx("span", {
                                    className: "faint",
                                    children: "自由人"
                                })
                            }), i.jsx("td", {
                                className: "small",
                                children: u.roles.join("/")
                            }), i.jsx("td", {
                                className: "right mono",
                                children: u.rating
                            }), i.jsx("td", {
                                className: "right mono",
                                children: g || i.jsx("span", {
                                    className: "faint",
                                    children: "—"
                                })
                            }), i.jsx("td", {
                                className: "right mono small",
                                children: b ? et(b) : i.jsx("span", {
                                    className: "faint",
                                    children: "—"
                                })
                            })]
                        }, u.id))
                    })]
                })
            }), p.length > 300 && i.jsx("p", {
                className: "tiny faint",
                style: {
                    marginTop: 10
                },
                children: "只显示前 300 人，搜索可缩小范围。"
            })]
        })]
    })
}

function en({
    list: e
}) {
    return e.length ? i.jsxs(i.Fragment, {
        children: [i.jsx("p", {
            className: "tiny faint",
            style: {
                marginTop: 0
            },
            children: "2023–2025 年打过 VCT 或次级联赛、如今已退役、转做教练或没有战队的选手。能力分是 Beta 预估值，还在调整。年龄按 2026 年 1 月 1 日计，标「约」的是查不到生日、按当年资料推算的。"
        }), i.jsx("div", {
            className: "retired-grid",
            children: e.map(t => {
                var s, n;
                return i.jsxs("article", {
                    className: "retired-card",
                    children: [i.jsx("img", {
                        src: qe(t.img, (n = (s = T.hist) == null ? void 0 : s[t.id]) == null ? void 0 : n.v),
                        alt: t.ign,
                        loading: "lazy"
                    }), i.jsxs("div", {
                        className: "retired-body",
                        children: [i.jsxs("div", {
                            children: [i.jsx("b", {
                                children: t.ign
                            }), t.coach && i.jsx("span", {
                                className: "tag t2",
                                style: {
                                    marginLeft: 5
                                },
                                children: "转教练"
                            })]
                        }), i.jsx("div", {
                            className: "tiny muted",
                            children: t.real ?? "—"
                        }), i.jsxs("div", {
                            className: "small",
                            children: [i.jsx(pe, {
                                nat: t.nat
                            }), " ", Y(t.nat), " · ", ue[t.region] ?? t.region]
                        }), i.jsxs("div", {
                            className: "small",
                            children: [t.ageEstimated ? "约 " : "", t.age, " 岁 · ", t.role]
                        }), i.jsxs("div", {
                            className: "tiny faint",
                            children: ["预估能力 ", t.peak]
                        })]
                    })]
                }, t.id)
            })
        })]
    }) : i.jsx("p", {
        className: "small muted",
        children: "没有符合条件的退役选手。"
    })
}

function tn({
    card: e,
    onBack: t
}) {
    var d, f, y;
    const s = fe(e.playerId),
        n = Je.find(p => p.id === e.playerId),
        a = e.clubId ? zs.get(e.clubId) : null,
        [r, l] = B.useState(Tt);
    B.useEffect(() => {
        if (r) return;
        let p = !0;
        return Ot().then(x => {
            p && l(x)
        }), () => {
            p = !1
        }
    }, [r]);
    const c = r ? Bt(r, e.playerId) : [],
        h = r ? Ct(r, e.playerId) : [],
        o = r ? Et(r, e.playerId) : [],
        m = B.useMemo(() => {
            const p = new Map;
            for (const x of h) {
                const u = x.year ?? 0,
                    g = p.get(u) ?? [];
                g.push(x), p.set(u, g)
            }
            return [...p.entries()].sort((x, u) => u[0] - x[0])
        }, [h]);
    return i.jsxs(i.Fragment, {
        children: [i.jsx("div", {
            className: "row",
            style: {
                marginBottom: 12
            },
            children: i.jsx("button", {
                className: "ghost sm",
                onClick: t,
                children: "← 返回资料库"
            })
        }), i.jsx(D, {
            title: e.ign,
            children: i.jsxs("div", {
                className: "dossier-head",
                children: [i.jsx(Gt, {
                    card: e,
                    size: "lg"
                }), i.jsxs("div", {
                    style: {
                        flex: 1,
                        minWidth: 250
                    },
                    children: [i.jsx("div", {
                        style: {
                            fontSize: 20,
                            fontWeight: 700
                        },
                        children: e.realName ?? e.ign
                    }), i.jsxs("div", {
                        className: "small muted",
                        style: {
                            marginTop: 6,
                            lineHeight: 1.9
                        },
                        children: [i.jsx(pe, {
                            nat: e.nat
                        }), " ", Y(e.nat), " · ", ue[e.region], i.jsx("br", {}), e.age, " 岁", n != null && n.birth ? `（${n.birth}）` : n != null && n.ageEstimated ? "（年龄为估算）" : "", " · ", a ? a.name : "自由人", i.jsx("br", {}), e.roles.join(" / "), e.isIgl && " · 队内指挥", " · ", It[e.rarity], " ", e.rating]
                    }), !!((d = W.get(e.playerId)) != null && d.length) && i.jsxs("div", {
                        className: "small",
                        style: {
                            marginTop: 10,
                            padding: "8px 11px",
                            borderRadius: 4,
                            lineHeight: 1.7,
                            background: "rgba(180,120,255,.10)",
                            border: "1px solid rgba(180,120,255,.35)"
                        },
                        children: [i.jsx("b", {
                            children: "★ 彩卡"
                        }), W.get(e.playerId).map(p => i.jsxs("div", {
                            className: "tiny",
                            style: {
                                marginTop: 3
                            },
                            children: [p.legend.title, i.jsxs("span", {
                                className: "faint",
                                children: [" · ", p.legend.clubTag, " · 评分 ", p.rating]
                            })]
                        }, p.id))]
                    }), i.jsxs("div", {
                        className: "row wrap",
                        style: {
                            gap: 6,
                            marginTop: 10
                        },
                        children: [he(e.playerId) > 0 && i.jsxs("span", {
                            className: "trait",
                            "data-good": "y",
                            children: [he(e.playerId), " 座冠军"]
                        }), !!(s != null && s.win) && i.jsxs("span", {
                            className: "trait",
                            "data-good": "y",
                            children: ["生涯奖金 ", et(s.win)]
                        }), h.length > 0 && i.jsxs("span", {
                            className: "trait",
                            children: [h.length, " 项赛事记录"]
                        }), o.length > 0 && i.jsxs("span", {
                            className: "trait",
                            children: [o.length, " 段队伍经历"]
                        })]
                    }), (s == null ? void 0 : s.vlr) && i.jsx("a", {
                        className: "tiny",
                        style: {
                            display: "inline-block",
                            marginTop: 10
                        },
                        href: `https://www.vlr.gg/player/${s.vlr}/`,
                        target: "_blank",
                        rel: "noreferrer noopener",
                        children: "vlr.gg 资料 ↗"
                    })]
                })]
            })
        }), i.jsxs("div", {
            className: "grid c2",
            style: {
                alignItems: "start"
            },
            children: [i.jsxs(D, {
                title: "能力",
                children: [Lt.map(p => i.jsxs("div", {
                    className: "row",
                    style: {
                        gap: 10,
                        margin: "5px 0"
                    },
                    children: [i.jsx("span", {
                        className: "tiny faint",
                        style: {
                            width: 30
                        },
                        children: Pt[p]
                    }), i.jsx("div", {
                        style: {
                            flex: 1
                        },
                        children: i.jsx(tt, {
                            value: e.attrs[p]
                        })
                    }), i.jsx("b", {
                        className: "mono tiny",
                        style: {
                            width: 20,
                            textAlign: "right"
                        },
                        children: e.attrs[p]
                    })]
                }, p)), ((f = n == null ? void 0 : n.vlr) == null ? void 0 : f.rating) != null && i.jsxs("p", {
                    className: "tiny faint",
                    style: {
                        marginTop: 12,
                        marginBottom: 0,
                        lineHeight: 1.7
                    },
                    children: ["按 vlr.gg 数据换算：Rating ", n.vlr.rating, n.vlr.acs != null && ` · ACS ${n.vlr.acs}`, n.vlr.rounds ? ` · ${n.vlr.rounds} 回合` : "", "。"]
                }), !!((y = n == null ? void 0 : n.agentPool) != null && y.length) && i.jsxs("div", {
                    style: {
                        marginTop: 12
                    },
                    children: [i.jsx("div", {
                        className: "tiny faint",
                        style: {
                            marginBottom: 5
                        },
                        children: "真实英雄池"
                    }), i.jsx("div", {
                        className: "row wrap",
                        style: {
                            gap: 4
                        },
                        children: n.agentPool.map(p => i.jsxs("span", {
                            className: "chiplet row",
                            style: {
                                gap: 4,
                                alignItems: "center"
                            },
                            children: [i.jsx(ns, {
                                name: p,
                                size: 16
                            }), le(p)]
                        }, p))
                    })]
                })]
            }), i.jsx(D, {
                title: "荣誉",
                children: r ? c.length === 0 ? i.jsx("p", {
                    className: "empty",
                    children: "还没有拿过冠军。"
                }) : i.jsx("div", {
                    className: "grid",
                    style: {
                        gap: 6
                    },
                    children: c.map((p, x) => i.jsxs("div", {
                        className: `trophy${p.major?" major":""}`,
                        children: [i.jsx("span", {
                            children: p.major ? "🏆" : "🥇"
                        }), i.jsx("span", {
                            className: "small",
                            children: p.event
                        }), i.jsx("span", {
                            className: "yr mono",
                            children: p.year ?? ""
                        })]
                    }, x))
                }) : i.jsx("p", {
                    className: "empty",
                    children: "读取中…"
                })
            })]
        }), i.jsxs("div", {
            className: "grid c2",
            style: {
                alignItems: "start"
            },
            children: [i.jsx(D, {
                title: "生涯队伍",
                children: r ? o.length === 0 ? i.jsx("p", {
                    className: "empty",
                    children: "Liquipedia 没有队伍履历。"
                }) : i.jsx("ul", {
                    className: "cv",
                    children: o.map((p, x) => i.jsxs("li", {
                        className: p.current ? "now" : "",
                        children: [i.jsxs("div", {
                            className: "small",
                            children: [i.jsx("b", {
                                children: p.club
                            }), p.current && i.jsx("span", {
                                className: "tag t1",
                                style: {
                                    marginLeft: 6
                                },
                                children: "现役"
                            })]
                        }), i.jsxs("div", {
                            className: "yrs",
                            children: [p.from ?? "?", " → ", p.to ?? "至今", p.months != null && p.months > 0 && ` · ${p.months>=12?`${Math.floor(p.months/12)} 年${p.months%12?` ${p.months%12} 个月`:""}`:`${p.months} 个月`}`]
                        })]
                    }, x))
                }) : i.jsx("p", {
                    className: "empty",
                    children: "读取中…"
                })
            }), i.jsx(D, {
                title: "赛事记录",
                actions: i.jsx("span", {
                    className: "tiny muted",
                    children: r ? `${h.length} 项` : ""
                }),
                children: r ? h.length === 0 ? i.jsx("p", {
                    className: "empty",
                    children: "vlr.gg 没有参赛记录。"
                }) : m.map(([p, x]) => i.jsxs("div", {
                    style: {
                        marginBottom: 12
                    },
                    children: [i.jsx("div", {
                        className: "tiny faint",
                        style: {
                            marginBottom: 4
                        },
                        children: p || "年份不明"
                    }), x.map((u, g) => i.jsxs("div", {
                        className: "row",
                        style: {
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "4px 0",
                            borderBottom: "1px solid var(--line-soft)"
                        },
                        children: [i.jsxs("span", {
                            className: "small",
                            style: {
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap"
                            },
                            children: [u.won && "🥇 ", u.event, u.club && i.jsxs("span", {
                                className: "tiny faint",
                                children: [" · ", u.club]
                            })]
                        }), i.jsx("span", {
                            className: "tiny mono",
                            style: {
                                color: u.won ? "var(--warn)" : u.podium ? "var(--win)" : "var(--muted)"
                            },
                            children: u.place ?? u.stage ?? "—"
                        })]
                    }, g))]
                }, p)) : i.jsx("p", {
                    className: "empty",
                    children: "读取中…"
                })
            })]
        })]
    })
}
export {
    Hn as $, ss as A, An as B, oa as C, ra as D, tt as E, Gn as F, Te as G, ge as H, Pn as I, ht as J, at as K, Ie as L, In as M, Be as N, Nn as O, D as P, Le as Q, ws as R, En as S, ia as T, Tn as U, kn as V, Ln as W, Sn as X, _n as Y, $n as Z, os as _, bn as a, ns as a0, ds as a1, Ge as a2, ts as a3, Os as a4, _e as a5, Jn as a6, nt as a7, dn as a8, wn as a9, On as aA, Qn as aB, Xs as aC, zt as aa, Jt as ab, F as ac, fn as ad, Qt as ae, Mn as af, jn as ag, Ut as ah, Xt as ai, qt as aj, Zt as ak, xn as al, un as am, gn as an, yn as ao, Vt as ap, et as aq, Cn as ar, Bn as as, Wn as at, Rn as au, aa as av, Dn as aw, fs as ax, Gs as ay, Ks as az, me as b, te as c, We as d, zn as e, Yt as f, Yn as g, Kn as h, Bs as i, qn as j, na as k, Un as l, Rs as m, Ds as n, ea as o, Ws as p, pn as q, Fn as r, sa as s, He as t, vn as u, Ls as v, Zn as w, Xn as x, Vn as y, ta as z
};