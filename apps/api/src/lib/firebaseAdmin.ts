import { initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { env } from "../env";

// Lazily initialized, shared across whichever of AUTH_PROVIDER=firebase /
// STORAGE_PROVIDER=firebase is active — both need the same credential, and
// firebase-admin's SDK throws if you call initializeApp() more than once.
let app: App | undefined;

function getFirebaseApp(): App {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error(
      "Firebase credentials missing — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY " +
        "(a service account key's fields — see .env.example)."
    );
  }
  app = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // Service-account JSON keys/env vars store this with literal "\n"
      // sequences, not real newlines — undo that.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    storageBucket: env.FIREBASE_STORAGE_BUCKET || undefined,
  });
  return app;
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

export function getFirebaseBucket() {
  return getStorage(getFirebaseApp()).bucket();
}
