import { defineLogicFunction } from 'twenty-sdk/define';
import { DOC_VERIFY } from 'src/constants/universal-identifiers';
import { handleDocumentView } from 'src/logic-functions/document-view.logic-function';

export default defineLogicFunction({
  universalIdentifier: DOC_VERIFY,
  name: 'document-verify',
  description:
    'Verifies the policyholder phone over POST and downloads the phone-password-protected policy PDF.',
  timeoutSeconds: 60,
  handler: handleDocumentView,
  httpRouteTriggerSettings: {
    path: '/docgen/documents/verify',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
