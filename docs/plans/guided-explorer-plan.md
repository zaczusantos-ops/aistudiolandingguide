# Guided Lunar Explorer — planning proposal

Status: proposal for review, 15 November 2026. Planning only; the application and
published Preview have not been changed by this document.

Implementation follow-up: the user subsequently approved the guided composition
and requested an ultra-minimal Lunar Trek-inspired interface without boxes, plus
faster rendering and rotation around the Moon's own axis. The implementation
keeps the dark identity, removes the narrative entry, uses a progressive renderer
and a NASA photographic fallback, and publishes only Vercel Previews. This
document preserves the original proposal; current QA evidence is recorded in
`docs/accessibility/minimal-guide-qa.md`.

Source baseline: local commit `1711159`, branch `feat/minimal-lunar-explorer`,
repository `zaczusantos-ops/aistudiolandingguide`.

## 1. Decisions and constraints

### Chosen by the user

- Audience: general public and students, with optional technical detail.
- Explanations form a guided route: location → date → energy → communication.
- Entire product interface in English.
- Keep the existing selectable 3D Moon and an accessible list alternative.
- Comparison of locations/dates is optional.
- Identify observational sources, calculations, approximations, and limitations.
- Visual relief must not be presented as an obstruction calculation.
- Defer narrative, characters, voice, and launch/landing sequences.
- No AI-generated imagery.
- Ask before important visual or experience decisions.
- At most three independent subagents simultaneously; no shared-file editing.
- Work in a branch. No Git push, merge, or production deployment.
- Deliver future changes through a shareable, anonymously tested Preview.

### Proposed, not approved

- Guided workspace composition: persistent Moon beside the active explanation.
- Preserve the existing dark palette and fonts, reduce decoration and overlays.
- Begin at Location with a clearly identified example; no separate narrative gate.
- Four visible steps and editable location/UTC context throughout.
- Comparison initially supports two independent scenarios and appears after the
  first pass through the guide.
- Keep surface picking active during Location. During interpretation, camera
  gestures orbit/zoom; a clear `Change location` action returns to selection.
  This prevents accidental changes while someone reads an explanation.

Only audience and explanation route are newly confirmed. Showing alternatives
or recommending a composition does not approve that composition.

## 2. Product outcome and scope

The person should be able to say:

1. Which point and UTC time they inspected.
2. Where the centers of the Sun and Earth lie relative to a geometric horizon.
3. Why those directions matter for solar power and direct communication.
4. What else would be needed to predict actual power or a radio connection.

This is an educational explorer of lunar conditions. It does not currently
support operational landing recommendations, certified energy budgets, or
guaranteed communications. A visually dramatic scene is useful only if it helps
the person understand their selected scenario.

Keep: the renderer, existing imagery, picking, camera controls, native location
selection, UTC, short explanations, textual results, and provenance.

Remove from the main route, preserving source for later review: the long brief,
Astronaut mode, unrelated drawers, landing scores, safety rankings, PSR claims,
power/battery totals, relay-active labels, and blackout predictions.

## 3. Scientific meaning before visual polish

Use the same default basis for saved and arbitrary points: body-center elevation
relative to a geometric zero-degree horizon. Define that term once:

> The geometric horizon is a level reference at your location. Mountains and
> crater rims are not included.

The frontend already has `explorer/geometry.ts`. Named points can use saved sky
samples. Arbitrary coordinates must use `createGeometrySite`, with its spherical
observer and finite-range reprojection. The new route must not call
`customSiteBuilder`, sample a display atlas to determine obstruction, or silently
replace a point with the nearest polar candidate.

| Item | Treatment in the new route |
| --- | --- |
| NASA observational sources | Explain what source produced imagery/topography; do not label all outputs as measured or live data. |
| Saved sky positions | `Precomputed geometry`, calculated from the saved SPICE-based dataset. |
| Arbitrary-point directions | `Approximate geometry`, reprojected from saved samples; not a live SPICE calculation. |
| Relief and color map | Orientation aids; visually exaggerated; no effect on the geometric results. |
| Saved named-site terrain horizons | Preserve them, but expose only later as a separate, explicit model with provenance review. |
| Custom terrain shadows or radio blockage | Not calculated in the new route. |
| Electrical power, stored energy, battery duration | Explain dependencies qualitatively; no W/Wh/autonomy estimates in this increment. |
| Ground-station coverage and radio performance | Not calculated; Earth-center elevation alone is insufficient. |
| Relays | A short conceptual explanation may mention them; no active-coverage claims. |

