/**
 * Business Verification (KYB) - analyst review surface.
 *
 * Mirrors the signed-off mockup 29-kyb-business-verifications.html and reads
 * from /api/v2/business/*. Risk is the only thing that earns colour on this
 * page; everything else stays monochrome so a red cell means something.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config/api'
import { fetchCsrfToken, csrfHeader, clearCsrfToken } from '../lib/csrf'
import { C, injectFonts } from '../theme'

// ─── Types ──────────────────────────────────────────────────

interface BusinessSession {
  id: string
  depth?: number
  child_session_count?: number
  session_number?: number
  vendor_data?: string | null
  status: string
  legal_name?: string | null
  registration_number?: string | null
  jurisdiction?: string | null
  company_type?: string | null
  created_at: string
  updated_at?: string
}

interface KeyPerson {
  id: string
  full_name: string
  role_tags: string[]
  ownership_percentage?: number | null
  voting_percentage?: number | null
  is_corporate?: boolean
  source?: string
  linked_kyc_session_id?: string | null
  nested_business_session_id?: string | null
  effective_ownership_percentage?: number | null
  ownership_path?: string | null
  kyc_status?: string | null
  aml?: { risk_level: string; match_found: boolean; matches: unknown[] } | null
}

/**
 * GET /sessions/:id/ownership.
 *
 * A discriminated response: when nested resolution is off the endpoint returns
 * only `enabled: false` plus which layer decided, so the UI can say why the
 * graph is absent instead of drawing an empty one.
 */
type OwnershipGraph =
  | {
      enabled: false
      disabled_by: 'call' | 'workflow' | 'deployment'
      note: string
    }
  | {
      enabled: true
      enabled_by: 'call' | 'workflow' | 'deployment'
      resolved: boolean
      traced_percentage: number
      opaque_percentage: number
      unresolved_owners: Array<{ name: string; session_id: string; direct_percentage: number | null }>
      beneficial_owners: Array<{
        person_id: string
        full_name: string
        effective_percentage: number
        path: string
        is_beneficial_owner: boolean
        depth: number
      }>
      structural_warning?: string
    }

interface CrossCheck {
  field: string
  result: 'MATCH' | 'INCONSISTENT' | 'UNCORROBORATED' | 'DEFERRED'
  detail: string
  values_by_source: Record<string, string | null>
}

/** Where a session sits in the ownership tree. */
interface Nesting {
  depth: number
  root_session_id: string
  parent: {
    session_id: string
    legal_name?: string | null
    status: string
    /** The corporate shareholder in the parent this session exists to resolve. */
    spawned_for: { key_person_id: string; full_name: string; ownership_percentage?: number | null } | null
  } | null
  children: Array<{
    session_id: string
    legal_name?: string | null
    status: string
    depth: number
    for_key_person_id?: string | null
  }>
  /** Corporate owners nested KYB refused to resolve, and why. */
  findings?: Array<{
    key_person_id?: string | null
    owner_name: string
    finding_type: 'CIRCULAR_OWNERSHIP' | 'MAX_DEPTH_EXCEEDED'
    detail: string
    created_at: string
  }>
}

interface DecisionObject {
  session_id: string
  status: string
  nesting?: Nesting
  registry_status: string
  company: Record<string, string | null>
  cross_checks: CrossCheck[]
  company_aml_checks: Array<{
    screened_name: string
    risk_level: string
    match_found: boolean
    lists_checked: string[]
    screened_at: string
  }>
  key_people_checks: KeyPerson[]
  ubo_kyc_summary: { required: number; resolved: number; approved: number; declined: number; pending: number }
  ownership_total: number | null
  ownership_reconciles: boolean
  document_verifications: Array<{
    document_type: string
    status: string
    ocr_confidence?: number | null
    fields_extracted?: number | null
    fields_expected?: number | null
    tamper_check_passed?: boolean | null
  }>
  decision_reasons: Array<{ code: string; detail: string }>
}

