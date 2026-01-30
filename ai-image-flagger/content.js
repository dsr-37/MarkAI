const CONFIG = {
    classes: { hollow: 'ai-removed-content', badge: 'ai-badge' },
    selectors: { googleContainers: 'div.isv-r, div.eA0Zlc' },
    cacheLimit: 500
};
const processedCache = new Map(); 
const pendingChecks = new Set();
let currentMode = 'light'; 

function addToCache(url, result) {
    if (processedCache.size >= CONFIG.cacheLimit) {
        const firstKey = processedCache.keys().next().value;
        processedCache.delete(firstKey);
    }
    processedCache.set(url, result);
}

function applyUI(img, isAI, confidence) {
    const container = img.closest(CONFIG.selectors.googleContainers) || img.parentElement || img;
    container.classList.remove(CONFIG.classes.hollow);
    const oldBadge = container.querySelector(`.${CONFIG.classes.badge}`);
    if (oldBadge) oldBadge.remove();
    if (currentMode === 'off' || !isAI) return;
    if (currentMode === 'strict') {
        container.classList.add(CONFIG.classes.hollow);
    } else {
        const badge = document.createElement('div');
        badge.className = CONFIG.classes.badge;
        
        let badgeColor = '#ff9800';
        let badgeText = 'AI';
        if (confidence > 0.76) {
            badgeColor = '#d32f2f';
        }

        badge.innerText = badgeText;
        const BASE_WIDTH = 250; 
        let currentWidth = img.offsetWidth;
        let scaleFactor = currentWidth / BASE_WIDTH;
        if (scaleFactor < 1) scaleFactor = 1;
        badge.style.cssText = `
            transform: scale(${scaleFactor});
            transform-origin: top right;
            position: absolute;
            top: ${8 * scaleFactor}px;
            right: ${8 * scaleFactor}px;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            white-space: nowrap;
            background: ${badgeColor};
            color: white;
            font-size: 12px;
            padding: 3px 6px;
            border-radius: 2px;
            z-index: 10;
            pointer-events: none;
            font-weight: 700;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            letter-spacing: 0.6px;
            font-family: sans-serif;
            text-transform: uppercase;
        `;
        const style = window.getComputedStyle(container);
        if (style.position === 'static') container.style.position = 'relative';
        container.appendChild(badge);
    }
}

function refreshAllUI() {
    document.querySelectorAll('img[data-ai-id]').forEach(img => {
        const url = img.src || img.currentSrc || img.dataset.src;
        const cached = processedCache.get(url);
        if (cached) applyUI(img, cached.isAI, cached.confidence);
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'setMode') {
        currentMode = message.mode;
        refreshAllUI();
    }
    if (message.type === 'RESULT_READY') {
        const { id, src, isAI, confidence } = message;
        addToCache(src, { isAI, confidence });
        pendingChecks.delete(src);

        const img = document.querySelector(`img[data-ai-id="${id}"]`);
        if (img) applyUI(img, isAI, confidence);
    }
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.mode) {
        currentMode = changes.mode.newValue;
        refreshAllUI();
    }
});

// INITIALIZATION
chrome.storage.local.get(['mode'], (result) => {
    currentMode = result.mode || 'light';
    domObserver.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('img').forEach(img => visibilityObserver.observe(img));
});

const visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            const url = img.src || img.currentSrc || img.dataset.src;
            if (!url || url.startsWith('data:') || pendingChecks.has(url)) return;

            if (processedCache.has(url)) {
                const cached = processedCache.get(url);
                applyUI(img, cached.isAI, cached.confidence);
                return;
            }
            if (img.width > 50 && img.height > 50) {
                pendingChecks.add(url);
                const uniqueId = Math.random().toString(36).substr(2, 9);
                img.setAttribute('data-ai-id', uniqueId);
                chrome.runtime.sendMessage({ type: 'CHECK_IMAGE', src: url, id: uniqueId });
            }
        }
    });
}, { rootMargin: "200px" });

const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
                if (node.tagName === 'IMG') visibilityObserver.observe(node);
                node.querySelectorAll('img').forEach(img => visibilityObserver.observe(img));
            }
        });
    }
});

const style = document.createElement('style');
style.textContent = `
    .${CONFIG.classes.hollow} img, .${CONFIG.classes.hollow} video, .${CONFIG.classes.hollow} canvas {
        opacity: 0 !important; visibility: hidden !important;
    }
    .${CONFIG.classes.hollow}::before {
        content: "-- ELIMINATED --";
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: #f0f0f0; color: #bdb8b8a1; font-size: 12px; font-weight: bold;
        z-index: 10;
    }
`;
document.head.appendChild(style);