// ─── Prompt Porter · background.js ───────────────────────────────────────────
// Central hub: manages bundle storage, cross-tab messaging, keyboard shortcuts.

const DB_NAME = 'PromptPorterDB';
const DB_VERSION = 1;
const STORE_FILES = 'fileBlobs';
const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_FILES, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveFilesToDB(bundleId, files) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    files.forEach((f) => store.put({ id: `${bundleId}::${f.name}`, ...f }));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getFilesFromDB(bundleId, fileNames) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const results = [];
    let pending = fileNames.length;
    if (!pending) return resolve([]);
    fileNames.forEach((name) => {
      const req = store.get(`${bundleId}::${name}`);
      req.onsuccess = (e) => {
        if (e.target.result) results.push(e.target.result);
        if (--pending === 0) resolve(results);
      };
      req.onerror = () => { if (--pending === 0) resolve(results); };
    });
  });
}

async function deleteFilesFromDB(bundleId, fileNames) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    fileNames.forEach((name) => store.delete(`${bundleId}::${name}`));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ── Bundle helpers ────────────────────────────────────────────────────────────

async function getBundles() {
  const result = await chrome.storage.local.get('bundles');
  return result.bundles || [];
}

async function saveBundles(bundles) {
  await chrome.storage.local.set({ bundles });
}

async function saveBundle(bundle) {
  const bundles = await getBundles();
  // Save file blobs to IndexedDB
  if (bundle.files && bundle.files.length > 0) {
    await saveFilesToDB(bundle.id, bundle.files);
  }
  // Store bundle metadata without blob data (too large for chrome.storage)
  const meta = {
    ...bundle,
    files: (bundle.files || []).map(({ data, ...rest }) => rest),
  };
  bundles.unshift(meta);
  // Keep max 20 bundles
  const removed = bundles.splice(20);
  for (const old of removed) {
    await deleteFilesFromDB(old.id, (old.files || []).map((f) => f.name));
  }
  // Expire old bundles
  const now = Date.now();
  const fresh = bundles.filter((b) => now - b.createdAt < BUNDLE_TTL_MS);
  const expired = bundles.filter((b) => now - b.createdAt >= BUNDLE_TTL_MS);
  for (const old of expired) {
    await deleteFilesFromDB(old.id, (old.files || []).map((f) => f.name));
  }
  await saveBundles(fresh);
  return meta;
}

async function deleteBundle(bundleId) {
  const bundles = await getBundles();
  const target = bundles.find((b) => b.id === bundleId);
  if (target) {
    await deleteFilesFromDB(bundleId, (target.files || []).map((f) => f.name));
  }
  await saveBundles(bundles.filter((b) => b.id !== bundleId));
}

async function getBundleWithFiles(bundleId) {
  const bundles = await getBundles();
  const bundle = bundles.find((b) => b.id === bundleId);
  if (!bundle) return null;
  const fileNames = (bundle.files || []).map((f) => f.name);
  const filesWithData = await getFilesFromDB(bundleId, fileNames);
  return { ...bundle, files: filesWithData };
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'SAVE_BUNDLE': {
          const saved = await saveBundle(msg.bundle);
          sendResponse({ ok: true, bundle: saved });
          break;
        }
        case 'GET_BUNDLES': {
          const bundles = await getBundles();
          sendResponse({ ok: true, bundles });
          break;
        }
        case 'GET_BUNDLE_WITH_FILES': {
          const bundle = await getBundleWithFiles(msg.bundleId);
          sendResponse({ ok: true, bundle });
          break;
        }
        case 'DELETE_BUNDLE': {
          await deleteBundle(msg.bundleId);
          sendResponse({ ok: true });
          break;
        }
        case 'INJECT_INTO_TAB': {
          // Relay inject command to the active tab's content script
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) { sendResponse({ ok: false, error: 'No active tab' }); break; }
          const bundle = await getBundleWithFiles(msg.bundleId);
          if (!bundle) { sendResponse({ ok: false, error: 'Bundle not found' }); break; }
          chrome.tabs.sendMessage(tab.id, { type: 'INJECT_BUNDLE', bundle });
          sendResponse({ ok: true });
          break;
        }
        case 'INJECT_INTO_ALL': {
          // Open tabs for each platform and inject
          const bundle = await getBundleWithFiles(msg.bundleId);
          if (!bundle) { sendResponse({ ok: false, error: 'Bundle not found' }); break; }
          const platforms = msg.platforms || [];
          const autoSend = msg.autoSend || false;
          for (const url of platforms) {
            const tab = await chrome.tabs.create({ url });
            // Inject after page loads
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.sendMessage(tabId, { type: 'INJECT_BUNDLE', bundle, autoSend });
                chrome.tabs.onUpdated.removeListener(listener);
              }
            });
          }
          sendResponse({ ok: true });
          break;
        }
        case 'CAPTURE_FROM_TAB': {
          // Ask the active tab content script to capture
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) { sendResponse({ ok: false, error: 'No active tab' }); break; }
          chrome.tabs.sendMessage(tab.id, { type: 'DO_CAPTURE', label: msg.label }, async (captured) => {
            if (chrome.runtime.lastError || !captured || !captured.ok) {
              sendResponse({ ok: false, error: 'Capture failed — is this a supported LLM page?' });
              return;
            }
            const saved = await saveBundle(captured.bundle);
            sendResponse({ ok: true, bundle: saved });
          });
          return; // async sendResponse
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep channel open for async response
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'capture-bundle') {
    chrome.tabs.sendMessage(tab.id, { type: 'DO_CAPTURE' }, async (captured) => {
      if (chrome.runtime.lastError || !captured || !captured.ok) return;
      await saveBundle(captured.bundle);
      chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });
      setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
    });
  }

  if (command === 'inject-bundle') {
    const bundles = await getBundles();
    if (!bundles.length) return;
    const bundle = await getBundleWithFiles(bundles[0].id);
    chrome.tabs.sendMessage(tab.id, { type: 'INJECT_BUNDLE', bundle });
  }
});
