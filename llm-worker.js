import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";

let helper;
const models = [
  { id: "HuggingFaceTB/SmolLM2-360M-Instruct", label: "SmolLM2 360M" },
  { id: "onnx-community/Qwen2.5-0.5B-Instruct", label: "Qwen2.5 0.5B" }
];

async function tryModel(model, device) {
  return pipeline("text-generation", model.id, {
    device,
    dtype: device === "webgpu" ? "q4f16" : "q4",
    progress_callback: p => self.postMessage({ type: "progress", progress: p.progress, file: p.file, model: model.label })
  });
}

async function load() {
  const preferred = "gpu" in navigator ? "webgpu" : "wasm";
  let lastError;
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    if (index) self.postMessage({ type: "fallback", model: model.label });
    for (const device of preferred === "webgpu" ? ["webgpu", "wasm"] : ["wasm"]) {
      try {
        helper = await tryModel(model, device);
        self.postMessage({ type: "ready", model: model.label, device });
        return;
      } catch (error) { lastError = error; }
    }
  }
  throw lastError || new Error("No local language model could be loaded.");
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load();
  } catch (error) { self.postMessage({ type: "error", message: error.message }); }
};
