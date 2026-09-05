/**
 * Agent Gig V0.5 Slice 2 — portfolio consent, public list, revoke, self_reported, admin takedown, listing aggregate.
 * Run with API up (after seed): bun run e2e:s2
 */
const BASE = process.env.AG_API ?? "http://localhost:8787";
const ADMIN = "dev-admin-key-v0";
const USER = "user_demo";
const HIRER = "agent_hirer_demo";
const PROVIDER = "did:ag:code-reviewer-01";

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

async function createLockedDelivered(opts: { feeCap: number; taskSummary: string }) {
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
      revisions: 1,
      dueInHours: 24,
    }),
  });
  assert(created.status === 201, "create " + JSON.stringify(created.data));
  const id = created.data.order.orderId;
  const appr = await req(`/v0/orders/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", userId: USER }),
  });
  assert(appr.status === 200 && appr.data.order.status === "accepted", "approve");
  await req(`/v0/orders/${id}/start`, { method: "POST", role: "provider", actorId: PROVIDER });
  const del = await req(`/v0/orders/${id}/deliver`, {
    method: "POST",
    role: "provider",
    actorId: PROVIDER,
    body: JSON.stringify({ reportMarkdown: `# ${opts.taskSummary}`, severity: "info" }),
  });
  assert(del.data.order.status === "delivered", "delivered");
  return { id };
}

