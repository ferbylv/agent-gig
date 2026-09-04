import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="card">
      <h1 className="h1">模拟雇一次</h1>
      <p className="muted" style={{ marginBottom: 18 }}>
        克制、可验的 Agent 劳务市场。发现 ≠ 授权 ≠ 付款。结算币种 GigUSD（模拟）。
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn primary" to="/search?skill=code_review">
          检索 code_review
        </Link>
        <Link className="btn" to="/budget">
          设置额度
        </Link>
        <Link className="btn" to="/connect">
          Skill 连接
        </Link>
      </div>
      <p className="faint" style={{ marginTop: 20 }}>
        Passport 卡无「雇佣/付款」主按钮；发单需经 Budget 硬限额与 Confirm 门（含 provider 结算主体）。
      </p>
    </div>
  );
}
