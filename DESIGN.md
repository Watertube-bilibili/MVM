---
name: "MVM Compatibility Laboratory"
description: "A Windows-first inspection workbench that makes macOS package evidence, constraints, and experimental launch eligibility visible."
colors:
  shell-background: "#e8eef0"
  surface: "#f7f9fa"
  surface-raised: "#fbfcfc"
  surface-muted: "#edf2f4"
  surface-pressed: "#e2eaed"
  line: "#ccd7db"
  line-strong: "#aebfc5"
  text: "#172128"
  text-muted: "#52636b"
  text-subtle: "#596b73"
  accent: "#176b87"
  accent-strong: "#0e5b75"
  accent-soft: "#deedf1"
  fluent-command: "#0f6cbd"
  fluent-command-hover: "#115ea3"
  fluent-command-pressed: "#0c3b5e"
  on-accent: "#ffffff"
  warning: "#7f4d0c"
  warning-soft: "#f7ead7"
  danger: "#a03b38"
  danger-soft: "#f7e7e5"
  success: "#246b51"
  success-soft: "#e1efe8"
typography:
  display:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
    fontSize: "clamp(30px, 3.5vw, 48px)"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
    fontSize: "21px"
    fontWeight: 680
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
    fontSize: "17px"
    fontWeight: 680
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 650
  mono:
    fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace'
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
  action-large:
    fontFamily: '"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
rounded:
  fluent-control: "4px"
  compact: "7px"
  status: "8px"
  library-item: "10px"
  station: "12px"
  specimen: "13px"
  panel: "14px"
  large: "22px"
  pill: "999px"
spacing:
  tight: "6px"
  compact: "8px"
  workspace: "10px"
  row: "12px"
  panel: "14px"
  content: "16px"
  section: "18px"
  station: "22px"
  loose: "28px"
components:
  button-primary:
    backgroundColor: "{colors.fluent-command}"
    textColor: "{colors.on-accent}"
    typography: "{typography.action-large}"
    rounded: "{rounded.fluent-control}"
    padding: "7px 16px"
  button-primary-hover:
    backgroundColor: "{colors.fluent-command-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.fluent-control}"
  button-primary-active:
    backgroundColor: "{colors.fluent-command-pressed}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.fluent-control}"
  button-secondary:
    backgroundColor: "#ffffff"
    textColor: "#242424"
    rounded: "{rounded.fluent-control}"
    padding: "5px 12px"
  input-search:
    backgroundColor: "#ffffff"
    textColor: "#242424"
    rounded: "{rounded.fluent-control}"
    padding: "0 12px"
    height: "32px"
  runtime-chip-discovered:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
  station-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.station}"
    padding: "54px 18px 22px"
  structure-sample-tag:
    backgroundColor: "#d7e9ee"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.pill}"
    padding: "3px 7px"
---

# Design System: MVM Compatibility Laboratory

## Overview

**Creative North Star: "兼容性实验台 / Compatibility Laboratory"**

Direction 4, seed `93f54be6`, is the approved world. The approved “Inspection Runway” comp is directional authority, and the implemented finish verdict is `ACCEPT / DELIVERABLE`. The durable idea is a cool, Windows-native instrument surface: a compact command bar, an application library, a four-station evidence runway, a findings bay, and a chronological evidence strip. Preserve the world and its mechanism, not the comp’s exact pixels.

MVM is a Windows 10/11 x64 Electron desktop application for importing and statically inspecting macOS application packages, then exposing an experimental launch entry only when a real external backend and current evidence permit it. It is not a hosted website, a macOS emulator, a universal compatibility promise, or proof that a submitted process displayed a window or worked correctly. Product copy must keep analysis, eligibility, backend health, command submission, process creation, GUI appearance, and functional verification as separate conclusions.

The visual system is calm, engineering-led, and evidence-first: snow and mist surfaces, graphite text, etched seams, restrained teal-blue signals, specimen labels, small mono evidence, and familiar Fluent controls. Density is compact but not cramped. CSS geometry and vector icons carry the world; the approved raster comp remains a design reference and is never shipped as interface content.

**Key Characteristics:**

