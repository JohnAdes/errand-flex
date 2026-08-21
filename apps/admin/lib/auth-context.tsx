"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "./api";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (session: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "courier_admin_session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSession(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  function login(newSession: Session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    setSession(newSession);
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
