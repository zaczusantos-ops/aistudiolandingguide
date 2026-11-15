# Development analysis — 15 November 2026

Historical baseline analysis. The guided implementation now supersedes the
pending-interface status below. See `docs/accessibility/minimal-guide-qa.md`
for the implemented route and verification evidence. Legacy UI source remains
in `frontend/src/LegacyApp.tsx`; the published entry uses the geometry-only guide.

Working checkout: `zaczusantos-ops/aistudiolandingguide`, branch
`feat/minimal-lunar-explorer`. No remote branch, merge, or production deployment
was created during this analysis.

## Existing behavior

The React/Vite frontend already has a Three.js Moon, direct surface picking,
keyboard orbit/zoom controls, a native site selector, and hourly UTC controls.
The bundled dataset contains ten south-pole sites and 721 hourly samples from
2026-11-15 00:00 to 2026-12-15 00:00 UTC. The Python pipeline and JSON Schema
contracts remain independent of the frontend; there is no live scientific API.

The current default interface still contains the narrative introduction,
astronaut mode, terrain-based engineering metrics, and up to four site slots.
The simplified interface has not been activated: the requested appearance and
experience decision is pending user input.

## Scientific boundaries

- The bundled named-site data includes NASA LOLA and SPICE provenance. The saved
  Horizons comparison covers sixteen times at one site, not every location or
  metric.
- The visual atlas is downsampled. Its polar layer is approximately 594 m/pixel;
  the global layer is approximately 5.3 km/pixel at the equator. It is not the
  original 80 m scientific DEM.
- The existing `customSiteBuilder.ts` ray-marches that display atlas, including a
  synthetic fallback, and supplies placeholder engineering fields. Its outputs
  must not be presented as measured terrain, PSR, power, relay, or landing safety
  results in the new flow. This legacy path is still present in the current UI.
- The new `explorer/geometry.ts` derives approximate Sun/Earth directions for a
  spherical observer from the bundled rounded samples, correcting finite-range
  parallax. It has no display-atlas input and produces no terrain or engineering
  metrics. It does not extend the supported date window or run SPICE live.
- The new flow should describe body-center elevations against the geometric
  zero-degree horizon. Crater rims, mountains, antenna masks, Earth stations,
  link budgets, solar panel orientation, and actual power are outside that result.
  Earth above the horizon is not a guaranteed radio link.

## Changes prepared

- Preserved the existing 3D scene and assets. Reconstructed its lighting direction
  from the local sky vector instead of adding azimuth to lunar longitude.
- Let the same viewport accept geometry-only entries for the forthcoming simple
  flow; no legacy component or dataset was replaced.
- Added explicit NASA/fallback surface status and a text fallback for unavailable
  WebGL. Resizing observes the viewport container, and camera transitions respect
  reduced motion.
- Added geometry tests for near/far side, both poles, source reconstruction,
  invalid inputs, and values close to the horizon.
- Added the missing npm lockfile. Self-hosted the existing fonts with their
  licenses so deployment checks do not depend on an external stylesheet.

## Proposed next interface, pending user input

Keep the existing dark theme and Moon. Open directly in an explorer with one
site, a UTC date/hour, and short Sun/Earth summaries in a side panel (below the
Moon on mobile). Keep a native location list visible. Add a second, independent
site/date only through an explicit comparison action. Preserve legacy source
files without making narrative, astronaut, voice, or launch sequences part of
the main flow.

The separate reference checkout `s4m256/lunar-landing-site-navigator` at branch
`feat/minimal-site-comparison`, commit `9adb3b4`, was consulted for interaction
patterns only. Its data, contracts, and 3D scene were not copied over Isaac's.

## Preview limits

No Vercel authentication or project binding is available. A Vercel Preview can
upload local files without a Git push, once an authorized account is connected.
The managed preview failed with a relay readiness timeout; the cloud browser
failed to initialize. There is no verified public, no-login test URL yet.
No production hosting or alternate tunnel was created to work around this.

## Verification

The prepared changes pass TypeScript checks, twelve frontend tests, five
infrastructure tests, the frontend build, and `check:deploy`. Python remains
unchanged: fifteen tests pass and one data-dependent test is skipped; wheel,
source distribution, and placeholder CLI output also pass. Browser interaction,
actual WebGL rendering, mobile layout, and public anonymous access remain
unverified because the managed browser/preview infrastructure did not start.
