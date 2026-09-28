export type EgoSmsConfig = {
  username: string;
  password: string;
  senderId: string;
  defaultLanguage: string;
};

/**
 * Credentials are workspace configuration, never source code: set
 * EGOSMS_USERNAME and EGOSMS_PASSWORD in the app's settings.
 */
export const smsConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): EgoSmsConfig | null => {
  const username = env.EGOSMS_USERNAME ?? '';
  const password = env.EGOSMS_PASSWORD ?? '';
  if (!username || !password) return null;
  return {
    username,
    password,
    senderId: env.EGOSMS_SENDER_ID || 'Upsyd',
    defaultLanguage: (env.SMS_DEFAULT_LANGUAGE || 'EN').toUpperCase(),
  };
};

export type SendSmsResult = {
  ok: boolean;
  providerRef: string;
  error: string;
};

export const EGO_SMS_URL = 'https://www.egosms.co/api/v1/json/';

/** Send one SMS through the EgoSMS JSON API. */
export const sendEgoSms = async (
  config: EgoSmsConfig,
  input: { number: string; message: string; senderId?: string },
): Promise<SendSmsResult> => {
  const response = await fetch(EGO_SMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'SendSms',
      userdata: {
        username: config.username,
        password: config.password,
      },
      msgdata: [
        {
          number: input.number,
          message: input.message,
          senderid: input.senderId ?? config.senderId,
        },
      ],
    }),
  });
  const text = await response.text().catch(() => '');
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  // EgoSMS answers {"Status":"OK","Cost":"...","MsgFollowUpUniqueCode":"..."}
  // on success and {"Status":"Failed","Message":"..."} otherwise.
  const status = String(parsed?.Status ?? parsed?.status ?? '');
  const ok = response.ok && status.toUpperCase() === 'OK';
  return {
    ok,
    providerRef: String(parsed?.MsgFollowUpUniqueCode ?? '').trim(),
    error: ok
      ? ''
      : String(parsed?.Message ?? `EgoSMS request failed (${response.status}).`).slice(0, 250),
  };
};
