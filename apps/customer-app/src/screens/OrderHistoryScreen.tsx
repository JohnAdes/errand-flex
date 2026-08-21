import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { api, ApiError } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  DELIVERED: "#16a34a",
  CANCELED: "#94a3b8",
  DELIVERY_FAILED: "#dc2626",
};

/**
 * Closes a real gap: previously there was no way to get back to an
 * in-progress or past order after leaving the tracking screen — the app
 * would always land back on "new quote" with no memory of anything you'd
 * already sent. `GET /v1/orders` (listOrdersForCustomer) already existed on
 * the backend; nothing in this app ever called it.
 */
export function OrderHistoryScreen({
  onSelectOrder,
  onNewDelivery,
}: {
  onSelectOrder: (orderId: string) => void;
  onNewDelivery: () => void;
}) {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listOrders();
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your orders");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your orders</Text>
        <TouchableOpacity onPress={onNewDelivery}>
          <Text style={styles.linkText}>+ New delivery</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {!orders ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No orders yet — send your first delivery.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => onSelectOrder(item.id)}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Order #{item.id.slice(0, 8)}</Text>
                <Text style={[styles.cardStatus, { color: STATUS_COLORS[item.status] ?? "#3454d1" }]}>{item.status}</Text>
              </View>
              <Text style={styles.cardMeta}>
                {item.packages?.length ?? 0} package(s) · ${((item.totalCents ?? 0) / 100).toFixed(2)}
              </Text>
              <Text style={styles.cardDate}>{new Date(item.createdAt).toLocaleString()}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20 },
  title: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  linkText: { color: "#3454d1", fontSize: 14, fontWeight: "600" },
  error: { color: "#dc2626", paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  empty: { color: "#94a3b8", textAlign: "center", marginTop: 60 },
  card: { backgroundColor: "#f8fafc", borderRadius: 12, padding: 16, marginBottom: 12 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  cardStatus: { fontSize: 12, fontWeight: "700" },
  cardMeta: { color: "#64748b", fontSize: 13, marginTop: 4 },
  cardDate: { color: "#94a3b8", fontSize: 11, marginTop: 2 },
});
