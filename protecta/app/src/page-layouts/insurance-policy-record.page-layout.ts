import { definePageLayout, PageLayoutTabLayoutMode } from 'twenty-sdk/define';
import {
  FC_POLICY_DOCUMENTS,
  INSURANCE_POLICY,
  LAY_TAB_POLICY_DOCS,
  LAY_W_POLICY_DOCS,
  LAY_TAB_POLICY_CERT,
  LAY_TAB_POLICY_DETAILS,
  LAY_W_POLICY_CERT,
  LAY_W_POLICY_FIELDS,
  LAYOUT_POLICY,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: LAYOUT_POLICY,
  name: 'Insurance policy record page',
  type: 'RECORD_PAGE',
  objectUniversalIdentifier: INSURANCE_POLICY,
  tabs: [
    {
      universalIdentifier: LAY_TAB_POLICY_DETAILS,
      title: 'Details',
      position: 0,
      icon: 'IconList',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_POLICY_FIELDS,
          title: 'Policy fields',
          type: 'FIELDS',
          configuration: { configurationType: 'FIELDS' },
        },
      ],
    },
    {
      universalIdentifier: LAY_TAB_POLICY_DOCS,
      title: 'Policy document',
      position: 25,
      icon: 'IconFileText',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_POLICY_DOCS,
          title: 'Generated policy document',
          type: 'FRONT_COMPONENT',
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier: FC_POLICY_DOCUMENTS,
          },
        },
      ],
    },
    {
      universalIdentifier: LAY_TAB_POLICY_CERT,
      title: 'Activity',
      position: 50,
      icon: 'IconHistory',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: LAY_W_POLICY_CERT,
          title: 'Policy activity',
          type: 'TIMELINE',
          configuration: { configurationType: 'TIMELINE' },
        },
      ],
    },
  ],
});
