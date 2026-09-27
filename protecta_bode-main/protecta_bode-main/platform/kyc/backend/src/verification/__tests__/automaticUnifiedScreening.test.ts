import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationSession } from '../session/VerificationSession.js';
import { VerificationStatus, FLOW_PRESETS } from '@kabila/shared';
import type {
  BackExtractionResult,
  FaceMatchResult,
  FrontExtractionResult,
  LiveCaptureResult,
} from '@kabila/shared';

const front: FrontExtractionResult = {
  ocr: {
    full_name: 'AMINA YUSUF',
    date_of_birth: '1987-02-03',
    id_number: 'CM12345678',
    expiry_date: '2031-01-01',
    nationality: 'UGA',
  },
  face_embedding: [0.1, 0.2, 0.3],
  face_confidence: 0.95,
  ocr_confidence: 0.95,
  mrz_from_front: null,
};

const back: BackExtractionResult = {
  qr_payload: {
    full_name: 'AMINA YUSUF',
    date_of_birth: '1987-02-03',
    id_number: 'CM12345678',
    expiry_date: '2031-01-01',
    nationality: 'UGA',
  },
  mrz_result: null,
  barcode_format: 'QR_CODE',
  raw_barcode_data: 'data',
};

const live: LiveCaptureResult = {
  face_embedding: [0.4, 0.5, 0.6],
  face_confidence: 0.96,
  liveness_passed: true,
  liveness_score: 0.92,
};

const face: FaceMatchResult = {
  similarity_score: 0.91,
  passed: true,
  threshold_used: 0.6,
};

const unified = {
  reference: 'SCR-20260826-AUTO',
  status: 'completed' as const,
  query: { name: 'AMINA YUSUF' },
  summary: {
    risk_level: 'Clear',
    match_found: false,
    requires_human_review: false,
    total_matches: 0,
    sanctions_matches: 0,
    pep_related_matches: 0,
  },
  matches: [],
  relationships: [],
  timestamp: '2026-08-26T00:00:00.000Z',
};

const screenAML = vi.fn(async () => ({
  risk_level: 'clear' as const,
  match_found: false,
  matches: [],
  lists_checked: ['OpenSanctions'],
  screened_name: 'AMINA YUSUF',
  screened_dob: '1987-02-03',
  screened_at: '2026-08-26T00:00:00.000Z',
  unified_screening: unified,
}));

function session(flow = FLOW_PRESETS.full, voiceAuthEnabled = false) {
  return new VerificationSession({
    extractFront: vi.fn(async () => front),
    extractBack: vi.fn(async () => back),
    processLiveCapture: vi.fn(async () => live),
    computeFaceMatch: vi.fn(() => face),
    screenAML,
    voiceAuthEnabled,
  }, undefined, flow);
}

beforeEach(() => {
  screenAML.mockClear();
});

describe('automatic unified screening order', () => {
  it('runs after the final full-verification gate and stores the complete result', async () => {
    const verification = session();
    await verification.submitFront(Buffer.from('front'));
    await verification.submitBack(Buffer.from('back'));

    expect(screenAML).not.toHaveBeenCalled();

    await verification.submitLiveCapture(Buffer.from('live'));

    expect(screenAML).toHaveBeenCalledOnce();
    expect(screenAML).toHaveBeenCalledWith(
      'AMINA YUSUF',
      '1987-02-03',
      'UGA',
      expect.objectContaining({ idNumber: 'CM12345678' }),
    );
    expect(verification.getState().current_step).toBe(VerificationStatus.COMPLETE);
    expect(verification.getState().unified_screening?.reference).toBe(unified.reference);
  });

  it('also runs for a single-sided document-only verification', async () => {
    const passport = {
      ...front,
      ocr: { ...front.ocr, detected_document_type: 'passport' },
    };
    const verification = new VerificationSession({
      extractFront: vi.fn(async () => passport),
      extractBack: vi.fn(async () => back),
      processLiveCapture: vi.fn(async () => live),
      computeFaceMatch: vi.fn(() => face),
      screenAML,
    }, undefined, FLOW_PRESETS.document_only);

    await verification.submitFront(Buffer.from('passport'));

    expect(screenAML).toHaveBeenCalledOnce();
    expect(verification.getState().current_step).toBe(VerificationStatus.COMPLETE);
  });

  it('screens age-only verification before returning its result', async () => {
    const verification = session(FLOW_PRESETS.age_only);

    const result = await verification.submitFrontAgeOnly(Buffer.from('front'), 18);

    expect(result.passed).toBe(true);
    expect(screenAML).toHaveBeenCalledOnce();
    expect(verification.getState().current_step).toBe(VerificationStatus.COMPLETE);
  });

  it('waits for voice verification before screening', async () => {
    const verification = session(FLOW_PRESETS.full, true);
    await verification.submitFront(Buffer.from('front'));
    await verification.submitBack(Buffer.from('back'));
    await verification.submitLiveCapture(Buffer.from('live'));

    expect(verification.getState().current_step).toBe(VerificationStatus.AWAITING_VOICE);
    expect(screenAML).not.toHaveBeenCalled();

    await verification.submitVoiceCapture({
      similarity_score: 1,
      passed: true,
      threshold_used: 0.55,
      challenge_verified: true,
      challenge_digits: '123456',
    });

    expect(screenAML).toHaveBeenCalledOnce();
    expect(verification.getState().current_step).toBe(VerificationStatus.COMPLETE);
  });
});
