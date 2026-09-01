# disposable-email-bot

[![check](https://github.com/LUCA-MAURI/disposable-email-bot/actions/workflows/check.yml/badge.svg)](https://github.com/LUCA-MAURI/disposable-email-bot/actions/workflows/check.yml)

**Disposable email addresses on your own domain, delivered to Telegram, with
no server to run.**

One Cloudflare Worker. Free tier. `/new` gives you an address; mail to it
arrives in Telegram seconds later with the confirmation link as a button.

---

## The problem

Every service wants an email address before it shows you anything, and every
address you give it is a subscription you did not ask for.

The public disposable-mail domains solve half of this. The other half is that
signup forms block them — a blocklist of `temp-mail`-style domains is a
standard component now — which is exactly the moment you needed one.

An address on **your** domain is on nobody's blocklist. Cloudflare Email
Routing receives mail for a domain for free, and can hand each message to a
Worker. The Worker is this repository.

## How it works

```
/new netflix       ->   k7m2q9x1a3@yourdomain.com
```

- **Receive.** The domain's catch-all sends every message to the Worker.
- **Refuse the rest.** An address the bot never handed out is rejected at
  SMTP time with `550`. The catch-all is not a spam sink, and nothing
  unrequested is ever stored.
- **Notify.** Sender, subject and a text preview land in Telegram.
- **Buttons** for the links that look like an action — confirm, verify,
  reset, activate — scored by wording, in English and Italian. Tap to open.
- **"Open full mail"** renders the original HTML, images included, under a
  Content-Security-Policy that forbids scripts, frames, objects and forms.
- Mail expires after 30 days. Addresses live until you `/del` them.

| Command | |
|---|---|
| `/new [label]` | a new random address; the label is a note for you (`/new netflix`) |
| `/list` | active addresses |
| `/del <address>` | stop receiving on it; mail to it is refused from then on |

The address stays random even with a label, so two services cannot correlate
your accounts through it.

## Setup

You need a domain on Cloudflare with Email Routing enabled, and a bot from
[@BotFather](https://t.me/BotFather).

1. Put your domain in `wrangler.toml`: `DOMAIN`, `PUBLIC_BASE`, and the
   route `pattern`. wrangler creates the DNS record and the certificate.
2. `npx wrangler login`
3. `BOT_TOKEN=... OWNER_ID=... ./setup.sh` — creates the KV namespace,
   uploads the three secrets, deploys, registers the Telegram webhook.
   `OWNER_ID` is your chat id: send `/start` to the bot, then read
   `message.chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. In the Cloudflare dashboard, the one step that has no CLI:
   **Email → Email Routing → Catch-all → Send to a Worker →
   disposable-email-bot**.

Then `/new` in Telegram.

Later changes: `npm run deploy`. Live logs: `npm run tail`. To look at the
stored data use `--remote`, or wrangler shows you a local, empty namespace and
lets you believe nothing works:

```bash
npx wrangler kv key list --namespace-id <id from wrangler.toml> --remote
```

## Security

The Worker sits between the whole internet's mail and your phone, so it is
built around three things it does not trust: the mail, the web, and whoever
else finds the bot.

- **Third-party HTML is rendered under a no-script policy.** `script-src
  'none'`, no frames, no objects, no forms, `frame-ancestors 'none'`,
  `referrer-policy: no-referrer`. What CSP cannot stop is stripped before
  rendering: a `<meta http-equiv="refresh">` that would navigate you away,
  and a `<base>` that would rewrite every link. Inline styles and images are
  allowed, because that is what makes a mail readable — which also means a
  tracking pixel fires when you open the full page. The Telegram preview
  does not load anything.
- **Buttons never carry a raw link.** They go through `/r/<id>/<i>`, which
  redirects only to a link that was extracted from that mail when it
  arrived. There is no open redirect: the target has to already be in the
  store.
- **Only you can drive the bot.** The webhook is authenticated by a secret
  token in a header; anything else posting to it gets `403`. Commands are
  acted on only when the chat id is `OWNER_ID`; anyone else who writes to
  the bot is acknowledged and ignored.
- **Unknown recipients are refused, not bounced.** A `550` at SMTP time
  stores nothing, sends nothing, and does not confirm to a sender that the
  domain is alive and forwarding.
- **A mail page is a 96-bit random URL** that expires with the mail. Anyone
  holding the link can read it; do not forward the link if you would not
  forward the mail.
- **Secrets are Cloudflare secrets**, uploaded by `setup.sh` and never
  written to a file in this repository. The Worker logs Telegram's API
  errors only, never a message body.

Cloudflare Email Routing performs its own spam and authentication checks
before a message reaches the Worker; nothing here re-verifies SPF or DKIM.
See [SECURITY.md](SECURITY.md).

## Verify it yourself

```bash
./check.sh
```

| Tool | What it covers |
|---|---|
| `node --check` | every file parses |
| `node --test` | link extraction, button scoring, the tag stripping |
| eslint | lint, latent bugs |
| semgrep | dataflow analysis, `p/javascript` + `p/security-audit` |
| gitleaks | credentials, in the tree and in the history |
| shellcheck | the shell scripts |

Current status: **ALL CLEAR** on every one of them. A tool that is not
installed is skipped and counted, never called a pass; the final line only
says `ALL CLEAR` when every tool actually ran. CI runs the same script in
strict mode on every push and weekly.

## What it deliberately does not do

- **No sending.** Receive-only. Replying from a throwaway address is a
  different product with a reputation to manage.
- **No attachments.** The filename is shown; the file is not stored. KV is
  not a file store, and an attachment from a stranger is not something to
  open on a phone.
- **No multi-user.** One owner, one chat. Sharing a domain of disposable
  addresses between people is an access-control problem this does not have.
- **No inbox.** Thirty days, then gone. If you needed to keep it, it was not
  disposable.

## Related

- [flyover-alert](https://github.com/LUCA-MAURI/flyover-alert) — another
  single-purpose Telegram bot, this one polling instead of receiving.
- [job-watchdog](https://github.com/LUCA-MAURI/job-watchdog) — for the bots
  that run on a machine and can quietly stop.

MIT licensed. In production on my own domain since July 2026.
