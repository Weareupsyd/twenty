import {
  definePageLayout,
  PageLayoutTabLayoutMode,
} from 'twenty-sdk/define';
import {
  PROTECTA_REPORTS_PAGE_LAYOUT,
  PROTECTA_REPORTS_TAB,
  PROTECTA_REPORTS_WIDGET,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: PROTECTA_REPORTS_PAGE_LAYOUT,
  name: 'Protecta Reports',
  type: 'STANDALONE_PAGE',
  tabs: [
    {
      universalIdentifier: PROTECTA_REPORTS_TAB,
      title: 'Excel reports',
      position: 0,
      icon: 'IconFileSpreadsheet',
      layoutMode: PageLayoutTabLayoutMode.VERTICAL_LIST,
      widgets: [
        {
          universalIdentifier: PROTECTA_REPORTS_WIDGET,
          title: 'Open reports and exports',
          type: 'STANDALONE_RICH_TEXT',
          configuration: {
            configurationType: 'STANDALONE_RICH_TEXT',
            body: {
              markdown:
                '## Protecta Bode reports\n\nView live operational reports and download Excel or CSV exports from the Protecta reporting page.\n\n[Open Reports & Excel exports](/s/protecta/reports)',
            },
          },
        },
      ],
    },
  ],
});
