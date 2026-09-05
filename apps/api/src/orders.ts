import {
  assertTransition,
  REVISIONS_DEFAULT,
  REVISIONS_MAX,
  verifyPassport,
  type ConfirmPayload,
  type Order,
  type OrderStatus,
  type PortfolioConsent,
  type PortfolioItem,
} from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "./store.js";
import { audit } from "./audit.js";
import {
  checkBudgetHard,
  getBudget,
  recordBudgetUsage,
  rejectBudget,
} from "./budget.js";
import { lockEscrow, refundEscrow, releaseEscrow } from "./escrow.js";

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function setStatus(order: Order, to: OrderStatus): void {
  assertTransition(order.status, to);
  order.status = to;
  order.timestamps[to] = nowIso();
}

function resolveDueAt(input: { dueAt?: string; dueInHours?: number; slaHours?: number }): string {
  if (input.dueAt) {
    const t = Date.parse(input.dueAt);
    if (Number.isNaN(t)) throw new HttpError(400, "Invalid dueAt", "INVALID_SLA");
    return new Date(t).toISOString();
  }
  const hours = input.dueInHours ?? input.slaHours ?? 48;
  if (typeof hours !== "number" || hours <= 0) {
    throw new HttpError(400, "dueInHours/slaHours must be positive", "INVALID_SLA");
  }
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function normalizeRevisions(raw: unknown): number {
  if (raw === undefined || raw === null) return REVISIONS_DEFAULT;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "revisions must be an integer >= 0", "INVALID_REVISIONS");
  }
  // S1 freeze: cap at REVISIONS_MAX (default=1, max=1). Values >1 are clamped, not 400.
  return Math.min(n, REVISIONS_MAX);
}

export function createOrder(input: {
  hirerUserId: string;
  hirerAgentId: string;
  providerAgentId: string;
  feeCap: number;
  taskSummary: string;
  taskContext?: string;
  asQuoted?: boolean;
  revisions?: number;
  dueAt?: string;
  dueInHours?: number;
  slaHours?: number;
}): Order {
  const db = getDb();
  const passport = db.passports[input.providerAgentId];
  if (!passport) throw new HttpError(404, "Passport not found");
  if (passport.listingStatus !== "active") {
    throw new HttpError(400, `Listing is ${passport.listingStatus}, cannot order`, "LISTING_INACTIVE");
  }

  if (!input.taskSummary || !String(input.taskSummary).trim()) {
    throw new HttpError(400, "taskSummary is required", "INVALID_TASK");
  }
  if (typeof input.feeCap !== "number" || !(input.feeCap > 0)) {
    throw new HttpError(400, "feeCap must be a positive number", "INVALID_FEE");
  }

  const budget = getBudget(input.hirerUserId, input.hirerAgentId);
  if (!budget) throw new HttpError(400, "Budget not configured");

  const check = checkBudgetHard(budget, input.feeCap);
  if (!check.ok) {
    rejectBudget(input.hirerAgentId, input.feeCap, check.reason);
    throw new HttpError(400, check.reason, `BUDGET_${check.code}`);
  }

  const isFirst = !budget.confirmedProviders.includes(input.providerAgentId);
  const orderId = uid("ord");
  const dueAt = resolveDueAt(input);
  const revisions = normalizeRevisions(input.revisions);

  const order: Order = {
    orderId,
    status: "draft",
    task: { summary: String(input.taskSummary).trim(), context: input.taskContext },
    deliverables: [],
    acceptance: { type: "subjective", requireHumanSignoff: true, criteria: "人工主观验收" },
    pricing: { currency: "GigUSD", feeCap: input.feeCap, quotedAmount: input.feeCap },
    sla: { dueAt, responseMinutes: 60 },
    revisions,
    revisionsRemaining: revisions,
    permissionsGranted: passport.permissionNeeds,
    permissionsDenied: ["wallet.sign", "creds.use", "fs.write"],
    parties: {
      hirerUserId: input.hirerUserId,
      hirerAgentId: input.hirerAgentId,
      providerAgentId: input.providerAgentId,
      providerId: passport.provider.providerId,
    },
    timestamps: { created: nowIso(), draft: nowIso() },
    confirmRequired: true,
    confirmStatus: "pending",
  };

  if (input.asQuoted !== false) {
    order.status = "quoted";
    order.timestamps.quoted = nowIso();
  }

  order.confirmPayload = {
    provider: passport.provider,
    agentDisplayName: passport.displayName,
    agentDid: input.providerAgentId,
    verifyStatus: "unknown",
    taskSummary: order.task.summary,
    permissionsAllowed: order.permissionsGranted,
    permissionsDenied: order.permissionsDenied,
    feeCap: input.feeCap,
    currency: "GigUSD",
    sla: { dueAt, revisions, acceptanceType: "subjective" },
  };
  void verifyPassport(passport as unknown as Record<string, unknown>).then((ok) => {
    if (order.confirmPayload) order.confirmPayload.verifyStatus = ok ? "verified" : "failed";
    saveDb();
  });

  db.orders[orderId] = order;

  audit({
    actorRole: "hirer",
    actorId: input.hirerAgentId,
    action: "order.create",
    orderId,
    amount: input.feeCap,
    counterpart: input.providerAgentId,
    permissions: order.permissionsGranted,
    detail: {
      confirmRequired: isFirst,
      revisions,
      revisionsRemaining: revisions,
      dueAt,
    },
  });
  saveDb();
  return order;
}

