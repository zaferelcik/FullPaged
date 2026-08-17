# FullPaged Privacy Policy

**No data is collected or transmitted; all processing is local.**

- FullPaged makes **zero network requests**. There is no analytics, telemetry, crash reporting, account system, or remote code. An automated build gate scans the shipped code for network primitives and fails if any appear.
- Screenshots are processed entirely on your device and stored temporarily in the extension's local IndexedDB (pruned automatically after 24 hours). They are shown to you in a local preview page and saved only where you choose.
- Settings (format, quality, file name template, delay) are stored in `chrome.storage.local` on your device.
- The extension can only access a page when **you** invoke it on that tab (`activeTab`); it holds no standing host permissions.

Questions: open an issue on the repository.

*Last updated: 2026-08-17*
