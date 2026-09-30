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

const Component = () => {
  const ids = useSelectedRecordIds();
  const [policyNo, setPolicyNo] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Resolve the policy number, then open the public full-policy download
  // route. It verifies the purchaser phone before exposing the PDF download.
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

  const downloadUrl = policyNo
    ? `/s/docgen/documents/view?policyNo=${encodeURIComponent(policyNo)}&asPdf=1`
    : null;

  return (
    <section
      style={{ padding: 24, fontFamily: 'sans-serif', color: '#0B1C48' }}
    >
      <h2>Download policy PDF</h2>
      <p>
        {ids.length === 1
          ? 'Open the full policy PDF download. The purchaser phone number is verified before downloading.'
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

      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={PRIMARY_STYLE}
        >
          ⬇ Download full policy PDF
        </a>
      )}
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: EFFECT_POLICY_PDF,
  name: 'policy-pdf',
  component: Component,
});
