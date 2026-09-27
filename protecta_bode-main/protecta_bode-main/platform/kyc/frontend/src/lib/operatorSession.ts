import { API_BASE_URL } from '../config/api';
import { fetchCsrfToken, csrfHeader } from './csrf';

export interface OperatorBlock {
  email: string;
  api_key_id: string;
  key_prefix: string;
  service_label: string;
  service_product: string;
  service_environment: string;
}

export interface DashboardProfile {
  scope?: 'developer' | 'service-operator';
  operator?: OperatorBlock;
  data?: any;
}

export type ProfileResult =
  | { authed: false }
  | { authed: true; isOperator: boolean; operator: OperatorBlock | null; raw: DashboardProfile };

export function deriveIsOperator(profile: DashboardProfile): boolean {
  return !!profile.operator;
}

export async function fetchDashboardProfile(): Promise<ProfileResult> {
  // Resolve the cookie without probing a protected endpoint first. Logged-out
  // users now receive a normal 200/authenticated:false response instead of a
  // noisy profile 401. This endpoint also bridges a combined-console admin
  // cookie onto the dedicated hosted-page developer account.
  await fetchCsrfToken();
  const session = await fetch(`${API_BASE_URL}/api/auth/developer/resolve-session`, {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeader(),
  });
  if (!session.ok) return { authed: false };
  const state = await session.json();
  if (state.authenticated !== true) return { authed: false };

  const res = await fetch(`${API_BASE_URL}/api/developer/profile`, { credentials: 'include' });
  if (!res.ok) return { authed: false };
  const raw = (await res.json()) as DashboardProfile;
  const isOperator = deriveIsOperator(raw);
  return { authed: true, isOperator, operator: isOperator ? raw.operator! : null, raw };
}
