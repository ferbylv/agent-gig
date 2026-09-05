import { Hono } from "hono";
import {
  isPortfolioSource,
  isPubliclyVisiblePortfolioItem,
  type PortfolioItem,
  type PortfolioMedia,
} from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "../store.js";
import { audit } from "../audit.js";
import { SEED } from "../seed.js";
import { HttpError } from "../orders.js";

export const portfolioRoutes = new Hono();

function actor(c: { req: { header: (n: string) => string | undefined } }) {
  return {
    role: (c.req.header("X-Actor-Role") ?? "user") as string,
    id: c.req.header("X-Actor-Id") ?? SEED.userId,
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

function publicItemsForDid(did: string): PortfolioItem[] {
  return Object.values(getDb().portfolio)
    .filter((i) => i.did === did && isPubliclyVisiblePortfolioItem(i))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(enrichPublic);
}

function enrichPublic(item: PortfolioItem): PortfolioItem {
  return {
    ...item,
    lowTrust: item.source === "self_reported" ? true : item.lowTrust ?? false,
  };
}

/** GET /v0/portfolio?did=… — public list */
portfolioRoutes.get("/portfolio", (c) => {
  const did = c.req.query("did");
  if (!did) return c.json({ error: "did query required" }, 400);
  const items = publicItemsForDid(did);
  return c.json({
    items,
    total: items.length,
    reviews: [],
    reviewsComingSoon: true,
  });
});

/** GET /v0/portfolio/:did — same public list by path */
portfolioRoutes.get("/portfolio/:did", (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const items = publicItemsForDid(did);
  return c.json({
    did,
    items,
    total: items.length,
    reviews: [],
    reviewsComingSoon: true,
  });
});

/**
 * POST /v0/portfolio — provider self_reported upload.
 * Rejects attempts to forge verified_order / bind alien orderId as verified.
 */
portfolioRoutes.post("/portfolio", async (c) => {
  try {
    const a = actor(c);
    const body = await c.req.json<{
      did?: string;
      summary: string;
      media?: PortfolioMedia[];
      source?: string;
      orderId?: string;
      publicPortfolio?: boolean;
      homepage?: boolean;
    }>();

    if (body.source != null && body.source !== "self_reported") {
      // Clients cannot mint verified_order / curated via this endpoint
      if (body.source === "verified_order" || body.orderId) {
        throw new HttpError(
          403,
          "Cannot bind verified_order via upload; verified items come from released+consent",
          "FORGE_VERIFIED"
        );
      }
      if (!isPortfolioSource(body.source) || body.source !== "self_reported") {
        throw new HttpError(400, "Illegal source; only self_reported via POST /portfolio", "INVALID_SOURCE");
      }
    }

    const did = body.did ?? (a.role === "provider" ? a.id : undefined);
    if (!did) throw new HttpError(400, "did required");
    const passport = getDb().passports[did];
    if (!passport) throw new HttpError(404, "Passport not found");

    // Only the provider agent (or admin) may upload for this did
    if (a.role !== "admin" && a.id !== did && a.role !== "provider") {
      throw new HttpError(403, "Only provider can upload self_reported for this did");
    }
    if (a.role === "provider" && a.id !== did) {
      throw new HttpError(403, "Provider may only upload for own did");
    }

    if (!body.summary || !String(body.summary).trim()) {
      throw new HttpError(400, "summary required");
    }

    const decidedAt = nowIso();
    // Self-reported is intended for public display; still require explicit opt-in (default false if omitted)
    const publicPortfolio = body.publicPortfolio === true;
    const homepage = body.homepage === true;
    const item: PortfolioItem = {
      itemId: uid("pi"),
      did,
      source: "self_reported",
      summary: String(body.summary).trim().slice(0, 500),
      media: Array.isArray(body.media) ? body.media.slice(0, 8) : [],
      consent: {
        publicPortfolio,
        homepage,
        decidedAt,
      },
      moderationStatus: "visible",
      lowTrust: true,
      createdAt: decidedAt,
      updatedAt: decidedAt,
    };
    getDb().portfolio[item.itemId] = item;
    audit({
      actorRole: a.role === "admin" ? "admin" : "provider",
      actorId: a.id,
      action: "portfolio.self_reported",
      counterpart: did,
      detail: { itemId: item.itemId, publicPortfolio, homepage },
    });
    saveDb();
    return c.json({ item: enrichPublic(item) }, 201);
  } catch (e) {
    return handleErr(c, e);
  }
});

/** POST /v0/portfolio/:itemId/revoke — revoke consent; public GET hides after */
portfolioRoutes.post("/portfolio/:itemId/revoke", async (c) => {
  try {
    const a = actor(c);
    const itemId = c.req.param("itemId");
    const item = getDb().portfolio[itemId];
    if (!item) throw new HttpError(404, "Portfolio item not found");

    const order = item.orderId ? getDb().orders[item.orderId] : null;
    const isHirerOwner = order && (a.id === order.parties.hirerUserId || a.id === order.parties.hirerAgentId);
    const isProviderOwner = a.id === item.did;
    const isAdmin = a.role === "admin";

    if (!isHirerOwner && !isProviderOwner && !isAdmin) {
      throw new HttpError(403, "Not authorized to revoke this item");
    }

    item.consent.revokedAt = nowIso();
    item.consent.publicPortfolio = false;
    item.consent.homepage = false;
    item.updatedAt = nowIso();
    if (order) {
      order.portfolioConsent = {
        ...item.consent,
        publicPortfolio: false,
        homepage: false,
        revokedAt: item.consent.revokedAt,
        decidedAt: order.portfolioConsent?.decidedAt ?? item.consent.decidedAt,
      };
    }
    audit({
      actorRole: (isAdmin ? "admin" : isHirerOwner ? "user" : "provider") as "user",
      actorId: a.id,
      action: "portfolio.revoke",
      orderId: item.orderId,
      counterpart: item.did,
      detail: { itemId, revokedAt: item.consent.revokedAt },
    });
    saveDb();
    return c.json({ item, revoked: true });
  } catch (e) {
    return handleErr(c, e);
  }
});

/** POST /v0/admin/moderation/takedown */
portfolioRoutes.post("/admin/moderation/takedown", async (c) => {
  try {
    const adminKey = c.req.header("X-Admin-Key");
    if (!adminKey || adminKey !== getDb().adminKey) {
      return c.json({ error: "Unauthorized", code: "ADMIN_UNAUTHORIZED" }, 401);
    }
    const body = await c.req.json<{ itemId: string; reason?: string }>();
    if (!body.itemId) throw new HttpError(400, "itemId required");
    const item = getDb().portfolio[body.itemId];
    if (!item) throw new HttpError(404, "Portfolio item not found");

    item.moderationStatus = "taken_down";
    item.takedownReason = body.reason ? String(body.reason).slice(0, 500) : "admin_takedown";
    item.updatedAt = nowIso();
    audit({
      actorRole: "admin",
      actorId: "admin",
      action: "moderation.takedown",
      counterpart: item.did,
      detail: {
        itemId: item.itemId,
        reason: item.takedownReason,
        source: item.source,
      },
    });
    saveDb();
    return c.json({ item, takenDown: true });
  } catch (e) {
    return handleErr(c, e);
  }
});
