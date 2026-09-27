import { defineLogicFunction } from 'twenty-sdk/define';
import { API_PAYMENT_CREATE } from 'src/constants/universal-identifiers';
import { handlePaymentRequest as handler } from 'src/lib/payment-request';

export default defineLogicFunction({
  universalIdentifier: API_PAYMENT_CREATE,
  name: 'api-payment-create',
  timeoutSeconds: 60,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/api/payments',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
