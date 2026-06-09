// ─── Prompt Porter · content.js ──────────────────────────────────────────────
// ISOLATED world — captures files from user input, relays inject commands.
// File injection is handled entirely via injector.js (MAIN world) which has
// access to React fibers, Angular contexts, and Quill instances directly.

const DEBUG = false;

function PP_LOG(...args) {
  if (DEBUG) {
    console.log('%c[PromptPorter]', 'color:#1D9E75;font-weight:bold', ...args);
  }
}

// ── pendingFiles — cleared after each capture ─────────────────────────────────

const LARGE_PASTE_THRESHOLD = 5000;

let pendingFiles = new Map();
let pendingLargePaste = null;
let isInjecting  = false; // guard: ignore change events we fire ourselves
let currentBundle = null;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function watchFileInputs() {
  const seen = new WeakSet();

  function attachListener(input) {
    if (seen.has(input)) return;
    seen.add(input);
    input.addEventListener('change', async () => {
      if (isInjecting) {
        PP_LOG('file change during injection — skipped');
        return;
      }
      PP_LOG('file input change fired, files:', input.files.length);
      if (!input.files.length) return;
      for (const file of input.files) {
        if (pendingFiles.has(file.name)) continue;
        try {
          const data = await blobToBase64(file);
          pendingFiles.set(file.name, { name: file.name, type: file.type, size: file.size, data });
          PP_LOG('captured into pending:', file.name);
        } catch (err) {
          console.warn('[PromptPorter] capture failed:', file.name, err);
        }
      }
    });
  }

  document.querySelectorAll('input[type="file"]').forEach(attachListener);
  new MutationObserver(() => {
    document.querySelectorAll('input[type="file"]').forEach(attachListener);
  }).observe(document.body, { childList: true, subtree: true });
}

function getAttachmentCount() {
  return (
    document.querySelectorAll(
      '[data-testid*="attachment"], [data-testid*="file"]'
    ).length +
    document.querySelectorAll(
      'button[aria-label*="Remove"], button[aria-label*="remove"]'
    ).length +
    document.querySelectorAll(
      'mat-icon[data-mat-icon-name="close"]'
    ).length +
    document.querySelectorAll(
      '[data-testid*="file"], [data-testid*="attachment"]'
    ).length
  );
}

function detectAttachmentChips() {
  return getAttachmentCount() > 0;
}

// ── Adapters — text only, selectors only ─────────────────────────────────────

const ADAPTERS = {
  'claude.ai': {
    name: 'Claude',
    getTextarea() {
      return (
        document.querySelector('div[contenteditable="true"].ProseMirror') ||
        document.querySelector('[data-testid="chat-input"]') ||
        document.querySelector('div[contenteditable="true"]')
      );
    },
  },
  'chatgpt.com': {
    name: 'ChatGPT',
    getTextarea() {
      return (
        document.querySelector('#prompt-textarea') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea')
      );
    },
  },
  'gemini.google.com': {
    name: 'Gemini',
    getTextarea() {
      return (
        document.querySelector('.ql-editor') ||
        document.querySelector('[contenteditable="true"]')
      );
    },
  },
  'grok.com': {
    name: 'Grok',
    getTextarea() {
      return (
        document.querySelector('[role="textbox"]') ||
        document.querySelector('.tiptap') ||
        document.querySelector('.ProseMirror') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea')
      );
    },
  },
  'www.perplexity.ai': {
    name: 'Perplexity',
    getTextarea() {
      return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    },
  },
};

function getAdapter() {
  return ADAPTERS[location.hostname] || null;
}

// ── MAIN-world bridge ─────────────────────────────────────────────────────────
// We inject injector.js into the MAIN world once, then communicate via
// CustomEvents on window. ISOLATED → MAIN: __pp_inject__. MAIN → ISOLATED: __pp_result__.

let injectorReady = false;
let injectorReadyCallbacks = [];

function ensureInjector() {
  return new Promise((resolve) => {
    if (injectorReady) { resolve(); return; }
    injectorReadyCallbacks.push(resolve);
    if (injectorReadyCallbacks.length === 1) {
      // First caller — actually inject
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('injector.js');
      s.onload = () => {
        injectorReady = true;
        injectorReadyCallbacks.forEach(cb => cb());
        injectorReadyCallbacks = [];
        s.remove();
      };
      (document.head || document.documentElement).appendChild(s);
    }
  });
}

