import type { ReasonCode } from './types'

export type SharesPublic = 'yes' | 'no' | 'partial' | 'manual'
export type UboAccess = 'public' | 'legitimate_interest' | 'obliged_entity' | 'restricted'

export type RegisterProfile = {
  /** ISO 3166-1 alpha-2. */
  country: string
  registerName: string
  url: string
  /** Basic company data (name, status, address) is free to view. */
  freeBasicData: boolean
  shareholdersPublic: SharesPublic
  uboAccess: UboAccess
  /** How a firm with a subscription or obliged-entity status would get the data. */
  accessRoutes: string[]
  /** Why the walk stops here when nothing more specific (e.g. a GLEIF exception) applies. */
  defaultReasonCode: ReasonCode
  /** What to ask the client for. */
  documentToRequest: string
  lastVerified: string
  note: string
  /** The jurisdiction is recognised but its register has not been profiled. */
  notProfiled?: boolean
}

const VERIFIED = '2026-10-05'

/**
 * Register profiles by ISO country code. Unknown countries have no entry: use
 * profileFor(), which reports REGISTER_NOT_PROFILED for them.
 *
 * Content is a working summary of how each register is accessed, not legal
 * advice. Since the CJEU's 2022 WM/Sovim ruling most EU beneficial ownership
 * registers are no longer open to the public.
 */
