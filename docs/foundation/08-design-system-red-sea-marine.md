# 08 — Design System imported from Red Sea Marine

**Purpose:** one self-contained specification for applying the Red Sea Marine («البحر الأحمر للرحلات») design language to Aqar, so the two platforms look and behave like one product family.

**Source of truth:** extracted on 2026-07-29 from the live Red Sea Marine repository — `frontend/tailwind.config.js`, `frontend/src/index.css`, `frontend/index.html`, the layout components, `docs/admin-360-standard.md`, `docs/operator-dashboard-standard.md`, and `docs/a11y-inspector-audit.md`. Every value below is copied from working code, not reconstructed from memory.

**Audience:** whoever implements this in Aqar — human or agent. It assumes no access to the Red Sea Marine repository.

**Length:** this file is deliberately far longer than its sibling foundation documents, which are 40–65-line indexes. It is a *reference specification* whose stated purpose is to be usable without access to the source repository, so the exact token values and the focus-trap source stay inline even where §9 marks them out of scope — a decision reversed later is worth more than a decision re-researched later. §7.1's code moves out to a pointer once it lands as `lib/use-focus-trap.ts`.

**Audited against the Aqar codebase on 2026-08-03; adoption scope approved the same day (§9, §10).** The audit corrected four claims that had gone stale between drafting and approval, and three internal defects in the spec itself. Where this file describes Aqar, it now describes what the code actually does — not what it did on 2026-07-29.

---

## 0. Read this before copying anything

The two platforms do **not** share a stack. Copying files across will not work; the tokens and patterns transfer, the code idioms must be translated.

| | Red Sea Marine | Aqar |
|---|---|---|
| Framework | React 18 + **Vite**, `.jsx` | **Next.js** (App Router), `.tsx` |
| Tailwind config | `tailwind.config.js` | `tailwind.config.ts` (typed, `satisfies Config`) |
| Font loading | Google Fonts `<link>` in `index.html` | **`next/font`, self-hosted** |
| Font family | **Cairo** (+ Inter for Latin) | **Tajawal** |
| Brand colour | Navy `#0077b6` + gold `#f59e0b` | Teal `#0f766e` |
| Dark mode | **None** | **Supported** via `prefers-color-scheme` |
| Routing | React Router `useSearchParams` | Next.js `useSearchParams` / server components |
| Icons | `lucide-react` | **Hand-written inline SVG, no icon library.** Aqar ships 7 runtime dependencies; `lucide-react` would be its first UI dependency — a real decision, not an alignment chore |

**The three decisions in §10 have been answered** (2026-08-03). §9 carries the approved scope. Read both before touching §3 — two of the answers change what the tokens should be, and most of §3 and §4 is **out of scope**.

---

## 1. Design principles (the part that matters most)

These are the platform-wide rules Red Sea Marine actually enforces. They are stack-independent and should govern Aqar regardless of which visual decisions you take.

### 1.1 Interface mirrors the work, never the data model
Screens are organised around what the user must decide *now*, not around tables. A dashboard is a **triage queue**, not a statistics page.

### 1.2 Frequency & Urgency First navigation
Navigation is ordered by how often and how urgently something is touched — not by feature taxonomy. **A monthly action and an all-day action are never peers.**

Concretely, the sidebar has three bands:
- **Primary (pinned, always visible):** the 2–4 things touched daily.
- **Secondary (grouped, collapsible):** catalogue/assets, finance — periodic.
- **Utility (bottom, de-emphasised):** profile, subscription, configuration.

The group containing the active route auto-opens; open/closed state persists.

### 1.3 Progressive disclosure — decision first, detail on demand
Show the decision, hide the detail behind an Inspector. Locked/plan-gated features render in a **visible locked state** rather than disappearing, so the user learns the capability exists.

### 1.4 One source of truth per fact
Every derived number is defined exactly once (e.g. revenue = `operator_payout` on confirmed/completed rows). Never recompute the same business fact in two components.

