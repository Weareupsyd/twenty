import { defineApplication } from 'twenty-sdk/define';
import { FieldType } from 'twenty-sdk/define';
import {
  APP_DOCGEN,
  VAR_PRODUCT_NAME,
  VAR_STAMP_DUTY,
  VAR_STICKER_FEES,
  VAR_SUPPORT_PHONE,
  VAR_TRAINING_LEVY_RATE,
  VAR_VAT_RATE,
} from 'src/constants/universal-identifiers';

export const APPLICATION_UNIVERSAL_IDENTIFIER = APP_DOCGEN;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Document Generator',
  description:
    'Renders document templates into PDF and Word files. Linked to Protecta Bode: generates policy certificates when policies are issued.',
  applicationVariables: {
    PRODUCT_NAME: {
      universalIdentifier: VAR_PRODUCT_NAME,
      label: 'Product name',
      description: 'Product line named on generated documents.',
      value: 'Protecta Bode motor insurance',
      isSecret: false,
    },
    SUPPORT_PHONE: {
      universalIdentifier: VAR_SUPPORT_PHONE,
      label: 'Support phone',
      description: 'Helpline printed on generated documents.',
      value: '+256312246500',
      isSecret: false,
    },
    // Premium breakdown defaults for the policy schedule. Leave a rate or
    // amount at 0 to print "—" until the value is recorded on the policy
    // (set them to the values Liberty charges this operation).
    POLICY_TRAINING_LEVY_RATE: {
      universalIdentifier: VAR_TRAINING_LEVY_RATE,
      label: 'Training levy rate',
      description:
        'Training levy as a fraction of the premium (0.005 = 0.5%). 0 leaves the schedule line empty.',
      type: FieldType.NUMBER,
      value: 0,
      isSecret: false,
    },
    POLICY_VAT_RATE: {
      universalIdentifier: VAR_VAT_RATE,
      label: 'VAT rate',
      description:
        'VAT as a fraction of the premium (0.18 = 18%). 0 leaves the schedule line empty.',
      type: FieldType.NUMBER,
      value: 0,
      isSecret: false,
    },
    POLICY_STICKER_FEES_UGX: {
      universalIdentifier: VAR_STICKER_FEES,
      label: 'Sticker fees (UGX)',
      description: 'Fixed sticker fee added to every policy schedule. 0 leaves the line empty.',
      type: FieldType.NUMBER,
      value: 0,
      isSecret: false,
    },
    POLICY_STAMP_DUTY_UGX: {
      universalIdentifier: VAR_STAMP_DUTY,
      label: 'Stamp duty (UGX)',
      description: 'Fixed stamp duty (S/Duty) added to every policy schedule. 0 leaves the line empty.',
      type: FieldType.NUMBER,
      value: 0,
      isSecret: false,
    },
  },
});
