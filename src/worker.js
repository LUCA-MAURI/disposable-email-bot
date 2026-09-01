import PostalMime from 'postal-mime'
import { extractLinks, pickConfirmLinks, stripNavigationTags } from './links.js'

const MSG_TTL = 60 * 60 * 24 * 30 // a mail stays readable for 30 days
const SNIPPET = 700
const ALIAS_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789' // no l/o/0/1: they get misread
const ALIAS_LEN = 10

const rand = (n, alphabet) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}
const newAlias = () => rand(ALIAS_LEN, ALIAS_CHARS)
const newId = () => rand(24, 'abcdef0123456789') // 96 bits: the only key to a mail page

const esc = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- Telegram

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json()
    // Only Telegram's answer is logged, never the message we sent.
    if (!j.ok) console.error('telegram', method, JSON.stringify(j))
    return j
  })

const say = (env, text, extra = {}) =>
  tg(env, 'sendMessage', {
    chat_id: env.OWNER_ID,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  })

// ---------------------------------------------------------------- alias store

const getAlias = (env, local) => env.MAIL.get(`a:${local}`, 'json')

const listAliases = async (env) => {
  const { keys } = await env.MAIL.list({ prefix: 'a:' })
  const rows = await Promise.all(
    keys.map(async (k) => ({ local: k.name.slice(2), ...(await env.MAIL.get(k.name, 'json')) })),
  )
  return rows.sort((a, b) => (b.created || 0) - (a.created || 0))
}

const createAlias = async (env, label) => {
  const local = newAlias()
  await env.MAIL.put(`a:${local}`, JSON.stringify({ label: label || '', created: Date.now() }))
  return local
}

// ---------------------------------------------------------------- inbound mail

const onEmail = async (message, env) => {
  const local = (message.to || '').split('@')[0].toLowerCase()
  const alias = await getAlias(env, local)
  if (!alias) {
    // Catch-all, but not a sink: an address this bot never handed out is
    // refused at SMTP time, so random spam to the domain never gets stored.
    message.setReject('550 5.1.1 Unknown recipient')
    return
  }

  const mail = await PostalMime.parse(message.raw)
  const html = mail.html || ''
  const text = mail.text || ''
  const links = extractLinks(html, text)

  const id = newId()
  await env.MAIL.put(
    `m:${id}`,
    JSON.stringify({
      to: message.to,
      label: alias.label,
      from: mail.from?.address || message.from,
      fromName: mail.from?.name || '',
      subject: mail.subject || '(no subject)',
      date: mail.date || new Date().toISOString(),
      html,
      text,
      links,
      attachments: (mail.attachments || []).map((a) => a.filename).filter(Boolean),
    }),
    { expirationTtl: MSG_TTL },
  )

  const body = (text || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  const snippet = body.slice(0, SNIPPET) + (body.length > SNIPPET ? '…' : '')
  const tag = alias.label ? ` <i>[${esc(alias.label)}]</i>` : ''

  const head =
    `📬 <b>${esc(mail.subject || '(no subject)')}</b>\n` +
    `from: ${esc(mail.from?.name || '')} &lt;${esc(mail.from?.address || '')}&gt;\n` +
    `to: <code>${esc(message.to)}</code>${tag}\n\n` +
    `${esc(snippet)}`

  // Buttons never carry the raw link: they go through /r/<id>/<i>, which
  // redirects only to a link stored with this mail. Telegram would otherwise
  // reject some URLs, and long tracking links would not fit a button anyway.
  const buttons = pickConfirmLinks(links).map((l) => [
    { text: `✅ ${l.text.slice(0, 30) || 'Open link'}`, url: `${env.PUBLIC_BASE}/r/${id}/${l.i}` },
  ])
  buttons.push([{ text: '📄 Open full mail', url: `${env.PUBLIC_BASE}/m/${id}` }])

  await say(env, head, { reply_markup: { inline_keyboard: buttons } })
}

// ---------------------------------------------------------------- bot commands

const HELP = [
  '<b>Commands</b>',
  '/new [label] — a new random address',
  '/list — active addresses',
  '/del &lt;address&gt; — stop receiving on that address',
  '/help — this message',
].join('\n')

const onCommand = async (text, env) => {
  const [cmd, ...rest] = text.trim().split(/\s+/)
  const arg = rest.join(' ')

  switch (cmd.split('@')[0]) {
    case '/start':
    case '/help':
      return say(env, HELP)

    case '/new': {
      const local = await createAlias(env, arg)
      const addr = `${local}@${env.DOMAIN}`
      const tag = arg ? ` <i>[${esc(arg)}]</i>` : ''
      return say(env, `✅ New address${tag}\n\n<code>${addr}</code>\n\nTap to copy.`)
    }

    case '/list': {
      const rows = await listAliases(env)
      if (!rows.length) return say(env, 'No addresses yet. Create one with /new')
      const body = rows
        .map((r) => `<code>${r.local}@${env.DOMAIN}</code>${r.label ? ` — ${esc(r.label)}` : ''}`)
        .join('\n')
      return say(env, `<b>Active addresses (${rows.length})</b>\n\n${body}`)
    }

    case '/del': {
      const local = arg.split('@')[0].trim().toLowerCase()
      if (!local) return say(env, 'Usage: /del address')
      if (!(await getAlias(env, local))) return say(env, `No such address: <code>${esc(local)}</code>`)
      await env.MAIL.delete(`a:${local}`)
      return say(env, `🗑 Deleted <code>${esc(local)}@${env.DOMAIN}</code>. Mail to it will be refused.`)
    }

    default:
      return say(env, HELP)
  }
}

// ---------------------------------------------------------------- mail page

const page = (msg) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(msg.subject)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:16px/1.5 -apple-system,system-ui,sans-serif; }
  header { padding:14px 16px; border-bottom:1px solid #8884; position:sticky; top:0;
           background:Canvas; }
  h1 { font-size:17px; margin:0 0 6px; }
  .meta { font-size:13px; opacity:.7; }
  main { padding:16px; }
  main img { max-width:100%; height:auto; }
  pre { white-space:pre-wrap; word-wrap:break-word; font:inherit; }
