import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';
import { KYC, KYC_CASE } from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: KYC,
  position: 8,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: KYC_CASE,
});
