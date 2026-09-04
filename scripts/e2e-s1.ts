/**
 * Agent Gig V0.5 Slice 1 — revise path, reject refund, custom order + Budget.
 * Run with API up: bun run e2e:s1
 */
const BASE = process.env.AG_API ?? "http://localhost:8787";
const ADMIN = "dev-admin-key-v0";
const USER = "user_demo";
const HIRER = "agent_hirer_demo";
const PROVIDER = "did:ag:code-reviewer-01";
const PROVIDER_WALLET = "provider_studio_alpha";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function req(path: string, init: RequestInit & { role?: string; actorId?: string; admin?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.role) headers.set("X-Actor-Role", init.role);
  if (init.actorId) headers.set("X-Actor-Id", init.actorId);
  if (init.admin) headers.set("X-Admin-Key", ADMIN);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error("   ", (e as Error).message);
  }
}

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error("API not healthy");
}

async function ensureListing() {
  await req(`/v0/passports/${encodeURIComponent(PROVIDER)}/publish`, { method: "POST" });
  const p = await req(`/v0/passports/${encodeURIComponent(PROVIDER)}`);
  if (p.data.passport?.listingStatus === "revoked") {
    await req(`/v0/admin/listings/${encodeURIComponent(PROVIDER)}/restore`, { method: "POST", admin: true });
  }
  await req("/v0/budget", {
    method: "PUT",
    body: JSON.stringify({ userId: USER, hirerAgentId: HIRER, totalCap: 500, perOrderCap: 50, dailyCap: 500 }),
  });
}

