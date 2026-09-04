import { useEffect, useState } from "react";
import { api } from "../api";

export default function AuditPage() {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    api("/v0/audit").then((d) => setEvents(d.events.reverse()));
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 className="h1">Audit</h1>
        <a className="btn" href="/v0/audit/export" target="_blank" rel="noreferrer">导出 JSON</a>
      </div>
      <p className="muted" style={{ marginBottom: 14 }}>谁 · 何时 · 金额 · 对手 · 权限</p>
      <div className="list">
        {events.map((e) => (
          <div key={e.id} className="list-item">
            <div style={{ flex: 1 }}>
              <div>
                <strong>{e.action}</strong> <span className="faint">{e.at}</span>
              </div>
              <div className="muted">
                {e.actorRole}:{e.actorId}
                {e.amount != null ? ` · ${e.amount} GigUSD` : ""}
                {e.counterpart ? ` · 对手 ${e.counterpart}` : ""}
              </div>
              {e.orderId && <div className="faint">订单 {e.orderId}</div>}
            </div>
          </div>
        ))}
        {events.length === 0 && <div className="card muted">暂无事件</div>}
      </div>
    </div>
  );
}
