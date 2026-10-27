# Imbox design

The rules for how Imbox looks, moves and speaks. `imbox-website/docs/content/docs/design.mdx` is the short public version; this file is the working reference and records the real values in `src/web/index.css`. If the two disagree, the code wins, then this file.

Imbox should feel calm, quick and quiet.

## 1. Principles

- **Quiet.** Show what matters now. Everything else waits behind a click or a shortcut.
- **People first.** Mail from people comes before newsletters and receipts. Say who something is from before saying what it is about.
- **Keyboard first.** Every common action has a shortcut (`src/web/lib/shortcuts.ts`), and `Cmd+K` finds the rest.
- **Honest.** Say what failed and what the person can do. If a feature needs a key or a setting, say so, and hide it when it cannot work.
- **Two layouts.** Desktop (`DesktopApp.tsx`, `pages/`) and phone (`MobileApp.tsx`, `mobile/`) are separate screens. The phone layout is for thumbs, not a squeezed desktop.
- **Monochrome.** No brand color. Hierarchy comes from weight, size, spacing and opacity.

## 2. Color

Strictly grayscale. A warm near-black on white in light, and soft grays on near-black in dark. Tokens are shadcn's neutral set, defined once in `src/web/index.css`. Use the token, never a hex value or a Tailwind palette color (`text-red-500`, `bg-blue-50` and the like are never used).

| Token | Light | Dark |
|---|---|---|
| `background` | `#ffffff` | `#191919` |
| `foreground`, `primary` | `#37352f` | `#d4d4d4` |
| `card` | `#ffffff` | `#1f1f1f` |
| `popover` | `#ffffff` | `#252525` |
| `sidebar` | `#f7f7f5` | `#202020` |
| `muted`, `secondary`, `input` | foreground at 6% | white at 5.5% |
| `accent` (hover, selected) | foreground at 8% | white at 8% |
| `border` | foreground at 9% | white at 9.4% |
| `muted-foreground` | foreground at 65% | white at 55% |
| `tertiary` | foreground at 45% | white at 38% |
| `ring` | foreground at 30% | white at 30% |
| `destructive` | same as `foreground` | same as `foreground` |

- **Destructive is not red.** A destructive action is named in words (Delete, Trash, Screen out) and confirmed in an `AlertDialog`.
- **Selected and unread** use inversion or weight: `bg-accent` for selected, a 6px `bg-foreground` dot and 600 weight for unread, `bg-foreground text-background` for the strongest emphasis.
- **The only color** is the soft tint behind avatars and pictures that come from outside (`avatarTint` in `src/web/lib/format.ts`). It is derived from the address, so a person always looks the same. Keep it soft.
- **Charts** use the `chart-1` to `chart-5` grays.
- **Dark mode** is the `.dark` class on `<html>`, driven by the theme setting, with `prefers-color-scheme` when set to system. Check every screen in both. Both are pure grayscale.

## 3. Type

- **Geist** for text, **Geist Mono** for codes, keys and shortcuts (`Kbd`). Both are self-hosted through `@fontsource-variable`. No font service, no Google Fonts link.
- Sizes step through 11, 12, 13, 14 (default body), 16, 20, 24. Page titles are 24 at 600 with slight negative tracking; section titles 20 at 600.
- 11 to 12 is for small caps labels and counts. The `caps` utility is 12/16, weight 500, muted.
- Use `tnum` (tabular numbers) on times, counts and amounts so columns line up.
- Say who before what: sender in 14, then subject, then a muted 13 snippet.

## 4. Shape, depth and motion

- One border width: 1px, `border` token. Radius is `--radius: 0.375rem` with the usual `sm`, `md`, `lg`, `xl` steps from it. Avatars are 4px-rounded squares by default and circles only where the person's photo calls for it.
- Soft shadows without color, used rarely. Prefer a border to a shadow.
- Motion is short and explains a change (a row leaving, a sheet arriving, a count popping). Use `tw-animate-css` and the keyframes in `index.css` (`fade-in`, `scale-in`, `slide-up`, `pop`, `row-out`). Do not decorate. Everything must respect `prefers-reduced-motion`; `index.css` already collapses durations.
- Scrollbars are thin and neutral.

## 5. Icons and marks

- Icons come from `lucide-react`. The app's own tab and menu icons are in `components/BrandIcons.tsx` and `destinationIcons.tsx`; reuse them for Imbox, Screener, Updates, Contacts, Calendar, Sent and Assistant instead of drawing new ones.
- **No emoji anywhere**: not in the interface, mockups, docs, commit messages or toasts. If you need a glyph, use an SVG line icon.
- **Accounts.** When more than one mailbox is connected, each gets a small black-and-white mark (circle, square, triangle, diamond, and so on) on its rows and a tooltip with the address (`AccountGlyph`, `AccountDot`, `lib/accountGroups.ts`).

