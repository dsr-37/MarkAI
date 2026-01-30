// CHROME 116+ needed for OffscreenCanvas support

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CHECK_IMAGE') {
        processImagePipeline(request.src, request.id, sender.tab.id);
        return true;
    }
});
async function processImagePipeline(url, imgId, tabId) {
    try {
        // Bypassing CORS (getting JPEG Blob)
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error('Fetch failed');
        const blob = await response.blob();

        // Image Bitmap
        const bitmap = await createImageBitmap(blob);
        
        const targetSize = 224;
        const canvas = new OffscreenCanvas(targetSize, targetSize);
        const ctx = canvas.getContext('2d');
        
        let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
        if (sw > sh) {
            sx = (sw - sh) / 2;
            sw = sh;
        } else {
            sy = (sh - sw) / 2;
            sh = sw;
        }
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetSize, targetSize);
        
        // Converting to BASE64
        const blobCrop = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.90 });
        const base64String = await blobToBase64(blobCrop);
        
        const serverResponse = await fetch('http://127.0.0.1:8000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64String })
        });
        
        const result = await serverResponse.json();

        chrome.tabs.sendMessage(tabId, {
            type: 'RESULT_READY',
            id: imgId,
            src: url,
            isAI: result.is_ai,
            confidence: result.confidence
        });

    } catch (err) {
        console.warn(`[Background] Error processing ${url.substring(0,30)}...`, err);
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, _) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.readAsDataURL(blob);
    });
}