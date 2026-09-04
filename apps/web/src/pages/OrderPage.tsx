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

  async function reload() {
    const d = await api(`/v0/orders/${id}`);
    setOrder(d.order);
    setEscrow(d.escrow);
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
      } else if (path === "acceptance" && body?.decision === "revise") {
        setMsg("已请求修改：回 in_progress，托管仍锁定、不另扣款");
      } else if (path === "acceptance" && body?.decision === "reject") {
        setMsg("已拒收：托管退回雇方，未放款给 provider");
      }
    } catch (e: any) {
      setMsg(e.message);
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
        <div className="banner warn">
          修改中 · 剩余免费修改 {remaining} 次。托管仍锁定，本次修改不另扣款。
          {order.revisionNote ? ` 说明：${order.revisionNote}` : ""}
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
            提交交付
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
            onClick={() => act("acceptance", { decision: "satisfied" })}
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
    </div>
  );
}
