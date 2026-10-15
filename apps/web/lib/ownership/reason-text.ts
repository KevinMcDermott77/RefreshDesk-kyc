import type { ReasonCode } from './types'

/** What to ask for first, wherever a register cannot be read. The register-specific document is the fallback. */
export const REQUEST_CONFIRMATION = 'Request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)'

/**
 * Plain-English next step for each reason a node could not be resolved.
 * Shared by the chain viewer and, later, the evidence pack.
 */
export const REASON_TEXT: Record<ReasonCode, string> = {
  REGISTER_PAYWALLED: 'The register for this entity is behind a paywall: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart), or obtain a paid extract',
  UBO_REGISTER_RESTRICTED: 'The beneficial ownership register is restricted: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  SHAREHOLDERS_NOT_FILED: 'Shareholder information has not been filed: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart); a shareholder register is a fallback',
  FREE_MANUAL_RETRIEVAL: 'The register can be searched manually and free of charge: retrieve the entry, or request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  REGISTER_NOT_PROFILED: 'This owner is not a company we can look up: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  FOREIGN_ENTITY_UNMATCHED:
    "Corporate owner has no UK registration number; request the owner's name, jurisdiction and registration number",
  PSC_STATEMENT: 'Company states it has no registrable person; request an explanation and ownership chart',
  PSC_SUPER_SECURE:
    "Owner's details are protected from disclosure by Companies House; request identity and ownership details from the client",
  PSC_NONE_FILED: 'No persons with significant control are on file; request an ownership chart from the client',
  GLEIF_EXCEPTION_NATURAL_PERSONS: 'GLEIF reports the parent is a natural person; request their identity details',
  GLEIF_EXCEPTION_NON_CONSOLIDATING: 'GLEIF reports the entity does not consolidate its accounts: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  GLEIF_EXCEPTION_NO_LEI: 'GLEIF reports the parent has no LEI; request its name, jurisdiction and registration number',
  GLEIF_EXCEPTION_NON_PUBLIC: 'GLEIF reports the parent details are non-public: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  GLEIF_NO_KNOWN_PERSON: 'GLEIF reports no known parent: request written confirmation of ownership from the client (a signed letter or email, ideally with a structure chart)',
  BAND_STRADDLES_THRESHOLD: 'Ownership band straddles the threshold; request the exact percentage held',
  CIRCULAR_OWNERSHIP: 'Ownership loops back on itself; request an ownership chart to establish the true controller',
  DEPTH_LIMIT_REACHED: 'Walk stopped at the depth limit; request an ownership chart from this level up',
  PSC_LOOK_THROUGH_LIKELY:
    'Register likely looks through non-UK fund entities; request a group structure chart showing intermediate funds, general partners and the fund manager, or resolve at a listed or regulated parent.',
  LISTING_US_UNCONFIRMED: 'Name matches a US-listed company; confirm the listing (ticker shown) before relying on it.',
  CONSOLIDATION_ONLY:
    "Linked to the listed/regulated parent by accounting consolidation (GLEIF), not shareholding. Confirm the holding, e.g. the parent's published list of subsidiaries or a group structure chart.",
  CLIENT_EVIDENCE_INCOMPLETE:
    'Client evidence was provided but does not rule out an unlisted holder at or above the threshold; ask the client for a fuller document. A reviewer cannot override this.',
  CLIENT_EVIDENCE_STALE: 'Client evidence was provided but is older than the age limit; ask the client to confirm ownership again, or have an admin confirm it with an override note.',
  CLIENT_EVIDENCE_UNCERTIFIED: 'Client evidence was provided but is not certified; ask for a certified copy, or have an admin confirm it with an override note. (A client\'s own written confirmation does not need certifying.)',
  CLIENT_EVIDENCE_APPLIED: 'Resolved on client-provided, reviewer-verified evidence (shown with its document, age and certification).',
  CLIENT_EVIDENCE_EMAIL_NOT_ACCEPTED:
    'The client confirmed ownership by email, and the policy does not accept an emailed confirmation as resolving; ask for a signed letter or a signed structure chart.',
  CLIENT_EVIDENCE_NOT_ACCEPTED: 'Client evidence exists for this owner, but the policy does not accept client evidence as resolving; it is shown for information.',
  CLIENT_EVIDENCE_PENDING: 'Client evidence has been uploaded for this owner and is waiting for an admin to confirm it; it is not used until then.',
  SOURCE_UNAVAILABLE: 'Companies House data was unavailable; retry later',
}

export function reasonText(code: ReasonCode): string {
  return REASON_TEXT[code]
}