function syncConfirmPayload(order: Order): ConfirmPayload {
  const db = getDb();
  const passport = db.passports[order.parties.providerAgentId];
  const payload: ConfirmPayload = {
    provider: passport?.provider ?? {
      providerId: order.parties.providerId,
      legalName: "Unknown",
      type: "individual",
    },
    agentDisplayName: passport?.displayName ?? order.parties.providerAgentId,
    agentDid: order.parties.providerAgentId,
    verifyStatus: "unknown",
    taskSummary: order.task.summary,
    permissionsAllowed: order.permissionsGranted,
    permissionsDenied: order.permissionsDenied,
    feeCap: order.pricing.feeCap,
    currency: "GigUSD",
    sla: {
      dueAt: order.sla.dueAt,
      revisions: order.revisions,
      acceptanceType: order.acceptance.type,
    },
  };
  order.confirmPayload = payload;
  if (passport) {
    verifyPassport(passport as unknown as Record<string, unknown>).then((ok) => {
      if (order.confirmPayload) order.confirmPayload.verifyStatus = ok ? "verified" : "failed";
      saveDb();
    });
  }
  return payload;
}

export function getConfirm(orderId: string): { order: Order; confirm: ConfirmPayload } {
  const order = mustOrder(orderId);
  if (order.status !== "quoted") {
    throw new HttpError(409, `Confirm only for quoted orders (now ${order.status})`);
  }
  const confirm = order.confirmPayload ?? syncConfirmPayload(order);
  confirm.sla.revisions = order.revisions;
  confirm.sla.dueAt = order.sla.dueAt;
  confirm.taskSummary = order.task.summary;
  confirm.feeCap = order.pricing.feeCap;
  return { order, confirm };
}

export function confirmOrder(orderId: string, decision: "approve" | "reject", actorUserId: string): Order {
  const db = getDb();
  const order = mustOrder(orderId);
  if (order.parties.hirerUserId !== actorUserId) {
    throw new HttpError(403, "Only hirer user can confirm");
  }
  if (order.status !== "quoted") {
    throw new HttpError(409, `Cannot confirm from ${order.status}`);
  }

  if (decision === "reject") {
    order.confirmStatus = "rejected";
    setStatus(order, "cancelled");
    audit({
      actorRole: "user",
      actorId: actorUserId,
      action: "confirm.reject",
      orderId,
      amount: order.pricing.feeCap,
      counterpart: order.parties.providerId,
      permissions: order.permissionsGranted,
      detail: { provider: order.confirmPayload?.provider },
    });
    db.ledger.push({
      id: uid("led"),
      at: nowIso(),
      kind: "confirm",
      amount: 0,
      currency: "GigUSD",
      orderId,
      note: "Confirm rejected — no escrow lock",
      meta: { decision: "reject" },
    });
    saveDb();
    return order;
  }

  const budget = getBudget(order.parties.hirerUserId, order.parties.hirerAgentId);
  if (!budget) throw new HttpError(400, "Budget missing");
  const check = checkBudgetHard(budget, order.pricing.feeCap);
  if (!check.ok) {
    rejectBudget(order.parties.hirerAgentId, order.pricing.feeCap, check.reason, orderId);
    throw new HttpError(400, check.reason, `BUDGET_${check.code}`);
  }

  if (!order.confirmPayload) syncConfirmPayload(order);
  order.confirmStatus = "approved";
  lockEscrow(order);
  recordBudgetUsage(budget, order.pricing.feeCap);
  if (!budget.confirmedProviders.includes(order.parties.providerAgentId)) {
    budget.confirmedProviders.push(order.parties.providerAgentId);
  }
  setStatus(order, "accepted");

  audit({
    actorRole: "user",
    actorId: actorUserId,
    action: "confirm.approve",
    orderId,
    amount: order.pricing.feeCap,
    counterpart: order.parties.providerId,
    permissions: order.permissionsGranted,
    detail: { provider: order.confirmPayload?.provider },
  });
  saveDb();
  return order;
}

