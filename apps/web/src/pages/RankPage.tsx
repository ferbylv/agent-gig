import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

type RankItem = {
  did: string;
  skill: string;
  score: number;
  factors?: Record<string, number>;
  completedReleasedCount: number;
  preferredBadge?: boolean;
  tier?: string;
  displayName?: string;
};

function RankRows({
  items,
  startPos,
}: {
  items: RankItem[];
  startPos: number;
}) {
  return (
    <>
      {items.map((it, idx) => (
        <div key={`${it.did}-${it.skill}`} className="rank-row">
          <div className="rank-pos">{startPos + idx}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Link to={`/a/${encodeURIComponent(it.did)}`} style={{ fontWeight: 700, color: "inherit" }}>
                {it.displayName || it.did}
              </Link>
              <span className={`badge ${it.tier === "top" ? "tier-top" : "tier-explore"}`}>
                {it.tier === "top" ? "顶尖" : "探索中 · 未进顶尖"}
              </span>
              {it.preferredBadge && (
                <span className="badge preferred" title="累计完成满 10 单">
                  优选
                </span>
              )}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              综合分 {typeof it.score === "number" ? it.score.toFixed(3) : it.score} · 完成{" "}
              {it.completedReleasedCount} 单
            </div>
            <div className="rank-factors">
              完成率 {(it.factors?.completionRate ?? 0).toFixed(2)} · 均分{" "}
              {(it.factors?.avgMultiDimScore ?? 0).toFixed(2)} · 复购{" "}
              {(it.factors?.repurchaseRate ?? 0).toFixed(2)} · 响应{" "}
              {(it.factors?.responseSpeedNorm ?? 0).toFixed(2)} · 争议{" "}
              {(it.factors?.disputeRate ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function RankPage() {
  const [params, setParams] = useSearchParams();
  const skill = params.get("skill") ?? "code_review";
  const [items, setItems] = useState<RankItem[]>([]);
  const [weights, setWeights] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openHelp, setOpenHelp] = useState(false);

  useEffect(() => {
    setErr(null);
    Promise.all([
      api(`/v0/ranks?skill=${encodeURIComponent(skill)}`),
      api(`/v0/listings?skill=${encodeURIComponent(skill)}`).catch(() => ({ items: [] })),
    ])
      .then(([ranks, listings]) => {
        const nameMap = new Map(
          (listings.items ?? []).map((x: any) => [x.did, x.displayName] as const)
        );
        setItems(
          (ranks.items ?? []).map((it: RankItem) => ({
            ...it,
            displayName: nameMap.get(it.did) ?? it.did,
          }))
        );
        setWeights(ranks.weights);
      })
      .catch((e) => setErr(e.message));
  }, [skill]);

  const top = useMemo(() => items.filter((x) => x.tier === "top"), [items]);
  const explore = useMemo(() => items.filter((x) => x.tier !== "top"), [items]);

  return (
    <div>
      <h1 className="h1">{skill} 垂直榜</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        按品类排序，无全球总分。权重可配置（S3 冻结默认值）。
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={skill}
            onChange={(e) => setParams({ skill: e.target.value })}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
          >
            <option value="code_review">代码审查 code_review</option>
            <option value="design_illustration">设计出图 design_illustration</option>
          </select>
          <button type="button" className="btn ghost" onClick={() => setOpenHelp((v) => !v)}>
            {openHelp ? "收起说明" : "排名说明"}
          </button>
          <Link className="quiet-link" to={`/search?skill=${encodeURIComponent(skill)}&sort=rank`}>
            同 skill 检索（按榜）
          </Link>
        </div>
        {openHelp && (
          <div className="faint" style={{ marginTop: 12, lineHeight: 1.6 }}>
            综合分 = 0.25·完成率 + 0.35·四维均分 + 0.15·复购率 + 0.10·响应速度 − 0.15·争议率 − sybil。
            本片无争议数据时争议率按 0。完成单 &lt; 10 不进「顶尖」；≥10 可显示「优选」。
            {weights && (
              <div style={{ marginTop: 6 }}>
                当前权重 w1–w5：{weights.w1}/{weights.w2}/{weights.w3}/{weights.w4}/{weights.w5}
              </div>
            )}
          </div>
        )}
      </div>
      {err && <div className="banner error">{err}</div>}
      {!err && items.length === 0 ? (
        <div className="card">
          <h2 className="h2">暂无足够数据</h2>
          <p className="muted">该 skill 下尚无排名快照。评价写入或管理员重算后出现。</p>
        </div>
      ) : (
        <>
          {top.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="h2" style={{ marginBottom: 4 }}>
                顶尖
              </h2>
              <p className="faint" style={{ marginBottom: 8 }}>
                完成单 ≥ 10 · 按综合分
              </p>
              <RankRows items={top} startPos={1} />
            </div>
          )}
          <div className="card">
            <h2 className="h2" style={{ marginBottom: 4 }}>
              探索
            </h2>
            <p className="faint" style={{ marginBottom: 8 }}>
              新号曝光 · 未进顶尖
            </p>
            {explore.length === 0 ? (
              <p className="muted">暂无探索档条目</p>
            ) : (
              <RankRows items={explore} startPos={top.length + 1} />
            )}
            <p className="faint" style={{ marginTop: 12 }}>
              优选仅 completedOrders ≥ 10 展示 · 榜单仅供浏览；护照/评价/榜区无付款主 CTA。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
