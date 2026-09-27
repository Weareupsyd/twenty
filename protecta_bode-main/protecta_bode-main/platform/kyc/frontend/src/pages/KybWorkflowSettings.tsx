/**
 * KYB workflow settings - the configuration surface for mockup 31.
 *
 * Wired to /api/v2/business/workflows/*. Follows the mockup's layout and
 * monochrome treatment, with one deliberate departure:
 *
 * The mockup draws 19 toggles and a 15-row role matrix. The API persists five
 * settings. Rather than render controls that look live and silently discard
 * what you click, anything without a backing column is grouped under a
 * clearly-labelled read-only section. A dead toggle in a compliance console is
 * worse than an absent one - it tells an operator a control is in force when
 * nothing is enforcing it.
 *
 * The other thing this page has to get right is the tri-state. Every setting
 * is on, off, or inheriting the deployment default, and "inherited (off)" must
 * never be drawn as if the workflow chose off - otherwise flipping the
 * deployment default appears to do nothing.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { API_BASE_URL } from '../config/api'
import { fetchCsrfToken, csrfHeader, clearCsrfToken } from '../lib/csrf'
import { C, injectFonts } from '../theme'

// ─── Types ──────────────────────────────────────────────────

/** null = inherit the deployment default. */
type TriState = boolean | null

interface StoredSettings {
  name: string | null
  description: string | null
  nested_ownership_enabled: TriState
  auto_approve_when_clean: TriState
  required_documents: string[] | null
  ubo_threshold_percentage: number | string | null
  is_active: boolean
}

interface WorkflowDetail {
  workflow_id: string
  registered: boolean
  stored: StoredSettings | null
  effective: {
    nested_ownership_enabled: boolean
    nested_ownership_source: 'call' | 'workflow' | 'deployment'
    required_documents: string[]
  }
}

interface WorkflowSummary {
  workflow_id: string
  name: string | null
  nested_ownership_enabled: TriState
  auto_approve_when_clean: TriState
  required_documents: string[] | null
  ubo_threshold_percentage: number | string | null
  is_active: boolean
}

const DOCUMENT_TYPES = [
  { type: 'certificate_of_incorporation', label: 'Certificate of incorporation', hint: 'legal name · registration number · company type · incorporation date' },
  { type: 'articles_of_association',      label: 'Articles of association',      hint: "share capital · classes · directors' powers · registered office" },
  { type: 'shareholder_register',         label: 'Shareholder register / CR12',  hint: 'owner names · shareholdings · appointment dates - feeds Key People' },
  { type: 'proof_of_address',             label: 'Proof of registered address',  hint: 'utility bill or lease, under 3 months old' },
  { type: 'financial_statements',         label: 'Financial statements',         hint: 'most recent audited set · turnover · year end' },
  { type: 'tax_certificate',              label: 'Tax registration certificate', hint: 'tax / PIN number cross-checked against the certificate' },
  { type: 'board_resolution',             label: 'Board resolution',             hint: 'authority to open the relationship · named signatories' },
  { type: 'operating_licence',            label: 'Operating licence',            hint: 'regulated activity only' },
]

/**
 * Shown in the read-only section. These are real behaviours of the pipeline -
 * they are simply not per-workflow configurable yet, and saying so is more
 * useful than pretending they are.
 */
const FIXED_BEHAVIOURS = [
  { label: 'Company registry lookup', state: 'deferred', detail: 'External registry search is not enabled in this release. Company details are extracted from the uploaded documents instead.' },
  { label: 'Company documents',       state: 'always on', detail: 'Constitutive documents are collected in the hosted flow, OCR extracted and tamper checked.' },
  { label: 'Key people',              state: 'always on', detail: 'UBOs, shareholders, directors, officers and representatives against the 15 canonical role tags.' },
  { label: 'Company AML',             state: 'always on', detail: 'The entity is screened for sanctions, PEP association and adverse media.' },
  { label: 'Person AML',              state: 'always on', detail: 'Every key person is screened against the same source set.' },
  { label: 'Sanctions hit declines',  state: 'always on', detail: 'A sanctions match on the entity or a key person removes the auto-approve path.' },
  { label: 'Cross-check routing',     state: 'always on', detail: 'Any field where documents disagree with each other or with administrator input routes to review.' },
]

