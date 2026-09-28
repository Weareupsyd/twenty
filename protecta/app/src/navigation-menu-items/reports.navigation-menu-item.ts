import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { NAV_REPORTS } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_REPORTS,
  position: 1,
  type: NavigationMenuItemType.LINK,
  label: 'Reports (Excel)',
  icon: 'IconFileSpreadsheet',
  link: '/s/protecta/reports',
});