The supported window is **15 Nov 2026 00:00 through 15 Dec 2026 00:00 UTC**, in
hourly samples. Bounds must come from the dataset, including the last supported
hour. Unsupported dates are rejected clearly; never silently clamped or replaced.

The sign of an unrounded elevation controls above/below/on classification. A
tiny negative number must not become “on horizon” after formatting. Center
position does not determine whether an entire solar/Earth disk is above the
horizon. Any near-horizon display band is a reading caution, not a validated
uncertainty interval. If disk-edge states are added, derive them from the stored
angular radii rather than treating the current ±1° heuristic as a physical bound.

Validation limits remain explicit: existing tests check consistency against
rounded named-site samples; they do not independently validate every global
custom location. The saved Horizons report covers sixteen times at one site and
does not validate terrain, power, radio performance, or all custom points.

## 4. Guided route

The step navigation is an ordered list with `aria-current="step"`. Suggested
English labels are `Location`, `Date & time`, `Sunlight & energy`, and
`Earth & communication`. Back, Continue, and direct step navigation preserve
selection, UTC, camera, and surface preference. Reading text is never a gate.
Valid example values allow progression without requiring a globe gesture.

Location and UTC remain identified throughout, with edit actions. The compact
Sun/Earth summaries use the same selected scenario. Only the active explanation
receives the strongest emphasis. Comparison is not a mandatory fifth step.

| Step | Main task | Visible explanation/result | Completion condition |
| --- | --- | --- | --- |
| Location | Click the Moon or use the native list; optional coordinate fields. | Selected name/coordinates and calculation origin; explicit example state. | A valid point is selected through either input path. |
| Date & time | Choose a supported UTC date/hour. | Available window and hourly sampling; the meaning of UTC is one short optional explanation. | The chosen timestamp has a sample; invalid draft input leaves the last valid result clearly identified. |
| Sunlight & energy | Interpret the Sun-center elevation. | Position, short consequence for solar panels, and terrain/power limits. | No required quiz; Continue advances with context intact. |
| Earth & communication | Interpret Earth-center elevation. | Direction, radio-link dependencies, and final summary of both bodies. | Optional comparison becomes available without replacing the original scenario. |

Avoid a locked wizard. People can revisit any applicable step and adjust the
context. Focus moves to the active step heading when navigating steps; editing
a field or orbiting the Moon does not unexpectedly move focus. Announce only
committed changes, not every camera frame or typed character.

On mobile, prioritize readable controls and explanations. The Moon may become
a compact section; it need not remain fixed or visible at the expense of reading.
All content uses normal page flow. No sticky footer may hide a focused control.

## 5. Explanation system and proposed English copy

Each topic has three depths: a visible result, a short explanation, and optional
method/source detail. Use plain English without removing the technical term
from optional detail. Keep the same vocabulary everywhere: `geometric horizon`.

### Location and time

> Choose a point on the Moon.
> Click the surface or choose a location from the list.

> Choose a date and time.
> All times are in UTC. This dataset contains hourly samples.

The interface labels default values as an example. It does not imply they are
the present time or that the user already confirmed them.

### Sunlight and energy

Result template:

> Sun center [above / below / on] geometric horizon
> [signed calculated angle]

Visible explanation:

> Solar panels need sunlight. The Sun’s direction is one part of understanding
> whether a location could support solar power.

Optional `Why this matters`:

> Near the lunar poles, the Sun stays low and nearby ridges can cast long shadows.
> This view does not calculate terrain shadows. Panel direction, efficiency,
> temperature, dust, and battery storage also affect usable power.

Short boundary beside the result:

> Terrain shadows and power output are not calculated.

This avoids suggesting that a center below the horizon means no light, or that
a center above it proves usable electricity. Do not label the angle as watts,
energy yield, or an illumination percentage.

### Earth and communication

Result template:

