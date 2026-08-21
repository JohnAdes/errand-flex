import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { api, saveToken, ApiError } from "../lib/api";

/**
 * Closes a real gap: previously this screen only supported signing into the
 * pre-seeded demo account — `api.registerCustomer` existed in the API client
 * but nothing in the app ever called it, so no new tester could ever create
 * an account through the app.
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("casey@example.com");
  const [password, setPassword] = useState("password123");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: "login" | "signup") {
    setMode(next);
    setError(null);
    if (next === "signup") {
      setEmail("");
      setPassword("");
    } else {
      setEmail("casey@example.com");
      setPassword("password123");
    }
  }

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      await saveToken(session.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!displayName.trim()) return setError("Enter your name");
    if (!email.trim()) return setError("Enter an email");
    if (password.length < 8) return setError("Password must be at least 8 characters");

    setLoading(true);
    setError(null);
    try {
      const session = await api.registerCustomer(email.trim(), password, displayName.trim());
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
      <Text style={styles.title}>Courier</Text>
      <Text style={styles.subtitle}>Same-day delivery, done right.</Text>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, mode === "login" && styles.tabActive]} onPress={() => switchMode("login")}>
          <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === "signup" && styles.tabActive]} onPress={() => switchMode("signup")}>
          <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Sign up</Text>
        </TouchableOpacity>
      </View>

      {mode === "signup" && (
        <TextInput style={styles.input} placeholder="Full name" value={displayName} onChangeText={setDisplayName} />
      )}
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
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === "login" ? "Sign in" : "Create account"}</Text>
        )}
      </TouchableOpacity>

      {mode === "login" && <Text style={styles.hint}>Seeded account: casey@example.com / password123</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 32, fontWeight: "700", color: "#1e293b" },
  subtitle: { fontSize: 15, color: "#64748b", marginBottom: 32 },
  tabs: { flexDirection: "row", marginBottom: 20, backgroundColor: "#f1f5f9", borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  tabText: { color: "#64748b", fontWeight: "600" },
  tabTextActive: { color: "#1e293b" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#3454d1",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#dc2626", marginBottom: 12 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 20, textAlign: "center" },
});
