# Privacy Policy — Prompt Porter
 
**Last updated: June 2026**
 
---
 
## Overview
 
Prompt Porter is a Chrome browser extension that captures prompt text and file attachments from AI chat platforms and allows you to replay them on other platforms. This policy explains what data the extension handles, how it is stored, and your rights regarding that data.
 
**Short version:** Everything stays on your device. Prompt Porter does not collect, transmit, or share any data with anyone.
 
---
 
## What data the extension handles
 
When you use the Capture feature, Prompt Porter temporarily stores:
 
- **Prompt text** — the text you have typed into an AI platform's input field at the time of capture.
- **File attachments** — files you have attached to a prompt (images, PDFs, text files, etc.), stored as base64-encoded binary data.
- **Bundle metadata** — a label (which you may set yourself, or which defaults to the source platform name), the source platform name, and the timestamp of the capture.
---
 
## Where data is stored
 
All data is stored **locally on your device only**, using two browser-native storage mechanisms:
 
- **`chrome.storage.local`** — stores bundle metadata (label, source, timestamp, and file names without content).
- **IndexedDB** — stores file content (base64-encoded binary data), keyed by bundle ID and file name.
No data is written to any external server, cloud service, or third-party storage. No analytics, telemetry, crash reporting, or usage tracking of any kind is implemented.
 
---
 
## Data the extension does NOT collect
 
Prompt Porter does not collect or access:
 
- Your identity, name, or email address
- Your browsing history
- Your account credentials or session tokens on any AI platform
- Conversation history or AI responses (only your input text is captured)
- Any data from pages other than the four supported AI platforms (`chatgpt.com`, `claude.ai`, `gemini.google.com`, `grok.com`)
---
 
## Data retention and deletion
 
Bundles are automatically deleted after **7 days**. The extension retains a maximum of **20 bundles** at any time; the oldest bundle is deleted when this limit is exceeded.
 
You may delete any bundle at any time from within the extension popup using the delete (×) button on each bundle, or by deleting all extension data via Chrome's built-in storage management (`chrome://settings/siteData`).
 
Uninstalling the extension removes all associated `chrome.storage.local` and IndexedDB data.
 
---
 
## Permissions used and why
 
| Permission | Purpose |
|---|---|
| `storage` | Saves bundle metadata locally via `chrome.storage.local` |
| `tabs` | Opens new tabs when using Compare mode; queries the currently active tab to send messages to the content script |
| `activeTab` | Communicates with the content script running on the current AI platform tab |
| Host access for `chatgpt.com`, `claude.ai`, `gemini.google.com`, `grok.com` | Runs the content script that reads the input field and injects bundles on these sites only |
 
No permission is used for any purpose beyond what is described above.
 
---
 
## Third-party services
 
Prompt Porter does not integrate with, send data to, or load resources from any third-party service. All extension code runs locally in your browser.
 
---
 
## Children's privacy
 
Prompt Porter is a general-purpose developer tool not directed at children. It does not knowingly collect data from anyone, including minors.
 
---
 
## Changes to this policy
 
If this policy is materially updated, the "Last updated" date at the top will be revised. Continued use of the extension after an update constitutes acceptance of the revised policy.
 
---
 
## Contact
 
If you have questions about this policy, please open an issue on the [GitHub repository](https://github.com/Akashtamate/PromptPorter).
