import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "imagebed_session";
const SESSION_DAYS = 7;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET environment variable");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken() {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string) {
  try {
    await jwtVerify(token, getSessionSecret());
    return true;
  } catch {
    return false;
  }
}

export async function getIsAuthed() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export const sessionCookieName = COOKIE_NAME;
