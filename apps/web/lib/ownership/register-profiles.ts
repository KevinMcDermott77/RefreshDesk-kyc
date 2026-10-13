import type { ReasonCode } from './types'

export type SharesPublic = 'yes' | 'no' | 'partial' | 'manual'
export type UboAccess = 'public' | 'legitimate_interest' | 'obliged_entity' | 'restricted'

/** How a firm would get at a register's ownership data. */
export type AccessRouteKind = 'public' | 'obliged_entity' | 'aggregator' | 'paid_extract'
export type AccessRoute = { route: AccessRouteKind; detail?: string }

export type RegisterProfile = {
  /** ISO 3166-1 alpha-2. */
  country: string
  registerName: string
  url: string
  /** Basic company data (name, status, address) is free to view. */
  freeBasicData: boolean
  shareholdersPublic: SharesPublic
  uboAccess: UboAccess
  accessRoutes: AccessRoute[]
  /** Why the walk stops here when nothing more specific (e.g. a GLEIF exception) applies. */
  defaultReasonCode: ReasonCode
  /** Further reasons that apply at the same stop; recorded as secondary. */
  secondaryReasonCodes?: ReasonCode[]
  /** What to ask the client for. */
  documentToRequest: string
  lastVerified: string
  /** false where part of the profile is unconfirmed; shown as "unverified". */
  verified: boolean
  note: string
  /** The jurisdiction is recognised but its register has not been profiled. */
  notProfiled?: boolean
}

const VERIFIED = '2026-10-05'

/**
 * Register profiles by ISO country code. Unknown countries have no entry: use
 * stopReasonFor(), which reports REGISTER_NOT_PROFILED for them.
 */
