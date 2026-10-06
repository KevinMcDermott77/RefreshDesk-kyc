import Link from 'next/link'

const STARTER_FEATURES = [
  'Up to 10 clients',
  '1 user',
  'AI extraction',
  'Audit trail',
]

const STARTER_MISSING = [
  'Email campaigns',
  'CSV import',
  'Companies House',
  'Semantic search',
]

const PRO_FEATURES = [
  'Unlimited clients',
  'Unlimited users',
  'AI extraction',
  'Audit trail',
  'Email campaigns',
  'CSV import',
  'Companies House',
  'Semantic search',
]

function Tick() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#E8F4F3',
        color: '#0F766E',
        fontSize: '0.6875rem',
        fontWeight: 700,
        textAlign: 'center',
        lineHeight: '18px',
        flexShrink: 0,
      }}
    >
      ✓
    </span>
  )
}

function Dash() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 18,
        textAlign: 'center',
        color: '#c4bdb3',
        fontSize: '0.875rem',
        lineHeight: '18px',
        flexShrink: 0,
      }}
    >
      —
    </span>
  )
}

export function Pricing() {
  return (
    <section style={{ background: '#ffffff', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <p
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#0F766E',
              marginBottom: 12,
            }}
          >
            Pricing
          </p>
          <h2
            style={{
              fontFamily: 'var(--font-playfair)',
              fontWeight: 700,
              fontSize: 'clamp(1.875rem, 3.5vw, 2.5rem)',
              color: '#0A1628',
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}
          >
            Simple, honest pricing
          </h2>
          <p style={{ fontSize: '0.9375rem', color: '#6b716d', margin: 0 }}>
            No contracts. Cancel any time.
          </p>
        </div>

        <div
          className="landing-2col-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            maxWidth: 800,
            margin: '0 auto',
          }}
        >
          {/* Starter */}
          <div
            style={{
              border: '1px solid #e8e0d4',
              borderRadius: 12,
              padding: '36px 32px',
              background: '#F6F2EA',
            }}
          >
            <p
              style={{
                fontWeight: 600,
                fontSize: '0.8125rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#6b716d',
                margin: '0 0 12px',
              }}
            >
              Starter
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
              <span
                style={{
                  fontFamily: 'var(--font-playfair)',
                  fontWeight: 700,
                  fontSize: '2.5rem',
                  color: '#0A1628',
                }}
              >
                Free
              </span>
            </div>
            <p style={{ fontSize: '0.875rem', color: '#6b716d', margin: '0 0 32px' }}>
              Get started with no commitment
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
              {STARTER_FEATURES.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Tick />
                  <span style={{ fontSize: '0.9375rem', color: '#0A1628' }}>{f}</span>
                </div>
              ))}
              {STARTER_MISSING.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Dash />
                  <span style={{ fontSize: '0.9375rem', color: '#c4bdb3' }}>{f}</span>
                </div>
              ))}
            </div>

            <Link
              href="/signup"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '12px',
                border: '1.5px solid #0A1628',
                borderRadius: 8,
                color: '#0A1628',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9375rem',
              }}
            >
              Get started free
            </Link>
          </div>

          {/* Pro */}
          <div
            style={{
              border: '2px solid #0F766E',
              borderRadius: 12,
              padding: '36px 32px',
              background: '#0A1628',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -13,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#0F766E',
                color: '#ffffff',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '4px 14px',
                borderRadius: 20,
              }}
            >
              Most popular
            </div>

            <p
              style={{
                fontWeight: 600,
                fontSize: '0.8125rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.5)',
                margin: '0 0 12px',
              }}
            >
              Pro
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
              <span
                style={{
                  fontFamily: 'var(--font-playfair)',
                  fontWeight: 700,
                  fontSize: '2.5rem',
                  color: '#ffffff',
                }}
              >
                £49
              </span>
              <span style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.5)' }}>/ month</span>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', margin: '0 0 32px' }}>
              For growing practices
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
              {PRO_FEATURES.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Tick />
                  <span style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.85)' }}>{f}</span>
                </div>
              ))}
            </div>

            <Link
              href="/signup"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '12px',
                background: '#0F766E',
                borderRadius: 8,
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9375rem',
              }}
            >
              Start Pro trial
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
