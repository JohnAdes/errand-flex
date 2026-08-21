import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert } from "react-native";
import { api, ApiError } from "../lib/api";

/**
 * `onOfferAccepted` always receives the full array of orders the driver just
 * took on — one entry for a single-order offer, up to MAX_BATCH_SIZE for a
 * route-batch offer. Previously this passed `offer.order` directly, which is
 * `null` for batch offers (see dispatch.service.ts's listPendingOffersForDriver),
 * crashing ActiveRouteScreen the instant a driver accepted a batched offer —
 * found by a code review pass, not by trying it on a device.
 */
export function HomeScreen({ onOfferAccepted }: { onOfferAccepted: (orders: any[]) => void }) {
  const [online, setOnline] = useState(false);
  const [offers, setOffers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.getOffers();
      setOffers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load offers");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function toggleOnline() {
    const next = !online;
    try {
      await api.setOnline(next);
      setOnline(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update status");
    }
  }

  function ordersForOffer(offer: any): any[] {
    if (offer.routeBatch) {
      return (offer.routeBatch.assignments ?? []).map((a: any) => a.order).filter(Boolean);
    }
    return offer.order ? [offer.order] : [];
  }

  async function handleAccept(offer: any) {
    const orders = ordersForOffer(offer);
    if (orders.length === 0) {
      Alert.alert("Couldn't accept", "This offer has no order details — try refreshing.");
      return;
    }
    try {
      await api.acceptOffer(offer.id);
      onOfferAccepted(orders);
    } catch (err) {
      Alert.alert("Couldn't accept", err instanceof ApiError ? err.message : "This offer may no longer be available");
      refresh();
    }
  }

  async function handleDecline(offerId: string) {
    try {
      await api.declineOffer(offerId);
      refresh();
    } catch (err) {
      Alert.alert("Error", err instanceof ApiError ? err.message : "Couldn't decline");
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{online ? "You're online" : "You're offline"}</Text>
        <TouchableOpacity style={[styles.toggle, online && styles.toggleOn]} onPress={toggleOnline}>
          <Text style={styles.toggleText}>{online ? "Go offline" : "Go online"}</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {offers.length === 0 && (
          <Text style={styles.empty}>{online ? "No offers nearby right now." : "Go online to start receiving offers."}</Text>
        )}
        {offers.map((offer) => {
          const orders = ordersForOffer(offer);
          const isBatch = !!offer.routeBatch;
          return (
            <View key={offer.id} style={styles.offerCard}>
              <Text style={styles.offerPayout}>${(offer.payoutCents / 100).toFixed(2)}</Text>
              {isBatch ? (
                <Text style={styles.offerMeta}>
                  Grouped route · {orders.length} stops · {orders.reduce((n, o) => n + (o.packages?.length ?? 0), 0)} package(s)
                </Text>
              ) : (
                <Text style={styles.offerMeta}>
                  {orders[0]?.packages?.length ?? 0} package(s) · {orders[0]?.serviceLevel ?? "—"}
                </Text>
              )}
              <Text style={styles.offerExpiry}>Expires {new Date(offer.expiresAt).toLocaleTimeString()}</Text>
              <View style={styles.offerActions}>
                <TouchableOpacity style={styles.declineButton} onPress={() => handleDecline(offer.id)}>
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.acceptButton} onPress={() => handleAccept(offer)}>
                  <Text style={styles.acceptText}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  toggle: { backgroundColor: "#334155", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  toggleOn: { backgroundColor: "#22c55e" },
  toggleText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  list: { flex: 1, padding: 16 },
  empty: { color: "#64748b", textAlign: "center", marginTop: 40 },
  error: { color: "#f87171", paddingHorizontal: 20 },
  offerCard: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginBottom: 12 },
  offerPayout: { color: "#22c55e", fontSize: 24, fontWeight: "700" },
  offerMeta: { color: "#cbd5e1", marginTop: 4 },
  offerExpiry: { color: "#64748b", fontSize: 12, marginTop: 4 },
  offerActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  declineButton: { flex: 1, borderWidth: 1, borderColor: "#475569", borderRadius: 10, padding: 12, alignItems: "center" },
  declineText: { color: "#cbd5e1", fontWeight: "600" },
  acceptButton: { flex: 1, backgroundColor: "#22c55e", borderRadius: 10, padding: 12, alignItems: "center" },
  acceptText: { color: "#0f172a", fontWeight: "700" },
});
