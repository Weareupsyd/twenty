import { defineApplication } from 'twenty-sdk/define';
import {
  APP_SMS,
  VAR_EGOSMS_PASSWORD,
  VAR_EGOSMS_SENDER_ID,
  VAR_EGOSMS_USERNAME,
  VAR_SMS_DEFAULT_LANGUAGE,
} from 'src/constants/universal-identifiers';

export const APPLICATION_UNIVERSAL_IDENTIFIER = APP_SMS;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'SMS Messaging',
  description:
    'Sends SMS through EgoSMS on workspace events and on demand, using multilingual templates. Linked to Protecta Bode.',
  applicationVariables: {
    EGOSMS_SENDER_ID: {
      universalIdentifier: VAR_EGOSMS_SENDER_ID,
      label: 'EgoSMS sender ID',
      description: 'Sender ID shown on SMS (e.g. your approved brand name).',
      value: 'Upsyd',
      isSecret: false,
    },
    SMS_DEFAULT_LANGUAGE: {
      universalIdentifier: VAR_SMS_DEFAULT_LANGUAGE,
      label: 'Default language',
      description:
        'Template language used when no language is requested (e.g. EN, LG, SW).',
      value: 'EN',
      isSecret: false,
    },
  },
  serverVariables: {
    EGOSMS_USERNAME: {
      description: 'EgoSMS account username. Required.',
      isSecret: false,
      isRequired: true,
    },
    EGOSMS_PASSWORD: {
      description:
        'EgoSMS account password. Required. Keep it out of source control - set it here or in the app settings.',
      isSecret: true,
      isRequired: true,
    },
  },
});
