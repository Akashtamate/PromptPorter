// ─── Prompt Porter · injector.js ─────────────────────────────────────────────
// Runs in MAIN world. Fixes in this version:
//   1. ChatGPT files  — fake event now includes persist:()=>{} (React 18 removed
//      SyntheticEvent.persist but their handler still calls it).
//   2. Grok text      — walk fiber tree from the *container* div upward, not just
//      the textarea, to find the store-connected onChange. Also clear before set.
//   3. Gemini text    — Quill-like object found on el.__quill is an Angular wrapper,
//      not real Quill. Falls through to execCommand which works correctly.
//   4. File appending — before injecting files, clear existing file chips on
//      Claude and Grok by clicking their remove/× buttons.

(function () {
  'use strict';

  const DEBUG = false;

  function PP(...args) {
    if (DEBUG) {
      console.log('%c[PromptPorter:MAIN]', 'color:#f59e0b;font-weight:bold', ...args);
    }
  }

  // ── React fiber utilities ─────────────────────────────────────────────────

  function getFiber(el) {
    const key = Object.keys(el).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    return key ? el[key] : null;
  }

  function findFiberProp(fiber, predicate) {
    let node = fiber;
    while (node) {
      if (node.memoizedProps) {
        const match = Object.entries(node.memoizedProps).find(([k, v]) => predicate(k, v));
        if (match) return { prop: match[0], fn: match[1], node };
      }
      node = node.return;
    }
    return null;
  }

  // ── Clear existing file attachments ──────────────────────────────────────
  // Scoped to the input/composer area only — never touches sidebar or nav.
  // Each platform gets a root container selector; we only search inside it.

  function clearExistingFiles(host) {
    if (host === 'gemini.google.com') {

      const icons = document.querySelectorAll(
        'mat-icon[data-mat-icon-name="close"]'
      );

      PP(
        'Gemini clearExistingFiles:',
        icons.length,
        'attachment(s)'
      );

      icons.forEach(icon => {
        icon.closest('button')?.click();
      });

      return;
    }

    // Root containers: the element that wraps ONLY the composer/input area.
    // Everything outside this is off-limits.
    const roots = {
      'claude.ai':   'fieldset, form, [data-testid="composer"]',
      'grok.com':    'form, [class*="composer"], [class*="chat-input"], footer, [class*="input-container"]',
      'chatgpt.com': 'form, [class*="composer"], [data-testid*="composer"]',
    };

    // Per-platform button selectors, applied only within the root.
    const btnSelectors = {
      'claude.ai': [
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Delete file" i]',
        '[data-testid*="file"] button',
      ],
      'grok.com': [
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Delete" i]',
        '[class*="attachment"] button',
        '[class*="preview"] button[type="button"]',
      ],
      'chatgpt.com': [
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Delete" i]',
        '[data-testid*="remove"] button',
      ],
    };

    const rootSel = roots[host];
    const sels    = btnSelectors[host] || [];
    if (!rootSel || !sels.length) return 0;

    // Find the narrowest root container that actually exists
    const rootEl = document.querySelector(rootSel);
    if (!rootEl) { PP('clearExistingFiles: no root container found for', host); return 0; }

    let removed = 0;
    for (const sel of sels) {
      rootEl.querySelectorAll(sel).forEach(btn => {
        try { btn.click(); removed++; } catch (_) {}
      });
    }

    if (removed > 0) PP('cleared', removed, 'file chip(s) inside', rootEl.tagName);
    return removed;
  }

  function clearExistingAttachments(host) {
    switch (host) {
      case 'gemini.google.com':
        clearExistingFiles(host);
        return true;
      case 'chatgpt.com':
      case 'claude.ai':
      case 'grok.com':
        return clearExistingFiles(host) !== undefined;
      default:
        return true;
    }
  }

  // ── Text injection ────────────────────────────────────────────────────────

  // React-controlled textarea (Grok).
  // Grok uses a state management store (likely Zustand/Jotai). The textarea's
  // React fiber does NOT have onChange — the value is driven top-down from store
  // state. We must find the React root and trigger a synthetic input event through
  // React's own event delegation system at the document level.
  function injectTextReact(el, text) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    // 1. Set the DOM value via native setter (bypasses React's read-only override)
    if (nativeSetter) nativeSetter.call(el, text);
    else el.value = text;

    // 2. Reset React's value tracker so it sees this as a new value
    if (el._valueTracker) el._valueTracker.setValue('');

    // 3. Log what props the fiber actually has (for debugging)
    const startFiber = getFiber(el);
    if (startFiber) {
      let node = startFiber;
      let depth = 0;
      while (node && depth < 5) {
        const keys = Object.keys(node.memoizedProps || {});
        if (keys.length) PP('Grok fiber depth', depth, 'props:', keys.join(', '));
        node = node.return;
        depth++;
      }
    }

    // 4. Try onChange and onInput in fiber chain
    const found = startFiber
      ? findFiberProp(startFiber, (k, v) =>
          (k === 'onChange' || k === 'onInput') && typeof v === 'function')
      : null;

    if (found) {
      PP('Grok: found', found.prop, 'in fiber, calling');
      found.fn({
        target: el, currentTarget: el, type: 'change',
        persist: () => {}, preventDefault: () => {}, stopPropagation: () => {},
        nativeEvent: { target: el },
      });
      return true;
    }

    // 5. React 17+ uses event delegation on the ROOT container, not the element.
    // Dispatch a synthetic-like InputEvent at document level — React's global
    // handler intercepts it and processes it through the reconciler.
    el.focus();
    const inputEvent = new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      inputType: 'insertText', data: text,
    });
    el.dispatchEvent(inputEvent);
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // 6. Also try firing on the React root element (React 18 attaches listeners there)
    const reactRoot = document.getElementById('__NEXT_DATA__')
      ? document.getElementById('__next') || document.body
      : document.body;
    reactRoot.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));

    PP('Grok: dispatched input via React delegation path');
    return true;
  }

  // Contenteditable (Claude ProseMirror, ChatGPT ProseMirror, Gemini Angular-Quill).
  function injectTextContentEditable(el, text) {
    el.focus();

    // Check for real Quill (has getText method)
    const quill = el.__quill || (window.Quill && window.Quill.find && window.Quill.find(el));
    if (quill && typeof quill.setText === 'function') {
      quill.setText(text);
      quill.setSelection(text.length, 0);
      PP('real Quill setText OK');
      return true;
    }

    // Gemini's __quill is an Angular wrapper — skip it, use execCommand
    // ProseMirror / standard contenteditable
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    PP('contenteditable execCommand OK');
    return true;
  }

  // ── File injection helpers ────────────────────────────────────────────────

  function base64ToFile(b64, name, type) {
    const bin   = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: type || 'application/octet-stream' });
  }

  // Build a complete fake React event that passes ChatGPT/Grok's internal
  // validation. The key addition is `persist: () => {}` for React 18.
  function makeFakeFileEvent(input, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    return {
      target:         { files: dt.files, value: 'C:\\fakepath\\' + (files[0]?.name || 'file') },
      currentTarget:  input,
      type:           'change',
      bubbles:        true,
      persist:        () => {},          // ← React 18: handler calls e.persist(), must not throw
      preventDefault: () => {},
      stopPropagation: () => {},
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      nativeEvent:    { target: { files: dt.files } },
    };
  }

  function callReactFileHandler(input, files) {
    const fiber = getFiber(input);
    if (!fiber) { PP('no fiber on input'); return false; }

    const found = findFiberProp(fiber, (k, v) => k === 'onChange' && typeof v === 'function');
    if (!found) { PP('no onChange in fiber tree'); return false; }

    PP('calling React onChange via fiber (with persist shim)');
    found.fn(makeFakeFileEvent(input, files));
    return true;
  }

  function assignInputFiles(input, files) {
    PP('assigning to input.files directly');
    const dt = new DataTransfer();

    files.forEach(f => dt.items.add(f));

    try {
      const proto =
        Object.getPrototypeOf(input);

      const descriptor =
        Object.getOwnPropertyDescriptor(
          proto,
          'files'
        );

      if (descriptor?.set) {
        descriptor.set.call(
          input,
          dt.files
        );
      } else {
        Object.defineProperty(
          input,
          'files',
          {
            value: dt.files,
            writable: true,
            configurable: true
          }
        );
      }

    } catch (e) {

      Object.defineProperty(
        input,
        'files',
        {
          value: dt.files,
          writable: true,
          configurable: true
        }
      );
    }

    PP(
      '[DIAG] assigned files:',
      dt.files.length
    );

    PP(
      '[DIAG] input.files after assignment:',
      input.files?.length
    );

    input.dispatchEvent(
      new InputEvent(
        'input',
        {
          bubbles: true,
          composed: true
        }
      )
    );

    input.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true
        }
      )
    );

    input.dispatchEvent(
      new Event(
        'blur',
        {
          bubbles: true
        }
      )
    );

    return true;
  }

  // ── ChatGPT ───────────────────────────────────────────────────────────────

  async function injectFilesChatGPT(files) {
    // attachment clearing is handled before injection via CLEAR_ATTACHMENTS
    await new Promise(r => setTimeout(r, 100));

    const input = document.querySelector('input[type="file"]');
    PP('ChatGPT file input:', !!input);
    if (!input) return false;

    if (callReactFileHandler(input, files)) return true;
    return assignInputFiles(input, files);
  }

  // ── Claude ────────────────────────────────────────────────────────────────

  async function injectFilesClaude(files) {
    // attachment clearing is handled before injection via CLEAR_ATTACHMENTS
    await new Promise(r => setTimeout(r, 100));

    // Step 2: find onDrop on ProseMirror / editor wrapper fiber
    const candidates = [
      document.querySelector('div[contenteditable="true"].ProseMirror'),
      document.querySelector('[data-testid="chat-input"]'),
      document.querySelector('div[contenteditable="true"]'),
      document.querySelector('fieldset'),
      document.querySelector('form'),
    ].filter(Boolean);

    for (const el of candidates) {
      const fiber = getFiber(el);
      if (!fiber) continue;
      const found = findFiberProp(fiber, (k, v) => k === 'onDrop' && typeof v === 'function');
      if (found) {
        PP('Claude: found onDrop on fiber:', el.tagName, el.className?.slice(0, 40));
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        found.fn({
          dataTransfer: { files: dt.files, items: dt.items, types: ['Files'] },
          preventDefault: () => {},
          stopPropagation: () => {},
          persist:        () => {},
          target:         el,
          currentTarget:  el,
        });
        return true;
      }
    }

    // Fallback: file input via React onChange (with persist shim)
    const input = document.querySelector('input[type="file"]');
    if (input) {
      PP('Claude: falling back to file input onChange');
      if (callReactFileHandler(input, files)) return true;
      return assignInputFiles(input, files);
    }

    PP('Claude: no injection point found');
    return false;
  }

  // ── Gemini helper ──────────────────────────────────────────────────────────

  function deepQueryAll(root, selector) {
    const results = [...root.querySelectorAll(selector)];

    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        results.push(...deepQueryAll(el.shadowRoot, selector));
      }
    }

    return results;
  }

  async function withBlockedFilePicker(fn) {
    const originalClick = HTMLInputElement.prototype.click;

    HTMLInputElement.prototype.click = function () {
      PP('Gemini: blocked native file picker');
    };

    try {
      return await fn();
    } finally {
      HTMLInputElement.prototype.click = originalClick;
    }
  }

  // ── Gemini ────────────────────────────────────────────────────────────────

  async function injectFilesGemini(files) {
    const existingInputs = deepQueryAll(
      document,
      'input[type="file"]'
    );

    PP(
      '[DIAG] Gemini inputs before ANY click:',
      existingInputs.length
    );

    existingInputs.forEach((el, i) => {
      PP(
        `[DIAG] input ${i}`,
        {
          accept: el.accept,
          multiple: el.multiple,
          display: getComputedStyle(el).display
        }
      );
    });

    let input = deepQueryAll(
      document,
      'input[type="file"]'
    )[0];
    if (input) {
      PP('Gemini: file input already present');
      return assignInputFiles(input, files);
    }

    const uploadToolsBtn = (
      document.querySelector('button[aria-label="Upload and tools"]') ||
      document.querySelector('button[aria-label*="Upload" i]') ||
      document.querySelector('button[aria-label*="Attach" i]') ||
      document.querySelector('.upload-media-button-wrapper button') ||
      document.querySelector('button[data-tooltip*="upload" i]')
    );

    if (!uploadToolsBtn) {
      PP('Gemini: upload button not found');
      return false;
    }

    await new Promise(r => setTimeout(r, 300));

    PP(
      '[DIAG] UA before click:',
      navigator.userActivation?.isActive,
      navigator.userActivation?.hasBeenActive
    );

    PP(
      '[DIAG] inputs before click:',
      deepQueryAll(document, 'input[type="file"]').length
    );

    PP('Gemini: clicking upload button:', uploadToolsBtn.getAttribute('aria-label'));
    uploadToolsBtn.click();
    await new Promise(r => setTimeout(r, 900)); // 900ms — Angular menu animation takes ~600ms

    // Log ALL interactive elements that appeared after the click so we can
    // identify the exact text of the "Upload file" menu item
    const allInteractive = Array.from(document.querySelectorAll(
      '[role="menuitem"], [role="option"], [role="listitem"], [role="menu"] button, [role="menu"] a, mat-menu-item, [class*="menu"] button'
    ));
    PP('Gemini: menu items found after click:', allInteractive.length);
    allInteractive.forEach((el, i) => {
      PP(`  [${i}] tag=${el.tagName} role=${el.getAttribute('role')} text="${el.textContent?.trim().slice(0, 60)}"`);
    });

    // Try to find "Upload file" or "from device" or "from computer"
    const uploadFileItem = allInteractive.find(el => {
      const label = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
      return (
        label.includes('upload file') ||
        label.includes('from device') ||
        label.includes('from computer') ||
        label.includes('local file') ||
        label.includes('your device') ||
        label === 'upload'
      );
    });

    if (uploadFileItem) {
      PP('Gemini: clicking menu item:', uploadFileItem.textContent?.trim());

      await withBlockedFilePicker(async () => {
        uploadFileItem.click();
      });

      PP(
        '[DIAG] UA after Upload Files click:',
        navigator.userActivation?.isActive,
        navigator.userActivation?.hasBeenActive
      );

      PP(
        '[DIAG] upload item connected:',
        uploadFileItem.isConnected
      );

      PP(
        '[DIAG] upload item visible:',
        uploadFileItem.offsetParent !== null
      );

      for (let i = 0; i < 30; i++) {   // poll up to 3 seconds
        await new Promise(r => setTimeout(r, 100));

        const found = deepQueryAll(
          document,
          'input[type="file"]'
        );

        if (found.length) {

          input = found[0];

          const root =
            input.getRootNode();

          PP(
            '[DIAG] input found at',
            (i + 1) * 100,
            'ms'
          );

          PP(
            '[DIAG] root type:',
            root.constructor?.name
          );

          PP(
            '[DIAG] in shadow:',
            root !== document
          );

          PP(
            '[DIAG] host tag:',
            root.host?.tagName
          );

          PP(
            '[DIAG] host class:',
            root.host?.className
          );

          PP(
            '[DIAG] input state:',
            {
              accept: input.accept,
              multiple: input.multiple,
              disabled: input.disabled,
              hidden: input.hidden,
              display:
                getComputedStyle(input).display,
              visibility:
                getComputedStyle(input).visibility
            }
          );

          break;
        }
      }
    } else {
      PP(
        'Gemini: no matching menu item found — waiting for direct input'
      );

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 100));
        input =
          deepQueryAll(
            document,
            'input[type="file"]'
          )[0];

        if (input) {

          PP(
            'Gemini: input appeared at',
            (i + 1) * 100,
            'ms'
          );

          break;
        }
      }
    }

    if (input) {
      PP('Gemini: assigning to input, accept:', input.accept);

      PP(
        '[TEST] input connected:',
        input.isConnected
      );

      PP(
        '[TEST] input value before assignment:',
        input.value
      );

      input.onclick = (e) => {
        PP('[TEST] file input click fired');
      };

      return assignInputFiles(input, files);
    }

    PP('Gemini: file input never appeared');

    PP(
      '[DIAG] final deepQuery count:',
      deepQueryAll(
        document,
        'input[type="file"]'
      ).length
    );

    PP(
      '[DIAG] final UA:',
      navigator.userActivation?.isActive,
      navigator.userActivation?.hasBeenActive
    );

    return false;
  }

  // ── Grok ──────────────────────────────────────────────────────────────────

  async function injectFilesGrok(files) {
    // attachment clearing is handled before injection via CLEAR_ATTACHMENTS
    await new Promise(r => setTimeout(r, 100));

    const input = document.querySelector('input[type="file"]');
    PP('Grok file input:', !!input);
    if (!input) return false;

    if (callReactFileHandler(input, files)) return true;
    return assignInputFiles(input, files);
  }

  // ── Event listener ────────────────────────────────────────────────────────

  window.addEventListener('__pp_inject__', async (e) => {
    const { type, payload } = e.detail;
    PP('received:', type, 'host:', payload.host);

    let result = { ok: false, error: 'unknown' };

    try {
      if (type === 'TEXT') {
        const { text, host } = payload;
        let el, ok = false;

        if (host === 'grok.com') {

          el =
            document.querySelector('[role="textbox"]') ||
            document.querySelector('.tiptap') ||
            document.querySelector('.ProseMirror') ||
            document.querySelector('[contenteditable="true"]');

          ok = el
            ? injectTextContentEditable(el, text)
            : false;

          PP(
            'Grok editor:',
            el?.tagName,
            el?.getAttribute('role'),
            el?.className?.slice(0, 80)
          );

        } else if (host === 'gemini.google.com') {
          // Gemini: __quill is an Angular wrapper, not real Quill — use execCommand path
          el = document.querySelector('.ql-editor') || document.querySelector('[contenteditable="true"]');
          ok = el ? injectTextContentEditable(el, text) : false;

        } else if (host === 'chatgpt.com') {
          el = document.querySelector('#prompt-textarea') ||
               document.querySelector('div[contenteditable="true"]') ||
               document.querySelector('textarea');
          ok = el
            ? (el.tagName === 'TEXTAREA' ? injectTextReact(el, text) : injectTextContentEditable(el, text))
            : false;

        } else {
          // Claude + others: ProseMirror contenteditable
          el = document.querySelector('div[contenteditable="true"].ProseMirror') ||
               document.querySelector('[contenteditable="true"]');
          ok = el ? injectTextContentEditable(el, text) : false;
        }

        PP('text result:', ok, el?.tagName, el?.className?.slice(0, 40));
        result = { type: 'TEXT', ok };

      } else if (type === 'FILES') {
        const { files: fds, host } = payload;
        const files = fds.map(f => base64ToFile(f.data, f.name, f.type));
        PP('building', files.length, 'File objects for', host);

        let ok = false;
        if      (host === 'chatgpt.com')       ok = await injectFilesChatGPT(files);
        else if (host === 'claude.ai')          ok = await injectFilesClaude(files);
        else if (host === 'gemini.google.com')  ok = await injectFilesGemini(files);
        else if (host === 'grok.com')           ok = await injectFilesGrok(files);
        else                                    ok = await injectFilesChatGPT(files);

        result = { type: 'FILES', ok };
      } else if (type === 'CLEAR_ATTACHMENTS') {
        const { host } = payload;
        const ok = clearExistingAttachments(host);
        result = { type: 'CLEAR_ATTACHMENTS', ok };
      }
    } catch (err) {
      PP('ERROR:', err.message, err.stack?.split('\n')[1]);
      result = { type, ok: false, error: err.message };
    }

    window.dispatchEvent(new CustomEvent('__pp_result__', { detail: result }));
  });

  PP('ready on', location.hostname);
})();
