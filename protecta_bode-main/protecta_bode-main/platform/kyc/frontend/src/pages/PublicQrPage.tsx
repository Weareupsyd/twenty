import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { C, injectFonts } from '../theme';

/** Public QR poster: dark full-viewport page with the scan code only. */
export function PublicQrPage() {
  const [params] = useSearchParams();

  useEffect(() => { injectFonts(); }, []);

  // The QR must encode a URL that survives the deployment mount: the Protecta Bode
  // image serves this SPA under /kyc/ (Vite base), the stock image at the
  // root. Using BASE_URL keeps the scan target on the SPA instead of the
  // portal's frontend (which has no /start route -> 404).
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const startUrl = useMemo(() => {
    const url = new URL(`${base}/start`, window.location.origin);
    const mode = params.get('verification_mode');
    const age = params.get('age_threshold');
    if (mode) url.searchParams.set('verification_mode', mode);
    if (age) url.searchParams.set('age_threshold', age);
    return url.toString();
  }, [params, base]);

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      color: C.text,
      fontFamily: C.sans,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ background: '#fff', padding: 16, display: 'inline-block', marginBottom: 28 }}>
        <QRCode value={startUrl} size={220} />
      </div>
      <p style={{
        margin: 0,
        maxWidth: 280,
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 1.5,
        color: C.muted,
        fontFamily: C.sans,
      }}>
        Scan this code with your phone to start identity verification.
      </p>
    </div>
  );
}

export default PublicQrPage;
