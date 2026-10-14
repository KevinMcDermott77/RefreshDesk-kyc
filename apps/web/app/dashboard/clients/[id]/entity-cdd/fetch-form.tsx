'use client'

import { startTransition, useActionState, useRef, useState } from 'react'
import { uploadIncorporationDocument } from '@/lib/entity-cdd/upload-incorporation'
import { fetchEntityCddAction } from './actions'

type Props = {
  clientId: string
  /** The client's firm: documents are stored under its folder. */
  firmId: string
}

export function FetchEntityCddForm({ clientId, firmId }: Props) {
  const [state, dispatch, pending] = useActionState(fetchEntityCddAction, {})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * Only the client and a company number go to the server action. A document is uploaded from here
   * straight to Storage first, and only its path is sent: a Server Action body over 1 MB is refused.
   */
  async function submit(formData: FormData) {
    setUploadError(null)
    const next = new FormData()
    next.set('client_id', clientId)

    const companyNumber = String(formData.get('company_number') ?? '').trim()
    const file = fileRef.current?.files?.[0]
    if (companyNumber) {
      next.set('company_number', companyNumber)
    } else if (file) {
      setUploading(true)
      const result = await uploadIncorporationDocument(file, firmId, clientId)
      setUploading(false)
      if ('error' in result) {
        setUploadError(result.error)
        return
      }
      next.set('upload_path', result.upload.path)
      next.set('upload_name', result.upload.name)
      next.set('upload_type', result.upload.type)
      next.set('upload_size', String(result.upload.size))
    }
    startTransition(() => dispatch(next))
  }

  const busy = pending || uploading
  const error = uploadError ?? state.error

  return (
    <form action={submit} className="grid gap-6">
      <label className="block">
        <span className="text-sm font-medium">Company number</span>
        <p className="mt-1 text-xs text-[var(--muted)]">
          8 characters — e.g. 12345678 or SC123456. Leave blank to extract it from an uploaded
          document instead.
        </p>
        <input
          name="company_number"
          type="text"
          maxLength={8}
          placeholder="12345678"
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm uppercase outline-none focus:border-[var(--accent)]"
        />
      </label>

      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
        <span className="h-px flex-1 bg-[var(--line)]" />
        or
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <label className="block">
        <span className="text-sm font-medium">Upload incorporation document</span>
        <p className="mt-1 text-xs text-[var(--muted)]">
          PDF, JPEG, or PNG — Claude will extract the company number. Max 10 MB.
        </p>
        {/* No name: the file is uploaded to Storage by the form handler and never posted to the action. */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none file:mr-4 file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
        />
      </label>

      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {uploading ? 'Uploading document…' : pending ? 'Fetching from Companies House…' : 'Fetch from Companies House'}
        </button>
        <a
          href={`/dashboard/clients/${clientId}`}
          className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold"
        >
          Cancel
        </a>
      </div>

      {pending && (
        <p className="text-sm text-[var(--muted)]">
          This can take a moment — fetching company profile, officers, and PSC register…
        </p>
      )}
    </form>
  )
}
