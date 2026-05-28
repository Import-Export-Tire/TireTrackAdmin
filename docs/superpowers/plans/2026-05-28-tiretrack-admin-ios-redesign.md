# TireTrack Admin iOS Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle 9 of 13 TireTrack Admin pages from the current ad-hoc dark-slate look to an iOS-native light aesthetic, using shadcn/ui as the component foundation customized with iOS theming.

**Architecture:** A single feature branch (`feat/ios-redesign`) builds the redesign in 3 phases — Foundation (globals.css iOS theme + shadcn init), Component Library (12 shadcn primitives + 2 custom helpers, all iOS-themed via cva variants), Page Conversions (9 pages converted in low-to-high complexity order). Lands as one PR. 4 WMS pages are deferred to a follow-up after the WMS feature ships.

**Tech Stack:** Next.js App Router (existing), Tailwind v4 (existing), shadcn/ui + Radix UI (new), `class-variance-authority` / `clsx` / `tailwind-merge` (new), `lucide-react` (new), `sonner` (new).

**Spec:** `docs/superpowers/specs/2026-05-28-tiretrack-admin-ios-redesign-design.md`

**Pre-existing repo state (verified at plan time):**
- Branch: `main`
- Uncommitted WMS WIP (must stay uncommitted; do NOT bundle into this redesign):
  - Deleted: `convex.json`
  - Modified: `convex/_generated/api.d.ts`, `convex/schema.ts`
  - Untracked: `app.json`, `app/wms/`, `convex/wms.ts`, `convex/wms_routing.ts`, `toyo_upc_lookup_results.json`
- The four WMS pages (`/wms`, `/wms/inventory`, `/wms/transactions`, `/wms/floor-builder`) live in `app/wms/` which is untracked — they will simply not be touched by this plan.
- Current Tailwind: v4 (`@import "tailwindcss"` in globals.css; `@tailwindcss/postcss` in deps)
- Current font: `Arial, Helvetica` (per body style in globals.css). There is NO actual `next/font` import — the `--font-geist-sans` references are dangling. **No Geist cleanup needed.**
- Package manager: npm (`package-lock.json`)
- No existing `components/` or `lib/` directory at the repo root or under `app/`

**Testing approach:** No automated UI tests exist. Verification per task uses:
- `npx tsc --noEmit 2>&1 | grep -v "app/wms"` to confirm no new errors in non-WMS files
- `npm run dev` + browser visit + visual smoke test per page (with explicit pass criteria in each task)
- No test framework is being added for this redesign

---

## File Structure

### Created (new files)

- `app/globals.css` — fully replaced (formerly Geist/slate; becomes iOS theme via `@theme`)
- `components.json` — shadcn config
- `lib/utils.ts` — `cn()` helper from shadcn init
- `components/ui/button.tsx` — iOS-themed shadcn Button
- `components/ui/badge.tsx` — iOS-themed shadcn Badge (with semantic variants)
- `components/ui/card.tsx` — iOS-themed shadcn Card
- `components/ui/input.tsx` — iOS-themed shadcn Input
- `components/ui/label.tsx` — shadcn Label (minor restyle)
- `components/ui/select.tsx` — iOS-themed shadcn Select
- `components/ui/dialog.tsx` — iOS-themed shadcn Dialog
- `components/ui/table.tsx` — iOS-themed shadcn Table
- `components/ui/tabs.tsx` — iOS segmented-control style
- `components/ui/dropdown-menu.tsx` — iOS context-menu style
- `components/ui/skeleton.tsx` — iOS shimmer
- `components/ui/sonner.tsx` — Toaster wrapper from shadcn (sonner adapter)
- `components/PageHeader.tsx` — custom: back link + title + optional subtitle + optional right action
- `components/GroupedList.tsx` — custom: iOS grouped-list rows in a white card with hairline separators

### Modified

- `app/layout.tsx` — body className stays `font-sans`; add `<Toaster richColors />` from sonner inside body
- `app/page.tsx` — dashboard converted (Phase 3)
- `app/login/page.tsx` — converted (Phase 3)
- `app/change-password/page.tsx` — converted (Phase 3)
- `app/app-download/page.tsx` — converted (Phase 3)
- `app/setup/page.tsx` — converted (Phase 3)
- `app/returns/page.tsx` — converted (Phase 3, most complex)
- `app/upcs/page.tsx` — converted (Phase 3)
- `app/bonuses/page.tsx` — converted (Phase 3)
- `app/reports/page.tsx` — converted (Phase 3)

### Untouched

- `app/wms/**` — out of scope (untracked; WMS feature unmerged)
- `app/protected.tsx`, `app/auth-context.tsx`, `app/providers.tsx` — auth/Convex wiring stays as-is
- `convex/**` — no backend changes
- Any other config (`next.config.ts`, `tsconfig.json`, `postcss.config.mjs`) — left alone unless shadcn init explicitly modifies them

### Why this split

- Each shadcn component is one file in `components/ui/`; small, focused, swappable.
- Custom components (`PageHeader`, `GroupedList`) live at `components/` root to distinguish them from the shadcn primitives.
- Pages stay in their existing locations; no folder restructuring.

---

## Task 1: Pre-flight — branch + stash WMS

**Files:** None modified yet — just git state.

- [ ] **Step 1: Confirm clean starting point**

```bash
cd /Users/andybarrows/TireTrackAdmin
git rev-parse --abbrev-ref HEAD
git status --short
```
Expected: on `main`, with uncommitted WMS WIP visible (the items listed in the plan header).

- [ ] **Step 2: Create the feature branch**

```bash
cd /Users/andybarrows/TireTrackAdmin
git checkout -b feat/ios-redesign
```
Expected: `Switched to a new branch 'feat/ios-redesign'`.

- [ ] **Step 3: Stash the WMS WIP so it doesn't get bundled into redesign commits**

