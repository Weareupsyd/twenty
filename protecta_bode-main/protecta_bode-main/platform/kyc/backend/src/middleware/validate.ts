import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ValidationError } from '@/middleware/errorHandler.js';

/**
 * Express middleware that checks express-validator results and throws
 * a ValidationError if any validation rules failed.
 *
 * Usage: place after validator chains, before the route handler.
 *   router.post('/foo', [...validators], validate, catchAsync(handler))
 */
export const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Include the specific rule messages so production responses stay
    // actionable ("Valid HTTPS webhook URL is required") instead of a bare
    // "Validation failed" toast.
    const detail = errors.array().map((e: any) => e.msg).join(', ');
    throw new ValidationError(`Validation failed: ${detail}`, 'multiple', errors.array());
  }
  next();
};
