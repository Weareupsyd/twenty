import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, session } from '../api.js'

// Customers can start the hosted verification or ask the helpdesk for manual review.
// Identity documents are never uploaded to the Protecta Bode portal.
export default function Kyc() {
  const { name } = session()
  const location = useLocation()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualReference, setManualReference] = useState('')
  const initialLinkAttempted = useRef(false)

  const requestedPath = location.state?.from
  const returnPath = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/app'

  const generateLink = useCallback(async () => {
    setBusy(true)
    setError('')
    setCopyMessage('')
    try {
      const result = await api('POST', '/kyc/session')
      const generatedUrl = result.url || result.verification_url
      if (!generatedUrl) throw new Error('The KYC service did not return a verification link.')
      setUrl(generatedUrl)
    } catch (requestError) {
      setError(requestError.message || 'Could not generate a KYC link. Please try again or request manual verification.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (initialLinkAttempted.current) return
    initialLinkAttempted.current = true
    generateLink()
  }, [generateLink])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopyMessage('KYC link copied.')
    } catch {
      setCopyMessage('Copy is unavailable in this browser. Select and copy the link above.')
    }
  }

  async function requestManualReview() {
    setManualBusy(true)
    setManualError('')
    try {
      const ticket = await api('POST', '/support/tickets', {
        subject: 'Manual identity verification request',
        description: 'I would like to complete identity verification through a manual review. Please contact me using the details on my account with the approved next steps. I will not upload identity documents through this portal.',
      })
      setManualReference(ticket.reference)
    } catch (requestError) {
      setManualError(requestError.message)
    } finally {
      setManualBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Verify identity</h1><span className="sub">Choose how you would like to complete verification</span></div>
      </div>
      <p className="section-copy" style={{ marginBottom: 18 }}>
        {name ? `Hi ${name}. ` : ''}You can use the secure verification link or request a manual review. Have your National ID (NIN) or passport ready.
      </p>

      <div className="grid c2 support-grid">
        <section className="card" aria-labelledby="kyc-link-title">
          <h2 id="kyc-link-title" className="section-heading">Use a secure KYC link</h2>
          <p className="section-copy">A private link is generated for your account. Open it to submit your ID and complete the selfie check with our verification partner.</p>
          {busy && !url && <p className="empty">Generating your secure link...</p>}
          {error && <p className="form-error">{error}</p>}
          {url ? (
            <>
              <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">
                Open secure KYC link <i className="hgi-stroke hgi-arrow-right-01" aria-hidden="true" />
              </a>
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="generated-kyc-link">Generated KYC link</label>
                <input id="generated-kyc-link" type="url" value={url} readOnly onFocus={(event) => event.target.select()} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn ghost" type="button" onClick={copyLink}>Copy link</button>
                <button className="btn ghost" type="button" onClick={generateLink} disabled={busy}>
                  {busy ? 'Generating...' : 'Generate a new link'}
                </button>
              </div>
              {copyMessage && <p className="notice" style={{ marginTop: 10 }}>{copyMessage}</p>}
            </>
          ) : !busy && (
            <button className="btn primary" type="button" onClick={generateLink}>Try again</button>
          )}
        </section>

        <section className="card" aria-labelledby="kyc-manual-title">
          <h2 id="kyc-manual-title" className="section-heading">Request manual verification</h2>
          <p className="section-copy">If you cannot use the link, send a request to our team. We will contact you with the approved next steps. Do not send ID photos through this portal.</p>
          {manualError && <p className="form-error">{manualError}</p>}
          {manualReference ? (
            <p className="notice">Manual verification request {manualReference} has been sent to the helpdesk.</p>
          ) : (
            <button className="btn primary" type="button" onClick={requestManualReview} disabled={manualBusy}>
              {manualBusy ? 'Sending request...' : 'Request manual review'}
            </button>
          )}
          <p className="hint" style={{ marginTop: 14 }}>Need help? Call 0312 246500.</p>
        </section>
      </div>

      <div style={{ marginTop: 18 }}>
        <Link className="btn ghost" to={returnPath}>Continue to portal</Link>
      </div>
    </>
  )
}
