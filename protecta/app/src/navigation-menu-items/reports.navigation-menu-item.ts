import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import {
  NAV_REPORTS,
  PROTECTA_REPORTS_PAGE_LAYOUT,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: NAV_REPORTS,
  position: 1,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: PROTECTA_REPORTS_PAGE_LAYOUT,
  name: 'Reports (Excel)',
  icon: 'IconFileSpreadsheet',
});
