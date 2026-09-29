import { formatUgx } from 'src/lib/money';

export const BRAND_HEADER = '*Protecta Bode*';

export const quoteIssuedMessage = (args: {
  name: string;
  quoteRef: string;
  premium: number;
  validUntil: string;
  shareUrl: string;
}): string =>
  [
    BRAND_HEADER,
    `Hi ${args.name}, your motor quote is ready.`,
    `• Quote: ${args.quoteRef}`,
    `• Premium: ${formatUgx(args.premium)}`,
    `• Valid until: ${args.validUntil}`,
    `View and pay: ${args.shareUrl}`,
  ].join('\n');

export const paymentConfirmedMessage = (args: {
  quoteRef: string;
  amount: number;
  policyNo: string;
}): string =>
  [
    BRAND_HEADER,
    'Payment confirmed.',
    `• Quote: ${args.quoteRef}`,
    `• Amount: ${formatUgx(args.amount)}`,
    `• Policy: ${args.policyNo}`,
    'Your e-policy will arrive here shortly.',
  ].join('\n');

export const policyIssuedMessage = (args: {
  policyNo: string;
  plate: string;
  periodEnd: string;
  certUrl: string;
}): string =>
  [
    BRAND_HEADER,
    'Your policy is active.',
    `• Policy: ${args.policyNo}`,
    `• Plate: ${args.plate}`,
    `• Cover until: ${args.periodEnd}`,
    `Certificate: ${args.certUrl}`,
  ].join('\n');

export const claimUpdateMessage = (args: {
  claimRef: string;
  status: string;
  note?: string;
}): string =>
  [
    BRAND_HEADER,
    `Claim ${args.claimRef} update: *${args.status}*`,
    ...(args.note ? [args.note] : []),
  ].join('\n');

export const renewalReminderMessage = (args: {
  policyNo: string;
  plate: string;
  periodEnd: string;
  quoteRef: string;
  premium: number;
}): string =>
  [
    BRAND_HEADER,
    `Policy ${args.policyNo} (${args.plate}) expires on ${args.periodEnd}.`,
    `Renewal quote ${args.quoteRef}: ${formatUgx(args.premium)}.`,
    'Reply 4 and send the quote ref to pay.',
  ].join('\n');

export const otpMessage = (otp: string, purpose: string): string =>
  `${BRAND_HEADER}\nYour ${purpose} code is *${otp}*. It expires in 10 minutes.`;

export const renewalQuoteMessage = (args: {
  policyNo: string;
  quoteRef: string;
  premium: number;
  shareUrl: string;
}): string =>
  [
    BRAND_HEADER,
    `Your renewal quote for policy ${args.policyNo} is ready.`,
    `• Quote: ${args.quoteRef}`,
    `• Premium: ${formatUgx(args.premium)}`,
    `Pay here: ${args.shareUrl}`,
  ].join('\n');

export const opsAlertMessage = (title: string, lines: string[]): string =>
  [`*Protecta ops: ${title}*`, ...lines].join('\n');
