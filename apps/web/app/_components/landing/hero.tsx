'use client'

import Link from 'next/link'

const TICKER_EVENTS = [
  { time: '09:14:02', event: 'document.approved · passport · Acme Consulting Ltd' },
  { time: '09:13:15', event: 'entity_cdd.approved · 11519884 · Friedrich Ludewig' },
  { time: '09:12:44', event: 'client.refreshed → due 2029-06-07 · standard risk' },
  { time: '09:11:58', event: 'filing.saved · CS01 · Annual Return' },
  { time: '09:10:33', event: 'document.uploaded · utility_bill · Chen Associates' },
  { time: '09:09:21', event: 'campaign.reminder_sent · 3 clients overdue' },
  { time: '09:08:47', event: 'document.approved · incorporation_cert · Noble & Co' },
  { time: '09:07:30', event: 'entity_cdd.approved · 09321447 · J. Hargreaves' },
  { time: '09:06:19', event: 'client.refreshed → due 2028-11-12 · high risk' },
  { time: '09:05:02', event: 'filing.saved · AA · Annual Accounts' },
  { time: '09:03:55', event: 'document.uploaded · passport · Meridian Partners' },
  { time: '09:02:41', event: 'campaign.reminder_sent · MLR supervisor notified' },
]

export function Hero() {
  return (
    <section
      style={{
        background: '#0A1628',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        paddingTop: 80,
        paddingBottom: 80,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .ticker-track {
          animation: ticker-scroll 28s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      <div
        className="landing-hero-grid"
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 64,
          alignItems: 'center',
          width: '100%',
        }}
      >
        {/* Left: copy */}
        <div>
          <p
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#0F766E',
              marginBottom: 20,
            }}
          >
            Built for UK MLR 2017 firms
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-playfair)',
              fontWeight: 700,
              fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
              lineHeight: 1.1,
              color: '#ffffff',
              margin: '0 0 24px',
              letterSpacing: '-0.02em',
            }}
          >
            KYC refresh that
            <br />
            auditors trust.
          </h1>
          <p
            style={{
              fontSize: '1.125rem',
              lineHeight: 1.7,
              color: 'rgba(255,255,255,0.72)',
              margin: '0 0 40px',
              maxWidth: 480,
            }}
          >
            Stop managing spreadsheets. RefreshDesk automates client refresh
            tracking, AI document extraction, and Companies House lookups — with
            a complete audit trail for every decision.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link
              href="/signup"
              style={{
                padding: '14px 28px',
                background: '#0F766E',
                color: '#ffffff',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9375rem',
                display: 'inline-block',
              }}
            >
              Start free — no card needed
            </Link>
            <a
              href="#how-it-works"
              style={{
                padding: '14px 24px',
                border: '1px solid rgba(255,255,255,0.25)',
                color: 'rgba(255,255,255,0.85)',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 500,
                fontSize: '0.9375rem',
                display: 'inline-block',
              }}
            >
              See how it works ↓
            </a>
          </div>
        </div>

        {/* Right: audit trail ticker */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            height: 360,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Terminal header bar */}
          <div
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'inline-block' }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6875rem',
                color: 'rgba(255,255,255,0.35)',
                marginLeft: 8,
              }}
            >
              audit-trail — live
            </span>
          </div>

          {/* Fade gradients */}
          <div
            style={{
              position: 'absolute',
              top: 41,
              left: 0,
              right: 0,
              height: 48,
              background: 'linear-gradient(to bottom, rgba(10,22,40,0.95), transparent)',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 48,
              background: 'linear-gradient(to top, rgba(10,22,40,0.95), transparent)',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />

          {/* Scrolling events — duplicate list for seamless loop */}
          <div style={{ padding: '0 16px', overflow: 'hidden', height: 'calc(100% - 41px)' }}>
            <div className="ticker-track">
              {[...TICKER_EVENTS, ...TICKER_EVENTS].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    padding: '7px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.6875rem',
                      color: '#0F766E',
                      flexShrink: 0,
                    }}
                  >
                    {item.time}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.6875rem',
                      color: 'rgba(255,255,255,0.7)',
                      lineHeight: 1.5,
                    }}
                  >
                    {item.event}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
