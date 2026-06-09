// ─── Prompt Porter · popup.js ─────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

let bundles = [];
let selectedBundleId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ` ${type}` : '');
  if (type === 'success' || type === 'error') {
    setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
  }
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function truncate(str, n = 80) {
  return str && str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Platform detection ────────────────────────────────────────────────────────

async function detectPlatform() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      const badge = $('platform-badge');
      badge.textContent = res.platform;
      badge.classList.add('detected');
    });
  } catch (_) {}
}

// ── Render bundles ────────────────────────────────────────────────────────────

function renderBundles() {
  const list = $('bundle-list');

  if (!bundles.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No bundles yet</div>
        <div class="empty-hint">Open an LLM, type your prompt, attach files,<br>then hit Capture.</div>
      </div>`;
    hideActionBar();
    return;
  }

  list.innerHTML = bundles.map((b) => {
    const files = b.files || [];
    const fileChips = files.slice(0, 3).map((f) =>
      `<span class="file-chip" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>`
    ).join('');
    const moreFiles = files.length > 3 ? `<span class="file-chip">+${files.length - 3}</span>` : '';
    const isSelected = b.id === selectedBundleId;

    return `
      <div class="bundle-item${isSelected ? ' selected' : ''}" data-id="${b.id}">
        <div class="bundle-header">
          <span class="bundle-label">${escapeHtml(b.label || 'Untitled bundle')}</span>
          <div class="bundle-meta">
            <span class="source-tag">${escapeHtml(b.source || '?')}</span>
            <button class="delete-btn" data-id="${b.id}" title="Delete">×</button>
          </div>
        </div>
        ${b.text ? `<div class="bundle-preview">${escapeHtml(truncate(b.text))}</div>` : ''}
        <div class="bundle-footer">
          <div class="file-chips">${fileChips}${moreFiles}</div>
          <span class="time-label">${relativeTime(b.createdAt)}</span>
        </div>
      </div>`;
  }).join('');

  // Click handlers
  list.querySelectorAll('.bundle-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;
      selectBundle(el.dataset.id);
    });
  });

  list.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBundle(btn.dataset.id);
    });
  });
}

function selectBundle(id) {
  selectedBundleId = id;
  renderBundles();
  showActionBar(id);
}

function showActionBar(id) {
  const bundle = bundles.find((b) => b.id === id);
  if (!bundle) return;
  $('action-bar').classList.add('visible');
  $('action-label').textContent = bundle.label || 'Untitled bundle';
  $('compare-section').style.display = 'block';
}

function hideActionBar() {
  $('action-bar').classList.remove('visible');
  $('compare-section').style.display = 'none';
}

// ── Load bundles ──────────────────────────────────────────────────────────────

async function loadBundles() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_BUNDLES' });
  if (res && res.ok) {
    bundles = res.bundles || [];
    renderBundles();
  }
}

// ── Capture ───────────────────────────────────────────────────────────────────

$('capture-btn').addEventListener('click', async () => {
  const label = $('bundle-label').value.trim();
  $('capture-btn').disabled = true;
  setStatus('Capturing…');

  const res = await chrome.runtime.sendMessage({
    type: 'CAPTURE_FROM_TAB',
    label
  });

  $('capture-btn').disabled = false;

  if (!res || !res.ok) {
    setStatus(res?.error || 'Capture failed. Are you on a supported LLM page?', 'error');
    return;
  }

  // Label is passed to capture; background saves the bundle with label.

  $('bundle-label').value = '';
  await loadBundles();

  const files = res.bundle?.files?.length || 0;
  const text = res.bundle?.text ? 'prompt text' : '';
  const parts = [text, files > 0 ? `${files} file(s)` : ''].filter(Boolean);
  setStatus(`Captured: ${parts.join(' + ') || 'empty bundle'}`, 'success');
});

// ── Inject here ───────────────────────────────────────────────────────────────

$('inject-here-btn').addEventListener('click', async () => {

  if (!selectedBundleId) {
    return;
  }

  const bundleRes = await chrome.runtime.sendMessage({
    type: 'GET_BUNDLE_WITH_FILES',
    bundleId: selectedBundleId
  });

  if (!bundleRes?.ok) {
    setStatus('Bundle load failed', 'error');
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab) {
    return;
  }

  const isGemini =
    tab.url?.includes('gemini.google.com');

  if (isGemini) {
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: 'SET_CURRENT_BUNDLE',
        bundle: bundleRes.bundle
      }
    );

    setStatus(
      'Bundle armed. Click PromptPorter Inject on Gemini.',
      'success'
    );
  } else {
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: 'INJECT_BUNDLE',
        bundle: bundleRes.bundle
      }
    );

    setStatus(
      'Injected successfully.',
      'success'
    );

    window.close();
  }
});

// ── Copy text ─────────────────────────────────────────────────────────────────

$('copy-text-btn').addEventListener('click', async () => {
  const bundle = bundles.find((b) => b.id === selectedBundleId);
  if (!bundle || !bundle.text) {
    setStatus('No text in this bundle', 'error');
    return;
  }
  await navigator.clipboard.writeText(bundle.text);
  setStatus('Text copied to clipboard', 'success');
});

// ── Delete selected ───────────────────────────────────────────────────────────

$('delete-selected-btn').addEventListener('click', () => {
  if (selectedBundleId) deleteBundle(selectedBundleId);
});

async function deleteBundle(id) {
  await chrome.runtime.sendMessage({ type: 'DELETE_BUNDLE', bundleId: id });
  if (selectedBundleId === id) {
    selectedBundleId = null;
    hideActionBar();
  }
  await loadBundles();
  setStatus('Bundle deleted', 'success');
}

// ── Compare mode ──────────────────────────────────────────────────────────────

document.querySelectorAll('.platform-toggle').forEach((label) => {
  label.addEventListener('click', () => {
    const input = label.querySelector('input');
    input.checked = !input.checked;
    label.classList.toggle('active', input.checked);
  });
});

$('compare-btn').addEventListener('click', async () => {
  if (!selectedBundleId) return;

  const platforms = Array.from(document.querySelectorAll('.platform-toggle input:checked'))
    .map((cb) => cb.value);

  if (!platforms.length) {
    setStatus('Select at least one platform', 'error');
    return;
  }

  const autoSend = $('auto-send')?.checked || false;

  $('compare-btn').disabled = true;
  setStatus('Opening tabs…');

  const res = await chrome.runtime.sendMessage({
    type: 'INJECT_INTO_ALL',
    bundleId: selectedBundleId,
    platforms,
    autoSend,
  });

  $('compare-btn').disabled = false;

  if (!res || !res.ok) {
    setStatus(res?.error || 'Failed to open tabs', 'error');
  } else {
    setStatus(`Opened in ${platforms.length} platform(s)`, 'success');
    window.close();
  }
});

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();

    const capture = commands.find(
      c => c.name === 'capture-bundle'
    );

    const inject = commands.find(
      c => c.name === 'inject-bundle'
    );

    if (capture?.shortcut) {
      $('capture-shortcut').textContent =
        capture.shortcut;
    }

    if (inject?.shortcut) {
      $('inject-shortcut').textContent =
        inject.shortcut;
    }

  } catch (err) {
    console.error(err);
  }
}

// ── Debug dump ────────────────────────────────────────────────────────────────
// Triggered by clicking the platform badge. Dumps a snapshot to the console
// of the active tab — open DevTools on the LLM page to see [PromptPorter] logs.

// $('platform-badge').style.cursor = 'pointer';
// $('platform-badge').title = 'Click to run debug dump (check DevTools console on the LLM tab)';
// $('platform-badge').addEventListener('click', async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   if (!tab) return;
//   chrome.tabs.sendMessage(tab.id, { type: 'DEBUG_DUMP' }, (res) => {
//     if (chrome.runtime.lastError) {
//       setStatus('Debug failed: ' + chrome.runtime.lastError.message, 'error');
//       return;
//     }
//     console.log('[PromptPorter popup] DEBUG_DUMP result:', res);
//     setStatus(`Debug dumped — open DevTools on the LLM tab (Console, filter: PromptPorter)`, '');
//   });
// });

// ── Init ──────────────────────────────────────────────────────────────────────

detectPlatform();
loadBundles();
loadShortcuts();
