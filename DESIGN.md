---
name: Fleet Review
description: A restrained, code-first inspection surface for multi-agent pull request review.
colors:
  action-blue: "#0969da"
  critical-red: "#cf222e"
  critical-wash: "#ffebe9"
  warning-amber: "#9a6700"
  warning-wash: "#fff8c5"
  success-green: "#1a7f37"
  success-wash: "#dafbe1"
  canvas: "#ffffff"
  canvas-subtle: "#f6f8fa"
  ink: "#1f2328"
  ink-muted: "#59636e"
  rule: "#d0d7de"
  rule-muted: "#d8dee4"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.015em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "20px"
  code:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "19px"
rounded:
  control: "6px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  shell: "22px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 30px 6px 9px"
    height: "34px"
  badge:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
    height: "22px"
  finding-tab-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "0"
    padding: "8px 11px"
    height: "38px"
---

# Design System: Fleet Review

## Overview

**Creative North Star: "The Inspection Ledger"**

Fleet Review is a dense, restrained work surface modeled on a precise inspection record rather than a decorative analytics dashboard. Native system typography, thin rules, quiet planes, and a single blue interaction accent keep attention on repository evidence and review state.

The system is deliberately flat and code-first. Severity color carries meaning in compact badges, dots, warning fields, and code washes; it never becomes atmosphere. Host-provided Copilot tokens may replace the documented fallbacks so the canvas remains visually native in light and dark environments.

**Key Characteristics:**
- Compact controls and short, scannable labels.
- Flat white and muted planes divided by one-pixel rules.
- Blue reserved for action, selection, and keyboard focus.
- Severity communicated redundantly through text, color, and grouping.
- Monospaced locations and side-by-side reviewed/proposed code.

## Colors

The palette is a Copilot-native neutral foundation with one interaction blue and narrowly scoped semantic red, amber, and green.

### Primary
- **Action Blue:** Drives the primary action, selected-rail marker, active segmented control, focus outline, and medium-severity signal.

### Secondary
- **Critical Red and Critical Wash:** Mark critical findings and removed diff lines.
- **Warning Amber and Warning Wash:** Mark high severity, stale or incomplete review notices, and illustrative fixes.
- **Success Green and Success Wash:** Reserve positive semantics for added diff lines.

### Neutral
- **Canvas and Subtle Canvas:** Separate the reading plane from rails, code panes, hover fills, and table headers.
- **Ink and Muted Ink:** Distinguish primary content from metadata, labels, locations, and secondary descriptions.
- **Rule and Muted Rule:** Build the interface structure with crisp boundaries rather than shadow.

### Named Rules

**The Evidence Color Rule.** Semantic color identifies review evidence or state; it does not decorate neutral workspace chrome.

**The Host-Native Rule.** Prefer the host's matching color tokens when available and retain the documented palette as the fallback.

## Typography

**Display Font:** Native system sans serif.
**Body Font:** Native system sans serif.
**Label/Mono Font:** SFMono-Regular with Consolas and monospace fallbacks.

**Character:** The typography is compact and utilitarian. A shallow sans-serif hierarchy supports rapid scanning, while monospace appears only where source location or code alignment matters.

### Hierarchy
- **Title:** Semibold, compact, and slightly tightened for the product name.
- **Section Title:** Semibold for launch, review, and content headings.
- **Body:** Regular-weight default copy with a readable 20px line height; narrative report sections stop at 75ch.
- **Label:** Small semibold text for field labels, badges, tabs, and metadata controls.
- **Code:** Small monospace text on a 19px line grid for paths, line numbers, and source.

### Named Rules

**The Shallow Hierarchy Rule.** Create hierarchy with weight, spacing, and context before introducing another font size.

**The Code-Is-Evidence Rule.** Use monospace for file locations and source only, never as a decorative product voice.

## Layout

The canvas uses a full-width shell with 22px horizontal gutters and a compact launch band above the review workspace. Launch controls form a four-column grid weighted toward pull-request selection. A cross-repository recent-review ledger sits between launch and evidence, using compact ruled rows rather than cards. The review workspace is a bordered two-column inspection frame: a fixed 270px finding rail beside a fluid evidence panel. Content sections use 20px vertical rhythm, while controls and ledger rows use a tighter 6–12px rhythm.

At 900px, launcher controls become two columns and review actions move below their heading. At 700px, gutters contract to 14px, launcher controls stack, the finding rail moves above the evidence panel, count cells stack, and code comparisons become a single column. Code remains horizontally scrollable rather than wrapping.

