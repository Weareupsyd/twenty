import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  optionalQuery: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('../query.js', () => ({
  optionalQuery: mocks.optionalQuery,
  asRecord: (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {},
  firstString: (...values: unknown[]) => String(values.find((value) => typeof value === 'string' && value) || ''),
}));

vi.mock('@/services/storage.js', () => ({
  StorageService: class {
    downloadFile = mocks.downloadFile;
  },
}));

import { getSubjectMedia } from '../subjects.js';

const VERIFICATION_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_ID = '22222222-2222-4222-8222-222222222222';

describe('staff subject media', () => {
  beforeEach(() => {
    mocks.optionalQuery.mockReset();
    mocks.downloadFile.mockReset();
  });

  it('decodes the cropped ID portrait from verification context', async () => {
    mocks.optionalQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.verification_requests')) return [{ id: VERIFICATION_ID }];
      if (sql.includes('FROM public.verification_contexts')) {
        return [{ context: { front_extraction: { id_face_base64: 'data:image/png;base64,aWQtcG9ydHJhaXQ=' } } }];
      }
      return [];
    });

    const media = await getSubjectMedia(VERIFICATION_ID, 'id-crop');

    expect(media?.mime).toBe('image/png');
    expect(media?.bytes.toString()).toBe('id-portrait');
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('serves only a document belonging to the selected verification', async () => {
    mocks.optionalQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM public.verification_requests')) return [{ id: VERIFICATION_ID }];
      if (sql.includes('FROM public.documents')) {
        expect(params).toEqual([MEDIA_ID, VERIFICATION_ID]);
        return [{ file_path: 'uploads/documents/front.jpg', file_name: 'front.jpg', mime_type: 'image/jpeg' }];
      }
      return [];
    });
    mocks.downloadFile.mockResolvedValue(Buffer.from('document-bytes'));

    const media = await getSubjectMedia(VERIFICATION_ID, MEDIA_ID);

    expect(media).toMatchObject({ mime: 'image/jpeg', filename: 'front.jpg' });
    expect(media?.bytes.toString()).toBe('document-bytes');
    expect(mocks.downloadFile).toHaveBeenCalledWith('uploads/documents/front.jpg');
  });
});
