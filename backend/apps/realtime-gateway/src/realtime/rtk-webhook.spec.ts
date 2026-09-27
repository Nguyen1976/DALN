// rtk-webhook.spec.ts
import { createSign, generateKeyPairSync } from 'crypto'
import {
  parseRtkEvent,
  RtkWebhookVerifier,
  toPem,
  verifyRtkSignature,
} from './rtk-webhook'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherPem = other.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()

const sign = (body: string) => {
  const signer = createSign('RSA-SHA256')
  signer.update(body)
  signer.end()
  return signer.sign(privateKey, 'base64')
}

const keyReply = (key: string) => ({
  ok: true,
  status: 200,
  text: () => Promise.resolve(JSON.stringify({ data: { publicKey: key } })),
})

describe('rtk-webhook', () => {
  const body = JSON.stringify({
    event: 'meeting.started',
    meeting: { id: 'm1' },
  })

  it('chữ ký đúng -> true; sai body / sai khoá / thiếu chữ ký -> false', () => {
    const sig = sign(body)
    expect(verifyRtkSignature(body, sig, pem)).toBe(true)
    expect(verifyRtkSignature(body + ' ', sig, pem)).toBe(false)
    expect(verifyRtkSignature(body, sig, otherPem)).toBe(false)
    expect(verifyRtkSignature(body, undefined, pem)).toBe(false)
    expect(verifyRtkSignature(body, 'rác', pem)).toBe(false)
  })

  it('toPem: giữ nguyên PEM, bọc base64 trần thành PEM', () => {
    expect(toPem(pem)).toBe(pem)
    const bare = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    expect(verifyRtkSignature(body, sign(body), toPem(bare))).toBe(true)
  })

  it('parseRtkEvent lấy event, meeting.id, customParticipantId', () => {
    expect(
      parseRtkEvent(
        JSON.stringify({
          event: 'meeting.participantJoined',
          meeting: { id: 'm1' },
          participant: { customParticipantId: 'u1.aa' },
        }),
      ),
    ).toEqual({
      event: 'meeting.participantJoined',
      meetingId: 'm1',
      customParticipantId: 'u1.aa',
    })
    expect(parseRtkEvent('không phải json')).toBeNull()
    expect(parseRtkEvent(JSON.stringify({ event: 'x' }))).toBeNull()
  })

  it('verifier: cache khoá; sai thì tải lại đúng một lần', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(keyReply(otherPem))
      .mockResolvedValueOnce(keyReply(pem))
    const verifier = new RtkWebhookVerifier(fetchMock)

    expect(await verifier.verify(body, sign(body))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Khoá mới đã được cache: lần sau không tải nữa.
    expect(await verifier.verify(body, sign(body))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('verifier: không tải được khoá -> false, không nổ', async () => {
    const verifier = new RtkWebhookVerifier(
      jest.fn().mockRejectedValue(new Error('offline')),
    )
    expect(await verifier.verify(body, sign(body))).toBe(false)
  })
})
