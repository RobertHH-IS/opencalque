/**
 * Properties the schema does not know, kept. A drawing saved by a newer version of the app may
 * carry properties this version has never heard of; reading it and saving it again must not lose
 * them. Zod drops what it does not know, so what it drops is put back after it has checked the
 * rest. The same comparison tells a script or an assistant which of the properties it wrote mean
 * nothing here.
 */

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `parsed` (what the schema made of `input`) with whatever the schema dropped from `input` put back, at any depth. */
export function keepUnknown<T>(input: unknown, parsed: T): T {
  if (isPlain(input) && isPlain(parsed)) {
    const out: Record<string, unknown> = { ...parsed }
    for (const [key, value] of Object.entries(input)) {
      // Never a key that would change what the object is rather than what it holds.
      if (key === '__proto__') continue
      if (Object.hasOwn(parsed, key)) out[key] = keepUnknown(value, parsed[key])
      else if (value !== undefined) out[key] = value
    }
    return out as T
  }
  if (Array.isArray(input) && Array.isArray(parsed) && input.length === parsed.length) return parsed.map((item, i) => keepUnknown(input[i], item)) as T
  return parsed
}

/** Where `input` holds properties that the schema dropped from it, as paths such as "style.colour". */
export function unknownKeys(input: unknown, parsed: unknown, path = ''): string[] {
  const at = (key: string | number) => (path === '' ? String(key) : typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`)
  if (isPlain(input) && isPlain(parsed)) {
    return Object.entries(input).flatMap(([key, value]) => (Object.hasOwn(parsed, key) ? unknownKeys(value, parsed[key], at(key)) : value === undefined ? [] : [at(key)]))
  }
  if (Array.isArray(input) && Array.isArray(parsed) && input.length === parsed.length) return input.flatMap((item, i) => unknownKeys(item, parsed[i], at(i)))
  return []
}
