import { TAKE_RATE_BPS, type Escrow, type Order } from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "./store.js";
import { audit } from "./audit.js";
import { releaseBudgetUsage, getBudget } from "./budget.js";

export function lockEscrow(order: Order): Escrow {
  const db = getDb();
  const amount = order.pricing.quotedAmount ?? order.pricing.feeCap;
  const wallet = db.wallets[order.parties.hirerUserId];
  if (!wallet || wallet.balance < amount) {
    const err = new Error("托管失败：余额不足，未扣款/未锁定") as Error & { status: number; code: string };
    err.status = 402;
    err.code = "ESCROW_INSUFFICIENT";
    throw err;
  }

  wallet.balance -= amount;
  const escrow: Escrow = {
    escrowId: uid("esc"),
    orderId: order.orderId,
    amount,
    currency: "GigUSD",
    status: "locked",
    feeBps: TAKE_RATE_BPS,
    lockedAt: nowIso(),
    hirerUserId: order.parties.hirerUserId,
    providerId: order.parties.providerId,
  };
  db.escrows[escrow.escrowId] = escrow;
  order.escrowId = escrow.escrowId;

  db.ledger.push({
    id: uid("led"),
    at: nowIso(),
    kind: "lock",
    amount,
    currency: "GigUSD",
    orderId: order.orderId,
    escrowId: escrow.escrowId,
    from: order.parties.hirerUserId,
    to: "escrow",
    note: "Escrow lock",
  });

  audit({
    actorRole: "user",
    actorId: order.parties.hirerUserId,
    action: "escrow.lock",
    orderId: order.orderId,
    amount,
    counterpart: order.parties.providerId,
    permissions: order.permissionsGranted,
  });

  saveDb();
  return escrow;
}

export function releaseEscrow(order: Order): Escrow {
  const db = getDb();
  if (!order.escrowId) {
    const err = new Error("No escrow") as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const escrow = db.escrows[order.escrowId];
  if (!escrow) {
    const err = new Error("Escrow not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (escrow.status === "released") {
    // idempotent
    return escrow;
  }
  if (escrow.status !== "locked") {
    const err = new Error(`Cannot release escrow in status ${escrow.status}`) as Error & { status: number };
    err.status = 409;
    throw err;
  }

  const fee = Math.round((escrow.amount * escrow.feeBps) / 10000 * 100) / 100;
  const net = Math.round((escrow.amount - fee) * 100) / 100;

  const providerWallet = db.wallets[escrow.providerId] ?? {
    ownerId: escrow.providerId,
    ownerType: "provider" as const,
    balance: 0,
    currency: "GigUSD" as const,
  };
  db.wallets[escrow.providerId] = providerWallet;
  providerWallet.balance = Math.round((providerWallet.balance + net) * 100) / 100;

  const platform = db.wallets["platform"] ?? {
    ownerId: "platform",
    ownerType: "platform" as const,
    balance: 0,
    currency: "GigUSD" as const,
  };
  db.wallets["platform"] = platform;
  platform.balance = Math.round((platform.balance + fee) * 100) / 100;

  escrow.status = "released";
  escrow.releasedAt = nowIso();

  db.ledger.push({
    id: uid("led"),
    at: nowIso(),
    kind: "release",
    amount: net,
    currency: "GigUSD",
    orderId: order.orderId,
    escrowId: escrow.escrowId,
    from: "escrow",
    to: escrow.providerId,
    note: "Release to provider (net)",
  });
  db.ledger.push({
    id: uid("led"),
    at: nowIso(),
    kind: "fee",
    amount: fee,
    currency: "GigUSD",
    orderId: order.orderId,
    escrowId: escrow.escrowId,
    from: "escrow",
    to: "platform",
    note: `Platform take rate ${escrow.feeBps / 100}%`,
    meta: { feeBps: escrow.feeBps, gross: escrow.amount },
  });

  audit({
    actorRole: "user",
    actorId: order.parties.hirerUserId,
    action: "escrow.release",
    orderId: order.orderId,
    amount: escrow.amount,
    counterpart: escrow.providerId,
    detail: { net, fee, feeBps: escrow.feeBps },
  });

  saveDb();
  return escrow;
}

export function refundEscrow(order: Order, reason: string): Escrow | null {
  const db = getDb();
  if (!order.escrowId) return null;
  const escrow = db.escrows[order.escrowId];
  if (!escrow) return null;
  if (escrow.status === "refunded") return escrow;
  if (escrow.status !== "locked") {
    const err = new Error(`Cannot refund escrow in status ${escrow.status}`) as Error & { status: number };
    err.status = 409;
    throw err;
  }

  const wallet = db.wallets[escrow.hirerUserId];
  if (wallet) {
    wallet.balance = Math.round((wallet.balance + escrow.amount) * 100) / 100;
  }

  escrow.status = "refunded";
  escrow.refundedAt = nowIso();

  const budget = getBudget(order.parties.hirerUserId, order.parties.hirerAgentId);
  if (budget) releaseBudgetUsage(budget, escrow.amount);

  db.ledger.push({
    id: uid("led"),
    at: nowIso(),
    kind: "refund",
    amount: escrow.amount,
    currency: "GigUSD",
    orderId: order.orderId,
    escrowId: escrow.escrowId,
    from: "escrow",
    to: escrow.hirerUserId,
    note: reason,
  });

  audit({
    actorRole: "user",
    actorId: order.parties.hirerUserId,
    action: "escrow.refund",
    orderId: order.orderId,
    amount: escrow.amount,
    counterpart: escrow.providerId,
    detail: { reason },
  });

  saveDb();
  return escrow;
}
