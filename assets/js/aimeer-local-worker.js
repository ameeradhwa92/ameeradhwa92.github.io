/* AIMeer Private mode — the model runner. A module Worker, so tokenizing, the
   WebGPU dispatches and the decode loop never stall the page's scroll and motion.
   chatbot.js owns everything else (gate, retrieval, triage, prompt, clean-up, UI);
   this file only loads Transformers.js and runs text generation.

   Messages in:  {type: "load", libUrl, wasmBase, model, device, dtype}
                 {type: "generate", id, messages, options}
                 {type: "abort"}
   Messages out: {type: "progress", loaded, total}
                 {type: "ready", device, dtype}
                 {type: "token", id, text}
                 {type: "done", id, text}
                 {type: "error", stage, message, id?}

   Transformers.js and the ONNX Runtime WASM files are vendored (assets/vendor/transformers/,
   unversioned like three.js); the model weights come from Hugging Face on first use and
   live in the Cache API after that, so a second visit loads from disk. */
let lib = null;
let generator = null;
let stopper = null;

function post(message) { self.postMessage(message); }
function messageOf(err) { return err && err.message ? err.message : String(err); }

async function load(msg) {
  lib = lib || await import(msg.libUrl);
  const env = lib.env;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  /* The maths runs on WebGPU; the WASM runtime around it still does the CPU-side work.
     GitHub Pages cannot send COOP/COEP, so the page is never cross-origin isolated and
     WASM runs one thread; ask for more only when isolation is really there. */
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    : 1;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: msg.wasmBase + "ort-wasm-simd-threaded.asyncify.mjs",
    wasm: msg.wasmBase + "ort-wasm-simd-threaded.asyncify.wasm"
  };

  let last = 0;
  generator = await lib.pipeline("text-generation", msg.model, {
    device: msg.device,
    dtype: msg.dtype,
    progress_callback(info) {
      if (!info || info.status !== "progress_total") return;
      const now = Date.now();
      if (now - last < 120 && info.loaded < info.total) return;
      last = now;
      post({ type: "progress", loaded: info.loaded || 0, total: info.total || 0 });
    }
  });
  /* one token compiles the WebGPU shaders now, not on the visitor's first question */
  await generator([{ role: "user", content: "Hi" }], { max_new_tokens: 1, do_sample: false });
  post({ type: "ready", device: msg.device, dtype: msg.dtype });
}

async function generate(msg) {
  stopper = new lib.InterruptableStoppingCriteria();
  const streamer = new lib.TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function(text) { if (text) post({ type: "token", id: msg.id, text }); }
  });
  const output = await generator(msg.messages, Object.assign({}, msg.options, {
    streamer,
    stopping_criteria: stopper
  }));
  const turn = output && output[0] && output[0].generated_text;
  const text = Array.isArray(turn) ? String((turn[turn.length - 1] || {}).content || "") : String(turn || "");
  post({ type: "done", id: msg.id, text });
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "load") {
    load(msg).catch((err) => { generator = null; post({ type: "error", stage: "load", message: messageOf(err) }); });
  } else if (msg.type === "generate") {
    if (!generator) { post({ type: "error", stage: "generate", id: msg.id, message: "not-loaded" }); return; }
    generate(msg).catch((err) => post({ type: "error", stage: "generate", id: msg.id, message: messageOf(err) }));
  } else if (msg.type === "abort") {
    if (stopper) stopper.interrupt();
  }
};
