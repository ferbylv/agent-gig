import * as ed from "@noble/ed25519";

/** Canonical JSON for passport signing (stable key order, no signature field). */
export function canonicalizePassport(card: Record<string, unknown>): string {
  // Exclude signature + platform-managed fields so revoke/pause/stats updates do not break owner signatures.
  const {
    signature: _sig,
    listingStatus: _ls,
    stats: _stats,
    qrPayload: _qr,
    updatedAt: _ua,
    ...rest
  } = card;
  return stableStringify(rest);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function generateKeypair(): Promise<{ publicKey: string; secretKey: string }> {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { publicKey: toHex(publicKey), secretKey: toHex(secretKey) };
}

export async function signPassport(
  card: Record<string, unknown>,
  secretKeyHex: string
): Promise<string> {
  const msg = new TextEncoder().encode(canonicalizePassport(card));
  const sig = await ed.signAsync(msg, fromHex(secretKeyHex));
  return toHex(sig);
}

export async function verifyPassport(card: Record<string, unknown>): Promise<boolean> {
  try {
    const pubkey = String(card.pubkey ?? "");
    const signature = String(card.signature ?? "");
    if (!pubkey || !signature) return false;
    const msg = new TextEncoder().encode(canonicalizePassport(card));
    return await ed.verifyAsync(fromHex(signature), msg, fromHex(pubkey));
  } catch {
    return false;
  }
}

export function shortUri(did: string, webBase = "http://localhost:5173"): { agentpass: string; http: string } {
  return {
    agentpass: `agentpass://v0/${did}`,
    http: `${webBase}/a/${did}`,
  };
}