> Earth center [above / below / on] geometric horizon
> [signed calculated angle]

Visible explanation:

> Direct communication needs a clear path between a lunar antenna and an Earth
> ground station. Earth’s direction is one part of that path.

Optional `Why this matters`:

> Terrain, the ground station’s position, antenna pointing, and equipment also
> matter. A relay can provide another route, but relay coverage is not calculated
> here.

Short boundary beside the result:

> Earth above the horizon does not guarantee a radio link.

### Shared explanation and limits

> Precomputed geometry: saved Sun and Earth positions for this named location.

> Approximate geometry: positions reprojected from saved samples for this point.

> These are calculations, not live observations.

Near-horizon help should explain the center-versus-disk distinction conditionally:

> Close to the horizon. The center and the edge of a disk can be on different
> sides of the horizon.

The source badge must be backed by explanatory text. Do not make the absence of
the optional `geometrySource` property silently imply validated precomputation;
the adapter must assign an explicit origin to every scenario.

All public strings, including optional site descriptions and errors, need English
curation. Do not expose the existing Portuguese dataset descriptions unchanged.

## 6. Visual alternatives for user selection

These are composition choices, not different scientific models.

| Direction | Layout | Strength | Tradeoff |
| --- | --- | --- | --- |
| Guided workspace — recommendation | Moon beside a solid active-step panel; context and step navigation above; compact paired results below. | Balanced exploration and explanation; predictable desktop/mobile adaptation. | Requires an embedded viewport instead of the existing fullscreen fixed stage. |
| Guided observatory | Moon dominates the scene; a short explanation strip and compact context guide each step. | Closest to the existing visual identity. | Less room for explanation; more care needed to avoid overlays and hidden focus. |
| Guided notebook | A quiet reading column with four visible steps; compact Moon before the active explanation; Continue advances through the guide. | Gives explanations more space and preserves a predictable reading order. | Longer page; Moon less prominent in later interpretation. |

Proposed shared styling: preserve the existing Jost family, use normal/medium
weights, reserve monospace for values, target approximately 18 px body text,
short line lengths, generous spacing, opaque reading surfaces, quiet dividers,
and one restrained selection accent. Avoid glass effects, decorative gradients,
small low-contrast captions, repeated cards, and icons without labels.

Keep the current dark identity for the first prototype. A light theme remains a
possible later option, not a new approved requirement. The inline concept
comparison is schematic and does not replace or test the actual 3D renderer.

## 7. Ideas ranked by value and evidence

| Order | Idea | Problem addressed | Support and effort | Proposed timing |
| --- | --- | --- | --- | --- |
| 1 | One short explanation tied to each selected result | Numbers have no meaning for a beginner. | Uses existing angles and qualitative science; low additional implementation cost. | Core first increment. |
| 2 | `Change one thing` comparison | Hard to see the effect of location versus time. | Two complete scenarios using the same method; moderate state/focus work. | After the guided route works. |
| 3 | Small horizon diagram next to the angle | `Elevation` is abstract. | Schematic, uses actual angle, no terrain silhouette; equivalent text required. | First educational enhancement. |
| 4 | Surface/topography toggle with unchanged results | Visual shadows appear to be scientific results. | Existing layers; regression test that appearance never changes calculations. | Optional contextual demonstration. |
| 5 | Copy a scenario URL | Students cannot reproduce/discuss the same choices. | Serialize point, UTC, model and dataset version; validate restored inputs. | After scenario state is stable. |

Later: a next-crossing indicator may report an hourly bracket where a body
center crosses the geometric horizon, not an exact sunrise or terrain visibility
event. A conceptual panel/battery demonstration needs its own explicit assumed
inputs and should not be mistaken for results at the chosen point.

Defer rankings, missions, quizzes, narrative, voices, automated flyovers, relay
coverage, engineering dashboards, and new backend/DEM infrastructure. They add
scope before the basic explanation has demonstrated comprehension.

## 8. Accessibility acceptance criteria

- Complete the route through native controls using keyboard alone. Surface
  picking and dragging have alternatives: list, coordinate fields, and buttons.
- Keep visible focus and logical order. No keyboard trap in ordinary details;
  if a dialog is necessary, implement Escape, focus containment, background
  inertness, and focus restoration.
