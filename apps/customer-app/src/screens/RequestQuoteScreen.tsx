import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import { api, ApiError, QuoteResponse } from "../lib/api";

/**
 * This screen intentionally uses manual lat/lng entry rather than a full
 * address-autocomplete + geocoding integration (that needs a mapping
 * provider API key — see 02-architecture.md §4's abstraction-layer note).
 * "Use my current location" for pickup is wired to real device GPS via
 * expo-location as a starting point; wire in a places-autocomplete provider
 * before shipping this to real users.
 */
export function RequestQuoteScreen({
  onOrderCreated,
  onViewOrders,
}: {
  onOrderCreated: (orderId: string) => void;
  onViewOrders: () => void;
}) {
  const [pickupLat, setPickupLat] = useState("33.1507");
  const [pickupLng, setPickupLng] = useState("-96.8236");
  const [dropoffLat, setDropoffLat] = useState("32.7555");
  const [dropoffLng, setDropoffLng] = useState("-97.3308");
  const [serviceLevel, setServiceLevel] = useState<"ECONOMY" | "STANDARD" | "PRIORITY">("STANDARD");
  const [weightKg, setWeightKg] = useState("2");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  async function useCurrentLocationForPickup() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission is required to use your current location");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setPickupLat(position.coords.latitude.toFixed(6));
      setPickupLng(position.coords.longitude.toFixed(6));
    } catch {
      setError("Couldn't get your current location");
    } finally {
      setLocating(false);
    }
  }

  async function handleGetQuote() {
    setLoading(true);
    setError(null);
    setQuote(null);
    try {
      const result = await api.getQuote({
        pickup: { lat: parseFloat(pickupLat), lng: parseFloat(pickupLng) },
        dropoff: { lat: parseFloat(dropoffLat), lng: parseFloat(dropoffLng) },
        serviceLevel,
        totalWeightKg: parseFloat(weightKg) || 1,
        packageCount: 1,
      });
      setQuote(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't get a quote — try again");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOrder() {
    if (!quote) return;
    setLoading(true);
    setError(null);
    try {
      const order = await api.createOrder(
        {
          quoteId: quote.id,
          serviceLevel,
          pickup: {
            line1: "Pickup address",
            city: "City",
            state: "TX",
            postal: "00000",
            lat: parseFloat(pickupLat),
            lng: parseFloat(pickupLng),
          },
          dropoff: {
            line1: "Dropoff address",
            city: "City",
            state: "TX",
            postal: "00000",
            lat: parseFloat(dropoffLat),
            lng: parseFloat(dropoffLng),
            recipientName: "Recipient",
            recipientPhone: "555-0100",
          },
          packages: [
            { category: "SMALL_PARCEL", weightKg: parseFloat(weightKg) || 1, quantity: 1, declaredValueCents: 0, fragile: false, perishable: false, confidential: false },
          ],
          contactlessDelivery: false,
        },
        `order-${Date.now()}`
      );
      onOrderCreated(order.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the order — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Request a delivery</Text>
        <TouchableOpacity onPress={onViewOrders}>
          <Text style={styles.linkText}>My orders</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Pickup location</Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.half]} value={pickupLat} onChangeText={setPickupLat} keyboardType="numeric" placeholder="Lat" />
        <TextInput style={[styles.input, styles.half]} value={pickupLng} onChangeText={setPickupLng} keyboardType="numeric" placeholder="Lng" />
      </View>
      <TouchableOpacity onPress={useCurrentLocationForPickup} disabled={locating}>
        <Text style={styles.linkText}>{locating ? "Locating…" : "Use my current location"}</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Dropoff location</Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.half]} value={dropoffLat} onChangeText={setDropoffLat} keyboardType="numeric" placeholder="Lat" />
        <TextInput style={[styles.input, styles.half]} value={dropoffLng} onChangeText={setDropoffLng} keyboardType="numeric" placeholder="Lng" />
      </View>

      <Text style={styles.label}>Package weight (kg)</Text>
      <TextInput style={styles.input} value={weightKg} onChangeText={setWeightKg} keyboardType="numeric" />

      <Text style={styles.label}>Service level</Text>
      <View style={styles.row}>
        {(["ECONOMY", "STANDARD", "PRIORITY"] as const).map((level) => (
          <TouchableOpacity
            key={level}
            style={[styles.pill, serviceLevel === level && styles.pillActive]}
            onPress={() => setServiceLevel(level)}
          >
            <Text style={[styles.pillText, serviceLevel === level && styles.pillTextActive]}>{level}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleGetQuote} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Get a quote</Text>}
      </TouchableOpacity>

      {quote && (
        <View style={styles.quoteCard}>
          <Text style={styles.quoteTotal}>${(quote.totalCents / 100).toFixed(2)}</Text>
          <Text style={styles.quoteDistance}>{quote.distanceKm} km · expires {new Date(quote.expiresAt).toLocaleTimeString()}</Text>
          {quote.breakdown.map((line, i) => (
            <View key={i} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{line.label}</Text>
              <Text style={styles.breakdownAmount}>${(line.amountCents / 100).toFixed(2)}</Text>
            </View>
          ))}
          <TouchableOpacity style={[styles.button, { marginTop: 16 }]} onPress={handleConfirmOrder} disabled={loading}>
            <Text style={styles.buttonText}>Confirm & create order</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 24, fontWeight: "700", color: "#1e293b" },
  label: { fontSize: 13, fontWeight: "600", color: "#475569", marginTop: 12, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    flex: 1,
  },
  half: { flex: 1 },
  linkText: { color: "#3454d1", fontSize: 13, marginTop: 6 },
  pill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: "#cbd5e1", marginRight: 8 },
  pillActive: { backgroundColor: "#3454d1", borderColor: "#3454d1" },
  pillText: { color: "#475569", fontSize: 13, fontWeight: "600" },
  pillTextActive: { color: "#fff" },
  button: { backgroundColor: "#3454d1", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#dc2626", marginTop: 12 },
  quoteCard: { marginTop: 20, padding: 16, backgroundColor: "#f8fafc", borderRadius: 12 },
  quoteTotal: { fontSize: 28, fontWeight: "700", color: "#1e293b" },
  quoteDistance: { color: "#64748b", fontSize: 13, marginBottom: 12 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  breakdownLabel: { color: "#475569", fontSize: 13 },
  breakdownAmount: { color: "#1e293b", fontSize: 13, fontWeight: "600" },
});
