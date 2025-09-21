import io
import os
from typing import List, Dict, Any
import numpy as np
import requests
from PIL import Image
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import onnxruntime as ort
import uvicorn
import urllib3

# Configuration
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
MODEL_PATH = os.getenv("MODEL_PATH", "models/model.onnx")
INPUT_SIZE = int(os.getenv("INPUT_SIZE", "224"))
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
ALLOW_ORIGINS = [o.strip() for o in os.getenv("ALLOW_ORIGINS", "*").split(",") if o.strip()]

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Model loading
print("Loading ONNX model...")
try:
    session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    print(f"Model loaded successfully. Input: {input_name}, Output: {output_name}")
except Exception as e:
    print(f"Error loading model: {e}")
    raise

# API setup
app = FastAPI(title="MarkAI API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ClassifyRequest(BaseModel):
    images: List[str]

def preprocess_pil(img: Image.Image) -> np.ndarray:
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img = img.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - MEAN) / STD
    chw = np.transpose(arr, (2, 0, 1))
    return chw

def softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    e = np.exp(x - np.max(x, axis=axis, keepdims=True))
    return e / np.sum(e, axis=axis, keepdims=True)

# Endpoints
@app.post("/classify")
def classify(req: ClassifyRequest) -> Dict[str, Any]:
    if not req.images:
        return {"results": []}
    final_results: List[Dict | None] = [None] * len(req.images)
    batch_tensors = []
    good_idx_map = {}
    for i, url in enumerate(req.images):
        try:
            r = requests.get(url, timeout=8, headers={'User-Agent': 'Mozilla/5.0'}, verify=False)
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content))
            chw = preprocess_pil(img)
            good_idx_map[len(batch_tensors)] = i
            batch_tensors.append(chw)
        except Exception as e:
            error_msg = f"Failed to process {url[:100]}: {e}"
            print(error_msg)
            final_results[i] = {"url": url, "ok": False, "error": error_msg, "prob_ai": None}
    if batch_tensors:
        try:
            batch = np.stack(batch_tensors, axis=0).astype(np.float32)
            outputs = session.run([output_name], {input_name: batch})[0]
            probs = softmax(outputs, axis=1)[:, 1]
            for batch_idx, prob in enumerate(probs):
                original_idx = good_idx_map[batch_idx]
                final_results[original_idx] = {
                    "url": req.images[original_idx],
                    "ok": True,
                    "error": None,
                    "prob_ai": float(prob)
                }
        except Exception as e:
            error_msg = f"Inference failed: {e}"
            print(error_msg)
            for batch_idx in range(len(batch_tensors)):
                original_idx = good_idx_map[batch_idx]
                if final_results[original_idx] is None:
                    final_results[original_idx] = {"url": req.images[original_idx], "ok": False, "error": error_msg, "prob_ai": None}
    return {"results": final_results}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Entrypoint
if __name__ == "__main__":
    print("Starting AI Image Flagger Server...")
    uvicorn.run(app, host=HOST, port=PORT)