```bash
cd /Users/andybarrows/TireTrackAdmin
git stash push --include-untracked -m "WMS WIP - pause for iOS redesign"
git status --short
```
Expected: `git status` is clean (no modified or untracked files).

**Note for later:** After the redesign is fully merged, restore WMS with `git stash pop`. Until then it sits in the stash list.

- [ ] **Step 4: No commit yet — the branch is empty by design**

---

## Task 2: Install shadcn + dependencies

**Files:**
- Create: `components.json`, `lib/utils.ts` (via shadcn init)
- Modify: `package.json`, `package-lock.json` (new deps)
- May modify: `tsconfig.json` (shadcn init adds path alias if missing)

- [ ] **Step 1: Run shadcn init (non-interactive answers documented in step 2)**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest init
```
shadcn will prompt for several config choices.

- [ ] **Step 2: Use these answers to the init prompts**

| Prompt | Answer |
|---|---|
| Which color would you like to use as the base color? | **Neutral** (will be overridden by our iOS theme anyway) |
| Where is your global CSS file? | `app/globals.css` |
| Would you like to use CSS variables for theming? | **No** (we use raw iOS hex values via `@theme` block, not abstract HSL slots) |
| Where is your tailwind.config.js located? | (leave blank — Tailwind v4 uses CSS-based config) |
| Configure the import alias for components? | `@/components` |
| Configure the import alias for utils? | `@/lib/utils` |
| Are you using React Server Components? | **Yes** |
| Write configuration to components.json? | **Yes** |

If shadcn complains about Tailwind v4 specifically, accept its v4 path or use `npx shadcn@canary init` for v4 support. The component output is the same.

- [ ] **Step 3: Verify scaffolding landed**

```bash
cd /Users/andybarrows/TireTrackAdmin
ls components.json lib/utils.ts
cat lib/utils.ts
```
Expected:
- `components.json` exists
- `lib/utils.ts` exports the `cn()` helper

- [ ] **Step 4: Install lucide-react (for icons) and sonner (for toasts)**

shadcn may have installed lucide-react automatically. Confirm and add sonner explicitly:

```bash
cd /Users/andybarrows/TireTrackAdmin
npm install lucide-react sonner
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -v "app/wms" | head -20
```
Expected: no errors outside `app/wms/*` (pre-existing).

- [ ] **Step 6: Commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
git add components.json lib/ package.json package-lock.json tsconfig.json
git commit -m "chore(ui): install shadcn/ui + sonner + lucide-react"
```

If `tsconfig.json` wasn't modified by init, drop it from the `git add`. Do NOT commit any other files (no `app/wms/*`, no `convex/*`).

---

## Task 3: Replace globals.css with iOS theme + add Toaster

**Files:**
- Modify: `app/globals.css` (full replacement)
- Modify: `app/layout.tsx` (mount `<Toaster />`)

- [ ] **Step 1: Replace `app/globals.css` entirely with this content**

```css
@import "tailwindcss";

/* iOS color palette + radii + shadows exposed as Tailwind utilities
   (e.g. text-ios-blue, bg-ios-gray6, rounded-2xl, shadow-ios). */
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

  --shadow-ios: 0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px -2px rgba(0, 0, 0, 0.06);
  --shadow-ios-lg: 0 0 0 0.5px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.05), 0 12px 28px -6px rgba(0, 0, 0, 0.10);

  /* Make Tailwind's font-sans utility resolve to the system stack too,
     so any `className="font-sans"` matches the body explicit style. */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
    "Segoe UI", system-ui, sans-serif;
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

h1, h2, h3, h4 {
  letter-spacing: -0.022em;
  font-weight: 600;
}
```

This removes:
- The `:root` + dark-media-query block (we are light-only)
- The dangling `--font-geist-*` references
- The `Arial, Helvetica` body fallback

- [ ] **Step 2: Modify `app/layout.tsx` to mount `<Toaster />`**

Replace the existing file with:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "TireTrack Admin",
  description: "Warehouse Management Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>{children}</Providers>
        <Toaster richColors position="bottom-center" />
      </body>
    </html>
  );
}
```

The `Toaster` import refers to `components/ui/sonner.tsx` which doesn't exist yet (created in Task 14). **This will TypeScript-fail until Task 14 lands.** That is expected; note it in your DONE_WITH_CONCERNS.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -v "app/wms" | head -20
```
Expected: ONE error about missing `@/components/ui/sonner`. No other new errors.

- [ ] **Step 4: Visual smoke**

```bash
cd /Users/andybarrows/TireTrackAdmin
npm run dev
```
Then open http://localhost:3000 (dashboard). Expected:
- Page background is light iOS gray (#F2F2F7), not the previous dark slate
- Text is dark, sans-serif system font (looks like SF Pro on macOS)
- The page may look broken (slate-styled elements over a light bg) — that's normal at this stage; pages get converted in Phase 3

- [ ] **Step 5: Commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
git add app/globals.css app/layout.tsx
git commit -m "feat(ui): iOS theme tokens in globals.css; mount Toaster"
```

---

## Task 4: Button component (iOS-themed)

**Files:**
- Create: `components/ui/button.tsx`

- [ ] **Step 1: Generate the shadcn button**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add button
```

This creates `components/ui/button.tsx` with shadcn's default variants.

- [ ] **Step 2: Replace the generated `buttonVariants` with iOS variants**

Open `components/ui/button.tsx`. Find the `buttonVariants` declaration (a `cva()` call near the top of the file). Replace it with:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-[44px] px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/40",
  {
    variants: {
      variant: {
        default: "bg-ios-blue text-white hover:bg-ios-blue/90 active:bg-ios-blue/80",
        secondary: "bg-white text-black border border-ios-gray5 hover:bg-ios-gray6",
        destructive: "bg-ios-red text-white hover:bg-ios-red/90 active:bg-ios-red/80",
        ghost: "text-ios-blue hover:bg-ios-gray6",
        outline: "bg-transparent text-ios-blue border border-ios-blue hover:bg-ios-blue/5",
      },
      size: {
        default: "",
        sm: "min-h-[36px] text-[13px] px-4",
        lg: "min-h-[50px] text-[17px] px-6",
        icon: "min-h-[44px] w-[44px] px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

Leave the rest of the file (the `Button` component definition itself) as shadcn generated it.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep "components/ui/button" | head -5
```
Expected: blank (no errors in button.tsx).

