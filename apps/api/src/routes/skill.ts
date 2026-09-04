import { Hono } from "hono";
import { getDb, nowIso, saveDb } from "../store.js";
import { getBudget, putBudget } from "../budget.js";
import { SEED } from "../seed.js";
import { audit } from "../audit.js";

export const skillRoutes = new Hono();

function actor(c: { req: { header: (n: string) => string | undefined } }) {
  return {
    role: c.req.header("X-Actor-Role") ?? "user",
    id: c.req.header("X-Actor-Id") ?? SEED.userId,
  };
}

skillRoutes.post("/connect/bind", async (c) => {
  const body = await c.req.json<{ userId: string; hirerAgentId: string; registryUrl?: string }>();
  const db = getDb();
  db.connects[body.hirerAgentId] = {
    userId: body.userId,
    hirerAgentId: body.hirerAgentId,
    registryUrl: body.registryUrl ?? "http://localhost:8787",
    boundAt: nowIso(),
  };
  audit({
    actorRole: "user",
    actorId: body.userId,
    action: "connect.bind",
    counterpart: body.hirerAgentId,
  });
  saveDb();
  return c.json({ binding: db.connects[body.hirerAgentId] });
});

skillRoutes.get("/connect/:hirerAgentId", (c) => {
  const b = getDb().connects[c.req.param("hirerAgentId")];
  if (!b) return c.json({ error: "Not bound" }, 404);
  return c.json({ binding: b });
});

skillRoutes.get("/budget", (c) => {
  const userId = c.req.query("userId") ?? actor(c).id;
  const hirerAgentId = c.req.query("hirerAgentId") ?? SEED.hirerAgentId;
  const b = getBudget(userId, hirerAgentId);
  if (!b) return c.json({ error: "Budget not found" }, 404);
  return c.json({ budget: b });
});

skillRoutes.put("/budget", async (c) => {
  const body = await c.req.json<{
    userId?: string;
    hirerAgentId?: string;
    totalCap: number;
    perOrderCap: number;
    dailyCap: number;
  }>();
  const userId = body.userId ?? SEED.userId;
  const hirerAgentId = body.hirerAgentId ?? SEED.hirerAgentId;
  const b = putBudget(userId, hirerAgentId, {
    totalCap: body.totalCap,
    perOrderCap: body.perOrderCap,
    dailyCap: body.dailyCap,
  });
  audit({
    actorRole: "user",
    actorId: userId,
    action: "budget.save",
    detail: { totalCap: b.totalCap, perOrderCap: b.perOrderCap, dailyCap: b.dailyCap },
  });
  return c.json({ budget: b });
});

skillRoutes.get("/audit", (c) => {
  const orderId = c.req.query("orderId");
  const events = getDb().audit.filter((e) => (orderId ? e.orderId === orderId : true));
  return c.json({ events });
});

skillRoutes.get("/audit/export", (c) => {
  const format = c.req.query("format") ?? "json";
  const events = getDb().audit;
  const ledger = getDb().ledger;
  if (format === "csv") {
    const header = "id,at,actorRole,actorId,action,orderId,amount,counterpart\n";
    const rows = events
      .map(
        (e) =>
          `${e.id},${e.at},${e.actorRole},${e.actorId},${e.action},${e.orderId ?? ""},${e.amount ?? ""},${e.counterpart ?? ""}`
      )
      .join("\n");
    return c.text(header + rows, 200, { "Content-Type": "text/csv" });
  }
  return c.json({
    exportedAt: nowIso(),
    events,
    ledger,
    note: "足以回答：谁、何时、金额、对手、权限",
  });
});

skillRoutes.get("/wallets/:ownerId", (c) => {
  const w = getDb().wallets[c.req.param("ownerId")];
  if (!w) return c.json({ error: "Wallet not found" }, 404);
  return c.json({ wallet: w });
});

skillRoutes.get("/ledger", (c) => {
  const orderId = c.req.query("orderId");
  const lines = getDb().ledger.filter((l) => (orderId ? l.orderId === orderId : true));
  return c.json({ lines });
});
