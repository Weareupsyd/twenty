import { useEffect, useState } from 'react'
import { api } from '../api.js'

const STATUS_CLASS = { open: 'warn', pending: 'muted', resolved: 'ok' }
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export default function Support() {
  const [tickets, setTickets] = useState(null)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [loadingError, setLoadingError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadTickets() {
    try {
      setLoadingError('')
      setTickets(await api('GET', '/support/tickets/mine'))
    } catch (error) {
      setLoadingError(error.message)
      setTickets([])
    }
  }

  useEffect(() => { loadTickets() }, [])

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setSubmitError(''); setNotice('')
    try {
      const ticket = await api('POST', '/support/tickets', { subject, description })
      setNotice(`Request ${ticket.reference} has been sent to the Protecta Bode helpdesk.`)
      setSubject(''); setDescription('')
      await loadTickets()
    } catch (error) {
      setSubmitError(error.message)
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Support</h1><span className="sub">Help from the Protecta Bode team</span></div>
        <a className="btn ghost" href="tel:+256312246500">Call 0312 246500</a>
      </div>
      <div className="grid c2 support-grid">
        <section className="card" aria-labelledby="support-form-title">
          <h2 id="support-form-title" className="section-heading">Send us a request</h2>
          <p className="section-copy">Tell us what you need help with. We will reply using the contact details on your account.</p>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="support-subject">Subject</label>
              <input id="support-subject" value={subject} maxLength={160} minLength={4} required
                     placeholder="For example, a question about my policy"
                     onChange={(event) => setSubject(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="support-description">How can we help?</label>
              <textarea id="support-description" rows={5} value={description} minLength={10} maxLength={4000} required
                        placeholder="Share a few details so our team can help."
                        onChange={(event) => setDescription(event.target.value)} />
            </div>
            {notice && <p className="notice">{notice}</p>}
            {submitError && <p className="form-error">{submitError}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send to helpdesk'} <span aria-hidden="true">→</span>
            </button>
          </form>
          {loadingError && <p className="form-error support-load-error">Your request was sent, but we could not refresh the ticket list: {loadingError}</p>}
        </section>

        <section className="card" aria-labelledby="support-tickets-title">
          <div className="section-heading-row">
            <h2 id="support-tickets-title" className="section-heading">Your requests</h2>
            <span className="machine-label">{tickets?.length ?? '...'}</span>
          </div>
          {loadingError && !notice && <p className="form-error">{loadingError}</p>}
          {tickets === null && <p className="section-copy">Loading your support requests...</p>}
          {tickets?.length === 0 && !loadingError && <p className="empty">No support requests yet.</p>}
          {tickets?.length > 0 && (
            <div className="ticket-list">
              {tickets.map((ticket) => (
                <article className="ticket-row" key={ticket.reference}>
                  <div className="ticket-topline">
                    <span className="ticket-ref">{ticket.reference}</span>
                    <span className={`badge ${STATUS_CLASS[ticket.status] || 'muted'}`}>{ticket.status}</span>
                  </div>
                  <h3>{ticket.subject}</h3>
                  <p>{ticket.description}</p>
                  <time dateTime={ticket.created_at}>{dateLabel(ticket.created_at)}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
