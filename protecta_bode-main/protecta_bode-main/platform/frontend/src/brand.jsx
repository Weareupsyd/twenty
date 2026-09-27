// Protecta Bode wordmark used in portal headers.
export function Logo({ height = 48 }) {
  return (
    <img
      src="/protecta-bode-logo.svg"
      alt="Protecta Bode by Liberty General Insurance"
      height={height}
      style={{ display: 'block', width: 'auto', maxWidth: '100%', objectFit: 'contain' }}
    />
  )
}