function sendToMain(type, payload) {
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.detail.type === type) {
        window.removeEventListener('__pp_result__', handler);
        resolve(e.detail);
      }
    };
    window.addEventListener('__pp_result__', handler);
    window.dispatchEvent(new CustomEvent('__pp_inject__', { detail: { type, payload } }));
    // Timeout safety — resolve after 5s regardless
    setTimeout(() => { window.removeEventListener('__pp_result__', handler); resolve({ ok: false, error: 'timeout' }); }, 5000);
  });
}

// ── Capture ───────────────────────────────────────────────────────────────────

function captureBundle(label) {
  const adapter = getAdapter();
  if (!adapter) return null;

  const textarea = adapter.getTextarea();
  const text  = textarea ? (textarea.innerText || textarea.value || '').trim() : '';
  const files = Array.from(pendingFiles.values());

  PP_LOG(`captureBundle: "${text.slice(0, 50)}", files=[${files.map(f => f.name)}]`);

  const bundle = {
    id: `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: label || `From ${adapter.name}`,
    source: adapter.name,
    text,
    files,
    createdAt: Date.now(),
  };

  pendingFiles.clear();
  pendingLargePaste = null;
  PP_LOG('pendingFiles cleared');
  return bundle;
}

// ── Inject ────────────────────────────────────────────────────────────────────

async function injectBundle(bundle) {
  const adapter = getAdapter();
  if (!adapter) return { ok: false, error: 'Unsupported platform' };

  await ensureInjector();

  const host = location.hostname;
  const results = { text: false, files: { ok: false, count: 0 } };

  await sendToMain('CLEAR_ATTACHMENTS', { host });

  // ── Wait for textarea ──
  let el = null;
  for (let i = 0; i < 20; i++) {
    el = adapter.getTextarea();
    if (el) break;
    await new Promise(r => setTimeout(r, 300));
  }
  PP_LOG('textarea:', el?.tagName, el?.className?.slice(0, 50));

  // ── Text — via MAIN world ──
  if (bundle.text && el) {
    const res = await sendToMain('TEXT', { text: bundle.text, host });
    results.text = res.ok;
    PP_LOG('text inject result:', res);
  }

  // ── Files — via MAIN world ──
  if (bundle.files && bundle.files.length > 0) {
    await new Promise(r => setTimeout(r, 400));
    PP_LOG(`file inject: ${bundle.files.length} file(s) via MAIN world`);

    isInjecting = true;
    const res = await sendToMain('FILES', { files: bundle.files, host });
    isInjecting = false;

    results.files = { ok: res.ok, count: bundle.files.length };
    PP_LOG('file inject result:', res);
  }

  const fileCount  = bundle.files?.length || 0;
  const fileNote   = results.files.ok
    ? ` + ${fileCount} file(s)`
    : fileCount > 0 ? ` (${fileCount} file(s) may need manual attach)` : '';

  showToast(results.text ? `Injected prompt${fileNote}` : 'Injection attempted — check input');
  return { ok: true, results };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  document.getElementById('pp-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'pp-toast';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;
    background:#1a1a1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:13px;padding:10px 16px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.3);
    display:flex;align-items:center;gap:8px;opacity:0;transform:translateY(8px);
    transition:opacity .2s,transform .2s;pointer-events:none;max-width:340px;`;
  t.innerHTML = `<span style="color:#1D9E75;font-size:15px">✓</span><span>${msg}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Auto-send after injection ────────────────────────────────────────────────

async function sendChatGPT() {
  for (let i = 0; i < 60; i++) {
    const btn =
      document.querySelector('#composer-submit-button') ||
      document.querySelector('[data-testid="send-button"]');

    if (
      btn &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true'
    ) {
      PP_LOG('ChatGPT send button ready');
      btn.click();
      return true;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  PP_LOG('ChatGPT send button never became ready');
  return false;
}

async function sendClaude() {
  for (let i = 0; i < 60; i++) {
    const btn = document.querySelector('button[aria-label="Send message"]');

    if (
      btn &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true'
    ) {
      PP_LOG('Claude send button ready');
      btn.click();
      return true;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  PP_LOG('Claude send button never became ready');
  return false;
}

async function sendGemini() {

  for (let i = 0; i < 60; i++) {

    const icon =
      document.querySelector(
        'mat-icon[data-mat-icon-name="arrow_upward"]'
      );

    const btn =
      icon?.closest('button');

    if (
      btn &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true'
    ) {

      PP_LOG('Gemini send button ready');
      btn.click();
      return true;
    }

    await new Promise(
      r => setTimeout(r, 1000)
    );
  }

  PP_LOG(
    'Gemini send button never became ready'
  );

  return false;
}

// async function sendGrok() {
//   const btn =
//     document.querySelector('[data-testid="chat-submit"]') ||
//     document.querySelector('button[aria-label="Submit"]');
  
//   if (btn && !btn.disabled) {
//     btn.click();
//   }
// }

async function sendGrok() {

  for (let i = 0; i < 30; i++) {

    const btn =
      document.querySelector('[data-testid="chat-submit"]') ||
      document.querySelector('button[aria-label="Submit"]');

    if (
      btn &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true'
    ) {

      PP_LOG('Grok send button ready');
      btn.click();
      return true;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  PP_LOG('Grok send button never became ready');
  return false;
}

async function waitForGeminiAttachments(expectedCount) {
  // Wait for Gemini to render attachment chips and stabilize.
  for (let i = 0; i < 120; i++) { // ~60s max
    const count = (
      document.querySelectorAll('mat-chip').length +
      document.querySelectorAll('[data-testid*="attachment"]').length +
      document.querySelectorAll('[data-testid*="file"]').length +
      document.querySelectorAll('mat-icon[data-mat-icon-name="close"]').length
    );

    if (count >= expectedCount) {
      // give Gemini a moment to finish rendering previews/processing
      await new Promise(r => setTimeout(r, 1500));
      const stableCount = (
        document.querySelectorAll('mat-chip').length +
        document.querySelectorAll('[data-testid*="attachment"]').length +
        document.querySelectorAll('[data-testid*="file"]').length +
        document.querySelectorAll('mat-icon[data-mat-icon-name="close"]').length
      );
      if (stableCount >= expectedCount) {
        PP_LOG('Gemini attachments ready', stableCount);
        return true;
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  PP_LOG('Gemini attachments never stabilized');
  return false;
}
async function sendCurrentPlatform() {
  const host = location.hostname;
  
  if (host.includes('chatgpt.com')) {
    return sendChatGPT();
  }
  
  if (host.includes('claude.ai')) {
    return sendClaude();
  }
  
  if (host.includes('gemini.google.com')) {
    return sendGemini();
  }
  
  if (host.includes('grok.com')) {
    return sendGrok();
  }
}

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'SET_CURRENT_BUNDLE') {

      if (location.hostname !== 'gemini.google.com') {
        sendResponse({ ok: false });
        return;
      }

      currentBundle = msg.bundle;

      PP_LOG(
        'current bundle updated:',
        currentBundle?.label,
        currentBundle?.files?.length || 0,
        'files'
      );

      const btn = document.getElementById('pp-gemini-inject');
      if (btn) {
        btn.style.display = 'block';
      }

      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'DO_CAPTURE') {
      const bundle = captureBundle(msg.label);
      sendResponse(bundle ? { ok: true, bundle } : { ok: false, error: 'No adapter for this page' });

    } else if (msg.type === 'INJECT_BUNDLE') {
      const result = await injectBundle(msg.bundle);

      if (msg.autoSend) {
        // short buffer before starting platform-specific readiness checks
        await new Promise(r => setTimeout(r, 1000));

        if (
          location.hostname === 'gemini.google.com' &&
          msg.bundle?.files?.length
        ) {
          // wait for Gemini to render attachment chips equal to expected files
          await waitForGeminiAttachments(msg.bundle.files.length);
        }

        PP_LOG('[PromptPorter] AutoSend:', location.hostname);
        await sendCurrentPlatform();
      }

      sendResponse(result);

    } else if (msg.type === 'PING') {
      sendResponse({ ok: true, platform: getAdapter()?.name || 'unknown' });

    } 
    
    // else if (msg.type === 'DEBUG_DUMP') {
    //   const adapter = getAdapter();
    //   sendResponse({
    //     ok: true,
    //     platform: adapter?.name || 'none',
    //     hostname: location.hostname,
    //     textarea: (() => { const e = adapter?.getTextarea(); return e ? { tag: e.tagName, class: e.className?.slice(0,80) } : null; })(),
    //     pendingFiles: Array.from(pendingFiles.keys()),
    //     injectorReady,
    //   });
    // }
  })();
  return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

// function createGeminiActivationProbe() {

//   if (location.hostname !== 'gemini.google.com') {
//     return;
//   }

//   const btn = document.createElement('button');

//   btn.id = 'pp-gemini-probe';

//   btn.textContent = 'PP Gemini Probe';

//   Object.assign(btn.style, {
//     position: 'fixed',
//     bottom: '20px',
//     right: '20px',
//     zIndex: '2147483647',
//     padding: '10px',
//     background: '#ff9800',
//     color: '#fff',
//     border: 'none',
//     borderRadius: '8px',
//     cursor: 'pointer'
//   });

//   btn.addEventListener('click', async () => {

//     console.log(
//       '[PromptPorter] probe UA:',
//       navigator.userActivation?.isActive,
//       navigator.userActivation?.hasBeenActive
//     );

//     const testFiles = [{
//       name: 'test.txt',
//       type: 'text/plain',
//       data: btoa('PromptPorter Gemini Test')
//     }];

//     await ensureInjector();

//     window.dispatchEvent(
//       new CustomEvent('__pp_inject__', {
//         detail: {
//           type: 'FILES',
//           payload: {
//             host: location.hostname,
//             files: testFiles
//           }
//         }
//       })
//     );
//   });

//   document.body.appendChild(btn);
// }

function createGeminiInjectButton() {

  if (location.hostname !== 'gemini.google.com') {
    return;
  }

  if (document.getElementById('pp-gemini-inject')) {
    return;
  }

  const btn = document.createElement('button');

  btn.id = 'pp-gemini-inject';

  btn.textContent = 'Inject Bundle';
  btn.style.display = 'none';

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '10px 14px',
    background: '#1D9E75',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  });

  btn.addEventListener('click', async () => {

    if (!currentBundle) {
      alert('No PromptPorter bundle selected');
      return;
    }

    console.log(
      '[PromptPorter] Gemini inject click UA:',
      navigator.userActivation?.isActive,
      navigator.userActivation?.hasBeenActive
    );

    await ensureInjector();

    window.dispatchEvent(
      new CustomEvent('__pp_inject__', {
        detail: {
          type: 'CLEAR_ATTACHMENTS',
          payload: { host: location.hostname }
        }
      })
    );

    if (currentBundle.text) {

      window.dispatchEvent(
        new CustomEvent('__pp_inject__', {
          detail: {
            type: 'TEXT',
            payload: {
              host: location.hostname,
              text: currentBundle.text
            }
          }
        })
      );
    }

    if (currentBundle.files?.length) {
      isInjecting = true;

      window.dispatchEvent(
        new CustomEvent('__pp_inject__', {
          detail: {
            type: 'FILES',
            payload: {
              host: location.hostname,
              files: currentBundle.files
            }
          }
        })
      );

      setTimeout(() => {
        isInjecting = false;
        btn.style.display = 'none';
        currentBundle = null;
      }, 1500);

    } else {
      btn.style.display = 'none';
      currentBundle = null;
    }
  });

  document.body.appendChild(btn);
}

// createGeminiActivationProbe();
watchFileInputs();

function watchDragAndDrop() {
  document.addEventListener(
    'drop',
    async (e) => {
      if (!e.dataTransfer?.files?.length) {
        return;
      }

      PP_LOG('drop detected:', e.dataTransfer.files.length, 'file(s)');

      for (const file of e.dataTransfer.files) {
        if (pendingFiles.has(file.name)) {
          continue;
        }

        try {
          const data = await blobToBase64(file);
          pendingFiles.set(file.name, {
            name: file.name,
            type: file.type,
            size: file.size,
            data,
          });
          PP_LOG('captured from drop:', file.name);
        } catch (err) {
          console.warn('[PromptPorter] drop capture failed:', file.name, err);
        }
      }
    },
    true
  );

  document.addEventListener(
    'dragover',
    () => {},
    true
  );
}

function watchLargePasteAttachments() {
  document.addEventListener(
    'paste',
    async (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text || text.length < LARGE_PASTE_THRESHOLD) {
        return;
      }

      const pastePayload = {
        text,
        attachmentCount: getAttachmentCount(),
      };
      pendingLargePaste = pastePayload;

      setTimeout(async () => {
        if (pendingLargePaste !== pastePayload) {
          return;
        }

        const newCount = getAttachmentCount();
        if (newCount <= pastePayload.attachmentCount) {
          PP_LOG('large paste remained normal text');
          pendingLargePaste = null;
          return;
        }

        try {
          const safePrefix = pastePayload.text
            .slice(0, 50)
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '_');

          const fileName = `Pasted-${pastePayload.text.length}-${safePrefix}.txt`;

          if (pendingFiles.has(fileName)) {
            pendingLargePaste = null;
            return;
          }

          pendingFiles.set(fileName, {
            name: fileName,
            type: 'text/plain',
            size: pastePayload.text.length,
            data: btoa(unescape(encodeURIComponent(pastePayload.text)))
          });

          PP_LOG('captured pasted attachment:', fileName);
        } catch (err) {
          console.warn('[PromptPorter] failed to capture pasted attachment', err);
        } finally {
          pendingLargePaste = null;
        }
      }, 1000);
    },
    true
  );
}

watchDragAndDrop();
watchLargePasteAttachments();

createGeminiInjectButton();

PP_LOG('content script loaded on', location.hostname);
