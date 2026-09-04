const BASE = import.meta.env.VITE_API_BASE ?? "";

export async function api<T = any>(
  path: string,
  opts: RequestInit & { role?: string; actorId?: string } = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (opts.role) headers.set("X-Actor-Role", opts.role);
  if (opts.actorId) headers.set("X-Actor-Id", opts.actorId);
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? res.statusText) as Error & { status: number; code?: string; data: any };
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data as T;
}
