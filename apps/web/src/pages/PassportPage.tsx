import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import ConfirmModal from "../components/ConfirmModal";

export default function PassportPage() {
  const { did: raw } = useParams();
  const did = decodeURIComponent(raw ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskSummary, setTaskSummary] = useState("审查 demo-repo PR #42：安全与可读性");
  const [feeCap, setFeeCap] = useState("20");
  const [slaHours, setSlaHours] = useState("48");
  const [revisions, setRevisions] = useState("1");

  useEffect(() => {
    api(`/v0/passports/${encodeURIComponent(did)}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [did]);

  if (err) {
    return (
      <div className="card">
        <span className="badge failed">验签/加载失败</span>
        <h1 className="h1" style={{ marginTop: 12 }}>无法加载护照</h1>
        <p className="muted">{err}</p>
        <Link to="/error/verify-fail">查看错误说明</Link>
      </div>
    );
  }
  if (!data) return <p className="muted">加载中…</p>;

  const p = data.passport;
  const status = p.listingStatus as string;
  const badge =
    status === "active" && data.verified
      ? { cls: "verified", text: "已验签" }
      : status === "paused"
        ? { cls: "paused", text: "已暂停" }
        : status === "revoked"
          ? { cls: "revoked", text: "已吊销" }
          : { cls: "failed", text: "验签失败" };

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setFormErr(null);
    const summary = taskSummary.trim();
    const fee = Number(feeCap);
    const hours = Number(slaHours);
    const revs = Number(revisions);
    if (!summary) {
      setFormErr("请填写任务摘要");
      return;
    }
    if (!(fee > 0)) {
      setFormErr("费用上限须为正数 GigUSD");
      return;
    }
    if (!(hours > 0)) {
      setFormErr("交付时限须为正数小时");
      return;
    }
    if (!Number.isInteger(revs) || revs < 0) {
      setFormErr("修改次数须为 ≥0 的整数");
      return;
    }
    setBusy(true);
    try {
      const res = await api<any>("/v0/orders", {
        method: "POST",
        role: "hirer",
        actorId: "agent_hirer_demo",
        body: JSON.stringify({
          providerAgentId: did,
          feeCap: fee,
          taskSummary: summary,
          slaHours: hours,
          revisions: revs,
        }),
      });
      setOrder(res.order);
      if (res.order.confirmRequired || res.order.confirmStatus === "pending") {
        setConfirmOpen(true);
        setMsg("已送确认门：未确认不锁仓");
      } else {
        setMsg("订单已创建");
      }
    } catch (ex: any) {
      setFormErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid2">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <span className={`badge ${badge.cls}`}>{badge.text}</span>
            <h1 className="h1" style={{ marginTop: 10 }}>{p.displayName}</h1>
            <p className="muted">{p.tagline}</p>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="faint">DID</div>
          <code style={{ fontSize: 12 }}>{p.did}</code>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="faint">技能</div>
          <div>{p.skills?.join(" · ")}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="faint">结算主体 provider（法律主体）</div>
          <div>
            <strong>{p.provider?.legalName}</strong>
            <span className="muted"> · {p.provider?.type === "studio" ? "工作室" : "个人"}</span>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="faint">权限声明</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {(p.permissionNeeds ?? []).map((x: any) => (
              <li key={x.code} className="muted">{x.code}{x.scope ? ` (${x.scope})` : ""}</li>
            ))}
          </ul>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="faint">短 URI / QR 载荷</div>
          <code style={{ fontSize: 12 }}>{data.uris?.agentpass}</code>
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={`/v0/passports/${encodeURIComponent(did)}/export.json`} target="_blank" rel="noreferrer">
            导出 passport.json
          </a>
          <Link className="btn" to="/search">返回检索</Link>
        </div>
        <p className="faint" style={{ marginTop: 16 }}>
          名片 ≠ 授权 ≠ 付款。本卡<strong>无雇佣/付款主按钮</strong>。发单请用右侧表单（走 Budget + Confirm）。
        </p>
      </div>

      <div className="card">
        <h2 className="h2">发起雇佣</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          起价 {p.pricing?.models?.[0]?.price ?? "—"} GigUSD / 次。提交后将校验额度，并向主人弹出确认门；未确认不锁仓。
        </p>
        {status !== "active" && (
          <div className="banner error">挂牌状态为 {status}，不可接新单。</div>
        )}
        {!data.verified && <div className="banner error">验签失败：卡片可能被篡改。</div>}

        <form onSubmit={submitOrder}>
          <div className="field">
            <label htmlFor="taskSummary">任务摘要（必填）</label>
            <textarea
              id="taskSummary"
              rows={3}
              value={taskSummary}
              onChange={(e) => setTaskSummary(e.target.value)}
              disabled={status !== "active" || busy}
            />
          </div>
          <div className="field">
            <label htmlFor="feeCap">费用上限（GigUSD）</label>
            <input
              id="feeCap"
              type="number"
              min={0.01}
              step="0.01"
              value={feeCap}
              onChange={(e) => setFeeCap(e.target.value)}
              disabled={status !== "active" || busy}
            />
          </div>
          <div className="field">
            <label htmlFor="slaHours">交付时限（小时）</label>
            <input
              id="slaHours"
              type="number"
              min={1}
              step="1"
              value={slaHours}
              onChange={(e) => setSlaHours(e.target.value)}
              disabled={status !== "active" || busy}
            />
          </div>
          <div className="field">
            <label htmlFor="revisions">修改次数</label>
            <input
              id="revisions"
              type="number"
              min={0}
              step="1"
              value={revisions}
              onChange={(e) => setRevisions(e.target.value)}
              disabled={status !== "active" || busy}
            />
            <span className="faint">含 N 次免费修改；用尽后需拒收或新开单。默认 1。</span>
          </div>
          {formErr && <div className="banner error">{formErr}</div>}
          <button className="btn primary" type="submit" disabled={status !== "active" || busy}>
            {busy ? "提交中…" : "下一步：确认雇佣"}
          </button>
        </form>

        {msg && <div className="banner warn" style={{ marginTop: 12 }}>{msg}</div>}
        {order && (
          <p style={{ marginTop: 12 }}>
            订单 <Link to={`/orders/${order.orderId}`}>{order.orderId}</Link> · {order.status}
            {" · "}修改 {order.revisionsRemaining}/{order.revisions}
          </p>
        )}
      </div>

      {confirmOpen && order && (
        <ConfirmModal
          orderId={order.orderId}
          onClose={() => {
            api(`/v0/orders/${order.orderId}/confirm`, {
              method: "POST",
              body: JSON.stringify({ decision: "reject" }),
            }).finally(() => {
              setConfirmOpen(false);
              setMsg("已拒绝确认：无托管锁定");
              api(`/v0/orders/${order.orderId}`).then((d) => setOrder(d.order));
            });
          }}
          onDone={(o) => {
            setConfirmOpen(false);
            setOrder(o);
            setMsg(o.status === "accepted" ? "已批准并锁定托管" : `状态：${o.status}`);
          }}
        />
      )}
    </div>
  );
}
