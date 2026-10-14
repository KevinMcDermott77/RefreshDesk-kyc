'use client'

import { startTransition, useActionState, useRef, useState } from 'react'
import { uploadClientDocument } from '@/lib/documents/upload-client-document'
import { uploadDocumentAction } from './actions'
import { DOCUMENT_TYPE_LABELS } from '@/lib/types/documents'
import type { DocumentType } from '@/lib/types/documents'

type Props = {
  clientId: string
  /** The client's firm: documents are stored under its folder. */
  firmId: string
  preselectedType: string
}

export function UploadForm({ clientId, firmId, preselectedType }: Props) {
  const [state, dispatch, pending] = useActionState(uploadDocumentAction, {})
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
    next.set('document_type', String(formData.get('document_type') ?? ''))
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

      <label className="block">
        <span className="text-sm font-medium">Document type</span>
        <select
          name="document_type"
          defaultValue={preselectedType}
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--accent)]"
        >
          {(Object.entries(DOCUMENT_TYPE_LABELS) as [DocumentType, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
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
          {uploading ? 'Uploading…' : pending ? 'Extracting…' : 'Upload and extract'}
        </button>
        <a
          href={`/dashboard/clients/${clientId}`}
          className="border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm font-semibold"
        >
          Cancel
        </a>
      </div>

      {busy && (
        <p className="text-sm text-[var(--muted)]">
          Uploading… running AI extraction… this may take a moment.
        </p>
      )}
    </form>
  )
}
