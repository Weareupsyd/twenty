import { useEffect, useState } from 'react'
import { api } from '../api.js'

const STATUS_CLASS = { open: 'warn', pending: 'muted', resolved: 'ok' }
const FILTERS = [
  { value: '', label: 'All requests' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
]
const dateLabel = (value) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''

export default function Helpdesk() {
  const [status, setStatus] = useState('open')
  const [tickets, setTickets] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function loadTickets() {
    setError('')
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : ''
      setTickets(await api('GET', `/support/tickets${query}`))
    } catch (requestError) {
      setError(requestError.message)
      setTickets([])
    }
  }

  useEffect(() => { loadTickets() }, [status])

  async function moveTicket(reference, nextStatus) {
    setBusy(reference); setError('')
    try {
      await api('POST', `/support/tickets/${reference}/status`, { status: nextStatus })
      await loadTickets()
    } catch (requestError) {
      setError(requestError.message)
    } finally { setBusy('') }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Helpdesk</h1><span className="sub">Customer support queue</span></div>
        <label className="filter-control">
          <span className="sr-only">Filter tickets by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {tickets === null && <p className="section-copy">Loading helpdesk requests...</p>}
      {tickets?.length === 0 && !error && <p className="empty">No requests in this queue.</p>}
      {tickets?.length > 0 && (
        <div className="ticket-list helpdesk-list">
          {tickets.map((ticket) => (
            <article className="ticket-row helpdesk-ticket" key={ticket.reference}>
              <div className="ticket-topline">
                <span className="ticket-ref">{ticket.reference}</span>
                <span className="badge">{ticket.priority}</span>
                <span className={`badge ${STATUS_CLASS[ticket.status] || 'muted'}`}>{ticket.status}</span>
                <time dateTime={ticket.created_at}>{dateLabel(ticket.created_at)}</time>
              </div>
              <div className="helpdesk-ticket-body">
                <div>
                  <h2>{ticket.subject}</h2>
                  <p className="ticket-description">{ticket.description}</p>
                </div>
                <div className="ticket-customer">
                  <b>{ticket.customer_name}</b>
                  <span>{ticket.customer_phone || 'No phone on file'}</span>
                  <small>{ticket.channel}</small>
                </div>
              </div>
              <div className="ticket-actions">
                {ticket.status !== 'open' && (
                  <button className="btn ghost" disabled={busy === ticket.reference}
                          onClick={() => moveTicket(ticket.reference, 'open')}>Reopen</button>
                )}
                {ticket.status === 'open' && (
                  <button className="btn ghost" disabled={busy === ticket.reference}
                          onClick={() => moveTicket(ticket.reference, 'pending')}>Mark pending</button>
                )}
                {ticket.status !== 'resolved' && (
                  <button className="btn primary" disabled={busy === ticket.reference}
                          onClick={() => moveTicket(ticket.reference, 'resolved')}>Resolve</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