async function createLockedDelivered(opts: {
  feeCap: number;
  taskSummary: string;
  revisions?: number;
  dueInHours?: number;
}) {
  const created = await req("/v0/orders", {
    method: "POST",
    role: "hirer",
    actorId: HIRER,
    body: JSON.stringify({
      providerAgentId: PROVIDER,
      feeCap: opts.feeCap,
      taskSummary: opts.taskSummary,
      hirerUserId: USER,
      hirerAgentId: HIRER,
      revisions: opts.revisions,
      dueInHours: opts.dueInHours ?? 24,
    }),
  });
  assert(created.status === 201, "create " + JSON.stringify(created.data));
  const id = created.data.order.orderId;
  const appr = await req(`/v0/orders/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", userId: USER }),
  });
  assert(appr.status === 200 && appr.data.order.status === "accepted", "approve");
  assert(appr.data.escrow?.status === "locked", "locked");
  await req(`/v0/orders/${id}/start`, { method: "POST", role: "provider", actorId: PROVIDER });
  const del = await req(`/v0/orders/${id}/deliver`, {
    method: "POST",
    role: "provider",
    actorId: PROVIDER,
    body: JSON.stringify({ reportMarkdown: "# v1", severity: "info" }),
  });
  assert(del.data.order.status === "delivered", "delivered");
  return { id, order: del.data.order, escrow: appr.data.escrow };
}

async function main() {
  console.log("Agent Gig E2E S1 →", BASE);
  await waitHealthy();
  await ensureListing();

  console.log("\n[S1-1 custom create + defaults]");
  await test("S1-1 create accepts summary/feeCap/SLA/revisions default 1", async () => {
    const meta = await req("/v0/meta");
    assert(meta.data.notes?.revisionsDefault === 1, "platform revisionsDefault=1");
    assert(meta.data.notes?.revisionsMax === 1, "platform revisionsMax=1");

    const r = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 12,
        taskSummary: "S1 custom summary",
        hirerUserId: USER,
        dueInHours: 12,
        // omit revisions → default 1
      }),
    });
    assert(r.status === 201, "201");
    assert(r.data.order.revisions === 1, "revisions=1");
    assert(r.data.order.revisionsRemaining === 1, "remaining=1");
    assert(r.data.order.task.summary === "S1 custom summary", "summary");
    assert(r.data.order.pricing.feeCap === 12, "feeCap");
    assert(r.data.order.sla?.dueAt, "dueAt");

    const c = await req(`/v0/orders/${r.data.order.orderId}/confirm`);
    assert(c.data.confirm?.provider?.legalName, "provider MUST");
    assert(c.data.confirm?.sla?.revisions === 1, "confirm shows revisions");
    assert(c.data.confirm?.taskSummary === "S1 custom summary", "confirm summary");
    // reject to avoid locking
    await req(`/v0/orders/${r.data.order.orderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", userId: USER }),
    });
  });

  await test("S1-1b revisions>max clamped to 1", async () => {
    const r = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 10,
        taskSummary: "clamp revisions",
        hirerUserId: USER,
        revisions: 9,
      }),
    });
    assert(r.status === 201, "201");
    assert(r.data.order.revisions === 1, "clamped revisions=1");
    assert(r.data.order.revisionsRemaining === 1, "clamped remaining=1");
    await req(`/v0/orders/${r.data.order.orderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", userId: USER }),
    });
  });

  await test("S1-2 custom form cannot bypass Budget (feeCap>perOrder)", async () => {
    await req("/v0/budget", {
      method: "PUT",
      body: JSON.stringify({ userId: USER, hirerAgentId: HIRER, totalCap: 100, perOrderCap: 10, dailyCap: 100 }),
    });
    const r = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 11,
        taskSummary: "bypass attempt",
        hirerUserId: USER,
        revisions: 2,
      }),
    });
    assert(r.status === 400, "400");
    assert(
      String(r.data.code || r.data.error).includes("PER_ORDER") || String(r.data.error).includes("单笔"),
      "budget code"
    );
    await req("/v0/budget", {
      method: "PUT",
      body: JSON.stringify({ userId: USER, hirerAgentId: HIRER, totalCap: 500, perOrderCap: 50, dailyCap: 500 }),
    });
  });

  console.log("\n[S1-4/5 revise happy + escrow]");
  await test("S1-4 revise happy: remaining 1→0, in_progress, escrow locked unchanged", async () => {
    const wH0 = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    const balH0 = wH0.data.wallet.balance;
    const { id, escrow } = await createLockedDelivered({
      feeCap: 20,
      taskSummary: "revise happy",
      revisions: 1,
    });
    const amount = escrow.amount;
    const wH1 = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    // after lock, balance dropped
    assert(wH1.data.wallet.balance < balH0, "hirer locked");

    const rev = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: USER, note: "fix typo" }),
    });
    assert(rev.status === 200, "revise ok " + JSON.stringify(rev.data));
    assert(rev.data.order.status === "in_progress", "auto-accept → in_progress");
    assert(rev.data.order.revisionsRemaining === 0, "remaining=0");
    assert(rev.data.escrow?.status === "locked", "still locked");
    assert(rev.data.escrow?.amount === amount, "amount unchanged");
    assert(rev.data.order.timestamps?.revision_requested, "timestamp revision_requested");

    const wH2 = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    assert(Math.abs(wH2.data.wallet.balance - wH1.data.wallet.balance) < 0.001, "no second debit");

    // re-deliver and satisfied
    await req(`/v0/orders/${id}/deliver`, {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({ reportMarkdown: "# v2 fixed", severity: "info" }),
    });
    const acc = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "satisfied", userId: USER }),
    });
    assert(acc.data.order.status === "released", "released");
    assert(acc.data.escrow?.status === "released", "escrow released once");
    const led = await req(`/v0/ledger?orderId=${id}`);
    assert(led.data.lines?.some((l: any) => l.kind === "fee"), "10% fee line");
    assert(led.data.lines?.filter((l: any) => l.kind === "lock").length === 1, "single lock");
  });

  await test("S1-5 remaining=0 revise blocked; status stays delivered", async () => {
    const { id } = await createLockedDelivered({
      feeCap: 15,
      taskSummary: "exhaust revisions",
      revisions: 1,
    });
    const first = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: USER }),
    });
    assert(first.data.order.revisionsRemaining === 0, "used once");
    await req(`/v0/orders/${id}/deliver`, {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({ reportMarkdown: "# v2", severity: "info" }),
    });
    const second = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: USER }),
    });
    assert(second.status >= 400 && second.status < 500, "4xx");
    assert(second.data.code === "REVISIONS_EXHAUSTED" || String(second.data.error).includes("用完"), "code");
    const got = await req(`/v0/orders/${id}`);
    assert(got.data.order.status === "delivered", "still delivered");
    assert(got.data.order.revisionsRemaining === 0, "not negative");
    assert(got.data.escrow?.status === "locked", "escrow still locked");
  });

  console.log("\n[S1-6/7 illegal + reject]");
  await test("S1-6 illegal revise from quoted + wrong actor", async () => {
    const created = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 8,
        taskSummary: "illegal revise",
        hirerUserId: USER,
        revisions: 1,
      }),
    });
    const id = created.data.order.orderId;
    const bad = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: USER }),
    });
    assert(bad.status >= 400, "not delivered → 4xx");
    assert(created.data.order.status === "quoted", "unchanged create");

    const { id: id2 } = await createLockedDelivered({
      feeCap: 10,
      taskSummary: "wrong actor",
      revisions: 1,
    });
    const wrong = await req(`/v0/orders/${id2}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: "user_other" }),
    });
    assert(wrong.status === 403, "403");
    const got = await req(`/v0/orders/${id2}`);
    assert(got.data.order.status === "delivered", "unchanged");
  });

  await test("S1-7 reject → refund; provider not credited", async () => {
    const wP0 = await req(`/v0/wallets/${encodeURIComponent(PROVIDER_WALLET)}`);
    const balP0 = wP0.data.wallet?.balance ?? 0;
    const wH0 = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    const balH0 = wH0.data.wallet.balance;

    const { id, escrow } = await createLockedDelivered({
      feeCap: 18,
      taskSummary: "reject refund",
      revisions: 1,
    });
    const wHLocked = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    assert(Math.abs(wHLocked.data.wallet.balance - (balH0 - escrow.amount)) < 0.02, "locked amount");

    const rej = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", userId: USER }),
    });
    assert(rej.status === 200, "reject ok");
    assert(rej.data.order.status === "rejected", "rejected");
    assert(rej.data.escrow?.status === "refunded", "refunded");

    const wH1 = await req(`/v0/wallets/${encodeURIComponent(USER)}`);
    assert(Math.abs(wH1.data.wallet.balance - balH0) < 0.02, "hirer restored");
    const wP1 = await req(`/v0/wallets/${encodeURIComponent(PROVIDER_WALLET)}`);
    assert(Math.abs((wP1.data.wallet?.balance ?? 0) - balP0) < 0.02, "provider not credited");

    const audit = await req(`/v0/audit?orderId=${id}`);
    assert(audit.data.events?.some((e: any) => e.action === "acceptance.reject"), "audit reject");
  });

  await test("R3 audit revise event", async () => {
    const { id } = await createLockedDelivered({
      feeCap: 9,
      taskSummary: "audit revise",
      revisions: 1,
    });
    await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "revise", userId: USER }),
    });
    const audit = await req(`/v0/audit?orderId=${id}`);
    const ev = audit.data.events?.find((e: any) => e.action === "acceptance.revise");
    assert(ev, "revise audit");
    assert(ev.detail?.revisionsRemaining === 0, "remaining in detail");
    assert(ev.detail?.autoAccepted === true, "documents auto-accept");
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
