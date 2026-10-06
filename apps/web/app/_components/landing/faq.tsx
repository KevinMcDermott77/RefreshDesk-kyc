'use client'

import { useState } from 'react'

const FAQS = [
  {
    question: 'Is RefreshDesk compliant with MLR 2017?',
    answer:
      'RefreshDesk is designed specifically for firms subject to the Money Laundering Regulations 2017. It supports the risk-based approach to client due diligence, provides a complete audit trail of all decisions, and generates refresh schedules aligned to risk ratings. You remain the regulated firm responsible for compliance — RefreshDesk is the tool that makes it practical.',
  },
  {
    question: 'Where is my data stored?',
    answer:
      'All data is stored in UK/EU data centres via Supabase (hosted on AWS eu-west-2). Documents are encrypted at rest and in transit. We do not use your client data to train AI models.',
  },
  {
    question: 'Can I import my existing client list?',
    answer:
      'Yes. Pro plan users can import clients from a CSV file. The importer validates each row and reports errors before anything is saved, so you can fix issues and re-import without risk.',
  },
  {
    question: 'What happens if I cancel?',
    answer:
      'You can export your client data and documents at any time. If you cancel, your account transitions to the free Starter tier — you keep access to your first 10 clients and can continue viewing all audit history.',
  },
  {
    question: 'Do you support sole practitioners?',
    answer:
      'Yes. The Starter plan is free and supports a single user with up to 10 clients — ideal for sole practitioners or small firms just getting started with structured KYC refresh.',
  },
  {
    question: 'Is there a minimum contract?',
    answer:
      'No. Pro is billed monthly with no minimum term. Cancel at any time from your account settings and your subscription ends at the next billing date.',
  },
]

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        borderBottom: '1px solid #e8e0d4',
      }}
    >
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          padding: '20px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: 16,
        }}
      >
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: '#0A1628',
            lineHeight: 1.4,
          }}
        >
          {question}
        </span>
        <span
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '1.5px solid #0A1628',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            color: '#0A1628',
            transition: 'transform 0.2s',
            transform: open ? 'rotate(45deg)' : 'none',
          }}
        >
          +
        </span>
      </button>

      {open && (
        <div style={{ paddingBottom: 20 }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.9375rem',
              lineHeight: 1.7,
              color: '#4a5568',
            }}
          >
            {answer}
          </p>
        </div>
      )}
    </div>
  )
}

export function Faq() {
  return (
    <section style={{ background: '#F6F2EA', padding: '96px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
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
            FAQ
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
            Common questions
          </h2>
        </div>

        <div style={{ borderTop: '1px solid #e8e0d4' }}>
          {FAQS.map((faq) => (
            <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>
    </section>
  )
}
