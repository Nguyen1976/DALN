/**
 * Qdrant: local Docker (QDRANT_HOST/PORT) or managed cloud (QDRANT_URL + QDRANT_API_KEY).
 */
export function getQdrantClientParams(): {
  url?: string
  apiKey?: string
  host?: string
  port?: number
} {
  const url = process.env.QDRANT_URL?.trim()
  const apiKey = process.env.QDRANT_API_KEY?.trim()

  if (url) {
    return apiKey ? { url, apiKey } : { url }
  }

  return {
    host: process.env.QDRANT_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.QDRANT_PORT || 6333),
  }
}
