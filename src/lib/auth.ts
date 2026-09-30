import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production')
  return 'planora-dev-secret-change-in-production-2026'
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function createToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, jwtSecret(), { expiresIn: '7d' })
}

export function verifyToken(token: string): { userId: string; email: string } | null {
  try {
    return jwt.verify(token, jwtSecret()) as { userId: string; email: string }
  } catch {
    return null
  }
}

export async function getAuthUser(): Promise<{ userId: string; email: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('planora-token')?.value
  if (!token) return null
  return verifyToken(token)
}

export interface AuthContext { userId: string; email: string; name: string; orgId: string }

/** Authenticated user plus their firm (organization). All firm data access must use ctx.orgId. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const auth = await getAuthUser()
  if (!auth) return null
  const { getUserById } = await import('@/lib/db')
  const user = await getUserById(auth.userId)
  if (!user) return null
  return { userId: user.id, email: user.email, name: user.name, orgId: user.orgId }
}
