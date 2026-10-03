# AIMeer Private mode — the on-device model, second attempt

**Status:** shipped 2026-10-03. Supersedes the "on-device tier retired" part of
`2026-10-02-aimeer-jev-decisions-design.md`; the cloud tier and Clef triage there are unchanged.

## Why bring it back

The owner wants a local, private option back. The first one (WebLLM, Llama 3.2 1B) failed for
three reasons, and this design answers each:

| First attempt | This design |
|---|---|
| ≈ 0.9 GB, downloaded automatically on every capable device | ≈ 259 MB (q4f16) / 297 MB (q4), only after the visitor switches Private mode on and accepts the stated size |
| The whole KB (≈ 2,300 tokens) in the prompt of a 1B model | Four retrieved KB lines plus the Identity line (≈ 400–700 tokens) |
| Every question generated, including salary and out-of-KB ones | Browser-side triage: salary → curated answer, nothing relevant in the KB → handoff, both without generating |
| Model output shown as-is | `cleanReply` drops sentences that name anything the facts don't, prompt talk and money; two sentences at most |
| WebLLM from a CDN (`esm.run`) | Transformers.js and ONNX Runtime vendored in `assets/vendor/transformers/` |

## Runtime: WebGPU, not WebGL, and not WASM

The request was "the lightest model that runs on a low-end device, as long as it has a GPU with
WebGL". No browser LLM runtime runs on WebGL: ONNX Runtime's WebGL backend is deprecated and
lacks the decoder ops, and WebLLM and MediaPipe are WebGPU-only. GPU inference in a browser means
**WebGPU**, which current Chrome, Edge (desktop and Android) and Safari 26 ship.

A CPU (WASM) fallback was built and tested, then removed. LFM2.5's 4-bit builds (q4, q4f16 and
the int8 "quantized" one) all quantize the embedding with `GatherBlockQuantized`, and ONNX Runtime
Web's WASM build has no CPU kernel for it. Session creation fails with "Could not find an
implementation for GatherBlockQuantized(1)". The only small build without it is LiquidAI's
`model_q4f32` at ≈ 480 MB, too heavy for the low-end devices a CPU path would be for. So the gate
(`evaluateGate`) refuses a browser without WebGPU and says so in the chat. If that changes
upstream, the WASM branch was about ten lines.

## Model: LFM2.5-350M

The candidates at the time, in Transformers.js ONNX form:

| Model | Download | Notes |
|---|---|---|
| **LFM2.5-350M** (Liquid AI) | 255 MB q4f16 / 294 MB q4 (+3.5 MB tokenizer) | Built for on-device use, IFEval ≈ 77, fast decode. English plus 8 other languages; **not Malay**. LFM Open License v1.0 (free for a personal site) |
| Gemma 3 270M | 273 MB q4f16 | 256k vocabulary makes it no smaller; ORT issue #26732 (fp16 overflow on WebGPU) |
| SmolLM2-360M | 273 MB q4f16 | Weaker at sticking to supplied facts |
| Qwen3-0.6B | 570 MB q4f16 | Speaks Malay, but over twice the download |

The owner chose LFM2.5-350M over Qwen3-0.6B, knowing Bahasa Melayu visitors get English answers
from it (they see a one-time note saying so).

## Architecture

```
chatbot.js ── switch, consent box, status, send() routing, handoff
   │  window.AIMEER_LOCAL  (aimeer-local-core.js, UMD, pure)
   │     evaluateGate · probeEnvironment · chunkKb · buildIndex · retrieve · triage
   │     buildMessages · cleanReply · factsOf
   └─ new Worker("aimeer-local-worker.js?v=…", {type: "module"})
         └─ import("assets/vendor/transformers/transformers.min.js")
               ├─ ort-wasm-simd-threaded.asyncify.{mjs,wasm}   (vendored; WebGPU EP inside)
               └─ weights: huggingface.co → Cache API "transformers-cache"
```

- **Send routing.** If Private mode is on, the model answers when ready and instant answers
  cover the warm-up; the Worker relay is never used. If it is off, the cloud answers; on a
  cloud failure, a model this browser already loaded answers next (25 s to get ready), then
  the instant tier. Every failure ends at the instant tier.
