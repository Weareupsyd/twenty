import { defineObject, FieldType } from 'twenty-sdk/define';
import {
  ST_BODY,
  ST_EVENT_KEY,
  ST_LANGUAGE,
  ST_NAME,
  ST_NOTES,
  ST_OBJECT,
} from 'src/constants/universal-identifiers';

export const SMS_TEMPLATE_UNIVERSAL_IDENTIFIER = ST_OBJECT;

export default defineObject({
  universalIdentifier: SMS_TEMPLATE_UNIVERSAL_IDENTIFIER,
  nameSingular: 'smsTemplate',
  namePlural: 'smsTemplates',
  labelSingular: 'Sms template',
  labelPlural: 'Sms templates',
  description:
    'Per-event, per-language SMS text with {{placeholders}} rendered before sending',
  icon: 'IconMessage',
  labelIdentifierFieldMetadataUniversalIdentifier: ST_NAME,
  fields: [
    {
      universalIdentifier: ST_NAME,
      name: 'name',
      label: 'Name',
      type: FieldType.TEXT,
      description: 'Human-readable template name',
    },
    {
      universalIdentifier: ST_EVENT_KEY,
      name: 'eventKey',
      label: 'Event key',
      type: FieldType.SELECT,
      description: 'Event that triggers this template',
      options: [
        { value: 'QUOTE_ISSUED', label: 'Quote issued', position: 0, color: 'green' },
        { value: 'POLICY_ISSUED', label: 'Policy issued', position: 1, color: 'blue' },
        { value: 'CLAIM_CREATED', label: 'Claim created', position: 2, color: 'orange' },
        { value: 'RENEWAL_QUOTE', label: 'Renewal quote', position: 3, color: 'turquoise' },
        { value: 'CUSTOM', label: 'Custom', position: 4, color: 'gray' },
      ],
    },
    {
      universalIdentifier: ST_LANGUAGE,
      name: 'language',
      label: 'Language',
      type: FieldType.SELECT,
      description: 'Language of this template body',
      options: [
        { value: 'EN', label: 'English', position: 0, color: 'blue' },
        { value: 'LG', label: 'Luganda', position: 1, color: 'green' },
        { value: 'SW', label: 'Swahili', position: 2, color: 'orange' },
        { value: 'RUN', label: 'Runyankole', position: 3, color: 'turquoise' },
      ],
    },
    {
      universalIdentifier: ST_BODY,
      name: 'body',
      label: 'Body',
      type: FieldType.TEXT,
      description: 'Message text with {{placeholders}}',
    },
    {
      universalIdentifier: ST_NOTES,
      name: 'notes',
      label: 'Notes',
      type: FieldType.TEXT,
      description: 'Internal notes',
    },
  ],
});
