import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

// Broker portal: agent performance for the broker's own tree.
export default function Broker() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/reports/agent-performance?days=30').then((r) => setRows(r.agents)).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <div className="page-head"><h1>Agent performance - last 30 days</h1></div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {rows && rows.length === 0 && <div className="card"><div className="empty">No agents yet. Onboard agents to start pushing the product.</div></div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Agent</th><th>Quotes</th><th>Converted</th><th>Conversion</th><th style={{ textAlign: 'right' }}>GWP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent_id}>
                <td><b>{r.name}</b></td>
                <td>{r.quotes}</td>
                <td>{r.converted}</td>
                <td><span className={`badge ${r.conversion_pct >= 30 ? 'ok' : r.conversion_pct > 0 ? 'warn' : 'muted'}`}>{r.conversion_pct}%</span></td>
                <td align="right">{ugx(r.gwp_ugx)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
