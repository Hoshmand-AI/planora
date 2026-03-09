import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { getUserByEmail, createUser } from '@/lib/db'
import { hashPassword, verifyPassword, createToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { action, email, password, name } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  if (action === 'signup') {
    const existing = await getUserByEmail(email)
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }
    const passwordHash = await hashPassword(password)
    const user = await createUser({
      id: uuid(),
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      passwordHash,
      plan: 'free',
      createdAt: new Date().toISOString(),
    })
    const token = createToken(user.id, user.email)
    const res = NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } })
    res.cookies.set('planora-token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' })
    return res
  }

  if (action === 'signin') {
    const user = await getUserByEmail(email)
    if (!user) {
      return NextResponse.json({ error: 'No account found with this email. Please sign up first.' }, { status: 401 })
    }
    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect password. Please try again.' }, { status: 401 })
    }
    const token = createToken(user.id, user.email)
    const res = NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } })
    res.cookies.set('planora-token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' })
    return res
  }

  if (action === 'signout') {
    const res = NextResponse.json({ success: true })
    res.cookies.delete('planora-token')
    return res
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function GET() {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const token = cookieStore.get('planora-token')?.value
  if (!token) return NextResponse.json({ user: null })

  const { verifyToken } = await import('@/lib/auth')
  const payload = verifyToken(token)
  if (!payload) return NextResponse.json({ user: null })

  const { getUserById } = await import('@/lib/db')
  const user = await getUserById(payload.userId)
  if (!user) return NextResponse.json({ user: null })

  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } })
}
