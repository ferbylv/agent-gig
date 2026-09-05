/** Agent Gig V0.5 shared types */

export type ListingStatus = "active" | "paused" | "revoked";
export type ProviderType = "individual" | "studio";
export type Currency = "GigUSD";

export type OrderStatus =
  | "draft"
  | "quoted"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "revision_requested"
  | "accepted_done"
  | "released"
  | "rejected"
  | "cancelled";

export type EscrowStatus = "open" | "locked" | "released" | "refunded" | "frozen";

export type ActorRole = "user" | "hirer" | "provider" | "admin";

export const SKILL_VERTICALS = ["code_review", "design_illustration"] as const;
export type SkillVertical = (typeof SKILL_VERTICALS)[number];

/** Platform default free revisions when create omits the field (V0.5-S1: was 0). */
export const REVISIONS_DEFAULT = 1;
/** S1 hard cap: create clamps revisions to this max (UI is read-only 1). Values > max are clamped, not rejected. */
export const REVISIONS_MAX = 1;

export interface Provider {
  providerId: string;
  legalName: string;
  type: ProviderType;
}

export interface Capability {
  id: string;
  title: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  notes?: string;
}

export interface PricingModel {
  type: "per_call" | "per_token" | "package";
  price?: string;
  pricePer1k?: string;
  cap?: string;
  unitLabel?: string;
  name?: string;
  includes?: string[];
}

export interface Pricing {
  currency: Currency;
  models: PricingModel[];
  busyRules?: unknown;
}

export interface PermissionNeed {
  code: string;
  scope?: string;
  reason?: string;
}

export interface PassportCard {
  did: string;
  displayName: string;
  tagline: string;
  skills: string[];
  capabilities: Capability[];
  endpoints: Record<string, string>;
  owner: { userId: string; orgId?: string };
  version: string;
  updatedAt: string;
  pubkey: string;
  signature: string;
  trustHints?: Record<string, unknown>;
  limits?: string[] | Record<string, unknown>;
  avatar?: string;
  qrPayload?: string;
  pricing: Pricing;
  provider: Provider;
  permissionNeeds: PermissionNeed[];
  portfolioRef?: string;
  stats?: Record<string, unknown>;
  listingStatus: ListingStatus;
}

export interface BudgetConfig {
  userId: string;
  hirerAgentId: string;
  totalCap: number;
  perOrderCap: number;
  dailyCap: number;
  usedTotal: number;
  usedDaily: number;
  dailyResetDate: string; // YYYY-MM-DD UTC
  confirmedProviders: string[]; // providerAgentIds with successful Confirm
}

export interface OrderParties {
  hirerUserId: string;
  hirerAgentId: string;
  providerAgentId: string;
  providerId: string;
}

export interface Order {
  orderId: string;
  status: OrderStatus;
  task: { summary: string; context?: string; attachments?: string[] };
  deliverables: Array<Record<string, unknown>>;
  acceptance: {
    type: "auto" | "semi" | "subjective";
    requireHumanSignoff: boolean;
    criteria?: string;
  };
  pricing: { currency: Currency; feeCap: number; quotedAmount?: number };
  sla: { dueAt: string; responseMinutes?: number };
  revisions: number;
  revisionsRemaining: number;
  permissionsGranted: PermissionNeed[];
  permissionsDenied: string[];
  escrowId?: string;
  paymentRef?: string;
  parties: OrderParties;
  timestamps: Partial<Record<OrderStatus | "created", string>>;
  confirmRequired: boolean;
  confirmStatus?: "pending" | "approved" | "rejected";
  confirmPayload?: ConfirmPayload;
  deliveryPayload?: Record<string, unknown>;
  riskFlags?: string[];
  /** Optional note from last revise request */
  revisionNote?: string;
  /** Set on acceptance.satisfied (V0.5-S2); defaults both false */
  portfolioConsent?: PortfolioConsent;
  /** Linked verified_order PortfolioItem when created */
  portfolioItemId?: string;
}

export interface ConfirmPayload {
  provider: Provider;
  agentDisplayName: string;
  agentDid: string;
  verifyStatus: "verified" | "failed" | "unknown";
  taskSummary: string;
  permissionsAllowed: PermissionNeed[];
  permissionsDenied: string[];
  feeCap: number;
  currency: Currency;
  sla: { dueAt: string; revisions: number; acceptanceType: string };
}

