# Third-party notices

GamingCommunitySuite includes or adapts the third-party works listed below. Each one is used under its own licence,
reproduced here. These credits belong to the source code and the packages; they are not shown in the product's
interface.

## CSS Text Effects

CSS Text Effects by Colorion (https://www.colorion.co), MIT License.

Used in: the name effects of the "Efecte text" category (`packages/core/src/members/nameEffectsText.ts`) and the
matching VIP Studio presets (`packages/plugin-sdk/plugins/vip-studio`). The effects were rewritten for member names:
scoped to the name effect classes, recoloured through the GCS colour variants, measured in `em`, with prefixed
keyframes and `prefers-reduced-motion` support. Each adapted effect carries a short
`/* adapted from CSS Text Effects (MIT) — <effect key> */` comment next to its definition.

```
MIT License

Copyright (c) Colorion

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## CSS Tooltips and CSS Loaders

CSS Tooltips and CSS Loaders by Colorion (https://www.colorion.co), MIT License (the same licence text and copyright
as "CSS Text Effects" above).

Used as inspiration for the system tooltip with the skew entrance (tooltip style #36: `packages/ui/src/controls.css`,
`GcsTooltip`, `GcsTooltipHost`) and for the loaders of the theme setting "Stil loader" (`packages/ui/src/loaders.css`,
`GcsSpinner`). Both were rewritten as GCS CSS: one markup for every loader, colours from the theme tokens, prefixed
keyframes and opacity-only `prefers-reduced-motion` variants. No original source file is shipped.
