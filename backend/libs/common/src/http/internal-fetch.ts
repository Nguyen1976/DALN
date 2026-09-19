/**
 * Service-to-service HTTP. The callee's endpoint is `@InternalOnly()`, so the
 * shared `x-internal-token` goes along; the caller gets the endpoint's result
 * as the body it is, typed.
 */

export class InternalCallError extends Error {
  constructor(
    /** HTTP status, or null when the service could not be reached at all. */
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'InternalCallError'
  }
}

export async function internalFetch<T>(
  url: string,
  {
    method = 'GET',
    body,
    timeoutMs = 5000,
  }: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        'x-internal-token': process.env.INTERNAL_API_TOKEN ?? '',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new InternalCallError(
      null,
      `${method} ${url} unreachable: ${String(error)}`,
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new InternalCallError(
      res.status,
      `${method} ${url} → ${res.status} ${text.slice(0, 200)}`,
    )
  }

  // An endpoint that returns nothing answers with an empty body.
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Base URL of another service: env override, else its docker compose name. */
export function serviceUrl(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim().replace(/\/+$/, '') || fallback
}
