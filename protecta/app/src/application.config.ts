import { FieldType, defineApplication } from 'twenty-sdk/define';
import {
  COMMISSION_DEFAULT,
  COOLING_DAYS,
  EVOLUTION_WEBHOOK_URL,
  MAX_VEHICLE_VALUE,
  MIN_VEHICLE_VALUE,
  POLICY_DAYS,
  PRODUCT_CODE,
  PRODUCT_RATE,
  PROTECTA,
  PUBLIC_BASE_URL,
  REQUIRE_KYC_PURCHASE,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  VAR_REQUIRE_PAYMENT_SIGNATURE,
} from 'src/constants/universal-identifiers';

export const APPLICATION_UNIVERSAL_IDENTIFIER = PROTECTA;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Protecta Bode',
  description:
    'Motor insurance on Twenty CRM: 1.5% quotes, mobile-money payments, policies, claims, WhatsApp bot and partner API.',
  logo: 'public/brand/assets/protecta-bode-logo.png',
  applicationVariables: {
    PRODUCT_CODE: {
      universalIdentifier: PRODUCT_CODE,
      label: 'Product code',
      description: 'Motor product code shown on quotes and policies.',
      value: 'BODE-01',
      isSecret: false,
    },
    PRODUCT_RATE: {
      universalIdentifier: PRODUCT_RATE,
      label: 'Premium rate',
      description:
        'Yearly premium as a fraction of vehicle value (0.015 = 1.5%).',
      type: FieldType.NUMBER,
      value: 0.015,
      isSecret: false,
    },
    MIN_VEHICLE_VALUE: {
      universalIdentifier: MIN_VEHICLE_VALUE,
      label: 'Minimum vehicle value (UGX)',
      description: 'Quotes below this value are rejected.',
      type: FieldType.NUMBER,
      value: 1000000,
      isSecret: false,
    },
    MAX_VEHICLE_VALUE: {
      universalIdentifier: MAX_VEHICLE_VALUE,
      label: 'Maximum vehicle value (UGX)',
      description: 'Quotes above this value are rejected.',
      type: FieldType.NUMBER,
      value: 300000000,
      isSecret: false,
    },
    POLICY_DAYS: {
      universalIdentifier: POLICY_DAYS,
      label: 'Policy term (days)',
      description: 'Cover length for every issued policy.',
      type: FieldType.NUMBER,
      value: 365,
      isSecret: false,
    },
    COMMISSION_DEFAULT: {
      universalIdentifier: COMMISSION_DEFAULT,
      label: 'Default commission rate',
      description:
        'Agent and broker commission as a fraction of premium (0.10 = 10%).',
      type: FieldType.NUMBER,
      value: 0.1,
      isSecret: false,
    },
    COOLING_DAYS: {
      universalIdentifier: COOLING_DAYS,
      label: 'Cooling period (days)',
      description: 'Days before an accrued commission becomes payable.',
      type: FieldType.NUMBER,
      value: 14,
      isSecret: false,
    },
    SUPPORT_PHONE: {
      universalIdentifier: SUPPORT_PHONE,
      label: 'Support phone',
      description: 'Public helpline shown on pages and messages.',
      value: '+256312246500',
      isSecret: false,
    },
    SUPPORT_EMAIL: {
      universalIdentifier: SUPPORT_EMAIL,
      label: 'Support email',
      description: 'Public support address shown on pages.',
      value: 'support@protectabode.example',
      isSecret: false,
    },
    PUBLIC_BASE_URL: {
      universalIdentifier: PUBLIC_BASE_URL,
      label: 'Public base URL',
      description:
        'Public Twenty URL used to build quote, policy and payment links. For production: https://protectabode.weareupsyd.com. Leave empty to use relative links.',
      value: 'https://protectabode.weareupsyd.com',
      isSecret: false,
    },
    EVOLUTION_WEBHOOK_URL: {
      universalIdentifier: EVOLUTION_WEBHOOK_URL,
      label: 'Evolution webhook URL',
      description:
        'Default webhook URL that Evolution API POSTs WhatsApp messages to. For production: https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook. Auto-configured by install.sh --with-evolution and scripts/setup-evolution-webhook.sh.',
      value: 'https://protectabode.weareupsyd.com/s/protecta/whatsapp/webhook',
      isSecret: false,
    },
    REQUIRE_KYC_PURCHASE: {
      universalIdentifier: REQUIRE_KYC_PURCHASE,
      label: 'Require KYC before purchase',
      description: 'Block payment until the buyer identity check is approved.',
      type: FieldType.BOOLEAN,
      value: false,
      isSecret: false,
    },
    REQUIRE_PAYMENT_SIGNATURE: {
      universalIdentifier: VAR_REQUIRE_PAYMENT_SIGNATURE,
      label: 'Require signed payment callbacks',
      description: 'Reject provider callbacks without a valid HMAC signature.',
      type: FieldType.BOOLEAN,
      value: true,
      isSecret: false,
    },
  },
  serverVariables: {
    SESSION_JWT_SECRET: {
      description:
        'Signs customer session tokens for self-service pages. Required.',
      isSecret: true,
      isRequired: true,
    },
    PARTNER_JWT_SECRET: {
      description: 'Signs partner API access tokens. Required.',
      isSecret: true,
      isRequired: true,
    },
    EVOLUTION_API_URL: {
      description:
        'Evolution API base URL for the onboarded WhatsApp bot, for example http://127.0.0.1:8080. Prefer Settings → WhatsApp bot.',
      isSecret: false,
      isRequired: false,
    },
    EVOLUTION_INSTANCE: {
      description: 'Evolution API instance name that already has the bot connected.',
      isSecret: false,
      isRequired: false,
    },
    EVOLUTION_API_KEY: {
      description: 'Evolution API instance key. Sent as the apikey header.',
      isSecret: true,
      isRequired: false,
    },
    WHATSAPP_TOKEN: {
      description:
        'Optional Meta WhatsApp Cloud API token. Leave empty when using Evolution API.',
      isSecret: true,
      isRequired: false,
    },
    WHATSAPP_PHONE_ID: {
      description: 'Meta WhatsApp phone number id.',
      isSecret: false,
      isRequired: false,
    },
    WHATSAPP_APP_SECRET: {
      description: 'Meta app secret used to verify inbound webhook signatures.',
      isSecret: true,
      isRequired: false,
    },
    PARTNER_WEBHOOK_ALLOWED_ORIGINS: {
      description:
        'Comma-separated approved HTTPS origins for outbound partner webhooks. Empty denies all.',
      isSecret: false,
      isRequired: false,
    },
    PARTNER_WEBHOOK_SECRET: {
      description:
        'HMAC signing secret shared with receiving partner webhook services.',
      isSecret: true,
      isRequired: false,
    },
    WHATSAPP_VERIFY: {
      description: 'Verify token pasted into the Meta webhook configuration.',
      isSecret: true,
      isRequired: false,
    },
    OPS_WHATSAPP: {
      description:
        'E.164 number for ops alerts (daily flash, failed webhooks).',
      isSecret: false,
      isRequired: false,
    },
    PAYMENT_WEBHOOK_SECRET: {
      description: 'HMAC key shared with the payment provider or aggregator.',
      isSecret: true,
      isRequired: false,
    },
    MOMO_ENV: {
      description: 'MTN MoMo environment: sandbox or live.',
      isSecret: false,
      isRequired: false,
    },
    MOMO_SUBSCRIPTION_KEY: {
      description: 'MTN MoMo Collections subscription key.',
      isSecret: true,
      isRequired: false,
    },
    MOMO_API_USER: {
      description: 'MTN MoMo API user id.',
      isSecret: true,
      isRequired: false,
    },
    MOMO_API_KEY: {
      description: 'MTN MoMo API key.',
      isSecret: true,
      isRequired: false,
    },
    AIRTEL_ENV: {
      description: 'Airtel Money environment: sandbox or live.',
      isSecret: false,
      isRequired: false,
    },
    AIRTEL_CLIENT_ID: {
      description: 'Airtel Money client id.',
      isSecret: true,
      isRequired: false,
    },
    AIRTEL_CLIENT_SECRET: {
      description: 'Airtel Money client secret.',
      isSecret: true,
      isRequired: false,
    },
    EMAIL_PROVIDER: {
      description: 'Transactional email provider: resend or none.',
      isSecret: false,
      isRequired: false,
    },
    RESEND_API_KEY: {
      description: 'Resend API key for receipts, policies and reminders.',
      isSecret: true,
      isRequired: false,
    },
    EMAIL_FROM: {
      description: 'From address for transactional email.',
      isSecret: false,
      isRequired: false,
    },
    KYC_PROVIDER_URL: {
      description:
        'Optional automated KYC provider endpoint (leave empty for manual review).',
      isSecret: false,
      isRequired: false,
    },
    KYC_PROVIDER_KEY: {
      description: 'API key for the automated KYC provider.',
      isSecret: true,
      isRequired: false,
    },
  },
});
