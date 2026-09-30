# StarMap

A map of the sky laid over a map of the Earth. Each celestial body is drawn over its **sub-point**, the place on Earth where it is directly overhead. That way the landscape and the sky share one flat picture.

The map is always centered on you, the observer. The half of the globe within 90° of you is the half of the sky you can see. It's the clear middle of the map, and everything beyond your horizon fades into haze. The Earth turns under the sky, so stars and planets drift west across the map at about 15° an hour.

The app is built for the evening: seeing at a glance what's up between sunset and midnight.

## Running it

Open `index.html` in a browser. Everything is plain HTML and JavaScript with no build step, no server and no network access; it works straight from `file://`.

On first load the page asks for your location. You can also set it in the address:

```
index.html?lat=42.36&lon=-71.06            # Boston
index.html?lat=-33.87&lon=151.21&proj=equirect
index.html?lat=42.36&lon=-71.06&proj=globe  # 3-D globe
```

## What's on the map

- **Sun, Moon, and the five naked-eye planets** (Mercury, Venus, Mars, Jupiter, Saturn), plus 22 of the brightest stars.
- **The Moon's phase glyph** shows the real lit fraction. It is turned the way it looks from where you stand, with your zenith as "up".
- **Day and night shading** with a soft twilight edge, and the terminator (the sunrise/sunset line).
- **Anti-solar point:** a small black ring marking the spot directly opposite the Sun.
- **Your horizon.** Inside it the map is at full contrast; outside it's hazy and muted.
- **Altitude rings** at 30° and 60° above your horizon: faint circles around you, the inner one close to overhead. The horizon itself is 0°.
- **The ecliptic** (lavender) and **the equator.** The terrestrial and celestial equators coincide on this map.
- **Trails:** a faint, fading tail behind each body showing where it has been over the last 2 hours.
- **Stars come out when your sky gets dark.** While you're in daylight, every star and planet is drawn faint. As the Sun sinks through twilight where you are, those in view brighten together, reaching full strength by nautical dusk (Sun 12° down). Objects out of view stay faint. The Sun and Moon are always drawn normally.

## Controls

**Moving around**
- **Drag the globe** to move the observer. The map re-centers as you drag. **Double-click** a spot to jump straight there.
- **3-D globe:** everything is drawn on a sphere seen from space. It starts facing the observer, so the near side is exactly the sky they can see. Dragging spins the globe to look round the back and leaves the observer where they are. Moving the observer swings the globe back to face them.
- The location row has **±5° lat/lon** buttons, **Here** (your own location), lat/lon boxes, and a **city box** with about 80 cities: type "Boston" and press Enter.

**Changing the time**
- The time row has **±1h / ±1d** steps, **Now**, a speed menu (up to one day per second), and a date/time picker.
- **Day of year** slider, with the equinoxes and solstices marked.
- **Time of day** slider. It runs from the observer's solar noon to the next solar noon, so the evening is always in the middle. Sunset, full dark and solar midnight are marked on it.

**Getting information**
- **Hover** over any object for its coordinates, where it's overhead, and its altitude and azimuth from you.
- The **Tonight** panel shows sunset, full dark and solar midnight.
- The **Sky from here** table lists every object's altitude and direction, plus when it's up during tonight's evening.
- The **Layers** panel toggles trails, day/night, the visible region, the altitude rings, the ecliptic, the grid and labels. It also switches the projection between **Equal Earth** (the default, which keeps areas true near the poles), **equirectangular**, and a **3-D globe**.

Times are shown on your own clock. "Midnight" means solar midnight at the observer.

## Accuracy

Positions come from compact textbook formulas:
- **Planets:** JPL's approximate orbital elements.
- **Moon:** the main terms of the standard lunar theory (the one in Meeus's *Astronomical Algorithms*).
- **Earth's rotation:** the standard Greenwich sidereal time formula.
- **Precession:** applied, so star positions are corrected to the current date.

That's good to a small fraction of a degree between roughly 1800 and 2050. Equinox and solstice times come within about 15 minutes. Two effects are ignored: the way the atmosphere lifts objects near the horizon, and the Moon's shift of up to 1° depending on where you stand. Both matter only for objects right at the horizon.

## Files

| Path | Contents |
|---|---|
| `index.html`, `css/style.css` | Page layout and styling |
| `js/astro.js` | Ephemeris: Sun, Moon, planets, sidereal time, sub-points |
| `js/app.js` | Projection, rendering, controls, and the tonight calculations |
| `data/land.js` | Coastlines (Natural Earth 1:110m, public domain, via world-atlas) |
| `data/stars.js` | Bright-star catalog (J2000 positions, magnitudes) |
| `data/cities.js` | Cities for the place picker, as `[name, lat, lon]` |
| `NOTES.md` | Design notes and open questions |
