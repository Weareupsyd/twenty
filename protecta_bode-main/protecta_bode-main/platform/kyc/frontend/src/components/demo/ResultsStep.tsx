import React from 'react';
import { C } from '../../theme';
import type { VerificationRequest } from './types';
import { getDocumentationApiUrl } from '../../config/api';
import { cleanOcrValue, sanitizeOcrIdentity } from '../../utils/ocrFields';

// ─── JSON syntax highlighting ───────────────────────────────────
const jsonTokenColors = {
  key: C.accent,
  string: C.green,
  number: C.amber,
  boolean: C.purple,
  null: C.red,
  brace: C.dim,
  comma: 'rgba(255,255,255,0.25)',
} as const;

function highlightJson(obj: unknown): React.ReactNode[] {
  const raw = JSON.stringify(obj, null, 2);
  if (!raw) return [];
  // Tokenize JSON string into colored spans
  const nodes: React.ReactNode[] = [];
  // Regex matches: strings (including keys), numbers, booleans, null, braces/brackets, commas/colons
  const tokenRe = /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)|([{}\[\]])|([,:])|\n( *)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = tokenRe.exec(raw)) !== null) {
    // Any unmatched text between tokens
    if (match.index > lastIndex) {
      nodes.push(raw.slice(lastIndex, match.index));
    }
    lastIndex = match.index + match[0].length;
    if (match[1]) {
      // Key (quoted string followed by colon)
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.key }}>{match[1]}</span>);
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.comma }}>: </span>);
    } else if (match[2]) {
      // String value
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.string }}>{match[2]}</span>);
    } else if (match[3]) {
      // Number
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.number }}>{match[3]}</span>);
    } else if (match[4]) {
      // Boolean
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.boolean }}>{match[4]}</span>);
    } else if (match[5]) {
      // null
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.null }}>{match[5]}</span>);
    } else if (match[6]) {
      // Braces / brackets
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.brace }}>{match[6]}</span>);
    } else if (match[7]) {
      // Comma / colon
      nodes.push(<span key={i++} style={{ color: jsonTokenColors.comma }}>{match[7]}</span>);
    } else if (match[8] !== undefined) {
      // Newline + indentation
      nodes.push('\n' + match[8]);
    }
  }
  if (lastIndex < raw.length) nodes.push(raw.slice(lastIndex));
  return nodes;
}

interface ResultsStepProps {
  verificationRequest: VerificationRequest;
  isMobile: boolean;
  retryProcessing: boolean;
  onRetry: () => void;
  onStartNew: () => void;
  onGoToAddress: () => void;
  onGoToCredential?: () => void;
}

// Helper: score display for 0-1 or 0-100 values - percentage only, no bars
const ScoreBar = ({ value, max = 1, color, label, detail }: { value: number | null | undefined; max?: number; color: string; label: string; detail?: string }) => {
  if (value == null) return null;
  const pct = max === 1 ? Math.round(value * 100) : Math.round(value);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
        <span style={{ color: C.muted }}>{label}</span>
        <span style={{ color, fontWeight: 700, fontFamily: C.mono, fontSize: 16 }}>{pct}%</span>
      </div>
      {detail && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{detail}</div>}
    </div>
  );
};

