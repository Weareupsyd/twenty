import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

// Distribution tree: who is pushing the product, broker by broker, agent by agent.
export default function AdminBrokers({ brokerView = false }) {
  const [tree, setTree] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/reports/broker-tree').then((r) => setTree(r.brokers)).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <div className="page-head"><h1>{brokerView ? 'My team' : 'Distribution'}</h1><span className="sub">{brokerView ? 'Agents in your broker network' : 'Brokers and their agents'}</span></div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {tree && tree.length === 0 && <div className="card"><div className="empty">No brokers onboarded yet.</div></div>}
      {tree && tree.length > 0 && tree.map((b) => (
        <div className="card" key={b.broker_id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <b style={{ fontFamily: 'var(--display)', color: 'var(--navy)', fontSize: 17 }}>{b.broker}</b>
            <span style={{ color: 'var(--mid)', fontSize: 13.5 }}>
              GWP <b style={{ color: 'var(--navy)' }}>{ugx(b.gwp_ugx)}</b> - commission {ugx(b.commission_ugx)}
            </span>
          </div>
          {b.agents.length === 0 ? (
            <div className="empty" style={{ padding: 10 }}>No agents attached yet.</div>
          ) : (
            <table className="table" style={{ border: 0 }}>
              <thead><tr><th>Agent</th><th style={{ textAlign: 'right' }}>GWP</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
              <tbody>
                {b.agents.map((a) => (
                  <tr key={a.agent_id}>
                    <td>{a.name}</td>
                    <td align="right">{ugx(a.gwp_ugx)}</td>
                    <td align="right">{ugx(a.commission_ugx)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  )
}
