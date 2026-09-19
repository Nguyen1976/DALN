/**
 * A user's public profile snapshot: what chat stores on each member row and
 * what services hand each other when they need a name and an avatar. Only
 * the user service owns these fields; everyone else keeps a copy.
 */
export interface MemberProfile {
  userId: string
  username: string
  fullName: string | null
  avatar: string | null
}
