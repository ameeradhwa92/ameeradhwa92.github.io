# AIMeer cloud relay

`aimeer-worker.js` is a Cloudflare Worker and AIMeer's only AI tier (the
on-device WebLLM tier was retired in 2026-10). It runs two models on the one
**Workers AI** binding: TypeSafe's **Jev** makes typed decisions (chat triage,
recruiter match levels and evidence) and Meta **Llama 3.1 8B** writes text
(chat answers, summaries, the JD narrative). No API key is stored anywhere, and
the Worker only answers requests coming from the portfolio site.

## One-time setup (~10 minutes, free, no credit card)

1. **Create a Cloudflare account** at <https://dash.cloudflare.com/sign-up>
   (email + password; verify the email).
2. In the dashboard sidebar choose **Compute (Workers)** → **Create** →
   **Start with Hello World** → name it `aimeer-ai` → **Deploy**.
3. Click **Edit code**, delete the sample, paste the entire contents of
   `aimeer-worker.js`, then **Deploy**.
4. Go to the Worker's **Settings → Bindings → Add binding → Workers AI**,
   set the variable name to `AI`, save, and **Deploy** again.
5. Copy the Worker URL shown on its overview page, e.g.
   `https://aimeer-ai.<your-subdomain>.workers.dev`.
6. Paste that URL into `CLOUD_ENDPOINT` in `assets/js/chatbot.js`, commit, push.

## Manual redeploy reminder for Worker source changes

`cloud/aimeer-worker.js` is a source-of-truth copy for the repository, but the
live Worker is still updated manually in the Cloudflare dashboard editor. This
means any change to the Worker file here — including the bounded `jd-reasoning`
mode for recruiter reasoning — is **not live** until you:

1. Open the Worker in the Cloudflare dashboard.
2. Replace the dashboard editor contents with the latest `cloud/aimeer-worker.js`.
3. Confirm the **Workers AI** binding named exactly `AI` is still present.
4. Click **Deploy**.
5. **Confirm the deploy actually landed** (see below) before smoke-testing anything.

### Always confirm which revision is live

A paste that does not take effect — editor not saved, Deploy not clicked, a stale
copy pasted — looks exactly like a fix that did not work. That mistake cost
several rounds of debugging: the same failures kept reappearing because the code
under test was never the code deployed.

`WORKER_REVISION` at the top of `aimeer-worker.js` is bumped on every change that
gets pasted. Ask the live endpoint which one it is running:

```bash
curl -s -X POST https://aimeer-ai.<your-subdomain>.workers.dev/ \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://ameeradhwa92.github.io' \
  -d '{"mode":"version"}'
# {"revision":"2026-10-02-jev-1","aiBinding":true}
```

If `revision` does not match the constant in the file you just pasted, the deploy
did not land — fix that before reading anything into the behaviour. `aiBinding`
reports whether the `AI` binding is still attached, and the version probe costs no
Workers AI call. Every `jd-scoring` / `jd-reasoning` response carries the same
`revision`, so a failure reason can always be read against the code that produced
it.

Then confirm Jev itself answers, and which catalogue id did (the Worker tries
`@cf/typesafe/jev`, then `typesafe/jev`, and remembers the first that runs):

```bash
curl -s -X POST https://aimeer-ai.<your-subdomain>.workers.dev/ \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://ameeradhwa92.github.io' \
  -d '{"mode":"jev-probe"}'
# {"revision":"2026-10-02-jev-1","ok":true,"model":"@cf/typesafe/jev","reason":"","urgent":0.93}
```

`ok:false` with `reason: jev-run-failed:...` means Jev is not reachable from this
account's binding — check the model is listed under Workers AI → Models. Nothing
breaks meanwhile: chat answers untriaged and the JD matcher falls back to
`jd-scoring`. `jev-shape-invalid` means Jev answered in a shape `readJevAnswers`
does not recognise; log the raw output and widen that reader.

Suggested smoke tests after a manual redeploy:

- `chat` mode still returns a normal AIMeer reply.
- `summary` mode still returns a short summary.
- `jd-explanation` mode still explains a deterministic result without changing
  the score.
- `jd-reasoning` accepts a bounded valid payload and returns structured JSON
  reasoning, while invalid payloads return safe error codes.
- `jd-scoring` accepts the same payload plus the JD prose and returns an
  `overall` block. The site's fallback when `jd-decide` fails.
- `jd-decide` accepts the same payload and returns the same shape with
  `"engine":"jev"` and a per-requirement `probability`. This is the mode the
  live site tries first for every match report.
- `chat` with a salary question returns `{"reply":"","action":"salary"}`.

## `jd-decide`: Jev decisions, one call

