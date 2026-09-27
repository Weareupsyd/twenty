import { useEffect, useState } from 'react'
import { api } from '../api.js'

const dateLabel = (value) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''
const STATE_CLASS = { delivered: 'ok', failed: 'err', sending: 'warn', pending: 'muted' }

export default function Integrations() {
  const [partners, setPartners] = useState(null)
  const [deliveries, setDeliveries] = useState(null)
  const [urls, setUrls] = useState({})
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState('production')
  const [newWebhookUrl, setNewWebhookUrl] = useState('')
  const [revealed, setRevealed] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    try {
      const [partnerRows, deliveryRows] = await Promise.all([
        api('GET', '/integrations/partners'),
        api('GET', '/integrations/webhooks/deliveries?limit=100'),
      ])
      setPartners(partnerRows)
      setDeliveries(deliveryRows)
      setUrls((current) => ({
        ...Object.fromEntries(partnerRows.map((partner) => [partner.client_id, partner.webhook_url || ''])),
        ...current,
      }))
    } catch (requestError) { setError(requestError.message) }
  }

  useEffect(() => { load() }, [])

  async function createPartner(event) {
    event.preventDefault()
    setBusy('create'); setError(''); setNotice(''); setRevealed(null)
    try {
      const created = await api('POST', '/integrations/partners', {
        name, environment, webhook_url: newWebhookUrl || undefined,
      })
      setRevealed({ title: 'New partner credentials', credentials: created })
      setName(''); setNewWebhookUrl('')
      setNotice(`${created.name} is ready to connect to Protecta Bode.`)
      await load()
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy('') }
  }

  async function saveWebhook(clientId) {
    setBusy(clientId); setError(''); setNotice(''); setRevealed(null)
    try {
      const configured = await api('POST', `/integrations/partners/${clientId}/webhook`, { url: urls[clientId] })
      setRevealed({ title: `Signing secret for ${configured.name}`, credentials: configured })
      setNotice('Webhook is enabled. Copy the signing secret now; it will not be shown again.')
      await load()
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy('') }
  }

  async function disableWebhook(clientId) {
    setBusy(clientId); setError(''); setNotice(''); setRevealed(null)
    try {
      await api('DELETE', `/integrations/partners/${clientId}/webhook`)
      setNotice('Outbound webhook disabled.')
      await load()
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy('') }
  }

  async function retry(row) {
    setBusy(`retry-${row.id}`); setError('')
    try {
      await api('POST', `/integrations/webhooks/deliveries/${row.id}/retry`)
      setNotice(`Retry queued for ${row.delivery_id}.`)
      await load()
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy('') }
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Copied to clipboard. Store it securely.')
    } catch {
      setNotice('Select and copy this value now, then store it securely.')
    }
  }

  return (
    <>
      <div className="page-head"><div><h1>Integrations</h1><span className="sub">Partner API and signed webhooks</span></div></div>
      <p className="section-copy">Connect external systems to Protecta Bode using partner credentials and signed event callbacks. Secrets are displayed once when created or rotated.</p>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {revealed && (
        <section className="secret-panel" aria-live="polite">
          <div className="section-heading-row"><h2 className="section-heading">{revealed.title}</h2><button className="text-button" onClick={() => setRevealed(null)}>Hide</button></div>
          {revealed.credentials.client_id && <SecretValue label="Client ID" value={revealed.credentials.client_id} onCopy={copy} />}
          {revealed.credentials.client_secret && <SecretValue label="Client secret" value={revealed.credentials.client_secret} onCopy={copy} />}
          {revealed.credentials.webhook_secret && <SecretValue label="Webhook signing secret" value={revealed.credentials.webhook_secret} onCopy={copy} />}
          <p className="section-copy">Never put these credentials in browser code or public repositories. Use the client secret to request a short-lived access token.</p>
        </section>
      )}

      <div className="grid c2 support-grid integrations-grid">
        <section className="card" aria-labelledby="new-integration-title">
          <h2 id="new-integration-title" className="section-heading">Add a system</h2>
          <form onSubmit={createPartner}>
            <div className="field"><label htmlFor="integration-name">System or partner name</label>
              <input id="integration-name" value={name} required maxLength={120} onChange={(event) => setName(event.target.value)} /></div>
            <div className="field"><label htmlFor="integration-environment">Environment</label>
              <select id="integration-environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
                <option value="sandbox">Sandbox</option><option value="production">Production</option>
              </select></div>
            <div className="field"><label htmlFor="new-webhook-url">Outbound webhook URL <span className="label-note">(optional)</span></label>
              <input id="new-webhook-url" type="url" placeholder="https://partner.example/webhooks/protecta" value={newWebhookUrl}
                     onChange={(event) => setNewWebhookUrl(event.target.value)} /></div>
            <button className="btn primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creating...' : 'Create credentials'} <span aria-hidden="true">→</span></button>
          </form>
        </section>

        <section className="card" aria-labelledby="delivery-title">
          <div className="section-heading-row"><h2 id="delivery-title" className="section-heading">Recent webhook deliveries</h2><button className="text-button" onClick={load}>Refresh</button></div>
          {deliveries === null && <p className="section-copy">Loading delivery history...</p>}
          {deliveries?.length === 0 && <p className="empty">No outbound events yet.</p>}
          {deliveries?.length > 0 && (
            <div className="table-scroll"><table className="table">
              <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
              <tbody>{deliveries.map((row) => (
                <tr key={row.id}>
                  <td>{dateLabel(row.created_at)}</td>
                  <td><b>{row.event}</b><small className="table-note neutral">{row.target_host}</small>{row.last_error && <small className="table-note">{row.last_error}</small>}</td>
                  <td><span className={`badge ${STATE_CLASS[row.status] || 'muted'}`}>{row.status}</span>{row.response_status ? <small className="table-note neutral">HTTP {row.response_status}</small> : null}</td>
                  <td>{row.attempts}</td>
                  <td>{row.status === 'failed' && <button className="btn ghost" disabled={busy === `retry-${row.id}`} onClick={() => retry(row)}>Retry</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>

      <section className="report-section" aria-labelledby="partners-title">
        <div className="section-heading-row"><h2 id="partners-title" className="section-heading">Connected systems</h2><span className="machine-label">{partners?.length ?? '...'}</span></div>
        {partners === null && <p className="section-copy">Loading partner systems...</p>}
        {partners?.length === 0 && <p className="empty">No integrations have been added.</p>}
        {partners?.map((partner) => (
          <article className="integration-row" key={partner.client_id}>
            <div className="integration-heading">
              <div><h3>{partner.name}</h3><span className="machine-label">{partner.client_id} / {partner.environment}</span></div>
              <span className={`badge ${partner.is_active ? 'ok' : 'err'}`}>{partner.is_active ? 'active' : 'disabled'}</span>
            </div>
            <div className="integration-config">
              <label className="field"><span>Outbound callback URL</span>
                <input type="url" placeholder="https://your-system.example/webhook" value={urls[partner.client_id] || ''}
                       onChange={(event) => setUrls({ ...urls, [partner.client_id]: event.target.value })} /></label>
              <div className="integration-actions">
                <button className="btn primary" disabled={busy === partner.client_id || !urls[partner.client_id]}
                        onClick={() => saveWebhook(partner.client_id)}>{partner.webhook_configured ? 'Rotate secret / save URL' : 'Enable webhook'}</button>
                {partner.webhook_configured && <button className="btn ghost" disabled={busy === partner.client_id}
                        onClick={() => disableWebhook(partner.client_id)}>Disable</button>}
              </div>
            </div>
            <p className="section-copy">{partner.webhook_configured ? `Events are signed and sent to ${partner.webhook_url}.` : 'No outbound callback configured.'}</p>
          </article>
        ))}
      </section>
    </>
  )
}

function SecretValue({ label, value, onCopy }) {
  return <div className="secret-value"><span>{label}</span><code>{value}</code><button className="btn ghost" onClick={() => onCopy(value)}>Copy</button></div>
}
