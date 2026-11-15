# Minimal guided explorer: verification record

The guided application is designed to remain usable through native location,
coordinate and UTC controls when a 3D view is unavailable. The new integration
tests in `frontend/src/explorer/GuidedApp.test.tsx` deliberately mock the Moon
renderer as unavailable. They check application behavior; they do not establish
that a real GPU, browser or screen reader behaves correctly.

## Automated behavior under test

- Named-site selection updates both textual angles from the selected sample.
- A skip link and native, labeled controls provide alternatives to globe gestures.
- Navigating the guide preserves committed location and UTC time.
- Explicit step navigation moves focus to the active heading.
- The exact last supported timestamp is accepted; a later hour is rejected,
  associated with the field and unable to corrupt the previous result.
- Continuing from Date & time validates and commits the visible draft. An invalid
  draft cannot advance to an explanation with stale results.
- Coordinate entry and a surface-pick callback both produce an identified
  approximate scenario instead of substituting a polar site.
- Surface picking is inactive while interpreting results, avoiding accidental
  location changes during reading.
- Comparison is optional, preserves the primary scenario, and restores focus
  when closed.
- Editing the second location/time leaves the primary scenario unchanged;
  selecting B updates context and both results consistently, and removing it
  restores A.

The focused command
`npm exec --workspace=@lunar/frontend -- vitest run src/explorer/GuidedApp.test.tsx`
passed **9 tests** after integration of the new `App.tsx`. The source uses jsdom
and native DOM events, not an actual keyboard or graphics stack. A passing result
must not be reported as a manual accessibility or rendering test.

The final regression additionally checks that an uncommitted A time draft does
not leak into B when the two scenarios have the same committed timestamp.

## Browser evidence from the hosted Preview

An installed Playwright runner exercised the Vercel Preview using Chromium with
its sandbox enabled, a fresh browser context, and the full share URL (no account
login). ANGLE/SwiftShader was requested for software WebGL coverage. The shared
cloud desktop browser was unavailable; it was not used for these checks.

The browser checks verified textured first render, actual surface picking,
independent location/time changes and comparison, a rendered LOLA elevation
palette, no page-level horizontal overflow at 320, 390,
768 and 1280 CSS pixels, and basic enlarged-text reflow. Simulated WebGL context
loss restored the photographic poster and preserved native controls. A second
browser with WebGL disabled and reduced motion also completed native selection
and opened the energy explanation. JavaScript page errors were absent.

Screenshots and the machine-readable report are execution artifacts outside the
repository, not committed/generated source. These checks do not cover physical
mobile devices, every GPU, an actual screen reader, or user comprehension.

Startup JavaScript before the light shell is approximately 225 KB (70 KB gzip),
compared with 2.44 MB (774 KB gzip) in the baseline. The App/data and Three runtime
are separate later requests; these numbers do not claim the entire first visit
became 90% smaller. The unmodified 252 KB NASA Moon photographic poster appears
in initial HTML and is preloaded, so even a failed application/graphics load can
retain a visible lunar reference. Both the poster and 3D lighting are illustrative.

The native HTTP Preview smoke checker starts with no credentials or cookies,
accepts only the share session's cookie, and verifies application asset hashes
against the local build. It preserves inherited proxy and TLS configuration.

### Relief restoration for visual comparison

The user preferred comparing versions before changing the interface again.
The guide composition is therefore unchanged in this follow-up. Display relief
has been recovered using the same bundled global and south-polar LOLA maps,
native projection, displaced picking surface, original height exaggeration,
terrain normals, rough material, and stronger directional contrast. It remains
display-only: neither the DEM nor the presentation light affects Sun/Earth angles.

Enhancement starts after the first textured frame. Pixels are read in 64-row
stripes, and mesh/index/normal work yields in short chunks. Adaptive geometry
retains a smaller displaced mesh on software rendering. The existing visible
level remains available if a higher-detail resource or build fails.

The installed sandboxed Chromium/SwiftShader check observed both global and
polar displaced relief reaching `ready`, unchanged scientific values across
the upgrade, successful surface picking, context-loss fallback, native keyboard
navigation and the same four responsive widths. The HTTP smoke verified all
21 application assets against the local build in an anonymous session.

Eight additional synthetic-fixture tests exercise displacement, registration,
actual raycasting, stripe reads, yielding and cancellation. These validate the
mechanism, not the scientific provenance of the display PNGs. The frontend suite
now has 52 passing tests; the infrastructure suite has 14 passing tests.

## Checks required in a real browser

- Complete all four steps with Tab, Shift+Tab, Enter, Space and native select
  keyboard commands. Check that globe shortcuts run only while it is focused.
- Test focus order, visibility, step-heading announcements, disclosure behavior,
  and comparison focus restoration with an actual screen reader.
- Inspect 320, 390, 768 and 1280 CSS pixel widths, text enlargement to 200%, and
  desktop zoom/reflow. The page must not clip controls or explanations.
- Measure text, focus and essential control contrast on the rendered colors.
  Confirm that shape/text carries meaning independently of color.
- Check reduced-motion mode, manual rotation pause, lost WebGL context, failed
  image loading, and recovery. A photograph fallback is not a selectable 3D globe.
- Check initial rendering and input responsiveness on a weak GPU or software
  rendering path. Confirm that the Moon spins around its own center/pole axis,
  without camera target motion, and that picking still identifies the shown point.
- Verify the exact Vercel Preview using a browser session without login. HTTP
  success and asset downloads alone do not prove layout, 3D rendering or focus.

## Comprehension checks still needed

Ask public/student participants to identify the selected location/time, interpret
the Sun and Earth center angles, and describe what the application does not
calculate. Observe whether anyone mistakes visible relief for tested obstruction
or interprets an angle as guaranteed electrical power or a working radio link.
These observations have not been performed by the integration suite.
