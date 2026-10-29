import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit, auditQuietly } from '@/lib/server/audit'
import { decrypt } from '@/lib/server/crypto'
import { log } from '@/lib/server/log'
import { credentialSource, finishOAuth, forgetCredentials, primeCredentials, STORAGE_OAUTH_COOKIE } from '@/lib/storage/cloud-auth'
import { storageClient, StorageError, testStorage, type StorageConfig, type StorageSecret } from '@/lib/storage/providers'
import { createStorageConnection } from '@/lib/storage/store'

/**
 * Microsoft or Google sends the admin back here after they sign in (?code&state). RunF9 exchanges
 * the code (PKCE), tests the container or bucket with the new token, and saves the connection with
 * the encrypted refresh token. Always ends with a redirect to Organization > Cloud storage.
 */
export const GET = api({ permission: 'org.manage' }, async (req, { auth }) => {
  const url = new URL(req.url)
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/org?${q}#cloud-storage`, url.origin), 303)
    res.cookies.set(STORAGE_OAUTH_COOKIE, '', { path: '/api/storage/oauth', maxAge: 0 })
    return res
  }
  let st: { orgId: string; userId: string; provider: 'azure' | 'gcp'; name: string; config: StorageConfig; verifier: string; state: string; redirectUri: string; exp: number }
  try { st = JSON.parse(decrypt(req.cookies.get(STORAGE_OAUTH_COOKIE)?.value || '')) } catch {
    return back(`storage_error=${encodeURIComponent('The sign-in expired or was started in another browser. Start again.')}`)
  }
  try {
    if (st.orgId !== auth.orgId || st.userId !== auth.userId || st.exp < Date.now()) throw new ApiError(400, 'The sign-in expired or was started by someone else. Start again.')
    if (url.searchParams.get('state') !== st.state) throw new ApiError(400, 'The sign-in could not be verified (state mismatch). Start again.')
    const providerError = url.searchParams.get('error')
    if (providerError) throw new ApiError(400, providerError === 'access_denied' ? 'The sign-in was cancelled or permission was not granted.' : `The sign-in failed (${providerError.slice(0, 60)}).`)
    const code = url.searchParams.get('code')
    if (!code) throw new ApiError(400, 'The sign-in did not return a code. Start again.')

    const tokens = await finishOAuth(st.provider, code, st.verifier, st.redirectUri)
    const id = randomUUID()
    primeCredentials(id, tokens.accessToken, tokens.expiresIn)
    // Keep whichever refresh token is newest: Microsoft can rotate it while the connection is tested.
    let secret: StorageSecret = { refreshToken: tokens.refreshToken }
    const status = await testStorage(storageClient(st.provider, st.config, secret, process.env, credentialSource(id, st.provider, st.config, secret, async next => { secret = next })), st.config.prefix)
    if (!status.read && !status.write) {
      forgetCredentials(id)
      await audit({ action: 'storage.connect_failed', targetType: 'organization', targetId: auth.orgId, detail: { provider: st.provider, auth: 'oauth', name: st.name } })
      throw new ApiError(400, `You signed in, but RunF9 could not use this ${st.provider === 'azure' ? 'container' : 'bucket'}: ${status.detail}${st.provider === 'azure' ? ' Your account needs the "Storage Blob Data Contributor" role on it.' : ' Your account needs the "Storage Object Admin" role on it.'}`)
    }
    const connection = await createStorageConnection({ id, orgId: auth.orgId, provider: st.provider, name: st.name, config: st.config, secret, canRead: status.read, canWrite: status.write, statusDetail: status.detail, createdBy: auth.userId })
    await audit({ action: 'storage.connected', targetType: 'storage_connection', targetId: id, detail: { provider: st.provider, auth: 'oauth', name: st.name, location: connection.location, canRead: status.read, canWrite: status.write } })
    return back(`storage=connected&name=${encodeURIComponent(st.name)}`)
  } catch (err) {
    const message = err instanceof ApiError || err instanceof StorageError ? err.message : 'The sign-in failed. Try again.'
    if (!(err instanceof ApiError || err instanceof StorageError)) log('error', 'storage sign-in failed', { error: (err as Error).message })
    await auditQuietly({ action: 'storage.connect_failed', detail: { provider: st.provider, auth: 'oauth', reason: message } })
    return back(`storage_error=${encodeURIComponent(message)}`)
  }
})
