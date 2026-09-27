import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';
import {
  INSURANCE_CLAIM,
  LAY_TAB_CLAIM_DETAILS,
  LAY_W_CLAIM_FIELDS,
  LAYOUT_CLAIM,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: LAYOUT_CLAIM,
  name: 'Insurance claim record page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: INSURANCE_CLAIM,
  tabs: [
    {
      universalIdentifier: LAY_TAB_CLAIM_DETAILS,
      title: 'Details',
      position: 0,
      icon: 'IconList',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_CLAIM_FIELDS,
          title: 'Claim fields',
          type: 'FIELDS',
          configuration: { configurationType: 'FIELDS' },
        },
      ],
    },
  ],
});
