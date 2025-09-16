# Design Agent: Template Manifest v1.0 and SVG Token Conventions

Baseline constraints (agreed):

- Output: PNG only
- Size: 1080x1080 (square)
- Crop: center-crop by default
- Template reference: URL pair (manifest.json + template.svg)
- Fonts: Google Fonts only

Goals:

- Deterministic server-side rendering with minimal dependencies
- Designer-friendly authoring (export SVG from design tools, add tokens)
- Safe and portable templates (no scripts, sandboxed features only)

Template asset structure

Each template consists of:

- A manifest JSON describing variables, canvas, fonts, and constraints
- An SVG overlay that uses Mustache-like tokens for dynamic content

Storage model:

- The client profile stores URLs to the manifest and SVG (no inline large blobs)
- The agent fetches both at runtime, sanitizes the SVG, substitutes variables, and renders to PNG

1. Template Manifest v1.0

Purpose: canonical definition of variables, font deps, canvas geometry, and supported ratios.

Shape (descriptive, not authoritative):

{
  "id": "client-default-1080-square",
  "version": "1.0",
  "name": "Brand Square Default",
  "description": "Square template with headline bar and byline",
  "svgUrl": "https://cdn.example.com/templates/brand-square.svg",
  "canvas": { "width": 1080, "height": 1080 },
  "variables": {
    "headline": { "required": true, "maxChars": 70, "transform": "none", "wrap": "no-wrap" },
    "byline":   { "required": false, "maxChars": 120, "transform": "none", "wrap": "wrap" },
    "palette.primary":   { "default": "#0055FF" },
    "palette.onPrimary": { "default": "#FFFFFF" }
  },
  "fonts": [
    { "family": "Inter", "weights": [400, 600], "styles": ["normal"] }
  ],
  "supportedRatios": ["1:1"],
  "safety": { "maxPx": 1080, "allowExternalImages": false }
}

Notes:

- variables supports dot paths to group brand colors (palette.*)
- fonts lists Google families; renderer will embed appropriate WOFF2 at runtime
- safety.maxPx caps total canvas dimensions to prevent memory abuse

2. SVG token conventions

Use double-curly tokens in attributes or text nodes:

- {{headline}}, {{byline}}, {{palette.primary}}
- {{photo}} is a special token used as an <image> href to inject the cropped photo

Example SVG overlay:

<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style><![CDATA[
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url('{{__font.Inter.400.woff2}}') format('woff2');
      }
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 600;
        src: url('{{__font.Inter.600.woff2}}') format('woff2');
      }
    ]]></style>
  </defs>
 
  <image id="photo" href="{{photo}}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice" />

  <rect x="0" y="780" width="1080" height="300" fill="{{palette.primary}}" opacity="0.88"/>
  <text id="headline" x="60" y="870" font-family="Inter" font-weight="600" font-size="72" fill="{{palette.onPrimary}}">{{headline}}</text>
  <text id="byline" x="60" y="950" font-family="Inter" font-weight="400" font-size="36" fill="{{palette.onPrimary}}">{{byline}}</text>
</svg>

Special internal tokens:

- {{__font.FAMILY.WEIGHT.woff2}} will be replaced by a data: URL (WOFF2) for Google fonts
- These are not exposed in the manifest; they are automatically injected by the renderer

3. Rendering pipeline (server)

- Fetch manifest.json and SVG by URL
- Fetch Google Fonts (WOFF2) for requested families/weights and map to {{__font.*}} tokens
- Download source visual, center-crop to 1080x1080 using sharp with fit: cover
- Convert cropped image to data URI; substitute {{photo}} and text/palette tokens in SVG
- Sanitize final SVG (strip scripts, external refs, restrict attributes)
- Rasterize to PNG 1080x1080 using sharp
- Save to assets and return asset URL/ID

4. Sanitization rules (SVG)