export const REGISTER_PROFILES: Record<string, RegisterProfile> = {
  GB: {
    country: 'GB',
    registerName: 'Companies House',
    url: 'https://find-and-update.company-information.service.gov.uk',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'public',
    accessRoutes: [{ route: 'public' }],
    defaultReasonCode: 'FREE_MANUAL_RETRIEVAL',
    documentToRequest: 'Confirmation statement and PSC register extract',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Shareholders appear only in confirmation statement PDFs. The PSC register is public. UK companies are walked via Companies House, not GLEIF.',
  },
  IE: {
    country: 'IE',
    registerName: 'Companies Registration Office (CRO) and Register of Beneficial Ownership (RBO)',
    url: 'https://core.cro.ie',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'legitimate_interest',
    accessRoutes: [{ route: 'obliged_entity' }, { route: 'aggregator' }],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'UBO declaration and CRO extract',
    lastVerified: VERIFIED,
    verified: true,
    note: 'CRO search, the Open Services API and the open data portal are free; document copies are paid and shareholder information is in those paid documents. RBO access needs a legitimate interest since June 2023; designated persons keep access.',
  },
  LU: {
    country: 'LU',
    registerName: 'Luxembourg Business Registers (LBR): RCS / RESA and RBE',
    url: 'https://www.lbr.lu',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: [{ route: 'obliged_entity' }, { route: 'aggregator' }],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'UBO declaration and RCS extract',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Free, no login. S.a r.l. partners appear on the RCS extract; S.A. shareholders are not public (unverified detail). The RBE is restricted to authorities, obliged entities and those with a legitimate interest (Law of 23 January 2025).',
  },
  NL: {
    country: 'NL',
    registerName: 'KVK (Kamer van Koophandel) Handelsregister and UBO-register',
    url: 'https://www.kvk.nl',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [{ route: 'paid_extract' }, { route: 'aggregator' }],
    defaultReasonCode: 'REGISTER_PAYWALLED',
    documentToRequest: 'KVK extract and shareholder register',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Search is free; extracts are paid; the open dataset is anonymised. Shareholders are not public and the UBO-register is restricted.',
  },
  DE: {
    country: 'DE',
    registerName: 'Handelsregister and Transparenzregister',
    url: 'https://www.handelsregister.de',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'restricted',
    accessRoutes: [{ route: 'public', detail: 'GmbH shareholder list (Gesellschafterliste)' }, { route: 'obliged_entity' }],
    defaultReasonCode: 'FREE_MANUAL_RETRIEVAL',
    documentToRequest: 'Gesellschafterliste (reviewer downloads it) or, for an AG, the share register',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Free since 1 August 2022 but there is no API. The GmbH Gesellschafterliste is free as a scanned PDF; AG shareholders are not filed. The Transparenzregister has been restricted since November 2022.',
  },
  FR: {
    country: 'FR',
    registerName: 'INPI Registre national des entreprises (RNE) and RBE',
    url: 'https://data.inpi.fr',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'obliged_entity',
    accessRoutes: [{ route: 'obliged_entity' }],
    defaultReasonCode: 'SHAREHOLDERS_NOT_FILED',
    documentToRequest: 'Certified share register and UBO declaration',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Free with an account, including actes and statuts. SA and SAS shareholders are not filed. The RBE is open to obliged entities and those with a legitimate interest.',
  },
  ES: {
    country: 'ES',
    registerName: 'Registro Mercantil and Titularidades Reales',
    url: 'https://www.registradores.org',
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'legitimate_interest',
    accessRoutes: [{ route: 'paid_extract', detail: 'nota informativa from about EUR 2.60; no official API' }],
    defaultReasonCode: 'REGISTER_PAYWALLED',
    documentToRequest: 'Nota simple and certified shareholder register',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Paid. Shareholders are generally not public; a single-member SLU is disclosed. Titularidades Reales needs a legitimate interest.',
  },
  DK: {
    country: 'DK',
    registerName: 'CVR (Det Centrale Virksomhedsregister)',
    url: 'https://datacvr.virk.dk',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'restricted',
    accessRoutes: [{ route: 'public', detail: 'legal owners of 5% or more' }, { route: 'obliged_entity' }],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Beneficial owner declaration (CVR shows legal owners of 5% or more)',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Free. Legal owners (5%+) are public. Beneficial owners have not been public since 1 September 2025: access is by MitID and declaration, or an API contract.',
  },
  NO: {
    country: 'NO',
    registerName: 'Brønnøysund Register Centre (Brreg)',
    url: 'https://www.brreg.no',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'SHAREHOLDERS_NOT_FILED',
    documentToRequest: 'Shareholder register extract',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Free under NLOD, no key. Brreg does not hold shareholders (they sit with the company register and the tax authority). The beneficial ownership register is live but not public.',
  },
  SE: {
    country: 'SE',
    registerName: 'Bolagsverket',
    url: 'https://bolagsverket.se',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Share register and beneficial owner declaration',
    lastVerified: VERIFIED,
    verified: false,
    note: 'The high-value-dataset API is free with OAuth registration. Shareholders not held and UBO restricted: both unverified.',
  },
  FI: {
    country: 'FI',
    registerName: 'Finnish Patent and Registration Office (PRH)',
    url: 'https://www.prh.fi',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Share register and beneficial owner declaration',
    lastVerified: VERIFIED,
    verified: false,
    note: 'The open JSON API is free. Shareholders not held and UBO restricted: both unverified.',
  },
  US: {
    country: 'US',
    registerName: 'SEC EDGAR and state registries',
    url: 'https://www.sec.gov/edgar/search',
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [{ route: 'public', detail: 'SEC EDGAR, SEC filers only' }, { route: 'paid_extract', detail: 'state registries' }],
    defaultReasonCode: 'REGISTER_PAYWALLED',
    documentToRequest: 'Certificate of good standing and ownership chart',
    lastVerified: VERIFIED,
    verified: true,
    note: 'EDGAR is free for SEC filers only; state registries are paid. There is no public beneficial ownership register: the FinCEN March 2025 interim rule exempts domestic companies, and BOI was never public.',
  },
  KY: {
    country: 'KY',
    registerName: 'Cayman Islands General Registry',
    url: 'https://www.ciregistry.gov.ky',
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'legitimate_interest',
    accessRoutes: [{ route: 'paid_extract', detail: 'general search US$36.59' }],
    defaultReasonCode: 'REGISTER_PAYWALLED',
    secondaryReasonCodes: ['UBO_REGISTER_RESTRICTED'],
    documentToRequest: 'Register of members and beneficial ownership confirmation from the registered office',
    lastVerified: VERIFIED,
    verified: true,
    note: 'Paid. Shareholders are not public. The BO register is open on legitimate interest only since 28 February 2025, for a fee, with evidence of a money laundering / terrorist financing link.',
  },
  JE: notProfiled('JE', 'Jersey Financial Services Commission registry', 'https://www.jerseyfsc.org'),
  GG: notProfiled('GG', 'Guernsey Registry', 'https://www.greg.gg'),
  VG: notProfiled('VG', 'BVI Registry of Corporate Affairs', 'https://www.bvifsc.vg'),
  CH: notProfiled('CH', 'Swiss commercial registers (Zefix)', 'https://www.zefix.ch'),
}

function notProfiled(country: string, registerName: string, url: string): RegisterProfile {
  return {
    country,
    registerName,
    url,
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'REGISTER_NOT_PROFILED',
    documentToRequest: 'Certified ownership chart and register of members',
    lastVerified: VERIFIED,
    verified: false,
    note: 'Not yet profiled.',
    notProfiled: true,
  }
}

/** The profile for an ISO country code, if one exists. */
export function profileFor(country: string | undefined): RegisterProfile | undefined {
  return country ? REGISTER_PROFILES[country.toUpperCase()] : undefined
}

/** The reason a walk stops at an entity registered in `country`. Unknown countries are not profiled. */
export function stopReasonFor(country: string | undefined): ReasonCode {
  return profileFor(country)?.defaultReasonCode ?? 'REGISTER_NOT_PROFILED'
}
