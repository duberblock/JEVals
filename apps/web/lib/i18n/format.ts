// Minimal interpolation for dictionary templates like '{count} QUESTIONS DETECTED'.
export function fill(template: string, params: Record<string, string | number>): string {
  let result = template
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, String(value))
  }
  return result
}
