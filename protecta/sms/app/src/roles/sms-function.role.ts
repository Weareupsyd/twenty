import { defineApplicationRole } from 'twenty-sdk/define';
import { ROLE_SMS_FUNCTION } from 'src/constants/universal-identifiers';

// The role the app's logic functions run as. It reads the workspace
// (people, policies, quotes, claims) to resolve recipients and variables
// and writes only Sms messages.
export default defineApplicationRole({
  universalIdentifier: ROLE_SMS_FUNCTION,
  label: 'SMS Sender function role',
  description: 'Runtime role for SMS Sender logic functions',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canAccessAllTools: true,
  canBeAssignedToAgents: false,
  permissionFlagUniversalIdentifiers: [],
});
