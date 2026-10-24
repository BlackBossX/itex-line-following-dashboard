---
name: ITEX 2.0
description: Dark event control surfaces with legible timing and shared score evidence.
colors:
  bg: "#0b1019"
  surface: "#111a26"
  raised: "#172332"
  border: "#293747"
  text: "#edf2f7"
  muted: "#a4b2c4"
  accent: "#7bc5db"
  accent-bg: "#183440"
  gold: "#e4c38a"
  red: "#f5a6a6"
  green: "#9fd4b5"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.85rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  title:
    fontSize: "1.15rem"
    fontWeight: 600
    letterSpacing: "-.015em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontSize: ".85rem"
  timer:
    fontSize: "clamp(3rem,6vw,5.25rem)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-.045em"
rounded:
  badge: "5px"
  field: "6px"
  button: "7px"
  panel: "12px"
spacing:
  compact: "8px"
  field-gap: "12px"
  group: "16px"
  panel: "24px"
  content: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#0b2029"
    rounded: "{rounded.button}"
    padding: "10px 15px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "10px 15px"
  field:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: ITEX 2.0

## Overview

**Creative North Star: "The ITEX Control Panel"**

The incumbent interface uses dark navy surfaces, thin separators and cyan actions to support live competition work. Its density comes from readable tables, grouped controls and large timing numerals. The coordinator extension retains this established vocabulary.

Identity comes from the supplied ITEX artwork. Green confirms saved/live states, gold marks best results or paused timing, and red signals destructive actions or timing warnings. Motion accompanies event changes; reduced-motion preferences retain the information without animation.

**Key Characteristics:**
- Dark tonal layers with restrained borders.
- Tabular numerals for timers, marks and running order.
- Explicit labels and visible operational state.

## Colors

The palette is cool and subdued, with cyan reserved for actionable or selected content.

### Primary
- **Event Cyan** (`accent`): primary timing actions, links, focus indicators and selected review actions.
- **Cyan Navy** (`accent-bg`): selected team background, paired with a visible border.

### Secondary
- **Saved Green** (`green`): connection, live and saved-state cues.
- **Result Gold** (`gold`): best scores, winner presentation and paused timing.
- **Warning Rose** (`red`): destructive-action text; countdown warnings use the brighter incumbent warning treatment.

### Neutral
- **Night Navy** (`bg`): page canvas and recessed fields.
- **Panel Navy** (`surface`): header, sidebar and grouped content.
- **Raised Navy** (`raised`): secondary controls.
- **Slate Divider** (`border`): boundaries and row separators.
- **Soft White** (`text`): headings, values and active navigation.
- **Cool Slate** (`muted`): supporting text, labels and table headings.

**The State Label Rule.** Preserve text labels alongside state color; completion, saved marks and connection status must remain explicit.

## Typography

The interface requests Inter and falls back to the platform sans-serif stack. No bundled font is assumed. The base is compact; hierarchy comes from scale, weight and spacing. The frontmatter captures the shared roles. Team headings grow to (1.45rem); metadata commonly uses (.75–.9rem). The audience timer uses a larger responsive scale than the staff timer. Use tabular numerals for stable timer, score and order alignment.

**The Stable Numeral Rule.** Live values and comparable score columns use tabular figures and retain their alignment as values change.

## Layout

The desktop admin workspace uses a (250px) sidebar and flexible content area. Content is capped at (1550px), with main/support columns separated by (24px). At widths up to (1180px), those columns collapse; at (760px), the workspace stacks, team selection becomes a horizontal scroller and the header wraps. Panels use (20px) mobile padding and content uses (18px) side gutters.

Coordinator content extends to (1800px). Summary and a support column containing live standings above the editor share a (1.3fr / minmax(340px,1fr)) grid, collapsing at (1180px). Score tables scroll inside their own region. Mobile team selection scrolls to the editor, respecting reduced motion. Long team names wrap without widening the page. The audience team-order board uses two columns of divided rows on desktop and one on mobile.

## Elevation & Depth

Tonal fills and thin borders provide most separation. Ordinary panels are flat. Transient overlays carry the limited shadow vocabulary: toast feedback uses `0 8px 30px #0005`; confirmation dialogs use `0 18px 70px #0008` with a dark backdrop. These are overlay treatments, not default card decoration.

## Shapes

Shared controls use gently rounded corners; fields are slightly tighter than buttons and panels are broader. Badges remain small outlined rectangles. Team selection is a bounded row, not a decorative card. The supplied ITEX artwork is cropped through a CSS frame to remove transparent padding without rewriting its image bytes.

## Components

### Buttons

Primary actions use cyan fill and dark ink. Secondary actions use raised navy. Both use (550) weight and a (42px) minimum height in the shared primitive; compact utility controls have explicit smaller variants. Hover brightens the fill; disabled controls dim to (.4) opacity. Keyboard focus uses a cyan (2px) outline with (4px) offset. Destructive controls retain the secondary shape with rose text.

### Inputs / Fields

Recessed navy fields use a one-pixel slate border, visible labels and cyan caret/focus. The shared minimum height is (42px). Three judge inputs stay in a three-column group, with tighter mobile gaps. Completion uses a labeled checkbox; saved-time correction is a separate field.

### Cards / Containers

Panels group one operational purpose with a heading and optional status badge. Separate attempt forms and team summaries with thin dividers. Avoid nesting more elevated shells inside the existing flat panel structure.

### Chips

Outlined badges distinguish live/saved, best and neutral states through text plus border color. They annotate content and do not replace action buttons.

### Navigation

Header links use muted text; hover and `aria-current` use the main text color. Navigation wraps on phones; the coordinator header includes Coordinator review and Map & rules. Team rows show tabular running-order numbers, names and attempt metadata; selected rows use cyan navy and an explicit pressed state.

### Timers and draw reveal

Timers dominate the timing panel; milliseconds are smaller and muted. Keep timing numerals stable: the decorative track moves only during an active running attempt, while paused timing freezes the track and uses gold with explicit paused status and attempt labels. Recorded times receive finite emphasis; the final ten seconds retain warning cues.

The audience draw rolls names, then locks each position in the server-confirmed order within 2.4 seconds, with optional tick, lock and completion sounds. A winner announcement gives the team names a gold first-place device, finite entrance motion and a confetti burst capped at (90 particles / 3.5s). The winner visuals repeat every seven seconds while the screen is visible; the fanfare plays only once per announcement. Only confetti and the first-place accent repeat; the winner name stays readable after its initial reveal. There is no manual celebration button. A new announcement can celebrate the same winner again; clock ticks and ordinary score broadcasts do not replay it.

Event sound requires explicit enablement and can be muted on each screen. Hidden tabs cancel decorative work and scheduled voices. Reduced motion shows the final draw order immediately, removes confetti and spatial motion, and preserves all timing, result and status information. Preserve user-managed display typography, palette and logo settings. The audience treatment uses CSS, inline SVG, canvas and synthesized sound; no new shipping raster artwork was created.

## Do's and Don'ts

### Do:
- **Do** reuse the existing navy layers, labeled states and cyan focus outline.
- **Do** keep score columns aligned and wide tables locally scrollable.
- **Do** retain supplied identity artwork and reduced-motion behavior.

### Don't:
- **Don't** use status color as the only explanation of a saved, active or destructive state.
- **Don't** apply overlay shadows to ordinary panels.
- **Don't** replace actual team names or score evidence with decorative content.