- [ ] **Step 4: Commit**

```bash
git add components/ui/button.tsx
git commit -m "feat(ui): iOS-themed Button component"
```

---

## Task 5: Badge + Skeleton (small primitives)

**Files:**
- Create: `components/ui/badge.tsx`, `components/ui/skeleton.tsx`

- [ ] **Step 1: Generate both**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add badge skeleton
```

- [ ] **Step 2: Replace `badgeVariants` in `components/ui/badge.tsx`**

```tsx
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-ios-blue/15 text-ios-blue",
        secondary: "bg-ios-gray5 text-ios-gray1",
        success: "bg-ios-green/15 text-ios-green",
        warning: "bg-ios-orange/15 text-ios-orange",
        destructive: "bg-ios-red/15 text-ios-red",
        outline: "border border-ios-gray4 text-ios-gray1",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
```

The semantic names map to the existing status fields used in pages:
- `default` (blue) — informational ("Pending")
- `success` (green) — completed ("Processed", "Closed")
- `warning` (orange) — attention ("Misship")
- `destructive` (red) — error/critical ("Damaged", "Failed")
- `secondary` (gray) — neutral
- `outline` — subtle

- [ ] **Step 3: Replace the Skeleton body in `components/ui/skeleton.tsx`** with:

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-ios-gray5/60", className)}
      {...props}
    />
  );
}

export { Skeleton };
```

- [ ] **Step 4: TS check + commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -E "badge|skeleton" | head -5
# expected: blank

git add components/ui/badge.tsx components/ui/skeleton.tsx
git commit -m "feat(ui): iOS-themed Badge (with semantic variants) + Skeleton"
```

---

## Task 6: Card component

**Files:**
- Create: `components/ui/card.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add card
```

- [ ] **Step 2: Edit `components/ui/card.tsx` to apply iOS styling**

Replace the base `Card` className:

```tsx
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-white rounded-2xl shadow-ios",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
```

And `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` className overrides:

```tsx
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 px-5 pt-5 pb-3", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-ios-gray1", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-5 py-3", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center px-5 pb-5 pt-3", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
```

Keep the existing `export { ... }` list.

- [ ] **Step 3: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "ui/card" | head -3
git add components/ui/card.tsx
git commit -m "feat(ui): iOS-themed Card (and subcomponents)"
```

---

## Task 7: Input + Label (form pair)

**Files:**
- Create: `components/ui/input.tsx`, `components/ui/label.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add input label
```

- [ ] **Step 2: Replace the `Input` className in `components/ui/input.tsx`**

```tsx
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-ios-gray4 bg-white px-3.5 py-2 text-[15px] placeholder:text-ios-gray2 focus-visible:outline-none focus-visible:border-ios-blue focus-visible:ring-2 focus-visible:ring-ios-blue/20 disabled:opacity-50 disabled:bg-ios-gray6",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
```

- [ ] **Step 3: Update `components/ui/label.tsx` className**

Replace the existing `Label` className to use:

```tsx
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-xs uppercase tracking-wider font-semibold text-ios-gray1",
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
```

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "ui/(input|label)" | head -3
git add components/ui/input.tsx components/ui/label.tsx
git commit -m "feat(ui): iOS-themed Input + Label"
```

---

## Task 8: Select component

**Files:**
- Create: `components/ui/select.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add select
```

- [ ] **Step 2: Edit `components/ui/select.tsx`**

This component has multiple subcomponents (`SelectTrigger`, `SelectContent`, `SelectItem`, etc.). Replace these classNames:

**`SelectTrigger`** className → 
```tsx
"flex h-11 w-full items-center justify-between rounded-xl border border-ios-gray4 bg-white px-3.5 py-2 text-[15px] placeholder:text-ios-gray2 focus:outline-none focus:border-ios-blue focus:ring-2 focus:ring-ios-blue/20 disabled:opacity-50 [&>span]:line-clamp-1"
```

**`SelectContent`** className → 
```tsx
"relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-ios-gray5 bg-white shadow-ios-lg data-[state=open]:animate-in data-[state=closed]:animate-out"
```

**`SelectItem`** className → 
```tsx
"relative flex w-full cursor-default select-none items-center rounded-lg py-2 pl-8 pr-2 text-[15px] outline-none focus:bg-ios-gray6 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
```

Other subcomponents (`SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`): leave shadcn defaults, they're fine.

- [ ] **Step 3: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "ui/select" | head -3
git add components/ui/select.tsx
git commit -m "feat(ui): iOS-themed Select"
```

---

## Task 9: Dialog component

**Files:**
- Create: `components/ui/dialog.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add dialog
```

- [ ] **Step 2: Edit `components/ui/dialog.tsx`** — replace these classNames:

**`DialogOverlay`** className → 
```tsx
"fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
```

**`DialogContent`** className → 
```tsx
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-white p-6 shadow-ios-lg duration-200 sm:rounded-3xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
```

**`DialogHeader`** className → `"flex flex-col gap-1.5 text-left"`

**`DialogTitle`** className → `"text-lg font-semibold tracking-tight"`

**`DialogDescription`** className → `"text-sm text-ios-gray1"`

**`DialogFooter`** className → `"flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2"`

