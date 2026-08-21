import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { api, ApiError } from "../lib/api";

/**
 * Closes a real gap: a newly-registered driver had no way to submit a
 * vehicle or documents through the app at all — POST /v1/drivers/me/vehicles
 * and /documents existed on the backend with no UI ever calling them, so a
 * new driver could never actually get approved. Shown whenever the driver's
 * own profile (GET /v1/drivers/me) isn't APPROVED yet.
 */
export function OnboardingScreen({ profile, onRefresh }: { profile: any; onRefresh: () => void }) {
  const hasVehicle = (profile.vehicles ?? []).length > 0;
  const hasDocument = (profile.documents ?? []).length > 0;
  const submitted = hasVehicle && hasDocument;

  const [plate, setPlate] = useState("");
  const [capacityWeightKg, setCapacityWeightKg] = useState("200");
  const [capacityVolumeL, setCapacityVolumeL] = useState("400");
  const [licenseUri, setLicenseUri] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!plate.trim()) return setError("Enter your license plate");
    if (!licenseUri) return setError("Take a photo of your driver's license");

    setSubmitting(true);
    setError(null);
    try {
      await api.addVehicle({
        type: "SEDAN",
        plate: plate.trim(),
        capacityWeightKg: parseFloat(capacityWeightKg) || 200,
        capacityVolumeL: parseFloat(capacityVolumeL) || 400,
      });
      await api.addDocument({ docType: "LICENSE", fileRef: licenseUri });
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit — try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckStatus() {
    setChecking(true);
    try {
      onRefresh();
    } finally {
      setChecking(false);
    }
  }

  if (cameraOpen) {
    if (!permission?.granted) {
      requestPermission();
      return (
        <View style={[styles.container, styles.center]}>
          <ActivityIndicator color="#fff" />
        </View>
      );
    }
    return <CameraCapture onCaptured={(uri) => { setLicenseUri(uri); setCameraOpen(false); }} onCancel={() => setCameraOpen(false)} />;
  }

  if (submitted) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.pendingTitle}>Application submitted</Text>
        <Text style={styles.pendingSubtitle}>
          {profile.status === "SUSPENDED"
            ? "Your account is suspended — contact support."
            : "An admin is reviewing your documents and vehicle. Check back soon."}
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleCheckStatus} disabled={checking}>
          {checking ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Check status</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Complete your driver application</Text>
      <Text style={styles.subtitle}>We need your vehicle info and a photo of your license before you can go online.</Text>

      <Text style={styles.label}>License plate</Text>
      <TextInput style={styles.input} placeholder="ABC-1234" placeholderTextColor="#64748b" value={plate} onChangeText={setPlate} />

      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>Capacity (kg)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={capacityWeightKg} onChangeText={setCapacityWeightKg} />
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>Capacity (L)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={capacityVolumeL} onChangeText={setCapacityVolumeL} />
        </View>
      </View>

      <TouchableOpacity style={styles.photoRow} onPress={() => setCameraOpen(true)}>
        <Text style={styles.photoLabel}>Driver's license photo</Text>
        <Text style={styles.photoStatus}>{licenseUri ? "✓ Captured" : "Tap to capture"}</Text>
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Submit application</Text>}
      </TouchableOpacity>
    </View>
  );
}

function CameraCapture({ onCaptured, onCancel }: { onCaptured: (uri: string) => void; onCancel: () => void }) {
  const cameraRef = React.useRef<CameraView>(null);

  async function takePhoto() {
    const photo = await cameraRef.current?.takePictureAsync();
    if (photo?.uri) onCaptured(photo.uri);
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
      <View style={styles.cameraControls}>
        <TouchableOpacity onPress={onCancel}>
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
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 20 },
  subtitle: { color: "#94a3b8", marginTop: 8, marginBottom: 24 },
  label: { color: "#cbd5e1", fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 15 },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
  photoRow: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  photoLabel: { color: "#fff", fontSize: 15 },
  photoStatus: { color: "#22c55e", fontSize: 13, fontWeight: "600" },
  button: { backgroundColor: "#22c55e", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#0f172a", fontWeight: "700", fontSize: 16 },
  error: { color: "#f87171", marginBottom: 12 },
  pendingTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  pendingSubtitle: { color: "#94a3b8", textAlign: "center", marginTop: 12, marginBottom: 24, paddingHorizontal: 20 },
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
  cameraCancelText: { color: "#fff", fontSize: 16 },
  shutterButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: "#fff", borderWidth: 4, borderColor: "#94a3b8" },
});
