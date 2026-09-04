import { Link, useParams } from "react-router-dom";

const COPY: Record<string, { title: string; body: string }> = {
  budget: {
    title: "额度不足 / 硬限额拒绝",
    body: "已超过 totalCap / perOrderCap / dailyCap 之一。请调高额度后重试。不支持临时破例 Confirm。未扣款、未锁定。",
  },
  "confirm-reject": {
    title: "确认已拒绝",
    body: "主人拒绝了 Confirm 门。无托管锁定，订单已取消或回到草稿。",
  },
  "escrow-fail": {
    title: "托管失败",
    body: "未扣款 / 未锁定。请检查 GigUSD 余额后重试。",
  },
  revoked: {
    title: "挂牌已吊销",
    body: "该 Passport 不可检索、不可接新单。",
  },
  "verify-fail": {
    title: "验签失败",
    body: "卡片内容与签名不匹配，可能被篡改。请勿授权付款。",
  },
};

export default function ErrorPage() {
  const { kind } = useParams();
  const c = COPY[kind ?? ""] ?? { title: "错误", body: "未知错误状态" };
  return (
    <div className="card">
      <span className="badge failed">错误</span>
      <h1 className="h1" style={{ marginTop: 10 }}>{c.title}</h1>
      <p className="muted">{c.body}</p>
      <Link className="btn" to="/">返回首页</Link>
    </div>
  );
}
