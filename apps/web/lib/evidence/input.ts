import { hasFileBody, parseUploadFields, type FetchUpload } from '@/lib/entity-cdd/fetch-input'
import { parseNodeIdentity } from './node'
import { EVIDENCE_KINDS, type EvidenceKind, type NodeIdentity } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EvidenceUploadInput = {
  clientId: string
  /** The walk's root: a company number, overseas entity number or LEI. */
  subjectId: string
  nodeKey: string
  nodeName: string
  identity: NodeIdentity
  kind: EvidenceKind
  upload: FetchUpload
  /** The user asked for Claude to read the document (only honoured if the firm allows it). */
  wantExtraction: boolean
}

export type ParsedEvidenceUpload = { ok: true; input: EvidenceUploadInput } | { ok: false; error: string }

function text(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What the "Add client evidence" action accepts: a client, the node the evidence is about, an
 * evidence kind and the path of a file the browser has already uploaded to Storage. A file body is
 * refused (Server Actions cap bodies at 1 MB) and owners are never accepted here: they are entered
 * or extracted after the upload.
 */
export function parseEvidenceUploadInput(formData: FormData): ParsedEvidenceUpload {
  if (hasFileBody(formData)) {
    return { ok: false, error: 'Upload the document to storage first: files are not accepted by this action.' }
  }

  const clientId = text(formData, 'client_id')
  if (!UUID.test(clientId)) return { ok: false, error: 'Missing client ID' }

  const subjectId = text(formData, 'subject_id').toUpperCase()
  if (!subjectId) return { ok: false, error: 'Enter the company or LEI the ownership walk started from' }
  if (subjectId.length > 64) return { ok: false, error: 'The walk subject is too long' }

  const nodeName = text(formData, 'node_name')
  if (!nodeName) return { ok: false, error: 'Enter the name of the company the document is about' }
  if (nodeName.length > 300) return { ok: false, error: 'The company name is too long' }

  const kind = text(formData, 'evidence_kind')
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Choose what kind of document this is' }

  const identity = parseNodeIdentity({
    lei: text(formData, 'lei'),
    country: text(formData, 'country'),
    registrationNumber: text(formData, 'registration_number'),
  })
  if (!identity.ok) return identity

  const uploaded = parseUploadFields(formData)
  if (!uploaded.ok) return uploaded
  if (!uploaded.upload) return { ok: false, error: 'No file selected' }

  return {
    ok: true,
    input: {
      clientId,
      subjectId,
      nodeKey: identity.key,
      nodeName,
      identity: identity.identity,
      kind: kind as EvidenceKind,
      upload: uploaded.upload,
      wantExtraction: text(formData, 'use_extraction') === 'on',
    },
  }
}
