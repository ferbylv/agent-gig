import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import ConfirmModal from "../components/ConfirmModal";

export default function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [escrow, setEscrow] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [publicPortfolio, setPublicPortfolio] = useState(false);
  const [homepage, setHomepage] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [portfolioItemId, setPortfolioItemId] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);

  async function reload() {
    const d = await api(`/v0/orders/${id}`);
    setOrder(d.order);
    setEscrow(d.escrow);
    if (d.order?.portfolioItemId && !d.order.portfolioConsent?.revokedAt) {
      setPortfolioItemId(d.order.portfolioItemId);
    } else if (d.order?.portfolioConsent?.revokedAt) {
      setPortfolioItemId(null);
    }
  }

  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
  }, [id]);

  async function act(path: string, body?: any, role?: string, actorId?: string) {
    setMsg(null);
    try {
      const d = await api(`/v0/orders/${id}/${path}`, {
        method: "POST",
        role,
        actorId,
        body: body ? JSON.stringify(body) : undefined,
      });
      setOrder(d.order);
      setEscrow(d.escrow ?? null);
      if (path === "acceptance" && body?.decision === "satisfied") {
        setMsg("验收满意 → 已放款（含 10% 抽成流水）");
        if (d.portfolioItem?.itemId) setPortfolioItemId(d.portfolioItem.itemId);
        setConsentOpen(false);
      } else if (path === "acceptance" && body?.decision === "revise") {
        setMsg("已请求修改：回 in_progress，托管仍锁定、不另扣款");
      } else if (path === "acceptance" && body?.decision === "reject") {
        setMsg("已拒收：托管退回雇方，未放款给 provider");
      }
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function submitConsent(skip: boolean) {
    setConsentBusy(true);
    setMsg(null);
    try {
      const consent = skip
        ? { publicPortfolio: false, homepage: false }
        : { publicPortfolio, homepage };
      const d = await api(`/v0/orders/${id}/acceptance`, {
        method: "POST",
        body: JSON.stringify({ decision: "satisfied", consent }),
      });
      setOrder(d.order);
      setEscrow(d.escrow ?? null);
      if (d.portfolioItem?.itemId) setPortfolioItemId(d.portfolioItem.itemId);
      setConsentOpen(false);
      if (skip || (!consent.publicPortfolio && !consent.homepage)) {
        setMsg("已放款；未授权公开展示（默认否）");
      } else {
        setMsg("已放款；授权已保存，公开作品集将按勾选展示");
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setConsentBusy(false);
    }
  }

  async function revokePortfolio() {
    if (!portfolioItemId) return;
    setRevokeBusy(true);
    setMsg(null);
    try {
      await api(`/v0/portfolio/${portfolioItemId}/revoke`, {
        method: "POST",
        role: "user",
        actorId: order.parties.hirerUserId,
      });
      setMsg("已撤回公开展示；新访客将看不到该作品");
      setPortfolioItemId(null);
      setRevokeOpen(false);
      await reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setRevokeBusy(false);
    }
  }

  if (!order) return <p className="muted">{msg ?? "加载中…"}</p>;

  const remaining = order.revisionsRemaining ?? 0;
  const showRevisionBanner =
    order.status === "revision_requested" ||
    (order.status === "in_progress" && order.timestamps?.revision_requested);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="faint">订单</div>
          <h1 className="h1">{order.orderId}</h1>
          <div className="muted">状态 <strong>{order.status}</strong></div>
        </div>
        {escrow && (
          <div>
            <div className="faint">Escrow</div>
            <div>
              {escrow.status} · {escrow.amount} GigUSD
            </div>
          </div>
        )}
      </div>

      <p style={{ marginTop: 14 }}>{order.task?.summary}</p>
      <p className="faint">
        雇方 {order.parties.hirerAgentId} → 接单 {order.parties.providerAgentId} · 结算 {order.parties.providerId}
      </p>
      <p className="faint">
        费用上限 {order.pricing?.feeCap} GigUSD · SLA 截止 {order.sla?.dueAt}
        {" · "}修改剩余 {remaining}/{order.revisions ?? 0}
      </p>

      {showRevisionBanner && (
        <div className="banner info" role="status">
          <div>修改中 · 剩余免费修改 {remaining} 次</div>
          <p className="banner-sub">托管仍锁定，本次修改不另扣款；等待对方新交付</p>
          {order.revisionNote ? <p className="banner-sub">说明：{order.revisionNote}</p> : null}
        </div>
      )}

      {order.status === "delivered" && remaining <= 0 && (
        <div className="banner info" role="status">
          <div>剩余免费修改 0 次 · 不可再请求修改</div>
          <p className="banner-sub">可拒收后退款，或满意后放款；如需继续合作请新开单</p>
        </div>
      )}

      {order.status === "released" && order.portfolioConsent && (
        <div className="banner info" role="status">
          <div>
            作品授权：作品集 {order.portfolioConsent.publicPortfolio ? "是" : "否"} · 首页{" "}
            {order.portfolioConsent.homepage ? "是" : "否"}
            {order.portfolioConsent.revokedAt ? " · 已撤回" : ""}
          </div>
          {portfolioItemId && !order.portfolioConsent.revokedAt && (
            <p className="banner-sub">
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setRevokeOpen(true)}>
                撤回公开展示
              </button>
            </p>
          )}
        </div>
      )}

      {msg && <div className="banner warn">{msg}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {order.status === "quoted" && (
          <button className="btn primary" onClick={() => setConfirmOpen(true)}>
            打开 Confirm 门
          </button>
        )}
        {order.status === "accepted" && (
          <button
            className="btn primary"
            onClick={() => act("start", undefined, "provider", order.parties.providerAgentId)}
          >
            接单方开工
          </button>
        )}
        {(order.status === "in_progress" || order.status === "revision_requested") && (
          <button
            className="btn primary"
            onClick={() =>
              act(
                "deliver",
                { reportMarkdown: "# Review OK", severity: "info" },
                "provider",
                order.parties.providerAgentId
              )
            }
          >
            {showRevisionBanner ? "请按说明修改后再次交付" : "提交交付"}
          </button>
        )}
        {(order.status === "quoted" || order.status === "accepted") && (
          <button className="btn" onClick={() => act("cancel", undefined, "hirer", order.parties.hirerAgentId)}>
            取消
          </button>
        )}
      </div>

      {order.status === "delivered" && (
        <div className="accept-bar">
          <button
            className="btn primary"
            title="确认验收并放款给 provider"
            onClick={() => {
              setPublicPortfolio(false);
              setHomepage(false);
              setConsentOpen(true);
            }}
          >
            满意
          </button>
          <button
            className="btn"
            disabled={remaining <= 0}
            title={
              remaining <= 0
                ? "修改次数已用完，可拒收或新开单"
                : "消耗 1 次修改机会，对方将在本单继续修改；不另扣托管"
            }
            onClick={() => act("acceptance", { decision: "revise" })}
          >
            需修改
          </button>
          <button
            className="btn danger"
            title="拒收后托管将按规则退回；不会放款给 provider"
            onClick={() => act("acceptance", { decision: "reject" })}
          >
            拒收
          </button>
          <span className="faint" style={{ alignSelf: "center" }}>
            {remaining <= 0
              ? "修改次数已用完，可拒收或新开单"
              : `剩余 ${remaining} 次免费修改 · 不另扣托管`}
          </span>
        </div>
      )}

      <p style={{ marginTop: 18 }}>
        <Link to="/audit">查看审计</Link>
        {" · "}
        <Link to={`/a/${encodeURIComponent(order.parties.providerAgentId)}`}>查看接单方详情</Link>
      </p>

      {confirmOpen && (
        <ConfirmModal
          orderId={order.orderId}
          onClose={() => {
            act("confirm", { decision: "reject" }).finally(() => setConfirmOpen(false));
          }}
          onDone={(o) => {
            setOrder(o);
            setConfirmOpen(false);
            reload();
          }}
        />
      )}

      {revokeOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <div className="modal">
            <header>
              <h2 className="h2" id="revoke-title" style={{ margin: 0 }}>
                撤回公开展示
              </h2>
              <button type="button" aria-label="关闭" onClick={() => setRevokeOpen(false)}>
                ×
              </button>
            </header>
            <p className="muted">撤回后新访客将看不到该作品；默认不公开</p>
            <p className="faint" style={{ marginTop: 10 }}>
              已缓存页面约 24h 内可能仍可见（待确认）。作品本身与订单记录不受影响。
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn" type="button" disabled={revokeBusy} onClick={() => setRevokeOpen(false)}>
                取消
              </button>
              <button className="btn danger" type="button" disabled={revokeBusy} onClick={revokePortfolio}>
                {revokeBusy ? "撤回中…" : "确认撤回"}
              </button>
            </div>
          </div>
        </div>
      )}

      {consentOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <div className="modal">
            <header>
              <h2 className="h2" id="consent-title" style={{ margin: 0 }}>
                是否公开展示本单交付？（可选）
              </h2>
              <button type="button" aria-label="关闭" onClick={() => setConsentOpen(false)}>
                ×
              </button>
            </header>
            <p className="muted">默认不公开；未授权的交付不会出现在作品集。敏感交付请谨慎勾选。</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={publicPortfolio}
                onChange={(e) => setPublicPortfolio(e.target.checked)}
              />
              <span>写入接单方公开作品集</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={homepage} onChange={(e) => setHomepage(e.target.checked)} />
              <span>允许平台首页/推荐位展示</span>
            </label>
            <p className="faint">本卡不含评价；评价将在 S3 开放。</p>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" disabled={consentBusy} onClick={() => submitConsent(false)}>
                {consentBusy ? "保存中…" : "保存授权"}
              </button>
              <button className="btn" type="button" disabled={consentBusy} onClick={() => submitConsent(true)}>
                暂不公开
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