- Native step buttons include names and current-step semantics. Continue moves
  to a heading; valid edits retain input focus. Adding comparison focuses its
  heading; removing it restores focus to its launcher.
- A concise polite live region announces committed local/time changes. Do not
  narrate animation frames, pointer hover, or every input keystroke.
- Label dates, hours, coordinates, units and errors. Invalid fields use associated
  messages and `aria-invalid`. Clearly distinguish draft input from last valid
  results. Never replace an invalid date with a hidden fallback.
- Show both Sun/Earth results as text. If a chart or diagram is introduced,
  provide the equivalent values and explanation without it.
- Maintain functionality without WebGL and when texture loading or context
  recovery fails. A texture failure must never change calculations.
- Measure at least 4.5:1 contrast for ordinary text and 3:1 for large text and
  essential graphical/control boundaries. Color never carries the sole meaning.
- Use the repository’s 48×48 CSS pixel target as a comfortable design goal.
  WCAG 2.2 AA criterion 2.5.8 has a 24×24 minimum with specified exceptions;
  the 48 px goal is not the wording of that requirement.
- Test 320, 390, 768 and 1280 CSS px, text enlargement to 200%, and 400% desktop
  zoom/reflow where applicable. No essential control or explanation is clipped;
  no page-level horizontal scroll. No fixed HUD or footer hides focused fields.
- Respect reduced motion, avoid automatic playback, and keep camera gestures
  optional. Give globe shortcuts only to the focused globe.
- Test with an actual screen reader and browser keyboard. Automated checks alone
  do not establish usability or full WCAG conformance.

## 9. Architecture and implementation ownership

No shared science-contract change is required for the first increment. Add a
frontend view model over the existing dataset. Keep the Python pipeline and
bundled source data unchanged until scientific requirements justify changes.

Proposed scenario model: stable scenario ID, explicit saved/custom origin,
source site or selected coordinates, validated epoch index, and dataset/model
identity. Keep form drafts separate from committed valid values. Guided step,
camera and appearance are presentation state; camera motion must not mutate the
scientific scenario. Both result cards derive from the same committed state.

Use one pure description formatter for visible text, comparison and accessible
summaries. Preserve sign/units and attach provenance; presentational components
receive results rather than deriving power or radio claims.

Future parallel implementation can use these boundaries, after agreeing props:

| Owner | Exclusive scope | Deliverable |
| --- | --- | --- |
| Integrator | `App.tsx`, `main.tsx`, root styles/imports, final composition | Guided state, context, integration, consistent data and review. |
| Agent: model and copy | `explorer/geometry.ts`, new scenario/description modules and their tests | Explicit provenance, validation, honest text and numerical boundaries. |
| Agent: explanation UI | New step/summary/details components and their own styles/tests | Accessible guided content, reusable presentational components. |
| Agent: scene | `landing-guide/LunarViewport.tsx` and scene-specific styles/tests | Embedded renderer, selection mode, camera/fallback, preserved assets. |

At most three subagents run at once. No two edit the same file. The integrator
alone changes `App.tsx` and global CSS; component contracts are agreed before
parallel editing. Integration follows each milestone rather than accumulating
three incompatible rewrites.

## 10. Milestones and gates

1. **Approve the composition.** Select a visual direction using concrete concepts.
   Gate: route/audience remain recorded; composition and example entry are chosen
   before implementation. The baseline remains available for comparison.
2. **Isolate the honest result model.** Wire saved and arbitrary locations into
   the geometry-only adapter, explicit origin and shared explanation formatter.
   Gate: no new route calls legacy atlas obstruction/engineering generation;
   source absence is reported as absence; edge-case numerical tests pass.
3. **Build the complete guided core with explanations.** Implement all four
   steps, native input alternatives, retained state, context and both summaries.
   Gate: desktop/mobile/keyboard/no-WebGL completion; invalid drafts cannot
   corrupt results. Main copy is English and distinguishes power from angle.
4. **Add optional learning enhancements.** Two independent scenarios, then the
   small schematic if comprehension warrants it. Gate: A is not overwritten;
   every scenario shows its own location/time/origin; comparison is descriptive,
   not a safety/energy ranking. The route is useful without activating extras.
