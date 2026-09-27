export type EmailConfig = {
  apiKey: string;
  from: string;
};

export const emailConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): EmailConfig | null => {
  if (env.EMAIL_PROVIDER !== 'resend') {
    return null;
  }
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    return null;
  }
  return { apiKey, from };
};

export const sendEmail = async (
  config: EmailConfig,
  input: { to: string; subject: string; html: string; idempotencyKey?: string },
): Promise<void> => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...(input.idempotencyKey
        ? { 'Idempotency-Key': input.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Email send failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
};