Allowed:
- Shapes: rect, circle, ellipse, line, polyline, polygon, path
- Text elements: text, tspan
- Images: image (with data: URI only)
- Grouping: g, defs, style

Disallowed/removed:
- script, foreignObject, animate*, filter with external refs, event handlers (on*)
- External href/src except fonts; images must be data: URIs after substitution

5. Fonts (Google only)

- Define families/weights in manifest fonts[]
- The renderer downloads WOFF2 from fonts.gstatic.com and embeds as data: URLs
- Do not use @import URLs inside SVG; rely on {{__font.*}} injection

6. Client profile integration

Extend client profile JSON with:

{
  "designTemplates": [
    {
      "id": "client-default-1080-square",
      "name": "Brand Square Default",
      "manifestUrl": "https://cdn.example.com/templates/brand-square.manifest.json",
      "svgUrl": "https://cdn.example.com/templates/brand-square.svg"
    }
  ],
  "defaultDesignTemplateId": "client-default-1080-square"
}

7. Agent instruction shape (for orchestrator -> design agent)

{
  "crop": { "aspectRatio": "1:1", "mode": "center" },
  "templateRef": { "id": "client-default-1080-square" },
  "sourceVisualUrl": "https://cdn.example.com/assets/abc123.jpg",
  "fields": {
    "headline": "Nice weather",
    "byline": "Summer holidays",
    "palette": { "primary": "#0055FF", "onPrimary": "#FFFFFF" }
  },
  "output": { "format": "png", "size": { "width": 1080, "height": 1080 } }
}

8. Example manifest (v1.0)

{
  "id": "client-default-1080-square",
  "version": "1.0",
  "name": "Brand Square Default",
  "description": "Square template with headline bar and byline",
  "svgUrl": "https://cdn.example.com/templates/brand-square.svg",
  "canvas": { "width": 1080, "height": 1080 },
  "variables": {
    "headline": { "required": true, "maxChars": 70 },
    "byline": { "required": false, "maxChars": 120 },
    "palette.primary": { "default": "#0055FF" },
    "palette.onPrimary": { "default": "#FFFFFF" }
  },
  "fonts": [
    { "family": "Inter", "weights": [400, 600], "styles": ["normal"] }
  ],
  "supportedRatios": ["1:1"],
  "safety": { "maxPx": 1080, "allowExternalImages": false }
}

9. Example SVG (tokenized)

<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style><![CDATA[
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url('{{__font.Inter.400.woff2}}') format('woff2'); }
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 600; src: url('{{__font.Inter.600.woff2}}') format('woff2'); }
    ]]></style>
  </defs>
  <image id="photo" href="{{photo}}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice" />
  <rect x="0" y="780" width="1080" height="300" fill="{{palette.primary}}" opacity="0.88"/>
  <text id="headline" x="60" y="870" font-family="Inter" font-weight="600" font-size="72" fill="{{palette.onPrimary}}">{{headline}}</text>
  <text id="byline" x="60" y="950" font-family="Inter" font-weight="400" font-size="36" fill="{{palette.onPrimary}}">{{byline}}</text>
</svg>

10. Minimal renderer contract

Inputs:
- instruction: templateRef + fields + sourceVisualUrl
- clientProfile: designTemplates + defaultDesignTemplateId

Outputs:
- asset: { url, id, type: "image/png", meta: { templateId, manifestUrl, svgUrl } }

Failure modes:
- Missing required variable -> validation error
- SVG unsafe content -> sanitization error
- Fonts unavailable -> fallback to system sans or error (configurable)

Mermaid: render flow

flowchart LR
  A[Instruction] --> B[Fetch manifest + svg]
  B --> C[Fetch Google fonts WOFF2]
  C --> D[Download source visual]
  D --> E[Center-crop 1080x1080]
  E --> F[Substitute tokens into SVG]
  F --> G[Sanitize SVG]
  G --> H[Rasterize to PNG]
  H --> I[Save to assets]
  I --> J[Return asset URL/ID]