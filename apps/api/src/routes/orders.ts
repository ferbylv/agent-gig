import { Hono } from "hono";
import type { OrderStatus } from "@agent-gig/shared";
import { getDb } from "../store.js";
import { SEED } from "../seed.js";
import {
  acceptOrder,
  cancelOrder,
  confirmOrder,
  createOrder,
  deliverOrder,
  forceTransition,
  getConfirm,
  HttpError,
  mustOrder,
  startOrder,
} from "../orders.js";

export const orderRoutes = new Hono();

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

orderRoutes.post("/orders", async (c) => {
  try {
    const body = await c.req.json<{
      hirerUserId?: string;
      hirerAgentId?: string;
      providerAgentId: string;
      feeCap: number;
      taskSummary: string;
      taskContext?: string;
      asQuoted?: boolean;
    }>();
    const a = actor(c);
    const order = createOrder({
      hirerUserId: body.hirerUserId ?? SEED.userId,
      hirerAgentId: body.hirerAgentId ?? (a.role === "hirer" ? a.id : SEED.hirerAgentId),
      providerAgentId: body.providerAgentId,
      feeCap: body.feeCap,
      taskSummary: body.taskSummary,
      taskContext: body.taskContext,
      asQuoted: body.asQuoted,
    });
    return c.json({ order }, 201);
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.get("/orders", (c) => {
  const role = c.req.query("role");
  const a = actor(c);
  let items = Object.values(getDb().orders);
  if (role === "provider") {
    items = items.filter((o) => o.parties.providerAgentId === a.id);
  } else if (role === "hirer") {
    items = items.filter((o) => o.parties.hirerAgentId === a.id || o.parties.hirerUserId === a.id);
  }
  return c.json({ items });
});

orderRoutes.get("/orders/:id", (c) => {
  try {
    const order = mustOrder(c.req.param("id"));
    const escrow = order.escrowId ? getDb().escrows[order.escrowId] : null;
    return c.json({ order, escrow });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.get("/orders/:id/confirm", async (c) => {
  try {
    const { order, confirm } = getConfirm(c.req.param("id"));
    // ensure verify status fresh
    return c.json({ order, confirm, mustShowProvider: true });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/confirm", async (c) => {
  try {
    const body = await c.req.json<{ decision: "approve" | "reject"; userId?: string }>();
    const userId = body.userId ?? SEED.userId;
    // × / close = reject
    const decision = body.decision === "approve" ? "approve" : "reject";
    const order = confirmOrder(c.req.param("id"), decision, userId);
    const escrow = order.escrowId ? getDb().escrows[order.escrowId] : null;
    return c.json({ order, escrow });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/cancel", async (c) => {
  try {
    const a = actor(c);
    const order = cancelOrder(c.req.param("id"), a.id, a.role);
    const escrow = order.escrowId ? getDb().escrows[order.escrowId] : null;
    return c.json({ order, escrow });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/start", async (c) => {
  try {
    const a = actor(c);
    const order = startOrder(c.req.param("id"), a.id);
    return c.json({ order });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/deliver", async (c) => {
  try {
    const a = actor(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const order = deliverOrder(c.req.param("id"), a.id, body);
    return c.json({ order });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/acceptance", async (c) => {
  try {
    const body = await c.req.json<{ decision: "satisfied" | "reject" | "revise"; userId?: string }>();
    const order = acceptOrder(c.req.param("id"), body.userId ?? SEED.userId, body.decision);
    const escrow = order.escrowId ? getDb().escrows[order.escrowId] : null;
    return c.json({ order, escrow });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.post("/orders/:id/quote", async (c) => {
  try {
    const order = mustOrder(c.req.param("id"));
    if (order.status !== "draft") {
      throw new HttpError(409, `Cannot quote from ${order.status}`, "ILLEGAL_TRANSITION");
    }
    const body = await c.req.json<{ quotedAmount?: number }>().catch(() => ({}));
    if (body.quotedAmount != null) order.pricing.quotedAmount = body.quotedAmount;
    // use force via assert
    const { assertTransition } = await import("@agent-gig/shared");
    assertTransition(order.status, "quoted");
    order.status = "quoted";
    order.timestamps.quoted = new Date().toISOString();
    return c.json({ order });
  } catch (e) {
    return handleErr(c, e);
  }
});

/** Test/debug: attempt illegal or forced transition */
orderRoutes.post("/orders/:id/transition", async (c) => {
  try {
    const body = await c.req.json<{ to: OrderStatus }>();
    const order = forceTransition(c.req.param("id"), body.to);
    return c.json({ order });
  } catch (e) {
    return handleErr(c, e);
  }
});

orderRoutes.get("/escrow/:id", (c) => {
  const e = getDb().escrows[c.req.param("id")];
  if (!e) return c.json({ error: "Not found" }, 404);
  return c.json({ escrow: e });
});

orderRoutes.post("/escrow/:id/release", async (c) => {
  try {
    const escrow = getDb().escrows[c.req.param("id")];
    if (!escrow) return c.json({ error: "Not found" }, 404);
    const order = mustOrder(escrow.orderId);
    if (order.status === "released") {
      return c.json({ escrow, order, idempotent: true });
    }
    if (order.status !== "accepted_done" && order.status !== "delivered") {
      // allow release only via acceptance path primarily
      if (order.status !== "accepted_done") {
        return c.json({ error: `Cannot release from order status ${order.status}`, code: "ILLEGAL_TRANSITION" }, 409);
      }
    }
    const { releaseEscrow } = await import("../escrow.js");
    const { assertTransition } = await import("@agent-gig/shared");
    if (order.status === "delivered") {
      assertTransition("delivered", "accepted_done");
      order.status = "accepted_done";
    }
    const updated = releaseEscrow(order);
    assertTransition(order.status, "released");
    order.status = "released";
    return c.json({ escrow: updated, order });
  } catch (e) {
    return handleErr(c, e);
  }
});
