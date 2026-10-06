const FEATURES = [
  {
    title: 'AI document extraction',
    description:
      'Upload a passport or incorporation doc — Claude reads it and extracts the fields. You approve or reject. Nothing touches your records without a human decision.',
    icon: '⬡',
  },
  {
    title: 'Companies House auto-fill',
    description:
      'Enter a company number. We pull the directors, PSCs, and UBO chain automatically — including ownership percentages.',
    icon: '⬡',
  },
  {
    title: 'Complete audit trail',
    description:
      'Every action is timestamped and immutable. Upload, extraction, approval, refresh — all logged with who did what and when.',
    icon: '⬡',
  },
  {
    title: 'Refresh tracking',
    description:
      'Risk-rated cadences, overdue alerts, and a daily email digest to the MLR supervisor. No client slips through.',
    icon: '⬡',
  },
  {
    title: 'Semantic search',
    description:
      'Find clients by describing them: "German directors", "South African passports expiring 2025". Powered by vector search across all extracted data.',
    icon: '⬡',
  },
  {
    title: 'Team management',
    description:
      'Invite your team with a join code. Admin, member, and read-only roles. One subscription per firm.',
    icon: '⬡',
  },
]

export function Features() {
  return (
    <section style={{ background: '#F6F2EA', padding: '96px 24px' }}>
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
            Everything you need
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
            Built around how compliance actually works
          </h2>
        </div>

        <div
          className="landing-3col-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
          }}
        >
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              style={{
                background: '#ffffff',
                borderRadius: 12,
                padding: '32px 28px',
                border: '1px solid #e8e0d4',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  background: '#E8F4F3',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    background: '#0F766E',
                    borderRadius: 3,
                    display: 'block',
                  }}
                />
              </div>
              <h3
                style={{
                  fontFamily: 'var(--font-playfair)',
                  fontWeight: 700,
                  fontSize: '1.125rem',
                  color: '#0A1628',
                  margin: '0 0 12px',
                }}
              >
                {feature.title}
              </h3>
              <p
                style={{
                  fontSize: '0.9375rem',
                  lineHeight: 1.65,
                  color: '#4a5568',
                  margin: 0,
                }}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
