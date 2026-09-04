import { useEffect, useState } from "react";
import { api } from "../api";

export default function ConfirmModal({
  orderId,
  onClose,
  onDone,
}: {
  orderId: string;
  onClose: () => void;
  onDone: (order: any) => void;
}) {
  const [confirm, setConfirm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api(`/v0/orders/${orderId}/confirm`).then((d) => setConfirm(d.confirm));
  }, [orderId]);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<any>(`/v0/orders/${orderId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      onDone(res.order);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <header>
          <h2 className="h2" style={{ margin: 0 }}>确认雇佣</h2>
          <button aria-label="关闭即拒绝" onClick={onClose} title="关闭 = 拒绝">
            ×
          </button>
        </header>
        {!confirm ? (
          <p className="muted">加载确认门…</p>
        ) : (
          <>
            <div className="banner warn">首单 / 新对手：必须确认。关闭(×)视为拒绝，不锁仓。</div>
            <section style={{ marginBottom: 12 }}>
              <div className="faint">结算主体 provider（MUST）</div>
              <div>
                <strong>{confirm.provider?.legalName}</strong>
                <span className="muted">
                  {" "}
                  · {confirm.provider?.type === "studio" ? "工作室" : "个人"} · {confirm.provider?.providerId}
                </span>
              </div>
            </section>
            <section style={{ marginBottom: 12 }}>
              <div className="faint">Agent</div>
              <div>
                {confirm.agentDisplayName}{" "}
                <span className={`badge ${confirm.verifyStatus === "verified" ? "verified" : "failed"}`}>
                  {confirm.verifyStatus === "verified" ? "已验签" : "验签异常"}
                </span>
              </div>
              <div className="faint">{confirm.agentDid}</div>
            </section>
            <section style={{ marginBottom: 12 }}>
              <div className="faint">任务摘要</div>
              <div>{confirm.taskSummary}</div>
            </section>
            <section style={{ marginBottom: 12 }}>
              <div className="faint">允许权限</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(confirm.permissionsAllowed ?? []).map((p: any) => (
                  <li key={p.code} className="muted">{p.code}</li>
                ))}
              </ul>
              <div className="faint" style={{ marginTop: 6 }}>禁止</div>
              <div className="muted">{(confirm.permissionsDenied ?? []).join(", ")}</div>
            </section>
            <section style={{ marginBottom: 12 }}>
              <div className="faint">费用上限</div>
              <div>
                <strong>{confirm.feeCap}</strong> {confirm.currency}
              </div>
            </section>
            <section style={{ marginBottom: 16 }}>
              <div className="faint">SLA</div>
              <div className="muted">
                截止 {confirm.sla?.dueAt} · 验收 {confirm.sla?.acceptanceType} ·{" "}
                修改次数 <strong>{confirm.sla?.revisions ?? 0}</strong>
              </div>
            </section>
            {err && <div className="banner error">{err}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" disabled={busy} onClick={() => decide("reject")}>
                拒绝
              </button>
              <button className="btn primary" disabled={busy} onClick={() => decide("approve")}>
                批准并锁仓
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
