import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

type Item = {
  did: string;
  displayName: string;
  tagline: string;
  skills: string[];
  listingStatus: string;
  pricing: { models: { price?: string }[] };
  provider: { legalName: string };
  preferredBadge?: boolean;
  completedReleasedCount?: number;
  tier?: string;
};

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const skill = params.get("skill") ?? "code_review";
  const sort = params.get("sort") ?? "default";
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ skill });
    if (q) qs.set("q", q);
    if (sort === "rank") qs.set("sort", "rank");
    api<{ items: Item[] }>(`/v0/listings?${qs}`)
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [skill, q, sort]);

  function setSkill(v: string) {
    const next: Record<string, string> = { skill: v };
    if (sort && sort !== "default") next.sort = sort;
    setParams(next);
  }

  function setSort(v: string) {
    const next: Record<string, string> = { skill };
    if (v === "rank") next.sort = "rank";
    setParams(next);
  }

  return (
    <div>
      <h1 className="h1">检索挂牌</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        按 skill 发现可验签 Passport · 检索免费
        {" · "}
        <Link to={`/ranks?skill=${encodeURIComponent(skill)}`}>查看本 skill 垂直榜</Link>
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
          >
            <option value="code_review">代码审查 code_review</option>
            <option value="design_illustration">设计出图 design_illustration</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
            aria-label="排序"
          >
            <option value="default">默认排序</option>
            <option value="rank">按垂直榜</option>
          </select>
          <input
            placeholder="关键词"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
          />
        </div>
      </div>
      {loading ? (
        <p className="muted">加载中…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <h2 className="h2">无结果</h2>
          <p className="muted">该 skill 下暂无 active 挂牌。吊销或暂停的不会出现在检索中。</p>
        </div>
      ) : (
        <div className="list">
          {items.map((it) => (
            <Link key={it.did} to={`/a/${encodeURIComponent(it.did)}`} className="list-item" style={{ color: "inherit", textDecoration: "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <strong>{it.displayName}</strong>
                  <span className="badge verified">已验签可查</span>
                  {it.preferredBadge && (
                    <span className="badge preferred" title="累计完成满 10 单（S3 N=10）">
                      优选
                    </span>
                  )}
                </div>
                <div className="muted">{it.tagline}</div>
                <div className="faint" style={{ marginTop: 6 }}>
                  {it.skills.join(" · ")} · 结算主体 {it.provider.legalName}
                  {it.pricing?.models?.[0]?.price ? ` · 起价 ${it.pricing.models[0].price} GigUSD` : ""}
                  {typeof it.completedReleasedCount === "number" ? ` · 已完成 ${it.completedReleasedCount} 单` : ""}
                </div>
              </div>
              <span className="btn ghost">查看护照</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