**The Evidence-First Grid Rule.** Keep the index narrow and give the fluid column to findings, reports, and code.

**The Narrow Stack Rule.** On small screens, preserve reading order by stacking navigation before evidence and reviewed code before the proposed fix.

## Elevation & Depth

The system uses no drop shadows. Depth comes from alternating canvas tones, one-pixel borders, inset selection markers, semantic washes, and the host's light/dark color scheme. The only moving surface is the loading skeleton, whose shimmer is removed when reduced motion is requested.

**The Flat Ledger Rule.** Separate regions with rules and tonal planes; do not introduce floating cards or ambient shadow.

## Shapes

Controls, notices, and code containers use gently squared 6px corners. Badges use a full pill silhouette, while the review frame, rails, tabs, tables, count strip, and segmented-control seams remain rectilinear. The empty-state monogram is the sole circular emblem.

**The Functional Curve Rule.** Use 6px curves for discrete controls and messages, pills for compact status, and square joins for continuous data structures.

## Components

### Buttons
- **Shape:** Compact 34px controls with 6px corners and 6px by 12px padding.
- **Primary:** Solid action blue with white semibold text; reserved for starting a review.
- **Secondary:** Canvas fill, ink text, and a one-pixel rule.
- **Hover / Focus:** Neutral hover fill for secondary actions, slight darkening for the primary action, and a two-pixel blue outline offset by two pixels for keyboard focus.
- **Disabled:** Retains its form at 55% opacity with a not-allowed cursor.

### Inputs / Fields
- **Style:** Canvas fill, one-pixel rule, 6px corners, and compact 34px height.
- **Focus:** The same two-pixel offset blue outline used by buttons.
- **Disabled:** Retains layout and drops to 55% opacity.
- **Segmented Choice:** Two equal cells share a joined outline; the selected cell uses blue text and border over a subtle canvas.

### Chips
- **Style:** Compact 22px outlined pills with semibold label text.
- **State:** Neutral badges use muted ink; severity badges pair semantic text, border, and—where urgency warrants—a matching wash.

### Navigation
- **Style:** A muted finding rail contains full-width, left-aligned rows separated by muted rules.
- **Typography:** Finding rows use the label scale; severity group labels are smaller, uppercase, bold, and tracked.
- **States:** Hover uses a subtle canvas. Selection returns to the main canvas and adds a three-pixel inset blue marker at the leading edge.
- **Mobile:** The rail moves above content and its findings list is capped at 220px with vertical scrolling.
- **Recent Reviews:** The eight newest persisted runs form a full-width ledger with PR, repository, finding count, status, and timestamp. Selecting a row restores that exact run, including reviews whose PR is no longer open.

### Code Comparison
- **Style:** Two equal bordered panes on a subtle canvas, each with a compact ruled header and horizontally scrollable monospace lines.
- **Evidence Treatment:** Reviewed code stays neutral. The proposed pane is a line-level diff with old and new line numbers, explicit minus/plus prefixes, restrained red removal rows, and restrained green addition rows.
- **Source Launch:** Local review findings expose a compact secondary action that prepares the dedicated child worktree at the report's exact reviewed commit, inserts the canonical `REVIEW ISSUE #N [SEVERITY]: description` inline marker, preserves the Markdown/JSON review artifacts, and opens the whole project in VS Code.
- **Apply Diff:** A neighboring action applies only suggestions marked exact to that same worktree and removes the corresponding inline marker. Illustrative suggestions remain disabled because they require human judgment. Cloud findings retain both controls in a disabled state with explicit reasons.
- **Responsive:** Panes stack below 700px without changing their reviewed-then-proposed order.

### Status Notices
- **Style:** Warning notices use amber rules and wash, 6px corners, and compact 9px by 11px padding.
- **Usage:** Reserve them for stale, incomplete, omitted, or judgment-dependent review states.

## Do's and Don'ts

### Do:
- **Do** keep code, file location, finding copy, and traceability metadata visually dominant.
- **Do** use one-pixel rules and subtle canvas shifts to organize dense information.
- **Do** pair every severity color with a text label, grouping label, or explicit status.
- **Do** preserve visible keyboard focus and the reduced-motion skeleton behavior.
- **Do** let host tokens override fallbacks so the canvas follows its Copilot environment.

### Don't:
- **Don't** add decorative metrics, gradients, illustrations, or floating dashboard cards.
- **Don't** use semantic colors for ordinary actions or neutral navigation.
- **Don't** wrap source code to force it into narrow panes; stack panes and retain horizontal scrolling.
- **Don't** introduce shadows where a rule or tonal plane already communicates structure.