5. **Verify comprehension and deliver Preview.** Run project checks, inspect
   real browser behavior and conduct a small formative user test. Gate: no
   critical task/factual/a11y blockers; publish only Preview and verify anonymous
   access to the exact version and required assets.

No calendar estimate is committed. The gates, not an arbitrary deadline, decide
whether to continue or revise. Explanation quality is part of the core milestone,
not a final text pass after styling.

## 11. Verification plan

### Scientific and integration checks

Cover named/custom origin, equivalent longitudes ±360°, equator, far side,
both poles, limbo, exact zero and tiny signed elevations, first/last supported
hour, unsupported date/time, texture failures, and invalid URL state. Confirm
that switching the surface mode never changes numeric conditions. Test direct
picking and coordinate/list alternatives produce the same committed scenario.

Add independent spot checks of custom geometry against an appropriate
ephemeris reference before claiming global accuracy. If unavailable, retain the
approximation label and explicitly record that verification limit. Internal
round trips do not establish independent scientific validation.

Meaningful component tests cover step retention/focus, invalid draft recovery,
consistent paired summaries, English strings, optional comparison and no-WebGL
completion. Replace tests that only lock narrative headings to the former UI.
Avoid tests that simply duplicate implementation formulas.

Run the repository’s required frontend typecheck/tests/build, infrastructure
checks and Python tests/package smoke checks for the release increment. A green
build is not evidence of actual 3D interaction or user understanding.

### Formative comprehension checks

Recruit a small, explicitly non-representative pilot with public/student
participants, including keyboard/assistive-technology users where feasible.
An initial target of five sessions helps find problems; it is not proof of
universal usability or a statistical certification.

Ask participants, without step-by-step coaching, to choose a location/time,
explain the Sun result for power, explain the Earth result for radio, locate
limitations, revise a choice, and optionally compare one variable. Observe
completion, hesitation, recovery, and misconceptions. Record findings without
claiming the tests have already happened.

Release gate: no unresolved critical misconception (such as “the site guarantees
electricity or radio”), blocked core task, lost selection, or inaccessible
essential control. If found, revise and retest the affected interaction.

### Shareable Preview

Keep the original Preview as a baseline. Future implementation gets its own
Preview; do not overwrite production or push Git. Record source commit, dataset
identity, target environment and deployment ID. Use the existing authorized
Vercel project; do not create a first deployment that automatically becomes
production. A shareable link applies only to the exact Preview, preserving
global protection. Test with an initially empty cookie jar and no Authorization
header, follow redirects, and verify application HTML/assets; then verify real
rendering in a browser without login when available. Do not use an authenticated
CLI fetch as proof of anonymous access.

The baseline sharing URL opens the current version only. It does not restore
selected locations/times until scenario URL serialization is implemented.

## 12. Primary references consulted

- Repository accessibility guide:
  `docs/accessibility/guia-acessibilidade-e-simplicidade.md`.
- [NASA: Shadows near the Moon’s South Pole](https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/)
  supports the explanation of low Sun angles and long polar shadows; it does not
  validate this application’s terrain calculation.
- [NASA: Lunar Surface Propagation](https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/lunar-surface-propagation/)
  explains the Earth’s low position and terrain/radio challenges near the pole;
  it does not certify a link budget for a chosen point.
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/),
  [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum),
  and [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum).

## 13. Multi-agent synthesis and remaining choice

Three independent read-only reviews covered scientific/content boundaries,
visual/accessibility directions, and product alignment/acceptance gates. A
second cross-review incorporated the user’s choice of audience and guided route.
All three converged on the same core: explicit location/UTC, honest paired
geometry results, contextual explanations, preserved state, optional comparison,
and no dependence on the visual terrain for obstruction.

Resolved tension: the initial free-exploration recommendation is superseded by
the user’s guided-route choice. The guide remains navigable and does not require
reading a story or completing a quiz. No visual direction has been approved.

The next decision is **Guided workspace, Guided observatory, or Guided notebook**.
Recommendation: Guided workspace with the existing dark identity and a first
Location step using a clearly labeled example. This is a proposal awaiting the
user, not authorization to redesign or publish the application.
