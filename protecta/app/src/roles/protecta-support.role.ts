import {
  defineRole,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  SystemPermissionFlag,
} from 'twenty-sdk/define';
import {
  COMMISSION,
  DEFAULT_ROLE,
  IDEMPOTENCY_RECORD,
  INSURANCE_CLAIM,
  INSURANCE_PAYMENT,
  INSURANCE_POLICY,
  INSURANCE_QUOTE,
  KYC_CASE,
  PARTNER_ACCOUNT,
  PERSON_LICENCE_NO,
  PERSON_PROTECTA_CONSENT,
  PERSON_PROTECTA_KYC,
  PERSON_PROTECTA_NIN,
  PERSON_PROTECTA_PHONE,
  PERSON_PROTECTA_ROLE,
  SUPPORT_TICKET,
  VEHICLE,
  WEBHOOK_DELIVERY,
} from 'src/constants/universal-identifiers';

const PERSON_OBJECT =
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier;

const READ_WRITE = {
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: true,
  canDestroyObjectRecords: false,
};

export default defineRole({
  universalIdentifier: DEFAULT_ROLE,
  label: 'Protecta support',
  description: 'Underwriting, claims and support staff for Protecta Bode',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: false,
  canBeAssignedToUsers: true,
  canBeAssignedToApiKeys: false,
  objectPermissions: [
    { objectUniversalIdentifier: VEHICLE, ...READ_WRITE },
    { objectUniversalIdentifier: INSURANCE_QUOTE, ...READ_WRITE },
    { objectUniversalIdentifier: INSURANCE_POLICY, ...READ_WRITE },
    { objectUniversalIdentifier: INSURANCE_PAYMENT, ...READ_WRITE },
    { objectUniversalIdentifier: INSURANCE_CLAIM, ...READ_WRITE },
    { objectUniversalIdentifier: COMMISSION, ...READ_WRITE },
    { objectUniversalIdentifier: PARTNER_ACCOUNT, ...READ_WRITE },
    { objectUniversalIdentifier: SUPPORT_TICKET, ...READ_WRITE },
    { objectUniversalIdentifier: KYC_CASE, ...READ_WRITE },
    { objectUniversalIdentifier: WEBHOOK_DELIVERY, ...READ_WRITE },
    { objectUniversalIdentifier: IDEMPOTENCY_RECORD, ...READ_WRITE },
    { objectUniversalIdentifier: PERSON_OBJECT, ...READ_WRITE },
  ],
  fieldPermissions: [
    PERSON_PROTECTA_PHONE,
    PERSON_PROTECTA_ROLE,
    PERSON_PROTECTA_KYC,
    PERSON_PROTECTA_NIN,
    PERSON_LICENCE_NO,
    PERSON_PROTECTA_CONSENT,
  ].map((fieldUniversalIdentifier) => ({
    objectUniversalIdentifier: PERSON_OBJECT,
    fieldUniversalIdentifier,
    canReadFieldValue: true,
    canUpdateFieldValue: true,
  })),
  permissionFlagUniversalIdentifiers: [
    SystemPermissionFlag.APPLICATIONS,
    SystemPermissionFlag.UPLOAD_FILE,
    SystemPermissionFlag.DOWNLOAD_FILE,
    SystemPermissionFlag.EXPORT_CSV,
  ],
});
