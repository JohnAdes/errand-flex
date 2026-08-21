import React, { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, getToken, clearToken } from "./src/lib/api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ActiveRouteScreen } from "./src/screens/ActiveRouteScreen";

type Screen =
  | { name: "loading" }
  | { name: "login" }
  | { name: "onboarding"; profile: any }
  | { name: "home" }
  | { name: "active_route"; orders: any[] };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  // Closes a real gap: previously a driver landed straight on HomeScreen
  // regardless of approval status, with no way to ever submit a vehicle or
  // documents. Every time we (re)establish a session, check the driver's own
  // approval status and route to onboarding until it's APPROVED.
  async function routeByProfile() {
    try {
      const profile = await api.getMyProfile();
      if (profile.status === "APPROVED") {
        setScreen({ name: "home" });
      } else {
        setScreen({ name: "onboarding", profile });
      }
    } catch {
      await clearToken();
      setScreen({ name: "login" });
    }
  }

  useEffect(() => {
    getToken().then((token) => {
      if (token) {
        routeByProfile();
      } else {
        setScreen({ name: "login" });
      }
    });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {screen.name === "login" && <LoginScreen onLoggedIn={routeByProfile} />}
      {screen.name === "onboarding" && <OnboardingScreen profile={screen.profile} onRefresh={routeByProfile} />}
      {screen.name === "home" && (
        <HomeScreen onOfferAccepted={(orders) => setScreen({ name: "active_route", orders })} />
      )}
      {screen.name === "active_route" && (
        <ActiveRouteScreen orders={screen.orders} onComplete={() => setScreen({ name: "home" })} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0f172a" },
});
