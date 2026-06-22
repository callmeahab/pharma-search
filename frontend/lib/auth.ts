// Auth + watchlist API client. Talks to the Go backend's JSON endpoints
// (separate from the ConnectRPC search API). Session is a bearer token in
// localStorage, sent as Authorization: Bearer <token>.

const TOKEN_KEY = "authToken";

function apiBase(): string {
  if (typeof window === "undefined") return "";
  return process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:50051";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

async function apiFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) {
    const t = getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || `Greška (${res.status})`);
  }
  return data as T;
}

// ---- auth ----
type SessionResp = { token: string; user: AuthUser };

export const authApi = {
  register: (email: string, name: string, password: string) =>
    apiFetch<SessionResp>("/api/auth/register", { body: { email, name, password } }),
  login: (email: string, password: string) =>
    apiFetch<SessionResp>("/api/auth/login", { body: { email, password } }),
  google: (credential: string) =>
    apiFetch<SessionResp>("/api/auth/google", { body: { credential } }),
  magicLink: (email: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/magic-link", { body: { email } }),
  magicConsume: (token: string) =>
    apiFetch<SessionResp>("/api/auth/magic-consume", { body: { token } }),
  passwordReset: (email: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/password-reset", { body: { email } }),
  passwordResetConfirm: (token: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/password-reset/confirm", { body: { token, newPassword } }),
  me: () => apiFetch<{ user: AuthUser }>("/api/auth/me", { auth: true }),
  logout: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST", auth: true }),
  updateProfile: (name: string, email: string) =>
    apiFetch<{ user: AuthUser }>("/api/auth/profile", { body: { name, email }, auth: true }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/password", { body: { currentPassword, newPassword }, auth: true }),
};

// ---- watchlist ----
export interface Watch {
  id: string;
  group_key: string;
  display_name: string;
  thumbnail: string;
  target_price: number | null;
  last_price: number | null;
  last_vendor: string;
  created_at: string;
}

export interface AlertItem {
  kind: string;
  old_price: number | null;
  new_price: number | null;
  vendor: string;
  sent_at: string;
  display_name: string;
  group_key: string;
}

export interface PricePoint {
  min_price: number;
  recorded_at: string;
}

export const watchApi = {
  list: () => apiFetch<{ watches: Watch[] }>("/api/watch", { auth: true }),
  add: (w: { groupKey: string; displayName?: string; thumbnail?: string; price?: number; vendor?: string; targetPrice?: number | null }) =>
    apiFetch<{ id: string; ok: boolean }>("/api/watch", { body: w, auth: true }),
  remove: (groupKey: string) =>
    apiFetch<{ ok: boolean }>("/api/watch/remove", { body: { groupKey }, auth: true }),
  setTarget: (groupKey: string, targetPrice: number | null) =>
    apiFetch<{ ok: boolean }>("/api/watch/target", { body: { groupKey, targetPrice }, auth: true }),
  alerts: () => apiFetch<{ alerts: AlertItem[] }>("/api/alerts", { auth: true }),
  history: (groupKey: string) =>
    apiFetch<{ points: PricePoint[] }>(`/api/watch/history?groupKey=${encodeURIComponent(groupKey)}`, { auth: true }),
};
