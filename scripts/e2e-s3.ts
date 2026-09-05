/**
 * Agent Gig V0.5 Slice 3 — reviews, reply-once, ranks, preferred, blacklist, self-hire.
 * Run with API up (after seed): bun run e2e:s3
 */
const BASE = process.env.AG_API ?? "http://localhost:8787";
const ADMIN = "dev-admin-key-v0";
const USER = "user_demo";
const HIRER = "agent_hirer_demo";
const PROVIDER = "did:ag:code-reviewer-01";
const PROVIDER2 = "did:ag:code-reviewer-02";
const SELF_HIRE = "did:ag:self-hire-trap";

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
  for (const did of [PROVIDER, PROVIDER2, SELF_HIRE]) {
    await req(`/v0/passports/${encodeURIComponent(did)}/publish`, { method: "POST" });
    const p = await req(`/v0/passports/${encodeURIComponent(did)}`);
    if (p.data.passport?.listingStatus === "revoked") {
      await req(`/v0/admin/listings/${encodeURIComponent(did)}/restore`, { method: "POST", admin: true });
    }
  }
  await req("/v0/budget", {
    method: "PUT",
    body: JSON.stringify({ userId: USER, hirerAgentId: HIRER, totalCap: 2000, perOrderCap: 50, dailyCap: 2000 }),
  });
}

async function createReleased(opts: {
  feeCap: number;
  taskSummary: string;
  providerAgentId?: string;
}): Promise<string> {
  const provider = opts.providerAgentId ?? PROVIDER;
  const created = await req("/v0/orders", {
    method: "POST",
    role: "hirer",
    actorId: HIRER,
    body: JSON.stringify({
      providerAgentId: provider,
      feeCap: opts.feeCap,
      taskSummary: opts.taskSummary,
      hirerUserId: USER,
      hirerAgentId: HIRER,
      revisions: 1,
      dueInHours: 24,
    }),
  });
  assert(created.status === 201, "create " + JSON.stringify(created.data));
  const id = created.data.order.orderId as string;
  const appr = await req(`/v0/orders/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", userId: USER }),
  });
  assert(appr.status === 200 && appr.data.order.status === "accepted", "approve " + JSON.stringify(appr.data));
  await req(`/v0/orders/${id}/start`, { method: "POST", role: "provider", actorId: provider });
  await req(`/v0/orders/${id}/deliver`, {
    method: "POST",
    role: "provider",
    actorId: provider,
    body: JSON.stringify({ reportMarkdown: `# ${opts.taskSummary}`, severity: "info" }),
  });
  const acc = await req(`/v0/orders/${id}/acceptance`, {
    method: "POST",
    body: JSON.stringify({ decision: "satisfied", userId: USER }),
  });
  assert(acc.status === 200 && acc.data.order.status === "released", "released");
  return id;
}

