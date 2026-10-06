'use client'

import { useActionState } from 'react'
import { uploadDocumentAction } from './actions'
import { DOCUMENT_TYPE_LABELS } from '@/lib/types/documents'
import type { DocumentType } from '@/lib/types/documents'

type Props = {
  clientId: string
  preselectedType: string
}

export function UploadForm({ clientId, preselectedType }: Props) {
  const [state, dispatch, pending] = useActionState(uploadDocumentAction, {})

  return (
    <form action={dispatch} className="grid gap-5" encType="multipart/form-data">
      <input type="hidden" name="client_id" value={clientId} />

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
        <input
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
          required
          className="mt-2 w-full border border-[var(--line)] bg-white px-3 py-3 text-sm outline-none file:mr-4 file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
        />
      </label>

      {state.error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {pending ? 'Uploading and extracting…' : 'Upload and extract'}
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
          Uploading… running AI extraction… this may take a moment.
        </p>
      )}
    </form>
  )
}