interface Stats {
  total: number
  awaiting_user: number
  in_progress: number
  in_review: number
  approved: number
  declined: number
}

const FILTERS = ['ALL', 'AWAITING_USER', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'DECLINED'] as const

// ─── Small presentational helpers ───────────────────────────

const mono = { fontFamily: C.mono } as const

/** Neutral by default. Risk is the only signal that gets colour. */
function Tag({ children, risk }: { children: React.ReactNode; risk?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        border: `1px solid ${risk ? C.red : C.borderStrong}`,
        borderRadius: 4,
        color: risk ? C.red : C.muted,
        fontFamily: C.mono,
        fontSize: 9,
        letterSpacing: '.05em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function humanStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase()
}

function isRiskStatus(s: string) {
  return s === 'DECLINED'
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, padding: '16px 18px', border: `1px solid ${C.border}`, background: C.surface }}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', gap: 10,
          paddingBottom: 9, marginBottom: 12, borderBottom: `1px solid ${C.border}`,
          ...mono, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted,
        }}
      >
        <span style={{ color: C.text }}>{title}</span>
        {meta && <span>{meta}</span>}
      </div>
      {children}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────

export default function BusinessVerification() {
  const navigate = useNavigate()
  const [authReady, setAuthReady] = useState(false)
  const [sessions, setSessions] = useState<BusinessSession[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filter, setFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<DecisionObject | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSubsidiaries, setShowSubsidiaries] = useState(false)
  const [ownership, setOwnership] = useState<OwnershipGraph | null>(null)
  const [ownershipLoading, setOwnershipLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reviewRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => { injectFonts() }, [])

  // Auth probe - same pattern as VerificationManagement.
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v2/business/sessions/stats`, { credentials: 'include' })
      .then(res => {
        if (res.ok) { setAuthReady(true); fetchCsrfToken(); return }
        clearCsrfToken(); navigate('/admin/login')
      })
      .catch(() => { clearCsrfToken(); navigate('/admin/login') })
  }, [navigate])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter !== 'ALL') params.set('status', filter)
      if (search.trim()) params.set('search', search.trim())
      // Subsidiaries are hidden by default - they are not applicants, and
      // listing them beside real ones inflates the queue.
      if (showSubsidiaries) params.set('scope', 'all')
      const res = await fetch(`${API_BASE_URL}/api/v2/business/sessions?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`)
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load business sessions')
    } finally {
      setLoading(false)
    }
  }, [filter, search, showSubsidiaries])

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/sessions/stats`, { credentials: 'include' })
      if (res.ok) setStats(await res.json())
    } catch { /* non-blocking */ }
  }, [])

  useEffect(() => { if (authReady) loadSessions() }, [authReady, loadSessions])
  useEffect(() => { if (authReady) loadStats() }, [authReady, loadStats])

  async function openReview(id: string) {
    setBusy(true)
    setError(null)
    setOwnership(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/sessions/${id}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load session (${res.status})`)
      setSelected(await res.json())
      setNote('')
      // Navigating parent->child swaps the panel's contents in place. Without
      // this the page looks unchanged when the click came from far down it.
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      loadOwnership(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open session')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Loaded separately from the decision object and never allowed to fail the
   * review: an analyst still needs the rest of the session if the graph walk
   * errors.
   */
  async function loadOwnership(id: string) {
    setOwnershipLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/sessions/${id}/ownership`, { credentials: 'include' })
      if (!res.ok) { setOwnership(null); return }
      setOwnership(await res.json())
    } catch {
      setOwnership(null)
    } finally {
      setOwnershipLoading(false)
    }
  }

  async function decide(decision: 'APPROVED' | 'DECLINED' | 'IN_REVIEW') {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await fetchCsrfToken()
      const res = await fetch(`${API_BASE_URL}/api/v2/business/sessions/${selected.session_id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeader() },
        body: JSON.stringify({ decision, note: note || undefined }),
      })
      if (!res.ok) throw new Error(`Decision failed (${res.status})`)
      await Promise.all([loadSessions(), loadStats()])
      setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setBusy(false)
    }
  }

  async function recompute() {
    if (!selected) return
    setBusy(true)
    try {
      await fetchCsrfToken()
      await fetch(`${API_BASE_URL}/api/v2/business/sessions/${selected.session_id}/recompute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      })
      await openReview(selected.session_id)
      await loadSessions()
    } catch {
      setError('Failed to re-run checks')
    } finally {
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.sans, fontSize: 14 }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 36px 90px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22 }}>
          <div>
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted }}>
              // verify the company · surface every owner · verify each one
            </div>
            <h1 style={{ margin: '8px 0 6px', fontSize: 28, fontWeight: 600, letterSpacing: '-.02em' }}>
              Business Verification
            </h1>
            <p style={{ margin: 0, maxWidth: '74ch', color: C.muted, fontSize: 13 }}>
              One business session collects the company documents, extracts the entity profile, records every
              owner and officer against the canonical role tags, screens the company and each person for AML,
              and spawns a linked KYC session for every role that requires one.
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/verifications')}
            style={btnStyle}
          >
            Person KYC
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
          {[
            { l: 'Businesses', v: stats?.total ?? '' },
            { l: 'Awaiting user', v: stats?.awaiting_user ?? '' },
            { l: 'In progress', v: stats?.in_progress ?? '' },
            { l: 'In review', v: stats?.in_review ?? '' },
            { l: 'Declined', v: stats?.declined ?? '', risk: true },
          ].map(s => (
            <div key={s.l} style={{ background: C.panel, border: `1px solid ${C.border}`, padding: '14px 18px' }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 6 }}>
                {s.l}
              </div>
              <div style={{ ...mono, fontSize: 26, fontWeight: 600, lineHeight: 1, color: s.risk && Number(s.v) > 0 ? C.red : C.text }}>
                {s.v}
              </div>
            </div>
          ))}
        </div>

        {/* Scope note - the deferred registry stated plainly rather than hidden */}
        <div style={{ marginBottom: 16, padding: '10px 13px', border: `1px solid ${C.borderStrong}`, color: C.muted, fontSize: 11.5 }}>
          <strong style={{ color: C.text }}>Document-first, this release.</strong>{' '}
          Company details are extracted from the documents the business uploads and cross-checked against each
          other and against what the administrator typed. No external company-registry lookup runs yet - the
          registry column stays <em>deferred</em>, and any field we cannot corroborate from a second source is
          flagged for analyst review rather than silently accepted.
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: '10px 13px', border: `1px solid ${C.red}`, color: C.red, ...mono, fontSize: 11.5 }}>
            {error}
          </div>
        )}

        {/* Filters */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: C.panel, border: `1px solid ${C.border}`, padding: '10px 14px', marginBottom: 16,
        }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...mono, fontSize: 11, letterSpacing: '.03em', padding: '6px 12px', cursor: 'pointer',
                background: filter === f ? C.surfaceHover : 'transparent',
                border: `1px solid ${filter === f ? C.borderStrong : 'transparent'}`,
                color: filter === f ? C.text : C.muted,
              }}
            >
              {f === 'ALL' ? 'All' : humanStatus(f)}
            </button>
          ))}
          {/* Subsidiaries are spawned by nested KYB, not applied for. Hidden by
              default so the queue reflects real applicants. */}
          <button
            onClick={() => setShowSubsidiaries(v => !v)}
            title="Sessions opened automatically to resolve a corporate owner"
            style={{
              ...mono, fontSize: 11, letterSpacing: '.03em', padding: '6px 12px', cursor: 'pointer',
              background: showSubsidiaries ? C.surfaceHover : 'transparent',
              border: `1px solid ${showSubsidiaries ? C.borderStrong : C.border}`,
              color: showSubsidiaries ? C.text : C.muted,
            }}
          >
            {showSubsidiaries ? ' ' : ''}Subsidiaries
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', background: C.bg, border: `1px solid ${C.border}`, padding: '0 10px', height: 30 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Company, session id, vendor ref…"
              style={{ border: 0, outline: 0, background: 'transparent', color: C.text, ...mono, fontSize: 11, width: 210 }}
            />
          </div>
        </div>

        {/* Table */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr>
                {['Session', 'Company', 'Jurisdiction', 'Status', 'Updated', ''].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>Loading…</td></tr>
              )}
              {!loading && sessions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: C.muted, padding: '28px 14px' }}>
                    No business sessions yet. Create one from your integration to get started.
                  </td>
                </tr>
              )}
              {sessions.map(s => (
                <tr key={s.id}>
                  <td style={tdStyle}>
                    <span style={{ ...mono, fontSize: 11.5, color: C.accentInk }}>{s.id.slice(0, 12)}</span>
                    {s.vendor_data && <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginTop: 2 }}>{s.vendor_data}</div>}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: (s.depth ?? 0) * 16 }}>
                      {(s.depth ?? 0) > 0 && (
                        // A subsidiary is only meaningful relative to its
                        // parent, so say so rather than letting it read as a
                        // standalone applicant.
                        <span style={{ ...mono, fontSize: 10, color: C.dim }} title={`Level ${s.depth} of an ownership chain`}>
                          └ L{s.depth}
                        </span>
                      )}
                      <strong style={{ color: C.text, fontWeight: 500 }}>{s.legal_name || ''}</strong>
                    </div>
                    <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginTop: 2, paddingLeft: (s.depth ?? 0) * 16 }}>
                      {s.company_type}
                      {(s.child_session_count ?? 0) > 0 && (
                        <span style={{ color: C.muted }}>
                          {s.company_type ? ' · ' : ''}
                          {s.child_session_count} subsidiar{s.child_session_count === 1 ? 'y' : 'ies'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>{s.jurisdiction || ''}</td>
                  <td style={tdStyle}><Tag risk={isRiskStatus(s.status)}>{humanStatus(s.status)}</Tag></td>
                  <td style={{ ...tdStyle, ...mono, fontSize: 11 }}>
                    {s.updated_at ? new Date(s.updated_at).toLocaleString() : ''}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button onClick={() => openReview(s.id)} style={btnSmStyle}>Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Review panel */}
        {selected && (
          <div ref={reviewRef} style={{ marginTop: 16, background: C.panel, border: `1px solid ${C.border}`, padding: '20px 22px' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16,
              paddingBottom: 12, marginBottom: 16, borderBottom: `1px solid ${C.border}`,
            }}>
              <div>
                <div style={{ ...mono, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted }}>
                  // business session · entity + people
                </div>

                {/* A subsidiary reviewed without its parent invites a decision
                    made out of context - name the parent and the stake, and
                    make getting back one click. */}
                {selected.nesting?.parent && (
                  <div style={{
                    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8,
                    padding: '8px 10px', border: `1px solid ${C.border}`, background: C.surface,
                  }}>
                    <span style={{ ...mono, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: C.dim }}>
                      Subsidiary · level {selected.nesting.depth}
                    </span>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      opened to resolve{' '}
                      <strong style={{ color: C.text, fontWeight: 500 }}>
                        {selected.nesting.parent.spawned_for?.full_name ?? 'a corporate owner'}
                      </strong>
                      {selected.nesting.parent.spawned_for?.ownership_percentage != null && (
                        <> ({selected.nesting.parent.spawned_for.ownership_percentage}% of the parent)</>
                      )}
                    </span>
                    <button
                      onClick={() => openReview(selected.nesting!.parent!.session_id)}
                      style={{ ...btnSmStyle, marginLeft: 'auto' }}
                    >
                       {selected.nesting.parent.legal_name || 'Parent company'}
                    </button>
                  </div>
                )}
                <h2 style={{ margin: '6px 0 4px', fontSize: 19, fontWeight: 600 }}>
                  {selected.company?.legal_name || 'Unnamed company'}
                </h2>
                <div style={{ ...mono, fontSize: 11, color: C.muted }}>
                  {selected.session_id} · <Tag risk={isRiskStatus(selected.status)}>{humanStatus(selected.status)}</Tag>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={recompute} disabled={busy} style={btnStyle}>Re-run checks</button>
                <button onClick={() => setSelected(null)} style={btnStyle}>Close</button>
              </div>
            </div>

            {/* Why it is where it is */}
            {selected.decision_reasons?.length > 0 && (
              <Section title="Outstanding" meta={`${selected.decision_reasons.length} reason(s)`}>
                {selected.decision_reasons.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < selected.decision_reasons.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <span style={{ ...mono, fontSize: 10, color: C.dim, minWidth: 190 }}>{r.code}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{r.detail}</span>
                  </div>
                ))}
              </Section>
            )}

            {/* Company profile */}
            <Section title="Company profile" meta="extracted from submitted documents">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 26px' }}>
                {Object.entries(selected.company || {}).map(([k, v]) => (
                  <div key={k} style={kvRow}>
                    <span style={{ ...mono, fontSize: 10.5, color: C.muted }}>{k.replace(/_/g, ' ')}</span>
                    <span style={{ color: C.text, fontWeight: 500, textAlign: 'right' }}>{v || ''}</span>
                  </div>
                ))}
                <div style={kvRow}>
                  <span style={{ ...mono, fontSize: 10.5, color: C.muted }}>registry lookup</span>
                  <span style={{ color: C.muted, textAlign: 'right' }}>
                    {selected.registry_status === 'DEFERRED' ? 'Deferred · not enabled' : selected.registry_status}
                  </span>
                </div>
              </div>
            </Section>

            {/* Cross-check */}
            <Section
              title="Cross-check"
              meta={`${selected.cross_checks?.filter(c => c.result === 'INCONSISTENT').length ?? 0} inconsistency`}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Field', 'Result', 'Detail'].map(h => <th key={h} style={{ ...thStyle, background: 'transparent' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(selected.cross_checks ?? []).map(c => (
                    <tr key={c.field}>
                      <td style={tdStyle}><strong style={{ color: C.text, fontWeight: 500 }}>{c.field.replace(/_/g, ' ')}</strong></td>
                      <td style={{ ...tdStyle, color: c.result === 'INCONSISTENT' ? C.red : C.muted }}>{c.result}</td>
                      <td style={{ ...tdStyle, color: C.muted }}>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Company AML */}
            <Section title="Company AML" meta="entity screened">
              {(selected.company_aml_checks ?? []).length === 0 && (
                <div style={{ color: C.muted, fontSize: 12 }}>No entity screening recorded.</div>
              )}
              {(selected.company_aml_checks ?? []).map((a, i) => (
                <div key={i} style={kvRow}>
                  <span style={{ ...mono, fontSize: 10.5, color: C.muted }}>{a.screened_name}</span>
                  <span style={{ color: a.risk_level === 'confirmed_match' ? C.red : C.text, textAlign: 'right' }}>
                    {a.risk_level} · {a.lists_checked?.length ?? 0} lists
                  </span>
                </div>
              ))}
            </Section>

            {/* Key people */}
            <Section
              title="Key people"
              meta={`${selected.key_people_checks?.length ?? 0} tagged · ownership ${selected.ownership_total ?? 0}%`}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Person', 'Role tags', 'Ownership', 'Person AML', 'Linked KYC'].map(h => (
                    <th key={h} style={{ ...thStyle, background: 'transparent' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {(selected.key_people_checks ?? []).map(p => (
                    <tr key={p.id}>
                      <td style={tdStyle}>
                        <strong style={{ color: C.text, fontWeight: 500 }}>{p.full_name}</strong>
                        {p.source && <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>{p.source}</div>}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(p.role_tags ?? []).map(t => <Tag key={t}>{t.replace(/_/g, ' ')}</Tag>)}
                        </div>
                      </td>
                      <td style={tdStyle}>{p.ownership_percentage != null ? `${p.ownership_percentage}%` : ''}</td>
                      <td style={{ ...tdStyle, color: p.aml?.risk_level === 'confirmed_match' ? C.red : C.muted }}>
                        {p.aml?.risk_level ?? ''}
                      </td>
                      <td style={tdStyle}>
                        {p.is_corporate ? (
                          p.nested_business_session_id ? (
                            <button onClick={() => openReview(p.nested_business_session_id!)} style={btnSmStyle}>
                              Open subsidiary 
                            </button>
                          ) : (
                            // No child session means nobody has looked behind
                            // this owner - the finding, not a neutral state.
                            <span style={{ color: C.red, ...mono, fontSize: 11 }}>unresolved</span>
                          )
                        ) : p.linked_kyc_session_id ? (
                          `${p.kyc_status ?? 'NOT_STARTED'}`
                        ) : (
                          'Not required'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selected.ubo_kyc_summary && (
                <div style={{ marginTop: 12, ...mono, fontSize: 11, color: C.muted }}>
                  Linked KYC - {selected.ubo_kyc_summary.approved} approved ·{' '}
                  {selected.ubo_kyc_summary.pending} pending · {selected.ubo_kyc_summary.required} required.
                  {!selected.ownership_reconciles && (
                    <span style={{ color: C.red }}> Ownership does not reconcile to 100%.</span>
                  )}
                </div>
              )}
            </Section>

            {/* Structural findings: owners we declined to resolve */}
            {(selected.nesting?.findings?.length ?? 0) > 0 && (
              <Section
                title="Ownership structure findings"
                meta={`${selected.nesting!.findings!.length} unresolved`}
              >
                <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10, lineHeight: 1.6 }}>
                  Nested KYB stopped rather than open a child session for these owners. Each needs a human
                  decision - the chain cannot be walked automatically.
                </div>
                {selected.nesting!.findings!.map((f, i) => (
                  <div
                    key={`${f.owner_name}-${f.finding_type}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: '10px 12px', marginBottom: 8,
                      border: `1px solid ${C.amber}`, background: C.amberDim,
                    }}
                  >
                    <span style={{ ...mono, fontSize: 10, letterSpacing: '.06em', color: C.amber, whiteSpace: 'nowrap' }}>
                      {f.finding_type === 'CIRCULAR_OWNERSHIP' ? 'CIRCULAR' : 'TOO DEEP'}
                    </span>
                    <div>
                      <strong style={{ color: C.text, fontWeight: 500, fontSize: 12.5 }}>{f.owner_name}</strong>
                      <div style={{ ...mono, fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
                        {f.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* Child sessions spawned for corporate owners */}
            {(selected.nesting?.children.length ?? 0) > 0 && (
              <Section
                title="Subsidiary sessions"
                meta={`${selected.nesting!.children.length} opened for corporate owners`}
              >
                <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginBottom: 10, lineHeight: 1.6 }}>
                  Each of these is its own business session, opened automatically to resolve a corporate
                  shareholder. This company cannot be approved while any of them is unresolved.
                </div>
                {selected.nesting!.children.map(child => (
                  <div
                    key={child.session_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 0', borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <span style={{ ...mono, fontSize: 10, color: C.dim }}>└ L{child.depth}</span>
                    <strong style={{ color: C.text, fontWeight: 500, fontSize: 12.5 }}>
                      {child.legal_name || 'Unnamed company'}
                    </strong>
                    <Tag risk={isRiskStatus(child.status)}>{humanStatus(child.status)}</Tag>
                    <button
                      onClick={() => openReview(child.session_id)}
                      style={{ ...btnSmStyle, marginLeft: 'auto' }}
                    >
                      Review 
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {/* Ownership chain */}
            <Section
              title="Ownership chain"
              meta={
                ownershipLoading
                  ? 'loading…'
                  : ownership?.enabled
                    ? `${ownership.traced_percentage}% traced · ${ownership.opaque_percentage}% opaque`
                    : 'not resolved'
              }
            >
              {ownershipLoading && (
                <div style={{ ...mono, fontSize: 11, color: C.dim }}>Walking the ownership tree…</div>
              )}

              {!ownershipLoading && !ownership && (
                <div style={{ ...mono, fontSize: 11, color: C.dim }}>
                  Ownership graph unavailable for this session.
                </div>
              )}

              {/* Nested resolution is off - say which layer decided, so the
                  analyst knows whether to change the workflow or the deployment. */}
              {!ownershipLoading && ownership && !ownership.enabled && (
                <div style={{ ...mono, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
                  {ownership.note}
                  <div style={{ marginTop: 8, color: C.dim }}>
                    Corporate owners appear in Key people above, but nothing has been traced behind them.
                    {ownership.disabled_by === 'workflow' && (
                      <>
                        {' '}
                        <button
                          onClick={() => navigate('/admin/business/workflows')}
                          style={{ ...btnSmStyle, marginLeft: 4 }}
                        >
                          Workflow settings
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!ownershipLoading && ownership?.enabled && (
                <>
                  {/* The headline: can we say who owns this company? Opaque
                      ownership is the one thing here that earns colour. */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
                      padding: '10px 12px',
                      border: `1px solid ${ownership.resolved ? C.border : C.red}`,
                      background: ownership.resolved ? 'transparent' : C.redDim,
                    }}
                  >
                    <span style={{ ...mono, fontSize: 11, color: ownership.resolved ? C.green : C.red }}>
                      {ownership.resolved ? '● resolved' : '● unresolved'}
                    </span>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {ownership.resolved
                        ? 'Ownership traces to natural persons.'
                        : `${ownership.opaque_percentage}% of this company sits behind a corporate owner we know nothing about.`}
                    </span>
                  </div>

                  {/* Traced vs opaque, drawn to scale. */}
                  <div style={{ display: 'flex', height: 6, marginBottom: 4, background: C.border }}>
                    <div style={{ width: `${Math.min(100, ownership.traced_percentage)}%`, background: C.green }} />
                    <div style={{ width: `${Math.min(100, ownership.opaque_percentage)}%`, background: C.red }} />
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginBottom: 14 }}>
                    {ownership.traced_percentage}% traced · {ownership.opaque_percentage}% opaque
                    {' · resolution enabled by '}{ownership.enabled_by}
                  </div>

                  {ownership.structural_warning && (
                    <div
                      style={{
                        marginBottom: 14, padding: '10px 12px',
                        border: `1px solid ${C.amber}`, background: C.amberDim,
                        ...mono, fontSize: 11, color: C.amber, lineHeight: 1.6,
                      }}
                    >
                      {ownership.structural_warning}
                    </div>
                  )}

                  {/* The holes in the graph, listed before the owners we did
                      find - an analyst needs to see what is missing first. */}
                  {ownership.unresolved_owners.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ ...mono, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.red, marginBottom: 8 }}>
                        Unresolved corporate owners
                      </div>
                      {ownership.unresolved_owners.map(u => (
                        <div
                          key={`${u.session_id}-${u.name}`}
                          style={{
                            display: 'flex', justifyContent: 'space-between', gap: 12,
                            padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12,
                          }}
                        >
                          <span style={{ color: C.text }}>{u.name}</span>
                          <span style={{ ...mono, fontSize: 11, color: C.red }}>
                            {u.direct_percentage != null ? `${u.direct_percentage}% - nothing behind it` : 'unknown stake'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ ...mono, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
                    Natural persons behind the company
                  </div>
                  {ownership.beneficial_owners.length === 0 ? (
                    <div style={{ ...mono, fontSize: 11, color: C.dim }}>
                      No natural person has been traced through the chain yet.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>{['Person', 'Effective stake', 'UBO', 'Path'].map(h => (
                          <th key={h} style={{ ...thStyle, background: 'transparent' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {[...ownership.beneficial_owners]
                          .sort((a, b) => b.effective_percentage - a.effective_percentage)
                          .map(o => (
                            <tr key={o.person_id}>
                              <td style={tdStyle}>
                                <strong style={{ color: C.text, fontWeight: 500 }}>{o.full_name}</strong>
                                {o.depth > 0 && (
                                  <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 2 }}>
                                    {o.depth} level{o.depth === 1 ? '' : 's'} down
                                  </div>
                                )}
                              </td>
                              <td style={{ ...tdStyle, ...mono, color: C.text }}>
                                {o.effective_percentage}%
                              </td>
                              <td style={tdStyle}>
                                {o.is_beneficial_owner ? <Tag>UBO</Tag> : <span style={{ color: C.dim }} />}
                              </td>
                              {/* The chain that produced the number: a 10%
                                  stake means little without the route to it. */}
                              <td style={{ ...tdStyle, ...mono, fontSize: 10.5, color: C.dim }}>{o.path}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}

                  <div style={{ marginTop: 12, ...mono, fontSize: 10.5, color: C.dim, lineHeight: 1.7 }}>
                    Effective stake multiplies through the chain - 50% of a company holding 20% is 10%. Someone
                    reachable by several routes has their stakes summed, so a split holding cannot hide under the
                    threshold.
                  </div>
                </>
              )}
            </Section>

            {/* Documents */}
            <Section title="Supporting documents" meta={`${selected.document_verifications?.length ?? 0} collected`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
                {(selected.document_verifications ?? []).map((d, i) => (
                  <div key={i} style={{ padding: 12, border: `1px solid ${C.border}`, background: C.panel }}>
                    <div style={{ ...mono, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
                      {d.document_type.replace(/_/g, ' ')}
                    </div>
                    <div style={kvRow}>
                      <span style={{ ...mono, fontSize: 10.5, color: C.muted }}>status</span>
                      <span style={{ color: d.status === 'FLAGGED' ? C.red : C.text }}>{d.status}</span>
                    </div>
                    <div style={kvRow}>
                      <span style={{ ...mono, fontSize: 10.5, color: C.muted }}>tamper</span>
                      <span style={{ color: d.tamper_check_passed === false ? C.red : C.text }}>
                        {d.tamper_check_passed === false ? 'Failed' : d.tamper_check_passed ? 'Passed' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Decision */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Decision note - cite the document and field that settled it"
                style={{
                  flex: 1, padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 4,
                  outline: 0, background: C.bg, color: C.text, fontSize: 12,
                }}
              />
              <button onClick={() => decide('APPROVED')} disabled={busy} style={{ ...btnStyle, color: C.green, borderColor: C.green }}>
                Approve business
              </button>
              <button onClick={() => decide('IN_REVIEW')} disabled={busy} style={btnStyle}>Escalate</button>
              <button onClick={() => decide('DECLINED')} disabled={busy} style={{ ...btnStyle, color: C.red, borderColor: C.red }}>
                Decline
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Inline style tokens ────────────────────────────────────

const thStyle: React.CSSProperties = {
  background: C.surface,
  textAlign: 'left',
  padding: '10px 14px',
  fontFamily: C.mono,
  fontSize: 10,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: C.dim,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '11px 14px',
  borderBottom: `1px solid ${C.border}`,
  verticalAlign: 'middle',
  color: C.muted,
}

const kvRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '7px 0',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  border: `1px solid ${C.borderStrong}`,
  borderRadius: 5,
  background: 'transparent',
  color: C.text,
  fontFamily: C.mono,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const btnSmStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '5px 10px',
  fontSize: 10.5,
}
