import type { BlacklistEntry } from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "./store.js";
import { audit } from "./audit.js";
import { HttpError } from "./orders.js";

export function listBlacklist(): BlacklistEntry[] {
  const now = Date.now();
  return (getDb().blacklist ?? []).filter((e) => {
    if (!e.expiresAt) return true;
    return Date.parse(e.expiresAt) > now;
  });
}

export function isBlacklisted(opts: {
  did?: string;
  userId?: string;
  providerId?: string;
}): BlacklistEntry | null {
  const entries = listBlacklist();
  for (const e of entries) {
    if (opts.did && e.did && e.did === opts.did) return e;
    if (opts.userId && e.userId && e.userId === opts.userId) return e;
    if (opts.providerId && e.providerId && e.providerId === opts.providerId) return e;
  }
  return null;
}

/** Gate before Confirm approve / create order — hit → throw, no escrow lock */
export function assertNotBlacklisted(opts: {
  did?: string;
  userId?: string;
  providerId?: string;
}): void {
  const hit = isBlacklisted(opts);
  if (hit) {
    throw new HttpError(
      403,
      "无法雇佣：对方在平台限制名单中。未锁定费用；可更换服务方后重试",
      "BLACKLISTED"
    );
  }
}

/**
 * Minimal same-owner self-hire: hirer userId equals passport owner.userId.
 * Seed model is comparable (user_demo vs user_provider_alpha).
 */
export function assertNotSelfHire(hirerUserId: string, providerOwnerUserId: string | undefined): void {
  if (providerOwnerUserId && hirerUserId && hirerUserId === providerOwnerUserId) {
    throw new HttpError(403, "禁止同主人自雇（最小反刷）", "SELF_HIRE");
  }
}

export function addBlacklist(input: {
  did?: string;
  userId?: string;
  providerId?: string;
  reason: string;
  expiresAt?: string;
}): BlacklistEntry {
  if (!input.did && !input.userId && !input.providerId) {
    throw new HttpError(400, "did, userId, or providerId required", "INVALID_BLACKLIST");
  }
  const entry: BlacklistEntry = {
    id: uid("bl"),
    did: input.did,
    userId: input.userId,
    providerId: input.providerId,
    reason: String(input.reason || "admin").slice(0, 500),
    createdAt: nowIso(),
    expiresAt: input.expiresAt,
  };
  getDb().blacklist.push(entry);
  audit({
    actorRole: "admin",
    actorId: "admin",
    action: "blacklist.add",
    counterpart: entry.did ?? entry.providerId ?? entry.userId,
    detail: { id: entry.id, reason: entry.reason, did: entry.did, userId: entry.userId, providerId: entry.providerId },
  });
  saveDb();
  return entry;
}
