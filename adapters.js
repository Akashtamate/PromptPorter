// ─── Prompt Porter · adapters.js ─────────────────────────────────────────────
// Per-platform DOM selectors and inject strategies.
// Keeping this isolated means we can hot-patch selectors without republishing.

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

    getFileInput() {
      return document.querySelector('input[type="file"]');
    },

    getFileDropZone() {
      return (
        document.querySelector('[data-testid="file-drop-zone"]') ||
        document.querySelector('.chat-input-container') ||
        document.querySelector('form') ||
        document.querySelector('main')
      );
    },

    injectText(el, text) {
      el.focus();
      // For ProseMirror contenteditable, use execCommand
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      // Also fire input event for React state sync
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    injectFiles(files, dropZone) {
      return injectViaDataTransfer(files, dropZone);
    },
  },

  'chatgpt.com': {
    name: 'ChatGPT',

    getTextarea() {
      return (
        document.querySelector('#prompt-textarea') ||
        document.querySelector('textarea[data-id="request-:r0:"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea')
      );
    },

    getFileInput() {
      return document.querySelector('input[type="file"]');
    },

    getFileDropZone() {
      return (
        document.querySelector('form') ||
        document.querySelector('.stretch') ||
        document.querySelector('main')
      );
    },

    injectText(el, text) {
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        nativeInputValueSetter?.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },

    injectFiles(files, dropZone) {
      return injectViaDataTransfer(files, dropZone);
    },
  },

  'gemini.google.com': {
    name: 'Gemini',

    getTextarea() {
      return (
        document.querySelector('.ql-editor') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('rich-textarea')
      );
    },

    getFileInput() {
      return document.querySelector('input[type="file"]');
    },

    getFileDropZone() {
      return (
        document.querySelector('.input-area') ||
        document.querySelector('chat-window') ||
        document.querySelector('main')
      );
    },

    injectText(el, text) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    injectFiles(files, dropZone) {
      return injectViaDataTransfer(files, dropZone);
    },
  },

  'grok.com': {
    name: 'Grok',

    getTextarea() {
      return (
        document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]')
      );
    },

    getFileInput() {
      return document.querySelector('input[type="file"]');
    },

    getFileDropZone() {
      return document.querySelector('main') || document.querySelector('form');
    },

    injectText(el, text) {
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        nativeInputValueSetter?.call(el, text);
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    injectFiles(files, dropZone) {
      return injectViaDataTransfer(files, dropZone);
    },
  },

  'www.perplexity.ai': {
    name: 'Perplexity',

    getTextarea() {
      return (
        document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]')
      );
    },

    getFileInput() {
      return document.querySelector('input[type="file"]');
    },

    getFileDropZone() {
      return document.querySelector('main') || document.querySelector('form');
    },

    injectText(el, text) {
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        nativeInputValueSetter?.call(el, text);
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    injectFiles(files, dropZone) {
      return injectViaDataTransfer(files, dropZone);
    },
  },
};

// ── Shared: DataTransfer drop injection ───────────────────────────────────────
// Works by constructing a synthetic drag-and-drop event with real File objects.
// This is the most reliable cross-platform method for custom upload handlers.

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function injectViaDataTransfer(fileDescriptors, dropZone) {
  if (!fileDescriptors || fileDescriptors.length === 0) return { ok: true, count: 0 };

  const dt = new DataTransfer();
  const failures = [];

  for (const fd of fileDescriptors) {
    try {
      if (!fd.data) {
        failures.push(`${fd.name}: no blob data stored`);
        continue;
      }
      const blob = base64ToBlob(fd.data, fd.type);
      const file = new File([blob], fd.name, { type: fd.type });
      dt.items.add(file);
    } catch (err) {
      failures.push(`${fd.name}: ${err.message}`);
    }
  }

  if (dt.files.length === 0) return { ok: false, error: failures.join('; ') };

  const target = dropZone || document.body;

  // Try native file input first (most reliable)
  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput) {
    try {
      Object.defineProperty(fileInput, 'files', {
        value: dt.files,
        writable: true,
        configurable: true,
      });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, count: dt.files.length, method: 'input' };
    } catch (_) {
      // Fall through to drag-and-drop
    }
  }

  // Synthetic drag-and-drop
  target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 80));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));

  return { ok: true, count: dt.files.length, method: 'drop', warnings: failures };
}

// ── Adapter resolver ──────────────────────────────────────────────────────────

function getAdapter() {
  const host = location.hostname;
  return ADAPTERS[host] || null;
}
