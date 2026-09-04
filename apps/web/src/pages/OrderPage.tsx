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
      }
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  if (!order) return <p className="muted">{msg ?? "加载中…"}</p>;

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
      <p className="faint">修改剩余 revisionsRemaining={order.revisionsRemaining}（V0 恒为 0）</p>

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
        {order.status === "in_progress" && (
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
          <button className="btn primary" onClick={() => act("acceptance", { decision: "satisfied" })}>
            满意
          </button>
          <button
            className="btn"
            disabled
            title="V0 修改=0：请拒收后重新开单"
            onClick={() => act("acceptance", { decision: "revise" })}
          >
            需修改
          </button>
          <button className="btn danger" onClick={() => act("acceptance", { decision: "reject" })}>
            拒收
          </button>
          <span className="faint" style={{ alignSelf: "center" }}>
            「需修改」已禁用：拒收后重开新单
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
