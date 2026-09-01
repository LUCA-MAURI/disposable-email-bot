import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLinks, pickConfirmLinks, stripNavigationTags } from '../src/links.js'

test('extracts html links, deduplicates, decodes entities, drops non-http', () => {
  const html = `
    <a href="https://x.io/confirm?t=1&amp;u=2">Confirm your email</a>
    <a href="https://x.io/confirm?t=1&amp;u=2">duplicate</a>
    <a href="https://x.io/unsubscribe">Unsubscribe</a>
    <a href="mailto:a@b.c">write to us</a>
    <a href="javascript:alert(1)">click</a>`
  const links = extractLinks(html)
  assert.equal(links.length, 2)
  assert.equal(links[0].url, 'https://x.io/confirm?t=1&u=2')
  assert.equal(links[0].text, 'Confirm your email')
})

test('buttons only for action links, ordered by score', () => {
  const html = `
    <a href="https://x.io/home">Home</a>
    <a href="https://x.io/privacy">Privacy</a>
    <a href="https://x.io/verify/abc">Verify your account</a>
    <a href="https://x.io/reset-password">Reset password</a>`
  const picked = pickConfirmLinks(extractLinks(html))
  assert.deepEqual(picked.map((l) => l.url), [
    'https://x.io/reset-password', // reset + password = 2
    'https://x.io/verify/abc',     // verify = 1
  ])
  // indices still point into the full array: /r/<id>/<i> relies on that
  assert.equal(extractLinks(html)[picked[0].i].url, 'https://x.io/reset-password')
})

test('plain-text mail: collects bare urls', () => {
  const links = extractLinks('', 'Click here to activate: https://x.io/activate/9 thanks')
  assert.equal(links.length, 1)
  assert.equal(links[0].url, 'https://x.io/activate/9')
  assert.equal(pickConfirmLinks(links).length, 1)
})

test('meta refresh and base are stripped before rendering, content is kept', () => {
  const html = `<html><head><META HTTP-EQUIV="refresh" content="0;url=https://evil.example">
    <base href="https://evil.example/"></head><body><p>hello</p><img src="https://x.io/a.png"></body></html>`
  const out = stripNavigationTags(html)
  assert.ok(!/<meta/i.test(out) && !/<base/i.test(out))
  assert.ok(out.includes('<p>hello</p>') && out.includes('<img src="https://x.io/a.png">'))
})
