import { defineObject, FieldType } from 'twenty-sdk/define';
import {
  IDEMPOTENCY_RECORD,
  I_KEY,
  I_OPERATION,
  I_REQUEST_HASH,
  I_RESPONSE,
} from 'src/constants/universal-identifiers';

export const IDEMPOTENCY_RECORD_UNIVERSAL_IDENTIFIER = IDEMPOTENCY_RECORD;

export default defineObject({
  universalIdentifier: IDEMPOTENCY_RECORD_UNIVERSAL_IDENTIFIER,
  nameSingular: 'idempotencyRecord',
  namePlural: 'idempotencyRecords',
  labelSingular: 'Idempotency record',
  labelPlural: 'Idempotency records',
  description: 'Replay-safe Partner API operations (technical)',
  icon: 'IconFingerprint',
  labelIdentifierFieldMetadataUniversalIdentifier: I_KEY,
  fields: [
    {
      universalIdentifier: I_KEY,
      name: 'idemKey',
      type: FieldType.TEXT,
      label: 'Idempotency key',
      icon: 'IconKey',
      isSearchable: true,
    },
    {
      universalIdentifier: I_OPERATION,
      name: 'operation',
      type: FieldType.TEXT,
      label: 'Operation',
      icon: 'IconBolt',
    },
    {
      universalIdentifier: I_REQUEST_HASH,
      name: 'requestHash',
      type: FieldType.TEXT,
      label: 'Request hash',
      icon: 'IconHash',
    },
    {
      universalIdentifier: I_RESPONSE,
      name: 'response',
      type: FieldType.RAW_JSON,
      label: 'Response',
      icon: 'IconBraces',
    },
  ],
});
