// Configuration & thresholds
const MARK_CLASS = 'ai-overlay';
const HIDE_CLASS = 'ai-hidden';
const FAKE_PROB_THRESHOLD = 0.90;

// Mutable runtime state
let currentMode = null;
let observer = null;
let intersectionObserver = null;
let processQueue = [];
let processing = false;
let inflight = 0;
const maxInflight = 3;
let serverAvailable = null;

let currentScrollY = 0;
let workingAreaTop = 0;
let workingAreaBottom = 0;
const VIEWPORT_MARGIN = 500;
let scrollTimeout = null;
let processedImages = new Set();

let requestsInFlight = new Map();

// Server health and classification helpers
async function checkServerHealth() {
    try {
        const response = await fetch("http://127.0.0.1:8000/health", {
            method: "GET"
        });
        return response.ok;
    } catch (err) {
        console.log("[content] Server health check failed:", err.message);
        return false;
    }
}

async function classifyViaServer(url) {
    try {
        if (requestsInFlight.has(url)) {
            return await requestsInFlight.get(url);
        }

        if (serverAvailable === null) {
            serverAvailable = await checkServerHealth();
            if (!serverAvailable) {
                console.log("[content] Server not available, using fallback");
                return await classifyViaBackground(url);
            }
        }

        const requestPromise = fetch("http://127.0.0.1:8000/classify", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ images: [url] })
        }).then(async (resp) => {
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }
            return await resp.json();
        });

        requestsInFlight.set(url, requestPromise);

        const data = await requestPromise;
        
        requestsInFlight.delete(url);

        if (data.results && data.results[0]) {
            const result = data.results[0];
            if (result.ok) {
                return result.prob_ai;
            } else {
                console.warn("[content] Server classification failed:", result.error);
                return await classifyViaBackground(url);
            }
        } else {
            console.warn("[content] Invalid server response:", JSON.stringify(data));
            return await classifyViaBackground(url);
        }

    } catch (err) {
        console.log("[content] Server request failed:", err.message, "for URL:", url.substring(0, 100));
        requestsInFlight.delete(url);
        serverAvailable = false;
        return await classifyViaBackground(url);
    }
}

async function classifyViaBackground(url) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: 'classify', url: url },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[content] Background classification runtime error:", chrome.runtime.lastError.message);
                    resolve(0.3);
                    return;
                }

                if (response && response.ok && typeof response.prob === 'number') {
                    resolve(response.prob);
                } else {
                    if (response && response.error) {
                        console.warn("[content] Background classification failed:", response.error);
                    } else {
                        console.warn("[content] Background classification failed with unexpected response:", response);
                    }
                    resolve(0.3);
                }
            }
        );
    });
}

// DOM helpers
function getContainerFor(img) {
    return (
        img.closest('div.isv-r') ||
        img.closest('div.eA0Zlc') ||
        img.closest('div') ||
        img
    );
}