Jev does not generate text. It reads a state and answers named typed questions —
`choice` (one label from a fixed set, with a probability per label), `score` (a
probability-weighted level on an ordered rubric) and `noul` (a yes/no probability).
`jd-decide` sends one Jev request: the JD prose, the requirements and every citable
evidence record as state, then per requirement a `level_i` choice over the seven
match levels and an `evidence_i` choice over the evidence ids plus `none`, and one
`overall_fit` score on a four-level rubric (mapped to 30/50/67/85 so a fractional
answer lands inside the right fit band).

Because a choice answer can only be one of the labels offered, the failures
`jd-scoring` has to tolerate after the fact — invented match levels, invented
evidence ids, missing fields, truncated JSON — cannot happen. The Worker still
applies the browser validator's provenance rules before relaying (an evidence-based
level must cite a compatible record above probability 0.15, otherwise it is demoted,
and a demoted decision is never reported as confident). Per-requirement copy is
templated in English and Bahasa Melayu; Llama writes only the narrative, as plain
text, from the decisions — and a narrative that looks like JSON, markup or a
percentage of its own is replaced by a templated one.

A `502 {"error":"decide-unavailable","stage":"jev"|"decide","reason":...}` is
expected while Jev is unavailable; the browser then runs the `jd-scoring` flow
below unchanged.

## Chat triage

Before the LLM answers a chat message, Jev answers two questions about it: what it
is about (`intent`, a choice) and whether `aimeer-kb.txt` can answer it
(`answerable`, a noul). Only strong signals act: compensation at ≥ 0.6 returns
`action: "salary"` and a confidently unanswerable question (< 0.2, greetings
exempt) returns `action: "handoff"` — both with an empty reply and **no LLM
call**, so nothing is generated that could quote a number or invent a fact. A
job-match intent returns `action: "jd"` alongside the answer, and the browser
offers the JD matcher. Triage is capped at 2.5 s; a slow or failed Jev leaves
chat exactly as it was before Jev.

## `jd-scoring` runs two model calls

It is worth knowing before you read a failure. `jd-scoring` calls Workers AI twice
and composes the answer:

1. **Per-requirement reasoning** — reuses the `jd-reasoning` prompt and message
   verbatim, with no JD prose. Produces the narrative and the requirements array.
2. **Overall score** — the full JD prose plus a three-key schema
   (`score`, `fitBand`, `narrative`). No requirement ids, nothing else to get wrong.

This is load-bearing, not an optimization. A single call failed every live request
across six revisions — invented requirement ids, then ids under other field names,
then missing prose fields — while `jd-reasoning`, identical apart from carrying no
JD prose, succeeded every time. An 8B model cannot hold a whole job description and
a ten-field-per-requirement contract at once. Each `502` names which call broke via
its `stage` field.

Budget note: two calls per analysis instead of one, against 10,000 neurons/day.
`jd-decide` is also two calls (one Jev, one short Llama narrative), and chat adds
one Jev triage call per message; check the Workers AI dashboard for what Jev costs
in neurons on this account.

## Diagnosing a `reasoning-invalid` 502

`jd-scoring` and `jd-reasoning` reject a model response that breaks the output
schema, and both return `502 {"error": "reasoning-invalid", "reason": "..."}`.
`stage` says which call broke (`reasoning` or `overall`). `reason` names the rule:
`capability-invalid`, `match-level-invalid:strong`,
`overall-fitband-invalid:excellent`, `requirements-invalid:got=0,want=10,keys=...`,
`score-field-invalid:<context>:<key>`, and so on. Model-supplied fragments inside a
reason (key names, rejected enum values) are stripped to `[A-Za-z0-9_.-]` and clipped
to 40 characters, so a reason never carries model prose.

`json-invalid` adds a structural fingerprint — `json-invalid:len=3784:opens-obj:unterminated`
means the response ran out of tokens mid-object (raise the cap), while
`json-invalid:len=210:leads-prose:no-obj` means it answered in prose (a prompt problem).
Those have opposite fixes, which is why the bare code was not enough.

The browser folds the reason into a `console.warn` line — `JD scoring fallback:
Error: cloud-502:capability-invalid` — and never renders it. A visitor still sees
the labeled keyword estimate. So: open DevTools, paste a JD, and read the reason
rather than guessing which rule the 8B model broke.

## Free-tier limits

- Workers: 100,000 requests/day.
- Workers AI: 10,000 neurons/day — roughly a few hundred chat replies. If the
  daily quota runs out, AIMeer silently falls back to instant keyword answers.

## How abuse is prevented without an API key

- The AI model runs on the Worker's own `AI` binding — there is no secret to
  leak in the public GitHub repo.
- Only browser requests with an `Origin` of `ameeradhwa92.github.io` (or
  localhost for previews) are served.
- The system prompt (persona + `assets/data/aimeer-kb.txt`) is assembled
  server-side, so the endpoint can't be hijacked as a general-purpose LLM
  proxy; visitor input is capped at 10 messages × 600 characters.
