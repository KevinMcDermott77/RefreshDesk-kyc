'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export function Nav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        transition: 'background 0.2s, box-shadow 0.2s',
        background: scrolled ? '#ffffff' : 'transparent',
        boxShadow: scrolled ? '0 1px 0 #e2e8e7' : 'none',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--font-playfair)',
            fontWeight: 700,
            fontSize: '1.25rem',
            color: scrolled ? '#0A1628' : '#ffffff',
            textDecoration: 'none',
            letterSpacing: '-0.01em',
          }}
        >
          RefreshDesk
        </Link>

        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                background: '#0F766E',
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              Go to dashboard →
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="nav-secondary-link"
                style={{
                  padding: '8px 16px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: scrolled ? '#0A1628' : '#ffffff',
                  textDecoration: 'none',
                  borderRadius: 6,
                }}
              >
                Log in
              </Link>
              <Link
                href="/signup"
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  background: '#0F766E',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                Start free →
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
