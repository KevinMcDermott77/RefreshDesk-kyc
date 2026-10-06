export function Testimonials() {
  return (
    <section style={{ background: '#E8F4F3', padding: '96px 24px' }}>
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
            What practitioners say
          </p>
          <h2
            style={{
              fontFamily: 'var(--font-playfair)',
              fontWeight: 700,
              fontSize: 'clamp(1.875rem, 3.5vw, 2.5rem)',
              color: '#0A1628',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Trusted by compliance-first firms
          </h2>
        </div>

        {/* PLACEHOLDER: replace with real testimonials before launch */}
        <div
          className="landing-testimonials-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            maxWidth: 900,
            margin: '0 auto',
          }}
        >
          <blockquote
            style={{
              background: '#ffffff',
              border: '1px solid #d4ece9',
              borderRadius: 12,
              padding: '32px',
              margin: 0,
            }}
          >
            <p
              style={{
                fontSize: '1.0625rem',
                lineHeight: 1.65,
                color: '#0A1628',
                margin: '0 0 24px',
                fontStyle: 'italic',
              }}
            >
              &ldquo;RefreshDesk cut our KYC refresh time by 60%. The audit trail alone is worth the
              subscription.&rdquo;
            </p>
            <footer
              style={{
                fontSize: '0.875rem',
                color: '#6b716d',
                fontStyle: 'normal',
              }}
            >
              — MLR Compliance Officer, London accountancy firm
            </footer>
          </blockquote>

          <blockquote
            style={{
              background: '#ffffff',
              border: '1px solid #d4ece9',
              borderRadius: 12,
              padding: '32px',
              margin: 0,
            }}
          >
            <p
              style={{
                fontSize: '1.0625rem',
                lineHeight: 1.65,
                color: '#0A1628',
                margin: '0 0 24px',
                fontStyle: 'italic',
              }}
            >
              &ldquo;Finally a tool that understands what accountants actually need for AML
              compliance.&rdquo;
            </p>
            <footer
              style={{
                fontSize: '0.875rem',
                color: '#6b716d',
                fontStyle: 'normal',
              }}
            >
              — Practice Manager, regional firm
            </footer>
          </blockquote>
        </div>
      </div>
    </section>
  )
}
