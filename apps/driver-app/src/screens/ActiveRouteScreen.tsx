import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { api, ApiError } from "../lib/api";

type Step = "pickup" | "delivery" | "done";

const LOCATION_PING_INTERVAL_MS = 15_000;

/**
 * This screen implements the real verification LOGIC (GPS-radius gating,
 * required-field checks, calling the actual verify endpoints) — the part
 * that matters for chain-of-custody integrity. What it does NOT implement:
 * uploading the captured photo to Cloud Storage and getting back a real
 * signed storage ref (see custody.service.ts's media-upload note) — that
 * needs a real Firebase/GCS project. Here, capturing a photo just produces
 * a local file:// URI, which is passed to the API as a placeholder ref.
 * Wire in the real upload flow before shipping this to real drivers.
 *
 * Takes an array of orders rather than a single order — a route-batch offer
 * (see batching.service.ts) covers multiple orders at once. This walks the
 * driver through pickup+delivery for each order in sequence (order 1 fully
 * pickup->delivery, then order 2, etc.) rather than "all pickups then all
 * dropoffs" — the backend doesn't persist a dropoff sequence to drive that
 * UX (route_assignments only tracks pickup order, see batching.service.ts's
 * schema note), and per-order pickup/delivery is what verifyPickup/
 * verifyDelivery are contracted to accept regardless. A single-order offer
 * is just the orders.length === 1 case of the same flow.
 */