- Windows-first laboratory tooling, never macOS chrome or terminal cosplay.
- One horizontal inspection story: package, architecture, frameworks, then backend.
- Measured surfaces, thin seams, compact labels, and restrained depth instead of decorative cards.
- Evidence states expressed with text, icon, structure, and color together.
- No runtime raster imagery, Apple mark, third-party logo, or rasterized control/text.

**The Product Truth Rule.** Never compress static analysis, “candidate” eligibility, Darling discovery, health verification, command submission, process creation, window appearance, and functional success into one status.

## Colors

The palette is a cold laboratory neutral system with a sparse teal-blue interaction voice and separate evidence colors for warning, blocking, and verified positive states.

### Primary

- **Laboratory Teal:** The `accent` family selects stations, library records, measurement marks, vector details, and “discovered” evidence; it should remain scarce.
- **Fluent Command Blue:** The `fluent-command` family is the actual `webLightTheme` primary-button channel. Use it only for primary actions such as import and an enabled experimental launch, not as a second decorative accent.

### Secondary

- **Evidence Green:** The `success` family marks a specifically verified positive condition such as a ready tool or successful event, never broad compatibility.
- **Caution Umber:** The `warning` family marks limitations and warnings that still allow inspection.
- **Blocker Oxide:** The `danger` family marks errors and explicit blockers.

### Neutral

- **Cool Snow:** `shell-background`, `surface`, `surface-raised`, `surface-muted`, and `surface-pressed` separate the desktop shell, panels, workbench, and state layers without heavy elevation.
- **Mist Seams:** `line` is the default one-pixel divider; `line-strong` marks structural joins, rulers, and the runway/detail seam.
- **Graphite Evidence:** `text` carries headings and conclusions; `text-muted` carries explanation; `text-subtle` is reserved for low-priority empty and evidence metadata.

### Named Rules

**The One Accent Voice Rule.** Laboratory teal and Fluent command blue are two implementation channels of one restrained interaction voice; never place them in decorative competition.

**The Evidence, Not Mood Rule.** Warning, danger, and success colors may only describe a named evidence state, and the adjacent text/icon/structure must carry the same meaning without color.

## Typography

**Display Font:** Segoe UI Variable Text, falling back through Segoe UI and Chinese Windows/system sans-serifs.

**Body Font:** The same Windows-first sans-serif stack; Fluent controls use the `webLightTheme` Segoe UI stack.

**Label/Mono Font:** Cascadia Mono, then SFMono-Regular and Consolas, for hashes, architecture chips, paths, timestamps, and evidence codes only.

**Character:** The hierarchy should feel like an operating instrument, not editorial branding: firm semibold headings, compact labels, readable explanatory copy, and mono only where exact strings need to be compared.

### Hierarchy

- **Display** (650, `clamp(30px, 3.5vw, 48px)`, 1.08): Empty-workbench invitation only; keep it to roughly 14 characters per line.
- **Headline** (680, 21px): The selected specimen/application identity.
- **Title** (680, 17px): Panel headings; local stage headings step down to 16px.
- **Body** (400, 13px, 1.55): Findings, backend constraints, and supporting evidence; descriptive blocks stay near 48 characters when the layout permits.
- **Label** (650, 11px): Runtime chips, status labels, and compact metadata; 10–12px variations are allowed only in the existing dense evidence contexts.
- **Mono** (600, 10px, 1.2): Architecture tokens and short machine identifiers; event timestamps and other longer evidence may rise to 12px.

### Named Rules

**The Plain Evidence Type Rule.** Use Segoe for human interpretation and Cascadia Mono for exact machine evidence; never use mono as a terminal aesthetic or display face.

## Layout

The application shell is full-height and Windows-first. The command bar is 68px high; an optional notice row sits below it; the remaining space is a compact workbench. The base rhythm clusters around 6–18px, with 10px workspace gutters and 14–18px panel insets. The center workbench retains a faint 36px advisory grid, while the empty-state specimen uses a 24px internal grid.

### Desktop (above 1180px)

- The workspace is a three-column grid: 236px application library, a flexible center with a 530px minimum, and a 306px instrument bay.
- A 154px event strip spans the center and right columns; the application library spans both rows.
- The four runway stations use evidence-weighted proportions of `1.42fr / 0.82fr / 1fr / 0.72fr`, so package evidence receives the largest specimen area.

