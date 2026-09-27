import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

// Agent portal: book of business + this month's commissions.
export default function Agent() {
  const month = new Date().toISOString().slice(0, 7)
  const [policies, setPolicies] = useState(null)
  const [comm, setComm] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/policies/mine').then(setPolicies).catch((e) => setError(e.message))
    api('GET', `/reports/my-commissions?month=${month}`).then(setComm).catch(() => {})
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>My book</h1>
        <a className="btn primary" href="/quote"><i className="hgi-stroke hgi-add-01" aria-hidden="true" /> Quote a customer</a>
      </div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      <div className="grid c3" style={{ marginBottom: 18 }}>
        <div className="stat"><div className="label">Policies sold</div><div className="value">{comm ? comm.items.length : '-'}</div></div>
        <div className="stat"><div className="label">Commission this month</div><div className="value">{comm ? ugx(comm.total_ugx) : '-'}</div></div>
        <div className="stat"><div className="label">Paid out</div><div className="value">{comm ? ugx(comm.paid_ugx) : '-'}</div></div>
      </div>
      {policies && policies.length === 0 && (
        <div className="card"><div className="empty">
          No sales yet. Quote a customer in under a minute - you only need their car value.
        </div></div>
      )}
      {policies && policies.length > 0 && (
        <table className="table">
          <thead><tr><th>Policy</th><th>Status</th><th>Period</th><th style={{ textAlign: 'right' }}>Premium</th></tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.policy_no}>
                <td><b>{p.policy_no}</b></td>
                <td><span className="badge muted">{p.status.replace('_', ' ')}</span></td>
                <td>{p.period_start} to {p.period_end}</td>
                <td align="right">{ugx(p.premium)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
