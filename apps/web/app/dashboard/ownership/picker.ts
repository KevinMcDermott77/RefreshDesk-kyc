/**
 * The form data for walking a GLEIF pick: everything currently in the form
 * (max depth, threshold, method) with the search text replaced by the chosen
 * LEI. Independent of whether the search box was empty.
 */
export function pickedFormData(current: FormData, lei: string): FormData {
  const data = new FormData()
  for (const [key, value] of current.entries()) {
    if (key !== 'entry' && key !== 'picked_lei') data.append(key, value)
  }
  data.set('entry', lei)
  data.set('picked_lei', lei)
  return data
}
