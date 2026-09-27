import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, session, ugx } from '../api.js'

const METHODS = [
  { id: 'mtn_momo', icon: 'hgi-smart-phone-01', label: 'MTN MoMo' },
  { id: 'airtel_money', icon: 'hgi-smart-phone-01', label: 'Airtel Money' },
  { id: 'bank', icon: 'hgi-bank', label: 'Bank transfer' },
]

// Quote + payment page. Also the share target: works signed-out via the reference.
export default function QuotePay() {
  const { reference } = useParams()
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('mtn_momo')
  const [payPhone, setPayPhone] = useState('')
  const [payment, setPayment] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('GET', `/quotes/${reference}`).then(setQuote).catch((e) => setError(e.message))
  }, [reference])

  async function pay() {
    setBusy(true); setError('')
    try {
      const p = await api('POST', '/payments', {
        quote_reference: reference, method, payer_phone: payPhone || undefined,
      })
      setPayment(p)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  if (error && !quote) return <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}><div className="empty">{error}</div></div>
  if (!quote) return <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}><div className="empty">Loading quote...</div></div>

  const v = quote.vehicle || {}
  const role = session().role
  const needsCustomerAccount = !quote.customer_attached && role !== 'customer'
  const needsRoleSwitch = Boolean(role && role !== 'customer')
  const quotePath = `/quote/${reference}`
  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 24, color: 'var(--navy)', marginBottom: 4 }}>
        Review and pay
      </h1>
      <p style={{ color: 'var(--mid)', marginBottom: 16 }}>Quote <b>{quote.reference}</b> - valid until {new Date(quote.valid_until).toLocaleDateString('en-GB')}</p>

      <table className="table">
        <tbody>
          <tr><td>Vehicle</td><td align="right">{[v.year, v.make, v.model].filter(Boolean).join(' ')}</td></tr>
          <tr><td>Number plate</td><td align="right">{v.plate}</td></tr>
          <tr><td>Car value</td><td align="right">{ugx(quote.value)}</td></tr>
          <tr><td>Cover</td><td align="right">Car body, third party, driver</td></tr>
          <tr><td><b>Annual premium</b></td><td align="right"><b>{ugx(quote.premium)}</b></td></tr>
        </tbody>
      </table>

      {needsRoleSwitch ? (
        <div className="result-band" style={{ marginTop: 16 }}>
          <div className="amount small">Continue as the policyholder</div>
          <div className="meta">You are signed in as {role.replace('_', ' ')}. Sign out, then use the policyholder’s customer account to continue checkout.</div>
          <Link className="btn primary" style={{ display: 'flex', width: '100%', marginTop: 14 }}
                to={`/logout?next=${encodeURIComponent(quotePath)}`}>Sign out and continue</Link>
        </div>
      ) : needsCustomerAccount ? (
        <div className="result-band" style={{ marginTop: 16 }}>
          <div className="amount small">Connect this quote to your customer account</div>
          <div className="meta">Sign in or set up a customer account before paying. This lets Protecta Bode attach the payment to your policy and documents.</div>
          <Link className="btn primary" style={{ display: 'flex', width: '100%', marginTop: 14 }}
                to="/login" state={{ from: quotePath }}>Sign in or set up an account</Link>
        </div>
      ) : !payment ? (
        <>
          <div className="methods">
            {METHODS.map((m) => (
              <div key={m.id} className={`method${method === m.id ? ' active' : ''}`}
                   onClick={() => setMethod(m.id)}
                   onKeyDown={(event) => {
                     if (event.key === 'Enter' || event.key === ' ') {
                       event.preventDefault()
                       setMethod(m.id)
                     }
                   }}
                   role="button" aria-pressed={method === m.id} tabIndex={0}>
                <i className={`hgi-stroke ${m.icon}`} aria-hidden="true" />{m.label}
              </div>
            ))}
          </div>
          {method !== 'bank' && (
            <div className="field">
              <label htmlFor="payPhone">Mobile money number</label>
              <input id="payPhone" inputMode="tel" placeholder="07XX XXX XXX" value={payPhone}
                     onChange={(e) => setPayPhone(e.target.value)} />
              <span className="hint">Follow your mobile-money provider’s instructions after starting payment. The policy is issued once payment is confirmed.</span>
            </div>
          )}
          {error && <p style={{ color: 'var(--error)', marginBottom: 10 }}>{error}</p>}
          <button className="btn primary" style={{ width: '100%' }} onClick={pay} disabled={busy}>
            {busy ? 'Sending...' : `Pay ${ugx(quote.premium)}`}
          </button>
        </>
      ) : (
        <div className="result-band" style={{ marginTop: 16 }}>
          <div className="amount small">{payment.message}</div>
          <div className="meta">Payment reference <b>{payment.payment_ref}</b>. Your policy is issued the moment payment is confirmed, and the documents are emailed to you.</div>
        </div>
      )}
    </div>
  )
}