export const REGISTER_PROFILES: Record<string, RegisterProfile> = {
  GB: {
    country: 'GB',
    registerName: 'Companies House',
    url: 'https://find-and-update.company-information.service.gov.uk',
    freeBasicData: true,
    shareholdersPublic: 'yes',
    uboAccess: 'public',
    accessRoutes: ['Companies House PSC register (free)'],
    defaultReasonCode: 'FREE_MANUAL_RETRIEVAL',
    documentToRequest: 'Confirmation statement and PSC register extract',
    lastVerified: VERIFIED,
    note: 'Walked directly via Companies House, not through GLEIF.',
  },
  IE: {
    country: 'IE',
    registerName: 'Companies Registration Office (CRO) and Register of Beneficial Ownership (RBO)',
    url: 'https://core.cro.ie',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['RBO access as an obliged entity (rbo.gov.ie)', 'CRO document purchase: annual return (B1) lists shareholders'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Latest annual return (B1) and RBO extract or beneficial ownership declaration',
    lastVerified: VERIFIED,
    note: 'CRO search is free; filed documents carry a fee. The RBO is no longer public.',
  },
  LU: {
    country: 'LU',
    registerName: 'Luxembourg Business Registers (LBR): RCS and RBE',
    url: 'https://www.lbr.lu',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['RBE access as a professional / obliged entity', 'RCS extract and filed articles from LBR (fee)'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'RCS extract, latest articles of association, shareholder register and RBE extract',
    lastVerified: VERIFIED,
    note: 'RBE access restricted to professionals and legitimate interest since 2022. Many funds and S.a r.l. file no shareholder list.',
  },
  NL: {
    country: 'NL',
    registerName: 'KvK Handelsregister and UBO-register',
    url: 'https://www.kvk.nl',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['KvK UBO-register access as an obliged entity', 'KvK extract (fee) shows a sole shareholder of a BV'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'KvK extract, shareholder register and UBO-register extract',
    lastVerified: VERIFIED,
    note: 'Basic KvK data is free; the UBO-register is closed to the public since 2022.',
  },
  DE: {
    country: 'DE',
    registerName: 'Handelsregister and Transparenzregister',
    url: 'https://www.handelsregister.de',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['Handelsregister: GmbH shareholder list (Gesellschafterliste)', 'Transparenzregister access as an obliged entity'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Current Handelsregister extract, Gesellschafterliste and Transparenzregister extract',
    lastVerified: VERIFIED,
    note: 'Shareholder lists are filed for GmbH, not for AG. Transparenzregister is no longer open to the public.',
  },
  FR: {
    country: 'FR',
    registerName: 'Registre du commerce et des sociétés (RCS) and Registre des bénéficiaires effectifs (RBE)',
    url: 'https://data.inpi.fr',
    freeBasicData: true,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['RBE access as an obliged entity via Infogreffe', 'Kbis extract and filed statutes (fee)'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Kbis extract, statutes, share register (registre des mouvements de titres) and RBE extract',
    lastVerified: VERIFIED,
    note: 'SAS shareholders are generally not on the public register.',
  },
  ES: {
    country: 'ES',
    registerName: 'Registro Mercantil',
    url: 'https://www.registradores.org',
    freeBasicData: false,
    shareholdersPublic: 'partial',
    uboAccess: 'obliged_entity',
    accessRoutes: ['Nota simple from the Registro Mercantil (fee)', 'Registro Central de Titularidades Reales as an obliged entity'],
    defaultReasonCode: 'REGISTER_PAYWALLED',
    documentToRequest: 'Nota simple, libro registro de socios and titularidad real declaration',
    lastVerified: VERIFIED,
    note: 'Registry data is paid. A sole shareholder of an S.L. is recorded.',
  },
  DK: {
    country: 'DK',
    registerName: 'CVR (Det Centrale Virksomhedsregister)',
    url: 'https://datacvr.virk.dk',
    freeBasicData: true,
    shareholdersPublic: 'yes',
    uboAccess: 'public',
    accessRoutes: ['CVR search (free): owners of 5% or more and real owners'],
    defaultReasonCode: 'FREE_MANUAL_RETRIEVAL',
    documentToRequest: 'CVR ownership extract (retrievable free) or the company\'s ownership chart',
    lastVerified: VERIFIED,
    note: 'Ownership is shown in CVR free of charge, so it can be retrieved manually. Confirm current access before relying on it.',
  },
  NO: {
    country: 'NO',
    registerName: 'Brønnøysund Register Centre (Enhetsregisteret)',
    url: 'https://www.brreg.no',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'legitimate_interest',
    accessRoutes: ['Register of Beneficial Owners on showing legitimate interest, or as an obliged entity'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Shareholder register (aksjeeierbok) and beneficial owner declaration',
    lastVerified: VERIFIED,
    note: 'Basic data is open; shareholders of private companies are not in the public register.',
  },
  SE: {
    country: 'SE',
    registerName: 'Bolagsverket',
    url: 'https://bolagsverket.se',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'obliged_entity',
    accessRoutes: ['Beneficial ownership register access as an obliged entity'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Share register (aktiebok) and beneficial owner declaration',
    lastVerified: VERIFIED,
    note: 'The share register is held by the company, not published.',
  },
  FI: {
    country: 'FI',
    registerName: 'Finnish Patent and Registration Office (PRH)',
    url: 'https://www.prh.fi',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'legitimate_interest',
    accessRoutes: ['PRH beneficial owner register on legitimate interest or as an obliged entity'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Share register (osakeluettelo) and beneficial owner declaration',
    lastVerified: VERIFIED,
    note: 'Basic data is open; ownership details are restricted.',
  },
  US: {
    country: 'US',
    registerName: 'State Secretary of State registers (no federal ownership register)',
    url: 'https://www.sec.gov/search-filings',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: ['State corporate registry search (entity status only)', 'SEC EDGAR for listed companies'],
    defaultReasonCode: 'SHAREHOLDERS_NOT_FILED',
    documentToRequest: 'Stock ledger or cap table, and a beneficial ownership certification',
    lastVerified: VERIFIED,
    note: 'State registries do not publish shareholders or beneficial owners; listed companies file with the SEC.',
  },
  KY: {
    country: 'KY',
    registerName: 'Cayman Islands General Registry (CORIS)',
    url: 'https://www.ciregistry.gov.ky',
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: ['Beneficial ownership register held by the corporate services provider; competent authorities only'],
    defaultReasonCode: 'UBO_REGISTER_RESTRICTED',
    documentToRequest: 'Register of members, register of directors and a certified ownership chart',
    lastVerified: VERIFIED,
    note: 'Registry searches are paid and show no shareholders.',
  },
  JE: {
    country: 'JE',
    registerName: 'Jersey Financial Services Commission registry',
    url: 'https://www.jerseyfsc.org',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'REGISTER_NOT_PROFILED',
    documentToRequest: 'Certified ownership chart and register of members',
    lastVerified: VERIFIED,
    note: 'Not yet profiled.',
    notProfiled: true,
  },
  GG: {
    country: 'GG',
    registerName: 'Guernsey Registry',
    url: 'https://www.greg.gg',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'REGISTER_NOT_PROFILED',
    documentToRequest: 'Certified ownership chart and register of members',
    lastVerified: VERIFIED,
    note: 'Not yet profiled.',
    notProfiled: true,
  },
  VG: {
    country: 'VG',
    registerName: 'BVI Registry of Corporate Affairs',
    url: 'https://www.bvifsc.vg',
    freeBasicData: false,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'REGISTER_NOT_PROFILED',
    documentToRequest: 'Certified ownership chart and register of members',
    lastVerified: VERIFIED,
    note: 'Not yet profiled.',
    notProfiled: true,
  },
  CH: {
    country: 'CH',
    registerName: 'Swiss commercial registers (Zefix)',
    url: 'https://www.zefix.ch',
    freeBasicData: true,
    shareholdersPublic: 'no',
    uboAccess: 'restricted',
    accessRoutes: [],
    defaultReasonCode: 'REGISTER_NOT_PROFILED',
    documentToRequest: 'Share register and certified ownership chart',
    lastVerified: VERIFIED,
    note: 'Not yet profiled.',
    notProfiled: true,
  },
}

/** The profile for an ISO country code, if one exists. */
export function profileFor(country: string | undefined): RegisterProfile | undefined {
  return country ? REGISTER_PROFILES[country.toUpperCase()] : undefined
}

/** The reason a walk stops at an entity registered in `country`. Unknown countries are not profiled. */
export function stopReasonFor(country: string | undefined): ReasonCode {
  return profileFor(country)?.defaultReasonCode ?? 'REGISTER_NOT_PROFILED'
}
