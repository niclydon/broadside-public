# Brand Asset Naming Convention

Single source of truth for filenames in the brand-asset library (`media_assets` table plus backing object storage). All uploads must conform; the API rejects non-conformant filenames with 422.

## Pattern

```
<use_case>__<brand>__<platform>__<slug>[__<variant>].<ext>
```

- **`__`** (double underscore) is the field separator
- **`-`** (single dash) is the in-field word separator
- All lowercase ASCII; max 120 chars total

## Field rules

| Field | Required | Allowed values |
|---|---|---|
| `use_case` | yes | One of: `avatar`, `banner`, `hero`, `og-card`, `icon`, `background`, `illustration`, `template`, `monogram`, `other` |
| `brand` | yes | A brand slug from the `brands` table (e.g. `studio`, `lab`), or the reserved token `neutral` for brand-agnostic assets |
| `platform` | yes | A platform identifier (e.g. `web`, `linkedin`, `twitter`, `bluesky`, `github`, `substack`, `youtube`, `facebook`, `instagram`, `macos`, `ios`), or the reserved token `multi` for multi-platform assets |
| `slug` | yes | Human-readable identifier — `[a-z][a-z0-9-]*`. The "what is this thing" part. Examples: `editorial-portrait`, `canonical-portrait`, `favicon-set`, `conference-speaker-badge` |
| `variant` | optional | `[a-z0-9-]+` — distinguishes related files. Examples: `dark`, `light`, `v1`, `v2`, `cropped-1500x500`, `source` |
| `ext` | yes | Lowercase: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `mp4`, `webm` |

## Reserved tokens

- **`neutral`** in the brand position = applies to all brands (brand-agnostic). Cannot be a real brand slug.
- **`multi`** in the platform position = applies across multiple platforms. Cannot be a real platform identifier.

## Validation regex

```js
/^[a-z][a-z0-9-]*__[a-z0-9-]+__[a-z0-9-]+__[a-z][a-z0-9-]*(__[a-z0-9-]+)?\.[a-z0-9]{2,5}$/
```

The TypeScript helper `isValidBrandAssetFilename(name)` in `src/lib/brand-assets.ts` implements this exact rule. The route handler calls it before insert.

## Auto-generation (recommended path)

When uploading, prefer to provide `slug` (and optionally `variant`) instead of a hand-crafted filename. The server composes the canonical name from the metadata you already have to provide:

```
canonicalFilename = `${use_case}__${brand_slug ?? 'neutral'}__${platform ?? 'multi'}__${slug}${variant ? '__' + variant : ''}.${ext}`
```

This is what `buildCanonicalFilename()` in `src/lib/brand-assets.ts` does. The agent and the web UI both use this path so naming stays consistent without anyone having to think about it.

## Examples

### Brand-agnostic, platform-agnostic

```
avatar__neutral__multi__canonical-portrait__dark.png
avatar__neutral__multi__canonical-portrait__light.png
illustration__neutral__multi__cyberpunk-neon-portrait.png
```

### Brand-specific

```
hero__studio__web__editorial-portrait.png
hero__lab__web__terminal-datasheet.png
og_card__studio__web__default.png
template__studio__web__blog-post-hero.png
```

### Platform-specific (brand-agnostic)

```
banner__neutral__twitter__dark__source.png
banner__neutral__twitter__dark__cropped-1500x500.png
banner__neutral__linkedin__presentation__cropped-1584x396.png
banner__neutral__github__terminal-datasheet__cropped-1280x400.png
icon__neutral__web__favicon-set.png
icon__neutral__macos__menubar-glyph.png
```

### External-themed

```
illustration__neutral__multi__conference-speaker-badge.png
illustration__neutral__multi__conference-speaker-badge__v1.png
illustration__neutral__multi__cinematic-3d-bust.png
```

### Variant suffix conventions

Use these standard variant tokens when applicable:

- **Mode**: `dark`, `light`, `duotone`, `monochrome`
- **Revision**: `v1`, `v2`, `v3` (no zero-padding; later versions usually become canonical with no suffix)
- **Crop / size**: `cropped-WIDTHxHEIGHT` (e.g. `cropped-1500x500`)
- **Variant role**: `source` (uncropped original), `thumbnail`, `square`, `landscape`, `portrait`
- **Theme**: `cyberpunk`, `bauhaus`, `risograph`, `art-deco` (or fold into the slug if it's the primary identity)

Avoid mixing variant tokens unless the dimensions are independent. If you find yourself wanting two variant fields, combine them with `-`:

```
banner__neutral__twitter__dark__cropped-1500x500.png
banner__neutral__twitter__source-dark.png  # avoid — fold both into slug or pick one as variant
```

## When the rule is hard to apply

If you can't decide what's the slug vs. what's the variant, ask: *"would I want all the files that share this slug to be returned together when the agent searches?"* If yes, that's the slug. If a token only exists to disambiguate within a slug, that's a variant.

For genuinely-unique one-off assets (e.g. a holiday card art): use a descriptive slug, no variant. Example: `illustration__neutral__multi__holiday-2026-card.png`.

## Don'ts

- Don't include the section letter from the source library (`A1-`, `D2-`, `K7-`). The use_case + slug encode what the section was telling you.
- Don't include redundant context (`-app-ui-palette`, `-presentation-palette`, `-client-name-`) unless it's the primary identity. The brand and platform fields handle most of this.
- Don't use uppercase, spaces, special characters, or non-ASCII (the manga sample `B3-manga-shōnen-cover-frame.png` becomes `illustration__neutral__multi__manga-shonen-cover.png` — no `ō`).
- Don't use forward slashes — those are reserved for the storage path (`brand-assets/YYYY/MM/<uuid>.ext`), not the filename.
- Don't change a filename after upload unless absolutely necessary; existing references (in posts, social media metadata, etc.) may break. The `filename` column is metadata; the storage key (UUID-based, in `storage_path`) is the immutable identity.

## Renaming existing assets

`scripts/rename-brand-assets.ts` walks every `media_assets` row, suggests a canonical filename via heuristic (strips section prefixes, recognizes common variant suffixes, removes redundant context), shows a preview table, and lets you accept-or-edit per-row. Idempotent — re-running over already-renamed assets is a no-op. The storage `storage_path` doesn't change; only the human-facing `filename` column.

## Regenerating the VLM description

When an asset is uploaded, the system best-effort-syncs a one-sentence visual description from local model gateway's `/v1/describe` (Qwen3-VL-8B). If that times out or fails, the description stays NULL and `scripts/backfill-vlm-descriptions.ts` will pick it up on the next run. To re-generate manually for one asset (e.g. after replacing the file or fixing a poor description), call `broadside_regenerate_vlm_description(id)` via MCP or the "Regenerate" button in the web UI.
