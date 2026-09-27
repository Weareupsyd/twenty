import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, setSession } from '../api.js'

const emptyCode = () => ['', '', '', '', '', '']

const normalizePhone = (value) => {
  const digits = value.replace(/\D/g, '')
  if (value.trim().startsWith('+')) return `+${digits}`
  if (digits.startsWith('256')) return `+${digits}`
  return `+256${digits.replace(/^0+/, '')}`
}

const normalizeIdentifier = (value) => value.includes('@') ? value.trim().toLowerCase() : normalizePhone(value)

function OtpSlots({ value, onChange, idPrefix, autoFocus = false }) {
  const inputs = useRef([])

  function fillFrom(index, raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 6 - index)
    if (!digits) {
      const next = [...value]
      next[index] = ''
      onChange(next)
      return
    }
    const next = [...value]
    digits.split('').forEach((digit, offset) => { next[index + offset] = digit })
    onChange(next)
    inputs.current[Math.min(index + digits.length, 5)]?.focus()
  }

  function handleChange(index, raw) {
    const digits = raw.replace(/\D/g, '')
    if (digits.length > 1) {
      fillFrom(index, digits)
      return
    }
    const next = [...value]
    next[index] = digits.slice(-1)
    onChange(next)
    if (digits && index < 5) inputs.current[index + 1]?.focus()
  }

  function handleKeyDown(index, event) {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      inputs.current[index - 1]?.focus()
    } else if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault()
      inputs.current[index + 1]?.focus()
    } else if (event.key === 'Backspace' && !value[index] && index > 0) {
      event.preventDefault()
      const next = [...value]
      next[index - 1] = ''
      onChange(next)
      inputs.current[index - 1]?.focus()
    }
  }

  function handlePaste(index, event) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '')
    if (!digits) return
    event.preventDefault()
    fillFrom(index, digits)
  }

  return (
    <div className="otp-slots" role="group" aria-label="Six-digit verification code">
      {value.map((digit, index) => (
        <input
          key={`${idPrefix}-${index}`}
          ref={(node) => { inputs.current[index] = node }}
          id={`${idPrefix}-${index + 1}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Verification code digit ${index + 1} of 6`}
          maxLength={6}
          value={digit}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          required
          autoFocus={autoFocus && index === 0}
        />
      ))}
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [setup, setSetup] = useState(false)
  const [setupStep, setSetupStep] = useState('request')
  const [whatsappStep, setWhatsappStep] = useState('')
  const [username, setUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState(emptyCode)
  const [whatsappCode, setWhatsappCode] = useState(emptyCode)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [debugCode, setDebugCode] = useState('')
  const [deliveryHint, setDeliveryHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function finishLogin(result, fallbackName = '', afterPasswordSetup = false) {
    setSession(result.access_token, result.role, fallbackName)
    let profile = null
    try {
      profile = await api('GET', '/auth/me')
      setSession(result.access_token, result.role, profile.full_name || fallbackName)
    } catch {
      // Keep the token if profile refresh is temporarily unavailable.
    }
    const requested = location.state?.from
    const requestedPath = typeof requested === 'string' ? requested : requested?.pathname
    const destination = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/'
    if (afterPasswordSetup && result.role === 'customer' && profile?.kyc_status !== 'approved') {
      navigate('/app/kyc', { state: { from: destination } })
      return
    }
    navigate(destination)
  }

  async function login(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api('POST', '/auth/login-password', {
        username: normalizeIdentifier(username),
        password: loginPassword,
      })
      await finishLogin(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function requestSetupCode(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setCode(emptyCode())
    try {
      const result = await api('POST', '/auth/request-otp', {
        phone: normalizePhone(phone),
        email: email.trim() || undefined,
      })
      setDebugCode(result.debug_code || '')
      setDeliveryHint(result.delivery === 'email'
        ? 'Check the email address registered on the account for your code.'
        : 'Sandbox mode: use the code shown below.')
      setSetupStep('verify')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function setUpPassword(event) {
    event.preventDefault()
    setError('')
    if (code.join('').length !== 6) {
      setError('Enter all six digits of the verification code.')
      return
    }
    if (newPassword.length < 12) {
      setError('Choose a password with at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await api('POST', '/auth/verify-otp', {
        phone: normalizePhone(phone),
        code: code.join(''),
        full_name: fullName.trim(),
        password: newPassword,
      })
      await finishLogin(result, fullName.trim(), true)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function requestWhatsAppCode(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setWhatsappCode(emptyCode())
    try {
      const result = await api('POST', '/auth/request-whatsapp-otp', {
        phone: normalizePhone(whatsappPhone),
      })
      setDebugCode(result.debug_code || '')
      setWhatsappStep('verify')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyWhatsAppCode(event) {
    event.preventDefault()
    setError('')
    if (whatsappCode.join('').length !== 6) {
      setError('Enter all six digits of the WhatsApp code.')
      return
    }
    setBusy(true)
    try {
      const result = await api('POST', '/auth/verify-whatsapp-otp', {
        phone: normalizePhone(whatsappPhone),
        code: whatsappCode.join(''),
      })
      await finishLogin(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  function openSetup() {
    setSetup(true)
    setSetupStep('request')
    setWhatsappStep('')
    setCode(emptyCode())
    setError('')
    setDebugCode('')
    setDeliveryHint('')
  }

  function openWhatsAppLogin() {
    setSetup(false)
    setWhatsappStep('request')
    setWhatsappCode(emptyCode())
    setError('')
    setDebugCode('')
  }

  function returnToLogin() {
    setSetup(false)
    setSetupStep('request')
    setWhatsappStep('')
    setError('')
    setCode(emptyCode())
    setWhatsappCode(emptyCode())
    setDebugCode('')
    setDeliveryHint('')
  }

  const title = whatsappStep === 'request'
    ? 'Sign in with WhatsApp'
    : whatsappStep === 'verify'
      ? 'Verify your WhatsApp code'
      : setup
        ? (setupStep === 'request' ? 'Create or set up your login' : 'Verify and set password')
        : 'Sign in'

  return (
    <div className="login-wrap">
      <section className="login-card" aria-labelledby="login-title">
        <Link to="/" className="login-brand" aria-label="Protecta Bode home">
          <img src="/protecta-bode-logo.svg" alt="Protecta Bode by Liberty General Insurance" />
        </Link>
        <h1 id="login-title">{title}</h1>

        {!setup && !whatsappStep ? (
          <>
            <form onSubmit={login}>
              <div className="field">
                <label htmlFor="username">Username (phone number or email)</label>
                <input id="username" autoComplete="username" inputMode="text" placeholder="e.g. 0772 123 456 or you@example.com"
                       value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input id="login-password" type="password" autoComplete="current-password"
                       value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
              </div>
              {error && <p className="err" style={{ marginBottom: 10 }}>{error}</p>}
              <button className="btn primary login-submit" type="submit" disabled={busy}>
                {busy ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
            <div className="login-or" aria-hidden="true"><span>or</span></div>
            <button className="btn whatsapp-login-button" type="button" onClick={openWhatsAppLogin}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20.1 3.9A11.8 11.8 0 0 0 1.5 18.1L0 24l6-1.6a11.9 11.9 0 0 0 5.7 1.5h.1A11.9 11.9 0 0 0 20.1 3.9ZM11.8 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.6 1 1-3.5-.2-.4a9.8 9.8 0 1 1 8.2 4.5Zm5.4-7.3c-.3-.1-1.7-.8-2-.9-.2-.1-.5-.1-.7.2-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.4.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.3 0 1.4 1 2.6 1.1 2.8.1.2 2 3 4.8 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3Z" />
              </svg>
              Sign in with WhatsApp
            </button>
            <button className="text-button setup-link" type="button" onClick={openSetup}>
              New customer? Create an account or set up / reset your password
            </button>
          </>
        ) : whatsappStep === 'request' ? (
          <>
            <p className="login-sub">Enter the WhatsApp number registered to your account. If it matches an active account, we’ll send a six-digit code.</p>
            <form onSubmit={requestWhatsAppCode}>
              <div className="field">
                <label htmlFor="whatsapp-phone">WhatsApp phone number</label>
                <input id="whatsapp-phone" autoComplete="tel" inputMode="tel" placeholder="e.g. 0772 123 456"
                       value={whatsappPhone} onChange={(event) => setWhatsappPhone(event.target.value)} required autoFocus />
              </div>
              {error && <p className="err" style={{ marginBottom: 10 }}>{error}</p>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Sending...' : 'Send WhatsApp code'} <span aria-hidden="true">→</span>
              </button>
            </form>
            <button className="text-button" type="button" onClick={returnToLogin}>Back to sign in</button>
          </>
        ) : whatsappStep === 'verify' ? (
          <>
            <p className="login-sub">Enter the six-digit code sent through WhatsApp to {whatsappPhone}.</p>
            <form onSubmit={verifyWhatsAppCode}>
              <div className="field">
                <label id="whatsapp-code-label" htmlFor="whatsapp-code-1">WhatsApp code</label>
                <OtpSlots value={whatsappCode} onChange={setWhatsappCode} idPrefix="whatsapp-code" autoFocus />
                <span className="hint">If your number matches an active account, the code will arrive shortly.</span>
              </div>
              {debugCode && <div className="otp-note">Sandbox code: <b>{debugCode}</b></div>}
              {error && <p className="err" style={{ marginBottom: 10 }}>{error}</p>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Verifying...' : 'Verify and sign in'} <span aria-hidden="true">→</span>
              </button>
            </form>
            <button className="text-button" type="button" onClick={() => { setWhatsappStep('request'); setError(''); setWhatsappCode(emptyCode()); setDebugCode('') }}>
              Use a different phone number
            </button>
          </>
        ) : setupStep === 'request' ? (
          <>
            <p className="login-sub">A one-time code verifies the email on your account before a password is created or reset. New customers can enter their name and email to register.</p>
            <form onSubmit={requestSetupCode}>
              <div className="field">
                <label htmlFor="setup-phone">Phone number</label>
                <input id="setup-phone" autoComplete="tel" inputMode="tel" placeholder="e.g. 0772 123 456"
                       value={phone} onChange={(event) => setPhone(event.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="setup-email">Email address <span className="label-note">(new customers)</span></label>
                <input id="setup-email" type="email" autoComplete="email" placeholder="you@example.com"
                       value={email} onChange={(event) => setEmail(event.target.value)} />
                <span className="hint">Existing accounts receive codes at their registered email.</span>
              </div>
              {error && <p className="err" style={{ marginBottom: 10 }}>{error}</p>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Sending...' : 'Send verification code'} <span aria-hidden="true">→</span>
              </button>
            </form>
            <button className="text-button" type="button" onClick={returnToLogin}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="login-sub">Verify the code, then choose the password you will use next time.</p>
            <form onSubmit={setUpPassword}>
              <div className="field">
                <label id="setup-code-label" htmlFor="setup-code-1">One-time code</label>
                <OtpSlots value={code} onChange={setCode} idPrefix="setup-code" autoFocus />
                {deliveryHint && <span className="hint">{deliveryHint}</span>}
              </div>
              <div className="field">
                <label htmlFor="setup-name">Full name</label>
                <input id="setup-name" autoComplete="name" value={fullName}
                       onChange={(event) => setFullName(event.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <input id="new-password" type="password" autoComplete="new-password" minLength={12}
                       value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
                <span className="hint">Use at least 12 characters.</span>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">Confirm password</label>
                <input id="confirm-password" type="password" autoComplete="new-password"
                       value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              </div>
              {debugCode && <div className="otp-note">Sandbox code: <b>{debugCode}</b></div>}
              {error && <p className="err" style={{ marginBottom: 10 }}>{error}</p>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save password and continue'} <span aria-hidden="true">→</span>
              </button>
            </form>
            <button className="text-button" type="button" onClick={() => { setSetupStep('request'); setError(''); setCode(emptyCode()); setDebugCode('') }}>
              Use a different phone number
            </button>
          </>
        )}

        <div className="login-foot">
          <Link to="/">Back to Protecta Bode</Link>
          <a href="tel:+256312246500">Help: 0312 246500</a>
        </div>
      </section>
    </div>
  )
}
