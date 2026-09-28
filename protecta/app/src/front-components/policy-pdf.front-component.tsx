import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_POLICY_PDF } from 'src/constants/universal-identifiers';
import { useState } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { useSelectedRecordIds } from 'twenty-sdk/front-component';

const Component = () => {
  const ids = useSelectedRecordIds();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const download = async () => {
    if (ids.length !== 1) {
      setMsg('Select exactly one policy.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      // Resolve policyNo from the selected record id via Core API
      const client = new CoreApiClient();
      const data = (await client.query({
        insurancePolicies: {
          __args: { filter: { id: { eq: ids[0] } }, first: 1 },
          edges: { node: { policyNo: true } },
        },
      })) as any;
      const policyNo = data?.insurancePolicies?.edges?.[0]?.node?.policyNo;
      if (!policyNo) throw new Error('Policy not found or missing policyNo.');
      // Fetch PDF as blob and trigger download
      const res = await fetch(`/s/protecta/policies/pdf?ref=${encodeURIComponent(policyNo)}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 300) || `PDF failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Protecta-${policyNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg(`Certificate ${policyNo} downloaded. You can also print it from the viewer.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  };

  // Fallback: also allow direct staff-action trigger if needed via REST
  // (kept for symmetry, but download is primary)
  return (
    <section style={{ padding: 24, fontFamily: 'sans-serif', color: '#0B1C48' }}>
      <h2>Generate policy document</h2>
      <p>
        {ids.length === 1 ? 'Download the printable PDF certificate for the selected policy. Works without the Document Generator app.' : 'Select exactly one policy.'}
      </p>
      <button disabled={busy || ids.length !== 1} onClick={download} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #0B1C48', background: '#0B1C48', color: '#fff', cursor: 'pointer' }}>
        {busy ? 'Generating…' : '⬇ Download PDF'}
      </button>
      <button
        disabled={busy || ids.length !== 1}
        onClick={() => window.print()}
        style={{ marginLeft: 8, padding: '10px 16px', borderRadius: 8, border: '1px solid #BCDCE7', background: '#fff', cursor: 'pointer' }}
      >
        🖨 Print
      </button>
      <p role="status" style={{ marginTop: 12 }}>{msg}</p>
      <p style={{ fontSize: 13, color: '#56607F' }}>
        Tip: You can also open <code>/s/protecta/policies/doc?ref=POLICY_NO</code> and use the <b>Download PDF</b> button there. If the Document Generator app is installed, Word/PDF under <i>Documents</i> will also appear.
      </p>
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: EFFECT_POLICY_PDF,
  name: 'policy-pdf',
  component: Component,
});
