import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadDb, getDb } from "./store.js";
import { seedAll, SEED } from "./seed.js";
import { passportRoutes } from "./routes/passports.js";
import { skillRoutes } from "./routes/skill.js";
import { orderRoutes } from "./routes/orders.js";

const app = new Hono();

app.use("*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ ok: true, service: "agent-gig-api", version: "v0" }));

app.get("/v0/meta", (c) => {
  const db = getDb();
  return c.json({
    seed: {
      userId: SEED.userId,
      hirerAgentId: SEED.hirerAgentId,
      providerAgentId: SEED.providerAgentId,
      providerId: SEED.providerId,
      adminKeyHint: "dev-admin-key-v0",
    },
    counts: {
      passports: Object.keys(db.passports).length,
      orders: Object.keys(db.orders).length,
      escrows: Object.keys(db.escrows).length,
    },
    notes: {
      skillNeverHoldsKeys: true,
      currency: "GigUSD",
      takeRateBps: 1000,
      revisionsDefault: 0,
    },
  });
});

app.route("/v0", passportRoutes);
app.route("/v0", skillRoutes);
app.route("/v0", orderRoutes);

const port = Number(process.env.PORT ?? 8787);

loadDb();
await seedAll(false);

console.log(`Agent Gig API listening on http://localhost:${port}`);
console.log(`Seed provider: ${SEED.providerAgentId} (code_review)`);

export default {
  port,
  fetch: app.fetch,
};
