import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { env } from "../../env";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../lib/errors";
import { getFirebaseAuth } from "../../lib/firebaseAdmin";
import { smsProvider } from "../notifications/sms.provider";
import type { UserRole } from "@courier/shared-types";

const PHONE_CODE_TTL_MINUTES = 10;

export async function registerCustomer(params: { email: string; password: string; displayName: string; phone?: string }) {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, params.email) });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await bcrypt.hash(params.password, 10);

  const user = await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(schema.users)
      .values({ email: params.email, phone: params.phone, passwordHash, role: "CUSTOMER" })
      .returning();
    await tx.insert(schema.customerProfiles).values({ userId: newUser.id, displayName: params.displayName });
    return newUser;
  });

  return issueSession(user.id, user.role);
}

export async function registerDriverApplicant(params: { email: string; password: string; phone?: string }) {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, params.email) });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await bcrypt.hash(params.password, 10);

  const user = await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(schema.users)
      .values({ email: params.email, phone: params.phone, passwordHash, role: "DRIVER" })
      .returning();
    await tx.insert(schema.drivers).values({ userId: newUser.id, status: "PENDING" });
    return newUser;
  });

  return issueSession(user.id, user.role);
}

export async function login(email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) throw new UnauthorizedError("Invalid email or password");
  // A Firebase-linked account (see linkFirebaseAccount below) has no local
  // password to check against — it authenticates via a Firebase ID token,
  // not this endpoint.
  if (!user.passwordHash) throw new UnauthorizedError("This account signs in via Firebase, not a local password");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Invalid email or password");

  if (user.status !== "ACTIVE") {
    throw new UnauthorizedError("This account is not active");
  }

  return issueSession(user.id, user.role);
}

/**
 * Provisions (or re-links) the local `users`/profile row for a Firebase-
 * authenticated identity — only meaningful once AUTH_PROVIDER=firebase is
 * active (env.ts). The client authenticates with Firebase's own SDK first
 * (sign-up or sign-in) to get `idToken`; this endpoint verifies it, then
 * either finds the already-linked local row (a repeat call is a harmless
 * no-op) or creates one, matching `registerCustomer`/`registerDriverApplicant`'s
 * shape but with `firebaseUid` instead of a local password. Every request
 * after this continues to authenticate with the client's own Firebase ID
 * token, refreshed by Firebase's SDK — this endpoint never issues a session
 * of its own the way `issueSession` does for local auth.
 */
export async function linkFirebaseAccount(params: {
  idToken: string;
  role: "CUSTOMER" | "DRIVER";
  displayName?: string;
  phone?: string;
}) {
  const decoded = await getFirebaseAuth().verifyIdToken(params.idToken);
  if (!decoded.email) {
    throw new ValidationError("The Firebase account must have a verified email");
  }

  const existing = await db.query.users.findFirst({ where: eq(schema.users.firebaseUid, decoded.uid) });
  if (existing) return { userId: existing.id, role: existing.role };

  const emailInUse = await db.query.users.findFirst({ where: eq(schema.users.email, decoded.email) });
  if (emailInUse) throw new ConflictError("An account with this email already exists");

  const user = await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(schema.users)
      .values({ email: decoded.email!, phone: params.phone, firebaseUid: decoded.uid, role: params.role })
      .returning();
    if (params.role === "CUSTOMER") {
      if (!params.displayName) throw new ValidationError("displayName is required to link a customer account");
      await tx.insert(schema.customerProfiles).values({ userId: newUser.id, displayName: params.displayName });
    } else {
      await tx.insert(schema.drivers).values({ userId: newUser.id, status: "PENDING" });
    }
    return newUser;
  });

  return { userId: user.id, role: user.role };
}

/**
 * Sends a 6-digit SMS verification code to the calling user's own phone
 * (modules/notifications/sms.provider.ts) — the "verify-phone" flow the API
 * spec documents but this codebase previously left unimplemented for lack of
 * an SMS provider. The code itself is never stored in plaintext, only
 * bcrypt-hashed, same pattern as a password.
 */
export async function sendPhoneVerificationCode(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new NotFoundError("User", userId);
  if (!user.phone) throw new ValidationError("No phone number is on file for this account");
  if (user.phoneVerified) throw new ConflictError("This phone number is already verified");

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + PHONE_CODE_TTL_MINUTES * 60 * 1000);

  await db
    .update(schema.users)
    .set({ phoneVerificationCodeHash: codeHash, phoneVerificationExpiresAt: expiresAt })
    .where(eq(schema.users.id, userId));

  await smsProvider.send(user.phone, `Your Courier verification code is ${code}. It expires in ${PHONE_CODE_TTL_MINUTES} minutes.`);

  return { sent: true };
}

/** Confirms a code sent by sendPhoneVerificationCode and marks the phone verified. */
export async function confirmPhoneVerificationCode(userId: string, code: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new NotFoundError("User", userId);
  if (!user.phoneVerificationCodeHash || !user.phoneVerificationExpiresAt) {
    throw new ValidationError("No verification code was requested for this account — request one first");
  }
  if (user.phoneVerificationExpiresAt < new Date()) {
    throw new ValidationError("This verification code has expired — request a new one");
  }

  const valid = await bcrypt.compare(code, user.phoneVerificationCodeHash);
  if (!valid) throw new UnauthorizedError("Incorrect verification code");

  await db
    .update(schema.users)
    .set({ phoneVerified: true, phoneVerificationCodeHash: null, phoneVerificationExpiresAt: null })
    .where(eq(schema.users.id, userId));

  return { verified: true };
}

function issueSession(userId: string, role: UserRole) {
  if (!env.JWT_SECRET) throw new ValidationError("Server misconfigured: JWT_SECRET missing");
  const token = jwt.sign({ sub: userId, role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
  return { token, userId, role };
}
