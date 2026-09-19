/**
 * Every kind of notification there is. The same names are stored on the
 * rows, sent to clients and used as the keys of the per-type settings, so a
 * switch in settings always matches something that can actually be sent.
 */
export const NOTIFICATION_TYPES = [
  'FRIEND_REQUEST_SENT',
  'FRIEND_REQUEST_ACCEPTED',
  'FRIEND_REQUEST_REJECTED',
  'MENTIONED_IN_CONVERSATION',
  'SYSTEM_NOTIFICATION',
] as const

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number]

export type NotificationChannelToggle = {
  IN_APP: boolean
  EMAIL: boolean
  REALTIME: boolean
}

/** Where one notification may go, given the recipient's settings. */
export interface Channels {
  /** Stored, so it shows in the bell. */
  inApp: boolean
  /** Pushed to an open app; there is nothing to push without the stored row. */
  realtime: boolean
  email: boolean
}

/**
 * The master switch, the channel's own switch and the switch for this type
 * all have to be on.
 */
export function channelsFrom(
  preference: {
    global: { enabled: boolean; channels: NotificationChannelToggle }
    overrides: Partial<Record<string, Partial<NotificationChannelToggle>>>
  },
  type: NotificationTypeName,
): Channels {
  const on = (channel: keyof NotificationChannelToggle) =>
    preference.global.enabled &&
    preference.global.channels[channel] &&
    preference.overrides[type]?.[channel] !== false
  const inApp = on('IN_APP')
  return { inApp, realtime: inApp && on('REALTIME'), email: on('EMAIL') }
}
