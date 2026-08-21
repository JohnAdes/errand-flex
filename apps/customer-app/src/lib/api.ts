import * as SecureStore from "expo-secure-store";

// Points at the API server's LAN address for physical-device testing, or
// localhost for a simulator on the same machine. Update this for your setup
// — Expo Go on a physical phone cannot reach "localhost" (that's the phone
// itself), it needs your computer's LAN IP, e.g. http://192.168.1.50:4000.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

const TOKEN_KEY = "courier_customer_token";

export async function saveToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }

  return res.json() as Promise<T>;
}

export interface Session {
  token: string;
  userId: string;
  role: string;
}

export interface QuoteResponse {
  id: string;
  totalCents: number;
  currency: string;
  breakdown: Array<{ label: string; amountCents: number }>;
  distanceKm: number;
  expiresAt: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  registerCustomer: (email: string, password: string, displayName: string) =>
    request<Session>("/v1/auth/register/customer", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),

  getQuote: (params: {
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
    serviceLevel: "ECONOMY" | "STANDARD" | "PRIORITY" | "SCHEDULED";
    totalWeightKg: number;
    packageCount: number;
  }) => request<QuoteResponse>("/v1/quotes", { method: "POST", body: JSON.stringify(params) }),

  createOrder: (body: unknown, idempotencyKey: string) =>
    request<any>("/v1/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    }),

  listOrders: () => request<any[]>("/v1/orders"),

  getOrder: (id: string) => request<any>(`/v1/orders/${id}`),

  payForOrder: (orderId: string) =>
    request<any>(`/v1/orders/${orderId}/pay`, {
      method: "POST",
      headers: { "Idempotency-Key": `pay-${orderId}` },
      body: JSON.stringify({}),
    }),

  getTracking: (orderId: string) => request<any>(`/v1/orders/${orderId}/tracking`),

  createClaim: (orderId: string, body: { type: string; description: string }) =>
    request<any>(`/v1/orders/${orderId}/claims`, { method: "POST", body: JSON.stringify(body) }),

  getClaims: (orderId: string) => request<any[]>(`/v1/orders/${orderId}/claims`),

  submitRating: (orderId: string, body: { value: number; comment?: string }) =>
    request<any>(`/v1/orders/${orderId}/ratings`, { method: "POST", body: JSON.stringify(body) }),

  getRatings: (orderId: string) => request<any[]>(`/v1/orders/${orderId}/ratings`),
};
