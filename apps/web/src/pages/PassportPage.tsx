import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import ConfirmModal from "../components/ConfirmModal";

function sourceBadge(source: string) {
  if (source === "verified_order") {
    return { cls: "badge source-verified", text: "成单验证", title: "经平台成单验收并获授权" };
  }
  if (source === "self_reported") {
    return { cls: "badge source-self", text: "自荐上传 · 低信任", title: "由服务方自行上传，未经成单验证" };
  }
  if (source === "curated") {
    return { cls: "badge source-curated", text: "平台精选", title: "平台抽检精选" };
  }
  return { cls: "badge", text: source, title: source };
}

export default function PassportPage() {
  const { did: raw } = useParams();
  const did = decodeURIComponent(raw ?? "");
  const [data, setData] = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskSummary, setTaskSummary] = useState("审查 demo-repo PR #42：安全与可读性");
  const [feeCap, setFeeCap] = useState("20");
  const [slaHours, setSlaHours] = useState("48");
  const [tab, setTab] = useState<"passport" | "portfolio" | "reviews">("passport");

  async function load() {
    const listing = await api(`/v0/listings/${encodeURIComponent(did)}`);
    setData(listing);
    setPortfolio(listing.portfolio ?? []);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
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
    const revs = 1;
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

  const passportCol = (
    <div className="detail-col">
      <div className="detail-col-title">护照</div>
      <div className="card detail-col-body">
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
        <h1 className="h1" style={{ marginTop: 10 }}>{p.displayName}</h1>
        <p className="muted">{p.tagline}</p>
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
          名片 ≠ 授权 ≠ 付款。本卡<strong>无雇佣/付款主按钮</strong>。浏览作品不等于雇佣；发单请使用下方发单区。
        </p>
      </div>
    </div>
  );

  const portfolioCol = (
    <div className="detail-col">
      <div className="detail-col-title">作品</div>
      <div className="card detail-col-body">
        {portfolio.length === 0 ? (
          <div className="empty-state">
            <p className="muted" style={{ margin: 0 }}>还没有获授权的公开作品</p>
            <p className="faint" style={{ marginTop: 8 }}>成单并授权后将出现在此。默认不公开。</p>
          </div>
        ) : (
          <div className="portfolio-list">
            {portfolio.map((item: any) => {
              const b = sourceBadge(item.source);
              return (
                <article key={item.itemId} className={`portfolio-card ${item.source === "self_reported" ? "low-trust" : ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span className={b.cls} title={b.title}>{b.text}</span>
                    <span className="faint">{item.createdAt?.slice(0, 10)}</span>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 14 }}>{item.summary}</p>
                  {item.orderId && <p className="faint" style={{ marginTop: 6 }}>关联订单 {item.orderId}</p>}
                  {item.source === "self_reported" && (
                    <p className="faint" style={{ marginTop: 6 }}>由服务方自行上传，未经成单验证</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="faint" style={{ marginTop: 14 }}>作品区无付款主按钮；雇佣请走下方表单 + Confirm。</p>
      </div>
    </div>
  );

  const reviewsCol = (
    <div className="detail-col">
      <div className="detail-col-title muted-title">评价</div>
      <div className="card detail-col-body reviews-soon">
        <div className="reviews-placeholder">
          <span className="badge soon">即将开放 · S3</span>
          <p className="muted" style={{ marginTop: 12 }}>评价与完成率将在下一版本开放（S3）</p>
          <p className="faint">本栏为占位，不可打分、不可提交评价。</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="detail-tabs" role="tablist" aria-label="详情分栏">
        <button type="button" className={tab === "passport" ? "active" : ""} onClick={() => setTab("passport")} role="tab" aria-selected={tab === "passport"}>护照</button>
        <button type="button" className={tab === "portfolio" ? "active" : ""} onClick={() => setTab("portfolio")} role="tab" aria-selected={tab === "portfolio"}>作品</button>
        <button type="button" className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")} role="tab" aria-selected={tab === "reviews"}>评价</button>
      </div>

      <div className="detail-grid">
        <div className={tab === "passport" ? "detail-pane show" : "detail-pane"}>{passportCol}</div>
        <div className={tab === "portfolio" ? "detail-pane show" : "detail-pane"}>{portfolioCol}</div>
        <div className={tab === "reviews" ? "detail-pane show" : "detail-pane"}>{reviewsCol}</div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
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
            <span id="revisions-label">修改次数</span>
            <div
              className="revisions-ro"
              role="text"
              aria-labelledby="revisions-label"
              aria-label="修改次数（S1 上限 1）"
            >
              1
            </div>
            <span className="faint">含 1 次免费修改；用尽后需拒收或新开单</span>
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