export function ActiveRouteScreen({ orders, onComplete }: { orders: any[]; onComplete: () => void }) {
  const [orderIndex, setOrderIndex] = useState(0);
  const [step, setStep] = useState<Step>("pickup");
  const [permission, requestPermission] = useCameraPermissions();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [packagePhotoUri, setPackagePhotoUri] = useState<string | null>(null);
  const [podPhotoUri, setPodPhotoUri] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<"selfie" | "package" | "pod" | null>(null);

  const order = orders[orderIndex];
  const pickupStop = order?.stops?.find((s: any) => s.type === "PICKUP");
  const dropoffStop = order?.stops?.find((s: any) => s.type === "DROPOFF");
  const isLastOrder = orderIndex === orders.length - 1;

  // Background location publishing (02-architecture.md §9's "background
  // driver-location tracking" — previously location_events had no write path
  // at all; see tracking.service.ts on the API side). Pings while the driver
  // is actively carrying orders and stops once the whole route is complete —
  // this is foreground-only (via setInterval, not a native background task),
  // which is the honest limit of what works without ejecting from Expo's
  // managed workflow / adding expo-task-manager background permissions.
  const stepRef = useRef(step);
  stepRef.current = step;
  const orderIdRef = useRef(order?.id);
  orderIdRef.current = order?.id;

  useEffect(() => {
    const interval = setInterval(async () => {
      if (stepRef.current === "done" || !orderIdRef.current) return;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({});
        await api.postLocation(pos.coords.latitude, pos.coords.longitude, orderIdRef.current);
      } catch {
        // Best-effort — a missed ping just means a stale "last known
        // location" for the customer, not a broken delivery flow.
      }
    }, LOCATION_PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function getCurrentLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission is required");
    const pos = await Location.getCurrentPositionAsync({});
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }

  function resetPerOrderFields() {
    setSelfieUri(null);
    setPackagePhotoUri(null);
    setPodPhotoUri(null);
    setSenderName("");
    setRecipientName("");
    setError(null);
  }

  async function handleConfirmPickup() {
    if (!selfieUri) return setError("Take a live selfie first");
    if (!packagePhotoUri) return setError("Photograph the package first");
    if (!senderName) return setError("Enter the sender's name");

    setSubmitting(true);
    setError(null);
    try {
      const driverLocation = await getCurrentLocation();
      await api.verifyPickup(order.id, {
        driverLocation,
        pickupLocation: { lat: pickupStop.address.lat, lng: pickupStop.address.lng },
        driverSelfieRef: selfieUri,
        packagePhotoRefs: [packagePhotoUri],
        senderName,
        pinUsed: false,
      });
      setStep("delivery");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm pickup");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelivery() {
    if (!podPhotoUri) return setError("Take a proof-of-delivery photo first");
    if (!recipientName) return setError("Enter the recipient's name");

    setSubmitting(true);
    setError(null);
    try {
      const driverLocation = await getCurrentLocation();
      await api.verifyDelivery(order.id, {
        driverLocation,
        dropoffLocation: { lat: dropoffStop.address.lat, lng: dropoffStop.address.lng },
        outcome: "DELIVERED",
        podPhotoRef: podPhotoUri,
        recipientName,
        pinUsed: true,
        contactless: false,
      });
      if (isLastOrder) {
        setStep("done");
        setTimeout(onComplete, 1500);
      } else {
        resetPerOrderFields();
        setOrderIndex((i) => i + 1);
        setStep("pickup");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm delivery");
    } finally {
      setSubmitting(false);
    }
  }

  if (cameraTarget) {
    if (!permission?.granted) {
      requestPermission();
      return (
        <View style={[styles.container, styles.center]}>
          <ActivityIndicator color="#fff" />
        </View>
      );
    }
    return (
      <CameraViewScreen
        facing={cameraTarget === "selfie" ? "front" : "back"}
        onCaptured={(uri) => {
          if (cameraTarget === "selfie") setSelfieUri(uri);
          if (cameraTarget === "package") setPackagePhotoUri(uri);
          if (cameraTarget === "pod") setPodPhotoUri(uri);
          setCameraTarget(null);
        }}
        onCancel={() => setCameraTarget(null)}
      />
    );
  }

  if (step === "done") {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.doneText}>Delivered ✓</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {orders.length > 1 && (
        <Text style={styles.routeProgress}>
          Stop {orderIndex + 1} of {orders.length}
        </Text>
      )}
      <Text style={styles.title}>{step === "pickup" ? "Confirm pickup" : "Complete delivery"}</Text>
      <Text style={styles.address}>
        {step === "pickup" ? pickupStop?.address?.line1 : dropoffStop?.address?.line1}
      </Text>

      {step === "pickup" && (
        <>
          <PhotoRow label="Live selfie" uri={selfieUri} onPress={() => setCameraTarget("selfie")} />
          <PhotoRow label="Package photo" uri={packagePhotoUri} onPress={() => setCameraTarget("package")} />
          <TextInput style={styles.input} placeholder="Sender name" placeholderTextColor="#64748b" value={senderName} onChangeText={setSenderName} />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleConfirmPickup} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Confirm pickup</Text>}
          </TouchableOpacity>
        </>
      )}

      {step === "delivery" && (
        <>
          <PhotoRow label="Proof of delivery" uri={podPhotoUri} onPress={() => setCameraTarget("pod")} />
          <TextInput style={styles.input} placeholder="Recipient name" placeholderTextColor="#64748b" value={recipientName} onChangeText={setRecipientName} />
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleConfirmDelivery} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.buttonText}>{isLastOrder ? "Complete delivery" : "Complete & go to next stop"}</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function PhotoRow({ label, uri, onPress }: { label: string; uri: string | null; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.photoRow} onPress={onPress}>
      <Text style={styles.photoLabel}>{label}</Text>
      <Text style={styles.photoStatus}>{uri ? "✓ Captured" : "Tap to capture"}</Text>
    </TouchableOpacity>
  );
}

function CameraViewScreen({
  facing,
  onCaptured,
  onCancel,
}: {
  facing: "front" | "back";
  onCaptured: (uri: string) => void;
  onCancel: () => void;
}) {
  const cameraRef = React.useRef<CameraView>(null);

  async function takePhoto() {
    try {
      const photo = await cameraRef.current?.takePictureAsync();
      if (photo?.uri) onCaptured(photo.uri);
    } catch {
      Alert.alert("Couldn't capture photo — try again");
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing} />
      <View style={styles.cameraControls}>
        <TouchableOpacity style={styles.cameraCancel} onPress={onCancel}>
          <Text style={styles.cameraCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shutterButton} onPress={takePhoto} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 20 },
  center: { justifyContent: "center", alignItems: "center" },
  routeProgress: { color: "#22c55e", fontSize: 13, fontWeight: "700", marginTop: 20, textTransform: "uppercase" },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 4 },
  address: { color: "#94a3b8", marginBottom: 24 },
  photoRow: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  photoLabel: { color: "#fff", fontSize: 15 },
  photoStatus: { color: "#22c55e", fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 10, padding: 14, marginTop: 4, marginBottom: 16, fontSize: 15 },
  button: { backgroundColor: "#22c55e", borderRadius: 12, padding: 16, alignItems: "center" },
  buttonText: { color: "#0f172a", fontWeight: "700", fontSize: 16 },
  error: { color: "#f87171", marginBottom: 12 },
  doneText: { color: "#22c55e", fontSize: 28, fontWeight: "700" },
  cameraControls: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 30,
  },
  cameraCancel: { padding: 12 },
  cameraCancelText: { color: "#fff", fontSize: 16 },
  shutterButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: "#fff", borderWidth: 4, borderColor: "#94a3b8" },
});
