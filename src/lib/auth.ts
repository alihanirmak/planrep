import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from "./session";

export {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type Role,
  type SessionUser,
} from "./session";

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function checkPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