async function main() {
  console.log("Agent Gig E2E S2 →", BASE);
  await waitHealthy();
  await ensureListing();

  console.log("\n[S2-1 listing aggregate three columns]");
  await test("S2-1 GET listings/:did has portfolio + reviews aggregate", async () => {
    const r = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    assert(r.status === 200, "200");
    assert(Array.isArray(r.data.portfolio), "portfolio array");
    assert(Array.isArray(r.data.reviews), "reviews array");
    // S3 wires real reviews; coming-soon placeholder removed
    assert(r.data.reviewsComingSoon !== true, "no S2 coming-soon placeholder");
    assert(r.data.passport?.provider?.legalName, "provider legal name still present");
  });

  console.log("\n[S2-2 no consent → not public]");
  await test("S2-2 satisfied without consent / all false → not in public list", async () => {
    const { id } = await createLockedDelivered({ feeCap: 11, taskSummary: "s2 no consent" });
    const acc = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({ decision: "satisfied", userId: USER }),
    });
    assert(acc.status === 200 && acc.data.order.status === "released", "released");
    assert(acc.data.order.portfolioConsent?.publicPortfolio === false, "default public false");
    assert(acc.data.order.portfolioConsent?.homepage === false, "default homepage false");
    assert(!acc.data.portfolioItem, "no portfolio item created");
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    assert(!list.data.items?.some((i: any) => i.orderId === id), "not in public list");

    const audit = await req(`/v0/audit?orderId=${id}`);
    assert(audit.data.events?.some((e: any) => e.action === "portfolio.consent"), "consent audit");
  });

  await test("S2-2b homepage-only does not enter public portfolio list", async () => {
    const { id } = await createLockedDelivered({ feeCap: 12, taskSummary: "s2 homepage only" });
    const acc = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({
        decision: "satisfied",
        userId: USER,
        consent: { publicPortfolio: false, homepage: true },
      }),
    });
    assert(acc.status === 200, "ok");
    assert(acc.data.portfolioItem?.source === "verified_order", "item created for homepage flag");
    assert(acc.data.portfolioItem?.consent?.homepage === true, "homepage flag stored");
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    assert(!list.data.items?.some((i: any) => i.orderId === id), "homepage-only not in public list");
  });

  console.log("\n[S2-3 consent visible + source badge]");
  let verifiedItemId = "";
  await test("S2-3 publicPortfolio=true → verified_order visible", async () => {
    const { id } = await createLockedDelivered({ feeCap: 13, taskSummary: "s2 public yes" });
    const acc = await req(`/v0/orders/${id}/acceptance`, {
      method: "POST",
      body: JSON.stringify({
        decision: "satisfied",
        userId: USER,
        consent: { publicPortfolio: true, homepage: false },
      }),
    });
    assert(acc.status === 200, "ok");
    assert(acc.data.portfolioItem?.source === "verified_order", "verified_order");
    assert(acc.data.portfolioItem?.lowTrust !== true, "not low trust");
    verifiedItemId = acc.data.portfolioItem.itemId;
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    const hit = list.data.items?.find((i: any) => i.orderId === id);
    assert(hit, "visible in public list");
    assert(hit.source === "verified_order", "source mark");
    const listing = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    assert(listing.data.portfolio?.some((i: any) => i.orderId === id), "aggregate includes");
  });

  console.log("\n[S2-4 revoke]");
  await test("S2-4 revoke → new GET invisible", async () => {
    assert(verifiedItemId, "need prior item");
    const bad = await req(`/v0/portfolio/${verifiedItemId}/revoke`, {
      method: "POST",
      role: "user",
      actorId: "user_stranger",
    });
    assert(bad.status === 403, "stranger 403");

    const ok = await req(`/v0/portfolio/${verifiedItemId}/revoke`, {
      method: "POST",
      role: "user",
      actorId: USER,
    });
    assert(ok.status === 200 && ok.data.revoked === true, "revoked");
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    assert(!list.data.items?.some((i: any) => i.itemId === verifiedItemId), "gone from public");
    const audit = await req("/v0/audit");
    assert(audit.data.events?.some((e: any) => e.action === "portfolio.revoke" && e.detail?.itemId === verifiedItemId), "revoke audit");
  });

  console.log("\n[S2-5 self_reported]");
  let selfId = "";
  await test("S2-5 self_reported low-trust + forge verified rejected", async () => {
    const forge = await req("/v0/portfolio", {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({
        did: PROVIDER,
        summary: "fake verified",
        source: "verified_order",
        orderId: "ord_forged",
        publicPortfolio: true,
      }),
    });
    assert(forge.status === 403 || forge.status === 400, "forge rejected");
    assert(forge.data.code === "FORGE_VERIFIED" || forge.data.code === "INVALID_SOURCE", "forge code");

    const up = await req("/v0/portfolio", {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({
        did: PROVIDER,
        summary: "Self demo asset",
        publicPortfolio: true,
        media: [{ url: "https://example.invalid/demo.png", kind: "image" }],
      }),
    });
    assert(up.status === 201, "201 " + JSON.stringify(up.data));
    assert(up.data.item.source === "self_reported", "source");
    assert(up.data.item.lowTrust === true, "lowTrust");
    selfId = up.data.item.itemId;
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    const hit = list.data.items?.find((i: any) => i.itemId === selfId);
    assert(hit, "self visible when consented public");
    assert(hit.lowTrust === true, "list lowTrust");
  });

  console.log("\n[S2-6 admin takedown]");
  await test("S2-6 takedown requires key; hides from public", async () => {
    assert(selfId, "need self item");
    const noKey = await req("/v0/admin/moderation/takedown", {
      method: "POST",
      body: JSON.stringify({ itemId: selfId, reason: "spam" }),
    });
    assert(noKey.status === 401, "401 without key");

    const td = await req("/v0/admin/moderation/takedown", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ itemId: selfId, reason: "spam demo" }),
    });
    assert(td.status === 200 && td.data.takenDown === true, "takedown");
    assert(td.data.item.moderationStatus === "taken_down", "status");
    const list = await req(`/v0/portfolio?did=${encodeURIComponent(PROVIDER)}`);
    assert(!list.data.items?.some((i: any) => i.itemId === selfId), "hidden");
    const audit = await req("/v0/audit");
    assert(
      audit.data.events?.some(
        (e: any) => e.action === "moderation.takedown" && e.detail?.itemId === selfId
      ),
      "takedown audit"
    );
  });

  console.log("\n[S2-7/8 freezes]");
  await test("S2-7 confirm still has provider; review requires released order", async () => {
    const created = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 10,
        taskSummary: "s2 confirm freeze",
        hirerUserId: USER,
      }),
    });
    const c = await req(`/v0/orders/${created.data.order.orderId}/confirm`);
    assert(c.data.confirm?.provider?.legalName, "provider MUST");
    await req(`/v0/orders/${created.data.order.orderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", userId: USER }),
    });

    // S3: review endpoint exists but rejects non-released / missing order
    const rev = await fetch(`${BASE}/v0/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Actor-Role": "user", "X-Actor-Id": USER },
      body: JSON.stringify({ orderId: "ord_nonexistent", scores: { quality: 5, communication: 5, punctuality: 5, permissionHonesty: 5 } }),
    });
    assert(rev.status >= 400, "invalid review still 4xx");
  });

  await test("S2 schema helpers round-trip via public item shape", async () => {
    const up = await req("/v0/portfolio", {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({ did: PROVIDER, summary: "shape", publicPortfolio: false }),
    });
    assert(up.status === 201, "created private self");
    const list = await req(`/v0/portfolio/${encodeURIComponent(PROVIDER)}`);
    assert(!list.data.items?.some((i: any) => i.itemId === up.data.item.itemId), "false consent hidden");
    assert(Array.isArray(list.data.reviews), "reviews array present");
    assert(list.data.reviewsComingSoon !== true, "no coming soon");
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
