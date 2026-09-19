/**
 * The name to show for a person anywhere in the app: their full name, or
 * their username until they set one.
 */
export const displayNameOf = (person: {
  fullName?: string | null;
  username?: string | null;
}) => person.fullName || person.username || "";
