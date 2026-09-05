import { Hono } from "hono";
import {
  signPassport,
  verifyPassport,
  shortUri,
  type PassportCard,
  type ListingStatus,
} from "@agent-gig/shared";
import { getDb, nowIso, saveDb } from "../store.js";
import { audit } from "../audit.js";

export const passportRoutes = new Hono();

passportRoutes.get("/listings", (c) => {
  const skill = c.req.query("skill");
  const q = (c.req.query("q") ?? "").toLowerCase();
  const db = getDb();
  const list = Object.values(db.passports).filter((p) => {
    if (p.listingStatus !== "active") return false;
    if (skill && !p.skills.includes(skill)) return false;
    if (q) {
      const hay = `${p.displayName} ${p.tagline} ${p.skills.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return c.json({ items: list, total: list.length });
});

passportRoutes.get("/listings/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  const verified = await verifyPassport(p as unknown as Record<string, unknown>);
  const { isPubliclyVisiblePortfolioItem } = await import("@agent-gig/shared");
  const portfolio = Object.values(getDb().portfolio ?? {})
    .filter((i) => i.did === did && isPubliclyVisiblePortfolioItem(i))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((i) => ({
      ...i,
      lowTrust: i.source === "self_reported" ? true : i.lowTrust ?? false,
    }));
  return c.json({
    listing: p,
    passport: p,
    verified,
    uris: shortUri(did),
    portfolio,
    reviews: [],
    reviewsComingSoon: true,
  });
});

passportRoutes.get("/passports/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  const verified = await verifyPassport(p as unknown as Record<string, unknown>);
  return c.json({
    passport: p,
    verified,
    verifyStatus: verified ? "verified" : "failed",
    uris: shortUri(did),
  });
});

passportRoutes.get("/passports/:did/export.json", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  return c.json(p);
});

passportRoutes.get("/passports/:did/qr", (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  const uris = shortUri(did);
  return c.json({
    payload: uris.agentpass,
    http: uris.http,
    note: "QR encodes short URI only — not a long description",
  });
});

passportRoutes.put("/passports/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const body = await c.req.json<Partial<PassportCard> & { secretKey?: string }>();
  const db = getDb();
  const existing = db.passports[did];
  const secret = body.secretKey ?? db.passportSecrets[did];
  if (!secret) return c.json({ error: "secretKey required to sign" }, 400);

  const { secretKey: _s, ...rest } = body;
  const card: PassportCard = {
    ...(existing ?? ({} as PassportCard)),
    ...rest,
    did,
    updatedAt: nowIso(),
    signature: "",
  } as PassportCard;

  if (!card.pubkey) {
    return c.json({ error: "pubkey required" }, 400);
  }
  card.signature = await signPassport(card as unknown as Record<string, unknown>, secret);
  card.qrPayload = shortUri(did).agentpass;
  db.passports[did] = card;
  db.passportSecrets[did] = secret;
  audit({
    actorRole: "provider",
    actorId: did,
    action: "passport.upsert",
    counterpart: card.provider?.providerId,
  });
  saveDb();
  const verified = await verifyPassport(card as unknown as Record<string, unknown>);
  return c.json({ passport: card, verified });
});

passportRoutes.post("/passports/:did/publish", (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  if (p.listingStatus === "revoked") return c.json({ error: "Revoked cannot publish" }, 400);
  p.listingStatus = "active";
  p.updatedAt = nowIso();
  saveDb();
  return c.json({ passport: p });
});

passportRoutes.post("/passports/:did/pause", (c) => {
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  p.listingStatus = "paused";
  p.updatedAt = nowIso();
  saveDb();
  return c.json({ passport: p });
});

passportRoutes.post("/admin/listings/:did/revoke", (c) => {
  const adminKey = c.req.header("X-Admin-Key");
  if (adminKey !== getDb().adminKey) return c.json({ error: "Unauthorized" }, 401);
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  p.listingStatus = "revoked" as ListingStatus;
  p.updatedAt = nowIso();
  audit({ actorRole: "admin", actorId: "admin", action: "listing.revoke", counterpart: did });
  saveDb();
  return c.json({ passport: p, listingStatus: "revoked" });
});

passportRoutes.post("/admin/listings/:did/restore", (c) => {
  const adminKey = c.req.header("X-Admin-Key");
  if (adminKey !== getDb().adminKey) return c.json({ error: "Unauthorized" }, 401);
  const did = decodeURIComponent(c.req.param("did"));
  const p = getDb().passports[did];
  if (!p) return c.json({ error: "Not found" }, 404);
  p.listingStatus = "active";
  p.updatedAt = nowIso();
  saveDb();
  return c.json({ passport: p, listingStatus: "active" });
});

passportRoutes.get("/skills", (c) => {
  return c.json({ skills: ["code_review", "design_illustration"] });
});
