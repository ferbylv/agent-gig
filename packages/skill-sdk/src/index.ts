/** Gig Skill SDK — never holds wallet private keys. */
export const SKILL_HOLDS_PRIVATE_KEYS = false as const;

export interface SkillClientOptions {
  baseUrl: string;
  userId: string;
  hirerAgentId: string;
  agentKey?: string;
}

export interface CreateOrderInput {
  providerAgentId: string;
  feeCap: number;
  taskSummary: string;
  taskContext?: string;
  revisions?: number;
  dueAt?: string;
  dueInHours?: number;
  slaHours?: number;
}

async function api<T>(base: string, path: string, init: RequestInit = {}, userId?: string, agentId?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  if (userId) headers["X-Actor-Id"] = userId;
  if (agentId) headers["X-Actor-Role"] = "hirer";
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((data as any).error || res.statusText) as any; e.status = res.status; e.body = data; throw e; }
  return data as T;
}

export function createSkillClient(opts: SkillClientOptions) {
  const { baseUrl, userId, hirerAgentId, agentKey } = opts;
  if (agentKey && /mnemonic|seed|private.?key/i.test(agentKey)) throw new Error("Skill must not accept wallet keys");
  return {
    skillHoldsPrivateKeys: SKILL_HOLDS_PRIVATE_KEYS,
    connect: (registryUrl?: string) => api(baseUrl, "/v0/connect/bind", { method: "POST", body: JSON.stringify({ userId, hirerAgentId, registryUrl }) }, userId, hirerAgentId),
    getBudget: () => api(baseUrl, `/v0/budget?userId=${userId}&hirerAgentId=${hirerAgentId}`, {}, userId, hirerAgentId),
    setBudget: (caps: { totalCap: number; perOrderCap: number; dailyCap: number }) => api(baseUrl, "/v0/budget", { method: "PUT", body: JSON.stringify({ userId, hirerAgentId, ...caps }) }, userId, hirerAgentId),
    createOrder: (input: CreateOrderInput) =>
      api(baseUrl, "/v0/orders", { method: "POST", body: JSON.stringify({ ...input, hirerUserId: userId, hirerAgentId }) }, userId, hirerAgentId),
    confirm: (orderId: string, decision: "approve" | "reject") => api(baseUrl, `/v0/orders/${orderId}/confirm`, { method: "POST", body: JSON.stringify({ decision, userId }) }, userId, hirerAgentId),
    getEscrow: (id: string) => api(baseUrl, `/v0/escrow/${id}`),
    exportAudit: async (format: "json" | "csv" = "json") => { const r = await fetch(`${baseUrl}/v0/audit/export?format=${format}`); return format === "csv" ? r.text() : r.json(); },
  };
}

export type SkillClient = ReturnType<typeof createSkillClient>;
