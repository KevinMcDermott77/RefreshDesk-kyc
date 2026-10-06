import Link from 'next/link'

export function CtaFooter() {
  return (
    <footer style={{ background: '#0A1628', padding: '96px 24px 48px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* CTA block */}
        <div style={{ textAlign: 'center', marginBottom: 80 }}>
          <h2
            style={{
              fontFamily: 'var(--font-playfair)',
              fontWeight: 700,
              fontSize: 'clamp(1.875rem, 3.5vw, 2.75rem)',
              color: '#ffffff',
              margin: '0 0 32px',
              letterSpacing: '-0.02em',
            }}
          >
            Ready to get your KYC refresh
            <br />
            under control?
          </h2>
          <Link
            href="/signup"
            style={{
              display: 'inline-block',
              padding: '16px 36px',
              background: '#0F766E',
              color: '#ffffff',
              borderRadius: 8,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            Start free — no card needed
          </Link>
        </div>

        {/* Footer base */}
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            paddingTop: 32,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-playfair)',
              fontWeight: 700,
              fontSize: '1.125rem',
              color: '#ffffff',
              letterSpacing: '-0.01em',
            }}
          >
            RefreshDesk
          </span>
          <p
            style={{
              margin: 0,
              fontSize: '0.875rem',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            Built for UK regulated firms
          </p>
          <nav style={{ display: 'flex', gap: 24 }}>
            <Link href="/login" style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>
              Log in
            </Link>
            <Link href="/signup" style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>
              Sign up
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