### 1.5 Derived presentation state — never add core status values for UI
If the UI needs a new state ("needs attention", "overdue"), **derive it from existing fields** with a shared predicate. Do not extend the domain's status enum for a visual need — every consumer of that enum then has to change.

### 1.6 Reuse before rewrite
Before building a component, look for an existing primitive. Shared primitives already proven in Red Sea Marine: enterprise table controls, Inspector drawer, derived timeline, grouped sidebar, status chips, CSV export, focus trap.

### 1.7 Additive changes only
Prefer adding a column/prop/token over repurposing one. Backward compatibility is cheaper than coordination.

### 1.8 Observation-first
Never wire a button to an action that the current actor is not authorised to perform. If the RPC/endpoint for this actor does not exist, the screen is **read-only** until it does. Do not reuse another actor's endpoint to make a button work.

### 1.9 Deep-link first navigation
A detail page **summarises and links out**; it never re-implements another module's screen. Cross-module links carry filter params (`?customer=`, `?status=`). Keep the param in the URL even if the target does not consume it yet — additive and safe.

---

## 2. Object categories (decides which layout to use)

Classify every entity before designing its screen. Getting this wrong is the most expensive layout mistake.

| Category | Definition | Layout |
|---|---|---|
| **Persistent Entity** | Long-lived, accumulates history, referenced by other modules (customer, property, owner, operator) | **360 detail page** (§4) |
| **Financial Ledger** | A persistent entity whose primary content is money movement (invoice, contract) | 360 page + ledger specialisation: append-only audit trail, no destructive edits |
| **Workflow Object** | Exists to be resolved and then goes quiet (a request, an application, a cancellation) | **List + Inspector**, not a page |

**Rule of thumb:** if the user will come back to it repeatedly over months → 360 page. If they touch it once to decide → list + Inspector.

---

## 3. Design tokens (exact values)

### 3.1 Colours

Merge these into `tailwind.config.ts` under `theme.extend.colors`. Values are exact.

```ts
colors: {
  primary: {
    50:  "#e6f4f9", 100: "#b3dff0", 200: "#8fd0ea", 300: "#5cb8de",
    400: "#2e9ccb", 500: "#0077b6", 600: "#005f8f", 700: "#004a70",
    800: "#063b5a", 900: "#062847",
  },
  accent:  { 50: "#fdf1e7", 100: "#fbe0c9", 400: "#f6b27e", 500: "#f4a261", 600: "#e08c4a", 700: "#bf7438" },
  gold:    { 50: "#fffbeb", 100: "#fef3c7", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309" },
  sand:    { 50: "#fdf8f0", 100: "#f5e6c8", 500: "#d4a853" },
  neutral: { 900: "#1a1a2e", 800: "#2d2d44" },
  success: { DEFAULT: "#10b981", 50: "#ecfdf5", 100: "#d1fae5" },
  warning: { DEFAULT: "#f59e0b", 50: "#fffbeb", 100: "#fef3c7" },
  error:   { DEFAULT: "#ef4444", 50: "#fef2f2", 100: "#fee2e2" },
},
```

**Semantic roles — follow these, not personal taste:**

| Token | Role |
|---|---|
| `primary-500/600` | Structure, links, active navigation, informational emphasis |
| `gold-500` | **The single most important call to action on a screen.** Its scarcity is what makes it work — do not paint several golds on one page |
| `accent-500` | Secondary CTA and the focus ring |
| `success / warning / error` | State only, never decoration |
| `neutral-900/800` | Dark surfaces, hero gradients |
| `sand` | Warm neutral backgrounds |

⚠️ **`neutral` collides with Tailwind's default scale at 800/900 — verified live.** Aqar's `globals.css` sets body to `bg-neutral-50 text-neutral-900`, and `bg-neutral-950` in dark mode. Tailwind deep-merges `extend.colors`, so importing this block silently repaints **every body text in the product** from grey to blue-black `#1a1a2e`, and every `dark:border-neutral-800` to `#2d2d44`, while `neutral-50`/`neutral-950` stay grey — a mismatched pair nobody chose.

