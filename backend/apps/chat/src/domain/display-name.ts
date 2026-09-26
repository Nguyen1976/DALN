/**
 * The name to show for a person: their full name, or their username until
 * they set one. The frontend has the same rule, so a person reads the same
 * everywhere.
 */
export const displayNameOf = (person: {
  fullName?: string | null
  username?: string | null
}): string => person.fullName || person.username || ''