// Helper: pass/fail badge
const Badge = ({ passed, label }: { passed: boolean | null | undefined; label?: string }) => {
  if (passed == null) return <span style={{ color: C.dim, fontSize: 11 }}>N/A</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 600, padding: '2px 8px',
      fontFamily: C.mono, letterSpacing: '0.03em',
      background: passed ? C.greenDim : C.redDim,
      color: passed ? C.green : C.red,
      border: `1px solid ${passed ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
    }}>
      {passed ? '\u2713' : '\u2717'} {label ?? (passed ? 'Passed' : 'Failed')}
    </span>
  );
};

export const ResultsStep: React.FC<ResultsStepProps> = ({
  verificationRequest,
  isMobile,
  retryProcessing,
  onRetry,
  onStartNew,
  onGoToAddress,
  onGoToCredential,
}) => {
  // v2: final_result has user-facing status, status has internal machine state
  const status = verificationRequest?.final_result ?? verificationRequest?.status;
  const isVerified = status === 'verified';
  const isFailed = status === 'failed';
  const ageVerif = (verificationRequest as any)?.age_verification;
  const isAgeOnly = !!(ageVerif && !verificationRequest?.cross_validation_results);
  const statusTone = isVerified ? C.green : isFailed ? C.red : C.amber;
  const statusBg = isVerified ? C.greenDim : isFailed ? C.redDim : C.amberDim;
  const statusIcon = isVerified ? '\u2713' : isFailed ? '\u2717' : '\u26A0';
  const statusLabel = isAgeOnly
    ? (isVerified ? 'Age Verified' : 'Age Verification Failed')
    : (isVerified ? 'Verification Complete' : isFailed ? 'Verification Failed' : 'Under Review');

  const cv = verificationRequest?.cross_validation_results;
  const fm = verificationRequest?.face_match_results;
  // Normalize liveness result shape - response uses snake_case, immediate
  // POST response uses camelCase, and older records may use the legacy shape.
  const lvRaw = verificationRequest?.liveness_results;
  const lv = lvRaw ? {
    passed: lvRaw.passed ?? lvRaw.liveness_passed,
    score: lvRaw.score ?? lvRaw.liveness_score,
    threshold: lvRaw.threshold ?? lvRaw.liveness_threshold,
    provider: lvRaw.provider ?? lvRaw.liveness_provider,
    mode: lvRaw.mode ?? lvRaw.liveness_mode,
    signals: lvRaw.signals ?? lvRaw.liveness_signals ?? null,
  } : null;
  const aml = verificationRequest?.aml_screening;
  const unifiedScreening = verificationRequest?.unified_screening;
  const risk = verificationRequest?.risk_score;
  const ageEst = verificationRequest?.age_estimation;

  // Extracted document data - label artifacts and mixed OCR dumps are
  // split so each field is a short value, never a whole ID-card sentence.
  const ocr = (verificationRequest?.ocr_data ?? {}) as Record<string, any>;
  const ocrConfidence = (ocr.confidence_scores ?? {}) as Record<string, number>;
  const identity = sanitizeOcrIdentity(ocr);
  const extractedName = identity.name || cleanOcrValue(ocr.full_name) || cleanOcrValue(ocr.name);
  const extractedDob = identity.dateOfBirth;
  const extractedSex = identity.sex;
  const extractedNationality = identity.nationality;
  const extractedDocNumber = identity.idNumber;
  const extractedExpiry = identity.expiry;

  // Per-field OCR confidence (first matching key wins)
  const fieldConfidence = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = ocrConfidence[k];
      if (typeof v === 'number' && !isNaN(v)) return Math.round(v * 100);
    }
    return null;
  };
  const confidenceColor = (pct: number) => (pct >= 80 ? C.green : pct >= 60 ? C.amber : C.red);

  const extractedFields: [string, string | null, number | null][] = [
    ['Name', extractedName, fieldConfidence('full_name', 'name')],
    ['Document #', extractedDocNumber, fieldConfidence('document_number', 'id_number')],
    ['Date of Birth', extractedDob, fieldConfidence('date_of_birth', 'dob')],
    ['Sex', extractedSex, fieldConfidence('sex', 'gender')],
    ['Nationality', extractedNationality, fieldConfidence('nationality')],
    ['Expiry', extractedExpiry, fieldConfidence('expiry_date', 'expiration_date')],
  ];
  const visibleExtracted = extractedFields.filter(([, v]) => v);

  // Document classification confidence (auto-detect)
  const classificationPct = typeof ocr.classification_confidence === 'number'
    ? Math.round(ocr.classification_confidence * 100)
    : null;

  // Overall confidence score if the API reported one (0-1 or 0-100)
  const overallConfidenceRaw = (verificationRequest as any)?.confidence_score;
  const overallConfidencePct = typeof overallConfidenceRaw === 'number'
    ? Math.round(overallConfidenceRaw <= 1 ? overallConfidenceRaw * 100 : overallConfidenceRaw)
    : null;

  // Card style
  const cardStyle: React.CSSProperties = {
    background: C.panel, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12, textAlign: 'left',
  };
  const cardTitle: React.CSSProperties = {
    fontFamily: C.mono, fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 10, letterSpacing: '0.04em', textTransform: 'uppercase' as const,
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Status Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ width: 56, height: 56, background: statusBg, border: `1px solid ${statusTone}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22, color: statusTone }}>
          {statusIcon}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: C.text, marginBottom: 4 }}>{statusLabel}</h2>
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
          {isAgeOnly
            ? isVerified
              ? `Age requirement (${ageVerif?.age_threshold}+) met successfully. Please proceed to the next step.`
              : (verificationRequest?.rejection_detail || (verificationRequest as any)?.message || 'Age verification failed. Please contact our customer support for alternative verification methods.')
            : <>
                {isVerified && 'All gates passed. Identity verified successfully. Please proceed to the next step.'}
                {isFailed && (verificationRequest?.rejection_detail || 'Verification failed. Please contact our customer support for alternative verification methods or try again.')}
                {!isVerified && !isFailed && 'Your verification is under manual review. You will be notified of the result.'}
              </>}
        </p>
        {verificationRequest?.rejection_reason && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '4px 12px', background: C.redDim, border: `1px solid rgba(248,113,113,0.2)` }}>
            <span style={{ color: C.red, fontSize: 11, fontFamily: C.mono, fontWeight: 600 }}>{verificationRequest.rejection_reason}</span>
          </div>
        )}
      </div>

      {/* Rejection Breakdown (Segmented details) */}
      {verificationRequest?.rejection_breakdown && (
        <div style={{ ...cardStyle, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)` }}>
          <div style={{ ...cardTitle, color: C.red }}>Rejection Details (Segmented Breakdown)</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            {verificationRequest.rejection_breakdown.summary}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontFamily: C.mono, textTransform: 'uppercase' as const, padding: '2px 8px', background: C.red, color: '#fff', fontWeight: 600 }}>
              Category: {verificationRequest.rejection_breakdown.category}
            </span>
            {verificationRequest.rejection_breakdown.score_details?.actual_score != null && (
              <span style={{ fontSize: 11, fontFamily: C.mono, color: C.muted }}>
                Score: {verificationRequest.rejection_breakdown.score_details.actual_score} (required: {verificationRequest.rejection_breakdown.score_details.required_threshold})
              </span>
            )}
          </div>

          {verificationRequest.rejection_breakdown.field_mismatches && verificationRequest.rejection_breakdown.field_mismatches.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid rgba(248,113,113,0.2)` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 4 }}>Specific Field Mismatches:</div>
              {verificationRequest.rejection_breakdown.field_mismatches.map((fm: any, idx: number) => (
                <div key={idx} style={{ fontSize: 12, color: C.muted, marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${C.red}` }}>
                  <strong style={{ color: C.text }}>{fm.field}:</strong> {fm.reason}
                </div>
              ))}
            </div>
          )}

          {verificationRequest.rejection_breakdown.details && verificationRequest.rejection_breakdown.details.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 4 }}>Detailed Signals:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.muted }}>
                {verificationRequest.rejection_breakdown.details.map((d: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: 2 }}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Extracted ID Face Card - standard headshot crop */}
      {(() => {
        const standard =
          verificationRequest?.id_face_base64 ||
          (verificationRequest?.ocr_data as any)?.id_face_base64 ||
          null;
        if (!standard) return null;

        // Build endpoint URL using the current origin (self-hosted) or
        // configured API base, with the real verification_id filled in.
        const apiBase = getDocumentationApiUrl().replace(/\/+$/, '');
        const vid = verificationRequest?.verification_id || verificationRequest?.id || '<verification_id>';
        const headshotUrl = `${apiBase}/api/v2/verify/${vid}/id-face`;
        // Pretty-print with a line-break before the ID so long URLs don't blow out the card width
        const breakUrl = (u: string) => {
          const i = u.lastIndexOf('/verify/');
          if (i < 0) return u;
          const before = u.slice(0, i + '/verify/'.length);
          const after = u.slice(i + '/verify/'.length);
          return (
            <>
              {before}
              <wbr />
              {after}
            </>
          );
        };

        return (
          <div style={cardStyle}>
            <div style={cardTitle}>Extracted ID Face Photo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <img
                  src={standard}
                  alt="Cropped face from ID (headshot)"
                  style={{ width: 80, height: 80, objectFit: 'cover', border: `1px solid ${C.borderStrong}`, display: 'block' }}
                />
                <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: C.mono }}>id-face (headshot)</div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>
                  Cropped Photo from Front ID
                </div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7, wordBreak: 'break-all' }}>
                  <div>
                    <span style={{ color: C.dim }}>Headshot:</span>{' '}
                    <code style={{ color: C.accent, fontFamily: C.mono, fontSize: 10 }}>
                      GET {breakUrl(headshotUrl)}
                    </code>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: C.dim }}>
                    Replace <code style={{ fontFamily: C.mono }}>{vid === '<verification_id>' ? '<verification_id>' : vid}</code>{' '}
                    with the verification ID returned from <code style={{ fontFamily: C.mono }}>/initialize</code>.
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Extracted Document Data - filtered so label text never renders as data */}
      {visibleExtracted.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={cardTitle}>Extracted Document Data</div>
            {classificationPct != null && (
              <span style={{ fontSize: 10, color: C.dim, fontFamily: C.mono }}>
                type detection {classificationPct}%
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', columnGap: 20, rowGap: 6, fontSize: 13 }}>
            {visibleExtracted.map(([label, value, conf]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <span style={{ color: C.muted }}>{label}</span>
                <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                  <span style={{ color: C.text, fontFamily: C.mono, fontSize: 12 }}>{value}</span>
                  {conf != null && (
                    <span style={{ color: confidenceColor(conf), fontFamily: C.mono, fontSize: 10, marginLeft: 6 }}>
                      {conf}%
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 8, fontFamily: C.mono }}>
            Percentages are the OCR confidence for each extracted field.
          </div>
        </div>
      )}

      {/* Verification Overview Card */}
      <div style={cardStyle}>
        <div style={cardTitle}>Overview</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Verification ID</span>
            <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{verificationRequest?.verification_id?.slice(0, 12)}{'\u2026'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Status</span>
            <span style={{ color: statusTone, fontWeight: 600, textTransform: 'capitalize' }}>{status}</span>
          </div>
          {overallConfidencePct != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.muted }}>Overall Confidence</span>
              <span style={{ color: confidenceColor(overallConfidencePct), fontWeight: 700, fontFamily: C.mono }}>{overallConfidencePct}%</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Pipeline Step</span>
            <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{verificationRequest?.current_step ?? 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: C.muted }}>Created</span>
            <span style={{ color: C.text }}>{verificationRequest?.created_at ? new Date(verificationRequest.created_at).toLocaleString() : 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Age Verification Card */}
      {ageVerif && (
        <div style={cardStyle}>
          <div style={cardTitle}>Age Verification</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.muted }}>Age Check</span>
              <Badge passed={ageVerif.is_of_age} label={ageVerif.is_of_age ? 'Passed' : 'Failed'} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.muted }}>Minimum Age</span>
              <span style={{ color: C.text, fontWeight: 600 }}>{ageVerif.age_threshold}+</span>
            </div>
            {extractedDob && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: C.muted }}>Date of Birth (read)</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: C.text, fontFamily: C.mono, fontSize: 12 }}>{extractedDob}</span>
                  {fieldConfidence('date_of_birth', 'dob') != null && (
                    <span style={{ color: confidenceColor(fieldConfidence('date_of_birth', 'dob')!), fontFamily: C.mono, fontSize: 10, marginLeft: 6 }}>
                      {fieldConfidence('date_of_birth', 'dob')}%
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result Cards Grid */}
      {!isAgeOnly && (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Cross-Validation */}
        <div style={cardStyle}>
          <div style={cardTitle}>Cross-Validation</div>
          {cv ? (
            <>
              <ScoreBar value={cv.overall_score} color={cv.verdict === 'PASS' ? C.green : cv.verdict === 'REJECT' ? C.red : C.amber} label="Overall Score" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.muted }}>Verdict</span>
                <Badge passed={cv.verdict === 'PASS'} label={cv.verdict} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: C.muted }}>Doc Expired</span>
                <span style={{ color: cv.document_expired ? C.red : C.green, fontSize: 11, fontWeight: 600 }}>{cv.document_expired ? 'Yes' : 'No'}</span>
              </div>
              {cv.field_scores && Object.keys(cv.field_scores).length > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: C.dim, marginBottom: 4, fontFamily: C.mono }}>Field Scores</div>
                  {Object.entries(cv.field_scores).map(([field, data]) => (
                    <div key={field} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                      <span style={{ color: C.dim }}>{field}</span>
                      <span style={{ color: data.passed ? C.green : C.red, fontFamily: C.mono }}>{Math.round(data.score * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span style={{ color: C.dim, fontSize: 12 }}>Not completed</span>
          )}
        </div>

        {/* Face Match */}
        <div style={cardStyle}>
          <div style={cardTitle}>Face Match</div>
          {fm ? (
            <>
              <ScoreBar value={fm.similarity_score} color={fm.passed ? C.green : C.red} label="Similarity" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.muted }}>Result</span>
                <Badge passed={fm.passed} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: C.muted }}>Threshold</span>
                <span style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{fm.threshold_used != null ? `${Math.round(fm.threshold_used * 100)}%` : 'N/A'}</span>
              </div>
            </>
          ) : (
            <span style={{ color: C.dim, fontSize: 12 }}>Not completed</span>
          )}
        </div>

        {/* Age Estimation */}
        {ageEst && (
        <div style={cardStyle}>
          <div style={cardTitle}>Age Estimation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {ageEst.live_face_age != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.muted }}>Estimated Age (Live Photo)</span>
                <span style={{ color: C.text, fontWeight: 700, fontFamily: C.mono, fontSize: 15 }}>{ageEst.live_face_age} yrs</span>
              </div>
            )}
            {ageEst.declared_age != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: C.muted }}>Declared Age (from DOB)</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: C.text, fontWeight: 600, fontFamily: C.mono }}>{ageEst.declared_age} yrs</span>
                  {fieldConfidence('date_of_birth', 'dob') != null && (
                    <span style={{ color: confidenceColor(fieldConfidence('date_of_birth', 'dob')!), fontFamily: C.mono, fontSize: 10, marginLeft: 6 }}>
                      DOB read {fieldConfidence('date_of_birth', 'dob')}%
                    </span>
                  )}
                </span>
              </div>
            )}
            {ageEst.document_face_age != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.muted }}>Estimated Age (ID Photo)</span>
                <span style={{ color: C.dim, fontFamily: C.mono, fontSize: 12 }}>{ageEst.document_face_age} yrs</span>
              </div>
            )}
            {ageEst.age_discrepancy != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted }}>Live vs Declared Gap</span>
                <Badge
                  passed={ageEst.age_discrepancy < 5}
                  label={`${ageEst.age_discrepancy} year${ageEst.age_discrepancy !== 1 ? 's' : ''}`}
                />
              </div>
            )}
            <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, marginTop: 2 }}>
              Estimates come from the face model; declared age is computed from the DOB read off the document.
            </div>
          </div>
        </div>
        )}

        {/* Liveness */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={cardTitle}>Liveness Detection</div>
            {lv?.mode && (
              <span style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {lv.mode === 'head_turn' ? 'head-turn' : 'passive'}{lv.provider ? ` · ${lv.provider}` : ''}
              </span>
            )}
          </div>
          {lv ? (
            <>
              <ScoreBar value={lv.score} color={lv.passed ? C.green : C.red} label="Liveness Score" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.muted }}>Result</span>
                <Badge passed={lv.passed} />
              </div>
              {lv.threshold != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.dim, fontFamily: C.mono, marginBottom: 4 }}>
                  <span>threshold</span>
                  <span>{(lv.threshold * 100).toFixed(0)}%</span>
                </div>
              )}
              {Array.isArray(lv.signals) && lv.signals.length > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    Signal breakdown
                  </div>
                  {lv.signals.map((s: any) => {
                    const pct = Math.round((s.score ?? 0) * 100);
                    const sigColor = pct >= 70 ? C.green : pct >= 50 ? C.amber : C.red;
                    return (
                      <div key={s.key} style={{ marginBottom: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: C.mono, alignItems: 'baseline' }}>
                          <span style={{ color: C.muted }}>{s.label || s.key}</span>
                          <span style={{ color: sigColor, fontWeight: 700 }}>{pct}%</span>
                        </div>
                        {s.note && (
                          <div style={{ fontSize: 9, color: C.dim, marginTop: 1, fontFamily: C.mono }}>{s.note}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <span style={{ color: C.dim, fontSize: 12 }}>Not completed</span>
          )}
        </div>

        {/* Unified AML Screening - full result, no second-screen handoff */}
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
          <div style={cardTitle}>Unified AML / Sanctions Screening</div>
          {unifiedScreening ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  ['Status', unifiedScreening.status],
                  ['Risk', unifiedScreening.summary.risk_level],
                  ['Matches', unifiedScreening.summary.total_matches],
                  ['Sanctions', unifiedScreening.summary.sanctions_matches],
                  ['PEP', unifiedScreening.summary.pep_related_matches],
                  ['Review', unifiedScreening.summary.requires_human_review ? 'Required' : 'No'],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: '8px 10px' }}>
                    <div style={{ color: C.dim, fontFamily: C.mono, fontSize: 9, textTransform: 'uppercase' }}>{label}</div>
                    <div style={{ color: C.text, fontFamily: C.mono, fontSize: 12, marginTop: 3, textTransform: 'capitalize' }}>{String(value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ color: C.dim, fontFamily: C.mono, fontSize: 10, marginBottom: 10 }}>
                Reference {unifiedScreening.reference} · screened {new Date(unifiedScreening.timestamp).toLocaleString()}
                {unifiedScreening.data_freshness?.dataset_version ? ` · dataset ${unifiedScreening.data_freshness.dataset_version}` : ''}
              </div>

              {unifiedScreening.matches.length === 0 ? (
                <div style={{ color: C.green, background: C.greenDim, border: `1px solid rgba(52,211,153,0.25)`, padding: 10, fontSize: 12 }}>
                  Clear - no sanctions or PEP candidates above the screening threshold.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {unifiedScreening.matches.map((match, index) => (
                    <div key={match.entity_id || index} style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                        <b style={{ color: C.text, fontSize: 12 }}>{match.caption || match.entity_id || 'Unknown match'}</b>
                        <span style={{ color: C.red, fontFamily: C.mono, fontSize: 12 }}>{Math.round(Number(match.score || 0) * 100)}%</span>
                      </div>
                      <div style={{ color: C.dim, fontFamily: C.mono, fontSize: 10, marginTop: 4 }}>
                        {(match.risk_categories || []).join(' · ') || 'other'} · {(match.datasets || []).join(' · ') || 'OpenSanctions'}
                        {(match.countries || []).length ? ` · ${match.countries!.join(' · ')}` : ''}
                      </div>
                      {(match.sanctions || []).map((sanction, sanctionIndex) => (
                        <div key={sanctionIndex} style={{ color: C.muted, fontSize: 10, marginTop: 5 }}>
                          {[sanction.authority, sanction.program, sanction.reason].filter(Boolean).join(' · ')}
                        </div>
                      ))}
                      {(match.source_links || []).filter((link) => link.url).map((link, linkIndex) => (
                        <a key={linkIndex} href={link.url} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 10, marginRight: 10 }}>
                          {link.source} 
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {unifiedScreening.relationships.length > 0 && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <div style={{ ...cardTitle, marginBottom: 6 }}>Relationships ({unifiedScreening.relationships.length})</div>
                  {unifiedScreening.relationships.map((relationship, index) => (
                    <div key={`${relationship.entity_id || 'relationship'}-${index}`} style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>
                      {relationship.relationship_type || 'related'} · {relationship.person || '-'} &rarr; {relationship.entity_name || relationship.entity_id || '-'}
                      {relationship.country ? ` · ${relationship.country}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {unifiedScreening.analyst_note && <div style={{ color: C.dim, fontSize: 10, marginTop: 10 }}>{unifiedScreening.analyst_note}</div>}
            </>
          ) : aml ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: C.muted }}>Risk Level</span>
                <Badge passed={aml.risk_level === 'clear'} label={aml.risk_level?.replace('_', ' ')} />
              </div>
              <div style={{ color: C.dim, fontSize: 11 }}>
                Compact fallback result · {aml.match_count ?? 0} match(es) · {(aml.lists_checked || []).join(', ') || 'no lists recorded'}
              </div>
            </>
          ) : (
            <span style={{ color: C.amber, fontSize: 12 }}>Screening was unavailable. The verification requires compliance review.</span>
          )}
        </div>
      </div>
      )}

      {/* Risk Score - full width */}
      {risk && (
        <div style={cardStyle}>
          <div style={cardTitle}>Risk Score</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              fontSize: 18, fontWeight: 700, fontFamily: C.mono,
              background: risk.risk_level === 'low' ? C.greenDim : risk.risk_level === 'medium' ? C.amberDim : C.redDim,
              border: `2px solid ${risk.risk_level === 'low' ? C.green : risk.risk_level === 'medium' ? C.amber : C.red}`,
              color: risk.risk_level === 'low' ? C.green : risk.risk_level === 'medium' ? C.amber : C.red,
            }}>
              {risk.overall_score}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{risk.risk_level} Risk</span>
                <span style={{ color: risk.risk_level === 'low' ? C.green : risk.risk_level === 'medium' ? C.amber : C.red, fontSize: 14, fontWeight: 700, fontFamily: C.mono }}>
                  {risk.overall_score}%
                </span>
              </div>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono }}>0{'\u2013'}100 scale · lower is better</div>
              {risk.risk_factors && risk.risk_factors.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {risk.risk_factors.map((f, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '1px 6px', background: C.surface, border: `1px solid ${C.border}`, color: C.dim, fontFamily: C.mono }}>
                      {f.factor}{typeof f.score === 'number' ? ` ${Math.round(f.score)}%` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw API Response - always shown */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={cardTitle}>Raw API Response</div>
        <p style={{ color: C.dim, fontSize: 11, margin: '0 0 8px' }}>
          This is the exact JSON your server receives from <code style={{ color: C.accent, background: C.codeBg, padding: '1px 4px', fontSize: 10 }}>GET /api/v2/verify/:id/status</code>
        </p>
        <pre style={{ background: C.codeBg, color: C.code, padding: 12, border: `1px solid ${C.borderStrong}`, fontSize: 10, fontFamily: C.mono, overflowX: 'auto', maxHeight: 300, overflowY: 'auto', lineHeight: 1.5, margin: 0 }}>
          {highlightJson(verificationRequest)}
        </pre>
      </div>

      {/* Retry Button (failed only) */}
      {isFailed && verificationRequest?.retry_available === true && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <button
            onClick={onRetry}
            disabled={retryProcessing}
            style={{
              background: retryProcessing ? 'transparent' : C.accent,
              color: retryProcessing ? C.muted : C.bg, border: `1px solid ${C.accent}`,
              padding: '10px 32px', fontFamily: C.mono, fontWeight: 500, fontSize: 13,
              cursor: retryProcessing ? 'not-allowed' : 'pointer',
              opacity: retryProcessing ? 0.6 : 1,
            }}
          >
            {retryProcessing ? 'Restarting\u2026' : 'Try Again'}
          </button>
        </div>
      )}
      {isFailed && verificationRequest?.retry_available === false && (
        <p style={{ color: C.red, fontSize: 11, textAlign: 'center', marginBottom: 16 }}>
          Maximum retry attempts reached.
        </p>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {isVerified && onGoToCredential && (
          <button
            onClick={onGoToCredential}
            style={{
              background: C.accent, color: C.bg, border: `1px solid ${C.accent}`,
              padding: '10px 24px', fontFamily: C.mono, fontWeight: 500, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Get Verifiable Credential
          </button>
        )}
        <button
          onClick={onGoToAddress}
          style={{ background: C.purple, color: '#fff', border: `1px solid ${C.purple}`, padding: '10px 24px', fontFamily: C.mono, fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          Try Address Verification
        </button>
        <button
          onClick={onStartNew}
          style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, padding: '10px 24px', fontFamily: C.mono, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}
        >
          Start New Demo
        </button>
      </div>
      <p style={{ color: C.dim, fontSize: 11, marginTop: 12, textAlign: 'center' }}>
        Screen the verified person against sanctions and PEP lists to hold both verification and screening results. Address verification and verifiable credentials are optional post-verification features.
      </p>
    </div>
  );
};