**Decision: if this palette is ever imported, the token is named `ink`, not `neutral`.** Renaming is free at import time and unpickable afterwards. "Verify it still reads correctly" is not a mitigation — it asks a reviewer to eyeball a thousand screens.

### 3.2 Typography

```ts
fontFamily: {
  arabic:  ["Cairo", "sans-serif"],
  english: ["Inter", "sans-serif"],
},
```

Weights actually used: Cairo **400 / 600 / 700 / 800 / 900**, Inter **400–800**. Hero headings use 800–900.

**In Aqar, keep `next/font` and change the family** — do not switch to a Google `<link>`. Self-hosting is strictly better (no render-blocking request, no layout shift, no third-party origin), and Red Sea Marine's CDN link is a legacy choice, not a recommendation.

```ts
// app/layout.tsx
import { Cairo } from "next/font/google";
const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400","600","700","800","900"], variable: "--font-cairo" });
```
Then in the config: `sans: ["var(--font-cairo)", ...fallbacks]`.

### 3.3 Shadows

```ts
boxShadow: {
  card:         "0 4px 24px rgba(10,61,107,0.12)",
  "card-hover": "0 10px 40px rgba(10,61,107,0.18)",
},
```
Both are **tinted with the brand navy**, not black. That tint is a large part of why the UI feels cohesive — plain black shadows look dirty against these blues.

### 3.4 Motion

```ts
keyframes: {
  float:        { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
  "fade-up":    { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
  "pulse-ring": { "0%":  { boxShadow: "0 0 0 0 rgba(245,158,11,0.5)" },
                  "70%": { boxShadow: "0 0 0 12px rgba(245,158,11,0)" },
                  "100%":{ boxShadow: "0 0 0 0 rgba(245,158,11,0)" } },
},
animation: {
  float:        "float 4s ease-in-out infinite",
  "fade-up":    "fade-up 0.5s ease-out both",
  "pulse-ring": "pulse-ring 2s infinite",
},
```

Aqar's existing `fade-in`, `slide-in-right`, `slide-in-up` (150–200ms) are **shorter and better for UI chrome**. Keep them. Use `fade-up` for content entrances and `pulse-ring` sparingly to draw attention to one urgent control.

**Duration convention:** UI chrome 150–200ms · content entrance 300–500ms · ambient loops 2–4s.

### 3.5 Shape

| Element | Radius |
|---|---|
| Buttons, inputs | `rounded-xl` |
| Cards, modals | `rounded-2xl` |
| Pills, badges, the gold CTA | `rounded-full` |

Consistent radii do more for family resemblance than colour does. Do not mix in `rounded-md`.

---

## 4. Component classes

> **Out of scope for Aqar — see §9.** This section is retained as the reference definition of the source system, not as an instruction. Aqar styles with inline utilities; adding a parallel `@layer components` vocabulary would give the product two ways to build the same button.

Add to `globals.css` inside `@layer components`. These are the exact definitions **as they exist in Red Sea Marine**, with two defects corrected below.

⚠️ **Defect 1 — the button names are inverted in the source.** `.btn-primary` is painted with `accent` (orange) and `.btn-secondary` with `primary` (navy), so the name contradicts the token it uses. Anyone reading the name wires the wrong colour. The names below are corrected to match their tokens; **if you diff against the Red Sea Marine repository, expect the two to be swapped there** — that repository is what needs fixing, not this file.

