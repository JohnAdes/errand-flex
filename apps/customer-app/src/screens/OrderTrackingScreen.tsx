import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from "react-native";
import { api, ApiError } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  SCHEDULED: "Scheduled",
  SEARCHING_FOR_DRIVER: "Finding you a driver",
  DRIVER_OFFERED: "Offering to drivers",
  DRIVER_ASSIGNED: "Driver assigned",
  DRIVER_EN_ROUTE_TO_PICKUP: "Driver en route to pickup",
  DRIVER_ARRIVED_AT_PICKUP: "Driver arrived at pickup",
  PICKUP_VERIFICATION_IN_PROGRESS: "Confirming pickup",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  ARRIVED_AT_DESTINATION: "Driver arrived at destination",
  DELIVERY_VERIFICATION_IN_PROGRESS: "Confirming delivery",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery attempt failed",
  CANCELED: "Canceled",
};

const CLAIM_TYPES = ["DAMAGED", "LOST", "LATE", "WRONG_ITEM", "BILLING", "OTHER"] as const;

export function OrderTrackingScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<any | null>(null);
  const [tracking, setTracking] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimType, setClaimType] = useState<(typeof CLAIM_TYPES)[number]>("DAMAGED");
  const [claimDescription, setClaimDescription] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSubmitted, setClaimSubmitted] = useState(false);

  const [ratingValue, setRatingValue] = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getOrder(orderId);
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this order");
    }
  }, [orderId]);

  const loadTracking = useCallback(async () => {
    try {
      const data = await api.getTracking(orderId);
      setTracking(data);
    } catch {
      // Tracking is a nice-to-have overlay on top of order status — a failed
      // fetch shouldn't break the rest of the screen.
    }
  }, [orderId]);

  useEffect(() => {
    load();
    loadTracking();
    // Simple polling for live-ish status; swap for a websocket/SSE subscription
    // in production (see 02-architecture.md §9 Notifications).
    const interval = setInterval(() => {
      load();
      loadTracking();
    }, 4000);
    return () => clearInterval(interval);
  }, [load, loadTracking]);

  async function handlePay() {
    setPaying(true);
    setPayError(null);
    try {
      await api.payForOrder(orderId);
      await load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Payment failed — try again");
    } finally {
      setPaying(false);
    }
  }

  async function handleSubmitRating() {
    if (ratingValue < 1) {
      setRatingError("Tap a star to rate your driver");
      return;
    }
    setRatingSubmitting(true);
    setRatingError(null);
    try {
      await api.submitRating(orderId, { value: ratingValue });
      setRatingSubmitted(true);
    } catch (err) {
      setRatingError(err instanceof ApiError ? err.message : "Couldn't submit — try again");
    } finally {
      setRatingSubmitting(false);
    }
  }

  async function handleSubmitClaim() {
    if (!claimDescription.trim()) {
      setClaimError("Describe what happened");
      return;
    }
    setClaimSubmitting(true);
    setClaimError(null);
    try {
      await api.createClaim(orderId, { type: claimType, description: claimDescription.trim() });
      setClaimSubmitted(true);
      setClaimOpen(false);
    } catch (err) {
      setClaimError(err instanceof ApiError ? err.message : "Couldn't submit — try again");
    } finally {
      setClaimSubmitting(false);
    }
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.linkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.linkText}>← New delivery</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STATUS_LABELS[order.status] ?? order.status}</Text>
      <Text style={styles.subtitle}>Order #{order.id.slice(0, 8)}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Total</Text>
        <Text style={styles.cardValue}>${((order.totalCents ?? 0) / 100).toFixed(2)}</Text>
      </View>

      {order.status === "AWAITING_PAYMENT" && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Payment required before dispatch can start</Text>
          {payError && <Text style={styles.error}>{payError}</Text>}
          <TouchableOpacity style={styles.button} onPress={handlePay} disabled={paying}>
            {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pay now</Text>}
          </TouchableOpacity>
        </View>
      )}

      {tracking?.trackable && tracking.lastLocation && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Live driver location</Text>
          <Text style={styles.cardValue}>
            {tracking.lastLocation.lat.toFixed(4)}, {tracking.lastLocation.lng.toFixed(4)}
          </Text>
          <Text style={styles.cardMeta}>Updated {new Date(tracking.lastLocation.recordedAt).toLocaleTimeString()}</Text>
        </View>
      )}

      {order.pickupVerification && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Pickup confirmed</Text>
          <Text style={styles.cardValue}>{new Date(order.pickupVerification.verifiedAt).toLocaleTimeString()}</Text>
        </View>
      )}

      {order.deliveryVerification?.outcome === "DELIVERED" && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Delivered</Text>
          <Text style={styles.cardValue}>{new Date(order.deliveryVerification.verifiedAt).toLocaleTimeString()}</Text>
        </View>
      )}

      {order.status === "DELIVERED" && (
        <View style={styles.card}>
          {ratingSubmitted ? (
            <Text style={styles.cardLabel}>Thanks for rating your driver!</Text>
          ) : (
            <>
              <Text style={styles.cardLabel}>Rate your driver</Text>
              <View style={styles.row}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setRatingValue(n)}>
                    <Text style={n <= ratingValue ? styles.starFilled : styles.starEmpty}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {ratingError && <Text style={styles.error}>{ratingError}</Text>}
              <TouchableOpacity style={styles.button} onPress={handleSubmitRating} disabled={ratingSubmitting}>
                {ratingSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit rating</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {(order.status === "DELIVERED" || order.status === "DELIVERY_FAILED") && !claimSubmitted && (
        <View style={styles.card}>
          {!claimOpen ? (
            <TouchableOpacity onPress={() => setClaimOpen(true)}>
              <Text style={styles.linkText}>Report a problem with this delivery</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.cardLabel}>What went wrong?</Text>
              <View style={styles.row}>
                {CLAIM_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.pill, claimType === t && styles.pillActive]}
                    onPress={() => setClaimType(t)}
                  >
                    <Text style={[styles.pillText, claimType === t && styles.pillTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Describe what happened"
                value={claimDescription}
                onChangeText={setClaimDescription}
                multiline
              />
              {claimError && <Text style={styles.error}>{claimError}</Text>}
              <TouchableOpacity style={styles.button} onPress={handleSubmitClaim} disabled={claimSubmitting}>
                {claimSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {claimSubmitted && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Claim submitted — our team will review it.</Text>
        </View>
      )}

      <Text style={styles.hint}>Refreshing automatically every few seconds…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  center: { justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1e293b", marginTop: 16 },
  subtitle: { color: "#94a3b8", marginBottom: 20 },
  card: { backgroundColor: "#f8fafc", borderRadius: 12, padding: 16, marginBottom: 12 },
  cardLabel: { fontSize: 12, color: "#64748b" },
  cardValue: { fontSize: 18, fontWeight: "600", color: "#1e293b", marginTop: 2 },
  cardMeta: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  linkText: { color: "#3454d1", fontSize: 14, fontWeight: "600" },
  error: { color: "#dc2626", marginBottom: 12 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 20, textAlign: "center" },
  button: { backgroundColor: "#3454d1", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 10 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: "#cbd5e1" },
  pillActive: { backgroundColor: "#3454d1", borderColor: "#3454d1" },
  pillText: { color: "#475569", fontSize: 12, fontWeight: "600" },
  pillTextActive: { color: "#fff" },
  starFilled: { fontSize: 32, color: "#f59e0b", marginRight: 6 },
  starEmpty: { fontSize: 32, color: "#cbd5e1", marginRight: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    marginBottom: 4,
  },
});
