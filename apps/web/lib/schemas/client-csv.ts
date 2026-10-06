import { z } from 'zod'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const csvRowSchema = z.object({
  client_type: z
    .string()
    .trim()
    .refine((v) => v === 'individual' || v === 'entity', {
      message: 'Must be "individual" or "entity"',
    }),
  display_name: z
    .string()
    .trim()
    .min(1, { message: 'display_name is required' }),
  risk_rating: z
    .string()
    .trim()
    .refine((v) => v === 'low' || v === 'standard' || v === 'high', {
      message: 'Must be "low", "standard", or "high"',
    }),
  external_ref: z.string().trim().optional(),
  refresh_due_date: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      const t = v.trim()
      return t === '' ? undefined : t
    })
    .refine((v) => v === undefined || ISO_DATE_RE.test(v), {
      message: 'Date must be YYYY-MM-DD format',
    }),
})

export type CsvRow = z.infer<typeof csvRowSchema>

export type CsvRowError = { field: string; message: string }

export type CsvRowResult =
  | { success: true; data: CsvRow }
  | { success: false; errors: CsvRowError[] }

export function validateCsvRow(
  raw: Record<string, string | undefined>
): CsvRowResult {
  const result = csvRowSchema.safeParse(raw)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errors: CsvRowError[] = result.error.issues.map((issue) => ({
    field: String(issue.path[0] ?? 'unknown'),
    message: issue.message,
  }))
  return { success: false, errors }
}
