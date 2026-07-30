# AIMeer cloud relay

`aimeer-worker.js` is a Cloudflare Worker that gives AIMeer real AI answers on
devices that can't run the on-device WebLLM model (iPhones/iPads, browsers
without WebGPU, low-memory GPUs). It runs Meta Llama 3.1 8B on **Workers AI**,
entirely inside Cloudflare's free tier — no API key is stored anywhere, and the
Worker only answers requests coming from the portfolio site.

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
# {"revision":"2026-07-30-jd-6","aiBinding":true}
```

If `revision` does not match the constant in the file you just pasted, the deploy
did not land — fix that before reading anything into the behaviour. `aiBinding`
reports whether the `AI` binding is still attached, and the version probe costs no
Workers AI call. Every `jd-scoring` / `jd-reasoning` response carries the same
`revision`, so a failure reason can always be read against the code that produced
it.

Suggested smoke tests after a manual redeploy:

- `chat` mode still returns a normal AIMeer reply.
- `summary` mode still returns a short summary.
- `jd-explanation` mode still explains a deterministic result without changing
  the score.
- `jd-reasoning` accepts a bounded valid payload and returns structured JSON
  reasoning, while invalid payloads return safe error codes.
- `jd-scoring` accepts the same payload plus the JD prose and returns an
  `overall` block. This is the mode the live site uses for every match report.

## Diagnosing a `reasoning-invalid` 502

`jd-scoring` and `jd-reasoning` reject a model response that breaks the output
schema, and both return `502 {"error": "reasoning-invalid", "reason": "..."}`.
The `reason` names the rule that failed — `json-invalid`, `match-level-invalid`,
`evidence-invalid`, `capability-invalid`, `requirements-invalid`,
`overall-fitband-invalid`, `unknown-key-invalid:<context>:<key>`, and so on. It
is always a fixed code (the key name in the last of those is stripped to
`[A-Za-z0-9_.-]` and clipped to 40 characters), never an echo of model prose.

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
