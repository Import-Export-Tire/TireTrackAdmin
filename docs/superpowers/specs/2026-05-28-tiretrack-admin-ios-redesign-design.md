# TireTrack Admin — iOS Redesign — Design

**Status:** Draft — awaiting implementation
**Author:** Andy Barrows (drafted with Claude)
**Date:** 2026-05-28
**Repo affected:** `TireTrackAdmin`

## Summary

Restyle the TireTrack Admin web application to use an iOS-native visual aesthetic — light mode, system font, white grouped-list cards, iOS color palette (system blue, system red, etc.), generous rounded corners, hairline borders. Pattern matches the IECentral admin app. Implementation uses shadcn/ui as the component foundation, customized with iOS theming.

## Motivation

TireTrack Admin currently uses a dark slate aesthetic built from ad-hoc Tailwind classes. The user (Andy) has standardized on an iOS aesthetic for admin/data UIs (see `feedback-admin-ios-styling` memory) — IECentral and other admin/data apps in his ecosystem already follow it. TT Admin is the outlier. Adopting the same look:

1. Reduces context-switching for the user when moving between admin apps
2. Replaces ad-hoc styling with a maintainable component library
3. Pulls structured components in (Radix + shadcn) so future devs/AI agents have a standard pattern to extend

## Non-goals

- Dark mode (Andy chose light-only; warehouse use under bright lighting; no value in dark)
- Global sidebar navigation (Andy chose per-page back-button nav — keeps the simple page-as-a-unit model)
- WMS pages (`/wms`, `/wms/inventory`, `/wms/transactions`, `/wms/floor-builder`) — these have un-merged WMS work in progress; redesigning them now would either bundle WMS into this PR or create conflicts when WMS lands. Deferred to a follow-up PR after WMS feature ships.
- Accessibility audit beyond what Radix/shadcn give by default
- Responsive-design overhaul beyond Tailwind defaults
- Backend / data-model changes (none required)

## Design

### Section 1 — Design system foundation

#### `app/globals.css`

Replace the current Geist + slate setup with an iOS theme based on IECentral's palette (light variables only):

```css
@import "tailwindcss";

@theme {
  --color-ios-blue: #007AFF;
  --color-ios-green: #34C759;
  --color-ios-red: #FF3B30;
  --color-ios-orange: #FF9500;
  --color-ios-yellow: #FFCC00;
  --color-ios-purple: #AF52DE;
  --color-ios-gray1: #8E8E93;
  --color-ios-gray2: #AEAEB2;
  --color-ios-gray3: #C7C7CC;
  --color-ios-gray4: #D1D1D6;
  --color-ios-gray5: #E5E5EA;
  --color-ios-gray6: #F2F2F7;

  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-2xl: 20px;
  --radius-3xl: 28px;

  --shadow-ios: 0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04), 0 4px 12px -2px rgba(0,0,0,0.06);
  --shadow-ios-lg: 0 0 0 0.5px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.05), 0 12px 28px -6px rgba(0,0,0,0.10);
}

body {
  background-color: #F2F2F7;
  color: #000;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
    "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  letter-spacing: -0.011em;
}

h1, h2, h3, h4 { letter-spacing: -0.022em; font-weight: 600; }
```

#### `app/layout.tsx`

- Remove the Geist `<font>` import — it injects a custom font that fights the system stack.
- Keep `<ConvexProvider>`, `<Protected>` patterns, and existing structure.
- Add `<Toaster />` from sonner inside the root layout for app-wide toast support.

#### shadcn/ui foundation

```
pnpm dlx shadcn@latest init
```

Configure `components.json`:
- `style: "default"`
- `tailwind.cssVariables: false` (use raw iOS hex values, not abstract HSL slots)
- `aliases.components: "components/ui"`
- `aliases.utils: "lib/utils"`

This generates `lib/utils.ts` (with the `cn()` helper that merges Tailwind classes via `tailwind-merge`), `components.json`, and primes Tailwind for shadcn component generation.

### Section 2 — Component inventory + iOS theming pattern

