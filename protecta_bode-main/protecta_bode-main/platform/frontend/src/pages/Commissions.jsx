import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

const STATUS_CLASS = { accrued: 'muted', payable: 'warn', paid: 'ok', clawed_back: 'err' }
const monthNow = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export default function Commissions() {
  const [month, setMonth] = useState(monthNow)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setReport(null); setError('')
    api('GET', `/reports/my-commissions?month=${month}`)
      .then(setReport)
      .catch((requestError) => setError(requestError.message))
  }, [month])

  return (
    <>
      <div className="page-head">
        <div><h1>Commissions</h1><span className="sub">Your sales earnings</span></div>
        <label className="filter-control">
          <span className="sr-only">Commission month</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!error && !report && <p className="section-copy">Loading commission report...</p>}
      {report && (
        <>
          <div className="grid c3 commission-stats">
            <div className="stat"><div className="label">Total commission</div><div className="value">{ugx(report.total_ugx)}</div></div>
            <div className="stat"><div className="label">Payable</div><div className="value">{ugx(report.payable_ugx)}</div></div>
            <div className="stat"><div className="label">Paid out</div><div className="value">{ugx(report.paid_ugx)}</div></div>
          </div>
          {report.items.length === 0 ? <p className="empty">No commissions recorded for {report.month}.</p> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Policy</th><th>Status</th><th className="num">Rate</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {report.items.map((item, index) => (
                  <tr key={`${item.policy_no}-${index}`}>
                    <td>{dateLabel(item.created_at)}</td>
                    <td><b>{item.policy_no || 'Policy pending'}</b></td>
                    <td><span className={`badge ${STATUS_CLASS[item.status] || 'muted'}`}>{item.status.replaceAll('_', ' ')}</span></td>
                    <td className="num">{(Number(item.rate) * 100).toLocaleString('en-UG')}%</td>
                    <td className="num">{ugx(item.amount_ugx)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  )
}
