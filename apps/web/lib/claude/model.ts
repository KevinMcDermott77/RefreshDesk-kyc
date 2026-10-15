/**
 * The model every document-reading feature uses. One place, so a retired model is a one-line change (or an
 * environment variable) rather than a hunt. The previous Sonnet 4 id (dated 2025-05-14) now answers 404 not_found,
 * which made every extraction fail.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL
