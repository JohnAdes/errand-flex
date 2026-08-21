"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";

const LINKS = [
  { href: "/orders", label: "Orders" },
  { href: "/drivers", label: "Drivers" },
  { href: "/dispatch", label: "Dispatch" },
  { href: "/pricing", label: "Pricing" },
  { href: "/payments", label: "Payments" },
  { href: "/claims", label: "Claims" },
  { href: "/business-accounts", label: "Business" },
];

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-sm shadow-brand-900/20">
      <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
        <path
          d="M3 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M14 10h3.6a1 1 0 0 1 .8.4l2.2 2.9a1 1 0 0 1 .2.6V16a1 1 0 0 1-1 1H14"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="7.5" cy="17.5" r="1.6" fill="white" />
        <circle cx="16.5" cy="17.5" r="1.6" fill="white" />
      </svg>
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              Courier <span className="text-brand-600">Ops</span>
            </span>
          </div>
          <nav className="flex gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {session && (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{session.role}</span>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