- [ ] **Step 3: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "ui/dialog" | head -3
git add components/ui/dialog.tsx
git commit -m "feat(ui): iOS-themed Dialog"
```

---

## Task 10: Table component

**Files:**
- Create: `components/ui/table.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add table
```

- [ ] **Step 2: Edit `components/ui/table.tsx`** — replace these classNames:

**`Table`** className → 
```tsx
"w-full caption-bottom text-[14px] border-collapse"
```

Wrap the `<table>` in a white card container in the existing `Table` component definition:

```tsx
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto bg-white rounded-2xl shadow-ios">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-[14px] border-collapse", className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";
```

**`TableHeader`** className → `"bg-ios-gray6/50 [&_tr]:border-b [&_tr]:border-ios-gray5"`

**`TableBody`** className → `"divide-y divide-ios-gray5 [&_tr:last-child]:border-0"`

**`TableRow`** className → `"transition-colors hover:bg-ios-gray6/50 data-[state=selected]:bg-ios-blue/5"`

**`TableHead`** className → `"h-10 px-4 text-left align-middle font-semibold text-ios-gray1 text-[12px] uppercase tracking-wider [&:has([role=checkbox])]:pr-0"`

**`TableCell`** className → `"px-4 py-3 align-middle text-[14px] [&:has([role=checkbox])]:pr-0"`

(Compact row padding `py-3` preserves data density per the spec's table-density risk mitigation.)

- [ ] **Step 3: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "ui/table" | head -3
git add components/ui/table.tsx
git commit -m "feat(ui): iOS-themed Table with compact row padding"
```

---

## Task 11: Tabs + Dropdown-menu (navigation pair)

**Files:**
- Create: `components/ui/tabs.tsx`, `components/ui/dropdown-menu.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add tabs dropdown-menu
```

- [ ] **Step 2: Edit `components/ui/tabs.tsx`** — replace these classNames:

**`TabsList`** (the container) className → 
```tsx
"inline-flex h-9 items-center justify-center rounded-xl bg-ios-gray5 p-1 gap-1"
```

**`TabsTrigger`** className → 
```tsx
"inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1 text-[13px] font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-black text-ios-gray1 hover:text-black"
```

**`TabsContent`** className → `"mt-3"`

- [ ] **Step 3: Edit `components/ui/dropdown-menu.tsx`** — replace these classNames:

**`DropdownMenuContent`** className → 
```tsx
"z-50 min-w-[8rem] overflow-hidden rounded-xl border border-ios-gray5 bg-white p-1 shadow-ios-lg data-[state=open]:animate-in data-[state=closed]:animate-out"
```

**`DropdownMenuItem`** className → 
```tsx
"relative flex cursor-default select-none items-center rounded-lg px-2 py-1.5 text-[14px] outline-none transition-colors focus:bg-ios-gray6 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
```

**`DropdownMenuSeparator`** className → `"-mx-1 my-1 h-px bg-ios-gray5"`

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "ui/(tabs|dropdown-menu)" | head -3
git add components/ui/tabs.tsx components/ui/dropdown-menu.tsx
git commit -m "feat(ui): iOS-themed Tabs (segmented control) + DropdownMenu"
```

---

## Task 12: Sonner toast wrapper

**Files:**
- Create: `components/ui/sonner.tsx`

- [ ] **Step 1: Generate**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx shadcn@latest add sonner
```

- [ ] **Step 2: Edit `components/ui/sonner.tsx`** to remove the dark/light theme prop and force iOS styling:

```tsx
"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:text-black group-[.toaster]:border-ios-gray5 group-[.toaster]:shadow-ios-lg group-[.toaster]:rounded-2xl",
          description: "group-[.toast]:text-ios-gray1",
          actionButton:
            "group-[.toast]:bg-ios-blue group-[.toast]:text-white group-[.toast]:rounded-xl",
          cancelButton:
            "group-[.toast]:bg-ios-gray5 group-[.toast]:text-ios-gray1 group-[.toast]:rounded-xl",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
```

- [ ] **Step 3: Confirm the TS error from Task 3 is now resolved**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -v "app/wms" | grep -v node_modules | head -10
```
Expected: blank (the layout.tsx error about missing `@/components/ui/sonner` is now resolved; nothing else added).

- [ ] **Step 4: Commit**

```bash
git add components/ui/sonner.tsx
git commit -m "feat(ui): iOS Toaster wrapper for sonner"
```

---

## Task 13: Custom PageHeader + GroupedList components

**Files:**
- Create: `components/PageHeader.tsx`, `components/GroupedList.tsx`

- [ ] **Step 1: Create `components/PageHeader.tsx`**

```tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  right?: React.ReactNode;
};

export function PageHeader({ title, subtitle, backHref = "/", backLabel = "Back", right }: Props) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-0.5 text-ios-blue text-[15px] mb-1 hover:underline"
        >
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-ios-gray1 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/GroupedList.tsx`**

```tsx
import { cn } from "@/lib/utils";

type GroupedListProps = {
  children: React.ReactNode;
  className?: string;
};

export function GroupedList({ children, className }: GroupedListProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl shadow-ios divide-y divide-ios-gray5 overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

type GroupedListItemProps = {
  label: React.ReactNode;
  value?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
};

export function GroupedListItem({ label, value, href, onClick, trailing }: GroupedListItemProps) {
  const inner = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 min-h-[44px]">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] text-black truncate">{label}</div>
        {value && <div className="text-[13px] text-ios-gray1 mt-0.5 truncate">{value}</div>}
      </div>
      {trailing && <div className="shrink-0 text-ios-gray1">{trailing}</div>}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block hover:bg-ios-gray6 transition-colors">
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button onClick={onClick} className="block w-full text-left hover:bg-ios-gray6 transition-colors">
        {inner}
      </button>
    );
  }
  return inner;
}
```

- [ ] **Step 3: TS + commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -E "components/(PageHeader|GroupedList)" | head -5
# expected: blank

git add components/PageHeader.tsx components/GroupedList.tsx
git commit -m "feat(ui): PageHeader and GroupedList custom primitives"
```