</style>
</head><body>
<header>
  <h1>${esc(msg.subject)}</h1>
  <div class="meta">${esc(msg.fromName)} &lt;${esc(msg.from)}&gt; → ${esc(msg.to)}</div>
  ${msg.attachments?.length ? `<div class="meta">📎 ${msg.attachments.map(esc).join(', ')}</div>` : ''}
</header>
<main>${msg.html ? stripNavigationTags(msg.html) : `<pre>${esc(msg.text)}</pre>`}</main>
</body></html>`

const htmlResponse = (body, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The body is somebody else's HTML. Scripts, frames, objects and forms
      // are forbidden by policy; images and inline styles are allowed because
      // that is what makes the mail readable.
      'content-security-policy':
        "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https:; script-src 'none'; form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })

// ---------------------------------------------------------------- router

const onFetch = async (req, env) => {
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'POST' && path === '/tg') {
    if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 })
    }
    let update
    try {
      update = await req.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const msg = update.message || update.edited_message
    // The owner only. Anyone else who writes to the bot is acknowledged and ignored.
    if (msg?.text && String(msg.chat?.id) === String(env.OWNER_ID)) {
      await onCommand(msg.text, env)
    }
    return new Response('ok')
  }

  const view = path.match(/^\/m\/([a-f0-9]{24})$/)
  if (view) {
    const msg = await env.MAIL.get(`m:${view[1]}`, 'json')
    if (!msg) return htmlResponse('<h1>Mail not found or expired</h1>', 404)
    return htmlResponse(page(msg))
  }

  const redir = path.match(/^\/r\/([a-f0-9]{24})\/(\d+)$/)
  if (redir) {
    const msg = await env.MAIL.get(`m:${redir[1]}`, 'json')
    const link = msg?.links?.[Number(redir[2])]
    if (!link) return htmlResponse('<h1>Link not found or expired</h1>', 404)
    return Response.redirect(link.url, 302)
  }

  return new Response('not found', { status: 404 })
}

export default {
  email: onEmail,
  fetch: onFetch,
}
