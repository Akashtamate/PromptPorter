# Prompt Porter
 
**Capture prompts and file attachments from one AI platform and replay them on any other - in one click.**
 
![Manifest Version](https://img.shields.io/badge/manifest-v3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platforms](https://img.shields.io/badge/platforms-ChatGPT%20%7C%20Claude%20%7C%20Gemini%20%7C%20Grok-orange)
 
---
 
## What it does
 
When you're comparing AI models, you constantly retype the same prompt and re-attach the same files. Prompt Porter eliminates that. It intercepts your prompt text and file attachments, stores them as a **bundle**, and lets you inject that bundle into any supported platform with one click - or open multiple platforms simultaneously for side-by-side comparison.
 
### Key features
 
- **Capture** - snapshot your prompt text and attached files from any supported LLM page
- **Inject** - replay a bundle into a different platform, populating the text field and re-attaching files automatically
- **Compare mode** - open 2-4 platforms in parallel tabs and inject the same bundle into all of them at once, with optional auto-send
- **Keyboard shortcuts** - `Ctrl+Shift+S` / `⌘+Shift+S` to capture, `Ctrl+Shift+V` / `⌘+Shift+V` to inject the latest bundle
- **Local storage only** - bundles are stored in your browser (IndexedDB + `chrome.storage.local`); nothing is sent to any server
- **Auto-expiry** - bundles older than 7 days are pruned automatically; max 20 bundles kept at a time
---
 
## Supported platforms
 
| Platform | Capture | Inject text | Inject files |
|---|---|---|---|
| ChatGPT (`chatgpt.com`) | ✅ | ✅ | ✅ |
| Claude (`claude.ai`) | ✅ | ✅ | ✅ |
| Gemini (`gemini.google.com`) | ✅ | ✅ | ✅ ¹ |
| Grok (`grok.com`) | ✅ | ✅ | ✅ |
 
> ¹ Gemini requires an extra click due to browser security restrictions on file pickers without direct user interaction. After clicking **Inject** in the popup, a green **Inject Bundle** button appears on the Gemini page - click it to complete the injection.
 
---
 
## Installation
 
### From the Chrome Web Store *(recommended)*
 
Search for **Prompt Porter** on the [Chrome Web Store](https://chrome.google.com/webstore) and click **Add to Chrome**.
 
### Manual / developer install
 
1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. The Prompt Porter icon will appear in your toolbar.
---
 
## How to use
 
### Capturing a bundle
 
1. Open any supported AI platform and type your prompt. Attach files if needed.
2. Click the **Prompt Porter** toolbar icon.
3. Optionally enter a label for the bundle.
4. Click **Capture** (or press `Ctrl+Shift+S` / `⌘+Shift+S`).
The bundle is saved locally. A badge briefly confirms the capture.
 
### Injecting into a single platform
 
1. Navigate to your target AI platform.
2. Open the Prompt Porter popup and select a bundle from the list.
3. Click **Inject Here**.
The prompt text and files are automatically inserted into the platform's input area.
 
### Comparing across platforms
 
1. Select a bundle from the list.
2. In the **Compare** section, check the platforms you want to open.
3. Optionally enable **Auto-send** to submit the prompt automatically after injection.
4. Click **Compare**.
Prompt Porter opens a new tab for each selected platform and injects the bundle into all of them.
 
---
 
## File structure
 
```
prompt-porter/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker: storage, routing, keyboard shortcuts
├── content.js          # Content script (isolated world): capture, relay
├── injector.js         # Main-world script: React/Angular-aware text & file injection
├── adapters.js         # Per-platform DOM selectors (used during inject)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic: bundle list, capture, inject, compare
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
 
---
 
## Permissions
 
Prompt Porter requests only the permissions it needs:
 
| Permission | Why |
|---|---|
| `storage` | Saves bundle metadata to `chrome.storage.local` |
| `tabs` | Opens new tabs for compare mode; queries the active tab |
| `activeTab` | Sends messages to the current tab's content script |
| Host permissions for the 4 supported sites | Runs the content script and injects bundles |
 
No network requests are made. No data leaves your browser.
 
---
 
## Privacy
 
All captured data - prompt text and file contents - is stored **locally in your browser only**. See [PRIVACY.md](PRIVACY.md) for the full privacy policy.
 
---
 
## Contributing
 
Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.
 
When adding a new platform:
 
1. Add its hostname to `manifest.json` (`content_scripts` matches and `host_permissions`).
2. Add an adapter entry in `adapters.js` with `getTextarea`, `getFileInput`, `getFileDropZone`, `injectText`, and `injectFiles`.
3. Add a matching entry in the `ADAPTERS` object in `content.js` with `getTextarea`.
4. Add platform-specific injection logic in `injector.js` if needed (React fiber walking, shadow DOM, etc.).
---
 
## License
 
MIT.
 
---
 
*Built by [Akash Tamate](https://github.com/Akashtamate)*
