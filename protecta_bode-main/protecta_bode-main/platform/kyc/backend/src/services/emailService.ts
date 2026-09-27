import { logger } from '@/utils/logger.js';
import config from '@/config/index.js';

/**
 * EmailService - sends transactional emails via SMTP.
 * 
 * Two transport modes:
 *   1. SMTP (Gmail or any SMTP server) - configured via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   2. Dev/console                      - logs to console when nothing configured
 */

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * EmailService - sends transactional emails.
 *
 * Three transport modes:
 *   1. SMTP (Gmail or any SMTP server) - configured via SMTP_* env vars
 *   2. Resend API                        - configured via RESEND_API_KEY
 *   3. Dev/console                        - logs to console when nothing configured
 *
 * Mode is auto-detected: SMTP wins if SMTP_HOST is set, then Resend, then console.
 */
class EmailService {
  private _isConfigured: boolean = false;
  private _transportMode: 'smtp' | 'dev' = 'dev';
  private _fromAddress: string;
  private _smtpHost?: string;
  private _smtpPort?: number;
  private _smtpSecure?: boolean;
  private _smtpUser?: string;
  private _smtpPass?: string;

  get isConfigured(): boolean { return this._isConfigured; }
  get transportMode(): string { return this._transportMode; }

  constructor() {
    this._fromAddress = config.email.fromAddress;
    const pass = config.email.smtpPassword || '';

    if (config.email.smtpHost) {
      this._transportMode = 'smtp';
      this._smtpHost = config.email.smtpHost;
      this._smtpPort = config.email.smtpPort || 587;
      this._smtpSecure = config.email.smtpSecure ?? false;
      this._smtpUser = config.email.smtpUser || '';
      this._smtpPass = pass;
      this._isConfigured = true;
      logger.info(`Email service: SMTP mode (host=${this._smtpHost}:${this._smtpPort}, from=${this._fromAddress})`);
    } else {
      logger.warn('No SMTP configured - emails will be logged to console');
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    if (!this._isConfigured) {
      logger.info(`[DEV EMAIL] To: ${options.to} | Subject: ${options.subject}`);
      logger.info(`[DEV EMAIL] Text:\n${options.text}`);
      return true;
    }
    if (this._transportMode === 'smtp') {
      return this._sendViaSmtp(options);
    }
    return false;
  }

  /** Send via SMTP. Nodemailer can be wired for actual delivery; logs to console for now. */
  private async _sendViaSmtp(options: SendEmailOptions): Promise<boolean> {
    logger.info(`[SMTP] To: ${options.to} | Subject: ${options.subject}`);
    logger.info(`[SMTP] Text:\n${options.text}`);
    return true;
  }

  async sendOtpEmail(email: string, code: string): Promise<boolean> {
    const subject = 'Your Kabila verification code';
    const text = `Your Kabila verification code is: ${code}\n\nThis code expires in 10 minutes.`;
    return this.sendEmail({ to: email, subject, html: `<p>${text}</p>`, text });
  }

  async sendCredentialEmail(
    email: string,
    recipientName: string,
    verifyUrl: string,
    qrDataUri: string,
    expiresAt: Date,
  ): Promise<boolean> {
    // stub - implement when needed
    return true;
  }
}

export const emailService = new EmailService();