```css
@layer components {
  /* Renamed from .btn-primary: this is the ACCENT button. */
  .btn-accent {
    @apply bg-accent-500 hover:bg-accent-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors duration-200;
  }
  /* Renamed from .btn-secondary: this is the PRIMARY (structural) button. */
  .btn-primary {
    @apply bg-primary-500 hover:bg-primary-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors duration-200;
  }
  .btn-gold {
    @apply bg-gold-500 hover:bg-gold-600 text-white font-semibold px-6 py-3 rounded-full transition-all duration-300;
  }
  .btn-outline {
    @apply border border-primary-500 text-primary-600 hover:bg-primary-500 hover:text-white font-semibold px-6 py-3 rounded-xl transition-all duration-300;
  }
  .card {
    @apply bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden;
  }
  .card-interactive {
    @apply bg-white rounded-2xl border border-gray-100 shadow-card hover:shadow-card-hover hover:-translate-y-1 transition-all duration-300 overflow-hidden;
  }
  .input-field {
    @apply w-full border border-gray-300 rounded-xl px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent;
  }
  .glass {
    @apply backdrop-blur-md bg-white/15 border border-white/25;
  }
  .badge         { @apply inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold; }
  .badge-success { @apply bg-success-50 text-success; }
  .badge-warning { @apply bg-warning-50 text-warning; }
  .badge-error   { @apply bg-error-50 text-error; }
  .badge-gold    { @apply bg-gold-50 text-gold-700; }
}

@layer utilities {
  .focus-ring { @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
}
```

**Notes**
- ⚠️ **Defect 2 — the focus ring was defined twice, in two colours.** `.input-field` used `ring-primary-500` while the `.focus-ring` utility uses `ring-accent-500`, so a form's inputs and its buttons highlighted differently. §3.1 assigns the focus ring to `accent`, so `.input-field` above is corrected to `accent-500`. **One focus colour per product** — a keyboard user tracks a moving highlight, and a colour change reads as a different kind of element.
- `.input-field` hard-codes `text-right`. Correct for an RTL-only product; if Aqar ever serves LTR, change it to `text-start`.
- `.card` and `.card-interactive` are deliberately separate: static content vs a clickable surface. Do not add hover lift to `.card`.
- These are **white-surface** definitions with no `dark:` variants — see §10.1 for why that matters more in Aqar than the source system.

---

## 5. Layout patterns

### 5.1 Mobile bottom navigation
Fixed tab bar, **mobile only** (`md:hidden`), 3 fixed destinations + 1 auth-aware account tab.

Non-obvious details that make it feel native:
- `min-h-[56px]` touch targets.
- `paddingBottom: env(safe-area-inset-bottom)` for iPhone home-indicator clearance.
- Active tab: `text-primary-600` + icon `scale-110` + a small **gold dot** underneath.
- Upward shadow: `shadow-[0_-4px_24px_rgba(10,61,107,0.08)]` — same navy tint as cards.
- The page needs `pb-16 md:pb-0` so content is not hidden behind the bar.
- The account tab follows the **active workspace**, not merely the role — a multi-role account lands where it is currently working.

### 5.2 Grouped sidebar (desktop dashboards)
Implements §1.2. Primary pinned items, collapsible secondary groups, de-emphasised utility band at the bottom. Persist open/closed state per group; auto-open the group containing the active route.

### 5.3 Global "+ New"
The primary create action lives **once** in the layout header, not repeated per page. Red Sea Marine previously had three entry points for the same action and consolidating them was a clear improvement. Plan-gated? Render it **locked and visible**, never hidden.

### 5.4 Persistent banner slot
Account-level messages (plan expiry, verification pending) render **once** in the layout at the top of `main`, and self-hide when empty. Never per-page.

---

## 6. Page archetypes

### 6.1 The 360 detail page (Persistent Entities)
```
Header      — name, status badges, key identifiers, primary actions
Summary     — 4–6 stat cards, each DEEP-LINKING to another module filtered by this entity
Sections    — operational content grouped by task
Notes       — append-only, authored, internal (never edited or deleted)
Timeline    — derived from existing timestamp fields; no new tables
```
**The summary cards must link out.** A 360 page that re-implements the bookings table is a maintenance liability — it will drift from the real one.

**Internal notes are append-only everywhere.** One implementation, reused; never a per-module variant.

### 6.2 Enterprise table
Search · filters · named sort (a labelled `<select>`, not bare column clicks) · client-side pagination (default 25) · CSV export of the *filtered* set (UTF-8 BOM so Excel reads Arabic) · skeleton loading · explicit empty state with a "clear filters" action.

Filters belong in the **URL** (`?status=`, `?source=`) so views are shareable and the back button behaves. Whitelist accepted values and fall back gracefully on an unknown one.

Any filter change **resets to page 1**.

