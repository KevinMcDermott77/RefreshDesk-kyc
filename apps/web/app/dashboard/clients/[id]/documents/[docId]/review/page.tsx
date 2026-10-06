import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createSignedUrl } from '@/lib/supabase/storage'
import type { ClientDocument, DocumentExtraction } from '@/lib/types/documents'
import { DOCUMENT_TYPE_LABELS } from '@/lib/types/documents'
import { ReviewForm } from './review-form'

function formatField(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

function renderFields(fields: Record<string, unknown>) {
  return Object.entries(fields).map(([key, value]) => {
    const label = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    const display = formatField(value)
    const isMissing = value === null || value === undefined
    return (
      <tr key={key} className="border-t border-[var(--line)]">
        <td className="py-3 pr-6 text-sm text-[var(--muted)] align-top">{label}</td>
        <td className={`py-3 text-sm font-medium align-top ${isMissing ? 'text-[var(--muted)]' : ''}`}>
          {display}
        </td>
      </tr>
    )
  })
}

export default async function ReviewExtractionPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>
}) {
  const { id, docId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: docData } = await supabase
    .from('client_documents')
    .select('*')
    .eq('id', docId)
    .eq('client_id', id)
    .single()

  if (!docData) notFound()
  const doc = docData as ClientDocument

  const { data: extractionData } = await supabase
    .from('document_extractions')
    .select('*')
    .eq('document_id', docId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!extractionData) notFound()
  const extraction = extractionData as DocumentExtraction

  // Signed URL for preview (best-effort)
  const signedUrl = await createSignedUrl(doc.storage_path)

  const stored = extraction.extracted_fields as Record<string, unknown>
  const fieldMap = (
    typeof stored?.fields === 'object' && stored.fields !== null
      ? stored.fields
      : stored
  ) as Record<string, unknown>
  const warnings = Array.isArray(stored?.extraction_warnings)
    ? (stored.extraction_warnings as string[])
    : []
  const confidenceNotes =
    typeof stored?.confidence_notes === 'string' ? stored.confidence_notes : null
  const confidencePercent =
    extraction.confidence_score !== null
      ? Math.round(extraction.confidence_score * 100)
      : null

  if (extraction.status !== 'pending_review') {
    redirect(`/dashboard/clients/${id}`)
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto max-w-3xl">
        <header className="border-b border-[var(--line)] pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
            Review extraction
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {DOCUMENT_TYPE_LABELS[doc.document_type]}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{doc.file_name}</p>
        </header>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* Extracted fields */}
          <div className="border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Extracted fields</h2>
              {confidencePercent !== null && (
                <span
                  className={`text-sm font-semibold ${
                    confidencePercent >= 80
                      ? 'text-emerald-700'
                      : confidencePercent >= 50
                        ? 'text-amber-700'
                        : 'text-red-700'
                  }`}
                >
                  Confidence: {confidencePercent}%
                </span>
              )}
            </div>
            <table className="mt-4 w-full">
              <tbody>{renderFields(fieldMap)}</tbody>
            </table>
          </div>

          {/* Document preview + warnings */}
          <div className="flex flex-col gap-4">
            {signedUrl && (
              <div className="border border-[var(--line)] bg-[var(--panel)] p-3">
                {doc.mime_type === 'application/pdf' ? (
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-[var(--accent)] hover:underline"
                  >
                    Open PDF in new tab →
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signedUrl}
                    alt={doc.file_name}
                    className="max-h-64 w-full object-contain"
                  />
                )}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-800">Warnings</h3>
                <ul className="mt-2 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {confidenceNotes && (
              <div className="border border-[var(--line)] bg-[var(--panel)] p-4">
                <h3 className="text-sm font-semibold">Confidence notes</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{confidenceNotes}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Review decision</h2>
          <ReviewForm
            extractionId={extraction.id}
            clientId={id}
          />
        </div>

        <footer className="mt-8">
          <a
            href={`/dashboard/clients/${id}`}
            className="text-sm text-[var(--muted)] hover:underline"
          >
            ← Back to client
          </a>
        </footer>
      </section>
    </main>
  )
}
