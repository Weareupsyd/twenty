/**
 * Hosted business verification flow - what the business administrator opens.
 *
 * Route: /b/:token   (the one-time link returned by POST /api/v2/business/session)
 *
 * Follows mockup 30: confirm the company, upload the constitutive documents,
 * tag the people who own and run it, then submit. Each role tagged
 * KYC-required spawns its own person check on the server.
 *
 * This page is opened by someone outside the operator's organisation, so it
 * avoids internal vocabulary and never shows scores, thresholds or reasons -
 * only what they need to do next.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE_URL } from '../config/api'
import { C, injectFonts } from '../theme'

// ─── Types ──────────────────────────────────────────────────

interface RoleTag {
  tag: string
  group: 'ownership' | 'governance'
  label: string
}

interface KeyPerson {
  id?: string
  full_name: string
  role_tags: string[]
  ownership_percentage?: number | null
  kyc_status?: string | null
  kyc_required?: boolean
  is_corporate?: boolean
  // Contact info for sending verification links
  email?: string | null
  phone?: string | null
}

interface DocumentState {
  document_type: string
  status: string
}

interface Bootstrap {
  status: string
  company: Record<string, string | null>
  key_people: KeyPerson[]
  documents: DocumentState[]
  required_documents: string[]
  role_tags: RoleTag[]
}

interface VerificationLinkResult {
  person_id: string
  full_name: string
  email_sent: boolean
  sms_sent: boolean
  verification_url: string | null
  error?: string | null
}

const DOC_LABELS: Record<string, string> = {
  certificate_of_incorporation: 'Certificate of incorporation',
  articles_of_association: 'Articles of association',
  shareholder_register: 'Shareholder register',
  proof_of_address: 'Proof of registered address',
  financial_statements: 'Financial statements',
  tax_certificate: 'Tax registration certificate',
  board_resolution: 'Board resolution',
  operating_licence: 'Operating licence',
}

const DOC_HINTS: Record<string, string> = {
  certificate_of_incorporation: 'The certificate issued when the company was registered.',
  articles_of_association: 'Your constitution - share capital, classes, directors’ powers.',
  shareholder_register: 'The register of members, or your CR12.',
  proof_of_address: 'A utility bill or lease, under 3 months old.',
  financial_statements: 'Your most recent audited set.',
  tax_certificate: 'Your tax or PIN registration certificate.',
  board_resolution: 'Authority to open the relationship, naming the signatories.',
  operating_licence: 'Only if you operate in a regulated activity.',
}

/** Map free-text role hints read off a document to canonical role tags. */
const ROLE_HINT_TO_TAG: Record<string, string> = {
  'director': 'director',
  'managing director': 'director',
  'executive director': 'director',
  'non-executive director': 'director',
  'board member': 'director',
  'chairman': 'chairman',
  'chairperson': 'chairman',
  'chair': 'chairman',
  'secretary': 'secretary',
  'company secretary': 'secretary',
  'signatory': 'signatory',
  'shareholder': 'shareholder',
  'member': 'shareholder',
  'ubo': 'ubo',
  'beneficial owner': 'ubo',
  'owner': 'ubo',
  'founder': 'founder',
  'partner': 'partner',
  'trustee': 'trustee',
  'beneficiary': 'beneficiary',
}

function normalizeRoleHint(hint: string | undefined): string[] {
  if (!hint) return []
  const tag = ROLE_HINT_TO_TAG[hint.toLowerCase()]
  return tag ? [tag] : [hint.toLowerCase()]
}

type Step = 'company' | 'documents' | 'people' | 'verify' | 'done'

// ─── Page ───────────────────────────────────────────────────

