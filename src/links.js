// Helpers for mail bodies: which links are "the thing to click", and what
// must be stripped before third-party HTML is rendered in a page of ours.

const A_TAG = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
const BARE_URL = /https?:\/\/[^\s<>"')]+/gi

// English and Italian. Add your language: the scoring is a plain word count.
const ACTION_WORDS = [
  'confirm', 'conferma', 'confermare', 'verify', 'verifica', 'verificare',
  'activate', 'attiva', 'attivare', 'validate', 'convalida',
  'reset', 'password', 'magic', 'login', 'log-in', 'sign-in', 'signin',
  'token', 'invite', 'invito', 'accept', 'accetta', 'unlock', 'complete',
  'authorize', 'autorizza', 'set-up', 'onboard', 'click', 'clicca',
]

const NOISE_WORDS = [
  'unsubscribe', 'disiscriv', 'privacy', 'terms', 'termini', 'cookie',
  'preferences', 'preferenze', 'twitter.com', 'facebook.com', 'instagram.com',
  'linkedin.com', 'youtube.com', 'tiktok.com', 'apps.apple.com', 'play.google.com',
  'view-in-browser', 'webversion', 'browser',
]

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()

const decodeEntities = (s) =>
  s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
   .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")

const score = (url, text) => {
  const hay = `${url} ${text}`.toLowerCase()
  if (NOISE_WORDS.some((w) => hay.includes(w))) return -1
  return ACTION_WORDS.reduce((n, w) => (hay.includes(w) ? n + 1 : n), 0)
}

/** @returns {{url: string, text: string, score: number}[]} unique links, in original order */
export const extractLinks = (html = '', text = '') => {
  const seen = new Map()

  const add = (rawUrl, rawText) => {
    const url = decodeEntities(rawUrl).trim()
    if (!/^https?:\/\//i.test(url)) return
    if (seen.has(url)) return
    const label = stripTags(decodeEntities(rawText || '')).slice(0, 60) || url
    seen.set(url, { url, text: label, score: score(url, label) })
  }

  for (const m of html.matchAll(A_TAG)) add(m[1], m[2])
  if (!html) for (const m of text.matchAll(BARE_URL)) add(m[0], '')

  return [...seen.values()]
}

/** The links that look like an action to take (confirm, verify, reset...). At most `max`. */
export const pickConfirmLinks = (links, max = 3) =>
  links
    .map((l, i) => ({ ...l, i }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)

/**
 * Remove what a Content-Security-Policy cannot: <meta> and <base>. A mail
 * carrying `<meta http-equiv="refresh" content="0;url=...">` would otherwise
 * navigate whoever opens it, and a <base> would rewrite every relative URL.
 * Scripts, frames, objects and forms are handled by the CSP header instead.
 */
export const stripNavigationTags = (html = '') =>
  html.replace(/<\s*\/?\s*(meta|base)\b[^>]*>/gi, '')