### 6.3 Inspector vs Modal vs Page

| Use | When |
|---|---|
| **Inspector** (right drawer; full-screen sheet on mobile) | Reviewing/acting on one row without losing list context |
| **Modal** | A single focused confirmation or short form |
| **Page** | Persistent entity, or content worth its own URL |

**Inspector content order — decision first:**
1. **"Actions required now"** — only the actions currently valid
2. Core record fields
3. Contact (tap-to-call, WhatsApp, email as real links)
4. Related entity summary
5. Derived timeline

**Safe actions** (confirm, mark collected) may appear as one-click row actions. **Destructive or financial actions** (cancel, refund, force-majeure) stay inside the Inspector behind an explicit confirmation.

---

## 7. Accessibility baseline (non-negotiable)

Red Sea Marine paid this debt once, via a shared hook. **Copy the hook rather than the fixes** — the same five gaps recur in every modal, and patching them in place guarantees they recur again.

**Every dialog must have:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` bound to its heading, an `aria-label` on the close control, focus moved in on open, Tab trapped inside, focus returned to the opener on close, and Escape to close.

### 7.0 Where Aqar actually stands (audited 2026-08-03)

The original draft budgeted a full phase to "apply `useFocusTrap` to every existing dialog". That over-counted one component and missed another entirely.

| Component | State |
|---|---|
| `components/ui/drawer.tsx` | Has `role="dialog"`, `aria-modal`, `aria-label`, `aria-label` on close, Escape, focus-in, focus restored to opener, body scroll lock. **Missing only Tab trapping** — and the nesting stack, which it needs because it already supports nested drawers via `zClass` |
| `components/upgrade-modal.tsx` | **No dialog semantics at all.** A bare `fixed inset-0` overlay: no role, no `aria-modal`, no Escape, no focus management. Keyboard and screen-reader users can tab straight through it into the page behind |

So the work is not a phase — it is: adopt §7.1 as `lib/use-focus-trap.ts`, wire it into `Drawer` (which supplies everything else already), and give `upgrade-modal.tsx` the full set. Scoped at roughly two hours, and it is the one item from this document that ships **with** the launch sprint rather than after it, because accessibility is not polish.

**Any clickable row must have:** `role="button"`, `tabIndex={0}`, an `aria-label` naming the record, `onKeyDown` for Enter and Space (Space `preventDefault`-ed or the page scrolls), and a visible focus ring.

### 7.1 `useFocusTrap` — portable source (TypeScript)

```ts
"use client";
import { useEffect, useRef } from "react";

// Nesting is why this keeps a stack: a confirmation modal often opens while the
// drawer's own trap is still mounted. Without the stack both answer the same
// Escape and fight over Tab. Only the topmost trap responds.
const stack: HTMLElement[] = [];

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(node: HTMLElement): HTMLElement[] {
  // Deliberately no layout-based visibility check. offsetParent is null for every
  // element under jsdom (it does no layout), which silently empties this list in
  // tests. These dialogs hide content by not rendering it, so a hidden control is
  // absent from the DOM rather than present-but-invisible.
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => !el.hasAttribute("hidden"));
}

