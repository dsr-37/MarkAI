import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import base64
import numpy as np
import cv2
import onnxruntime as ort
import os
from typing import cast, List, Any

MODEL_PATH = "models/model.onnx"
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

#Model Load
ort_session = None
try:
    if os.path.exists(MODEL_PATH):
        ort_session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        print(f"-Model loaded-: {MODEL_PATH}")
    else:
        print(f"-Warning-: {MODEL_PATH} not found. Running in FFT-only mode.")
except Exception as e:
    print(f"-Error loading model-: {e}")

class ImagePayload(BaseModel):
    image: str

#FFT Check
def check_fft_artifacts(img_bgr):
    try:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        f = np.fft.fft2(gray)
        fshift = np.fft.fftshift(f)
        magnitude = 20 * np.log(np.abs(fshift) + 1e-10)
        h, w = magnitude.shape
        cy, cx = h//2, w//2
        mask_radius = 30
        y, x = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((x - cx)**2 + (y - cy)**2)
        ring_mask = (dist_from_center > mask_radius) & (dist_from_center < (h//2 - 5))
        high_freq_data = magnitude[ring_mask]
        if len(high_freq_data) == 0: return 0.5
        variance = np.var(high_freq_data)

        return variance
    except Exception:
        return 2000

#ML Logic
def check_onnx_model(img_bgr):
    if ort_session is None:
        return 0.0
    try:
        img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (224, 224))
        img = img.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img = (img - mean) / std
        img = np.transpose(img, (2, 0, 1))
        img = np.expand_dims(img, axis=0)

        input_name = ort_session.get_inputs()[0].name
        raw_outputs = ort_session.run(None, {input_name: img})
        outputs = cast(List[Any], raw_outputs)
        
        scores = outputs[0][0]
        exp_scores = np.exp(scores)
        probs = exp_scores / np.sum(exp_scores)
        return float(probs[0])  # AI-generated prob
    except Exception as e:
        print(f"ONNX Inference Error: {e}")
        return 0.5

#Endpoint
@app.post("/analyze")
async def analyze(payload: ImagePayload):
    try:
        img_data = base64.b64decode(payload.image)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return {"is_ai": False, "confidence": 0}
        fft_variance = check_fft_artifacts(img)
        fft_suspicion = 0.0
        if fft_variance < 300:
            fft_suspicion = 0.4
        model_prob = check_onnx_model(img)
        final_score = model_prob
        
        if 0.45 < model_prob < 0.55:
            if fft_variance < 300:
                final_score += 0.2  # Push towards AI
            elif fft_variance > 2000:
                final_score -= 0.1  # Push towards Real
        is_ai = final_score > 0.55 
        return {
            "is_ai": is_ai,
            "confidence": final_score,
            "details": {"fft_var": fft_variance}
        }
    except Exception as e:
        print(f"Error: {e}")
        return {"is_ai": False, "confidence": 0}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)