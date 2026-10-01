import { defineFrontComponent } from 'twenty-sdk/define';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { coreGraphQlClient, type CoreGraphQlClient } from 'src/lib/core-client';
import { useRecordId } from 'twenty-sdk/front-component';
import { FC_POLICY_DOCUMENTS } from 'src/constants/universal-identifiers';
import {
  parseStructuredText,
  type StructuredBlock,
} from 'src/lib/policy-document/structured-text';

type Doc = {
  id: string;
  reference: string;
  status: string;
  content: string;
  error: string;
  createdAt: string;
};

const BTN: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #0B1C48',
  background: '#0B1C48',
  color: '#fff',
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
  fontSize: 13,
  marginRight: 8,
};
const BTN_OUTLINE: CSSProperties = { ...BTN, background: '#fff', color: '#0B1C48' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchDocs = async (client: CoreGraphQlClient, policyNo: string): Promise<Doc[]> => {
  const data = (await client.query({
    generatedDocuments: {
      __args: {
        filter: { policyNo: { eq: policyNo } },
        orderBy: [{ createdAt: 'DescNullsLast' }],
        first: 10,
      },
      edges: {
        node: {
          id: true,
          reference: true,
          status: true,
          content: true,
          error: true,
          createdAt: true,
        },
      },
    },
  } as any)) as any;
  return (data?.generatedDocuments?.edges ?? []).map((e: any) => ({
    id: String(e.node.id),
    reference: String(e.node.reference ?? ''),
    status: String(e.node.status ?? ''),
    content: String(e.node.content ?? ''),
    error: String(e.node.error ?? ''),
    createdAt: String(e.node.createdAt ?? ''),
  }));
};

const Block = ({ block }: { block: StructuredBlock }) => {
  switch (block.type) {
    case 'heading': {
      const size = block.level === 1 ? 18 : block.level === 2 ? 15 : 13.5;
      return (
        <div style={{ fontWeight: 700, fontSize: size, margin: '14px 0 6px' }}>{block.text}</div>
      );
    }
    case 'bullet':
      return <div style={{ paddingLeft: 16, textIndent: -10, margin: '2px 0' }}>• {block.text}</div>;
    case 'table':
      return (
        <table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0 10px' }}>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      borderBottom: '1px solid #ddd',
                      padding: '4px 6px',
                      fontWeight: i === 0 || j === 0 ? 600 : 400,
                      verticalAlign: 'top',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'spacer':
      return <div style={{ height: 8 }} />;
    default:
      return <p style={{ margin: '3px 0' }}>{block.text}</p>;
  }
};

const Component = () => {
  const recordId = useRecordId();
  const [policyNo, setPolicyNo] = useState('');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async (no: string) => {
    const client = coreGraphQlClient();
    try {
      setDocs(await fetchDocs(client, no));
    } catch {
      setDocs([]);
      setMessage(
        'The Document Generator app is not installed in this workspace, so policy documents cannot be generated.',
      );
    }
  }, []);

  useEffect(() => {
    if (!recordId) return;
    (async () => {
      const client = coreGraphQlClient();
      const data = (await client.query({
        insurancePolicies: {
          __args: { filter: { id: { eq: recordId } }, first: 1 },
          edges: { node: { policyNo: true } },
        },
      })) as any;
      const no = String(data?.insurancePolicies?.edges?.[0]?.node?.policyNo ?? '');
      setPolicyNo(no);
      if (no) await load(no);
    })().catch((e) => setMessage(e instanceof Error ? e.message : 'Could not load policy.'));
  }, [recordId, load]);

  const regenerate = async () => {
    if (!policyNo) return;
    setBusy(true);
    setMessage('Generating a new policy document…');
    try {
      const client = coreGraphQlClient();
      const created = (await client.mutation({
        createGeneratedDocument: {
          __args: {
            data: {
              reference: '',
              kind: 'POLICY_CERTIFICATE',
              policyNo,
              status: 'PENDING',
              content: '',
              error: '',
            },
          },
          id: true,
        },
      } as any)) as any;
      const newId = String(created?.createGeneratedDocument?.id ?? '');
      // The Document Generator fills the record from the template.
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const list = await fetchDocs(client, policyNo);
        setDocs(list);
        const doc = list.find((d) => d.id === newId);
        if (doc?.status === 'GENERATED') {
          setMessage(`Document ${doc.reference} generated.`);
          return;
        }
        if (doc?.status === 'FAILED') {
          setMessage(`Generation failed: ${doc.error || 'unknown error'}`);
          return;
        }
      }
      setMessage('Still generating. Refresh this tab in a moment.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not generate the document.');
    } finally {
      setBusy(false);
    }
  };

  const current = docs?.find((d) => d.status === 'GENERATED' && d.content.trim()) ?? null;
  const ref = current ? encodeURIComponent(current.reference) : '';

  return (
    <section style={{ padding: 16, fontFamily: 'sans-serif', color: '#000', fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {current && (
          <>
            <a style={BTN} href={`/s/docgen/documents/view?ref=${ref}&asPdf=1`} target="_blank" rel="noopener noreferrer">
              Open PDF
            </a>
            <a style={BTN_OUTLINE} href={`/s/docgen/documents/docx?ref=${ref}`} target="_blank" rel="noopener noreferrer">
              Download Word
            </a>
          </>
        )}
        <button type="button" style={BTN_OUTLINE} disabled={busy || !policyNo} onClick={regenerate}>
          {busy ? 'Generating…' : current ? 'Regenerate document' : 'Generate document'}
        </button>
      </div>

      {message && <p style={{ margin: '0 0 12px', color: '#56607F' }}>{message}</p>}
      {docs === null && !message && <p>Loading…</p>}

      {docs && docs.length > 0 && (
        <p style={{ margin: '0 0 12px', color: '#56607F' }}>
          {current
            ? `Showing ${current.reference}, generated ${current.createdAt.slice(0, 16).replace('T', ' ')}.`
            : `Latest document ${docs[0].reference || ''} is ${docs[0].status.toLowerCase()}.`}{' '}
          {docs.length > 1 ? `${docs.length} versions on file.` : ''}
        </p>
      )}
      {docs && docs.length === 0 && !message && (
        <p>No policy document has been generated yet. Use “Generate document”.</p>
      )}

      {current && (
        <div style={{ borderTop: '1px solid #000', paddingTop: 8 }}>
          {parseStructuredText(current.content).map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      )}
    </section>
  );
};

export default defineFrontComponent({
  universalIdentifier: FC_POLICY_DOCUMENTS,
  name: 'policy-documents',
  component: Component,
});
