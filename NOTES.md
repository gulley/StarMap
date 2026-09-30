# StarMap design notes

## Open problem: making the four regions distinct

The map mixes two independent splits, which gives four regions:

|              | In view (within 90° of observer) | Out of view |
|--------------|----------------------------------|-------------|
| **Night**    | The main event: what you can see tonight | Useful context: what rises later |
| **Day**      | The sky is up, but only the Sun and Moon show | Least important |

**What it does now (end of first session):**
- Night is a dark navy overlay: a soft step at sunset, deepening through 18° of twilight, up to about 66% opacity (78% before session 2).
- Out of view is a flat gray-blue haze (`HAZE`, `HAZE_ALPHA` = 0.62 in `js/app.js`). It fades in from 88° to 110° from the observer.
- Star and planet brightness follows the *observer's* darkness, not the day/night shading under each body. They're faint (`FAINT` = 0.25) while the observer is in daylight. In view, they brighten through twilight to full strength when the Sun is 12° down at the observer. Out of view they're always faint. This was the user's key insight: visibility depends on whether *you* are in the dark.
- The lines are the solid pale-gold terminator and the solid cyan horizon.

**The difficulty:** night and "out of view" both push the map toward dark and dull, so the two splits compete on the same visual channel (brightness). The user still has trouble telling them apart.

### Key principle: give each split its own visual channel

Keep the two splits on separate channels:

- **Day vs night → brightness.** This is how people already read day and night: day is light, night is dark.
- **In view vs out of view → color and sharpness.** In view is vivid and crisp; out of view is grayscale, soft and flat.

Then all four regions become distinct without any lines:

| | In view | Out of view |
|---|---|---|
| Night | Dark, saturated navy, crisp land edges, bright stars | Dark gray, blurred, dim stars |
| Day | Light sky-blue wash, full-color land | Light gray, blurred |

The haze we have now only partly does this. Blending toward one mid-gray lifts the darks and dims the lights, so it flattens brightness too, and day-out and night-out drift toward the same gray.

### Ideas to try (roughly best first)

1. **True grayscale plus blur out of view.** Render the map layers to an offscreen canvas. Then draw it twice: once normally, clipped to the visible hemisphere, and once with `ctx.filter = 'grayscale(1) contrast(0.6) blur(1.5px)'` for the rest, with a feathered mask at the horizon.
   - This keeps day/night brightness intact out of view while clearly muting it. The "out of focus" look reads naturally as "can't see that".
   - Caveat: `ctx.filter` isn't supported in older Safari. The fallback is per-pixel desaturation in the existing overlay loop, done in ImageData over the composited map.
2. **Daylight gets its own color, not just "no night".** Add a pale sky-blue wash over the day side so daylight is positively marked rather than just being the absence of dark. Night stays navy. Then day and night differ in hue as well as brightness.
3. **Twilight as a few discrete soft bands** (civil, nautical, astronomical) instead of one smooth ramp. That makes the terminator zone readable ("it's nautical twilight here") and separates it from the horizon fade, which stays smooth.
4. **Make the in-view region read as a sky dome.** Add faint altitude rings (30° and 60°) and N/E/S/W tick labels on the horizon line. That gives the clear region a clear identity ("this is my sky") and helps find things. Use solid, very faint lines — no dashes (user preference).
5. **A glow along the horizon edge.** A soft light band just inside the horizon, like real sky brightness near the horizon, instead of a hard cyan line. The horizon then reads as the edge of a lit window rather than one more line to decode.
6. **Treat content differently in and out of view.** Out of view: hide the grid, ecliptic and trails entirely (or keep them at ~15%), and show only bright stars with no labels. In view: everything. Less clutter makes the in-view region pop without heavy shading.
7. **A 2×2 legend swatch** showing the four regions, so the encoding is spelled out once.
8. **A vignette window.** Darken the whole map outside view toward the page background, so the visible hemisphere looks lit up like a window. This is simple, but it collides with night (brightness again). Only worth trying together with idea 1 or 2.

**Avoid:**
- Hatching or stipple patterns: busy, and close to the "broken lines" the user dislikes.
- Tinting the in-view region: tried, and it read too much like the night shading.

### Experiment in progress (session 2): ideas 1 + 2

Built behind a temporary **Regions** menu in the Layers panel (`regionStyle` in `js/app.js`,
also `?regions=focus|haze`):
- **Day tint + soft gray** (`focus`, now the default): day side gets a pale sky-blue wash
  (`DAY_RGB`, `DAY_ALPHA` = 0.3). Past the horizon the finished map is redrawn through
  `grayscale(1) brightness(0.72) contrast(0.85) blur(0.6px)`, feathered from 88° to 98°.
  Bodies are drawn afterwards, so they stay sharp (and faint out of view, as before).
- **Haze (original)**: the flat gray-blue haze, for comparison.

First look: all four regions read as distinct. In view: blue day, navy night. Out of view:
mid gray for day, dark gray for night. The brightness(0.72) was added because out-of-view
day was otherwise the brightest area on the map despite being the least important.
Falls back to the haze where canvas filters aren't supported (older Safari).

Once a style is chosen, remove the menu and the losing code path.

### Suggested next step (before the experiment)

Prototype idea 1 with idea 2 (grayscale and blur out of view, plus a daylight wash), with a temporary toggle to compare against the current haze. Then consider idea 4 (the sky dome) as the finishing touch for the in-view region.

## User preferences to keep in mind
- Evening-focused (sunset to midnight). The map is always centered on the observer.
- Equal Earth projection by default. No Mercator. No lat/lon grid labels.
- No dashed or dotted lines. Subtle over busy.
- Stars and planets brighten only when the observer's own sky is dark (see above). The Sun and Moon are always drawn normally.