export function cancelOrder(orderId: string, actorId: string, role: string): Order {
  const order = mustOrder(orderId);
  const partyOk =
    (role === "hirer" && (actorId === order.parties.hirerAgentId || actorId === order.parties.hirerUserId)) ||
    (role === "provider" && actorId === order.parties.providerAgentId) ||
    (role === "user" && actorId === order.parties.hirerUserId);
  if (!partyOk) throw new HttpError(403, "Not a party to this order");

  if (order.status === "quoted" || order.status === "draft") {
    setStatus(order, "cancelled");
  } else if (order.status === "accepted") {
    refundEscrow(order, "Cancelled after lock, before start");
    setStatus(order, "cancelled");
  } else if (order.status === "in_progress") {
    refundEscrow(order, "Cancelled in progress (V0 full refund)");
    setStatus(order, "cancelled");
  } else {
    throw new HttpError(409, `Cannot cancel from ${order.status}`, "ILLEGAL_TRANSITION");
  }
  audit({ actorRole: role as "hirer", actorId, action: "order.cancel", orderId });
  saveDb();
  return order;
}

export function startOrder(orderId: string, providerAgentId: string): Order {
  const order = mustOrder(orderId);
  if (order.parties.providerAgentId !== providerAgentId) {
    throw new HttpError(403, "Only provider agent can start");
  }
  setStatus(order, "in_progress");
  audit({ actorRole: "provider", actorId: providerAgentId, action: "order.start", orderId });
  saveDb();
  return order;
}

export function deliverOrder(orderId: string, providerAgentId: string, payload: Record<string, unknown>): Order {
  const order = mustOrder(orderId);
  if (order.parties.providerAgentId !== providerAgentId) {
    throw new HttpError(403, "Only provider agent can deliver");
  }
  order.deliveryPayload = payload;
  order.deliverables = [payload];
  setStatus(order, "delivered");
  audit({ actorRole: "provider", actorId: providerAgentId, action: "order.deliver", orderId });
  saveDb();
  return order;
}

/**
 * V0.5-S1 revise approach: **auto-accept on revise**.
 * Hirer revise from delivered atomically:
 *   delivered → revision_requested → in_progress
 * with revisionsRemaining-- (never negative). Escrow stays locked; no second lock.
 * Optional POST /orders/:id/revision/ack exists for providers if order is left in revision_requested
 * (e.g. future two-step); S1 acceptance path auto-completes both edges.
 */
export function acceptOrder(
  orderId: string,
  userId: string,
  decision: "satisfied" | "reject" | "revise",
  note?: string,
  consentInput?: { publicPortfolio?: boolean; homepage?: boolean }
): Order {
  const order = mustOrder(orderId);
  if (order.parties.hirerUserId !== userId) {
    throw new HttpError(403, "Only hirer user can accept/reject");
  }
  if (order.status !== "delivered") {
    throw new HttpError(409, `Acceptance only from delivered (now ${order.status})`);
  }

  if (decision === "revise") {
    if (order.revisionsRemaining <= 0) {
      throw new HttpError(400, "修改次数已用完，可拒收或新开单", "REVISIONS_EXHAUSTED");
    }
    const before = order.revisionsRemaining;
    const escrowBefore = order.escrowId ? getDb().escrows[order.escrowId] : null;
    const amountBefore = escrowBefore?.amount;
    const statusBefore = escrowBefore?.status;

    if (note) order.revisionNote = String(note).slice(0, 500);

    setStatus(order, "revision_requested");
    order.revisionsRemaining = before - 1;
    setStatus(order, "in_progress");

    const escrowAfter = order.escrowId ? getDb().escrows[order.escrowId] : null;
    if (
      escrowAfter &&
      (escrowAfter.status !== statusBefore || escrowAfter.amount !== amountBefore)
    ) {
      throw new HttpError(500, "Escrow mutated during revise", "ESCROW_INTEGRITY");
    }

    audit({
      actorRole: "user",
      actorId: userId,
      action: "acceptance.revise",
      orderId,
      amount: order.pricing.feeCap,
      counterpart: order.parties.providerId,
      detail: {
        revisionsBefore: before,
        revisionsRemaining: order.revisionsRemaining,
        autoAccepted: true,
        note: order.revisionNote,
        escrowStatus: escrowAfter?.status,
        escrowAmount: escrowAfter?.amount,
      },
    });
    saveDb();
    return order;
  }

  if (decision === "reject") {
    setStatus(order, "rejected");
    refundEscrow(order, "Delivery rejected by hirer");
    audit({
      actorRole: "user",
      actorId: userId,
      action: "acceptance.reject",
      orderId,
      amount: order.pricing.feeCap,
      counterpart: order.parties.providerId,
      detail: { refunded: true },
    });
    saveDb();
    return order;
  }

  setStatus(order, "accepted_done");
  releaseEscrow(order);
  setStatus(order, "released");

  // V0.5-S2: consent defaults BOTH false — never server-default true
  const decidedAt = nowIso();
  const consent: PortfolioConsent = {
    publicPortfolio: consentInput?.publicPortfolio === true,
    homepage: consentInput?.homepage === true,
    decidedAt,
  };
  order.portfolioConsent = consent;

  audit({
    actorRole: "user",
    actorId: userId,
    action: "acceptance.satisfied",
    orderId,
    amount: order.pricing.feeCap,
    counterpart: order.parties.providerId,
    detail: { portfolioConsent: consent },
  });
  audit({
    actorRole: "user",
    actorId: userId,
    action: "portfolio.consent",
    orderId,
    counterpart: order.parties.providerAgentId,
    detail: { ...consent, source: "acceptance" },
  });

  // verified_order only when released AND (publicPortfolio OR homepage)
  if (consent.publicPortfolio || consent.homepage) {
    createVerifiedPortfolioItem(order, consent);
  }

  saveDb();
  return order;
}

