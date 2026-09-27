import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';
import {
  INSURANCE_QUOTE,
  LAY_TAB_QUOTE_DETAILS,
  LAY_TAB_QUOTE_DOCS,
  LAY_W_QUOTE_DOC,
  LAY_W_QUOTE_FIELDS,
  LAYOUT_QUOTE,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: LAYOUT_QUOTE,
  name: 'Insurance quote record page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: INSURANCE_QUOTE,
  tabs: [
    {
      universalIdentifier: LAY_TAB_QUOTE_DETAILS,
      title: 'Details',
      position: 0,
      icon: 'IconList',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_QUOTE_FIELDS,
          title: 'Quote fields',
          type: 'FIELDS',
          configuration: { configurationType: 'FIELDS' },
        },
      ],
    },
    {
      universalIdentifier: LAY_TAB_QUOTE_DOCS,
      title: 'Activity',
      position: 50,
      icon: 'IconHistory',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_QUOTE_DOC,
          title: 'Quote activity',
          type: 'TIMELINE',
          configuration: { configurationType: 'TIMELINE' },
        },
      ],
    },
  ],
});
