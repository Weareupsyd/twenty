import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

const STATUS_CLASS = { active: 'ok', pending_payment: 'warn', lapsed: 'err', cancelled: 'muted', expired: 'muted' }

export default function AdminPolicies() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/policies').then(setRows).catch((requestError) => setError(requestError.message))
  }, [])

  return (
    <>
      <div className="page-head"><div><h1>Policies</h1><span className="sub">Policy register</span></div></div>
      {error && <p className="form-error">{error}</p>}
      {!error && rows === null && <p className="section-copy">Loading policies...</p>}
      {!error && rows?.length === 0 && <p className="empty">No issued policies yet.</p>}
      {rows?.length > 0 && (
        <table className="table">
          <thead><tr><th>Policy</th><th>Customer</th><th>Vehicle</th><th>Status</th><th>Period</th><th className="num">Premium</th></tr></thead>
          <tbody>
            {rows.map((policy) => (
              <tr key={policy.policy_no}>
                <td><b>{policy.policy_no}</b></td>
                <td>{policy.customer_name}</td>
                <td>{[policy.vehicle?.plate, policy.vehicle?.make, policy.vehicle?.model].filter(Boolean).join(' ') || '-'}</td>
                <td><span className={`badge ${STATUS_CLASS[policy.status] || 'muted'}`}>{policy.status.replaceAll('_', ' ')}</span></td>
                <td>{policy.period_start} to {policy.period_end}</td>
                <td className="num">{ugx(policy.premium)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
