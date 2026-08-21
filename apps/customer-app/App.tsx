import React, { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getToken } from "./src/lib/api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RequestQuoteScreen } from "./src/screens/RequestQuoteScreen";
import { OrderTrackingScreen } from "./src/screens/OrderTrackingScreen";
import { OrderHistoryScreen } from "./src/screens/OrderHistoryScreen";

/**
 * Deliberately not using React Navigation here — this is a minimal starter
 * scaffold, and simple state-based screen switching keeps the dependency
 * surface small and the flow easy to follow. Swap in @react-navigation/native
 * (stack + tabs, per 03-ux.md §3 Navigation Model) once you're building out
 * the full screen inventory from the UX spec — this won't scale past a
 * handful of screens.
 */
type Screen =
  | { name: "loading" }
  | { name: "login" }
  | { name: "quote" }
  | { name: "tracking"; orderId: string }
  | { name: "orders" };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  useEffect(() => {
    getToken().then((token) => {
      if (token) {
        setScreen({ name: "quote" });
      } else {
        setScreen({ name: "login" });
      }
    });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen.name === "login" && <LoginScreen onLoggedIn={() => setScreen({ name: "quote" })} />}
      {screen.name === "quote" && (
        <RequestQuoteScreen
          onOrderCreated={(orderId) => setScreen({ name: "tracking", orderId })}
          onViewOrders={() => setScreen({ name: "orders" })}
        />
      )}
      {screen.name === "tracking" && (
        <OrderTrackingScreen orderId={screen.orderId} onBack={() => setScreen({ name: "quote" })} />
      )}
      {screen.name === "orders" && (
        <OrderHistoryScreen
          onSelectOrder={(orderId) => setScreen({ name: "tracking", orderId })}
          onNewDelivery={() => setScreen({ name: "quote" })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
});
