'use client'

import { useActionState } from 'react'
import {
  deactivateJoinCodeAction,
  generateJoinCodeAction,
  removeMemberAction,
  updateMemberRoleAction,
} from './team-actions'

type Member = {
  user_id: string
  full_name: string
  role: string
}

type JoinCode = {
  id: string
  code: string
  role: string
  created_at: string
  use_count: number
  max_uses: number | null
  expires_at: string | null
  is_active: boolean
}

type Props = {
  currentUserId: string
  members: Member[]
  joinCodes: JoinCode[]
  atMemberLimit: boolean
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'admin',
  member: 'member',
  read_only: 'read_only',
}

function MemberRow({ member, currentUserId, isLastAdmin }: { member: Member; currentUserId: string; isLastAdmin: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(updateMemberRoleAction, {})
  const [removeState, removeAction, removePending] = useActionState(removeMemberAction, {})
  const isSelf = member.user_id === currentUserId
  const lockLast = isSelf && isLastAdmin && member.role === 'admin'

  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] py-3 text-sm">
      <div>
        <span className="font-medium">{member.full_name}</span>
        {isSelf ? <span className="ml-2 text-xs text-[var(--muted)]">[You]</span> : null}
      </div>
      <div className="flex items-center gap-3">
        {lockLast ? (
          <span className="text-xs text-[var(--muted)]">{ROLE_LABELS[member.role]}</span>
        ) : (
          <form action={roleAction} className="flex items-center gap-2">
            <input type="hidden" name="user_id" value={member.user_id} />
            <select
              name="role"
              defaultValue={member.role}
              className="border border-[var(--line)] bg-white px-2 py-1 text-xs"
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
              <option value="read_only">read_only</option>
            </select>
            <button
              type="submit"
              disabled={rolePending}
              className="border border-[var(--line)] px-2 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {rolePending ? 'Saving…' : 'Update'}
            </button>
          </form>
        )}
        {!lockLast ? (
          <form action={removeAction}>
            <input type="hidden" name="user_id" value={member.user_id} />
            <button
              type="submit"
              disabled={removePending}
              className="border border-[var(--line)] px-2 py-1 text-xs font-semibold text-red-600 disabled:opacity-50"
            >
              {removePending ? 'Removing…' : 'Remove'}
            </button>
          </form>
        ) : null}
      </div>
      {roleState.error ? <p className="text-xs text-red-600">{roleState.error}</p> : null}
      {removeState.error ? <p className="text-xs text-red-600">{removeState.error}</p> : null}
    </div>
  )
}

function JoinCodeRow({ joinCode }: { joinCode: JoinCode }) {
  const [state, action, pending] = useActionState(deactivateJoinCodeAction, {})

  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-mono font-semibold">{joinCode.code}</span>
        <span className="text-xs text-[var(--muted)]">{ROLE_LABELS[joinCode.role]}</span>
        <span className="text-xs text-[var(--muted)]">
          Used {joinCode.use_count}
          {joinCode.max_uses !== null ? ` / ${joinCode.max_uses}` : ''}
        </span>
      </div>
      {joinCode.is_active ? (
        <form action={action}>
          <input type="hidden" name="code_id" value={joinCode.id} />
          <button
            type="submit"
            disabled={pending}
            className="border border-[var(--line)] px-2 py-1 text-xs font-semibold disabled:opacity-50"
          >
            {pending ? 'Deactivating…' : 'Deactivate'}
          </button>
        </form>
      ) : (
        <span className="text-xs text-[var(--muted)]">Inactive</span>
      )}
      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </div>
  )
}

export function TeamSection({ currentUserId, members, joinCodes, atMemberLimit }: Props) {
  const [generateState, generateAction, generatePending] = useActionState(generateJoinCodeAction, {})
  const adminCount = members.filter((m) => m.role === 'admin').length
  const activeCodes = joinCodes.filter((code) => code.is_active)

  return (
    <section className="mt-10 border-t border-[var(--line)] pt-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
        Team
      </p>

      <div className="mt-4">
        <h2 className="text-sm font-semibold">Members</h2>
        <div className="mt-2">
          {members.map((member) => (
            <MemberRow
              key={member.user_id}
              member={member}
              currentUserId={currentUserId}
              isLastAdmin={adminCount <= 1}
            />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold">Invite new member</h2>
        {atMemberLimit ? (
          <p className="mt-2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Upgrade to Pro to invite team members.
          </p>
        ) : (
          <>
            <form action={generateAction} className="mt-2 flex items-center gap-3">
              <select
                name="role"
                defaultValue="member"
                className="border border-[var(--line)] bg-white px-2 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="read_only">Read only</option>
              </select>
              <button
                type="submit"
                disabled={generatePending}
                className="border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {generatePending ? 'Generating…' : 'Generate join code'}
              </button>
            </form>
            {generateState.error ? <p className="mt-2 text-xs text-red-600">{generateState.error}</p> : null}
            {generateState.success ? <p className="mt-2 text-xs text-emerald-600">{generateState.success}</p> : null}
          </>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold">Active join codes</h2>
        <div className="mt-2">
          {activeCodes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No active join codes.</p>
          ) : (
            activeCodes.map((joinCode) => <JoinCodeRow key={joinCode.id} joinCode={joinCode} />)
          )}
        </div>
      </div>
    </section>
  )
}
