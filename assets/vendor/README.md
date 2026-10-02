Vendored parser assets for recruiter-side JD extraction:

- `pdfjs/pdf.min.mjs`
- `pdfjs/pdf.worker.min.mjs`
- `jszip/jszip.min.js`

Vendored renderer for the route globe (`assets/js/route-globe.js`):

- `three/three.module.min.js` — the ESM entry; it imports `./three.core.min.js`
  relatively, so the two files must stay side by side.
- `three/three.core.min.js`

Vendored animation library for the page choreography (`assets/js/motion.js`) and the
RetailAIM IR showcase (`assets/js/ir-showcase.js`):

- `gsap/gsap.min.js` — the core; its UMD build sets `window.gsap`.
- `gsap/ScrollTrigger.min.js`, `gsap/SplitText.min.js` — plugins, registered by `motion.js`.

  Plain classic `<script defer>` tags, loaded after `route-globe.js` and before `motion.js`.
  Like three.js they are pinned by path, not by `?v=`: a version bump replaces the files and
  this README. Both consumer scripts treat a missing `window.gsap` as "no motion" and leave
  the page in its static, fully visible state.

Pinned versions:

- GSAP `3.15.0` — `dist/gsap.min.js`, `dist/ScrollTrigger.min.js` and `dist/SplitText.min.js`
  copied unmodified from the npm tarball `gsap-3.15.0.tgz`
  (sha512 `dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==`).

- PDF.js `4.10.38`
- JSZip `3.10.1`
- three.js `0.185.1` (r185) — `build/three.module.min.js` and `build/three.core.min.js`
  copied unmodified from the npm tarball `three-0.185.1.tgz`
  (sha512 `5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==`).
  The fat-line addon is vendored alongside, unmodified, from the same tarball's
  `examples/jsm/lines/`:

  - `three/lines/Line2.js`, `three/lines/LineSegments2.js`, `three/lines/LineGeometry.js`,
    `three/lines/LineSegmentsGeometry.js`, `three/lines/LineMaterial.js`

  They import the bare specifier `three`, which `index.html` resolves with an inline
  `<script type="importmap">` to `./assets/vendor/three/three.module.min.js` — the exact
  URL `route-globe.js` imports itself, so only one copy of three.js ever loads. Do not
  add `?v=` to either side of that mapping. `OrbitControls` and the other addons are
  still deliberately not vendored; the globe's drag-to-orbit is a small additive offset
  in `route-globe-core.js`.

Upstream license notices recorded from the distributed files:

```text
PDF.js
/**
 * @licstart The following is the entire license notice for the
 * JavaScript code in this page
 *
 * Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @licend The above is the entire license notice for the
 * JavaScript code in this page
 ```

```text
JSZip
/*!
JSZip v3.10.1 - A JavaScript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.

JSZip uses the library pako released under the MIT license :
https://github.com/nodeca/pako/blob/main/LICENSE
*/
```

```text
GSAP
/*!
 * GSAP 3.15.0
 * https://gsap.com
 *
 * @license Copyright 2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license.
 * @author: Jack Doyle, jack@greensock.com
 */
```

GSAP's standard license is the "no charge" license (all plugins, including SplitText, free
for commercial and personal use since 3.13): https://gsap.com/standard-license.

```text
three.js
/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
```
