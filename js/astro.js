// Low-precision ephemeris: good to a small fraction of a degree for 1900-2100,
// which is far finer than a pixel on a whole-Earth map.
(function (global) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const sin = (d) => Math.sin(d * D2R), cos = (d) => Math.cos(d * D2R);
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const norm180 = (d) => norm360(d + 180) - 180;

  const julianDate = (date) => date.getTime() / 86400000 + 2440587.5;
  // Julian centuries of Terrestrial Time since J2000 (TT is about UT + 69 s).
  const centuries = (jd) => (jd + 69 / 86400 - 2451545.0) / 36525;

  // Greenwich mean sidereal time, degrees.
  function gmst(jd) {
    const T = (jd - 2451545.0) / 36525;
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T);
  }

  const obliquity = (T) => 23.439291 - 0.0130042 * T;
  // General precession in ecliptic longitude, J2000 -> date (degrees).
  const precessionLon = (T) => 1.396971 * T;

  function eclipticToEquatorial(lon, lat, eps) {
    const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * D2R) * sin(eps), cos(lon)) * R2D;
    const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) * R2D;
    return { ra: norm360(ra), dec };
  }

  function equatorialToEcliptic(ra, dec, eps) {
    const lon = Math.atan2(sin(ra) * cos(eps) + Math.tan(dec * D2R) * sin(eps), cos(ra)) * R2D;
    const lat = Math.asin(sin(dec) * cos(eps) - cos(dec) * sin(eps) * sin(ra)) * R2D;
    return { lon: norm360(lon), lat };
  }

  // J2000 RA/Dec (degrees) -> RA/Dec of date, precessing along the ecliptic.
  function precessEquatorial(ra, dec, T) {
    const e = equatorialToEcliptic(ra, dec, obliquity(0));
    return eclipticToEquatorial(e.lon + precessionLon(T), e.lat, obliquity(T));
  }

  // JPL "Keplerian elements for approximate positions" (Standish), valid 1800-2050.
  // [a, e, I, L, longPeri, longNode] and their rates per century.
  const ELEMENTS = {
    Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
              [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
              [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
    Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
              [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
    Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
              [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
              [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
              [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  };

  // Heliocentric ecliptic J2000 rectangular coordinates (AU).
  function heliocentric(name, T) {
    const [el0, rate] = ELEMENTS[name];
    const [a, e, I, L, peri, node] = el0.map((v, i) => v + rate[i] * T);
    const M = norm180(L - peri) * D2R;
    const w = peri - node;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = cos(w), sw = sin(w), cO = cos(node), sO = sin(node), cI = cos(I), sI = sin(I);
    return {
      x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      z: (sw * sI) * xp + (cw * sI) * yp,
    };
  }

  // Phase-angle terms of the standard planetary magnitude formulas (Saturn ignores rings).
  const PLANET_MAG = {
    Mercury: (i) => -0.42 + 0.038 * i - 0.000273 * i * i + 0.000002 * i * i * i,
    Venus:   (i) => -4.40 + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i,
    Mars:    (i) => -1.52 + 0.016 * i,
    Jupiter: (i) => -9.40 + 0.005 * i,
    Saturn:  (i) => -8.88 + 0.044 * i,
  };

  function geocentricFromVector(v, T) {
    const lon = Math.atan2(v.y, v.x) * R2D + precessionLon(T);
    const lat = Math.atan2(v.z, Math.hypot(v.x, v.y)) * R2D;
    return { ...eclipticToEquatorial(lon, lat, obliquity(T)), eclLon: norm360(lon) };
  }

  function sun(T) {
    const earth = heliocentric('Earth', T);
    const v = { x: -earth.x, y: -earth.y, z: -earth.z };
    return { ...geocentricFromVector(v, T), dist: Math.hypot(v.x, v.y, v.z), mag: -26.7 };
  }

  function planet(name, T) {
    const earth = heliocentric('Earth', T);
    const p = heliocentric(name, T);
    const v = { x: p.x - earth.x, y: p.y - earth.y, z: p.z - earth.z };
    const r = Math.hypot(p.x, p.y, p.z), delta = Math.hypot(v.x, v.y, v.z);
    const R = Math.hypot(earth.x, earth.y, earth.z);
    const cosPhase = (r * r + delta * delta - R * R) / (2 * r * delta);
    const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * R2D;
    return { ...geocentricFromVector(v, T), dist: delta, mag: 5 * Math.log10(r * delta) + PLANET_MAG[name](phase) };
  }

  // Moon: principal terms of the ELP series (Meeus ch. 47, truncated). Coordinates of date.
  function moon(T) {
    const Lp = 218.3164477 + 481267.88123421 * T;
    const D = 297.8501921 + 445267.1114034 * T;
    const M = 357.5291092 + 35999.0502909 * T;
    const Mp = 134.9633964 + 477198.8675055 * T;
    const F = 93.2720950 + 483202.0175233 * T;
    const lon = Lp + 6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D)
      + 0.213618 * sin(2 * Mp) - 0.185116 * sin(M) - 0.114332 * sin(2 * F)
      + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp) + 0.053322 * sin(2 * D + Mp)
      + 0.045758 * sin(2 * D - M) - 0.040923 * sin(M - Mp) - 0.034720 * sin(D)
      - 0.030383 * sin(M + Mp) + 0.015327 * sin(2 * D - 2 * F) - 0.012528 * sin(Mp + 2 * F)
      + 0.010980 * sin(Mp - 2 * F) + 0.010675 * sin(4 * D - Mp) + 0.010034 * sin(3 * Mp);
    const lat = 5.128122 * sin(F) + 0.280602 * sin(Mp + F) + 0.277693 * sin(Mp - F)
      + 0.173237 * sin(2 * D - F) + 0.055413 * sin(2 * D - Mp + F) + 0.046271 * sin(2 * D - Mp - F)
      + 0.032573 * sin(2 * D + F) + 0.017198 * sin(2 * Mp + F);
    const distKm = 385000.56 - 20905.355 * cos(Mp) - 3699.111 * cos(2 * D - Mp) - 2955.968 * cos(2 * D)
      - 569.925 * cos(2 * Mp);
    return { ...eclipticToEquatorial(norm360(lon), lat, obliquity(T)), eclLon: norm360(lon), distKm };
  }

  // Unit vector for a (lat, lon) point on the sphere.
  function toVec(lat, lon) {
    const cl = cos(lat);
    return [cl * cos(lon), cl * sin(lon), sin(lat)];
  }

  // Altitude/azimuth of a body whose sub-point is (lat, lon), seen from an observer.
  // Ignores refraction and (for the Moon) parallax.
  function altAz(obsLat, obsLon, lat, lon) {
    const dLon = lon - obsLon;
    const alt = Math.asin(sin(obsLat) * sin(lat) + cos(obsLat) * cos(lat) * cos(dLon)) * R2D;
    const az = Math.atan2(sin(dLon) * cos(lat), cos(obsLat) * sin(lat) - sin(obsLat) * cos(lat) * cos(dLon)) * R2D;
    return { alt, az: norm360(az) };
  }

  // Point at angular distance `dist` from (lat, lon) along initial bearing `brg` (degrees).
  function destination(lat, lon, brg, dist) {
    const la = Math.asin(sin(lat) * cos(dist) + cos(lat) * sin(dist) * cos(brg)) * R2D;
    const lo = lon + Math.atan2(sin(brg) * sin(dist) * cos(lat), cos(dist) - sin(lat) * sin(la)) * R2D;
    return [norm180(lo), la];
  }

  // Everything the map needs at one instant. Sub-point: lat = dec, lon = RA - GMST.
  function computeSky(date) {
    const jd = julianDate(date), T = centuries(jd), g = gmst(jd);
    const sub = (eq) => ({ lat: eq.dec, lon: norm180(eq.ra - g) });
    const bodies = [];

    const s = sun(T);
    bodies.push({ name: 'Sun', kind: 'sun', ...s, ...sub(s) });

    const m = moon(T);
    const elong = Math.acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)) * R2D;
    const waxing = norm360(m.eclLon - s.eclLon) < 180;
    bodies.push({ name: 'Moon', kind: 'moon', ...m, ...sub(m), mag: -12.7,
      illum: (1 - cos(elong)) / 2, elong, waxing });

    for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']) {
      const p = planet(name, T);
      bodies.push({ name, kind: 'planet', ...p, ...sub(p) });
    }

    for (const st of BRIGHT_STARS) {
      const eq = precessEquatorial(st.ra * 15, st.dec, T);
      bodies.push({ name: st.name, kind: 'star', mag: st.mag, ...eq, ...sub(eq) });
    }
    for (const st of FAINT_STARS) {
      const eq = precessEquatorial(st.ra * 15, st.dec, T);
      bodies.push({ name: st.name, kind: 'star', faint: true, mag: st.mag, ...eq, ...sub(eq) });
    }

    // Ecliptic of date traced as sub-points.
    const eps = obliquity(T), ecliptic = [];
    for (let l = 0; l <= 360; l += 2) {
      const eq = eclipticToEquatorial(l, 0, eps);
      ecliptic.push([norm180(eq.ra - g), eq.dec]);
    }

    return { date, jd, T, gmst: g, bodies, ecliptic, sun: bodies[0], moon: bodies[1] };
  }

  // Just the Sun's sub-point, for fast searches (sunset, solar midnight).
  function sunSubpoint(date) {
    const jd = julianDate(date), s = sun(centuries(jd));
    return { lat: s.dec, lon: norm180(s.ra - gmst(jd)) };
  }

  // Sun's ecliptic longitude of date (0 = March equinox, 90 = June solstice, ...).
  const sunLongitude = (date) => sun(centuries(julianDate(date))).eclLon;

  global.Astro = { D2R, R2D, norm180, norm360, julianDate, gmst, computeSky, sunSubpoint, sunLongitude, altAz, destination, toVec };
})(typeof window !== 'undefined' ? window : globalThis);