### Compact instrument (`<1180px`)

- Hide the command-bar runtime summary, reduce the library to 218px, and keep the center workbench plus 154px event strip.
- Convert the instrument bay into a fixed right drawer, no wider than 380px, with a scrim. The runway proportions tighten to `1.34fr / 0.84fr / 0.96fr / 0.72fr`.

### Compact runway (`<920px`)

- Collapse the application library to an 84px icon rail and hide its search, descriptions, fixture tag, and footer copy.
- Turn the runway into four equal compact tabs. Hide the index circles, connectors, station summaries, specimen card, chips, and backend symbol; keep the active stage detail below.
- Stage evidence becomes two columns, with architecture rows reflowing beneath the architecture label. Command labels and the brand subtitle disappear, while recognizable icons and the MVM name remain.

### Single column (`<640px`)

- Stack a 112px horizontal application scroller, the workbench, and the event strip in one column. Keep only the diagnostics control from the command navigation cluster.
- Stack event headings and stage evidence; use 8px runway/detail side margins. The instrument bay remains the modal drawer inherited from the 1180px rule.

**The Measurement Surface Rule.** Preserve the advisory grids, ruler ticks, runway baseline, and etched connectors because MVM is a measurement surface for evidence; they provide scale and process continuity, but never encode status or become high-contrast decoration.

## Elevation & Depth

The system is layered but mostly flat. Cool tonal changes and one-pixel seams establish panel hierarchy first. Low shadow (`0 8px 24px rgba(48, 76, 86, 0.08)`) belongs to the package specimen and specimen card; mid shadow (`0 18px 48px rgba(48, 76, 86, 0.13)`) belongs to temporary overlays and the compact instrument drawer. The app mark uses a tighter `0 6px 16px rgba(48, 76, 86, 0.15)`. Inset white highlights and the shallow runway baseline shadow make surfaces feel etched rather than glossy.

### Shadow Vocabulary

- **Specimen Low:** Soft ambient separation for the physical package/specimen metaphor only.
- **Drawer Mid:** Clear modal separation for drawers and drag overlays.
- **App Mark:** A compact identity lift reserved for the main cube mark.
- **Etched Inset:** One-pixel inner highlights and accent selection lines; these are structural, not card elevation.

### Named Rules

**The Etched Before Elevated Rule.** Establish hierarchy with tone, divider, and inset seam before adding a shadow.

**The Flat-by-Default Rule.** Persistent panels remain flat; medium elevation is reserved for temporary layers that sit above the workspace.

## Shapes

The shape language is gently machined rather than pillowy. Fluent buttons and inputs render with compact 4px corners. Evidence tokens use 7–8px corners; library rows use 10px; runway stations use 12px; specimen cards use 13px; primary panels use 14px. The empty specimen and drag target may expand to 18–22px because they represent a physical fixture. Status chips are fully pill-shaped, and station indices/tool lights/event marks are true circles.

Default dividers are one-pixel mist seams. Strong seams, dashed outlines, dotted measurement marks, and inset accent bars distinguish joins, provisional backend areas, and selection. A declared 9px control custom property has no current consumer and is therefore not a rendered-system token; do not treat it as the default control radius until the implementation adopts it.

**The Realized Radius Rule.** Document and reuse rendered radii, not dormant declarations or a generic “rounded” preset.

## Components

### Buttons

- **Shape:** Fluent compact controls (4px), with 14px/20px medium typography or 16px/22px large typography.
- **Primary:** Fluent command blue with white text; large icon buttons use 7px vertical and 16px horizontal padding. Reserve for import and an evidence-enabled launch attempt.
- **Secondary:** White surface, dark Fluent text, one-pixel neutral stroke, and 5px by 12px padding; use for report export and equivalent actions.
- **Subtle:** Transparent at rest, neutral hover/pressed fills, and icon-first behavior for navigation or compact utilities.
- **Hover / Active / Focus:** Fluent color transitions run at 100ms; custom controls use 160–180ms easing. All visible buttons receive the shared two-pixel focus outline, and reduced-motion mode collapses transitions to 0.01ms.

### Inputs / Fields

