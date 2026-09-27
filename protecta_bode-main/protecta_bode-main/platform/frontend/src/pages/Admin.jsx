import { useEffect, useState } from 'react'
import { api, ugx } from '../api.js'

// Admin dashboard: today's flash numbers.
export default function Admin() {
  const [flash, setFlash] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', '/reports/daily-flash').then(setFlash).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <span className="sub">{flash ? `Today, ${flash.date}` : 'Loading...'}</span>
      </div>
      {error && <div className="card"><div className="empty">{error}</div></div>}
      {flash && (
        <>
          <div className="grid c3">
            <div className="stat"><div className="label">Quotes today</div><div className="value">{flash.quotes}</div></div>
            <div className="stat"><div className="label">Policies issued</div><div className="value">{flash.policies_issued}</div></div>
            <div className="stat"><div className="label">GWP today</div><div className="value">{ugx(flash.gwp_ugx)}</div></div>
          </div>
          {flash.by_channel && Object.keys(flash.by_channel).length > 0 && (
            <>
              <h2 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 17, color: 'var(--navy)', margin: '20px 0 10px' }}>Quotes by channel</h2>
              <div className="grid c3">
                {Object.entries(flash.by_channel).map(([ch, n]) => (
                  <div className="stat" key={ch}><div className="label">{ch.replace('_', ' ')}</div><div className="value small">{n}</div></div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
