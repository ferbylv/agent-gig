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
