import * as SecureStore from "expo-secure-store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "courier_driver_token";

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

export const api = {
  login: (email: string, password: string) =>
    request<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  registerDriverApplicant: (email: string, password: string) =>
    request<Session>("/v1/auth/register/driver", { method: "POST", body: JSON.stringify({ email, password }) }),

  getMyProfile: () => request<any>("/v1/drivers/me"),

  addVehicle: (body: { type: "SEDAN" | "VAN"; plate: string; capacityWeightKg: number; capacityVolumeL: number }) =>
    request<any>("/v1/drivers/me/vehicles", { method: "POST", body: JSON.stringify(body) }),

  addDocument: (body: { docType: "LICENSE" | "INSURANCE" | "REGISTRATION"; fileRef: string }) =>
    request<any>("/v1/drivers/me/documents", { method: "POST", body: JSON.stringify(body) }),

  setOnline: (online: boolean) =>
    request<any>("/v1/drivers/me/online", { method: "POST", body: JSON.stringify({ online }) }),

  acceptOffer: (offerId: string) =>
    request<any>(`/v1/driver-offers/${offerId}/accept`, {
      method: "POST",
      headers: { "Idempotency-Key": `accept-${offerId}-${Date.now()}` },
      body: JSON.stringify({}),
    }),

  declineOffer: (offerId: string) =>
    request<any>(`/v1/driver-offers/${offerId}/decline`, { method: "POST", body: JSON.stringify({}) }),

  getOffers: () => request<any[]>("/v1/drivers/me/offers"),

  verifyPickup: (
    orderId: string,
    body: {
      driverLocation: { lat: number; lng: number };
      pickupLocation: { lat: number; lng: number };
      driverSelfieRef: string;
      packagePhotoRefs: string[];
      senderName: string;
      pinUsed: boolean;
    }
  ) =>
    request<any>(`/v1/orders/${orderId}/pickup/verify`, {
      method: "POST",
      headers: { "Idempotency-Key": `pickup-${orderId}-${Date.now()}` },
      body: JSON.stringify(body),
    }),

  verifyDelivery: (
    orderId: string,
    body: {
      driverLocation: { lat: number; lng: number };
      dropoffLocation: { lat: number; lng: number };
      outcome: "DELIVERED" | "FAILED";
      podPhotoRef?: string;
      recipientName?: string;
      pinUsed?: boolean;
      contactless: boolean;
      failureReason?: string;
    }
  ) =>
    request<any>(`/v1/orders/${orderId}/delivery/verify`, {
      method: "POST",
      headers: { "Idempotency-Key": `delivery-${orderId}-${Date.now()}` },
      body: JSON.stringify(body),
    }),

  getEarnings: () => request<any[]>("/v1/drivers/me/earnings"),

  postLocation: (lat: number, lng: number, orderId?: string) =>
    request<any>("/v1/drivers/me/location", { method: "POST", body: JSON.stringify({ lat, lng, orderId }) }),
};
