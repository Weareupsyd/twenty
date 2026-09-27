import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config/api';
import { injectFonts } from '../theme';

/* The login print. This is the real photographed cloth (3.jpeg from the
   client's print set), not the recreated SVG tile we shipped before -
   the same asset and treatment the unaio console door uses. Swapping
   prints stays a one-line change: point PRINT at another file in
   frontend/public/. */
const PRINT = "url('/login-bg.jpg')";

/* Official WhatsApp glyph - same path as assets/whatsapp-svgrepo-com.svg,
   cleaned to fill="currentColor" so it inherits the app accent. */
function WhatsAppGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M26.576 5.363c-2.69-2.69-6.406-4.354-10.511-4.354-8.209 0-14.865 6.655-14.865 14.865 0 2.732 0.737 5.291 2.022 7.491l-0.038-0.070-2.109 7.702 7.879-2.067c2.051 1.139 4.498 1.809 7.102 1.809h0.006c8.209-0.003 14.862-6.659 14.862-14.868 0-4.103-1.662-7.817-4.349-10.507l0 0zM16.062 28.228h-0.005c-0 0-0.001 0-0.001 0-2.319 0-4.489-0.64-6.342-1.753l0.056 0.031-0.451-0.267-4.675 1.227 1.247-4.559-0.294-0.467c-1.185-1.862-1.889-4.131-1.889-6.565 0-6.822 5.531-12.353 12.353-12.353s12.353 5.531 12.353 12.353c0 6.822-5.53 12.353-12.353 12.353h-0zM22.838 18.977c-0.371-0.186-2.197-1.083-2.537-1.208-0.341-0.124-0.589-0.185-0.837 0.187-0.246 0.371-0.958 1.207-1.175 1.455-0.216 0.249-0.434 0.279-0.805 0.094-1.15-0.466-2.138-1.087-2.997-1.852l0.010 0.009c-0.799-0.74-1.484-1.587-2.037-2.521l-0.028-0.052c-0.216-0.371-0.023-0.572 0.162-0.757 0.167-0.166 0.372-0.434 0.557-0.65 0.146-0.179 0.271-0.384 0.366-0.604l0.006-0.017c0.043-0.087 0.068-0.188 0.068-0.296 0-0.131-0.037-0.253-0.101-0.357l0.002 0.003c-0.094-0.186-0.836-2.014-1.145-2.758-0.302-0.724-0.609-0.625-0.836-0.637-0.216-0.010-0.464-0.012-0.712-0.012-0.395 0.010-0.746 0.188-0.988 0.463l-0.001 0.002c-0.802 0.761-1.3 1.834-1.3 3.023 0 0.026 0 0.053 0.001 0.079l-0-0.004c0.131 1.467 0.681 2.784 1.527 3.857l-0.012-0.015c1.604 2.379 3.742 4.282 6.251 5.564l0.094 0.043c0.548 0.248 1.25 0.513 1.968 0.74l0.149 0.041c0.442 0.14 0.951 0.221 1.479 0.221 0.303 0 0.601-0.027 0.889-0.078l-0.031 0.004c1.069-0.223 1.956-0.868 2.497-1.749l0.009-0.017c0.165-0.366 0.261-0.793 0.261-1.242 0-0.185-0.016-0.366-0.047-0.542l0.003 0.019c-0.092-0.155-0.34-0.247-0.712-0.434z" />
    </svg>
  )
}

