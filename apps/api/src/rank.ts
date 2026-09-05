import {
  avgMultiDimScore,
  computeRankNumeric,
  preferredBadgeFor,
  resolveRankTier,
  type RankScore,
  type RankFactors,
  type RankWeights,
} from "@agent-gig/shared";
import { getDb, nowIso, rankKey, saveDb } from "./store.js";
import { audit } from "./audit.js";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Recompute vertical ranks for one did (all skills) or all passports. */
export function recomputeRanks(opts?: { did?: string; skill?: string }): RankScore[] {
  const db = getDb();
  const weights = db.rankWeights;
  const passports = Object.values(db.passports).filter((p) => {
    if (opts?.did && p.did !== opts.did) return false;
    return true;
  });

  const updated: RankScore[] = [];

  for (const p of passports) {
    const skills = opts?.skill ? p.skills.filter((s) => s === opts.skill) : p.skills;
    for (const skill of skills) {
      const score = computeOne(p.did, skill, weights);
      const key = rankKey(p.did, skill);
      db.ranks[key] = score;
      updated.push(score);

      // Mirror preferred / completed onto passport.stats for UI
      const stats = {
        ...(p.stats ?? {}),
        completedOrders: score.completedReleasedCount,
        completedReleasedCount: score.completedReleasedCount,
        completionRate: score.factors.completionRate,
        avgScores: {
          quality: 0,
          communication: 0,
          punctuality: 0,
          permissionHonesty: 0,
        },
        disputeRate: score.factors.disputeRate,
        repurchaseRate: score.factors.repurchaseRate,
        preferredBadge: score.preferredBadge,
        bondStub: score.bondStub ?? false,
        rankScore: score.score,
        tier: score.tier,
        updatedAt: score.updatedAt,
      };
      // Fill avgScores from reviews
      const reviews = Object.values(db.reviews).filter((r) => r.providerDid === p.did);
      if (reviews.length) {
        let q = 0, c = 0, pu = 0, h = 0;
        for (const r of reviews) {
          q += r.scores.quality;
          c += r.scores.communication;
          pu += r.scores.punctuality;
          h += r.scores.permissionHonesty;
        }
        const n = reviews.length;
        stats.avgScores = {
          quality: q / n,
          communication: c / n,
          punctuality: pu / n,
          permissionHonesty: h / n,
        };
      }
      p.stats = stats;
    }
  }

  saveDb();
  return updated;
}

function computeOne(
  did: string,
  skill: string,
  weights: RankWeights
): RankScore {
  const db = getDb();
  const orders = Object.values(db.orders).filter(
    (o) => o.parties.providerAgentId === did
  );
  const released = orders.filter((o) => o.status === "released");
  const completedReleasedCount = released.length;
  const terminal = orders.filter((o) =>
    ["released", "rejected", "cancelled"].includes(o.status)
  );
  const completionRate =
    terminal.length === 0 ? 0 : released.length / terminal.length;

  const reviews = Object.values(db.reviews).filter((r) => r.providerDid === did);
  let avgMulti = 0;
  if (reviews.length) {
    avgMulti =
      reviews.reduce((s, r) => s + avgMultiDimScore(r.scores), 0) / reviews.length;
  }

  // Repurchase: distinct hirers with >=2 released / distinct hirers with >=1 released
  const byHirer = new Map<string, number>();
  for (const o of released) {
    const k = o.parties.hirerUserId;
    byHirer.set(k, (byHirer.get(k) ?? 0) + 1);
  }
  const hirerCount = byHirer.size;
  const repeatHirers = [...byHirer.values()].filter((n) => n >= 2).length;
  const repurchaseRate = hirerCount === 0 ? 0 : repeatHirers / hirerCount;

  // Response speed: fraction of orders started within SLA responseMinutes (default 60)
  let fast = 0;
  let measured = 0;
  for (const o of orders) {
    const accepted = o.timestamps.accepted;
    const started = o.timestamps.in_progress;
    if (!accepted || !started) continue;
    measured++;
    const mins = (Date.parse(started) - Date.parse(accepted)) / 60000;
    const limit = o.sla.responseMinutes ?? 60;
    if (mins <= limit) fast++;
  }
  const responseSpeedNorm = measured === 0 ? 0.5 : fast / measured;

  // S3: no dispute data → 0; sybilPenalty default 0
  const factors: RankFactors = {
    completionRate: clamp01(completionRate),
    avgMultiDimScore: avgMulti, // 1–5 scale; computeRankNumeric normalizes
    repurchaseRate: clamp01(repurchaseRate),
    responseSpeedNorm: clamp01(responseSpeedNorm),
    disputeRate: 0,
    sybilPenalty: 0,
  };

  const score = computeRankNumeric(factors, weights);
  const preferredBadge = preferredBadgeFor(completedReleasedCount);
  const tier = resolveRankTier(completedReleasedCount, score);

  return {
    did,
    skill,
    score,
    factors,
    completedReleasedCount,
    preferredBadge,
    bondStub: false,
    tier,
    updatedAt: nowIso(),
  };
}

export function getRanksBySkill(skill: string): RankScore[] {
  return Object.values(getDb().ranks)
    .filter((r) => r.skill === skill)
    .sort((a, b) => b.score - a.score || b.completedReleasedCount - a.completedReleasedCount);
}

export function getRank(did: string, skill: string): RankScore | null {
  return getDb().ranks[rankKey(did, skill)] ?? null;
}

export function recomputeAndAudit(actorId = "admin"): RankScore[] {
  const items = recomputeRanks();
  audit({
    actorRole: "admin",
    actorId,
    action: "ranks.recompute",
    detail: { count: items.length },
  });
  return items;
}
