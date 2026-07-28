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
5. Smoke-test the live endpoint from an allowed origin after deployment.

Suggested smoke tests after a manual redeploy:

- `chat` mode still returns a normal AIMeer reply.
- `summary` mode still returns a short summary.
- `jd-explanation` mode still explains a deterministic result without changing
  the score.
- `jd-reasoning` accepts a bounded valid payload and returns structured JSON
  reasoning, while invalid payloads return safe error codes.

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
