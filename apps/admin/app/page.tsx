"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? "/orders" : "/login");
  }, [loading, session, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      Loading…
    </div>
  );
}
