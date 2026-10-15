'use client'

import { startTransition, useActionState, useRef, useState } from 'react'
import { uploadClientDocument } from '@/lib/documents/upload-client-document'
import { EVIDENCE_KINDS, EVIDENCE_KIND_LABELS } from '@/lib/evidence/types'
import { createEvidenceAction } from '../actions'

type Props = {
  clientId: string
  /** The client's firm: documents are stored under its folder. */
  firmId: string
  extractionEnabled: boolean
  /** Prefilled when the page is opened from a node in the ownership chain. */
  defaults: { subject: string; name: string; lei: string; country: string; registration: string; kind: string }
}

const inputClass = 'mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--accent)]'

export function EvidenceUploadForm({ clientId, firmId, extractionEnabled, defaults }: Props) {
  const [state, dispatch, pending] = useActionState(createEvidenceAction, {})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * The file goes from here straight to Storage; only its path is sent to the server action, because a
   * Server Action body over 1 MB is refused.
   */
  async function submit(formData: FormData) {
    setUploadError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setUploadError('No file selected')
      return
    }
    setUploading(true)
    const result = await uploadClientDocument(file, firmId, clientId)
    setUploading(false)
    if ('error' in result) {
      setUploadError(result.error)
      return
    }
    const next = new FormData()
    next.set('client_id', clientId)
    for (const key of ['subject_id', 'node_name', 'lei', 'country', 'registration_number', 'evidence_kind']) {
      next.set(key, String(formData.get(key) ?? ''))
    }
    if (extractionEnabled && formData.get('use_extraction') === 'on') next.set('use_extraction', 'on')
    next.set('upload_path', result.upload.path)
    next.set('upload_name', result.upload.name)
    next.set('upload_type', result.upload.type)
    next.set('upload_size', String(result.upload.size))
    startTransition(() => dispatch(next))
  }

  const busy = pending || uploading
  const error = uploadError ?? state.error

  return (
    <form action={submit} className="grid gap-5">
      <div className="border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-base font-semibold">Which company is the document about?</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Give an LEI, or a registration number and its country. A name alone is never used to identify a company.
        </p>
        <label className="mt-3 block">
          <span className="text-sm font-medium">Company name</span>
          <input name="node_name" required defaultValue={defaults.name} maxLength={300} className={inputClass} />
        </label>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">LEI</span>
            <input name="lei" defaultValue={defaults.lei} maxLength={20} placeholder="20 characters" className={`${inputClass} uppercase`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Registration number</span>
            <input name="registration_number" defaultValue={defaults.registration} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Country</span>
            <input name="country" defaultValue={defaults.country} maxLength={2} placeholder="NO" className={`${inputClass} uppercase`} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-sm font-medium">Ownership walk started from</span>
          <p className="mt-1 text-xs text-[var(--muted)]">The company number or LEI you entered on the ownership page.</p>
          <input name="subject_id" required defaultValue={defaults.subject} maxLength={64} className={`${inputClass} uppercase`} />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">What kind of document is it?</span>
        <select name="evidence_kind" defaultValue={defaults.kind} className={inputClass}>
          {EVIDENCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {EVIDENCE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">File</span>
        <p className="mt-1 text-xs text-[var(--muted)]">PDF, JPEG, or PNG — max 10 MB</p>
        {/* No name: the file is uploaded to Storage by the form handler and never posted to the action. */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
          required
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none file:mr-4 file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
        />
      </label>

      {extractionEnabled ? (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="use_extraction" defaultChecked className="mt-1" />
          <span>
            Have Claude read the document and propose the owners.
            <span className="block text-xs text-[var(--muted)]">
              The document is sent to the Anthropic API. A different admin still has to confirm everything before it is used.
            </span>
          </span>
        </label>
      ) : (
        <p className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-xs text-[var(--muted)]">
          Document extraction is switched off for this firm, so you will enter the owners by hand after the upload. An admin can
          switch extraction on in Settings.
        </p>
      )}

      {error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : pending ? 'Working…' : 'Upload'}
        </button>
        <a href={`/dashboard/clients/${clientId}`} className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold">
          Cancel
        </a>
      </div>
      {busy && <p className="text-sm text-[var(--muted)]">Uploading… this may take a moment if the document is being read.</p>}
    </form>
  )
}
