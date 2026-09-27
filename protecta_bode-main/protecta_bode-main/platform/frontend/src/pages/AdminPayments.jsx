import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

const BADGE = { initiated: 'muted', pending: 'warn', confirmed: 'ok', failed: 'err' }

// Reconciliation queue: confirm bank transfers / retry-view failed collections.
export default function AdminPayments() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    try { setRows(await api('GET', '/payments')) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function confirm(ref) {
    setBusy(ref)
    try {
      await api('POST', `/payments/${ref}/confirm-manual`)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <>
      <div className="page-head"><h1>Payments</h1><span className="sub">Reconcile and confirm</span></div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {rows && rows.length === 0 && <div className="card"><div className="empty">No payments yet.</div></div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Reference</th><th>Quote</th><th>Provider</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.payment_ref}>
                <td><b>{p.payment_ref}</b></td>
                <td>{p.quote_ref}</td>
                <td>{p.provider.replace('_', ' ')}</td>
                <td align="right">{ugx(p.amount)}</td>
                <td>
                  <span className={`badge ${BADGE[p.status] || 'muted'}`}>{p.status}</span>
                  {p.failure_reason ? <div style={{ fontSize: 11.5, color: 'var(--mid)' }}>{p.failure_reason}</div> : null}
                </td>
                <td align="right">
                  {(p.status === 'pending' || p.status === 'failed') && (
                    <button className="btn primary" style={{ padding: '7px 14px', fontSize: 13 }}
                            onClick={() => confirm(p.payment_ref)} disabled={busy === p.payment_ref}>
                      {busy === p.payment_ref ? '...' : 'Confirm'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
