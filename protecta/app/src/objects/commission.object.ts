import { defineObject, FieldType, NumberDataType } from 'twenty-sdk/define';
import {
  CM_AMOUNT,
  CM_PAYOUT_REF,
  CM_POLICY_NO,
  CM_PROTECTA_REF,
  CM_RATE,
  CM_STATEMENT_MONTH,
  CM_STATUS,
  COMMISSION,
} from 'src/constants/universal-identifiers';

export const COMMISSION_UNIVERSAL_IDENTIFIER = COMMISSION;

export default defineObject({
  universalIdentifier: COMMISSION_UNIVERSAL_IDENTIFIER,
  nameSingular: 'commission',
  namePlural: 'commissions',
  labelSingular: 'Commission',
  labelPlural: 'Commissions',
  description: 'Agent and broker commission accrual',
  icon: 'IconCoin',
  labelIdentifierFieldMetadataUniversalIdentifier: CM_PROTECTA_REF,
  fields: [
    {
      universalIdentifier: CM_PROTECTA_REF,
      name: 'protectaRef',
      type: FieldType.TEXT,
      label: 'Protecta ref',
      icon: 'IconHash',
      isSearchable: true,
    },
    {
      universalIdentifier: CM_RATE,
      name: 'rate',
      type: FieldType.NUMBER,
      label: 'Rate',
      icon: 'IconPercentage',
      universalSettings: { dataType: NumberDataType.FLOAT },
    },
    {
      universalIdentifier: CM_AMOUNT,
      name: 'amountUgx',
      type: FieldType.NUMBER,
      label: 'Amount (UGX)',
      icon: 'IconCash',
      universalSettings: { dataType: NumberDataType.BIGINT },
    },
    {
      universalIdentifier: CM_STATUS,
      name: 'status',
      type: FieldType.SELECT,
      label: 'Status',
      icon: 'IconProgress',
      defaultValue: "'ACCRUED'",
      options: [
        { value: 'ACCRUED', label: 'Accrued', position: 0, color: 'blue' },
        { value: 'PAYABLE', label: 'Payable', position: 1, color: 'yellow' },
        { value: 'PAID', label: 'Paid', position: 2, color: 'green' },
        { value: 'CLAWED_BACK', label: 'Clawed back', position: 3, color: 'red' },
      ],
    },
    {
      universalIdentifier: CM_STATEMENT_MONTH,
      name: 'statementMonth',
      type: FieldType.TEXT,
      label: 'Statement month',
      description: 'YYYY-MM',
      icon: 'IconCalendar',
    },
    {
      universalIdentifier: CM_PAYOUT_REF,
      name: 'payoutRef',
      type: FieldType.TEXT,
      label: 'Payout ref',
      icon: 'IconHash',
    },
    {
      universalIdentifier: CM_POLICY_NO,
      name: 'policyNo',
      type: FieldType.TEXT,
      label: 'Policy no',
      icon: 'IconHash',
      isSearchable: true,
    },
  ],
});
