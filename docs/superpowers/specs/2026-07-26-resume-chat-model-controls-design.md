# Résumé and AIMeer model controls

## Goal

Improve the small-screen navigation and AIMeer controls without changing the site’s visual language or its three-tier answer fallback.

## Design

### Résumé download control

The top navigation résumé link remains a real download link and is icon-only at every width, including wide screens. It uses a download-arrow-into-tray SVG, with an accessible label and tooltip text identifying the action as “Download résumé PDF”. The tooltip is revealed once on page load so touch users receive the affordance without hover; it remains available on hover and keyboard focus, and can be dismissed. The hero, contact, and modal résumé links retain their existing text labels.

### Button press feedback

Buttons and button-like links receive a shared, short `:active` treatment using a subtle scale-down, brightness adjustment, and shadow change. Existing hover behavior remains intact. The interaction is disabled under `prefers-reduced-motion: reduce` while preserving the focus ring.

### AIMeer model switcher

The chat header gains a compact two-state segmented control (option A) with a cloud icon for secure cloud AI and a chip/device icon for on-device AI. The selected state uses the existing teal accent and panel tokens; the unselected state uses the existing line/muted tokens. The control is usable with pointer, touch, and keyboard input, and exposes the active mode through `aria-pressed` and an accessible label.

The switch remains visible on every device. If local AI is not eligible, its local segment is visually unavailable but not disabled in a way that prevents explanation: activating or focusing it exposes a tooltip stating that this device is not compatible with local AI and that cloud AI remains available.

### Device eligibility and routing

The existing WebGPU adapter and buffer checks remain necessary. Routing additionally applies these rules:

- iOS and iPadOS always use cloud AI.
- Desktop WebGPU devices can use local AI when the adapter passes the existing memory check.
- Android local AI is allowed only when the user agent matches a conservative flagship-family allowlist: Samsung Galaxy S/Z, Google Pixel Pro/XL/Fold, OnePlus numbered flagships, OPPO Find X/N, vivo X/X Fold, HONOR Magic, Xiaomi Ultra/Pro Max, Huawei Pura/Mate, ASUS ROG/Zenfone, Sony Xperia 1, or REDMAGIC.
- Unknown, mid-range, and low-range Android devices default to cloud even if WebGPU is available.
- Data-saver connections continue to prefer cloud.

The visitor’s explicit mode choice is persisted. Selecting cloud cancels an active local download and routes subsequent requests through the Worker. Selecting local starts the local model only when eligible; otherwise it leaves the current cloud route unchanged and shows the compatibility tooltip. Existing timeout and local-failure fallback behavior remains intact.

## Data flow and state

The switcher reads the same `route`, `aiState`, `dlActive`, `localOK`, and `cloudOk` state already used by `applyAiBox()` and the launcher ring. A small synchronization function updates selected styles, labels, and tooltip state whenever routing changes. No new external dependency is introduced.

## Accessibility and theme behavior

All new icon-only controls have accessible names. Tooltips are rendered with CSS using the current `--panel`, `--paper`, `--line`, `--teal`, and `--shadow` variables so they work in both explicit and system-selected light/dark themes. Focus-visible states remain visible. Reduced-motion users receive no reveal, scale, or tooltip animation.

## Verification

Verify with the site served on port 8080 at 375, 768, and 1440px widths; check both themes, keyboard focus, touch-oriented tooltip visibility, the résumé download URL, and model switch behavior for desktop, iOS, recognized Android, and unknown Android user-agent conditions. Run JavaScript syntax checks and targeted routing tests using a lightweight Node/browser-compatible harness if the repository has no test runner.