export interface Escrow {
  escrowId: string;
  orderId: string;
  amount: number;
  currency: Currency;
  status: EscrowStatus;
  feeBps: number; // 1000 = 10%
  lockedAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  hirerUserId: string;
  providerId: string;
}

export interface Wallet {
  ownerId: string; // userId or providerId
  ownerType: "user" | "provider" | "platform";
  balance: number;
  currency: Currency;
}

export interface LedgerLine {
  id: string;
  at: string;
  kind: "lock" | "release" | "refund" | "fee" | "deposit" | "budget_reject" | "confirm";
  amount: number;
  currency: Currency;
  orderId?: string;
  escrowId?: string;
  from?: string;
  to?: string;
  note?: string;
  meta?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorRole: ActorRole;
  actorId: string;
  action: string;
  orderId?: string;
  amount?: number;
  counterpart?: string;
  permissions?: PermissionNeed[];
  detail?: Record<string, unknown>;
}

export interface ConnectBinding {
  userId: string;
  hirerAgentId: string;
  registryUrl: string;
  boundAt: string;
}

export const TAKE_RATE_BPS = 1000; // 10%
export const ADMIN_KEY_DEFAULT = "dev-admin-key-v0";

/** Portfolio / consent (V0.5-S2) */
export const PORTFOLIO_SOURCES = ["verified_order", "self_reported", "curated"] as const;
export type PortfolioSource = (typeof PORTFOLIO_SOURCES)[number];

export const MODERATION_STATUSES = ["visible", "taken_down", "pending"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export interface PortfolioConsent {
  publicPortfolio: boolean;
  homepage: boolean;
  decidedAt: string;
  revokedAt?: string;
}

export interface PortfolioMedia {
  url: string;
  kind?: "image" | "link" | "text";
  caption?: string;
}

export interface PortfolioItem {
  itemId: string;
  did: string;
  source: PortfolioSource;
  orderId?: string;
  summary: string;
  media: PortfolioMedia[];
  consent: PortfolioConsent;
  moderationStatus: ModerationStatus;
  /** Low-trust hint for self_reported (always true for that source) */
  lowTrust?: boolean;
  createdAt: string;
  updatedAt: string;
  takedownReason?: string;
}

/** Defaults: never server-default true */
export function defaultPortfolioConsent(decidedAt: string): PortfolioConsent {
  return {
    publicPortfolio: false,
    homepage: false,
    decidedAt,
  };
}

export function isPortfolioSource(v: unknown): v is PortfolioSource {
  return typeof v === "string" && (PORTFOLIO_SOURCES as readonly string[]).includes(v);
}

export function isModerationStatus(v: unknown): v is ModerationStatus {
  return typeof v === "string" && (MODERATION_STATUSES as readonly string[]).includes(v);
}

/** Public list visibility: consent allows publicPortfolio, not revoked, moderation visible */
export function isPubliclyVisiblePortfolioItem(item: PortfolioItem): boolean {
  if (item.moderationStatus !== "visible") return false;
  if (!item.consent.publicPortfolio) return false;
  if (item.consent.revokedAt) return false;
  return true;
}

/** Review / Rank / Blacklist (V0.5-S3) */

export const REVIEW_SCORE_DIMS = [
  "quality",
  "communication",
  "punctuality",
  "permissionHonesty",
] as const;
export type ReviewScoreDim = (typeof REVIEW_SCORE_DIMS)[number];

export interface ReviewScores {
  quality: number;
  communication: number;
  punctuality: number;
  permissionHonesty: number;
}

export interface ProviderReply {
  text: string;
  repliedAt: string;
}

/**
 * Review entity. orderId is UNIQUE — one primary review per order (no DELETE).
 * disputedTag intentionally omitted (V1).
 */
export interface Review {
  reviewId: string;
  /** Unique: at most one review per order */
  orderId: string;
  hirerUserId: string;
  hirerAgentId: string;
  providerDid: string;
  scores: ReviewScores;
  comment?: string;
  createdAt: string;
  /** At most one reply; no edit/delete of hirer review */
  providerReply?: ProviderReply;
}

export const REVIEW_COMMENT_MAX = 500;
export const REVIEW_REPLY_MAX = 500;

/** Frozen S3 rank weights (PRD §12.3) */
export const RANK_WEIGHTS_DEFAULT = {
  w1: 0.25, // completionRate
  w2: 0.35, // avgMultiDimScore
  w3: 0.15, // repurchaseRate
  w4: 0.1, // responseSpeedNorm
  w5: 0.15, // disputeRate (subtracted)
} as const;

export type RankWeights = {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
};

/** Preferred badge threshold (completed released orders) */
export const PREFERRED_COMPLETED_N = 10;
/** New accounts with fewer completed orders cannot enter tier=top */
export const TOP_TIER_MIN_COMPLETED = 10;

export type RankTier = "top" | "explore";

export interface RankFactors {
  completionRate: number;
  avgMultiDimScore: number;
  repurchaseRate: number;
  responseSpeedNorm: number;
  /** No dispute data in S3 → 0 */
  disputeRate: number;
  /** Default 0; self-hire blocked separately */
  sybilPenalty: number;
}

export interface RankScore {
  did: string;
  skill: string;
  score: number;
  factors: RankFactors;
  completedReleasedCount: number;
  preferredBadge: boolean;
  bondStub?: boolean;
  tier: RankTier;
  updatedAt: string;
}

export interface BlacklistEntry {
  id: string;
  did?: string;
  userId?: string;
  providerId?: string;
  reason: string;
  createdAt: string;
  expiresAt?: string;
}

export interface ReviewSummary {
  count: number;
  avgQuality: number;
  avgCommunication: number;
  avgPunctuality: number;
  avgPermissionHonesty: number;
  /** Mean of four dim averages (0 if empty) */
  avgOverall: number;
}

export function isValidReviewScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

export function parseReviewScores(raw: unknown): ReviewScores | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const scores: Partial<ReviewScores> = {};
  for (const dim of REVIEW_SCORE_DIMS) {
    if (!isValidReviewScore(o[dim])) return null;
    scores[dim] = o[dim] as number;
  }
  return scores as ReviewScores;
}

