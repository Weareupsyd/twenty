/** Protecta Bode's supplied wordmark for the hosted identity-verification flow. */
export function ProtectaBrand({
  sub = 'ID verification',
  height = 24,
  showName = true,
}: {
  size?: number;
  sub?: string | null;
  height?: number;
  showName?: boolean;
}) {
  const logoWidth = Math.max(132, height * 3.8);

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        color: 'var(--ink, #162044)',
        fontFamily: 'var(--sans, inherit)',
      }}
    >
      {showName ? (
        <img
          src="/kyc/protecta/protecta-bode-logo.svg"
          alt="Protecta Bode by Liberty General Insurance"
          style={{ width: logoWidth, maxWidth: '70vw', height: 'auto', display: 'block', objectFit: 'contain' }}
        />
      ) : null}
      {sub ? (
        <span
          style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: 9,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--mid, #56607F)',
          }}
        >
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/** The session's explicit partner logo wins; otherwise use Protecta Bode's wordmark. */
export function ProtectaLogo({
  logoUrl,
  companyName,
  height = 24,
}: {
  logoUrl?: string | null;
  companyName?: string | null;
  height?: number;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={companyName || 'Logo'}
        style={{ height, maxWidth: '60%', objectFit: 'contain', display: 'block', margin: '0 auto' }}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <span style={{ display: 'flex', justifyContent: 'center' }}>
      <ProtectaBrand height={height + 6} sub="ID verification" />
    </span>
  );
}
