import {
  generateKeypair,
  signPassport,
  shortUri,
  TAKE_RATE_BPS,
  type PassportCard,
} from "@agent-gig/shared";
import { budgetKey, getDb, nowIso, saveDb, todayUtc } from "./store.js";

export const SEED = {
  adminKey: "dev-admin-key-v0",
  userId: "user_demo",
  hirerAgentId: "agent_hirer_demo",
  providerAgentId: "did:ag:code-reviewer-01",
  providerId: "provider_studio_alpha",
  providerLegalName: "Alpha Code Studio",
};

export async function seedAll(force = false): Promise<void> {
  const db = getDb();
  if (db.meta.seededAt && !force) return;

  db.adminKey = SEED.adminKey;
  db.passports = {};
  db.passportSecrets = {};
  db.budgets = {};
  db.orders = {};
  db.escrows = {};
  db.wallets = {};
  db.ledger = [];
  db.audit = [];
  db.connects = {};
  db.portfolio = {};
  db.reviews = {};
  db.ranks = {};
  db.blacklist = [];
  db.rankWeights = { w1: 0.25, w2: 0.35, w3: 0.15, w4: 0.1, w5: 0.15 };

  const kp = await generateKeypair();
  const did = SEED.providerAgentId;
  const uris = shortUri(did);

  const card: PassportCard = {
    did,
    displayName: "CodeReview Pro",
    tagline: "专业 PR 代码审查 · 安全与可读性并重",
    skills: ["code_review"],
    capabilities: [
      {
        id: "code_review_pr",
        title: "PR 代码审查",
        inputSchema: { type: "object", required: ["repoUrl", "prNumber"] },
        outputSchema: { type: "object", required: ["reportMarkdown", "severity"] },
        notes: "不直接 push；仅输出审查报告",
      },
    ],
    endpoints: { messaging: "msg:code-reviewer-01", webhook: "https://example.invalid/hook" },
    owner: { userId: "user_provider_alpha", orgId: "org_alpha" },
    version: "1.0.0",
    updatedAt: nowIso(),
    pubkey: kp.publicKey,
    signature: "",
    limits: ["不直接 push", "不接触生产密钥"],
    pricing: {
      currency: "GigUSD",
      models: [{ type: "per_call", price: "20.00", unitLabel: "次" }],
    },
    provider: {
      providerId: SEED.providerId,
      legalName: SEED.providerLegalName,
      type: "studio",
    },
    permissionNeeds: [
      { code: "repo.clone", scope: "read", reason: "克隆仓库只读审查" },
      { code: "repo.comment", scope: "pr", reason: "可选写 PR 评论" },
    ],
    stats: {
      completedOrders: 0,
      completionRate: 0,
      avgScores: { quality: 0, communication: 0, punctuality: 0, permissionHonesty: 0 },
      disputeRate: 0,
      avgResponseMinutes: null,
      repurchaseRate: 0,
      updatedAt: nowIso(),
    },
    listingStatus: "active",
    qrPayload: uris.agentpass,
  };

  card.signature = await signPassport(card as unknown as Record<string, unknown>, kp.secretKey);
  db.passports[did] = card;
  db.passportSecrets[did] = kp.secretKey;

  // optional second vertical enum seed (paused, for search enum presence)
  const kp2 = await generateKeypair();
  const did2 = "did:ag:design-illustrator-01";
  const card2: PassportCard = {
    ...card,
    did: did2,
    displayName: "Ink & Frame",
    tagline: "克制插画与视觉概念出图",
    skills: ["design_illustration"],
    capabilities: [
      {
        id: "design_concept",
        title: "概念插画",
        notes: "交付源文件与预览图",
      },
    ],
    pubkey: kp2.publicKey,
    signature: "",
    version: "1.0.0",
    listingStatus: "paused",
    provider: {
      providerId: "provider_ink",
      legalName: "Ink Frame Studio",
      type: "studio",
    },
    qrPayload: shortUri(did2).agentpass,
  };
  card2.signature = await signPassport(card2 as unknown as Record<string, unknown>, kp2.secretKey);
  db.passports[did2] = card2;
  db.passportSecrets[did2] = kp2.secretKey;

  // Second active code_review provider (S3 rank / sort comparison)
  const kp3 = await generateKeypair();
  const did3 = "did:ag:code-reviewer-02";
  const card3: PassportCard = {
    ...card,
    did: did3,
    displayName: "Review Lite",
    tagline: "轻量 PR 审查 · 探索档",
    skills: ["code_review"],
    pubkey: kp3.publicKey,
    signature: "",
    version: "1.0.0",
    listingStatus: "active",
    provider: {
      providerId: "provider_lite",
      legalName: "Lite Review Co",
      type: "individual",
    },
    owner: { userId: "user_provider_lite" },
    qrPayload: shortUri(did3).agentpass,
    stats: {
      completedOrders: 0,
      completionRate: 0,
      avgScores: { quality: 0, communication: 0, punctuality: 0, permissionHonesty: 0 },
      disputeRate: 0,
      avgResponseMinutes: null,
      repurchaseRate: 0,
      updatedAt: nowIso(),
    },
  };
  card3.signature = await signPassport(card3 as unknown as Record<string, unknown>, kp3.secretKey);
  db.passports[did3] = card3;
  db.passportSecrets[did3] = kp3.secretKey;
  db.wallets["provider_lite"] = {
    ownerId: "provider_lite",
    ownerType: "provider",
    balance: 0,
    currency: "GigUSD",
  };

  // Preferred-demo: same owner as hirer for self-hire e2e (user_demo)
  const kp4 = await generateKeypair();
  const did4 = "did:ag:self-hire-trap";
  const card4: PassportCard = {
    ...card,
    did: did4,
    displayName: "Self Hire Trap",
    tagline: "同主人自雇检测样本",
    skills: ["code_review"],
    pubkey: kp4.publicKey,
    signature: "",
    version: "1.0.0",
    listingStatus: "active",
    provider: {
      providerId: "provider_self",
      legalName: "Demo Self Provider",
      type: "individual",
    },
    owner: { userId: SEED.userId }, // same as hirer → self-hire
    qrPayload: shortUri(did4).agentpass,
  };
  card4.signature = await signPassport(card4 as unknown as Record<string, unknown>, kp4.secretKey);
  db.passports[did4] = card4;
  db.passportSecrets[did4] = kp4.secretKey;
  db.wallets["provider_self"] = {
    ownerId: "provider_self",
    ownerType: "provider",
    balance: 0,
    currency: "GigUSD",
  };

  db.connects[SEED.hirerAgentId] = {
    userId: SEED.userId,
    hirerAgentId: SEED.hirerAgentId,
    registryUrl: "http://localhost:8787",
    boundAt: nowIso(),
  };

  db.budgets[budgetKey(SEED.userId, SEED.hirerAgentId)] = {
    userId: SEED.userId,
    hirerAgentId: SEED.hirerAgentId,
    totalCap: 100,
    perOrderCap: 30,
    dailyCap: 50,
    usedTotal: 0,
    usedDaily: 0,
    dailyResetDate: todayUtc(),
    confirmedProviders: [],
  };

  db.wallets[SEED.userId] = {
    ownerId: SEED.userId,
    ownerType: "user",
    balance: 200,
    currency: "GigUSD",
  };
  db.wallets[SEED.providerId] = {
    ownerId: SEED.providerId,
    ownerType: "provider",
    balance: 0,
    currency: "GigUSD",
  };
  db.wallets["platform"] = {
    ownerId: "platform",
    ownerType: "platform",
    balance: 0,
    currency: "GigUSD",
  };

  db.ledger.push({
    id: "led_seed_deposit",
    at: nowIso(),
    kind: "deposit",
    amount: 200,
    currency: "GigUSD",
    to: SEED.userId,
    note: "Seed GigUSD funding",
  });

  // S2 demo: one curated portfolio item (visible when publicPortfolio)
  const curatedAt = nowIso();
  db.portfolio["pi_seed_curated"] = {
    itemId: "pi_seed_curated",
    did,
    source: "curated",
    summary: "多仓依赖升级风险批注（平台抽检精选样本）",
    media: [],
    consent: { publicPortfolio: true, homepage: false, decidedAt: curatedAt },
    moderationStatus: "visible",
    lowTrust: false,
    createdAt: curatedAt,
    updatedAt: curatedAt,
  };

  db.meta.seededAt = nowIso();
  saveDb();
  console.log("[seed] ready", { did, takeRateBps: TAKE_RATE_BPS, adminKey: SEED.adminKey });
}
