import { Hono } from "hono";
import {
  REVIEW_COMMENT_MAX,
  REVIEW_REPLY_MAX,
  parseReviewScores,
  summarizeReviews,
  type Review,
} from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "../store.js";
import { audit } from "../audit.js";
import { SEED } from "../seed.js";
import { HttpError, mustOrder } from "../orders.js";
import { addBlacklist, listBlacklist } from "../blacklist.js";
import { recomputeRanks, recomputeAndAudit, getRanksBySkill } from "../rank.js";

export const reviewRoutes = new Hono();

function actor(c: { req: { header: (n: string) => string | undefined } }) {
  return {
    role: (c.req.header("X-Actor-Role") ?? "hirer") as string,
    id: c.req.header("X-Actor-Id") ?? SEED.hirerAgentId,
  };
}

function handleErr(c: any, e: unknown) {
  if (e instanceof HttpError) {
    return c.json({ error: e.message, code: e.code }, e.status as any);
  }
  const err = e as Error & { status?: number; code?: string };
  if (err.status) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error(e);
  return c.json({ error: String((e as Error).message ?? e) }, 500);
}

function reviewsForDid(did: string): Review[] {
  return Object.values(getDb().reviews)
    .filter((r) => r.providerDid === did)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function findByOrderId(orderId: string): Review | undefined {
  return Object.values(getDb().reviews).find((r) => r.orderId === orderId);
}

/** POST /v0/reviews — hirer only, released only, one per orderId */
reviewRoutes.post("/reviews", async (c) => {
  try {
    const a = actor(c);
    const body = await c.req.json<{
      orderId: string;
      scores: unknown;
      comment?: string;
      hirerUserId?: string;
    }>();
    if (!body.orderId) throw new HttpError(400, "orderId required");
    const order = mustOrder(body.orderId);

    if (order.status !== "released") {
      throw new HttpError(409, `Review only after released (now ${order.status})`, "NOT_RELEASED");
    }

    const hirerUserId = body.hirerUserId ?? (a.role === "user" ? a.id : order.parties.hirerUserId);
    const isHirer =
      a.id === order.parties.hirerUserId ||
      a.id === order.parties.hirerAgentId ||
      hirerUserId === order.parties.hirerUserId;
    if (!isHirer && a.role !== "admin") {
      throw new HttpError(403, "Only order hirer can review", "NOT_HIRER");
    }
    if (hirerUserId !== order.parties.hirerUserId && a.role !== "admin") {
      throw new HttpError(403, "hirerUserId mismatch", "NOT_HIRER");
    }

    if (findByOrderId(order.orderId)) {
      throw new HttpError(409, "Order already reviewed (one review per orderId)", "ALREADY_REVIEWED");
    }

    const scores = parseReviewScores(body.scores);
    if (!scores) {
      throw new HttpError(
        400,
        "scores must include quality/communication/punctuality/permissionHonesty as integers 1–5",
        "INVALID_SCORES"
      );
    }

    let comment: string | undefined;
    if (body.comment != null && String(body.comment).trim()) {
      comment = String(body.comment).trim().slice(0, REVIEW_COMMENT_MAX);
    }

    const review: Review = {
      reviewId: uid("rev"),
      orderId: order.orderId,
      hirerUserId: order.parties.hirerUserId,
      hirerAgentId: order.parties.hirerAgentId,
      providerDid: order.parties.providerAgentId,
      scores,
      comment,
      createdAt: nowIso(),
    };
    getDb().reviews[review.reviewId] = review;
    audit({
      actorRole: "user",
      actorId: order.parties.hirerUserId,
      action: "review.create",
      orderId: order.orderId,
      counterpart: review.providerDid,
      detail: { reviewId: review.reviewId, scores },
    });
    saveDb();
    // Incremental rank recompute for this provider
    recomputeRanks({ did: review.providerDid });
    return c.json({ review }, 201);
  } catch (e) {
    return handleErr(c, e);
  }
});

/** GET /v0/reviews?did= | ?orderId= */
reviewRoutes.get("/reviews", (c) => {
  const did = c.req.query("did");
  const orderId = c.req.query("orderId");
  if (orderId) {
    const review = findByOrderId(orderId);
    return c.json({
      review: review ?? null,
      items: review ? [review] : [],
      reviewSummary: summarizeReviews(review ? [review] : []),
    });
  }
  if (!did) return c.json({ error: "did or orderId query required" }, 400);
  const items = reviewsForDid(did);
  return c.json({
    did,
    items,
    reviews: items,
    reviewSummary: summarizeReviews(items),
    total: items.length,
  });
});

/** POST /v0/reviews/:reviewId/reply — provider once */
reviewRoutes.post("/reviews/:reviewId/reply", async (c) => {
  try {
    const a = actor(c);
    const reviewId = c.req.param("reviewId");
    const review = getDb().reviews[reviewId];
    if (!review) throw new HttpError(404, "Review not found");

    if (a.role !== "provider" && a.role !== "admin") {
      throw new HttpError(403, "Only provider can reply", "NOT_PROVIDER");
    }
    if (a.role === "provider" && a.id !== review.providerDid) {
      throw new HttpError(403, "Only the reviewed provider can reply", "NOT_PROVIDER");
    }
    if (review.providerReply) {
      throw new HttpError(409, "Provider already replied (once only)", "ALREADY_REPLIED");
    }

    const body = await c.req.json<{ text?: string }>();
    const text = String(body.text ?? "").trim();
    if (!text) throw new HttpError(400, "reply text required");
    review.providerReply = {
      text: text.slice(0, REVIEW_REPLY_MAX),
      repliedAt: nowIso(),
    };
    audit({
      actorRole: "provider",
      actorId: review.providerDid,
      action: "review.reply",
      orderId: review.orderId,
      counterpart: review.hirerUserId,
      detail: { reviewId },
    });
    saveDb();
    return c.json({ review });
  } catch (e) {
    return handleErr(c, e);
  }
});

/** No DELETE for reviews or replies */
reviewRoutes.delete("/reviews/:reviewId", (c) => {
  return c.json({ error: "Reviews cannot be deleted", code: "METHOD_NOT_ALLOWED" }, 405);
});
reviewRoutes.delete("/reviews/:reviewId/reply", (c) => {
  return c.json({ error: "Replies cannot be deleted", code: "METHOD_NOT_ALLOWED" }, 405);
});

/** GET /v0/ranks?skill= */
reviewRoutes.get("/ranks", (c) => {
  const skill = c.req.query("skill");
  if (!skill) return c.json({ error: "skill query required" }, 400);
  const items = getRanksBySkill(skill);
  return c.json({
    skill,
    items,
    total: items.length,
    weights: getDb().rankWeights,
    note: "Vertical skill ranks only — no global total score",
  });
});

/** POST /v0/admin/ranks/recompute */
reviewRoutes.post("/admin/ranks/recompute", async (c) => {
  try {
    const adminKey = c.req.header("X-Admin-Key");
    if (!adminKey || adminKey !== getDb().adminKey) {
      return c.json({ error: "Unauthorized", code: "ADMIN_UNAUTHORIZED" }, 401);
    }
    const body = await c.req.json<{ weights?: Partial<{ w1: number; w2: number; w3: number; w4: number; w5: number }> }>().catch(() => ({} as any));
    if (body.weights && typeof body.weights === "object") {
      getDb().rankWeights = { ...getDb().rankWeights, ...body.weights };
    }
    const items = recomputeAndAudit("admin");
    return c.json({ items, total: items.length, weights: getDb().rankWeights });
  } catch (e) {
    return handleErr(c, e);
  }
});

/** POST /v0/admin/blacklist */
reviewRoutes.post("/admin/blacklist", async (c) => {
  try {
    const adminKey = c.req.header("X-Admin-Key");
    if (!adminKey || adminKey !== getDb().adminKey) {
      return c.json({ error: "Unauthorized", code: "ADMIN_UNAUTHORIZED" }, 401);
    }
    const body = await c.req.json<{
      did?: string;
      userId?: string;
      providerId?: string;
      reason?: string;
      expiresAt?: string;
    }>();
    const entry = addBlacklist({
      did: body.did,
      userId: body.userId,
      providerId: body.providerId,
      reason: body.reason ?? "admin",
      expiresAt: body.expiresAt,
    });
    return c.json({ entry }, 201);
  } catch (e) {
    return handleErr(c, e);
  }
});

/** GET /v0/blacklist */
reviewRoutes.get("/blacklist", (c) => {
  return c.json({ items: listBlacklist(), total: listBlacklist().length });
});