async function main() {
  console.log("Agent Gig E2E S3 →", BASE);
  await waitHealthy();
  await ensureListing();

  console.log("\n[S3-1 empty reviews column / no coming-soon]");
  await test("S3-1 listing aggregate has reviews[] + summary, no reviewsComingSoon", async () => {
    const r = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    assert(r.status === 200, "200");
    assert(Array.isArray(r.data.reviews), "reviews array");
    assert(r.data.reviewSummary && typeof r.data.reviewSummary.count === "number", "summary");
    assert(r.data.reviewsComingSoon !== true, "no coming-soon placeholder");
  });

  console.log("\n[S3-2/3 review write + one-per-order + gates]");
  let reviewId = "";
  let orderId = "";
  await test("S3-2 create four-dim review on released order", async () => {
    orderId = await createReleased({ feeCap: 10, taskSummary: "s3 review good" });
    const badStatus = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({
        orderId: "ord_missing",
        scores: { quality: 5, communication: 5, punctuality: 5, permissionHonesty: 5 },
      }),
    });
    assert(badStatus.status === 404 || badStatus.status === 409, "missing order fails");

    const notReleased = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER,
        feeCap: 10,
        taskSummary: "s3 not released yet",
        hirerUserId: USER,
      }),
    });
    const early = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({
        orderId: notReleased.data.order.orderId,
        scores: { quality: 5, communication: 5, punctuality: 5, permissionHonesty: 5 },
      }),
    });
    assert(early.status === 409 && early.data.code === "NOT_RELEASED", "not released");
    await req(`/v0/orders/${notReleased.data.order.orderId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", userId: USER }),
    });

    const badScores = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({ orderId, scores: { quality: 0, communication: 5, punctuality: 5, permissionHonesty: 5 } }),
    });
    assert(badScores.status === 400, "score 0 rejected");

    const stranger = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: "user_stranger",
      body: JSON.stringify({
        orderId,
        hirerUserId: "user_stranger",
        scores: { quality: 5, communication: 5, punctuality: 5, permissionHonesty: 5 },
      }),
    });
    assert(stranger.status === 403, "non-hirer 403");

    const ok = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({
        orderId,
        scores: { quality: 5, communication: 5, punctuality: 4, permissionHonesty: 5 },
        comment: "扎实",
      }),
    });
    assert(ok.status === 201, "201 " + JSON.stringify(ok.data));
    reviewId = ok.data.review.reviewId;
    const listing = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    assert(listing.data.reviews?.some((r: any) => r.orderId === orderId), "visible on detail");
    assert(listing.data.reviewSummary?.count >= 1, "summary updated");
    const audit = await req(`/v0/audit?orderId=${orderId}`);
    assert(audit.data.events?.some((e: any) => e.action === "review.create"), "audit create");
  });

  await test("S3-3 duplicate review → 4xx; DELETE → 405", async () => {
    const dup = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({
        orderId,
        scores: { quality: 1, communication: 1, punctuality: 1, permissionHonesty: 1 },
      }),
    });
    assert(dup.status === 409 && dup.data.code === "ALREADY_REVIEWED", "dup");
    const del = await fetch(`${BASE}/v0/reviews/${reviewId}`, { method: "DELETE" });
    assert(del.status === 405, "no delete");
  });

  console.log("\n[S3-4 provider reply once]");
  await test("S3-4 reply once; second fails; hirer 403", async () => {
    const hirerTry = await req(`/v0/reviews/${reviewId}/reply`, {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({ text: "nope" }),
    });
    assert(hirerTry.status === 403, "hirer cannot reply");
    const r1 = await req(`/v0/reviews/${reviewId}/reply`, {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({ text: "感谢反馈" }),
    });
    assert(r1.status === 200 && r1.data.review.providerReply?.text === "感谢反馈", "first reply");
    const r2 = await req(`/v0/reviews/${reviewId}/reply`, {
      method: "POST",
      role: "provider",
      actorId: PROVIDER,
      body: JSON.stringify({ text: "again" }),
    });
    assert(r2.status === 409 && r2.data.code === "ALREADY_REPLIED", "second blocked");
  });

  console.log("\n[S3-5 ranks + low score sorts lower + new not top]");
  await test("S3-5 vertical ranks: low avg ranks below; new <10 not top", async () => {
    // Second provider: one low review
    const oid2 = await createReleased({ feeCap: 10, taskSummary: "s3 low review", providerAgentId: PROVIDER2 });
    const low = await req("/v0/reviews", {
      method: "POST",
      role: "user",
      actorId: USER,
      body: JSON.stringify({
        orderId: oid2,
        scores: { quality: 1, communication: 1, punctuality: 1, permissionHonesty: 1 },
      }),
    });
    assert(low.status === 201, "low review");

    const noKey = await req("/v0/admin/ranks/recompute", { method: "POST", body: "{}" });
    assert(noKey.status === 401, "recompute needs admin key");

    const rec = await req("/v0/admin/ranks/recompute", { method: "POST", admin: true, body: "{}" });
    assert(rec.status === 200 && rec.data.total >= 2, "recomputed");

    const ranks = await req("/v0/ranks?skill=code_review");
    assert(ranks.status === 200, "ranks");
    const items = ranks.data.items as any[];
    const a = items.find((x) => x.did === PROVIDER);
    const b = items.find((x) => x.did === PROVIDER2);
    assert(a && b, "both ranked");
    assert(a.score > b.score, `high ${a.score} > low ${b.score}`);
    assert(a.tier === "explore" || a.completedReleasedCount < 10, "primary still explore if <10");
    assert(b.tier !== "top" || b.completedReleasedCount >= 10, "new/low not top when <10");
    assert(a.factors.disputeRate === 0 && b.factors.disputeRate === 0, "disputeRate 0");

    const sorted = await req("/v0/listings?skill=code_review&sort=rank");
    assert(sorted.status === 200, "sort=rank");
    const ids = sorted.data.items.map((x: any) => x.did);
    const ia = ids.indexOf(PROVIDER);
    const ib = ids.indexOf(PROVIDER2);
    assert(ia >= 0 && ib >= 0 && ia < ib, "listings sort matches ranks");
  });

  console.log("\n[S3-6 preferred badge ≥10]");
  await test("S3-6 preferredBadge when completedReleasedCount>=10", async () => {
    // Create enough released orders on PROVIDER to reach 10 (may already have some)
    const cur = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    let n = Number(cur.data.completedReleasedCount ?? 0);
    let guard = 0;
    while (n < 10 && guard < 12) {
      await createReleased({ feeCap: 8, taskSummary: `s3 preferred fill ${n}` });
      guard++;
      const r = await req("/v0/admin/ranks/recompute", { method: "POST", admin: true, body: "{}" });
      const hit = (r.data.items as any[]).find((x) => x.did === PROVIDER && x.skill === "code_review");
      n = hit?.completedReleasedCount ?? n + 1;
    }
    const rec = await req("/v0/admin/ranks/recompute", { method: "POST", admin: true, body: "{}" });
    const hit = (rec.data.items as any[]).find((x) => x.did === PROVIDER && x.skill === "code_review");
    assert(hit?.completedReleasedCount >= 10, "count>=10 got " + hit?.completedReleasedCount);
    assert(hit?.preferredBadge === true, "preferredBadge");
    const listing = await req(`/v0/listings/${encodeURIComponent(PROVIDER)}`);
    assert(listing.data.preferredBadge === true, "listing preferred");
    // PROVIDER2 should still be under 10
    const lite = (rec.data.items as any[]).find((x) => x.did === PROVIDER2);
    if (lite && lite.completedReleasedCount < 10) {
      assert(lite.preferredBadge === false, "lite no preferred");
      assert(lite.tier !== "top", "lite not top");
    }
  });

  console.log("\n[S3-7 blacklist Confirm/create — no lock]");
  await test("S3-7 blacklist blocks confirm/create; escrow unlocked; wallet unchanged", async () => {
    const walletBefore = await req(`/v0/wallets/${USER}`);
    assert(walletBefore.status === 200, "wallet");
    const balBefore = walletBefore.data.wallet?.balance ?? walletBefore.data.balance;

    const preOrder = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER2,
        feeCap: 9,
        taskSummary: "s3 blacklist target",
        hirerUserId: USER,
      }),
    });
    assert(preOrder.status === 201, "pre order");
    const oid = preOrder.data.order.orderId;

    const noKey = await req("/v0/admin/blacklist", {
      method: "POST",
      body: JSON.stringify({ did: PROVIDER2, reason: "e2e" }),
    });
    assert(noKey.status === 401, "admin key required");

    const bl = await req("/v0/admin/blacklist", {
      method: "POST",
      admin: true,
      body: JSON.stringify({ did: PROVIDER2, reason: "e2e abuse" }),
    });
    assert(bl.status === 201, "blacklisted");

    const confirm = await req(`/v0/orders/${oid}/confirm`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", userId: USER }),
    });
    assert(confirm.status === 403 && confirm.data.code === "BLACKLISTED", "confirm blocked");
    const after = await req(`/v0/orders/${oid}`);
    assert(!after.data.escrow || after.data.escrow.status !== "locked", "no lock");
    assert(after.data.order.status === "quoted", "still quoted");

    const createBlocked = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: PROVIDER2,
        feeCap: 9,
        taskSummary: "s3 create after bl",
        hirerUserId: USER,
      }),
    });
    assert(createBlocked.status === 403 && createBlocked.data.code === "BLACKLISTED", "create blocked");
    const walletAfter = await req(`/v0/wallets/${USER}`);
    const balAfter = walletAfter.data.wallet?.balance ?? walletAfter.data.balance;
    assert(balAfter === balBefore, `balance unchanged ${balBefore}→${balAfter}`);
  });

  console.log("\n[S3-8 self-hire]");
  await test("S3-8 same-owner self-hire blocked", async () => {
    const r = await req("/v0/orders", {
      method: "POST",
      role: "hirer",
      actorId: HIRER,
      body: JSON.stringify({
        providerAgentId: SELF_HIRE,
        feeCap: 10,
        taskSummary: "s3 self hire",
        hirerUserId: USER,
      }),
    });
    assert(r.status === 403 && r.data.code === "SELF_HIRE", "self-hire " + JSON.stringify(r.data));
  });

  console.log("\n[S3-9 dispute N/A]");
  await test("S3-9 no dispute API required; review path works without disputedTag", async () => {
    const r = await req(`/v0/reviews?did=${encodeURIComponent(PROVIDER)}`);
    assert(r.status === 200, "list ok");
    assert(r.data.items?.every((x: any) => x.disputedTag == null), "no disputedTag");
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
