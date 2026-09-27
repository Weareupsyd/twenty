import { defineApplicationRole, SystemPermissionFlag } from 'twenty-sdk/define';
import { APP_FUNCTION_ROLE } from 'src/constants/universal-identifiers';

// The role the app's logic functions run as. It reads and updates workspace
// records (quotes, payments, policies, people, timeline) but never destroys.
export default defineApplicationRole({
  universalIdentifier: APP_FUNCTION_ROLE,
  label: 'Protecta Bode function role',
  description: 'Runtime role for Protecta Bode logic functions',
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
