import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_QUOTE_CONVERT } from 'src/constants/universal-identifiers';
import { StaffAction } from 'src/front-components/staff-action';

const Component = () => (
  <div>
    <StaffAction action="quote-convert" title="Convert quote to policy" />
    <div style={{ padding: '0 24px 24px', fontFamily: 'sans-serif', color: '#56607F', fontSize: 13 }}>
      <p>After conversion you can print the quote or open the policy certificate.</p>
      <button
        onClick={() => window.print()}
        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #BCDCE7', background: '#fff', cursor: 'pointer' }}
      >
        🖨 Print this record
      </button>
      <span style={{ marginLeft: 8, fontSize: 12 }}>
        Tip: open the public quote page (<code>/s/protecta/quotes/view?ref=QUOTE_REF</code>) and use <b>Print quote</b> there for a clean certificate.
      </span>
    </div>
  </div>
);

export default defineFrontComponent({
  universalIdentifier: EFFECT_QUOTE_CONVERT,
  name: 'quote-convert',
  component: Component,
});
