export type AirtelConfig = {
  env: 'sandbox' | 'live';
  clientId: string;
  clientSecret: string;
  country: string;
  currency: string;
};

export const airtelConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): AirtelConfig | null => {
  const clientId = env.AIRTEL_CLIENT_ID;
  const clientSecret = env.AIRTEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    env: env.AIRTEL_ENV === 'live' ? 'live' : 'sandbox',
    clientId,
    clientSecret,
    country: 'UG',
    currency: 'UGX',
  };
};

const baseUrl = (config: AirtelConfig): string =>
  config.env === 'live'
    ? 'https://openapi.airtel.africa'
    : 'https://openapiuat.airtel.africa';

export const airtelAccessToken = async (config: AirtelConfig): Promise<string> => {
  const response = await fetch(`${baseUrl(config)}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    throw new Error(`Airtel token request failed (${response.status}).`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Airtel token response missing access_token.');
  }
  return data.access_token;
};

export const airtelRequestPayment = async (
  config: AirtelConfig,
  token: string,
  input: { amount: number; phone: string; externalId: string },
): Promise<{ transactionId: string; status: string }> => {
  const response = await fetch(`${baseUrl(config)}/merchant/v1/payments/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Country': config.country,
      'X-Currency': config.currency,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference: input.externalId,
      subscriber: {
        country: config.country,
        currency: config.currency,
        msisdn: input.phone.replace(/^\+/, ''),
      },
      transaction: {
        amount: Math.round(input.amount),
        country: config.country,
        currency: config.currency,
        id: input.externalId,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Airtel payment failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    data?: { transaction?: { id?: string; status?: string } };
  };
  return {
    transactionId: data.data?.transaction?.id ?? '',
    status: data.data?.transaction?.status ?? 'UNKNOWN',
  };
};
