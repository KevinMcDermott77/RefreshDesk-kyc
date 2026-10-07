import type { ReasonCode } from './types'

/**
 * Plain-English next step for each reason a node could not be resolved.
 * Shared by the chain viewer and, later, the evidence pack.
 */
export const REASON_TEXT: Record<ReasonCode, string> = {
  REGISTER_PAYWALLED: 'The register for this entity is behind a paywall; obtain an extract and record it manually',
  UBO_REGISTER_RESTRICTED: 'The beneficial ownership register is restricted; request ownership details from the client',
  SHAREHOLDERS_NOT_FILED: 'Shareholder information has not been filed; request a shareholder register from the client',
  FREE_MANUAL_RETRIEVAL: 'The register can be searched manually and free of charge; retrieve and record the entry',
  REGISTER_NOT_PROFILED: 'This owner is not a company we can look up; request evidence of who owns or controls it',
  FOREIGN_ENTITY_UNMATCHED:
    "Corporate owner has no UK registration number; request the owner's name, jurisdiction and registration number",
  PSC_STATEMENT: 'Company states it has no registrable person; request an explanation and ownership chart',
  PSC_SUPER_SECURE:
    "Owner's details are protected from disclosure by Companies House; request identity and ownership details from the client",
  PSC_NONE_FILED: 'No persons with significant control are on file; request an ownership chart from the client',
  GLEIF_EXCEPTION_NATURAL_PERSONS: 'GLEIF reports the parent is a natural person; request their identity details',
  GLEIF_EXCEPTION_NON_CONSOLIDATING: 'GLEIF reports the entity does not consolidate its accounts; request an ownership chart',
  GLEIF_EXCEPTION_NO_LEI: 'GLEIF reports the parent has no LEI; request its name, jurisdiction and registration number',
  GLEIF_EXCEPTION_NON_PUBLIC: 'GLEIF reports the parent details are non-public; request ownership details from the client',
  GLEIF_NO_KNOWN_PERSON: 'GLEIF reports no known parent; request an ownership chart from the client',
  BAND_STRADDLES_THRESHOLD: 'Ownership band straddles the threshold; request the exact percentage held',
  CIRCULAR_OWNERSHIP: 'Ownership loops back on itself; request an ownership chart to establish the true controller',
  DEPTH_LIMIT_REACHED: 'Walk stopped at the depth limit; request an ownership chart from this level up',
  SOURCE_UNAVAILABLE: 'Companies House data was unavailable; retry later',
}

export function reasonText(code: ReasonCode): string {
  return REASON_TEXT[code]
}