export function avgMultiDimScore(scores: ReviewScores): number {
  return (
    (scores.quality +
      scores.communication +
      scores.punctuality +
      scores.permissionHonesty) /
    4
  );
}

/** Normalize 1–5 average to 0–1 for rank formula */
export function normalizeAvgToUnit(avg1to5: number): number {
  if (avg1to5 <= 0) return 0;
  return Math.min(1, Math.max(0, (avg1to5 - 1) / 4));
}

/**
 * score = w1*completionRate + w2*avgMultiDim(0-1) + w3*repurchaseRate
 *       + w4*responseSpeedNorm - w5*disputeRate - sybilPenalty
 */
export function computeRankNumeric(
  factors: RankFactors,
  weights: RankWeights = RANK_WEIGHTS_DEFAULT
): number {
  // avgMultiDimScore is on 1–5 scale (0 when no reviews → contributes 0)
  const avgUnit = normalizeAvgToUnit(factors.avgMultiDimScore);
  return (
    weights.w1 * clamp01(factors.completionRate) +
    weights.w2 * avgUnit +
    weights.w3 * clamp01(factors.repurchaseRate) +
    weights.w4 * clamp01(factors.responseSpeedNorm) -
    weights.w5 * clamp01(factors.disputeRate) -
    (factors.sybilPenalty || 0)
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function summarizeReviews(reviews: Review[]): ReviewSummary {
  const count = reviews.length;
  if (count === 0) {
    return {
      count: 0,
      avgQuality: 0,
      avgCommunication: 0,
      avgPunctuality: 0,
      avgPermissionHonesty: 0,
      avgOverall: 0,
    };
  }
  let q = 0,
    c = 0,
    p = 0,
    h = 0;
  for (const r of reviews) {
    q += r.scores.quality;
    c += r.scores.communication;
    p += r.scores.punctuality;
    h += r.scores.permissionHonesty;
  }
  const avgQuality = q / count;
  const avgCommunication = c / count;
  const avgPunctuality = p / count;
  const avgPermissionHonesty = h / count;
  const avgOverall =
    (avgQuality + avgCommunication + avgPunctuality + avgPermissionHonesty) / 4;
  return {
    count,
    avgQuality,
    avgCommunication,
    avgPunctuality,
    avgPermissionHonesty,
    avgOverall,
  };
}

export function resolveRankTier(
  completedReleasedCount: number,
  score: number,
  minCompleted = TOP_TIER_MIN_COMPLETED
): RankTier {
  if (completedReleasedCount < minCompleted) return "explore";
  // Simple: top if completed enough and score in upper band; otherwise explore
  if (score >= 0.55) return "top";
  return "explore";
}

export function preferredBadgeFor(completedReleasedCount: number, n = PREFERRED_COMPLETED_N): boolean {
  return completedReleasedCount >= n;
}
