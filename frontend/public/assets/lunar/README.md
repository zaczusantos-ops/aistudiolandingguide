# Lunar display assets

`moon-poster.jpg` is the unmodified 1024×1024 photographic Moon mosaic from
[NASA SVS item 5001](https://svs.gsfc.nasa.gov/5001/), downloaded from
https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005001/moon_mosaic_print.jpg.
Credit: NASA’s Scientific Visualization Studio. The mosaic uses 1,231 LRO Narrow
Angle Camera images from summer 2018. It is a startup/fallback illustration,
not the appearance or illumination at the selected scenario time. No AI image
generation was used.

The existing LROC texture and packed elevation PNGs are retained from the
original repository. Their source attribution is recorded in
`src/landing-guide/lunarTerrainEngine.ts`; the repository does not contain a
reproducible conversion pipeline for those reduced display maps. Display relief
is not used for obstruction calculations in the guided explorer.
