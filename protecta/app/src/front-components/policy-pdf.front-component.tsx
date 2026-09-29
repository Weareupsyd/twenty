import { defineFrontComponent } from 'twenty-sdk/define';
import { EFFECT_POLICY_PDF } from 'src/constants/universal-identifiers';
import { useEffect, useState, type CSSProperties } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { useSelectedRecordIds } from 'twenty-sdk/front-component';

const PRIMARY_STYLE: CSSProperties = {
  marginLeft: 8,
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #0B1C48',
  background: '#0B1C48',
  color: '#fff',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

const SECONDARY_STYLE: CSSProperties = {
  marginLeft: 8,
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #BCDCE7',
  background: '#fff',
  color: '#0B1C48',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

const Component = () => {
  const ids = useSelectedRecordIds();
  const [policyNo, setPolicyNo] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Front components run inside a sandboxed Web Worker: window.print,
  // window.open, document and fetch-with-relative-URLs are unavailable
  // there. Resolve the policy number, then use normal links to open the
  // document viewer in the browser for printing or downloading.
  useEffect(() => {
    let cancelled = false;
    setPolicyNo(null);
    setError('');

    if (ids.length > 1) {
      setError('Select exactly one policy.');
      return;
    }
    if (ids.length !== 1) {
      return;
    }

    (async () => {
      try {
        const client = new CoreApiClient();
        const data = (await client.query({
          insurancePolicies: {
            __args: { filter: { id: { eq: ids[0] } }, first: 1 },
            edges: { node: { policyNo: true } },
          },
        })) as any;
        const no = data?.insurancePolicies?.edges?.[0]?.node?.policyNo;
        if (!no) throw new Error('Policy not found or missing policyNo.');
        if (!cancelled) setPolicyNo(String(no));
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Could not resolve policy.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ids]);

  const docUrl = policyNo
    ? `/s/protecta/policies/doc?ref=${encodeURIComponent(policyNo)}`
    : null;
  const pdfUrl = policyNo
    ? `/s/protecta/policies/pdf?ref=${encodeURIComponent(policyNo)}`
    : null;

  return (
    <section
      style={{ padding: 24, fontFamily: 'sans-serif', color: '#0B1C48' }}
    >
      <h2>Generate policy document</h2>
      <p>
        {ids.length === 1
          ? 'Open the printable policy certificate. Printing and PDF download happen in the document viewer — the certificate PDF is password-protected with the policyholder phone number.'
          : 'Select exactly one policy.'}
      </p>

      {ids.length === 1 && !policyNo && !error && (
        <p style={{ marginTop: 12, color: '#56607F' }}>Resolving policy…</p>
      )}

      {error && (
        <p role="status" style={{ marginTop: 12, color: '#B3261E' }}>
          {error}
        </p>
      )}

      {docUrl && (
        <>
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={PRIMARY_STYLE}
          >
            🖨 Print / view certificate
          </a>
          <a
            href={pdfUrl!}
            target="_blank"
            rel="noopener noreferrer"
            style={SECONDARY_STYLE}
          >
            ⬇ Download PDF
          </a>
        </>
      )}

      <p style={{ fontSize: 13, color: '#56607F', marginTop: 12 }}>
        Tip: The document viewer also lets you print. If the Document Generator
        app is installed, Word/PDF under <i>Documents</i> will also appear.
      </p>
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: EFFECT_POLICY_PDF,
  name: 'policy-pdf',
  component: Component,
});
