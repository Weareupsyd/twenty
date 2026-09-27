import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

const STATUS_CLASS = { initiated: 'muted', pending: 'warn', confirmed: 'ok', failed: 'err' }
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export default function Payments() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/payments/mine').then(setRows).catch((requestError) => setError(requestError.message))
  }, [])

  return (
    <>
      <div className="page-head"><div><h1>Payments</h1><span className="sub">Your payment history</span></div></div>
      {error && <p className="form-error">{error}</p>}
      {!error && rows === null && <p className="section-copy">Loading payment history...</p>}
      {!error && rows?.length === 0 && <p className="empty">No payments recorded yet.</p>}
      {rows?.length > 0 && (
        <table className="table">
          <thead><tr><th>Date</th><th>Reference</th><th>Method</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {rows.map((payment) => (
              <tr key={payment.payment_ref}>
                <td>{dateLabel(payment.created_at)}</td>
                <td><b>{payment.payment_ref}</b></td>
                <td>{payment.provider.replaceAll('_', ' ')}</td>
                <td>
                  <span className={`badge ${STATUS_CLASS[payment.status] || 'muted'}`}>{payment.status}</span>
                  {payment.failure_reason && <small className="table-note">{payment.failure_reason}</small>}
                </td>
                <td className="num">{ugx(payment.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
