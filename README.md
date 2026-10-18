# New Dish

New Dish is a cheerful, local-first recipe matcher for one person or a group. Kitchens can type ingredients or confirm suggestions from an ingredient-list/fridge photo, choose group-wide dietary boundaries, and get a documented edible recipe with source nutrition per serving.

## Local AI

- Verified recipes: UniTools Recipes v1 (CC BY-SA 4.0), including quantities, detailed method, timings, licensed photos, and source-provided calories/protein/fat/carbs per serving.
- OCR: Tesseract.js with local image preprocessing.
- Fridge suggestions: `Xenova/detr-resnet-50` through Transformers.js. Detections always require confirmation.
- Optional wording helper: `HuggingFaceTB/SmolLM2-360M-Instruct`, falling back to `onnx-community/Qwen2.5-0.5B-Instruct`.
- Voice: `onnx-community/Kokoro-82M-v1.0-ONNX` through Kokoro.js.
- Models run in browser workers. Model files are downloaded once and cached by the browser.
- The language model never creates recipe facts or nutrition. If no safe source recipe matches, the app says so instead of fabricating one.

## Run locally

```bash
python3 -m http.server 4173 --directory dist
```

Then open <http://127.0.0.1:4173>.


