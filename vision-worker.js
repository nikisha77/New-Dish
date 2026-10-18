import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";

let detector;
let detectorPromise;

async function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = pipeline("object-detection", "Xenova/detr-resnet-50", {
      device: "wasm",
      progress_callback: p => self.postMessage({ type: "progress", progress: p.progress, file: p.file })
    });
  }
  detector = await detectorPromise;
  self.postMessage({ type: "ready" });
  return detector;
}

async function detect(image) {
  const model = detector || await loadDetector();
  const output = await model(image, { threshold: 0.7, percentage: true });
  self.postMessage({ type: "result", items: output.map(x => ({ label: x.label, score: x.score })) });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await loadDetector();
    if (data.type === "detect") await detect(data.image);
  }
  catch (error) { self.postMessage({ type: "error", message: error.message }); }
};
