// Thin API client: bearer auth, JSON, same-origin /api (proxied to the backend).
const TOKEN_KEY = 'pb_token'
const ROLE_KEY = 'pb_role'
const NAME_KEY = 'pb_name'

export function session() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || '',
    role: localStorage.getItem(ROLE_KEY) || '',
    name: localStorage.getItem(NAME_KEY) || '',
  }
}

export function setSession(token, role, name) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(ROLE_KEY, role)
  localStorage.setItem(NAME_KEY, name || '')
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(NAME_KEY)
}

export class ApiError extends Error {
  constructor(status, payload) {
    super((payload && (payload.detail?.detail || payload.detail)) || `HTTP ${status}`)
    this.status = status
    this.payload = payload
    this.code = payload?.detail?.code || ''
  }
}

export async function api(method, path, body) {
  const { token } = session()
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) clearSession()
    throw new ApiError(res.status, payload)
  }
  return payload
}

export const ugx = (n) => `UGX ${(Number(n) || 0).toLocaleString('en-UG')}`