/** Create verified_order PortfolioItem from a released order (internal). */
export function createVerifiedPortfolioItem(order: Order, consent: PortfolioConsent): PortfolioItem {
  const db = getDb();
  // Idempotent: one verified item per order
  const existing = Object.values(db.portfolio).find(
    (i) => i.source === "verified_order" && i.orderId === order.orderId
  );
  if (existing) {
    existing.consent = { ...consent };
    existing.updatedAt = nowIso();
    return existing;
  }
  const summary =
    typeof order.deliveryPayload?.reportMarkdown === "string"
      ? String(order.deliveryPayload.reportMarkdown).slice(0, 280)
      : order.task.summary;
  const item: PortfolioItem = {
    itemId: uid("pi"),
    did: order.parties.providerAgentId,
    source: "verified_order",
    orderId: order.orderId,
    summary,
    media: [],
    consent: { ...consent },
    moderationStatus: "visible",
    lowTrust: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.portfolio[item.itemId] = item;
  return item;
}

/** Post-release consent update: create/update verified item or leave none if both false. */
export function setOrderPortfolioConsent(
  orderId: string,
  userId: string,
  input: { publicPortfolio?: boolean; homepage?: boolean }
): { order: Order; item: PortfolioItem | null } {
  const order = mustOrder(orderId);
  if (order.parties.hirerUserId !== userId) {
    throw new HttpError(403, "Only hirer user can set portfolio consent");
  }
  if (order.status !== "released") {
    throw new HttpError(409, `Consent only after released (now ${order.status})`);
  }
  const decidedAt = nowIso();
  const consent: PortfolioConsent = {
    publicPortfolio: input.publicPortfolio === true,
    homepage: input.homepage === true,
    decidedAt,
  };
  order.portfolioConsent = consent;
  audit({
    actorRole: "user",
    actorId: userId,
    action: "portfolio.consent",
    orderId,
    counterpart: order.parties.providerAgentId,
    detail: { ...consent, source: "post_release" },
  });
  let item: PortfolioItem | null = null;
  if (consent.publicPortfolio || consent.homepage) {
    item = createVerifiedPortfolioItem(order, consent);
  } else {
    // If previously created and now both false, revoke public flags on existing
    const existing = Object.values(getDb().portfolio).find(
      (i) => i.source === "verified_order" && i.orderId === order.orderId
    );
    if (existing) {
      existing.consent = { ...consent, revokedAt: existing.consent.revokedAt };
      existing.updatedAt = nowIso();
      item = existing;
    }
  }
  saveDb();
  return { order, item };
}

/** Optional provider ack if order sits in revision_requested (two-step); S1 auto-accept usually skips this. */
export function ackRevision(orderId: string, providerAgentId: string): Order {
  const order = mustOrder(orderId);
  if (order.parties.providerAgentId !== providerAgentId) {
    throw new HttpError(403, "Only provider agent can ack revision");
  }
  if (order.status !== "revision_requested") {
    throw new HttpError(409, `Revision ack only from revision_requested (now ${order.status})`);
  }
  setStatus(order, "in_progress");
  audit({
    actorRole: "provider",
    actorId: providerAgentId,
    action: "revision.ack",
    orderId,
    detail: { revisionsRemaining: order.revisionsRemaining },
  });
  saveDb();
  return order;
}

export function forceTransition(orderId: string, to: OrderStatus): never | Order {
  const order = mustOrder(orderId);
  try {
    setStatus(order, to);
    saveDb();
    return order;
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    throw new HttpError(err.status ?? 409, err.message, err.code ?? "ILLEGAL_TRANSITION");
  }
}

export function mustOrder(orderId: string): Order {
  const order = getDb().orders[orderId];
  if (!order) throw new HttpError(404, "Order not found");
  return order;
}

export { syncConfirmPayload };
