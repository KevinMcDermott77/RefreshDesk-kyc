'use client'

/** "Download PDF": opens the browser's print dialog, where "Save as PDF" is a destination. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] dark:bg-gray-900 dark:text-gray-100"
    >
      Download PDF
    </button>
  )
}
