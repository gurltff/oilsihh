const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string, params?: Record<string, string | number | undefined>) => {
    const qs = params
      ? "?" + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
      : "";
    return req<T>(path + qs);
  },
  post: <T,>(path: string, body: unknown) =>
    req<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    req<T>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  upload: <T,>(path: string, form: FormData) => req<T>(path, { method: "POST", body: form }),
  url: (path: string) => BASE + path,
};

/** LocalStorage cache so the driller's field view keeps working with no connectivity. */
export const cache = {
  set(key: string, value: unknown) {
    try { localStorage.setItem("nwis:" + key, JSON.stringify({ t: Date.now(), value })); } catch { /* quota / private mode */ }
  },
  get<T>(key: string): { t: number; value: T } | null {
    try { const s = localStorage.getItem("nwis:" + key); return s ? JSON.parse(s) : null; } catch { return null; }
  },
};

/** Fetch with LocalStorage fallback; returns [data, fromCache]. */
export async function cachedGet<T>(key: string, path: string, params?: Record<string, string | number | undefined>): Promise<[T, boolean]> {
  try {
    const v = await api.get<T>(path, params);
    cache.set(key, v);
    return [v, false];
  } catch (e) {
    const c = cache.get<T>(key);
    if (c) return [c.value, true];
    throw e;
  }
}
