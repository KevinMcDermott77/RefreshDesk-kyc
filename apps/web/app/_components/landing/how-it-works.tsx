const STEPS = [
  {
    number: '1',
    title: 'Add your clients',
    description:
      'Import from CSV or add individually. Set risk ratings — high, standard, or low — and RefreshDesk calculates refresh due dates automatically.',
  },
  {
    number: '2',
    title: 'Upload and extract',
    description:
      'Drag in a passport, utility bill, or incorporation document. Claude extracts the fields in seconds. You review and approve before anything is saved.',
  },
  {
    number: '3',
    title: 'Stay ahead of deadlines',
    description:
      'Daily email reminders keep your MLR supervisor informed. Filter by overdue, due soon, or up to date. Search across everything with natural language.',
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" style={{ background: '#ffffff', padding: '96px 24px' }}>
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
            How it works
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
            Up and running in an afternoon
          </h2>
        </div>

        <div
          className="landing-3col-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 48,
            position: 'relative',
          }}
        >
          {STEPS.map((step) => (
            <div key={step.number} style={{ position: 'relative' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#0A1628',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-playfair)',
                  fontWeight: 700,
                  fontSize: '1.25rem',
                  marginBottom: 24,
                }}
              >
                {step.number}
              </div>
              <h3
                style={{
                  fontFamily: 'var(--font-playfair)',
                  fontWeight: 700,
                  fontSize: '1.25rem',
                  color: '#0A1628',
                  margin: '0 0 12px',
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontSize: '0.9375rem',
                  lineHeight: 1.7,
                  color: '#4a5568',
                  margin: 0,
                }}
              >
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
