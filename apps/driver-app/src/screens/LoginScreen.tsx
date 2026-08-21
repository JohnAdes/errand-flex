import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { api, saveToken, ApiError } from "../lib/api";

/**
 * Closes a real gap: previously this only supported signing into the
 * pre-seeded demo driver — `POST /v1/auth/register/driver` exists on the
 * backend but nothing in the driver app ever called it, so no new driver
 * could ever create an account (let alone get approved) through the app.
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("marcus@example.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setError(null);
    if (next === "signup") {
      setEmail("");
      setPassword("");
    } else {
      setEmail("marcus@example.com");
      setPassword("password123");
    }
  }

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      if (session.role !== "DRIVER") {
        setError("This account is not a driver account");
        return;
      }
      await saveToken(session.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!email.trim()) return setError("Enter an email");
    if (password.length < 8) return setError("Password must be at least 8 characters");

    setLoading(true);
    setError(null);
    try {
      const session = await api.registerDriverApplicant(email.trim(), password);
      await saveToken(session.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create an account — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Courier Driver</Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, mode === "login" && styles.tabActive]} onPress={() => switchMode("login")}>
          <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === "signup" && styles.tabActive]} onPress={() => switchMode("signup")}>
          <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Apply to drive</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.button} onPress={mode === "login" ? handleLogin : handleSignup} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.buttonText}>{mode === "login" ? "Sign in" : "Create driver account"}</Text>
        )}
      </TouchableOpacity>

      {mode === "login" && <Text style={styles.hint}>Seeded account: marcus@example.com / password123 (already APPROVED)</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0f172a" },
  title: { fontSize: 30, fontWeight: "700", color: "#fff", marginBottom: 24 },
  tabs: { flexDirection: "row", marginBottom: 20, backgroundColor: "#1e293b", borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#334155" },
  tabText: { color: "#94a3b8", fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  input: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#22c55e", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#0f172a", fontSize: 16, fontWeight: "700" },
  error: { color: "#f87171", marginBottom: 12 },
  hint: { color: "#64748b", fontSize: 12, marginTop: 20, textAlign: "center" },
});
