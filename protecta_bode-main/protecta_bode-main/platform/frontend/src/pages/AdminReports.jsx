import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

export default function AdminReports() {
  const [flash, setFlash] = useState(null)
  const [agents, setAgents] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api('GET', '/reports/daily-flash'),
      api('GET', '/reports/agent-performance?days=30'),
    ]).then(([daily, performance]) => {
      setFlash(daily)
      setAgents(performance.agents)
    }).catch((requestError) => setError(requestError.message))
  }, [])

  return (
    <>
      <div className="page-head"><div><h1>Reports</h1><span className="sub">Operations and distribution</span></div></div>
      {error && <p className="form-error">{error}</p>}
      {flash && (
        <section className="report-section">
          <div className="section-heading-row">
            <h2 className="section-heading">Daily flash</h2>
            <span className="machine-label">{flash.date}</span>
          </div>
          <div className="grid c3 report-stats">
            <div className="stat"><div className="label">Quotes</div><div className="value">{flash.quotes}</div></div>
            <div className="stat"><div className="label">Policies issued</div><div className="value">{flash.policies_issued}</div></div>
            <div className="stat"><div className="label">Gross written premium</div><div className="value">{ugx(flash.gwp_ugx)}</div></div>
          </div>
        </section>
      )}
      {agents && (
        <section className="report-section">
          <div className="section-heading-row">
            <h2 className="section-heading">Agent performance</h2>
            <span className="machine-label">last 30 days</span>
          </div>
          {agents.length === 0 ? <p className="empty">No agent activity in this period.</p> : (
            <table className="table">
              <thead><tr><th>Agent</th><th className="num">Quotes</th><th className="num">Converted</th><th className="num">Conversion</th><th className="num">GWP</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agent_id}>
                    <td>{agent.name}</td>
                    <td className="num">{agent.quotes}</td>
                    <td className="num">{agent.converted}</td>
                    <td className="num">{agent.conversion_pct}%</td>
                    <td className="num">{ugx(agent.gwp_ugx)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  )
}
