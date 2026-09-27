/** Phase 5: the TypeScript port is the only AML implementation.
 *  Off only when an operator explicitly sets AML_TS_PORT=false. */
export function amlPortEnabled(): boolean {
  const value = process.env.AML_TS_PORT;
  if (value === 'false' || value === '0') return false;
  return true;
}