export default function BusinessVerificationFlow() {
  const { token } = useParams<{ token: string }>()
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [step, setStep] = useState<Step>('company')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [company, setCompany] = useState<Record<string, string>>({})
  const [people, setPeople] = useState<KeyPerson[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)

  // Verification link state
  const [directorContacts, setDirectorContacts] = useState<Record<string, { email: string; phone: string }>>({})
  const [linkResults, setLinkResults] = useState<VerificationLinkResult[]>([])
  const [linksSent, setLinksSent] = useState(false)
  const [sendingLinks, setSendingLinks] = useState(false)

  useEffect(() => { injectFonts() }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${encodeURIComponent(token)}`)
      if (res.status === 401) throw new Error('This verification link is no longer valid. Ask for a new one.')
      if (!res.ok) throw new Error('We could not open this verification link.')
      const data: Bootstrap = await res.json()
      setBoot(data)
      setCompany(
        Object.fromEntries(
          Object.entries(data.company ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
        ),
      )
      setPeople(data.key_people ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // ── Actions ───────────────────────────────────────────────

  async function saveCompany() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${token}/company`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      })
      if (!res.ok) throw new Error('We could not save those details.')
      setStep('documents')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  async function uploadDocument(documentType: string, file: File) {
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.append('document', file)
      form.append('document_type', documentType)

      const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${token}/document`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.message || 'We could not read that file.')

      const msgs: string[] = []
      if (data.ocr_succeeded === false) {
        msgs.push(`${DOC_LABELS[documentType] ?? documentType}: uploaded, but we could not read it automatically. Someone will review it.`)
      } else if (typeof data.fields_extracted === 'number' && data.fields_extracted > 0) {
        msgs.push(`${DOC_LABELS[documentType] ?? documentType}: read ${data.fields_extracted} of ${data.fields_expected} details.`)
      }

      // Owners read off a register are offered, never auto-added - the
      // administrator confirms them, because a misread ownership graph is
      // worse than one they typed themselves.
      if (Array.isArray(data.suggested_people) && data.suggested_people.length > 0) {
        const existing = new Set(people.map(p => p.full_name.toLowerCase()))
        const additions = data.suggested_people
          .filter((p: { full_name: string }) => !existing.has(p.full_name.toLowerCase()))
          .map((p: { full_name: string; ownership_percentage?: number; role_hint?: string }) => ({
            full_name: p.full_name,
            ownership_percentage: p.ownership_percentage ?? null,
            role_tags: normalizeRoleHint(p.role_hint),
          }))
        if (additions.length > 0) {
          setPeople(prev => [...prev, ...additions])
          msgs.push(`Found ${additions.length} ${additions.length === 1 ? 'person' : 'people'} on that document - please check the roles below.`)
        }
      }

      setNotices(msgs)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally { setBusy(false) }
  }

  async function submitAll() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${token}/submit`, { method: 'POST' })
      if (!res.ok) throw new Error('We could not submit right now. Try again shortly.')
      setSubmitted(true)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed.')
    } finally { setBusy(false) }
  }

  async function sendDirectorLinks() {
    setSendingLinks(true); setError(null); setLinkResults([])
    try {
      // Build contacts from the directorContacts map, keyed by key_person_id
      const contacts: Record<string, { email?: string | null; phone?: string | null }> = {}
      const currentPeople = boot?.key_people ?? people
      for (const person of currentPeople) {
        if (!person.id) continue
        const contact = directorContacts[person.full_name] || {}
        // Fall back to the email/phone already on record for this person
        const email = contact.email || person.email || null
        const phone = contact.phone || person.phone || null
        if (email || phone) {
          contacts[person.id] = { email, phone }
        }
      }

      const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${token}/key-people/send-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts,
          public_origin: window.location.origin,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to send links.')

      setLinkResults(data.results || [])
      setLinksSent(true)
      setNotices(prev => [
        ...prev,
        `Verification links created for ${data.total || 0} director(s).`,
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.')
    } finally { setSendingLinks(false) }
  }

  async function savePeopleInternal() {
    const cleaned = people
      .filter(p => p.full_name.trim())
      .map(p => ({
        full_name: p.full_name.trim(),
        role_tags: p.role_tags,
        ownership_percentage: p.ownership_percentage ?? undefined,
        is_corporate: p.is_corporate,
      }))

    const res = await fetch(`${API_BASE_URL}/api/v2/business/hosted/${token}/key-people`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_people: cleaned }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || data?.message || 'Could not save people.')
    return data
  }

  // After saving people, transition to verify step
  async function savePeopleAndContinue() {
    setBusy(true); setError(null)
    try {
      const data = await savePeopleInternal()
      const msgs: string[] = []
      if (Array.isArray(data.unmapped_roles) && data.unmapped_roles.length > 0) {
        for (const u of data.unmapped_roles) {
          msgs.push(`We did not recognise "${u.unmapped.join(', ')}" for ${u.name} - please pick from the list.`)
        }
      }
      setNotices(prev => [...prev, ...msgs])
      await load() // Reload to get updated key_people with IDs
      setStep('verify')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  // ── Derived ───────────────────────────────────────────────
  const ownershipTotal = people.reduce((s, p) => s + (Number(p.ownership_percentage) || 0), 0)
  const uploaded = new Set((boot?.documents ?? []).map(d => d.document_type))
  const requiredDocs = boot?.required_documents ?? []
  const missingRequired = requiredDocs.filter(d => !uploaded.has(d))
  const directorsNeedingKyc = boot?.key_people?.filter(p =>
    !p.is_corporate && p.kyc_required !== false && !p.kyc_status
  ) ?? people.filter(p =>
    !p.is_corporate && p.role_tags?.length > 0 && !p.kyc_status
  )

  // ── Render states ─────────────────────────────────────────
  if (loading) {
    return <Shell><p style={{ color: C.muted }}>Opening your verification…</p></Shell>
  }

  if (error && !boot) {
    return (
      <Shell>
        <h1 style={h1Style}>We could not open this link</h1>
        <p style={{ color: C.muted, marginTop: 8 }}>{error}</p>
      </Shell>
    )
  }

  if (step === 'done' || submitted) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '28px 0' }}>
          <div style={{
            width: 54, height: 54, margin: '0 auto 14px', borderRadius: '50%',
            border: `1px solid ${C.accent}`, color: C.accent,
            display: 'grid', placeItems: 'center', fontSize: 22,
          }}></div>
          <h1 style={h1Style}>Thank you - that is everything we need for now</h1>
          <p style={{ color: C.muted, marginTop: 10, maxWidth: '52ch', marginInline: 'auto' }}>
            We are reviewing your company details. Anyone who still needs to complete an ID check
            {linksSent ? ' has been sent a link' : ' will receive a link from the dashboard'}. You can close this page.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Progress */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 22 }}>
        {(['company', 'documents', 'people', 'verify', 'done'] as Step[]).map((s, i) => {
          const order: Step[] = ['company', 'documents', 'people', 'verify', 'done']
          const active = s === step
          const done = order.indexOf(s) < order.indexOf(step)
          return (
            <div key={s} style={{
              padding: '7px 4px', borderRadius: 5, textAlign: 'center',
              border: `1px solid ${active ? C.accent : done ? C.borderStrong : C.border}`,
              color: active ? C.accent : done ? C.accentInk : C.dim,
              fontFamily: C.mono, fontSize: 9, letterSpacing: '.04em', textTransform: 'uppercase',
            }}>
              {['Company', 'Documents', 'People', 'Verify', 'Submit'][i]}
            </div>
          )
        })}
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: '10px 13px', border: `1px solid ${C.red}`, color: C.red, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {notices.length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 13px', border: `1px solid ${C.borderStrong}`, color: C.muted, fontSize: 12.5 }}>
          {notices.map((n, i) => <div key={i} style={{ padding: '2px 0' }}>{n}</div>)}
        </div>
      )}

      {/* ── Step 1: company ── */}
      {step === 'company' && (
        <Card title="Confirm your company details" lead="Check these against your certificate of incorporation.">
          {[
            ['legal_name', 'Registered company name'],
            ['registration_number', 'Registration number'],
            ['registered_address', 'Registered address'],
            ['tax_number', 'Tax / PIN number'],
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle}>{label}</span>
              <input
                value={company[key] ?? ''}
                onChange={e => setCompany({ ...company, [key]: e.target.value })}
                style={inputStyle}
              />
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={saveCompany} disabled={busy} style={primaryBtn}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </Card>
      )}

      {/* ── Step 2: documents ── */}
      {step === 'documents' && (
        <Card title="Upload your company documents" lead="Clear photos or PDFs, all pages. We read the details straight off them.">
          {[...requiredDocs, ...Object.keys(DOC_LABELS).filter(d => !requiredDocs.includes(d))].map(docType => (
            <DocRow
              key={docType}
              docType={docType}
              required={requiredDocs.includes(docType)}
              uploaded={uploaded.has(docType)}
              busy={busy}
              onPick={file => uploadDocument(docType, file)}
            />
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12 }}>
            <span style={{ color: C.dim, fontFamily: C.mono, fontSize: 10.5 }}>
              {missingRequired.length === 0
                ? 'All required documents uploaded'
                : `${missingRequired.length} required document${missingRequired.length === 1 ? '' : 's'} still needed`}
            </span>
            <button onClick={() => setStep('people')} disabled={busy} style={primaryBtn}>Continue</button>
          </div>
        </Card>
      )}

      {/* ── Step 3: people ── */}
      {step === 'people' && (
        <Card
          title="Who owns and runs the company"
          lead="Add everyone with an ownership stake or an official role. One person can hold several roles."
        >
          {people.map((p, i) => (
            <PersonRow
              key={i}
              person={p}
              roleTags={boot?.role_tags ?? []}
              onChange={next => setPeople(people.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setPeople(people.filter((_, j) => j !== i))}
            />
          ))}

          <button
            onClick={() => setPeople([...people, { full_name: '', role_tags: [] }])}
            style={{ ...ghostBtn, width: '100%', marginTop: 10 }}
          >
            Add a person
          </button>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`,
            fontFamily: C.mono, fontSize: 11,
            color: Math.abs(ownershipTotal - 100) < 0.5 ? C.muted : C.amber,
          }}>
            <span>Ownership must add up to 100%</span>
            <span>currently {Number(ownershipTotal.toFixed(2))}%</span>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={savePeopleAndContinue} disabled={busy} style={primaryBtn}>
              {busy ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </Card>
      )}

      {/* ── Step 4: verify directors ── */}
      {step === 'verify' && (
        <Card
          title="Verify your directors and key people"
          lead="Send identity verification links to the people who need to complete an ID check. You can skip this and send the links later."
        >
          {/* Guide */}
          <div style={{
            marginBottom: 16, padding: '12px 14px',
            border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
            color: C.muted,
          }}>
            <strong style={{ color: C.text }}>How it works</strong>
            <ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
              <li>Each person listed below needs to complete an identity check.</li>
              <li>Enter their <strong>email</strong> or <strong>phone number</strong> to send them a secure link.</li>
              <li>They click the link, upload their ID, and take a selfie.</li>
              <li>You can track progress on the verification dashboard.</li>
            </ol>
            <p style={{ margin: '8px 0 0', color: C.dim, fontStyle: 'italic' }}>
              If you skip this step, the verifications will remain pending - you can send the links later from the dashboard.
            </p>
          </div>

          {directorsNeedingKyc.length === 0 ? (
            <div style={{ marginBottom: 14, padding: '12px', border: `1px solid ${C.borderStrong}`, borderRadius: 8, fontSize: 13, color: C.muted }}>
              No directors or key people need identity verification based on the roles assigned.
            </div>
          ) : (
            directorsNeedingKyc.map((person, idx) => {
              const nameKey = person.full_name
              const contact = directorContacts[nameKey] || {
                email: person.email || '',
                phone: person.phone || '',
              }
              return (
                <div key={person.id || idx} style={{ padding: '12px', marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 13 }}>{person.full_name}</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      placeholder="Email address"
                      value={contact.email}
                      onChange={e => setDirectorContacts({
                        ...directorContacts,
                        [nameKey]: { ...contact, email: e.target.value },
                      })}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      placeholder="Phone number (e.g. +256712345678)"
                      value={contact.phone}
                      onChange={e => setDirectorContacts({
                        ...directorContacts,
                        [nameKey]: { ...contact, phone: e.target.value },
                      })}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                  {/* Show link result for this person if sent */}
                  {linkResults.find(r => r.full_name === person.full_name) && (
                    <div style={{ marginTop: 8, fontSize: 11, color: C.accentInk }}>
                       Link ready
                      {linkResults.find(r => r.full_name === person.full_name)?.email_sent ? ' · Email sent' : ''}
                      {linkResults.find(r => r.full_name === person.full_name)?.sms_sent ? ' · SMS sent' : ''}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {linkResults.length > 0 && (
            <div style={{ marginBottom: 14, padding: '12px', border: `1px solid ${C.accent}`, borderRadius: 8, fontSize: 12, color: C.text }}>
              <div style={{ fontWeight: 500, marginBottom: 6, color: C.accent }}> Verification links created</div>
              {linkResults.map(r => (
                <div key={r.person_id} style={{ padding: '3px 0', fontSize: 11, color: C.muted }}>
                  {r.full_name}: {r.verification_url ? (
                    <a href={r.verification_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: C.accent, wordBreak: 'break-all' }}>
                      {r.verification_url}
                    </a>
                  ) : 'pending'}
                  {r.email_sent && ' ·  Email sent'}
                  {r.sms_sent && ' ·  SMS sent'}
                  {r.error && <span style={{ color: C.red }}> · Error: {r.error}</span>}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            {!linksSent && (
              <button onClick={sendDirectorLinks} disabled={sendingLinks || directorsNeedingKyc.length === 0} style={primaryBtn}>
                {sendingLinks ? 'Sending…' : 'Send verification links'}
              </button>
            )}
            <button onClick={submitAll} disabled={busy} style={linksSent ? primaryBtn : ghostBtn}>
              {busy ? 'Submitting…' : (linksSent ? 'Continue to submit' : 'Skip and submit')}
            </button>
          </div>
        </Card>
      )}

      <p style={{ marginTop: 18, textAlign: 'center', color: C.dim, fontFamily: C.mono, fontSize: 10 }}>
        Your documents are encrypted and used only to verify this business.
      </p>
    </Shell>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.sans, fontSize: 14 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '44px 22px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 26 }}>
          <span style={{ display: 'grid', gridTemplate: '1fr 1fr / 1fr 1fr', width: 19, height: 19 }}>
            <span style={{ background: C.text }} /><span style={{ background: C.accent }} />
            <span style={{ background: C.accent }} /><span style={{ background: C.text }} />
          </span>
          <span style={{ fontFamily: C.mono, fontWeight: 600, fontSize: 14 }}>kabila</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function Card({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 20px 22px' }}>
      <h1 style={h1Style}>{title}</h1>
      {lead && <p style={{ margin: '6px 0 18px', color: C.muted, fontSize: 12.5 }}>{lead}</p>}
      {children}
    </div>
  )
}

function DocRow({ docType, required, uploaded, busy, onPick }: {
  docType: string
  required: boolean
  uploaded: boolean
  busy: boolean
  onPick: (f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div
      onClick={() => !busy && ref.current?.click()}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', marginBottom: 8,
        border: `1px ${uploaded ? 'solid' : 'dashed'} ${uploaded ? C.borderStrong : C.border}`,
        borderRadius: 10, cursor: busy ? 'default' : 'pointer',
      }}
    >
      <span style={{ width: 26, height: 32, flex: '0 0 auto', border: `1px solid ${uploaded ? C.accent : C.border}`, borderRadius: 3 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{DOC_LABELS[docType] ?? docType}</b>
        <small style={{ display: 'block', marginTop: 2, color: C.dim, fontFamily: C.mono, fontSize: 10 }}>
          {DOC_HINTS[docType] ?? ''}
        </small>
      </span>
      <span style={{
        flex: '0 0 auto', fontFamily: C.mono, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em',
        color: uploaded ? C.accentInk : required ? C.amber : C.dim,
      }}>
        {uploaded ? 'Uploaded' : required ? 'Required' : 'Optional'}
      </span>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
    </div>
  )
}

function PersonRow({ person, roleTags, onChange, onRemove }: {
  person: KeyPerson
  roleTags: RoleTag[]
  onChange: (p: KeyPerson) => void
  onRemove: () => void
}) {
  const toggle = (tag: string) => {
    const has = person.role_tags.includes(tag)
    onChange({ ...person, role_tags: has ? person.role_tags.filter(t => t !== tag) : [...person.role_tags, tag] })
  }

  return (
    <div style={{ padding: '13px', marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={person.full_name}
          onChange={e => onChange({ ...person, full_name: e.target.value })}
          placeholder="Full name"
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          value={person.ownership_percentage ?? ''}
          onChange={e => onChange({ ...person, ownership_percentage: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder="%"
          inputMode="decimal"
          style={{ ...inputStyle, width: 74, textAlign: 'right' }}
        />
        <button onClick={onRemove} style={{ ...ghostBtn, padding: '8px 10px' }} aria-label="Remove person">×</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {roleTags.map(rt => {
          const on = person.role_tags.includes(rt.tag)
          return (
            <button
              key={rt.tag}
              onClick={() => toggle(rt.tag)}
              style={{
                padding: '3px 7px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${on ? C.accent : C.borderStrong}`,
                background: 'transparent',
                color: on ? C.accentInk : C.dim,
                fontFamily: C.mono, fontSize: 9, letterSpacing: '.04em', textTransform: 'uppercase',
              }}
            >
              {rt.label}
            </button>
          )
        })}
      </div>

      {person.kyc_status && (
        <div style={{ marginTop: 8, color: C.accentInk, fontFamily: C.mono, fontSize: 10 }}>
          ID check {person.kyc_status.replace(/_/g, ' ').toLowerCase()}
        </div>
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────

const h1Style: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-.015em' }

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 5,
  color: C.muted, fontFamily: C.mono, fontSize: 10,
  letterSpacing: '.06em', textTransform: 'uppercase',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 5,
  border: `1px solid ${C.border}`, outline: 0,
  background: C.bg, color: C.text, fontSize: 13,
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
  border: `1.5px solid ${C.accent}`, background: 'transparent', color: C.accent,
  fontSize: 13, fontWeight: 600,
}

const ghostBtn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
  border: `1px solid ${C.borderStrong}`, background: 'transparent', color: C.muted,
  fontSize: 12.5, fontWeight: 500,
}
