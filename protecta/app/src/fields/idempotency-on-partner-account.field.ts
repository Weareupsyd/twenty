import { defineField, FieldType, RelationType } from 'twenty-sdk/define';
import {
  I_PARTNER,
  IDEMPOTENCY_RECORD,
  PA_IDEMPOTENCY,
  PARTNER_ACCOUNT,
} from 'src/constants/universal-identifiers';

export default defineField({
  universalIdentifier: PA_IDEMPOTENCY,
  objectUniversalIdentifier: PARTNER_ACCOUNT,
  type: FieldType.RELATION,
  name: 'idempotencyRecords',
  label: 'Idempotency records',
  icon: 'IconFingerprint',
  relationTargetObjectMetadataUniversalIdentifier: IDEMPOTENCY_RECORD,
  relationTargetFieldMetadataUniversalIdentifier: I_PARTNER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
