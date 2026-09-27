/**
 * Secure verified face-photo download endpoint.
 *
 * GET /api/v1/verification/:verification_id/face-crop
 * (also mounted at /api/v2/verify/:verification_id/face-crop)
 *
 * Serves the cropped, verified face image for an applicant so a downstream
 * system (Odoo) can import it into the contact record. It serves the cropped
 * face from the identity document - never the full document, never raw OCR,
 * biometric templates, or liveness video.
 *
 * Authentication (either):
 *   - a short-lived signed download token in `?token=` (what the webhook's
 *     `photos.face_crop_url` carries), or
 *   - an API key (X-API-Key) owned by the developer who owns the verification.
 *
 * Response headers:
 *   Content-Type:    image/jpeg
 *   Content-Length:  <bytes>
 *   X-Image-SHA256:  <hex digest>
 *   X-Verification-ID: <id>
 */
import express, { Request, Response } from 'express';
import { param } from 'express-validator';
import { supabase } from '@/config/database.js';
import { logger } from '@/utils/logger.js';
import { catchAsync, AuthenticationError } from '@/middleware/errorHandler.js';
import { authenticateAPIKey } from '@/middleware/auth.js';
import { validate } from '@/middleware/validate.js';
import {
  verifyFaceCropToken,
  sha256Hex,
  FACE_CROP_MAX_BYTES,
} from '@/services/verificationWebhook.js';

const router = express.Router();

/** A single image MIME the endpoint is allowed to serve (rejects anything else). */
const SAFE_MIME = /^image\/(jpeg|png|webp)$/i;

/**
 * Resolve the cropped face image for a verification.
 *
 * Primary: the `id_face_base64` cropped headshot stored in session state
 * (deterministic, already JPEG, never the full document). Returns null when no
 * crop is available (e.g. no face detected), which maps to 404.
 */
async function resolveFaceCrop(verificationId: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const { data, error } = await supabase
    .from('verification_contexts')
    .select('context')
    .eq('verification_id', verificationId)
    .maybeSingle();

  if (error || !data?.context) return null;

  const context = (data.context ?? {}) as Record<string, any>;
  const dataUri = context.front_extraction?.id_face_base64;
  if (typeof dataUri !== 'string') return null;

  const match = dataUri.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  if (!SAFE_MIME.test(mime)) return null;

  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length || buffer.length > FACE_CROP_MAX_BYTES) return null;
    return { buffer, mime };
  } catch {
    return null;
  }
}

router.get(
  '/:verification_id/face-crop',
  [param('verification_id').isUUID().withMessage('Invalid verification ID')],
  validate,
  catchAsync(async (req: Request, res: Response) => {
    const { verification_id } = req.params;
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;

    // ── Auth: signed download token OR API key (server-to-server) ──
    if (token) {
      // Stateless HMAC token binds the download to this verification and time.
      if (!verifyFaceCropToken(token, verification_id)) {
        return res.status(403).json({ error: 'Face-crop download token is invalid or expired' });
      }
    } else {
      if (!req.headers['x-api-key']) {
        throw new AuthenticationError('API key or signed download token is required');
      }
      await new Promise<void>((resolve, reject) => {
        authenticateAPIKey(req as any, res as any, (err: any) => (err ? reject(err) : resolve()));
      });

      // Ownership scope - unknown ids or ids owned by another developer return
      // 404 (never 403) to prevent enumeration.
      const developerId = (req as any).developer?.id;
      const { data: owned } = await supabase
        .from('verification_requests')
        .select('id')
        .eq('id', verification_id)
        .eq('developer_id', developerId)
        .maybeSingle();
      if (!owned) {
        return res.status(404).json({ error: 'Verification request not found' });
      }
    }

    const image = await resolveFaceCrop(verification_id);
    if (!image) {
      return res.status(404).json({
        error: 'Face crop not available',
        message: 'No cropped face image is available for this verification.',
      });
    }

    const sha256 = sha256Hex(image.buffer);
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', image.buffer.length);
    res.setHeader('X-Image-SHA256', sha256);
    res.setHeader('X-Verification-ID', verification_id);
    // Do not let intermediaries cache an authenticated biometric image.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(image.buffer);

    logger.info('Face crop served', { verificationId: verification_id, sha256 });
  })
);

export default router;