- **Style:** The application-library search is a 32px Fluent outline field with a leading search icon, white background, one-pixel neutral stroke, and compact 4px corners.
- **Focus:** A two-pixel brand underline animates in while the field keeps a transparent two-pixel outline for high-contrast compatibility.

### Navigation

- The command bar is the persistent primary navigation. Use Fluent subtle buttons with icon and text on desktop; progressively hide labels, then nonessential commands, at the documented breakpoints.
- The application library is a listbox. Selection uses a soft accent field plus an inset accent edge, never color alone.

### Chips

- Runtime chips and launchability labels use full pills with compact text. “Darling 已发现” means the command was discovered during probing; it does not mean the Darling user state is healthy, a command has been submitted, a process exists, a GUI appeared, or the app works.
- A `candidate` launchability label means only that current static rules and discovered WSL2/Darling evidence allow the user to try. The enabled action must still trigger Darling user-state health verification and the latest Bundle integrity/eligibility checks.

### Cards / Containers

- Persistent panels use cool snow backgrounds, 14px corners, one-pixel mist borders, and no default shadow.
- The specimen card and package station are the intentional exceptions: their low shadow and layered surface communicate a physical object under inspection.
- Finding rows are disclosure elements separated by one-pixel seams. Blockers open by default; the icon, title, evidence code, explanation, and suggested action remain readable without color.

### Inspection Runway

The signature component is a single tab system with four semantic workstations: **包** covers input/container safety and Bundle identity; **架构** covers Mach-O slices, minimum OS, encryption, and signature structure; **Framework** covers direct dynamic-library/system-capability dependencies; **后端** covers local-tool and WSL/Darling discoverability plus real launch evidence. Do not turn these into a compatibility score or four equal dashboard cards on desktop.

The tablist uses roving focus: only the selected tab is in the tab order; Arrow keys move cyclically, Home selects the first station, End selects the last, and focus follows selection. The tabpanel is labelled by the active tab and announces updated evidence politely.

### Structure Sample

The deterministic local fixture must always carry the visible “结构样本” tag in any context where real apps also appear. It proves the local analysis pipeline against known structure; it is never third-party compatibility evidence, a launch candidate, or a success example.

### Compact Instrument Drawer

Below 1180px, the instrument bay becomes a modal dialog with a scrim. Opening moves focus to Close; Tab and Shift+Tab stay inside; Escape and the scrim close it; closing restores focus to the diagnostics trigger. When closed it is hidden and inert. The desktop bay remains a focusable landmark rather than a modal.

**The Eligibility Is Not Execution Rule.** “已发现” and `candidate` authorize only their named next check; neither is a health, launch, GUI, or compatibility success state.

**The Drawer Focus Rule.** Every compact instrument drawer must trap focus while open, close on Escape, become inert when hidden, and restore focus to its trigger.

## Do's and Don'ts

### Do:

- **Do** preserve direction 4, seed `93f54be6`, and the compatibility-laboratory mechanism when extending the application.
- **Do** keep package, architecture, Framework, and backend evidence visibly separate and exportable.
- **Do** preserve the advisory measurement grid and etched process cues at a quiet contrast.
- **Do** label structural samples everywhere they can be mistaken for real applications.
- **Do** pair status color with explicit Chinese text, a meaningful icon, and/or structural treatment.
- **Do** use Fluent System vector icons or simple inline vectors and CSS geometry for the runtime interface.
- **Do** maintain two-pixel visible focus, roving station tabs, modal drawer focus containment, reduced motion, and forced-colors behavior.

### Don't:

- **Don't** present “Darling 已发现” as user-state health, launch success, GUI availability, or application compatibility.
- **Don't** present `candidate`, command submission, or process creation as proof that an application is running correctly.
- **Don't** use a structural sample as compatibility-rate evidence or disguise it as a real imported application.
- **Don't** remove the measurement surface as “decoration” or inflate it into a high-contrast graph-paper theme.
- **Don't** ship the approved raster comp, rasterized controls/text, an Apple logo, third-party marks, or photorealistic laboratory props in the interface.
- **Don't** introduce macOS chrome, glass, purple gradients, neon, terminal treatment, decorative status dots, or a generic equal-card dashboard.
