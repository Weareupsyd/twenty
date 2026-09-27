import { defineCommandMenuItem } from 'twenty-sdk/define';
import {
  FC_COMMISSION_STATEMENT,
  STAFF_COMMISSION_STATEMENT,
} from 'src/constants/universal-identifiers';

export default defineCommandMenuItem({
  universalIdentifier: STAFF_COMMISSION_STATEMENT,
  label: 'Open month commission statement',
  shortLabel: 'Commission statement',
  isPinned: true,
  availabilityType: 'GLOBAL',
  frontComponentUniversalIdentifier: FC_COMMISSION_STATEMENT,
});