function addGreyOverlay(img) {
  img.classList.add(MARK_CLASS);
  if (!img.nextElementSibling?.classList.contains('ai-grey-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'ai-grey-overlay';
    overlay.style.cssText = `
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(128, 128, 128, 0.85);
        pointer-events: none;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 12px;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        border-radius: inherit;
    `;
    overlay.textContent = 'AI';

    const container = img.parentElement;
    if (container && getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    img.insertAdjacentElement('afterend', overlay);
  }
}

function removeGreyOverlay(img) {
    img.classList.remove(MARK_CLASS);
    const overlay = img.nextElementSibling;
    if (overlay?.classList.contains('ai-grey-overlay')) {
        overlay.remove();
    }
}

function hideImage(img) {
    const container = getContainerFor(img);
    container.classList.add(HIDE_CLASS);
}

function showImage(img) {
    const container = getContainerFor(img);
    container.classList.remove(HIDE_CLASS);
}

function isImageInWorkingArea(img) {
    const rect = img.getBoundingClientRect();
    const imgTop = rect.top + window.scrollY;
    const imgBottom = rect.bottom + window.scrollY;
    
    return (imgBottom >= workingAreaTop && imgTop <= workingAreaBottom);
}

function updateWorkingArea() {
    currentScrollY = window.scrollY;
    workingAreaTop = Math.max(0, currentScrollY - VIEWPORT_MARGIN);
    workingAreaBottom = currentScrollY + window.innerHeight + VIEWPORT_MARGIN;
    
    console.log(`[content] Working area updated: ${workingAreaTop} - ${workingAreaBottom} (scroll: ${currentScrollY})`);
}

function firstSrcFromSrcset(attr) {
  if (!attr || typeof attr !== 'string') return '';
  const firstPart = (attr.split(',') || '')[0];
  if (typeof firstPart !== 'string') return '';
  const url = (firstPart.trim().split(/\s+/) || '');
  return url;
}

// Core per-image application logic
async function applyToImage(img) {
    const container = getContainerFor(img);
    const srcsetFirst = firstSrcFromSrcset(img.getAttribute('srcset'));
    const dataSrcsetFirst = firstSrcFromSrcset(img.getAttribute('data-srcset'));
    const url =
        container?.getAttribute('data-iurl') ||
        container?.getAttribute('data-src') ||
        img.currentSrc ||
        srcsetFirst ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        dataSrcsetFirst ||
        img.dataset.src;
    if (!url || url.startsWith('data:')) {
        return;
    }

    if (processedImages.has(url)) {
        return;
    }

    if (!isImageInWorkingArea(img)) {
        return;
    }

    try {
        inflight++;
    processedImages.add(url);
        
        const prob = await classifyViaServer(url);
        const isAI = prob >= FAKE_PROB_THRESHOLD;

        console.log(`[content] ${url.substring(0, 50)}... → ${prob.toFixed(3)} ${isAI ? '(AI)' : '(Real)'}`);

        if (!isImageInWorkingArea(img)) {
            return;
        }

        if (currentMode === 'light') {
            if (isAI) {
                addGreyOverlay(img);
                img.title = `AI Detected (${Math.round(prob * 100)}%)`;
            } else {
                removeGreyOverlay(img);
                img.title = '';
            }
            showImage(img);

        } else if (currentMode === 'strict') {
            removeGreyOverlay(img);
            if (isAI) {
                hideImage(img);
            } else {
                showImage(img);
            }
        }

        img.dataset.aiProb = Math.round(prob * 100);
        img.dataset.aiProcessed = 'true';

    } catch (err) {
    console.error('[content] Classification error for', url.substring(0, 50), '...', err);
    processedImages.delete(url);
    } finally {
        inflight--;
        processNextInQueue();
    }
}

// Queue management
function queueImageForProcessing(img) {
    if (!img.dataset.queued && currentMode && isImageInWorkingArea(img)) {
        const url = img.src || img.currentSrc || img.getAttribute('data-src') || img.dataset.src;
        if (url && !url.startsWith('data:') && !processedImages.has(url)) {
            img.dataset.queued = 'true';
            processQueue.push(img);
            processNextInQueue();
        }
    }
}

function processNextInQueue() {
    if (inflight < maxInflight && processQueue.length > 0 && !processing) {
        processing = true;
        const img = processQueue.shift();
        delete img.dataset.queued;
        
        applyToImage(img).finally(() => {
            processing = false;
            if (processQueue.length > 0) {
                setTimeout(processNextInQueue, 10);
            }
        });
    }
}

// Reset state and reprocessing
function clearAllProcessing(root = document) {
    console.log('[content] Clearing all processing...');
    root.querySelectorAll('.ai-grey-overlay').forEach(el => el.remove());
    root.querySelectorAll(`img.${MARK_CLASS}`).forEach(img => {
        img.classList.remove(MARK_CLASS);
        img.title = '';
        delete img.dataset.aiProb;
        delete img.dataset.aiProcessed;
        delete img.dataset.queued;
    });
    root.querySelectorAll(`.${HIDE_CLASS}`).forEach(el => el.classList.remove(HIDE_CLASS));
    processQueue = [];
    processedImages.clear();
    requestsInFlight.clear();
}

function reprocessVisibleImages() {
    if (!currentMode) return;
    
    updateWorkingArea();
    
    const imagesInArea = Array.from(document.querySelectorAll('img')).filter(img => {
        return isImageInWorkingArea(img) && !img.dataset.aiProcessed;
    });
    
    console.log(`[content] Reprocessing ${imagesInArea.length} images in working area`);
    imagesInArea.forEach(queueImageForProcessing);
}

function handleScroll() {
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }
    
    scrollTimeout = setTimeout(() => {
        updateWorkingArea();
        reprocessVisibleImages();
    }, 100);
}

// Observers
function startIntersectionObserver() {
    if (intersectionObserver) return;
    
    intersectionObserver = new IntersectionObserver((entries) => {
        if (!currentMode) return;
        
        entries.forEach(entry => {
          if (entry.isIntersecting && isImageInWorkingArea(entry.target)) {
            const imgElem = (entry.target.tagName && entry.target.tagName.toLowerCase() === 'img')
                ? entry.target
                : entry.target.querySelector('img');
            if (imgElem || imgElem.src || imgElem.currentSrc) {
                queueImageForProcessing(imgElem);
            }
          }
        });
    }, {
        rootMargin: `${VIEWPORT_MARGIN}px`
    });

    document.querySelectorAll('img').forEach(img => {intersectionObserver.observe(img);});
    document.querySelectorAll('div.eA0Zlc, div.isv-r').forEach(el => intersectionObserver.observe(el));
}

function stopIntersectionObserver() {
    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }
}

