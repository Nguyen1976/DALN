import { channelsFrom } from './notification-types'

describe('channelsFrom', () => {
  const on = { IN_APP: true, EMAIL: true, REALTIME: true }
  const preference = (overrides = {}, global = { enabled: true, channels: on }) => ({
    global,
    overrides,
  })

  it('everything on: every channel', () => {
    expect(channelsFrom(preference(), 'FRIEND_REQUEST_SENT')).toEqual({
      inApp: true,
      realtime: true,
      email: true,
    })
  })

  it('a type switched off in app: neither stored nor pushed, mail untouched', () => {
    const pref = preference({ MENTIONED_IN_CONVERSATION: { ...on, IN_APP: false } })
    expect(channelsFrom(pref, 'MENTIONED_IN_CONVERSATION')).toEqual({
      inApp: false,
      realtime: false,
      email: true,
    })
    // Other types keep their channels.
    expect(channelsFrom(pref, 'FRIEND_REQUEST_SENT').inApp).toBe(true)
  })

  it('the master switch off: nothing at all', () => {
    expect(
      channelsFrom(
        preference({}, { enabled: false, channels: on }),
        'SYSTEM_NOTIFICATION',
      ),
    ).toEqual({ inApp: false, realtime: false, email: false })
  })
})