#### shadcn components installed

| Component | Why | iOS treatment summary |
|---|---|---|
| `button` | Replaces ad-hoc buttons across all pages | `rounded-2xl`, 44px min-height, `bg-ios-blue` primary / `bg-white border-ios-gray5` secondary / `bg-ios-red` destructive, system font |
| `card` | Groups content; replaces dark slate panels | White bg, `rounded-2xl`, `shadow-ios`, no border |
| `dialog` | Modals (returns detail, edit, image lightbox) | Centered, `rounded-3xl`, `shadow-ios-lg`, backdrop blur |
| `input` | Text inputs | `rounded-xl`, white bg, `border-ios-gray4`, `focus:border-ios-blue` |
| `select` | Dropdowns | Same input treatment + iOS chevron |
| `badge` | Status pills (Misship, Damaged, batch open/closed, etc.) | Pill (`rounded-full`), color by semantic |
| `table` | Data tables on `/returns`, `/upcs`, `/bonuses`, `/reports` | White card wrapper, `divide-ios-gray5` hairline rows, `bg-ios-gray6/50` header |
| `label` | Form labels | `text-ios-gray1`, `uppercase tracking-wider text-xs` for section headers (mirrors iOS Settings) |
| `tabs` | Where tab nav is used | iOS segmented-control style (`bg-ios-gray5` pill, `bg-white` selected) |
| `dropdown-menu` | Row action menus | iOS context-menu style, `rounded-xl`, `shadow-ios-lg` |
| `skeleton` | Loading states | `bg-ios-gray5/60`, subtle pulse |
| `sonner` | Replaces scattered `alert()` calls | iOS snackbar, `rounded-2xl`, `shadow-ios-lg`, bottom-center |

Plus 2 custom components (not in shadcn):

| Custom | Purpose |
|---|---|
| `<PageHeader />` | Standard page top: back-button link, title, optional subtitle, optional right-side action button. Replaces the bespoke header each page builds today. |
| `<GroupedList />` | iOS grouped-list (label + value rows in a white card with separators). Used on detail/settings pages where tables are too heavy. |

#### iOS theming pattern

