import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

let tts;
let ttsPromise;

async function loadVoice() {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "wasm",
      progress_callback: progress => {
        if (Number.isFinite(progress?.progress)) {
          self.postMessage({ type: "progress", progress: progress.progress, file: progress.file });
        }
      }
    });
  }
  tts = await ttsPromise;
  self.postMessage({ type: "ready" });
}

async function generateSpeech(text) {
  if (!tts) await loadVoice();
  self.postMessage({ type: "speaking" });
  const audio = await tts.generate(text, { voice: "af_heart", speed: 1.03 });
  const blob = audio.toBlob();
  self.postMessage({ type: "audio", blob });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await loadVoice();
    if (data.type === "speak") await generateSpeech(data.text);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
