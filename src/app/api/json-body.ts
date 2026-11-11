// Reads a JSON request body for routes that validate each field themselves. A body that is not valid
// JSON, or is valid JSON but not an object (null, a number, a list), reads as {} so the route answers
// with its own 400 ("... required") instead of failing on a property access.

export async function jsonObject(req: Request): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const v: unknown = await req.json()
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch { return {} }
}
