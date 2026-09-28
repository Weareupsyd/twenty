import { defineApplicationRole, SystemPermissionFlag } from 'twenty-sdk/define';
import { ROLE_DOCGEN_FUNCTION } from 'src/constants/universal-identifiers';

// The role the app's logic functions run as. It reads Protecta's records
// (policies, quotes, people) in the shared workspace and writes generated
// documents, but never destroys anything.
export default defineApplicationRole({
  universalIdentifier: ROLE_DOCGEN_FUNCTION,
  label: 'Document Generator function role',
  description: 'Runtime role for Document Generator logic functions',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canAccessAllTools: true,
  canBeAssignedToAgents: false,
  permissionFlagUniversalIdentifiers: [
    SystemPermissionFlag.UPLOAD_FILE,
    SystemPermissionFlag.DOWNLOAD_FILE,
  ],
});
