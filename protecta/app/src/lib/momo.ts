export type MomoConfig = {
  env: 'sandbox' | 'live';
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
};

export const momoConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): MomoConfig | null => {
  const subscriptionKey = env.MOMO_SUBSCRIPTION_KEY;
  const apiUser = env.MOMO_API_USER;
  const apiKey = env.MOMO_API_KEY;
  if (!subscriptionKey || !apiUser || !apiKey) {
    return null;
  }
  return {
    env: env.MOMO_ENV === 'live' ? 'live' : 'sandbox',
    subscriptionKey,
    apiUser,
    apiKey,
  };
};

const baseUrl = (config: MomoConfig): string =>
  config.env === 'live'
    ? 'https://momodeveloper.mtn.com'
    : 'https://sandbox.momodeveloper.mtn.com';

export const momoAccessToken = async (config: MomoConfig): Promise<string> => {
  const credentials = Buffer.from(`${config.apiUser}:${config.apiKey}`, 'utf8').toString('base64');
  const response = await fetch(`${baseUrl(config)}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Ocp-Apim-Subscription-Key': config.subscriptionKey,
    },
  });
  if (!response.ok) {
    throw new Error(`MoMo token request failed (${response.status}).`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('MoMo token response missing access_token.');
  }
  return data.access_token;
};

export const momoRequestToPay = async (
  config: MomoConfig,
  token: string,
  input: {
    amount: number;
    phone: string;
    externalId: string;
    payeeNote: string;
    callbackUrl: string;
  },
): Promise<void> => {
  const referenceId = externalIdToUuid(input.externalId);
  const response = await fetch(`${baseUrl(config)}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': config.env === 'live' ? 'live' : 'sandbox',
      'Ocp-Apim-Subscription-Key': config.subscriptionKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(Math.round(input.amount)),
      currency: 'UGX',
      externalId: input.externalId,
      payer: { partyIdType: 'MSISDN', partyId: input.phone.replace(/^\+/, '') },
      payerMessage: input.payeeNote.slice(0, 160),
      payeeNote: input.payeeNote.slice(0, 160),
    }),
  });
  if (response.status !== 202) {
    const detail = await response.text().catch(() => '');
    throw new Error(`MoMo request-to-pay failed (${response.status}): ${detail.slice(0, 200)}`);
  }
};

export const momoRequestStatus = async (
  config: MomoConfig,
  token: string,
  externalId: string,
): Promise<{ status: string; reason: string }> => {
  const referenceId = externalIdToUuid(externalId);
  const response = await fetch(
    `${baseUrl(config)}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': config.env === 'live' ? 'live' : 'sandbox',
        'Ocp-Apim-Subscription-Key': config.subscriptionKey,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`MoMo status check failed (${response.status}).`);
  }
  const data = (await response.json()) as { status?: string; reason?: string };
  return { status: data.status ?? 'UNKNOWN', reason: data.reason ?? '' };
};

/** Derive a deterministic UUID from a Protecta external id (MoMo needs UUID refs). */
export const externalIdToUuid = (externalId: string): string => {
  let hash = 0x811c9dc5;
  const input = `protecta:${externalId}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = (seed: number): string => {
    let value = seed >>> 0;
    let out = '';
    for (let i = 0; i < 8; i += 1) {
      value = (Math.imul(value, 1103515245) + 12345) >>> 0;
      out += (value % 16).toString(16);
    }
    return out;
  };
  const a = hex(hash);
  const b = hex(hash ^ 0x9e3779b9);
  const c = hex(hash ^ 0x85ebca6b);
  const d = hex(hash ^ 0xc2b2ae35);
  return `${a.slice(0, 8)}-${a.slice(0, 4)}-4${b.slice(0, 3)}-a${c.slice(0, 3)}-${c.slice(0, 4)}${d.slice(0, 8)}`;
};