function startMutationObserver() {
    if (observer) return;

    observer = new MutationObserver(mutations => {
        if (!currentMode) return;

        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.nodeType !== 1) return;
                if (node.classList.contains('eA0Zlc') || node.classList.contains('isv-r')) {
                    const imgElem = node.querySelector('img');
                    if (imgElem) {
                        intersectionObserver?.observe(imgElem);
                        if (isImageInWorkingArea(imgElem)) {
                            queueImageForProcessing(imgElem);
                        }
                    }
                } else {
                    node.querySelectorAll('div.eA0Zlc, div.isv-r').forEach(container => {
                        const imgElem = container.querySelector('img');
                        if (imgElem) {
                            intersectionObserver?.observe(imgElem);
                            if (isImageInWorkingArea(imgElem)) {
                                queueImageForProcessing(imgElem);
                            }
                        }
                    });
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function stopMutationObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// Initialization and message handling
chrome.storage.local.get('mode', ({ mode }) => {
    currentMode = mode || null;
    console.log(`[content] Initialized with mode: ${currentMode}`);
    
    if (currentMode) {
        updateWorkingArea();
        startIntersectionObserver();
        startMutationObserver();
        window.addEventListener('scroll', handleScroll, { passive: true });
        reprocessVisibleImages();
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'setMode') {
        const oldMode = currentMode;
        currentMode = msg.mode || null;
        console.log(`[content] Mode changed from ${oldMode} to ${currentMode}`);
        
        if (currentMode) {
            if (oldMode !== currentMode) {
                clearAllProcessing();
                updateWorkingArea();
                startIntersectionObserver();
                startMutationObserver();
                
                if (!window.scrollListenerAdded) {
                    window.addEventListener('scroll', handleScroll, { passive: true });
                    window.scrollListenerAdded = true;
                }
                
                reprocessVisibleImages();
            }
        } else {
            clearAllProcessing();
            stopIntersectionObserver();
            stopMutationObserver();
            window.removeEventListener('scroll', handleScroll);
            window.scrollListenerAdded = false;
        }
    }
});