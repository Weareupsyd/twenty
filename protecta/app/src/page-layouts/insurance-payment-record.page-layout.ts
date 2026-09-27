import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';
import {
  INSURANCE_PAYMENT,
  LAY_TAB_PAY_DETAILS,
  LAY_W_PAY_FIELDS,
  LAYOUT_PAYMENT,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: LAYOUT_PAYMENT,
  name: 'Insurance payment record page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: INSURANCE_PAYMENT,
  tabs: [
    {
      universalIdentifier: LAY_TAB_PAY_DETAILS,
      title: 'Details',
      position: 0,
      icon: 'IconList',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_PAY_FIELDS,
          title: 'Payment fields',
          type: 'FIELDS',
          configuration: { configurationType: 'FIELDS' },
        },
      ],
    },
  ],
});
