import { useEffect, useState } from 'react'
import { api } from '../api.js'

const BADGE = { reported: 'warn', assigned: 'warn', assessed: 'warn', approved: 'ok', rejected: 'err', settled: 'ok' }

export default function Claims() {
  const [policies, setPolicies] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [form, setForm] = useState({ policy_no: '', incident_date: '', description: '', location: '' })

  useEffect(() => {
    api('GET', '/policies/mine').then((rows) => {
      setPolicies(rows)
      if (rows[0]) setForm((f) => ({ ...f, policy_no: rows[0].policy_no }))
    }).catch((e) => setError(e.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setDone('')
    try {
      const c = await api('POST', '/claims', form)
      setDone(`Claim ${c.reference} received. Our team will contact you.`)
      setForm({ policy_no: policies[0]?.policy_no || '', incident_date: '', description: '', location: '' })
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head"><h1>Claims</h1></div>
      <div className="grid c2">
        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 18, color: 'var(--navy)', marginBottom: 12 }}>Report an incident</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="pol">Policy</label>
              <select id="pol" value={form.policy_no} onChange={(e) => setForm({ ...form, policy_no: e.target.value })} required>
                {policies.length === 0 && <option value="">No policies on file</option>}
                {policies.map((p) => <option key={p.policy_no} value={p.policy_no}>{p.policy_no} ({p.status})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="date">Date of incident</label>
              <input id="date" type="date" value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="loc">Location</label>
              <input id="loc" placeholder="e.g. Kampala - Jinja road" value={form.location}
                     onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="desc">What happened?</label>
              <textarea id="desc" rows={4} minLength={20} value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </div>
            {done && <div className="otp-note" style={{ marginBottom: 10 }}>{done}</div>}
            {error && <p style={{ color: 'var(--error)', marginBottom: 10 }}>{error}</p>}
            <button className="btn primary" disabled={busy || policies.length === 0}>
              {busy ? 'Sending...' : 'Submit claim'}
            </button>
          </form>
        </div>
        <div className="card">
          <h2 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 18, color: 'var(--navy)', marginBottom: 12 }}>What we will need</h2>
          <ul style={{ paddingLeft: 18, display: 'grid', gap: 8, color: 'var(--ink)' }}>
            <li>Fully filled claim form (provided by Liberty)</li>
            <li>Police report, where applicable</li>
            <li>Treatment notes and medical bills (driver cover claims)</li>
            <li>Post-mortem report and death certificate, in case of fatality</li>
            <li>LC1 letter, where required</li>
          </ul>
          <p style={{ color: 'var(--mid)', fontSize: 13, marginTop: 12 }}>
            Repairs are carried out at Liberty-approved garages only.
          </p>
        </div>
      </div>
    </>
  )
}