When `shadcn add button` generates `components/ui/button.tsx`, immediately edit the `buttonVariants` (a `cva()` block) to bake in iOS classes. Example:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-2xl text-[15px] font-semibold transition-colors disabled:opacity-50 min-h-[44px] px-5",
  {
    variants: {
      variant: {
        default: "bg-ios-blue text-white hover:bg-ios-blue/90",
        secondary: "bg-white text-black border border-ios-gray5 hover:bg-ios-gray6",
        destructive: "bg-ios-red text-white hover:bg-ios-red/90",
        ghost: "text-ios-blue hover:bg-ios-gray6",
      },
      size: { sm: "min-h-[36px] text-[13px] px-4", default: "", lg: "min-h-[50px] text-[17px] px-6" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

Every other generated shadcn component receives the same treatment — replace shadcn's default Tailwind classes with iOS classes in the `cva()` variants and base styles. The implementation plan will specify the exact class strings for each component.

The `cn()` helper (auto-added to `lib/utils.ts` by shadcn init) merges base classes + per-use overrides without conflict via `tailwind-merge`. Pages use components as `<Button variant="destructive">Delete</Button>` etc.

#### Dependencies added

- `@radix-ui/*` (one package per shadcn component installed — Radix is the headless primitive layer shadcn wraps)
- `class-variance-authority` (the `cva()` helper)
- `clsx`, `tailwind-merge` (used inside `cn()`)
- `lucide-react` (icons; replaces existing inline `<svg>` cruft on pages)
- `sonner` (toast)

### Section 3 — Page conversion + execution

#### Per-page conversion mapping

13 pages total, of which 9 are in scope and 4 are deferred:

**In scope (9 pages):**

| Page | Becomes |
|---|---|
| `/` (dashboard) | iOS `<Card>` grid for KPI tiles (`bg-white`, `rounded-2xl`, number in `text-4xl font-semibold`, label in `text-ios-gray1`); link list below as a `<GroupedList>` |
| `/login` | Centered `<Card>`, iOS `<Input>`s, full-width primary `<Button>` |
| `/change-password` | Same iOS form treatment as `/login` |
| `/setup` | iOS form sections in `<Card>` groups; primary `<Button>` at bottom |
| `/returns` | iOS `<Table>` (white card, hairline rows), `<PageHeader>` with back link, search via `<Input>` + `<Select>` filters in a sticky filter bar, detail modal → `<Dialog>`, edit modal → `<Dialog>`, image lightbox → `<Dialog>`, damaged badge → `<Badge variant="destructive">`, scattered `alert()` calls → `toast` from sonner |
| `/upcs` | iOS `<Table>`; add/edit row → `<Dialog>` |
| `/bonuses` | iOS `<Table>`; bonus entry form → `<Dialog>` |
| `/reports` | `<Card>` grid; report rows use `<GroupedList>` |
| `/app-download` | `<Card>` with latest build prominent; older builds as `<GroupedList>`; version notes preserved exactly as they read today |

**Deferred — out of scope (4 pages):**

- `/wms`, `/wms/inventory`, `/wms/transactions`, `/wms/floor-builder` — un-merged WMS work in progress. Redesign happens in a follow-up PR after WMS feature ships.

#### Conversion order (within the single PR)

1. Install shadcn + deps, generate iOS-themed primitives
2. Write `globals.css` + remove Geist font from `app/layout.tsx` + mount `<Toaster />`
3. Iterate over the 12 shadcn components, replacing default variants with iOS variants
4. Write the 2 custom components (`PageHeader`, `GroupedList`)
5. Convert pages in low-to-high complexity order so the patterns are well-established by the time the riskiest page lands:
   1. `/login`
   2. `/change-password`
   3. `/app-download`
   4. `/setup`
   5. `/` (dashboard)
   6. `/upcs`
   7. `/bonuses`
   8. `/reports`
   9. `/returns` — most complex; saved for last

### Validation strategy

No automated UI tests exist in the repo; verification is manual per page:

- `npm run dev`, open each route in a browser
- For each page: header renders, primary CTAs work, modals open/close, forms submit, no console errors
- Visual smoke: white cards, gray bg, system font, blue accents, hairline borders — matches IECentral aesthetic
- Cross-check that the `<Badge variant="destructive">` on damaged rows still works after `/returns` conversion (preserves the damaged-flag feature we just shipped)
- Spot-check on iOS Safari (iPad) once for visual fidelity since that's the closest real-iOS rendering environment

### Error handling

The redesign doesn't change error-handling logic — it changes only presentation. Existing try/catch blocks, mutation error handling, and auth failure paths remain intact. The only replacement: scattered `alert()` calls become `toast.error()` from sonner, which is a strict UX improvement (non-blocking, dismissible, doesn't trap the user in a native alert dialog).

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Tables look too "iOS-pretty" and lose data density | Use compact row padding (`py-2` not `py-4`); test on `/returns` first since it has the highest row count |
| `sonner` toast replacing `alert()` requires wiring `<Toaster />` once in root layout | Plan task explicitly adds it to `app/layout.tsx` |
| Removing Geist font might break a layout file we forgot about | Grep for `Geist` references before deleting |
| Single big PR means no incremental review | Conversion order starts with low-risk pages — review can stop at any phase |
| shadcn install adds many `@radix-ui/*` deps, bloating `node_modules` | Acceptable — Radix is treeshakeable, runtime bundle stays small |
| iOS color names (`ios-blue` etc.) need to be Tailwind-resolvable | Confirmed in the Tailwind v4 `@theme` block — `bg-ios-blue` resolves correctly |

## Rollout

Single PR that lands on a single feature branch (`feat/ios-redesign`), merged to `main` when complete. No feature flag — the redesign is the new baseline. WMS pages get their own follow-up PR after WMS feature ships.

If any phase of the conversion reveals a problem with the design system itself (e.g. tables really need more density tuning), the order allows pausing after each page for adjustment.
