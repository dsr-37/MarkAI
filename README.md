# MarkAI - AI Image Detection Chrome Extension

MarkAI is a Chrome extension that can identify, flag & remove images that feels like AI-Generated in real-time while browsing. This helps a user distinguish AI‑generated content from natural images without significantly disrupting normal page interaction.

## Features

- **Real-time AI Detection**: Automatically scans images on web pages as you scroll
- **Dual Detection Modes**:
    - **Light Mode**: Adds grey overlays with "AI" labels to detected artificial images
    - **Strict Mode**: Completely hides AI-generated images from view
- **Server-Side Processing**: Utilizes a local FastAPI server with ONNX runtime for accurate classification
- **Smart Performance**: Efficient viewport-based processing with scroll optimization
- **Google Images Optimized**: Specially tuned for Google Images search results
- **Fallback System**: Graceful degradation when server is unavailable


## Technical Depth

The extension consists of two main components:
1. Chrome Extension Logic
2. AI Classification Server using Python
---
- Keeps Track of user scrolling and automatically updates working area accordingly.
- Parse src, srcset, and data attributes.
- Uses softmax function to return probabilities.
- Automatic cleanup of processed images.


## Deployment Guide (Python 3.9+)

1. **Clone the repository**

2. **Set up the AI server**: (install all necessary dependencies)

3. **Download the AI model**: Use Optimum to convert this Image Classification model `dima806/ai_vs_real_image_detection` to onnx format and place the ONNX model file in `ai-flagger-server/models/model.onnx`

4. **Start the server**: Server will run at `127.0.0.1:8000`

5. **Install the Chrome extension**: Inside Chrome, navigate to `chrome://extensions`, enable Developer Mode and Load `ai-image-flagger` folder.

6. Adblockers or similar extensions can block it from working properly, so disable them temporarily.

### Try It Out!

1. **Navigate to any website** (currently Google Images & Pinterest work fairly)
2. **Click the MarkAI icon** in your Chrome toolbar
3. **Select your preferred mode**:
    - **Off**: No processing
    - **Light**: Grey overlays on AI images
    - **Strict**: Hide AI images completely
4. **Browse normally** - the extension works automatically as you scroll

## Configure For Yourself

- `MODEL_PATH`: Path to your ONNX model file
- `INPUT_SIZE`: Model input size (default: 224)
- `FAKE_PROB_THRESHOLD`: Classification threshold (default: 0.90)


1. **Detection**: IntersectionObserver monitors images entering the viewport
2. **URL Extraction**: Smart parsing of src, srcset, and data attributes
3. **Classification**: HTTP POST to local server with image URLs
4. **Rendering**: CSS overlays or element hiding based on AI probability

## Privacy \& Security

- **Local Processing**: All AI inference happens on your machine
- **No Data Collection**: Extension doesn't store or transmit personal information
- **CORS Protection**: Server configured for local-only access
- **Secure Defaults**: Conservative fallbacks when detection fails

## Areas for Improvement
- Sometimes it can be slow in processing images, especially if there are too many images on the screen or user is scrolling fast.
- Fine-Tuning of the model to boost accuracy. Right now we are using a pre-trained model.
- Expanding the extension to work on more sites properly.

## 📄 License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

***