- **Consent.** Flipping the switch on shows the size for this GPU and "Download and turn on" /
  "Not now". A model already in the cache needs no second consent. Cancel terminates the
  Worker. The choice persists (`aimeer-private`), and a stored choice warms the model when the
  chat is opened, not at page load.
- **Privacy.** In Private mode the handoff summary is built locally (`mechanicalSummary`).
  The JD matcher stays cloud-only and keeps its own disclosure.
- **Failure.** A load error on q4f16 retries once on q4 (a GPU can advertise `shader-f16` and
  still fail on it). After that the box offers "Try again". The first token has 30 s.

## Retrieval, triage and grounding

`chunkKb` keeps one chunk per KB line or bullet. Each chunk carries its heading ("2015-2023 TRM
Nett Systems, Petaling Jaya: …"), and long lines split at sentence ends, then at semicolons,
into chunks of at most 420 characters. Sentence ends skip "Sdn. Bhd.", "Node.js" and
"CGPA 3.03". Headings, evidence labels, the privacy list and the JD-matcher line are skipped;
the model copied the JD-matcher line into an answer about years of experience.

`retrieve` is BM25 with a short stop list and two expansions. A Malay→English translation map
counts at full weight; it is how "Di mana beliau belajar?" finds UiTM. An English synonym map
counts at half weight, so a synonym alone rarely clears `MIN_SCORE` (1.6). "What's the weather
today" and "Does he know Kubernetes?" score nothing and go to the handoff.

`cleanReply(text, facts)` grounds each sentence against everything the model was shown. Any
capitalised word after the first, or any word with a digit or a dot, must occur in the facts,
or the sentence goes. A prompt-talk reply ("the provided context…") and a money figure empty
the reply, and the caller then falls back to the instant answer.

## Measured quality (2026-10-03)

The same weights (q4) ran through Transformers.js 4.3.0 on native CPU in Node, against fifteen
visitor questions with the real KB, retrieval and prompt. Each layout change was re-run on all
fifteen:

1. **Facts in the system turn, four chunks plus Identity**: the most natural and most accurate
   answers. It did invent at times: "React Query, GraphQL" on a React question, "liveaim.com"
   for retailaim.com, a prompt-talk refusal on TRM, and the JD-matcher line copied into an
   answer. The grounding filter, the prompt-talk check and skipping that line remove all four.
2. Facts and instruction moved into the user turn with "name only what the facts name": bare
   noun answers ("Flutter", "Web Application Developer"). Rejected.
3. Two chunks, no Identity line, "keep every name exactly as written": *more* invention, not
   less. Rejected, along with a word-overlap filter that dropped correct sentences.

So layout 1 shipped, with the guards. Answers after the guards, for example: "Yes, he has
experience with Flutter. He introduced Git company-wide and pioneered Flutter adoption in his
projects." / "He was born in Dungun, Terengganu." / "He has 12+ years of experience in software
delivery." What gets through is mostly generic lowercase phrasing ("strong expertise in
React"). A 350M model is a convenience tier, not a replacement for the cloud. The UI copy says
its answers are "shorter and simpler than the cloud's".

On the software WebGPU adapter in headless Chromium (SwiftShader, no f16, so q4) the model
loaded in 27 s and answered in about 150 s. That proves the GPU path end to end, but says
nothing about real speed; a real integrated GPU is one to two orders of magnitude faster. On
native CPU, answers took 1–5 s.

## Verification

- `tests/aimeer-local-core.test.js`: gate matrix, adapter probe, chunking of the real KB,
  retrieval (English and Malay), triage, prompt shape, `cleanReply`.
- `tests/chat-panel.test.js` (Private mode block): consent before any Worker, worker URL and
  load message, **zero relay requests** in Private mode (including the handoff summary),
  grounding in the real send path, the cached-model fallback when the cloud fails, and the
  no-WebGPU refusal.
- Manual: switch on in a WebGPU browser, watch the progress, then ask "Does he know Flutter?"
  and "What's his expected salary?" (the latter is the curated answer with no generation).
  Check DevTools → Network for no `workers.dev` requests. Reload and confirm no re-download.
