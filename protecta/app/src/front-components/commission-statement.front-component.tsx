import { useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { FC_COMMISSION_STATEMENT } from 'src/constants/universal-identifiers';
import { CoreDbClient, type RecordData } from 'src/lib/records';

const Component = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<RecordData[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setRows(
        await new CoreDbClient({ runAs: 'user' }).findMany(
          'commissions',
          { filter: { statementMonth: { eq: month } }, first: 100 },
          ['policyNo', 'amountUgx', 'status'],
        ),
      );
    } catch {
      setError('Unable to load commissions. Check your record permissions.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section style={{ padding: 24 }}>
      <h2>Commission statement</h2>
      <input
        aria-label="Month"
        type="month"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
      />
      <button disabled={busy} onClick={load}>
        Load
      </button>
      <p role="status">{error}</p>
      <p>
        Showing up to 100 records. Use the Commissions list/export for a
        complete statement.
      </p>
      <table>
        <thead>
          <tr>
            <th>Policy</th>
            <th>UGX</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>{String(row.policyNo)}</td>
              <td>{Number(row.amountUgx).toLocaleString()}</td>
              <td>{String(row.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
export default defineFrontComponent({
  universalIdentifier: FC_COMMISSION_STATEMENT,
  name: 'commission-statement',
  component: Component,
});