export const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [step, setStep] = useState<'password' | 'mfa' | 'reset'>('password');
  const [totpToken, setTotpToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // WhatsApp modal
  const [waOpen, setWaOpen] = useState(false);
  const [waStep, setWaStep] = useState<'phone' | 'otp'>('phone');
  const [waPhone, setWaPhone] = useState('');
  const [waOtp, setWaOtp] = useState('');

  useEffect(() => { injectFonts(); }, []);

  // Check existing cookie auth - no escalation, OTP-only
  useEffect(() => {
    setCheckingAuth(true);
    fetch(`${API_BASE_URL}/api/admin/dashboard`, { credentials: 'include' })
      .then(res => {
        if (res.ok) navigate('/admin/verifications');
        else setCheckingAuth(false);
      })
      .catch(() => setCheckingAuth(false));
  }, [navigate]);

  // Auto-focus TOTP input when step changes
  useEffect(() => {
    if (step === 'mfa') otpInputRef.current?.focus();
  }, [step]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (res.status === 401 && data.requires_totp) {
        // Password accepted - prompt for the second factor
        setStep('mfa');
        setMsg({ text: 'Password accepted. Complete the second factor to finish signing in.', ok: true });
        return;
      }

      if (!res.ok) {
        setError(data.message || 'Invalid credentials');
        return;
      }

      // Token is set as httpOnly cookie by the server
      navigate('/admin/verifications');
    } catch (err: any) {
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, totp_token: totpToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Invalid 2FA token');
        return;
      }

      navigate('/admin/verifications');
    } catch (err: any) {
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  const handleWaSendOtp = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/whatsapp/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone_number: waPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send OTP');
      setWaStep('otp');
    } catch (err: any) {
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  const handleWaVerify = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/whatsapp/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone_number: waPhone, otp_code: waOtp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'OTP verification failed');
      if (data.is_new) {
        // New user - needs registration completion
        setError('New account detected. Please complete registration.');
        return;
      }
      navigate('/admin/verifications');
    } catch (err: any) {
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  // Spinner while checking existing auth
  if (checkingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--paper)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--sans)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner-glass" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--mid)', fontSize: 14 }}>Authenticating...</p>
        </div>
      </div>
    );
  }

  const eyebrow =
    step === 'password'
      ? '// kabila / admin console'
      : step === 'mfa'
        ? '// kabila / admin console · 2fa'
        : '// kabila / admin console · reset';

  return (
    <div className="login-shell" style={{
      minHeight: '100vh',
      backgroundColor: 'var(--paper)',
      fontFamily: 'var(--sans)',
    }}>
      {/* Photographed bogolan print + radial veil - the door standard */}
      <div className="pattern-layer is-photo" style={{ backgroundImage: PRINT }} aria-hidden="true" />
      <div className="pattern-veil" aria-hidden="true" />

      {/* Wordmark */}
      <div className="wordmark">
        <div className="brand-mark"><span /><span /><span /><span /></div>
        kabila
      </div>

      {/* Single glass card */}
      <div className="glass-card">
        <div className="glass-eyebrow">
          {eyebrow}
          <span className="tag">org admin</span>
        </div>

        {msg && (
          <div className={`msg-box ${msg.ok ? 'ok' : 'err'}`} style={{ display: 'block' }}>
            {msg.text}
          </div>
        )}
        {error && (
          <div className="msg-box err" style={{ display: 'block' }}>
            {error}
          </div>
        )}

        {/* 1. PASSWORD STEP */}
        {step === 'password' && (
          <form onSubmit={handleLogin}>
            <label className="glass-lbl" htmlFor="email">Work Email</label>
            <input
              className="glass-inp"
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@kabila.example"
              autoComplete="username"
              required
              style={{ marginBottom: 12 }}
            />

            <label className="glass-lbl" htmlFor="password">Password</label>
            <div className="inp-wrap">
              <input
                className="glass-inp"
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="inp-toggle"
                onClick={() => setShowPw(!showPw)}
                tabIndex={-1}
              >
                {showPw ? 'hide' : 'show'}
              </button>
            </div>

            <div className="rowline">
              <a href="#" onClick={(e) => { e.preventDefault(); setStep('reset'); setError(''); setMsg(null); }}>
                Forgot password?
              </a>
            </div>

            <button type="submit" className="btn-accent" disabled={loading}>
              {loading ? 'Checking…' : 'Sign in ->'}
            </button>

            <div className="div-or">or</div>

            {/* Uniform WhatsApp button - accent outline, same geometry */}
            <button
              type="button"
              className="btn-accent"
              disabled={loading}
              onClick={() => { setError(''); setMsg(null); setWaOpen(true); setWaStep('phone'); }}
            >
              <WhatsAppGlyph />
              Sign in with WhatsApp
            </button>
          </form>
        )}

        {/* 2. MFA STEP */}
        {step === 'mfa' && (
          <form onSubmit={handleMfa}>
            <div className="handoff">
              <div className="symbol">
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                  <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div><strong>Password accepted.</strong> Complete the second factor to finish signing in.</div>
            </div>

            <label className="glass-lbl" htmlFor="mfa">Authenticator Code</label>
            <div className="inp-wrap">
              <input
                ref={otpInputRef}
                className="glass-inp code"
                id="mfa"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </div>

            <button type="submit" className="btn-accent" disabled={loading || totpToken.length !== 6}>
              {loading ? 'Verifying…' : 'Verify & open console ->'}
            </button>
            <button
              type="button"
              className="back-link"
              onClick={() => { setStep('password'); setTotpToken(''); setError(''); setMsg(null); }}
            >
              &larr; Use a different account
            </button>
          </form>
        )}

        {/* 3. RESET STEP */}
        {step === 'reset' && (
          <form onSubmit={(e) => { e.preventDefault(); setMsg({ text: 'Reset request queued. If the account exists, a reset link is on its way. Contact another org admin if not.', ok: true }); }}>
            <label className="glass-lbl" htmlFor="resetEmail">Work Email</label>
            <input
              className="glass-inp"
              id="resetEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@kabila.example"
              required
              style={{ marginBottom: 12 }}
            />
            <button type="submit" className="btn-accent" disabled={loading}>
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              className="back-link"
              onClick={() => { setStep('password'); setError(''); setMsg(null); }}
            >
              &larr; Back to sign in
            </button>
          </form>
        )}

        {/* Footer - Terms · Privacy · Help */}
        <div className="glass-card-foot">
          <a href="#">Terms</a><span className="dot-sep">·</span><a href="#">Privacy</a><span className="dot-sep">·</span><a href="#">Help</a>
        </div>
      </div>

      {/* WHATSAPP OTP MODAL */}
      {waOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={() => setWaOpen(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setWaOpen(false)}>×</button>

            <div className="wa-head">
              <svg className="glyph" viewBox="0 0 32 32">
                <path d="M26.576 5.363c-2.69-2.69-6.406-4.354-10.511-4.354-8.209 0-14.865 6.655-14.865 14.865 0 2.732 0.737 5.291 2.022 7.491l-0.038-0.070-2.109 7.702 7.879-2.067c2.051 1.139 4.498 1.809 7.102 1.809h0.006c8.209-0.003 14.862-6.659 14.862-14.868 0-4.103-1.662-7.817-4.349-10.507l0 0zM16.062 28.228h-0.005c-0 0-0.001 0-0.001 0-2.319 0-4.489-0.64-6.342-1.753l0.056 0.031-0.451-0.267-4.675 1.227 1.247-4.559-0.294-0.467c-1.185-1.862-1.889-4.131-1.889-6.565 0-6.822 5.531-12.353 12.353-12.353s12.353 5.531 12.353 12.353c0 6.822-5.53 12.353-12.353 12.353h-0zM22.838 18.977c-0.371-0.186-2.197-1.083-2.537-1.208-0.341-0.124-0.589-0.185-0.837 0.187-0.246 0.371-0.958 1.207-1.175 1.455-0.216 0.249-0.434 0.279-0.805 0.094-1.15-0.466-2.138-1.087-2.997-1.852l0.010 0.009c-0.799-0.74-1.484-1.587-2.037-2.521l-0.028-0.052c-0.216-0.371-0.023-0.572 0.162-0.757 0.167-0.166 0.372-0.434 0.557-0.65 0.146-0.179 0.271-0.384 0.366-0.604l0.006-0.017c0.043-0.087 0.068-0.188 0.068-0.296 0-0.131-0.037-0.253-0.101-0.357l0.002 0.003c-0.094-0.186-0.836-2.014-1.145-2.758-0.302-0.724-0.609-0.625-0.836-0.637-0.216-0.010-0.464-0.012-0.712-0.012-0.395 0.010-0.746 0.188-0.988 0.463l-0.001 0.002c-0.802 0.761-1.3 1.834-1.3 3.023 0 0.026 0 0.053 0.001 0.079l-0-0.004c0.131 1.467 0.681 2.784 1.527 3.857l-0.012-0.015c1.604 2.379 3.742 4.282 6.251 5.564l0.094 0.043c0.548 0.248 1.25 0.513 1.968 0.74l0.149 0.041c0.442 0.14 0.951 0.221 1.479 0.221 0.303 0 0.601-0.027 0.889-0.078l-0.031 0.004c1.069-0.223 1.956-0.868 2.497-1.749l0.009-0.017c0.165-0.366 0.261-0.793 0.261-1.242 0-0.185-0.016-0.366-0.047-0.542l0.003 0.019c-0.092-0.155-0.34-0.247-0.712-0.434z" />
              </svg>
              <h3>WhatsApp Login</h3>
            </div>

            {waStep === 'phone' ? (
              <div>
                <p className="desc">Enter your phone number registered with WhatsApp to receive a 6-digit login verification OTP.</p>
                <label className="glass-lbl" htmlFor="waPhone">Phone Number</label>
                <input
                  className="glass-inp"
                  id="waPhone"
                  type="tel"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  placeholder="+256701234567"
                  autoComplete="tel"
                  style={{ marginBottom: 14 }}
                />
                <button
                  className="btn-accent"
                  type="button"
                  disabled={loading}
                  onClick={() => void handleWaSendOtp()}
                >
                  {loading ? 'Sending…' : 'Send WhatsApp OTP ->'}
                </button>
              </div>
            ) : (
              <div>
                <p className="desc">Enter the 6-digit verification code sent to your WhatsApp number.</p>
                <label className="glass-lbl" htmlFor="waOtpCode">6-Digit Code</label>
                <div className="inp-wrap">
                  <input
                    className="glass-inp code"
                    id="waOtpCode"
                    type="text"
                    placeholder="123456"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={waOtp}
                    onChange={(e) => setWaOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <button
                  className="btn-accent"
                  type="button"
                  disabled={loading || waOtp.length !== 6}
                  onClick={() => void handleWaVerify()}
                >
                  {loading ? 'Verifying…' : 'Verify & Sign In'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};