## 6. Components

Use `src/web/components/ui` (shadcn, radix). Do not write a new button, input, dialog, popover, tooltip, select, switch or tab set. Add parts with `npx shadcn@latest add <name>`. Reach for these first:

| Need | Use |
|---|---|
| Action | `Button` (`default`, `outline`, `ghost`; `icon-xs`, `icon-sm` for rows), `ButtonGroup` |
| Choose one | `ToggleGroup`, `Select`, `Tabs`; cards for the main kinds (Screener, Updates and Contacts filters are cards) |
| Overlay | `Dialog`, `AlertDialog` (confirm), `Sheet` and `Drawer` (phone), `Popover`, `DropdownMenu`, `Command` |
| Hint | `Tooltip` with a `Kbd` for the shortcut |
| Status | `Badge` (outline or secondary, never colored), `Skeleton`, `Spinner`, `Progress` |
| Empty | `Empty` via `components/EmptyState.tsx` |
| Form | `Field`, `Label`, `Input`, `InputGroup`, `Textarea`, `Checkbox`, `Switch` |

### Patterns

- **ThreadRow** (`components/ThreadRow.tsx`): avatar or checkbox, then sender (600 when unread) with an account mark and a count, then subject and a muted snippet, and on the right the time (12, tabular, muted) and attachment or shield icons. On hover a cluster of ghost icon buttons for Reply Later, Set Aside, Bubble Up and Trash, each with a tooltip and key. Keyboard cursor is an inset ring. Rows leave with the `row-out` animation. The callbacks passed to it must stay referentially stable (it is memoised).
- **Pages** are a single centered column. Lists run wider than reading pages. Keep the header calm: title, a muted scope label, actions on the right.
- **Top menu** (desktop): a floating dock of tabs, each with the app's own icon, and a More menu with icon tiles. The tab set comes from `lib/menuPresets.ts`; do not hard-code tabs elsewhere.
- **Phone** (`mobile/`): bottom `TabBar` of at most four tabs and More (`TAB_BAR_H` is 56). Anything that is not a tab is one tap away under More. Use sheets and large targets, `usePullToRefresh` and `useSwipe` for gestures, and `pb-safe` and `pt-safe` for the notch and home bar.
- **Cards** for the Screener show the person, why they are waiting, where mail will go, and two clear actions (Let in, Screen out). A decision applies to every connected account.
- **Toasts** (`components/ui/toaster-shim.tsx`): top and centered, one look for the whole app. A confirmation is a dark card that goes away on its own after a few seconds; an error is the same card inverted (light, outlined) and stays readable. Use `toast` from Sonner, one message at a time.
- **Dialogs**: confirm anything destructive or hard to undo with the word that names it ("Delete 3 threads"), not "OK". Escape closes everything.
- **Empty states** say what the page is for and what to do next, in one or two sentences, with one action at most.
- **Loading** uses `Skeleton` rows with the same height as real rows, so nothing jumps. Errors say what failed and offer a retry.
- **Mail bodies** render in a sandboxed, transparent iframe (`iframe.email-body`) after sanitizing. Tracking pixels are removed; other remote images stay hidden until the person shows them. Do not style inside the message.

## 7. Words

- Short, plain sentences. "Mail you sent", not "Outbound correspondence".
- Name things as the screen names them: **Imbox**, **Updates**, **Screener**, **Reply Later**, **Set Aside**, **Bubble Up**, **Bundles**, **Away mode**. Capitalize them as shown.
- No exclamation marks, no jokes in errors, no emoji, no marketing words ("seamless", "powerful", "supercharge").
- Errors: what failed, then what to do. "Could not send. Check the SMTP password in Settings."
- Buttons are verbs: Let in, Screen out, Send, Delete. Counts and dates are specific ("Tomorrow, 9:00").
- Address people by name where the data has one; fall back to the address.
- Use invented data in screenshots and demos: Maya Chen, `example.com`.

## 8. Accessibility and checks

- Everything reachable by keyboard, with a visible focus ring (`ring`). Icon-only buttons have an `aria-label`.
- Contrast: body text uses `foreground` or `muted-foreground`; `tertiary` is for non-essential metadata only.
- Targets are at least 44px on the phone.
- Test each screen at **375px** wide and on desktop, in **light and dark**, using only the keyboard, and with reduced motion on.
- Run `npm run lint` for the a11y rules Biome checks, and keep warnings from growing.

## 9. Before you ship a screen

1. Grayscale only, tokens only, no emoji.
2. Built from `components/ui` and existing patterns.
3. Desktop and phone both handled.
4. New shortcuts added to `lib/shortcuts.ts`.
5. Light, dark, 375px and keyboard checked.
6. Copy is short, plain and uses the screen's own names.
7. Screenshots or demos use invented data.
