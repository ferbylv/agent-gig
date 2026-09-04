import { useEffect, useState } from "react";
import { api } from "../api";

export default function BudgetPage() {
  const [totalCap, setTotal] = useState(100);
  const [perOrderCap, setPer] = useState(30);
  const [dailyCap, setDaily] = useState(50);
  const [saved, setSaved] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api("/v0/budget?userId=user_demo&hirerAgentId=agent_hirer_demo")
      .then((d) => {
        setTotal(d.budget.totalCap);
        setPer(d.budget.perOrderCap);
        setDaily(d.budget.dailyCap);
        setSaved(d.budget);
      })
      .catch(() => {});
  }, []);

  async function save() {
    const t0 = performance.now();
    const d = await api("/v0/budget", {
      method: "PUT",
      body: JSON.stringify({ userId: "user_demo", hirerAgentId: "agent_hirer_demo", totalCap, perOrderCap, dailyCap }),
    });
    setSaved(d.budget);
    setMsg(`已保存（${Math.round(performance.now() - t0)}ms）。超硬限额将直接拒绝，不弹临时破例。`);
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h1 className="h1">Budget 额度</h1>
      <p className="muted">主人设置三限额；Skill 硬拒绝，无私钥。</p>
      <div className="field">
        <label>totalCap（总额度 GigUSD）</label>
        <input type="number" value={totalCap} onChange={(e) => setTotal(Number(e.target.value))} />
      </div>
      <div className="field">
        <label>perOrderCap（单笔上限）</label>
        <input type="number" value={perOrderCap} onChange={(e) => setPer(Number(e.target.value))} />
      </div>
      <div className="field">
        <label>dailyCap（日限额）</label>
        <input type="number" value={dailyCap} onChange={(e) => setDaily(Number(e.target.value))} />
      </div>
      <button className="btn primary" onClick={save}>保存</button>
      {msg && <div className="banner ok" style={{ marginTop: 12 }}>{msg}</div>}
      {saved && (
        <p className="faint" style={{ marginTop: 12 }}>
          已用 total {saved.usedTotal} / daily {saved.usedDaily} · 已确认对手 {saved.confirmedProviders?.length ?? 0}
        </p>
      )}
    </div>
  );
}
