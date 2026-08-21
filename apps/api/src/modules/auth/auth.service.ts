import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { env } from "../../env";
import { ConflictError, UnauthorizedError, ValidationError } from "../../lib/errors";
import type { UserRole } from "@courier/shared-types";

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

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Invalid email or password");

  if (user.status !== "ACTIVE") {
    throw new UnauthorizedError("This account is not active");
  }

  return issueSession(user.id, user.role);
}

function issueSession(userId: string, role: UserRole) {
  if (!env.JWT_SECRET) throw new ValidationError("Server misconfigured: JWT_SECRET missing");
  const token = jwt.sign({ sub: userId, role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
  return { token, userId, role };
}
