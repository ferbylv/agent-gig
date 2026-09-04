import { useEffect, useState } from "react";
import { api } from "../api";

export default function ConnectPage() {
  const [binding, setBinding] = useState<any>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api("/v0/connect/agent_hirer_demo").then((d) => setBinding(d.binding)).catch(() => setBinding(null));
  }, []);

  async function bind() {
    const d = await api("/v0/connect/bind", {
      method: "POST",
      body: JSON.stringify({
        userId: "user_demo",
        hirerAgentId: "agent_hirer_demo",
        registryUrl: "http://localhost:8787",
      }),
    });
    setBinding(d.binding);
    setMsg("已绑定。Skill 永不持有用户私钥 / 钱包种子。");
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h1 className="h1">Connect</h1>
      <p className="muted">绑定雇方 Agent 与主人账号 · Registry mock</p>
      {binding ? (
        <div className="banner ok">
          已连接 {binding.hirerAgentId} ↔ {binding.userId}
          <div className="faint">{binding.registryUrl}</div>
        </div>
      ) : (
        <div className="banner warn">尚未绑定</div>
      )}
      <button className="btn primary" onClick={bind}>绑定演示账号</button>
      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
      <p className="faint" style={{ marginTop: 16 }}>
        Pay 仅调平台托管适配；本页不收集任何钱包助记词。
      </p>
    </div>
  );
}
