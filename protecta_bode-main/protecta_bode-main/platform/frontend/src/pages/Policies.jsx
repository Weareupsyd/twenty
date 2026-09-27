import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, session, ugx } from '../api.js'

const BADGE = { active: 'ok', pending_payment: 'warn', lapsed: 'err', cancelled: 'muted', expired: 'muted' }

async function downloadPdf(policyNo, setBusy, setError) {
  setBusy(policyNo)
  setError('')
  try {
    const { token } = session()
    const res = await fetch(`/api/v1/policies/${policyNo}/document`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${policyNo}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    setError(e.message)
  } finally {
    setBusy('')
  }
}

export default function Policies() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    api('GET', '/policies/mine').then(setRows).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>My cover</h1>
        <Link className="btn primary" to="/quote"><i className="hgi-stroke hgi-add-01" aria-hidden="true" /> New quote</Link>
      </div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {!error && rows && rows.length === 0 && (
        <div className="card"><div className="empty">
          No policies yet. Cover your ride from <b>1.5%</b> of your car's value.<br /><br />
          <Link className="btn primary" to="/quote">Get a quote</Link>
        </div></div>
      )}
      {rows && rows.length > 0 && (
        <>
          <table className="table">
            <thead><tr><th>Policy</th><th>Status</th><th>Period</th><th style={{ textAlign: 'right' }}>Premium</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.policy_no}>
                  <td><b>{p.policy_no}</b></td>
                  <td><span className={`badge ${BADGE[p.status] || 'muted'}`}>{p.status.replace('_', ' ')}</span></td>
                  <td>{p.period_start} to {p.period_end}</td>
                  <td align="right">{ugx(p.premium)}</td>
                  <td align="right">
                    {p.status === 'active' && (
                      <button className="btn" disabled={busy === p.policy_no} onClick={() => downloadPdf(p.policy_no, setBusy, setError)}>
                        {busy === p.policy_no ? 'Preparing...' : 'Policy PDF'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 13, color: '#56607F' }}>
            The policy PDF is password protected: enter your phone number (digits only) to open it.
          </p>
        </>
      )}
    </>
  )
}
