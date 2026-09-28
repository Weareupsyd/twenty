import { defineApplication } from 'twenty-sdk/define';
import {
  APP_DOCGEN,
  VAR_PRODUCT_NAME,
  VAR_SUPPORT_PHONE,
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
  },
});