---

## Task 14: Convert `/login`

**Files:**
- Modify: `app/login/page.tsx`

- [ ] **Step 1: Read the current `/login` page**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/login/page.tsx
cat app/login/page.tsx
```
Note its structure: header / logo / form fields / submit button / error display. Identify which existing handlers/state to preserve.

- [ ] **Step 2: Rewrite the page using iOS components**

Replace `app/login/page.tsx` with the new structure. Preserve ALL existing form state, mutation calls, and error handling — only the JSX + className surface changes. The general shape:

```tsx
"use client";

// (keep all the imports the existing file has — Convex hooks, useState, etc.)
// add these new imports:
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function LoginPage() {
  // ... preserve existing state + handlers ...
  // replace any `alert()` calls with `toast.error(...)` / `toast.success(...)`

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">TireTrack Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full" size="lg">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

Adapt the field names and handlers to match the existing file's variable names. Do NOT delete any business logic.

- [ ] **Step 3: Visual smoke**

```bash
cd /Users/andybarrows/TireTrackAdmin
npm run dev
```
Open http://localhost:3000/login. Expected:
- Centered white card on iOS gray background
- iOS-styled inputs (rounded-xl, hairline border)
- Full-width blue "Sign in" button
- System font throughout
- Form submission still works (try a known-bad password — toast appears instead of an alert)

- [ ] **Step 4: TS + commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep "app/login" | head -3
git add app/login/page.tsx
git commit -m "feat(ui): convert /login to iOS aesthetic"
```

---

## Task 15: Convert `/change-password`

**Files:**
- Modify: `app/change-password/page.tsx`

Mirrors Task 14 (`/login`) — same Card + Input + Label + Button pattern. Preserve existing mutation calls and validation logic.

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
cat app/change-password/page.tsx
```

- [ ] **Step 2: Rewrite using the same Card/Input/Label/Button pattern as `/login`**

Structure:
- Outer container: `<div className="min-h-screen flex items-center justify-center px-4 py-12">`
- Inner card: `<Card className="w-full max-w-md">` with `CardHeader` ("Change Password" title) and `CardContent`
- Form has fields for current password, new password, confirm new password — same `<Label>` + `<Input type="password">` pattern as `/login`
- Submit `<Button>` and a secondary `<Button variant="secondary">` for Cancel (returns to `/`)
- Replace any `alert()` with `toast.error()` / `toast.success("Password changed")` then `router.push("/")`

- [ ] **Step 3: Visual smoke**

Open http://localhost:3000/change-password. Expected: iOS-styled form, system font, validations still fire, success toast on success.

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/change-password" | head -3
git add app/change-password/page.tsx
git commit -m "feat(ui): convert /change-password to iOS aesthetic"
```

---

## Task 16: Convert `/app-download`

**Files:**
- Modify: `app/app-download/page.tsx`

This page is the EAS APK download viewer (we touched it earlier in the project). It has:
- A header explaining what the page does
- The latest build prominently displayed (with download button)
- A version history section
- A list of recent builds

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/app-download/page.tsx
cat app/app-download/page.tsx
```

- [ ] **Step 2: Convert using these patterns**

- Wrap in `<div className="min-h-screen p-6 max-w-3xl mx-auto">`
- `<PageHeader title="TireTrack Lite App" subtitle="Download the latest Android APK" backHref="/" />`
- Latest build → `<Card>` with `CardHeader` (version + status badge using `<Badge variant="success">Finished</Badge>`) and `CardContent` (build info grid + download `<Button>`)
- Version history → `<GroupedList>` with each version as a `<GroupedListItem label={version} value={dateAndFeatures} />`
- Recent builds → `<GroupedList>` with each build as a `<GroupedListItem label={profile} value={date} trailing={<Button size="sm">Download</Button>} />`
- Auto-refresh logic + retry banner → preserve as-is; just wrap in iOS-styled containers
- Loading state → use `<Skeleton>` placeholders inside the Card
- Replace any `alert()` with `toast`

- [ ] **Step 3: Visual smoke**

Open http://localhost:3000/app-download. Expected:
- Clean white cards, no dark slate
- Latest build prominent
- Version history readable
- Download buttons styled as iOS primary buttons
- Auto-refresh still happens every 5 minutes

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/app-download" | head -3
git add app/app-download/page.tsx
git commit -m "feat(ui): convert /app-download to iOS aesthetic"
```

---

## Task 17: Convert `/setup`

**Files:**
- Modify: `app/setup/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
cat app/setup/page.tsx
```

- [ ] **Step 2: Convert**

Pattern depends on what `/setup` actually does (initial admin setup form, likely):
- Container: `<div className="min-h-screen flex items-center justify-center px-4 py-12">`
- `<Card className="w-full max-w-xl">` with `CardHeader` (title) and `CardContent` (form sections)
- Each form field: `<Label>` + `<Input>` pattern; for multi-step forms use sections separated by `<div className="border-t border-ios-gray5 pt-4">`
- Submit `<Button size="lg" className="w-full">`
- Replace `alert()` with `toast`

- [ ] **Step 3: Visual smoke**

Open http://localhost:3000/setup (if the page is reachable in dev — may require unauth state). Verify form fields and submit work.

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/setup" | head -3
git add app/setup/page.tsx
git commit -m "feat(ui): convert /setup to iOS aesthetic"
```

---

## Task 18: Convert `/` (dashboard)

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/page.tsx
cat app/page.tsx
```
The current dashboard has KPI tiles, quick-action links to subpages, and probably auth gating.

- [ ] **Step 2: Convert**

Layout:
- `<div className="min-h-screen p-6 max-w-7xl mx-auto">`
- `<header className="mb-8">` with a large title (`<h1 className="text-3xl font-semibold tracking-tight">TireTrack Admin</h1>`) and subtitle (`<p className="text-ios-gray1 mt-1">Warehouse Management Dashboard</p>`) — no back-button on the dashboard (it IS the home)
- KPI grid: `<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">` — each KPI is a `<Card>` with:
  ```tsx
  <Card>
    <CardContent className="px-5 py-4">
      <div className="text-3xl font-semibold tracking-tight">{count}</div>
      <div className="text-[13px] text-ios-gray1 mt-1">{label}</div>
    </CardContent>
  </Card>
  ```
- Quick links: `<h2 className="text-lg font-semibold mb-3">Manage</h2>` then `<GroupedList>` with `<GroupedListItem href="/returns" label="Returns" value="..." trailing={<ChevronRight />} />` for each navigable page

The 9 subpages to link to: Returns, UPCs, Bonuses, Reports, App Download, Setup, Change Password. (Skip WMS — those pages are out of scope and stay un-styled for now; if there are existing links to them, leave them but they will look stylistically inconsistent — that's expected and acceptable.)

- [ ] **Step 3: Visual smoke**

Open http://localhost:3000. Expected:
- Large bold heading
- KPI grid of 4 cards with bold numbers
- Clean grouped-list of navigation links
- Each link tappable; on hover shows iOS gray hover bg

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "^app/page" | head -3
git add app/page.tsx
git commit -m "feat(ui): convert dashboard to iOS aesthetic"
```

---

## Task 19: Convert `/upcs`

**Files:**
- Modify: `app/upcs/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/upcs/page.tsx
cat app/upcs/page.tsx | head -100
```

- [ ] **Step 2: Convert**

Pattern (this is a data-table page):
- `<div className="min-h-screen p-6 max-w-7xl mx-auto">`
- `<PageHeader title="UPC Database" backHref="/" right={<Button onClick={openAddModal}><Plus /> Add UPC</Button>} />`
- Filter bar: `<div className="flex gap-2 mb-4"><Input placeholder="Search…" /> <Select>…</Select></div>`
- Data table: use the new `<Table>` + `<TableHeader>` + `<TableBody>` + `<TableRow>` + `<TableHead>` + `<TableCell>` components from Task 10
- Row actions: use `<DropdownMenu>` from Task 11
- Add/Edit modal: use `<Dialog>` from Task 9
- Replace `alert()` with `toast`

- [ ] **Step 3: Visual smoke**

Open http://localhost:3000/upcs. Expected: iOS table in a white card, filter bar at the top, edit dialog opens with iOS styling, no console errors.

- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/upcs" | head -3
git add app/upcs/page.tsx
git commit -m "feat(ui): convert /upcs to iOS aesthetic"
```

---

## Task 20: Convert `/bonuses`

**Files:**
- Modify: `app/bonuses/page.tsx`

Same pattern as `/upcs`.

- [ ] **Step 1: Read current file**
- [ ] **Step 2: Convert using PageHeader + Table + Dialog + DropdownMenu** (same as Task 19)
- [ ] **Step 3: Visual smoke** on http://localhost:3000/bonuses
- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/bonuses" | head -3
git add app/bonuses/page.tsx
git commit -m "feat(ui): convert /bonuses to iOS aesthetic"
```

---

## Task 21: Convert `/reports`

**Files:**
- Modify: `app/reports/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/reports/page.tsx
cat app/reports/page.tsx | head -100
```

- [ ] **Step 2: Convert**

This page likely has cards for different report types + tables of report data. Pattern:
- `<PageHeader title="Reports" backHref="/" />`
- Report-type cards: `<div className="grid grid-cols-2 md:grid-cols-3 gap-3">` of `<Card>`s, each with a title + description + "Run" button
- When a report is selected/run: display in a `<Table>` below, or as a `<GroupedList>` for non-tabular data
- Export buttons: `<Button variant="secondary"><Download /> Export CSV</Button>`

- [ ] **Step 3: Visual smoke**
- [ ] **Step 4: TS + commit**

```bash
npx tsc --noEmit 2>&1 | grep "app/reports" | head -3
git add app/reports/page.tsx
git commit -m "feat(ui): convert /reports to iOS aesthetic"
```

---

## Task 22: Convert `/returns` (largest)

**Files:**
- Modify: `app/returns/page.tsx`

This is the largest page (~1150 lines after our damage-flag feature). It has THREE major sections:
1. Active batch view (items table for the selected batch)
2. Search results (cross-batch item search)
3. Open batches list

Plus FOUR modal types:
1. Item detail modal (with damage section we just added)
2. Edit item modal
3. Image lightbox
4. Batch rename / delete confirmation modals

Convert one section at a time to manage complexity.

- [ ] **Step 1: Read the full current file once for orientation**

```bash
cd /Users/andybarrows/TireTrackAdmin
wc -l app/returns/page.tsx
# Read in chunks — the file is large
```

- [ ] **Step 2: Add iOS imports at the top**

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";
import { MoreVertical, ChevronRight, X, Search } from "lucide-react";
```

Remove the existing `Link` import only if unused after conversion.

- [ ] **Step 3: Convert the page-level structure**

Wrap the main `ReturnsDashboard()` return value in:

```tsx
<div className="min-h-screen p-6 max-w-7xl mx-auto">
  <PageHeader
    title="Returns"
    subtitle={`${stats?.totalItems ?? 0} items across ${stats?.totalBatches ?? 0} batches`}
    backHref="/"
  />

  {/* (sections below) */}
</div>
```

- [ ] **Step 4: Convert the search bar + filter chips at the top**

The current page has a search input + status filter dropdown. Replace with:

```tsx
<div className="flex flex-col sm:flex-row gap-2 mb-4">
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ios-gray2" />
    <Input
      value={searchQuery}
      onChange={(e) => { setSearchQuery(e.target.value); setIsSearching(e.target.value.length >= 2); }}
      placeholder="Search returns…"
      className="pl-9"
    />
  </div>
  <Select value={searchStatusFilter} onValueChange={setSearchStatusFilter}>
    <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All statuses</SelectItem>
      <SelectItem value="pending">Pending</SelectItem>
      <SelectItem value="processed">Processed</SelectItem>
      <SelectItem value="not_processed">Not processed</SelectItem>
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 5: Convert the open batches list**

Replace the existing batches list with a `<GroupedList>` (or a `<Card>` containing one). Each batch row shows: batch name, item count, status (`<Badge>`), actions (`<DropdownMenu>` with Rename / Delete).

Status badge mapping:
- `open` → `<Badge variant="default">Open</Badge>`
- `closed` → `<Badge variant="success">Closed</Badge>`

- [ ] **Step 6: Convert the items table (active batch view)**

Replace the existing slate-styled `<table>` block with the new iOS `<Table>` components:

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead className="w-16">Image</TableHead>
      <TableHead>PO / INV</TableHead>
      <TableHead>Tire</TableHead>
      <TableHead>Part #</TableHead>
      <TableHead className="text-center">Qty</TableHead>
      <TableHead className="text-center">Misship</TableHead>
      <TableHead className="text-center">Damaged</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Scanned By</TableHead>
      {canEdit && <TableHead>Actions</TableHead>}
    </TableRow>
  </TableHeader>
  <TableBody>
    {items?.map((item: any) => (
      <TableRow
        key={item._id}
        onClick={() => setViewingItem(item)}
        className={cn(
          "cursor-pointer",
          item.isDamaged && "bg-ios-red/5 hover:bg-ios-red/10 border-l-2 border-l-ios-red",
          !item.isDamaged && item.isMisship && "bg-ios-orange/5 hover:bg-ios-orange/10 border-l-2 border-l-ios-orange",
        )}
      >
        {/* TableCells: image thumb, PO/INV, tire, part#, qty, misship Badge, damaged Badge, status Badge, scanned-by, actions DropdownMenu */}
      </TableRow>
    ))}
  </TableBody>
</Table>
```

For the Damaged badge cell (preserving the feature we just shipped):
```tsx
<TableCell className="text-center">
  {item.isDamaged && <Badge variant="destructive">⚠ Damaged</Badge>}
</TableCell>
```

For the Misship cell (preserving existing behavior):
```tsx
<TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
  {item.isMisship ? (
    <Button variant="ghost" size="sm" onClick={() => updateItem({ itemId: item._id as any, isMisship: false })}>
      ⚠ Misship
    </Button>
  ) : (
    <Button variant="ghost" size="sm" onClick={() => updateItem({ itemId: item._id as any, isMisship: true })}>
      Mark
    </Button>
  )}
</TableCell>
```

Replace the same pattern for the search-results table.

- [ ] **Step 7: Convert the item detail modal**

Replace the existing `{viewingItem && (<div className="fixed inset-0…">…</div>)}` with:

```tsx
<Dialog open={!!viewingItem} onOpenChange={(open) => !open && setViewingItem(null)}>
  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Return Item Details</DialogTitle>
      <p className="text-sm text-ios-gray1">
        Scanned by {viewingItem?.scannedByName} on {viewingItem && formatDate(viewingItem.scannedAt)}
      </p>
    </DialogHeader>

    {/* Body: image, status, damage section (preserved), order info, tire info */}

    <DialogFooter>
      {canEdit && (
        <Button variant="secondary" onClick={() => { setEditingItem(viewingItem); setViewingItem(null); }}>
          Edit
        </Button>
      )}
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Preserve the damage section exactly as we built it (the `{viewingItem.isDamaged && (...)}` block); just update its outer styling to iOS:
```tsx
{viewingItem?.isDamaged && (
  <div className="p-4 bg-ios-red/10 border border-ios-red/30 rounded-xl">
    {/* (existing damage section internals stay; replace text-red-X classes with text-ios-red) */}
  </div>
)}
```

- [ ] **Step 8: Convert the edit modal**

Same `<Dialog>` pattern as Step 7. Form fields use `<Label>` + `<Input>` + `<Select>` from our primitives. Submit/Cancel buttons use `<Button>`.

- [ ] **Step 9: Convert the image lightbox**

Replace with:
```tsx
<Dialog open={!!viewingImage} onOpenChange={(open) => !open && setViewingImage(null)}>
  <DialogContent className="max-w-5xl p-0 bg-transparent shadow-none border-0">
    {viewingImage && (
      <img src={viewingImage} alt="" className="w-full h-auto rounded-2xl" />
    )}
  </DialogContent>
</Dialog>
```

- [ ] **Step 10: Replace remaining `alert()` calls with toast**

Find them:
```bash
grep -n "alert(" /Users/andybarrows/TireTrackAdmin/app/returns/page.tsx
```
Replace each:
- Error case: `toast.error(err?.message || "Failed to do X")`
- Success case: `toast.success("Did X")`
- Plain info: `toast(message)`

- [ ] **Step 11: Sweep for any remaining slate-X classes specific to this file**

```bash
grep -n "slate-\|amber-500\|red-500/" /Users/andybarrows/TireTrackAdmin/app/returns/page.tsx
```
Replace each `bg-slate-*` → `bg-ios-gray6` (or appropriate iOS gray), `text-slate-400` → `text-ios-gray1`, etc. The `red-500` and `amber-500` references in damage/misship row styles already got replaced in Step 6.

- [ ] **Step 12: Visual smoke (this is the critical page — test thoroughly)**

```bash
cd /Users/andybarrows/TireTrackAdmin
npm run dev
```
Open http://localhost:3000/returns. Run through these scenarios:
- Open batches list renders as iOS grouped list with status badges
- Click a batch → items table loads in iOS table styling
- Damaged rows have red left border + tint; Misship rows have orange left border + tint; both flags → red wins
- Click a row → detail dialog opens with damage section showing red iOS card
- Click an image in the detail → lightbox dialog opens
- Edit button on detail → edit dialog opens with iOS form fields
- Search "abc" in the search box → search results render as iOS table
- Status filter dropdown opens with iOS styling and selecting filters results
- All previously-`alert()` flows now show iOS toasts (test a delete failure or a search edge case)
- No console errors

- [ ] **Step 13: TS + commit**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep "app/returns" | head -10
# expected: blank

git add app/returns/page.tsx
git commit -m "feat(ui): convert /returns to iOS aesthetic (preserves damage flag)"
```

---

## Task 23: Final sweep + validation

**Files:**
- Possibly modify: any file that escaped the page conversions with leftover slate styling

- [ ] **Step 1: Sweep for any remaining slate classes across the in-scope files**

```bash
cd /Users/andybarrows/TireTrackAdmin
grep -rnE "(bg|text|border|divide)-slate-" app/ --include="*.tsx" \
  | grep -v "app/wms/" | head -30
```
For each match outside `app/wms/*`: read the file, replace slate utility with the appropriate iOS equivalent. Common substitutions:
- `bg-slate-900`, `bg-slate-800` → `bg-white` or `bg-ios-gray6`
- `text-slate-400`, `text-slate-500` → `text-ios-gray1`
- `text-slate-300` → `text-black/80`
- `border-slate-700`, `border-slate-800` → `border-ios-gray5`
- `divide-slate-700` → `divide-ios-gray5`

If matches are in `app/wms/*` ignore them — WMS pages are out of scope.

- [ ] **Step 2: Sweep for any remaining `alert()` calls in in-scope files**

```bash
cd /Users/andybarrows/TireTrackAdmin
grep -rn "alert(" app/ --include="*.tsx" | grep -v "app/wms/" | head -10
```
Replace each with `toast.error(...)` / `toast.success(...)` / `toast(...)` from sonner.

- [ ] **Step 3: Full TypeScript pass**

```bash
cd /Users/andybarrows/TireTrackAdmin
npx tsc --noEmit 2>&1 | grep -v "app/wms" | head -30
```
Expected: blank (any errors outside `app/wms/*` indicate a remaining bug).

- [ ] **Step 4: Run the dev build to confirm no build-time errors**

```bash
cd /Users/andybarrows/TireTrackAdmin
npm run build 2>&1 | tail -30
```
Expected: build succeeds. `app/wms/*` may fail compile (pre-existing); if the build itself errors at a non-WMS file, fix.

- [ ] **Step 5: Cross-page visual smoke (one final pass)**

Start the dev server and click through every in-scope page. Confirm:
- Background is `#F2F2F7` everywhere
- White cards on every page
- iOS-style buttons (rounded-2xl, system font)
- No leftover dark slate panels
- No `alert()` popups — all replaced by sonner toasts at bottom-center
- Damage flag on `/returns` still works end-to-end (red row tint + badge + detail modal damage section)

- [ ] **Step 6: Commit any cleanup**

```bash
cd /Users/andybarrows/TireTrackAdmin
git add -A app/
git status --short
# Verify: no `app/wms/*` files are staged. If any are, unstage them: git restore --staged app/wms/
git commit -m "chore(ui): sweep remaining slate utilities + alert() calls" || echo "nothing to commit"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| Foundation: `globals.css` iOS theme | Task 3 |
| Foundation: `layout.tsx` + Toaster mount | Task 3 |
| shadcn init + components.json + lib/utils.ts | Task 2 |
| Button | Task 4 |
| Badge (with semantic variants) | Task 5 |
| Card | Task 6 |
| Input + Label | Task 7 |
| Select | Task 8 |
| Dialog | Task 9 |
| Table | Task 10 |
| Tabs + DropdownMenu | Task 11 |
| Sonner | Task 12 |
| Skeleton | Task 5 |
| PageHeader (custom) | Task 13 |
| GroupedList (custom) | Task 13 |
| Convert `/login` | Task 14 |
| Convert `/change-password` | Task 15 |
| Convert `/app-download` | Task 16 |
| Convert `/setup` | Task 17 |
| Convert `/` (dashboard) | Task 18 |
| Convert `/upcs` | Task 19 |
| Convert `/bonuses` | Task 20 |
| Convert `/reports` | Task 21 |
| Convert `/returns` (damage flag preserved) | Task 22 |
| Skip `/wms/*` | Documented as not-touched |
| Replace `alert()` with sonner toasts | Task 22 step 10, Task 23 step 2 |
| Conversion order (low→high complexity) | Tasks 14→22 in that order |
| Single PR | All commits on `feat/ios-redesign` |
| Visual smoke per page | Step in each conversion task |

All spec requirements have a task.

**Placeholder scan:** No "TBD" / "TODO" / vague instructions found. Each page conversion task names the components to use, the layout pattern, and the verification scenario.

**Type consistency:**
- Component names consistent (`Card`, `CardContent`, `CardHeader`, `Button`, `Dialog`, etc.)
- Import path `@/components/ui/<name>` matches the alias set up in Task 2
- `cn()` from `@/lib/utils` used consistently
- `toast` from `sonner`, `<Toaster />` from `@/components/ui/sonner`

**Scope check:** 23 tasks, single PR, sequential phases. Subagent-driven execution handles each task as a clear unit.

**One known acceptable inconsistency:** the dashboard (Task 18) will link to WMS pages that haven't been restyled. Those links will lead to dark-slate WMS pages. This is called out in the dashboard task as "expected and acceptable" — WMS is explicitly deferred per the spec.

Plan complete.
