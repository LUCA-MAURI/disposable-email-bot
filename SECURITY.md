# Security

## Reporting

Open a GitHub issue. Do not include a real credential in it - describe the
shape of the problem instead. If a finding is sensitive, say so in the issue
without the details and I will follow up privately.

## Threat model

The Worker receives mail from anyone, serves pages to anyone with a link,
and takes commands from a Telegram webhook. Three untrusted inputs, one
owner.

1. **Hostile mail content.** Rendered only under a Content-Security-Policy
   with `script-src 'none'`, no frames, objects or forms, no referrer, and
   `frame-ancestors 'none'`. `<meta>` and `<base>` tags are stripped first,
   because a policy cannot stop a `meta refresh` from navigating the viewer
   or a `base` from rewriting links. Images are allowed on purpose: a mail
   without them is unreadable, and the cost is that a tracking pixel fires
   when the full page is opened. The Telegram notification loads nothing.
   Subject, sender and preview are HTML-escaped before they become Telegram
   markup.
2. **The redirect endpoint.** `/r/<id>/<i>` redirects only to a link stored
   with that mail at receive time. It cannot be pointed anywhere else.
3. **Unauthorised commands.** The webhook path requires Telegram's secret
   token header; commands are executed only from the owner's chat id. Both
   values are Worker secrets. Malformed webhook bodies get `400`, not a
   stack trace.
4. **The catch-all as a spam sink.** An address the bot did not generate is
   refused at SMTP time with `550`. Nothing is stored, no bounce is
   generated, and the sender learns nothing beyond "no such user".
5. **Mail pages are public URLs.** The id is 96 random bits and the page
   expires with the mail after 30 days. There is no login: possession of
   the link is access. Do not share a link you would not share the mail
   with.
6. **Secrets.** `BOT_TOKEN`, `OWNER_ID` and `WEBHOOK_SECRET` live in
   Cloudflare, uploaded by `setup.sh`. The repository contains placeholders
   only, `.dev.vars` is git-ignored, and CI runs gitleaks over the full
   history on every push.

## What is explicitly out of scope

- Sender authentication. Cloudflare Email Routing applies its own SPF, DKIM
  and spam checks before a Worker sees the message; this code does not
  re-verify them, so a sender address is what the mail claims it is.
- Attachments. Filenames are shown, contents are never stored.
- The security of your Cloudflare and Telegram accounts.
- Multi-tenant use. One owner.

## Please do not

Do not put the bot token or the webhook secret in `wrangler.toml` under
`[vars]`. Those are public in every deploy log. `wrangler secret put` exists
for that reason, and `setup.sh` uses it.
