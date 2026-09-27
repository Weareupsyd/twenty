import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '../config/api';
import { C, injectFonts } from '../theme';

/** Public landing URL encoded in the poster QR. Mints a session and continues. */
export function StartVerificationPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => { injectFonts(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mode = params.get('verification_mode');
        const age = params.get('age_threshold');
        const res = await fetch(`${API_BASE_URL}/api/verify/public-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(mode ? { verification_mode: mode } : {}),
            ...(age ? { age_threshold: Number(age) } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.verification_url) {
          throw new Error(data.message || data.error || 'Could not start verification');
        }
        // Keep the redirect on this SPA's mount. When the app is served under
        // /kyc/ the backend may still return a root-absolute verification_url
        // (/v/… or /user-verification) because it cannot see the mount path;
        // rewriting it here keeps the phone on the working app.
        const verificationUrl = (() => {
          try {
            const u = new URL(data.verification_url, window.location.origin);
            if (u.origin === window.location.origin && base && !u.pathname.startsWith(`${base}/`)) {
              u.pathname = `${base}${u.pathname}`;
            }
            return u.toString();
          } catch {
            return data.verification_url as string;
          }
        })();
        if (!cancelled) window.location.replace(verificationUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not start verification');
      }
    })();
    return () => { cancelled = true; };
  }, [params, base]);

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: C.sans,
    }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <img src={`${import.meta.env.BASE_URL}fingerprint-icon.png`} alt="Fingerprint" style={{ height: 32, margin: '0 auto 20px' }} />
        {error ? (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Verification unavailable</h1>
            <p style={{ color: 'var(--mid)', fontSize: 14 }}>{error}</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Starting verification…</h1>
            <p style={{ color: 'var(--mid)', fontSize: 14 }}>Preparing a secure session on this device.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default StartVerificationPage;
