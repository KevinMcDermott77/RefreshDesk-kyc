'use client'

import { useActionState, useMemo, useState } from 'react'
import { blankOwner, coverageOf, toPayloadInput, toState, type EditorState, type OwnerRow } from '@/lib/evidence/editor-model'
import {
  CERTIFIER_CAPACITIES,
  CERTIFIER_CAPACITY_LABELS,
  CONFIRMER_CAPACITIES,
  CONFIRMER_CAPACITY_LABELS,
  isConfirmationKind,
  RECEIVED_AS,
  RECEIVED_AS_LABELS,
  type EvidencePayload,
} from '@/lib/evidence/types'
import { confirmEvidenceAction, saveProposalAction } from '../actions'

type Props = {
  /** 'propose': the uploader types the owners. 'confirm': an admin confirms, with edits if needed. */
  mode: 'propose' | 'confirm'
  evidenceId: string
  clientId: string
  initial: EvidencePayload
  /** The kind of evidence: a client's written confirmation has a confirmer and no certification. */
  kind?: string
  canSubmit: boolean
  /** Why the button is disabled; shown beside it. */
  reason?: string
}

const field = 'mt-1 w-full border border-[var(--line)] bg-white px-2 py-2 text-sm outline-none focus:border-[var(--accent)]'

export function EvidenceEditor({ mode, evidenceId, clientId, initial, kind, canSubmit, reason }: Props) {
  const confirmation = isConfirmationKind(kind)
  const [state, setState] = useState<EditorState>(() => toState(initial))
  const [result, dispatch, pending] = useActionState(mode === 'confirm' ? confirmEvidenceAction : saveProposalAction, {})

  const payload = useMemo(() => JSON.stringify(toPayloadInput(state, mode === 'confirm', kind)), [state, mode, kind])
  const cover = useMemo(() => coverageOf(state), [state])

  const update = (patch: Partial<EditorState>) => setState((s) => ({ ...s, ...patch }))
  const updateOwner = (index: number, patch: Partial<OwnerRow>) =>
    setState((s) => ({ ...s, owners: s.owners.map((owner, i) => (i === index ? { ...owner, ...patch } : owner)) }))

  return (
    <form action={dispatch} className="grid gap-6">
      <input type="hidden" name="evidence_id" value={evidenceId} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="payload" value={payload} />

      <div className="grid gap-4">
        {state.owners.map((owner, index) => (
          <fieldset key={index} className={`border bg-white p-4 ${owner.uncertain ? 'border-amber-300' : 'border-[var(--line)]'}`}>
            <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              Owner {index + 1}
              {owner.uncertain && <span className="ml-2 text-amber-700">· read with doubt, check against the document</span>}
            </legend>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block text-sm md:col-span-2">
                <span className="font-medium">Name as shown</span>
                <input className={field} value={owner.name} onChange={(e) => updateOwner(index, { name: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Kind</span>
                <select className={field} value={owner.kind} onChange={(e) => updateOwner(index, { kind: e.target.value as OwnerRow['kind'] })}>
                  <option value="individual">Individual</option>
                  <option value="entity">Company / entity</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Page / section</span>
                <input className={field} value={owner.pageRef} onChange={(e) => updateOwner(index, { pageRef: e.target.value })} />
              </label>

              <label className="block text-sm">
                <span className="font-medium">Holding</span>
                <select
                  className={field}
                  value={owner.holdingType}
                  onChange={(e) => updateOwner(index, { holdingType: e.target.value as OwnerRow['holdingType'] })}
                >
                  <option value="percent">A percentage</option>
                  <option value="band">A band</option>
                  <option value="none">Not printed</option>
                </select>
              </label>
              {owner.holdingType === 'percent' && (
                <label className="block text-sm">
                  <span className="font-medium">Percent</span>
                  <input className={field} inputMode="decimal" value={owner.value} onChange={(e) => updateOwner(index, { value: e.target.value })} />
                </label>
              )}
              {owner.holdingType === 'band' && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">From %</span>
                    <input className={field} inputMode="decimal" value={owner.low} onChange={(e) => updateOwner(index, { low: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">To %</span>
                    <input className={field} inputMode="decimal" value={owner.high} onChange={(e) => updateOwner(index, { high: e.target.value })} />
                  </label>
                </>
              )}
              <label className="block text-sm">
                <span className="font-medium">Shares (as printed)</span>
                <input className={field} value={owner.shares} onChange={(e) => updateOwner(index, { shares: e.target.value })} />
              </label>

              {owner.kind === 'entity' && (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">Registration number</span>
                    <input className={field} value={owner.regNumber} onChange={(e) => updateOwner(index, { regNumber: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">Country</span>
                    <input
                      className={`${field} uppercase`}
                      maxLength={2}
                      placeholder="NO"
                      value={owner.regCountry}
                      onChange={(e) => updateOwner(index, { regCountry: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">LEI (if printed)</span>
                    <input
                      className={`${field} uppercase`}
                      maxLength={20}
                      value={owner.lei}
                      onChange={(e) => updateOwner(index, { lei: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={owner.uncertain} onChange={(e) => updateOwner(index, { uncertain: e.target.checked })} />
                Not certain of this row
              </label>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, owners: s.owners.filter((_, i) => i !== index) }))}
                className="text-xs font-semibold text-red-700 hover:underline"
              >
                Remove owner
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, owners: [...s.owners, blankOwner()] }))}
          className="justify-self-start border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold"
        >
          + Add owner
        </button>
      </div>

      <div className="grid gap-4 border border-[var(--line)] bg-white p-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">As at (the date the holdings are stated for)</span>
          <input type="date" className={field} value={state.asAt} onChange={(e) => update({ asAt: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Document date</span>
          <input type="date" className={field} value={state.documentDate} onChange={(e) => update({ documentDate: e.target.value })} />
        </label>
        {confirmation ? (
          <>
            <label className="block text-sm">
              <span className="font-medium">Confirmed by (capacity: never the name)</span>
              <select className={field} value={state.confirmedByCapacity} onChange={(e) => update({ confirmedByCapacity: e.target.value as EditorState['confirmedByCapacity'] })}>
                {CONFIRMER_CAPACITIES.map((capacity) => (
                  <option key={capacity} value={capacity}>
                    {CONFIRMER_CAPACITY_LABELS[capacity]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Date of the confirmation</span>
              <input type="date" className={field} value={state.confirmationDate} onChange={(e) => update({ confirmationDate: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Received as</span>
              <select className={field} value={state.receivedAs} onChange={(e) => update({ receivedAs: e.target.value as EditorState['receivedAs'] })}>
                {RECEIVED_AS.map((how) => (
                  <option key={how} value={how}>
                    {RECEIVED_AS_LABELS[how]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">&ldquo;No other person holds … % or more&rdquo;</span>
              <input
                className={field}
                inputMode="decimal"
                placeholder="e.g. 25 (leave empty if it does not say so)"
                value={state.noOtherHolder}
                onChange={(e) => update({ noOtherHolder: e.target.value })}
              />
            </label>
            <p className="text-xs text-[var(--muted)] md:col-span-2">
              A client&apos;s own written confirmation is nobody&apos;s certification, so there is nothing to certify. If it states that no other person holds
              the threshold or less than it, that completes the picture, like a full list.
            </p>
          </>
        ) : (
          <>
        <label className="block text-sm">
          <span className="font-medium">Certified?</span>
          <select className={field} value={state.certified} onChange={(e) => update({ certified: e.target.value as EditorState['certified'] })}>
            <option value="yes">Yes: a certification is visible on the document</option>
            <option value="no">No: the document shows none</option>
            <option value="unclear">Unclear</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Certified by (as printed)</span>
          <input className={field} value={state.certifiedBy} onChange={(e) => update({ certifiedBy: e.target.value })} />
        </label>
        {state.certified !== 'no' && (
          <>
            <label className="block text-sm">
              <span className="font-medium">Certifier&apos;s capacity</span>
              <select className={field} value={state.certifierCapacity} onChange={(e) => update({ certifierCapacity: e.target.value as EditorState['certifierCapacity'] })}>
                {CERTIFIER_CAPACITIES.map((capacity) => (
                  <option key={capacity} value={capacity}>
                    {CERTIFIER_CAPACITY_LABELS[capacity]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Date of the certification</span>
              <input type="date" className={field} value={state.certificationDate} onChange={(e) => update({ certificationDate: e.target.value })} />
            </label>
          </>
        )}
          </>
        )}
        <label className="flex items-start gap-3 text-sm md:col-span-2">
          <input type="checkbox" className="mt-1" checked={state.ownersComplete} onChange={(e) => update({ ownersComplete: e.target.checked })} />
          <span>The document says it lists every holder.</span>
        </label>
      </div>

      <div className={`border p-4 text-sm ${cover.covers ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
        <p className="font-semibold">{cover.covers ? 'Coverage: the list rules out an unlisted holder at or above 25%' : 'Coverage: not enough to resolve the company'}</p>
        <p className="mt-1">
          {cover.covers
            ? `Unlisted holders could own up to ${cover.unaccountedUpTo}%.`
            : `${cover.reason}. This stays partial, and a reviewer cannot override it: ask the client for a fuller document.`}
        </p>
      </div>

      {mode === 'confirm' && (
        <div className="grid gap-3 border border-[var(--line)] bg-white p-4">
          <h3 className="text-sm font-semibold">Accept despite a problem (override)</h3>
          <p className="text-xs text-[var(--muted)]">
            {confirmation ? 'Only for a confirmation that is older than the firm\'s age limit.' : 'Only for evidence that is older than the firm\'s age limit or not certified.'} A note is required, and it is kept with the
            evidence and in the refresh pack. Incomplete coverage cannot be overridden.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.stale} onChange={(e) => update({ stale: e.target.checked })} />
            Accept although it is older than the age limit
          </label>
          {!confirmation ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={state.uncertifiedOverride} onChange={(e) => update({ uncertifiedOverride: e.target.checked })} />
              Accept although it is not certified
            </label>
          ) : null}
          {(state.stale || (!confirmation && state.uncertifiedOverride)) && (
            <label className="block text-sm">
              <span className="font-medium">Why (required)</span>
              <textarea className={field} rows={2} value={state.overrideNote} onChange={(e) => update({ overrideNote: e.target.value })} />
            </label>
          )}
          <label className="block text-sm">
            <span className="font-medium">Reviewer note</span>
            <textarea name="note" rows={2} placeholder="Optional" className={field} />
          </label>
        </div>
      )}

      {result.error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{result.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {pending ? 'Saving…' : mode === 'confirm' ? 'Confirm evidence' : 'Save owners for confirmation'}
        </button>
        {!canSubmit && reason && <span className="text-sm text-[var(--muted)]">{reason}</span>}
      </div>
    </form>
  )
}