// ─── Page ───────────────────────────────────────────────────

export default function KybWorkflowSettings() {
  const navigate = useNavigate()
  const params = useParams<{ workflowId?: string }>()

  const [authReady, setAuthReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [deploymentDefault, setDeploymentDefault] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(params.workflowId ?? '')
  const [detail, setDetail] = useState<WorkflowDetail | null>(null)

  // Draft state - what the form holds before saving.
  const [draftName, setDraftName] = useState('')
  const [draftNested, setDraftNested] = useState<TriState>(null)
  const [draftAutoApprove, setDraftAutoApprove] = useState<TriState>(null)
  const [draftDocs, setDraftDocs] = useState<string[] | null>(null)
  const [draftThreshold, setDraftThreshold] = useState<string>('')
  const [draftActive, setDraftActive] = useState(true)

  const [newWorkflowId, setNewWorkflowId] = useState('')

  useEffect(() => { injectFonts() }, [])

  // Same auth posture as the other admin pages: probe a protected endpoint,
  // bounce to login if the session is not valid.
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v2/business/workflows`, { credentials: 'include' })
      .then(res => {
        if (res.ok) { setAuthReady(true); fetchCsrfToken(); return }
        clearCsrfToken(); navigate('/admin/login')
      })
      .catch(() => { clearCsrfToken(); navigate('/admin/login') })
  }, [navigate])

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/business/workflows`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`)
      const data = await res.json()
      setWorkflows(data.workflows ?? [])
      setDeploymentDefault(Boolean(data.deployment_defaults?.nested_ownership_enabled))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (workflowId: string) => {
    if (!workflowId) { setDetail(null); return }
    setError(null)
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v2/business/workflows/${encodeURIComponent(workflowId)}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`Failed to load workflow (${res.status})`)
      const data: WorkflowDetail = await res.json()
      setDetail(data)

      // Seed the draft from stored values, not from effective ones - editing
      // must start from what this workflow actually declares, or opening and
      // saving an inheriting workflow would silently freeze the current
      // default into it.
      setDraftName(data.stored?.name ?? '')
      setDraftNested(data.stored?.nested_ownership_enabled ?? null)
      setDraftAutoApprove(data.stored?.auto_approve_when_clean ?? null)
      setDraftDocs(data.stored?.required_documents ?? null)
      setDraftThreshold(
        data.stored?.ubo_threshold_percentage === null || data.stored?.ubo_threshold_percentage === undefined
          ? ''
          : String(data.stored.ubo_threshold_percentage),
      )
      setDraftActive(data.stored?.is_active ?? true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workflow')
    }
  }, [])

  useEffect(() => { if (authReady) loadWorkflows() }, [authReady, loadWorkflows])
  useEffect(() => { if (authReady && selectedId) loadDetail(selectedId) }, [authReady, selectedId, loadDetail])

  const save = async () => {
    if (!selectedId) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const threshold = draftThreshold.trim()
      const res = await fetch(
        `${API_BASE_URL}/api/v2/business/workflows/${encodeURIComponent(selectedId)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...csrfHeader() },
          body: JSON.stringify({
            name: draftName || null,
            // Sent explicitly, including null - null is a real instruction
            // meaning "hand this back to the deployment default".
            nested_ownership_enabled: draftNested,
            auto_approve_when_clean: draftAutoApprove,
            required_documents: draftDocs,
            ubo_threshold_percentage: threshold === '' ? null : Number(threshold),
            is_active: draftActive,
          }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? body?.message ?? `Save failed (${res.status})`)
      }
      const saved = await res.json()
      setNotice(
        `Saved. Nested ownership resolution is ${saved.effective?.nested_ownership_enabled ? 'ON' : 'OFF'} ` +
        `for this workflow (${saved.effective?.nested_ownership_source}).`,
      )
      await loadWorkflows()
      await loadDetail(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const createWorkflow = async () => {
    const id = newWorkflowId.trim()
    if (!id) return
    if (!/^[\w.:-]{1,120}$/.test(id)) {
      setError('workflow_id must be 1-120 characters of letters, numbers, dot, colon, dash or underscore')
      return
    }
    setSaving(true); setError(null); setNotice(null)
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v2/business/workflows/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...csrfHeader() },
          // Created with everything inheriting - a new workflow should behave
          // exactly like the deployment until someone decides otherwise.
          body: JSON.stringify({ nested_ownership_enabled: null, auto_approve_when_clean: null }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? `Create failed (${res.status})`)
      }
      setNewWorkflowId('')
      await loadWorkflows()
      setSelectedId(id)
      setNotice(`Workflow "${id}" created. All settings inherit the deployment default until you change them.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleDoc = (type: string) => {
    const current = draftDocs ?? detail?.effective.required_documents ?? []
    setDraftDocs(current.includes(type) ? current.filter(d => d !== type) : [...current, type])
  }

  if (!authReady) {
    return <div style={shellStyle}><div style={{ color: C.dim, fontFamily: C.mono, fontSize: 12 }}>Checking session…</div></div>
  }

  const docsInEffect = draftDocs ?? detail?.effective.required_documents ?? []
  const docsInherited = draftDocs === null

  return (
    <div style={shellStyle}>
      {/* ── Topbar ── */}
      <div style={topbarStyle}>
        <span style={{ fontFamily: C.sans, fontWeight: 600, fontSize: 13, color: C.text }}>kabila</span>
        <span style={{ width: 1, height: 18, background: C.border }} />
        <span style={{ color: C.dim, fontFamily: C.mono, fontSize: 11, letterSpacing: '.04em' }}>
          developer / workflows / business-verification
        </span>
        <div style={{ flex: 1 }} />
        <button style={btnStyle} onClick={() => navigate('/admin/business')}>Business sessions</button>
      </div>

      {/* ── Head ── */}
      <div style={{ margin: '24px 0 22px' }}>
        <div style={eyebrowStyle}>// workflow type: business verification</div>
        <h1 style={{ margin: '8px 0 6px', fontSize: 28, fontWeight: 600, letterSpacing: '-.025em', color: C.text }}>
          KYB workflow
        </h1>
        <p style={{ margin: 0, maxWidth: '72ch', color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          KYB is workflow-typed: a session created against one of these workflow_ids is automatically a business
          session. Settings below decide what that session resolves and requires. Anything left inheriting follows
          the deployment default, so changing the default moves every inheriting workflow with it.
        </p>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}
      {notice && <div style={noticeBoxStyle}>{notice}</div>}

      {/* ── Selector ── */}
      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>
          <div>
            <h2 style={h2Style}>Workflows</h2>
            <p style={sectionSubStyle}>
              A workflow_id used on a session but never registered here simply runs on deployment defaults.
            </p>
          </div>
          <span style={{ ...stateStyle, color: deploymentDefault ? C.green : C.dim }}>
            ● deployment default: nested {deploymentDefault ? 'ON' : 'OFF'}
          </span>
        </div>

        {loading ? (
          <div style={{ color: C.dim, fontFamily: C.mono, fontSize: 12 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Registered workflow</label>
                <select
                  style={inputStyle}
                  value={selectedId}
                  onChange={e => { setSelectedId(e.target.value); setNotice(null) }}
                >
                  <option value="">- select a workflow -</option>
                  {workflows.map(w => (
                    <option key={w.workflow_id} value={w.workflow_id}>
                      {w.workflow_id}{w.name ? ` - ${w.name}` : ''}{w.is_active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {workflows.length === 0 && (
              <div style={{ ...deferredStyle, marginTop: 14 }}>
                No workflows registered yet. Every business session currently runs on the deployment default
                (nested ownership <strong style={{ color: C.text }}>{deploymentDefault ? 'ON' : 'OFF'}</strong>).
                Register one below to give a particular corridor or client its own behaviour.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end', marginTop: 16 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>New workflow_id</label>
                <input
                  style={inputStyle}
                  value={newWorkflowId}
                  placeholder="wf_kyb_ke_corridor"
                  onChange={e => setNewWorkflowId(e.target.value)}
                />
              </div>
              <button style={btnStyle} onClick={createWorkflow} disabled={saving || !newWorkflowId.trim()}>
                Register workflow
              </button>
            </div>
          </>
        )}
      </section>

      {selectedId && detail && (
        <>
          {/* ── Identity ── */}
          <section style={sectionStyle}>
            <div style={sectionHeadStyle}>
              <div>
                <h2 style={h2Style}>Identity</h2>
                <p style={sectionSubStyle}>The workflow_id below is what you send on the session create call.</p>
              </div>
              <span style={{ ...stateStyle, color: draftActive ? C.green : C.dim }}>
                ● {draftActive ? 'Live' : 'Inactive'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Workflow name</label>
                <input style={inputStyle} value={draftName} onChange={e => setDraftName(e.target.value)}
                       placeholder="Business onboarding - KE / SO corridor" />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Workflow type</label>
                <input style={{ ...inputStyle, color: C.accentInk }} value="Business Verification" readOnly />
              </div>
              <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>workflow_id</label>
                <input style={{ ...inputStyle, color: C.accentInk }} value={detail.workflow_id} readOnly />
              </div>
            </div>
            <div style={rowStyle}>
              <div>
                <strong style={rowTitleStyle}>Active</strong>
                <small style={rowHintStyle}>An inactive workflow stops applying its settings; sessions fall back to the deployment default.</small>
              </div>
              <Toggle on={draftActive} onClick={() => setDraftActive(v => !v)} label="Active" />
            </div>
          </section>

          {/* ── Ownership resolution ── */}
          <section style={sectionStyle}>
            <div style={sectionHeadStyle}>
              <div>
                <h2 style={h2Style}>Ownership resolution</h2>
                <p style={sectionSubStyle}>
                  Whether a corporate shareholder opens its own child business session so the chain resolves to
                  natural persons.
                </p>
              </div>
              <span style={{ ...stateStyle, color: detail.effective.nested_ownership_enabled ? C.green : C.dim }}>
                ● in effect: {detail.effective.nested_ownership_enabled ? 'ON' : 'OFF'}
                {' '}({detail.effective.nested_ownership_source})
              </span>
            </div>

            <TriStateRow
              title="Nested KYB for corporate owners"
              hint="When on, a company whose ownership cannot be traced to natural persons is held in review rather than approved."
              value={draftNested}
              onChange={setDraftNested}
              inheritedValue={deploymentDefault}
            />

            <TriStateRow
              title="Auto-approve when everything is clean"
              hint="All required documents read, ownership reconciles, no AML hit, every required child KYC approved."
              value={draftAutoApprove}
              onChange={setDraftAutoApprove}
              inheritedValue={false}
            />

            <div style={{ ...fieldStyle, marginTop: 14, maxWidth: 280 }}>
              <label style={labelStyle}>UBO threshold %</label>
              <input
                style={inputStyle}
                value={draftThreshold}
                placeholder="25 (FATF default)"
                onChange={e => setDraftThreshold(e.target.value)}
              />
              <small style={{ ...rowHintStyle, marginTop: 6 }}>
                Leave blank to inherit the 25% FATF convention. Some regimes use 10%. Applies to the effective
                stake through the chain, not the direct holding.
              </small>
            </div>

            {draftNested === true && (
              <div style={{ ...deferredStyle, marginTop: 14 }}>
                <strong style={{ color: C.text }}>This changes verdicts.</strong> A company with an unresolved
                corporate owner will move from APPROVED to IN_REVIEW with reason OWNERSHIP_CHAIN_OPAQUE. Circular
                ownership and chains deeper than five levels are reported for analyst review rather than resolved
                automatically.
              </div>
            )}
          </section>

          {/* ── Documents ── */}
          <section style={sectionStyle}>
            <div style={sectionHeadStyle}>
              <div>
                <h2 style={h2Style}>Required documents</h2>
                <p style={sectionSubStyle}>Which documents must be read before the session can reach a verdict.</p>
              </div>
              <span style={{ ...stateStyle, color: docsInherited ? C.dim : C.green }}>
                ● {docsInherited ? 'inherited' : `${docsInEffect.length} required`}
              </span>
            </div>

            {docsInherited && (
              <div style={{ ...deferredStyle, marginBottom: 14 }}>
                Inheriting the default set. Changing any checkbox below makes this workflow's own list.
                {' '}
                <button style={linkBtnStyle} onClick={() => setDraftDocs([...docsInEffect])}>
                  Start from the default
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 26px' }}>
              {DOCUMENT_TYPES.map(doc => (
                <div key={doc.type} style={rowStyle}>
                  <div>
                    <strong style={rowTitleStyle}>{doc.label}</strong>
                    <small style={rowHintStyle}>{doc.hint}</small>
                  </div>
                  <Toggle on={docsInEffect.includes(doc.type)} onClick={() => toggleDoc(doc.type)} label={doc.label} />
                </div>
              ))}
            </div>

            {draftDocs !== null && (
              <div style={{ marginTop: 14 }}>
                <button style={linkBtnStyle} onClick={() => setDraftDocs(null)}>
                  Reset to the inherited default
                </button>
                {draftDocs.length === 0 && (
                  <div style={{ ...deferredStyle, marginTop: 10 }}>
                    <strong style={{ color: C.text }}>No documents required.</strong> This is a real setting, not
                    an empty one - sessions on this workflow will reach a verdict without any document being read.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Save ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={btnStyle} onClick={() => loadDetail(selectedId)} disabled={saving}>Discard changes</button>
            <button style={{ ...btnStyle, borderColor: C.accent, color: C.accentInk }} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save workflow'}
            </button>
          </div>
        </>
      )}

      {/* ── Not configurable ── */}
      <section style={{ ...sectionStyle, marginTop: 22 }}>
        <div style={sectionHeadStyle}>
          <div>
            <h2 style={h2Style}>Fixed pipeline behaviour</h2>
            <p style={sectionSubStyle}>
              These run on every business session and are not per-workflow settings yet. They are listed so the
              page reflects what actually happens - not as controls.
            </p>
          </div>
          <span style={{ ...stateStyle, color: C.dim }}>● read only</span>
        </div>
        {FIXED_BEHAVIOURS.map(b => (
          <div key={b.label} style={rowStyle}>
            <div>
              <strong style={rowTitleStyle}>{b.label}</strong>
              <small style={rowHintStyle}>{b.detail}</small>
            </div>
            <span style={{ ...stateStyle, color: b.state === 'deferred' ? C.amber : C.dim, flex: '0 0 auto' }}>
              {b.state}
            </span>
          </div>
        ))}
        <div style={{ ...deferredStyle, marginTop: 14 }}>
          <strong style={{ color: C.text }}>Role tags and per-role KYC policy are not editable here.</strong>{' '}
          The 15 canonical tags and their default KYC requirements are applied by the backend role model. The
          mockup shows a per-role matrix; there is no column behind it yet, so it is omitted rather than drawn as
          a control that would discard what you set.
        </div>
      </section>
    </div>
  )
}

// ─── Components ─────────────────────────────────────────────

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      style={{
        width: 38, height: 20, padding: 0, border: 0, borderRadius: 10,
        position: 'relative', flex: '0 0 auto', cursor: 'pointer',
        background: on ? C.accent : C.borderStrong,
      }}
    >
      <span style={{
        position: 'absolute', width: 16, height: 16, top: 2, left: on ? 20 : 2,
        borderRadius: '50%', background: on ? '#03171b' : C.text, transition: 'left .12s',
      }} />
    </button>
  )
}

/**
 * On / Off / Inherit.
 *
 * Inherit is a first-class choice rather than an absence, because "off" and
 * "inheriting something that is currently off" behave identically today and
 * differently the moment the deployment default changes.
 */
function TriStateRow({
  title, hint, value, onChange, inheritedValue,
}: {
  title: string
  hint: string
  value: TriState
  onChange: (v: TriState) => void
  inheritedValue: boolean
}) {
  const options: Array<{ label: string; v: TriState }> = [
    { label: 'On', v: true },
    { label: 'Off', v: false },
    { label: 'Inherit', v: null },
  ]
  return (
    <div style={rowStyle}>
      <div>
        <strong style={rowTitleStyle}>{title}</strong>
        <small style={rowHintStyle}>{hint}</small>
        {value === null && (
          <small style={{ ...rowHintStyle, color: C.dim }}>
            Following the deployment default, currently <strong style={{ color: C.muted }}>
              {inheritedValue ? 'ON' : 'OFF'}
            </strong>. Changing the default will move this workflow with it.
          </small>
        )}
      </div>
      <span style={{ display: 'inline-flex', border: `1px solid ${C.borderStrong}`, borderRadius: 4, overflow: 'hidden', flex: '0 0 auto' }}>
        {options.map(opt => {
          const active = value === opt.v
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.v)}
              style={{
                padding: '5px 11px', border: 0, cursor: 'pointer',
                background: active ? C.surfaceHover : 'transparent',
                color: active ? (opt.v === true ? C.accentInk : C.text) : C.dim,
                fontFamily: C.mono, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </span>
    </div>
  )
}

// ─── Inline style tokens ────────────────────────────────────

const shellStyle: React.CSSProperties = {
  width: 'min(100%, 1120px)', margin: '0 auto', padding: '28px 36px 90px',
  minHeight: '100vh', background: C.bg, fontFamily: C.sans,
}

const topbarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14,
  paddingBottom: 20, borderBottom: `1px solid ${C.border}`,
}

const eyebrowStyle: React.CSSProperties = {
  color: C.dim, fontFamily: C.mono, fontSize: 10,
  letterSpacing: '.08em', textTransform: 'uppercase',
}

const sectionStyle: React.CSSProperties = {
  background: C.panel, border: `1px solid ${C.border}`, padding: '19px 21px', marginTop: 14,
}

const sectionHeadStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18,
  paddingBottom: 11, marginBottom: 14, borderBottom: `1px solid ${C.border}`,
}

const h2Style: React.CSSProperties = { margin: '0 0 3px', fontSize: 14, fontWeight: 600, color: C.text }

const sectionSubStyle: React.CSSProperties = {
  margin: 0, maxWidth: '74ch', color: C.dim, fontSize: 11.5, lineHeight: 1.6,
}

const stateStyle: React.CSSProperties = {
  flex: '0 0 auto', fontFamily: C.mono, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '.06em',
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
  padding: '11px 0', borderBottom: `1px solid ${C.border}`,
}

const rowTitleStyle: React.CSSProperties = {
  display: 'block', fontSize: 12.5, fontWeight: 500, color: C.text,
}

const rowHintStyle: React.CSSProperties = {
  display: 'block', marginTop: 3, color: C.dim, fontFamily: C.mono, fontSize: 10.5, lineHeight: 1.5,
}

const fieldStyle: React.CSSProperties = { display: 'grid', gap: 5, minWidth: 0 }

const labelStyle: React.CSSProperties = {
  color: C.muted, fontFamily: C.mono, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '.06em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 4,
  outline: 0, background: C.surface, color: C.text, fontFamily: C.mono, fontSize: 12,
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
  border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: 'transparent',
  color: C.text, fontFamily: C.mono, fontSize: 11.5, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
}

const linkBtnStyle: React.CSSProperties = {
  border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
  color: C.accentInk, fontFamily: C.mono, fontSize: 10.5, textDecoration: 'underline',
}

const deferredStyle: React.CSSProperties = {
  border: `1px solid ${C.borderStrong}`, padding: '11px 13px',
  color: C.muted, fontSize: 11.5, lineHeight: 1.6,
}

const errorBoxStyle: React.CSSProperties = {
  border: `1px solid ${C.red}`, background: C.redDim, padding: '11px 13px',
  color: C.red, fontFamily: C.mono, fontSize: 11.5, marginBottom: 14,
}

const noticeBoxStyle: React.CSSProperties = {
  border: `1px solid ${C.green}`, background: C.greenDim, padding: '11px 13px',
  color: C.green, fontFamily: C.mono, fontSize: 11.5, marginBottom: 14,
}
