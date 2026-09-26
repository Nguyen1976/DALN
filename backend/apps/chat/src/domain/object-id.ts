/**
 * A Mongo ObjectId in hex. Ids that arrive from clients or other services
 * are checked before they reach Prisma, which answers a malformed one with an
 * infrastructure error (a 500) rather than "not found".
 */
export const isObjectId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
