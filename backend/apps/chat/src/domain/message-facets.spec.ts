import { facetsOf } from './message-facets'

describe('facetsOf', () => {
  it.each([
    [
      'plain text',
      'TEXT',
      [],
      'chào',
      { hasMedia: false, hasFile: false, hasLink: false },
    ],
    [
      'http link',
      'TEXT',
      [],
      'xem http://a.vn',
      { hasMedia: false, hasFile: false, hasLink: true },
    ],
    [
      'https link',
      'TEXT',
      [],
      'https://a.vn/x',
      { hasMedia: false, hasFile: false, hasLink: true },
    ],
    [
      'www link',
      'TEXT',
      [],
      'vào www.a.vn nhé',
      { hasMedia: false, hasFile: false, hasLink: true },
    ],
    [
      'image with caption',
      'IMAGE',
      ['IMAGE'],
      'ảnh nè',
      { hasMedia: true, hasFile: false, hasLink: false },
    ],
    [
      'video',
      'VIDEO',
      ['VIDEO'],
      null,
      { hasMedia: true, hasFile: false, hasLink: false },
    ],
    [
      'file',
      'FILE',
      ['FILE'],
      null,
      { hasMedia: false, hasFile: true, hasLink: false },
    ],
    [
      'image and document together',
      'FILE',
      ['IMAGE', 'FILE'],
      null,
      { hasMedia: true, hasFile: true, hasLink: false },
    ],
    [
      'legacy image type without media rows',
      'IMAGE',
      [],
      null,
      { hasMedia: true, hasFile: false, hasLink: false },
    ],
    [
      'no content at all',
      'TEXT',
      [],
      null,
      { hasMedia: false, hasFile: false, hasLink: false },
    ],
  ] as const)('%s', (_label, type, kinds, content, expected) => {
    expect(facetsOf(type, kinds, content)).toEqual(expected)
  })
})
