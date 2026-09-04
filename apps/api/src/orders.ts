import {
  assertTransition,
  verifyPassport,
  type ConfirmPayload,
  type Order,
  type OrderStatus,
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

export function createOrder(input: {
  hirerUserId: string;
  hirerAgentId: string;
  providerAgentId: string;
  feeCap: number;
  taskSummary: string;
  taskContext?: string;
  asQuoted?: boolean;
}): Order {
  const db = getDb();
  const passport = db.passports[input.providerAgentId];
  if (!passport) throw new HttpError(404, "Passport not found");
  if (passport.listingStatus !== "active") {
    throw new HttpError(400, `Listing is ${passport.listingStatus}, cannot order`, "LISTING_INACTIVE");
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
  const dueAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  const order: Order = {
    orderId,
    status: "draft",
    task: { summary: input.taskSummary, context: input.taskContext },
    deliverables: [],
    acceptance: { type: "subjective", requireHumanSignoff: true, criteria: "人工主观验收" },
    pricing: { currency: "GigUSD", feeCap: input.feeCap, quotedAmount: input.feeCap },
    sla: { dueAt, responseMinutes: 60 },
    revisions: 0,
    revisionsRemaining: 0,
    permissionsGranted: passport.permissionNeeds,
    permissionsDenied: ["wallet.sign", "creds.use", "fs.write"],
    parties: {
      hirerUserId: input.hirerUserId,
      hirerAgentId: input.hirerAgentId,
      providerAgentId: input.providerAgentId,
      providerId: passport.provider.providerId,
    },
    timestamps: { created: nowIso(), draft: nowIso() },
    confirmRequired: true, // V0: always Confirm before lock (first-order MUST; others still gate)
    confirmStatus: "pending",
  };

  if (input.asQuoted !== false) {
    order.status = "quoted";
    order.timestamps.quoted = nowIso();
  }

  if (true) {
    order.confirmPayload = {
      provider: passport.provider,
      agentDisplayName: passport.displayName,
      agentDid: input.providerAgentId,
      verifyStatus: "unknown",
      taskSummary: input.taskSummary,
      permissionsAllowed: order.permissionsGranted,
      permissionsDenied: order.permissionsDenied,
      feeCap: input.feeCap,
      currency: "GigUSD",
      sla: { dueAt, revisions: 0, acceptanceType: "subjective" },
    };
    // async verify fill-in
    void verifyPassport(passport as unknown as Record<string, unknown>).then((ok) => {
      if (order.confirmPayload) order.confirmPayload.verifyStatus = ok ? "verified" : "failed";
      saveDb();
    });
  }

  db.orders[orderId] = order;

  // V0: non-first provider — still quoted until Confirm OR we auto-lock here.
  // Keep quoted always; UI/API Confirm approve is the lock gate for all V0 orders
  // (confirmRequired only forces UI). Auto note:
  // auto-accept non-first is intentionally NOT done; confirm endpoint always locks.

  audit({
    actorRole: "hirer",
    actorId: input.hirerAgentId,
    action: "order.create",
    orderId,
    amount: input.feeCap,
    counterpart: input.providerAgentId,
    permissions: order.permissionsGranted,
    detail: { confirmRequired: isFirst },
  });
  saveDb();
  return order;
}

async function buildConfirmPayload(
  order: Order,
  displayName: string,
  passport: { provider: ConfirmPayload["provider"]; listingStatus: string; pubkey: string; signature: string } & Record<string, unknown>
): Promise<ConfirmPayload> {
  const ok = await verifyPassport(passport);
  return {
    provider: passport.provider as ConfirmPayload["provider"],
    agentDisplayName: displayName,
    agentDid: order.parties.providerAgentId,
    verifyStatus: ok ? "verified" : "failed",
    taskSummary: order.task.summary,
    permissionsAllowed: order.permissionsGranted,
    permissionsDenied: order.permissionsDenied,
    feeCap: order.pricing.feeCap,
    currency: "GigUSD",
    sla: {
      dueAt: order.sla.dueAt,
      revisions: 0,
      acceptanceType: order.acceptance.type,
    },
  };
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
      revisions: 0,
      acceptanceType: order.acceptance.type,
    },
  };
  order.confirmPayload = payload;
  // fire and forget verify
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

  // approve
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
    role === "user" && actorId === order.parties.hirerUserId;
  if (!partyOk) throw new HttpError(403, "Not a party to this order");

  if (order.status === "quoted" || order.status === "draft") {
    setStatus(order, "cancelled");
  } else if (order.status === "accepted") {
    refundEscrow(order, "Cancelled after lock, before start");
    setStatus(order, "cancelled");
  } else if (order.status === "in_progress") {
    // V0: allow cancel with refund for simplicity of demo
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

export function acceptOrder(
  orderId: string,
  userId: string,
  decision: "satisfied" | "reject" | "revise"
): Order {
  const order = mustOrder(orderId);
  if (order.parties.hirerUserId !== userId) {
    throw new HttpError(403, "Only hirer user can accept/reject");
  }
  if (order.status !== "delivered") {
    throw new HttpError(409, `Acceptance only from delivered (now ${order.status})`);
  }

  if (decision === "revise") {
    throw new HttpError(
      400,
      "V0 修改次数=0：请拒收后重新开单（需修改仅作引导）",
      "REVISIONS_ZERO"
    );
  }

  if (decision === "reject") {
    setStatus(order, "rejected");
    refundEscrow(order, "Delivery rejected by hirer");
    audit({ actorRole: "user", actorId: userId, action: "acceptance.reject", orderId });
    saveDb();
    return order;
  }

  // satisfied
  setStatus(order, "accepted_done");
  releaseEscrow(order);
  setStatus(order, "released");
  audit({
    actorRole: "user",
    actorId: userId,
    action: "acceptance.satisfied",
    orderId,
    amount: order.pricing.feeCap,
    counterpart: order.parties.providerId,
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