export default function useFocusTrap(active: boolean, onClose?: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const opener = document.activeElement as HTMLElement | null;
    stack.push(node);

    const first = focusableWithin(node)[0];
    if (first) first.focus();
    else { node.setAttribute("tabindex", "-1"); node.focus(); }

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== node) return;   // a nested dialog owns the keys

      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== "Tab") return;

      const items = focusableWithin(node!);
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl  = items[items.length - 1];
      const inside  = node!.contains(document.activeElement);

      if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
        e.preventDefault(); firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const i = stack.indexOf(node!);
      if (i !== -1) stack.splice(i, 1);
      // Only if still in the document — the row that opened it can disappear on refresh.
      if (opener?.focus && document.contains(opener)) opener.focus();
    };
  }, [active]);

  return ref;
}
```

**Two things worth knowing rather than rediscovering:**
- `aria-modal` is what actually keeps a screen reader out of the content behind the panel. `aria-hidden` on the backdrop hides only the backdrop element.
- Focus is restored **only if the opener is still in the document**.

### 7.2 Known open item
Secondary-text contrast is **not** yet verified against WCAG AA in Red Sea Marine: `text-gray-400` on white measures roughly 2.8:1 (below the 4.5:1 minimum), and `amber-600/700` on `amber-50` is suspect. `text-gray-500` (~4.6:1) barely passes.

**Do not inherit this.** In Aqar, use `text-gray-500` or darker for any text that carries meaning, and reserve `gray-400` for genuinely decorative glyphs.

---

## 8. RTL and Arabic conventions

- `<html lang="ar" dir="rtl">`; Latin islands get `lang="en"` + `direction: ltr`.
- Prefer logical properties (`ms-`/`me-`, `text-start`/`text-end`) over `ml-`/`mr-`/`text-right`. Red Sea Marine uses physical ones in places — that is legacy, not a pattern to copy.
- **Icons that indicate direction must mirror** (back/forward arrows). Icons that represent objects must not.
- Numbers, currency and dates render **LTR inside RTL text**; wrap them if the browser mis-orders.
- Times display in Arabic meridiem («٢:٣٠ مساءً»), not AM/PM.
- All user-facing strings are Arabic. Code, comments, commits and identifiers stay English.
- Every status is conveyed by **text**, never colour alone.
- Empty states explain what to do next; they are never a bare "no results".

---

## 9. Adoption scope for Aqar — approved 2026-08-03

The original draft assumed Aqar would import the visual layer wholesale. The audit found that **the parts worth importing are the cheap ones**, and that two of the expensive phases were already built. Approved sequencing:

> **Launch sprint → green tier (half a day) → yellow tier after launch.**

Nothing in this document outranks the launch sprint (PDPL, e-mail confirmation, MFA, re-enabling Vercel Deployment Protection). Those are legal and security obligations; this is presentation. The single exception is §7.0, which ships with the launch sprint.

### 🟢 Green — ✅ **ADOPTED 2026-08-03. In force.**

§1, §2, §7, §8 and §11 are now binding on new work in Aqar. They are not aspirations in an imported document any more; a screen that ignores them is wrong, not merely unfashionable.

Two of the six were already shipped and two are now mechanical:

- **§7.0 + §7.1** shipped with the launch sprint (`lib/use-focus-trap.ts`).
- **§8 logical properties** — `npm run check:rtl` reports every physical-direction utility, distinguishing deliberate ones (an element carrying `dir=`, where right-alignment belongs to an LTR run) from drift. Still applied **as files are touched**, per the sequencing below; the script is a worklist, never a build gate.
- **§7.2 contrast floor** — checked in review. `text-slate-400` is for decorative glyphs only; anything that carries meaning is `slate-500` or darker.
- **§11 checklist** — run before any new screen ships.



| Item | Why it is cheap |
|---|---|
| §1 principles, as a stated reference | Aqar already obeys §1.4/§1.5 (`contract` carries no financial status column — paid/overdue is derived from `charge` + `payment_allocation`) and §1.8 (ADR-0006 forbids a control the actor cannot use). Writing them down stops them drifting |
| §2 object categories | Settles future layout arguments before they start |
| §7.0 + §7.1 focus trap | ~2h, and fixes a real defect. **Ships with the launch sprint** |
| §7.2 contrast floor | A lint rule in review, not a refactor |
| §8 logical properties (`ms-`/`me-`/`text-start`) | Applied as files are touched; no sweep |
| §11 checklist | Costs nothing and catches the rest |

### 🟡 Yellow — after launch

- ✅ **CSV export with a UTF-8 BOM · named sort control** — shipped 2026-08-03 for the six specced lists (`lib/list-specs.ts`). Amounts export ungrouped so Excel treats them as numbers, and every cell is guarded against formula injection.

- ✅ **Mobile bottom navigation (§5.1)** — shipped 2026-08-03. Promoted ahead of the rest once the owner confirmed office staff work primarily from phones. Three destinations by frequency (dashboard, contracts, receipts) plus "المزيد", which opens the existing drawer rather than a second menu; the top-bar hamburger was removed as the duplicate opener §5.3 objects to.

- ✅ **Brand-tinted shadows (§3.3), retinted to teal** — shipped 2026-08-03 as `shadow-card` / `shadow-card-hover` / `shadow-nav`. Suppressed in dark mode (`dark:shadow-none`): a tinted shadow on a near-black surface reads as a glow, and the border already does the separating there. Applied to the surfaces that are genuinely cards; the remaining `shadow-sm` panels convert as they are touched.

Remaining: one global "+ New" in the layout (§5.3) · the persistent banner slot (§5.4) · **brand-tinted shadows — retinted to teal, not navy** · radius consistency (§3.5) · mobile bottom navigation (§5.1) · the 360 archetype (§6.1), which `app/app/tenants/[id]` is already converging on.

### 🔴 Red — not adopted

| Rejected | Reason |
|---|---|
| §3.1 full colour ramp | Collides with the brand decision **and** with `neutral`; requires migrating `brand.*` → `primary-*` across the codebase. Purely cosmetic churn |
| §3.2 font swap | Tajawal → Cairo is cost without benefit unless one visual identity becomes a business goal. This file itself calls typography the weakest family signal |
| §4 component classes | Aqar styles with inline utilities. A parallel `@layer components` vocabulary is a **second styling system**, which is the same objection that kept shadcn/ui out of this project |
| `lucide-react` | Would be the first UI dependency in a 7-package runtime, replacing icons that already work |

### Already built — do not "migrate" these

The draft's phases 5 and 6 were largely complete before it was written:

- **Navigation (§1.2/§5.2):** `components/app-sidebar.tsx` already bands the sidebar — pinned home, a grouped asset band, a finance band, a de-emphasised utility band.
- **Enterprise table (§6.2):** `ListToolbar`, `Pagination`, `StatusTabs`, `list-skeleton`, `FilterableCards` and URL-backed filters via `parseListParams` all exist. **Only CSV export and named sort are missing** — both in the yellow tier.

Re-running these as "migrations" would move things users already know for no gain.

---

## 10. Decisions — answered 2026-08-03

### 10.1 Dark mode — ✅ **A. Dark mode stays. Not negotiable.**

Aqar supports `prefers-color-scheme: dark`; Red Sea Marine does **not** and its component classes hard-code white surfaces (`bg-white`, `border-gray-100`). Importing them as-is gives Aqar **white cards on a dark background** — unreadable.

| Option | Consequence |
|---|---|
| ✅ **A. Keep dark mode** | Chosen. Aqar carries **1032 `dark:` utilities** across `app/` and `components/`; dark mode is not a feature here, it is how the product is built |
| ❌ **B. Drop dark mode** | A visible regression for every user who has it today |
| ❌ **C. Light-only for shared components** | Cheap now, inconsistent forever |

**The draft's "~1 extra day" estimate was answering the wrong question.** Adding `dark:` variants to §4 is indeed about a day — but the cost that matters is that §4 introduces a **competing styling architecture**, and that cost does not appear on any schedule. It is why §4 sits in the red tier (§9), which removes the dark-mode work from scope entirely.

### 10.2 Brand colour — ✅ **C. Teal stays; borrow the discipline, not the ramp.**

The draft recommended **B**. The audit downgraded it to **C**, because B's real cost is a repo-wide `brand.*` → `primary-*` migration for zero functional gain, immediately before launch.

**What is adopted instead:** the *rules* that make the source system cohesive — exactly one primary call to action per screen, `success`/`warning`/`error` reserved for state and never decoration, and consistent radii. Those carry almost all of the family resemblance and cost nothing. Generating a teal ramp at the navy lightness steps stays available later, if and when a shared identity becomes a business goal.
Marine navy + gold reads "sea, travel, leisure". Real estate conventionally reads trust and stability — teal already does that job.

| Option | Consequence |
|---|---|
| **A. Full unification** — Aqar adopts navy + gold | Unmistakably one family. Loses a colour chosen for the domain |
| **B. Shared structure, distinct hue** (recommended) | Aqar keeps teal as `primary-500`, adopts **everything else** — spacing, radii, shadows, components, layout, motion, a11y. Sibling products rather than clones. This is how most product families actually work |
| **C. Shared accent only** | Keep teal, adopt gold as the single CTA colour. Cheapest visible link between the two |

**Note for a future reversal:** if the ramp is ever adopted, generate teal at the same lightness steps as the navy ramp so every `primary-*` usage keeps its intended contrast — and rename `neutral` to `ink` first (§3.1).

### 10.3 Font — ✅ **Tajawal stays.**

Tajawal → Cairo would unify the voice, at the cost of revisiting `leading-*` across every dense table (Cairo has a larger x-height and taller line boxes). This document's own argument settles it: typography is a weaker family signal than colour, shape and layout — and we are not unifying colour either (§10.2).

---

## 11. Checklist for any new screen

Written for Aqar as scoped in §9 — the colour references follow the teal decision (§10.2), not the source palette.

- [ ] Entity classified (§2) → correct archetype chosen
- [ ] Navigation placement justified by frequency/urgency, not taxonomy (§1.2)
- [ ] There is **exactly one** primary call to action on the screen, in `brand`
- [ ] Radii follow §3.5; any card shadow is tinted with the brand teal, never plain black
- [ ] Every derived state comes from a shared predicate, not a new status value (§1.5)
- [ ] Cross-module links carry filter params (§1.9)
- [ ] Any dialog uses `useFocusTrap` + full dialog semantics (§7)
- [ ] Any clickable row is keyboard-openable with a visible focus ring (§7)
- [ ] Meaningful text is `gray-500` or darker (§7.2)
- [ ] Status conveyed by text, not colour alone (§8)
- [ ] Empty state says what to do next (§8)
- [ ] Table filters live in the URL and reset to page 1 (§6.2)
- [ ] Destructive/financial actions require explicit confirmation and are not row actions (§6.3)

---

## Appendix — what was deliberately not imported

| Excluded | Why |
|---|---|
| Payment (Moyasar) integration and its callback pages | Domain-specific; Aqar has its own gateway decision (`docs/adr/0003-payment-gateway.md`) |
| Trip/booking domain components | Not transferable |
| PWA + service-worker configuration | Separate concern; adopt on its own merits |
| Loyalty, referral and badge visual language | Feature-specific, currently dormant even in the source |
| The `text-gray-400` contrast pattern | Fails WCAG AA (§7.2) — importing it would import a known defect |

---

**Maintenance:** if Red Sea Marine changes a token or a shared pattern, update this file in the same batch. A design system that drifts silently is worse than none, because it is trusted while wrong.

**The same rule applies to the Aqar side, and it has already bitten once.** Between drafting (2026-07-29) and approval (2026-08-03) this file went stale on four counts — the sidebar had already been banded, the list screens already had URL-backed filters and skeletons, `Drawer` already had most of its dialog semantics, and the icon question had an answer. A migration plan that budgets for finished work spends real time on it.

**Audit trail — corrections applied 2026-08-03**

| # | Correction |
|---|---|
| 1 | §0 — icons: Aqar uses hand-written inline SVG and has no icon library; `lucide-react` would be its first UI dependency |
| 2 | §3.1 — the `neutral` collision is confirmed live; renaming to `ink` is now the decision, not a suggested alternative |
| 3 | §4 — `.btn-primary`/`.btn-secondary` were painted with the opposite tokens to their names; corrected here, still inverted upstream |
| 4 | §4 — the focus ring was defined in two colours (`.input-field` navy vs `.focus-ring` accent); unified on accent per §3.1 |
| 5 | §7.0 — added: `Drawer` needs only Tab trapping, while `upgrade-modal.tsx` has no dialog semantics at all |
| 6 | §9 — replaced the 8-phase plan with the approved green/yellow/red scope, and recorded what was already built |
| 7 | §10 — the three open decisions answered: dark mode stays, teal stays, Tajawal stays |
