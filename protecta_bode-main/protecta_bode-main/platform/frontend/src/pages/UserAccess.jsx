import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function UserAccess() {
  const [directory, setDirectory] = useState(null)
  const [role, setRole] = useState('agent')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [licence, setLicence] = useState('')
  const [brokerId, setBrokerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      setDirectory(await api('GET', '/users/distribution'))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  useEffect(() => { load() }, [])

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await api('POST', '/users/onboard', {
        full_name: fullName,
        phone,
        email: email || undefined,
        password,
        role,
        licence_no: licence,
        parent_broker_id: role === 'agent' && brokerId ? Number(brokerId) : undefined,
      })
      setNotice(`${created.full_name} is onboarded as ${created.role}. Share the initial password securely; use ${created.phone} as the username.`)
      setFullName(''); setPhone(''); setEmail(''); setPassword(''); setLicence(''); setBrokerId('')
      await load()
    } catch (requestError) {
      setError(requestError.message)
    } finally { setBusy(false) }
  }

  const agents = [
    ...(directory?.independent_agents || []),
    ...(directory?.brokers || []).flatMap((broker) => broker.agents),
  ]

  return (
    <>
      <div className="page-head"><div><h1>User access</h1><span className="sub">Onboard agents and brokers</span></div></div>
      <p className="section-copy">Customers create an account with email verification and set a password. Provision licensed agents and brokers here, then share their phone-as-username and initial password securely.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="grid c2 support-grid">
        <section className="card" aria-labelledby="onboard-title">
          <h2 id="onboard-title" className="section-heading">Add an agent or broker</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="onboard-role">Role</label>
              <select id="onboard-role" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="agent">Agent</option><option value="broker">Broker</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="onboard-name">Full name</label>
              <input id="onboard-name" value={fullName} required maxLength={120}
                     onChange={(event) => setFullName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="onboard-phone">Phone number</label>
              <input id="onboard-phone" inputMode="tel" placeholder="07XX XXX XXX" value={phone} required
                     onChange={(event) => setPhone(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="onboard-email">Email for one-time codes</label>
              <input id="onboard-email" type="email" autoComplete="email" value={email} required
                     onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="onboard-password">Initial password</label>
              <input id="onboard-password" type="password" autoComplete="new-password" value={password}
                     minLength={12} maxLength={128} required
                     onChange={(event) => setPassword(event.target.value)} />
              <span className="hint">Use at least 12 characters and share it through a secure channel.</span>
            </div>
            <div className="field">
              <label htmlFor="onboard-licence">Licence number</label>
              <input id="onboard-licence" value={licence} required maxLength={40}
                     onChange={(event) => setLicence(event.target.value)} />
            </div>
            {role === 'agent' && directory?.brokers?.length > 0 && (
              <div className="field">
                <label htmlFor="onboard-broker">Broker network <span className="label-note">(optional)</span></label>
                <select id="onboard-broker" value={brokerId} onChange={(event) => setBrokerId(event.target.value)}>
                  <option value="">Independent agent</option>
                  {directory.brokers.filter((broker) => broker.is_active).map((broker) => (
                    <option key={broker.id} value={broker.id}>{broker.full_name} - {broker.licence_no}</option>
                  ))}
                </select>
              </div>
            )}
            {notice && <p className="notice">{notice}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Saving...' : `Onboard ${role}`} <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
        <section className="card" aria-labelledby="directory-title">
          <div className="section-heading-row"><h2 id="directory-title" className="section-heading">Distribution accounts</h2><span className="machine-label">{agents.length} agents</span></div>
          {directory === null && <p className="section-copy">Loading user directory...</p>}
          {directory && directory.brokers.length === 0 && agents.length === 0 && <p className="empty">No brokers or agents onboarded yet.</p>}
          {directory?.brokers?.map((broker) => (
            <div className="directory-group" key={broker.id}>
              <div className="ticket-topline"><b>{broker.full_name}</b><span className="badge">Broker</span><span className="directory-meta">{broker.licence_no} / {broker.phone}</span></div>
              {broker.agents.length === 0 ? <p className="ticket-description">No agents assigned.</p> : (
                <table className="table"><thead><tr><th>Agent</th><th>Licence</th><th>Phone</th></tr></thead>
                  <tbody>{broker.agents.map((agent) => <tr key={agent.id}><td>{agent.full_name}</td><td>{agent.licence_no}</td><td>{agent.phone}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          ))}
          {directory?.independent_agents?.length > 0 && (
            <div className="directory-group">
              <h3 className="section-heading">Independent agents</h3>
              <table className="table"><thead><tr><th>Agent</th><th>Licence</th><th>Phone</th></tr></thead>
                <tbody>{directory.independent_agents.map((agent) => <tr key={agent.id}><td>{agent.full_name}</td><td>{agent.licence_no}</td><td>{agent.phone}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
