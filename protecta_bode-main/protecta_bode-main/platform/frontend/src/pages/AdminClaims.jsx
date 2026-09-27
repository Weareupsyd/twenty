import { useEffect, useState } from 'react'
import { api } from '../api.js'

const NEXT = {
  reported: ['assigned', 'rejected'],
  assigned: ['assessed', 'rejected'],
  assessed: ['approved', 'rejected'],
  approved: ['settled'],
  rejected: [],
  settled: [],
}

// Claims console: move claims through the status machine.
export default function AdminClaims() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    try { setRows(await api('GET', '/claims')) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function move(ref, status) {
    setBusy(ref)
    try {
      await api('POST', `/claims/${ref}/status`, { status })
      await load()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <>
      <div className="page-head"><h1>Claims</h1><span className="sub">Reported - assigned - assessed - approved - settled</span></div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {rows && rows.length === 0 && <div className="card"><div className="empty">No claims filed.</div></div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Reference</th><th>Policy</th><th>Incident</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.reference}>
                <td><b>{c.reference}</b></td>
                <td>{c.policy_no}</td>
                <td>{c.incident_date}</td>
                <td><span className={`badge ${c.status === 'rejected' ? 'err' : c.status === 'settled' || c.status === 'approved' ? 'ok' : 'warn'}`}>{c.status}</span></td>
                <td align="right" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {NEXT[c.status].map((s) => (
                    <button key={s} className="btn ghost" style={{ padding: '6px 12px', fontSize: 12.5 }}
                            onClick={() => move(c.reference, s)} disabled={busy === c.reference}>
                      {s}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
