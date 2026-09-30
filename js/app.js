(function () {
  const { D2R, R2D, norm180, norm360, computeSky, sunSubpoint, altAz, toVec } = Astro;

  // ---------- persisted settings ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('starmap.' + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('starmap.' + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  // URL parameters (?lat=..&lon=..&proj=equirect) override saved settings.
  const params = new URLSearchParams(location.search);
  const urlLat = parseFloat(params.get('lat')), urlLon = parseFloat(params.get('lon'));
  const savedObserver = Number.isFinite(urlLat) && Number.isFinite(urlLon)
    ? { lat: urlLat, lon: urlLon } : store.get('observer', null);
  const observer = savedObserver || { lat: 51.48, lon: 0.0 };
  const layers = Object.assign(
    { trails: true, night: true, visible: true, altitude: true, ecliptic: true, grid: true, labels: true },
    store.get('layers', {}));
  let projection = params.get('proj') || store.get('projection', 'equalEarth');
  if (!['equalEarth', 'equirect', 'globe'].includes(projection)) projection = 'equalEarth';

  // ---------- simulation clock ----------
  const clock = { baseSim: Date.now(), baseReal: Date.now(), speed: 1 };
  const simTime = () => clock.baseSim + (Date.now() - clock.baseReal) * clock.speed;
  function setClock(simMs, speed = clock.speed) {
    clock.baseSim = simMs; clock.baseReal = Date.now(); clock.speed = speed;
    speedSel.value = String(speed);
    dirty = true;
  }

  // ---------- observer-centered rotation ----------
  // The globe is rotated so the observer sits at (0, 0) of the projection, north up.
  // In this frame the observer's visible hemisphere is exactly |rotated lon| < 90.
  let rot = null;
  function updateRotation() {
    rot = {
      cl: Math.cos(observer.lon * D2R), sl: Math.sin(observer.lon * D2R),
      cp: Math.cos(observer.lat * D2R), sp: Math.sin(observer.lat * D2R),
    };
    updateGlobe();
  }

  // ---------- 3-D globe camera ----------
  // The globe is seen from outside, looking down on `cam` with north up. The camera starts
  // over the observer and follows them when they move; dragging spins it independently.
  // Camera frame: +x toward the viewer, +y right (east), +z up (north).
  const cam = { lat: observer.lat, lon: observer.lon };
  let camMat = null, globeMat = null;
  // Matrix taking Earth vectors into the frame centred on (lat, lon); same as rotateVec.
  function frameMatrix(lat, lon) {
    const cl = Math.cos(lon * D2R), sl = Math.sin(lon * D2R), cp = Math.cos(lat * D2R), sp = Math.sin(lat * D2R);
    return [[cl * cp, sl * cp, sp], [-sl, cl, 0], [-cl * sp, -sl * sp, cp]];
  }
  const mulVec = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const mulVecT = (m, v) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);
  function updateGlobe() {
    camMat = frameMatrix(cam.lat, cam.lon);
    // Observer frame -> camera frame: back to Earth coordinates, then into the camera's.
    const o = frameMatrix(observer.lat, observer.lon);
    globeMat = camMat.map((r) => [0, 1, 2].map((j) => r[0] * o[j][0] + r[1] * o[j][1] + r[2] * o[j][2]));
  }
  function rotateVec([x, y, z]) {
    const x1 = x * rot.cl + y * rot.sl, y1 = -x * rot.sl + y * rot.cl;
    return [x1 * rot.cp + z * rot.sp, y1, -x1 * rot.sp + z * rot.cp];
  }
  // Earth (lat, lon) -> [rotated lon, rotated lat].
  function toRot(lat, lon) {
    const [x, y, z] = rotateVec(toVec(lat, lon));
    return [Math.atan2(y, x) * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
  }
  // Rotated (lat, lon) -> Earth {lat, lon}.
  function fromRot(latR, lonR) {
    const [x2, y2, z2] = toVec(latR, lonR);
    const x1 = x2 * rot.cp - z2 * rot.sp, z = x2 * rot.sp + z2 * rot.cp;
    const x = x1 * rot.cl - y2 * rot.sl, y = x1 * rot.sl + y2 * rot.cl;
    return { lat: Math.asin(Math.max(-1, Math.min(1, z))) * R2D, lon: Math.atan2(y, x) * R2D };
  }

  // ---------- projections ----------
  // Each maps (rotated lon, rotated lat) in degrees to unit coordinates, and back.
  // Longitudes outside ±180 extrapolate smoothly, which lets shapes that cross the
  // seam be drawn twice and clipped to the map outline.
  const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 };
  const PROJECTIONS = {
    equirect: {
      fwd: (lon, lat) => [lon * D2R, lat * D2R],
      inv: (x, y) => [x * R2D, y * R2D],
    },
    // Equal Earth (Šavrič, Patterson & Jenny, 2018): equal-area, poles as short lines.
    equalEarth: {
      fwd(lon, lat) {
        const t = Math.asin(EE.M * Math.sin(lat * D2R)), t2 = t * t, t6 = t2 * t2 * t2;
        const d = EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2);
        return [lon * D2R * Math.cos(t) / (EE.M * d), t * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2))];
      },
      inv(x, y) {
        let t = y / EE.A1, d = EE.A1;
        for (let i = 0; i < 10; i++) {
          const t2 = t * t, t6 = t2 * t2 * t2;
          d = EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2);
          t -= (t * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2)) - y) / d;
        }
        const s = Math.sin(t) / EE.M;
        if (Math.abs(s) > 1) return [NaN, NaN];
        return [x * EE.M * d / Math.cos(t) * R2D, Math.asin(s) * R2D];
      },
    },
    // 3-D: an orthographic view of the globe from the camera. Points on the far side are
    // pushed out to the rim; callers that care check globeFacing. The extent leaves a
    // margin round the unit disc for the atmosphere glow.
    globe: {
      globe: true,
      xMax: 1.06, yMax: 1.06,
      fwd(lon, lat) {
        const [x, y, z] = mulVec(globeMat, toVec(lat, lon));
        if (x >= 0) return [y, z];
        const r = Math.hypot(y, z) || 1;
        return [y / r, z / r];
      },
      inv(u, v) {
        const r2 = u * u + v * v;
        if (r2 > 1) return [NaN, NaN];
        const [x, y, z] = mulVecT(globeMat, [Math.sqrt(1 - r2), u, v]);
        return [Math.atan2(y, x) * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
      },
    },
  };
  for (const p of Object.values(PROJECTIONS)) {
    p.xMax ??= p.fwd(180, 0)[0];
    p.yMax ??= p.fwd(0, 90)[1];
  }

  const PAD = 4;
  const view = { W: 0, H: 0, scale: 1 };
  const proj = () => PROJECTIONS[projection];
  const aspect = () => proj().xMax / proj().yMax;

  // Rotated coordinates -> canvas point.
  function projectRot(lonR, latR) {
    const [u, v] = proj().fwd(lonR, latR);
    return [view.W / 2 + u * view.scale, view.H / 2 - v * view.scale];
  }
  // Canvas point -> rotated [lon, lat], or null outside the map.
  function unprojectRot(x, y) {
    const [lonR, latR] = proj().inv((x - view.W / 2) / view.scale, (view.H / 2 - y) / view.scale);
    if (!(Math.abs(lonR) <= 180) || !(Math.abs(latR) <= 90)) return null;
    return [lonR, latR];
  }

  const isGlobe = () => !!proj().globe;
  // Globe: camera-frame vector for a rotated or Earth point, whether it faces the viewer,
  // and where a camera-frame vector lands on the canvas (points behind go to the rim).
  const globeVecRot = (lonR, latR) => mulVec(globeMat, toVec(latR, lonR));
  const globeVecEarth = (lon, lat) => mulVec(camMat, toVec(lat, lon));
  const globeFacing = (lonR, latR) => !isGlobe() || globeVecRot(lonR, latR)[0] >= 0;
  function globePoint([x, y, z]) {
    if (x <= 0) { const r = Math.hypot(y, z) || 1; y /= r; z /= r; }
    return [view.W / 2 + y * view.scale, view.H / 2 - z * view.scale];
  }

  function traceOutline() {
    ctx.beginPath();
    if (isGlobe()) { ctx.arc(view.W / 2, view.H / 2, view.scale, 0, Math.PI * 2); return; }
    for (let lat = -90; lat <= 90; lat += 2) ctx.lineTo(...projectRot(180, lat));
    for (let lat = 90; lat >= -90; lat -= 2) ctx.lineTo(...projectRot(-180, lat));
    ctx.closePath();
  }

  // ---------- canvas setup ----------
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const overlay = document.createElement('canvas');
  const octx = overlay.getContext('2d');
  let dpr = 1;
  let dirty = true;

  function resize() {
    const wrap = canvas.parentElement;
    const maxH = Math.max(240, window.innerHeight - canvas.getBoundingClientRect().top - 110);
    const W = Math.floor(Math.min(wrap.clientWidth, maxH * aspect()));
    const H = Math.round((W - 2 * PAD) / aspect()) + 2 * PAD;
    const scale = (W - 2 * PAD) / (2 * proj().xMax);
    const r = window.devicePixelRatio || 1;
    if (W === view.W && H === view.H && scale === view.scale && r === dpr) return;
    Object.assign(view, { W, H, scale });
    dpr = r;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    // Resizing clears the canvas, so repaint right away rather than waiting a frame.
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (W > 0) render();
  }

  // ---------- land outlines ----------
  // Rings are rotated into the observer frame and unwrapped so each is continuous in
  // longitude; a ring that wraps all the way round encloses a pole of the rotated frame
  // and is closed through it. Recomputed only when the observer moves.
  let landRings = [], landKey = '';

  // Ring of [lon, lat] -> continuous in longitude, closed through the pole if it wraps.
  function unwrapRing(ring) {
    const out = [];
    for (const [lon, lat] of ring) {
      out.push([out.length ? out[out.length - 1][0] + norm180(lon - out[out.length - 1][0]) : lon, lat]);
    }
    const last = out[out.length - 1][0], first = out[0][0];
    if (Math.abs(last - first) > 180) {
      const pole = out.reduce((s, p) => s + p[1], 0) < 0 ? -90 : 90;
      for (let i = 0; i <= 36; i++) out.push([last + (first - last) * i / 36, pole]);
    }
    return out;
  }

  function updateLand() {
    const key = observer.lat + '|' + observer.lon;
    if (key === landKey) return;
    landKey = key;
    landRings = LAND_RINGS.map((ring) => unwrapRing(ring.map(([lon, lat]) => toRot(lat, lon))));
  }

  // The globe paints land from a lat/lon mask rather than filling projected rings, which
  // would need clipping against the far side. Built once, at 0.18° per texel.
  const MASK_W = 2048, MASK_H = 1024;
  let landMask = null;
  function buildLandMask() {
    const c = document.createElement('canvas');
    c.width = MASK_W; c.height = MASK_H;
    const g = c.getContext('2d');
    g.beginPath();
    for (const ring of LAND_RINGS.map(unwrapRing)) {
      for (const k of [-360, 0, 360]) {
        ring.forEach(([lon, lat], i) => {
          const x = (lon + k + 180) / 360 * MASK_W, y = (90 - lat) / 180 * MASK_H;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.closePath();
      }
    }
    g.fill('evenodd');
    const d = g.getImageData(0, 0, MASK_W, MASK_H).data;
    landMask = new Uint8Array(MASK_W * MASK_H);
    for (let i = 0; i < landMask.length; i++) landMask[i] = d[i * 4 + 3];
  }

  // Land as seen on the globe, rendered per pixel and cached until the camera or size
  // changes. While dragging it renders at CSS resolution to keep up; the coastline
  // stroke on top keeps the edges crisp.
  const globeCanvas = document.createElement('canvas');
  const gctx = globeCanvas.getContext('2d');
  let globeKey = '';
  const LAND_RGB = [93, 107, 79];

  function drawGlobeLand() {
    if (!landMask) buildLandMask();
    const res = drag ? 1 : dpr;
    const w = Math.round(view.W * res), h = Math.round(view.H * res);
    const key = [w, h, view.scale, cam.lat, cam.lon].join('|');
    if (key !== globeKey) {
      globeKey = key;
      globeCanvas.width = w; globeCanvas.height = h;
      const img = gctx.createImageData(w, h), px = img.data;
      const R = view.scale * res, cx = w / 2, cy = h / 2;
      const m = camMat;
      const j0 = Math.max(0, Math.floor(cy - R)), j1 = Math.min(h, Math.ceil(cy + R));
      for (let j = j0; j < j1; j++) {
        const v = (cy - j - 0.5) / R;
        const span = Math.sqrt(Math.max(0, 1 - v * v)) * R;
        const i0 = Math.max(0, Math.floor(cx - span)), i1 = Math.min(w, Math.ceil(cx + span));
        for (let i = i0; i < i1; i++) {
          const u = (i + 0.5 - cx) / R, r2 = u * u + v * v;
          if (r2 > 1) continue;
          const c = Math.sqrt(1 - r2);
          // Camera frame -> Earth: the transpose of the camera matrix.
          const x = m[0][0] * c + m[1][0] * u + m[2][0] * v;
          const y = m[0][1] * c + m[1][1] * u + m[2][1] * v;
          const z = m[0][2] * c + m[1][2] * u + m[2][2] * v;
          // Bilinear lookup, wrapping in longitude.
          const fx = (Math.atan2(y, x) * R2D + 180) / 360 * MASK_W - 0.5;
          const fy = (90 - Math.asin(z > 1 ? 1 : z < -1 ? -1 : z) * R2D) / 180 * MASK_H - 0.5;
          const xi = Math.floor(fx), yi = Math.max(0, Math.min(MASK_H - 2, Math.floor(fy)));
          const ax = fx - xi, ay = Math.max(0, Math.min(1, fy - yi));
          const xa = (xi + MASK_W) % MASK_W, xb = (xa + 1) % MASK_W;
          const r0 = yi * MASK_W, r1 = r0 + MASK_W;
          const a = (landMask[r0 + xa] * (1 - ax) + landMask[r0 + xb] * ax) * (1 - ay)
            + (landMask[r1 + xa] * (1 - ax) + landMask[r1 + xb] * ax) * ay;
          if (a < 1) continue;
          const q = (j * w + i) * 4;
          px[q] = LAND_RGB[0]; px[q + 1] = LAND_RGB[1]; px[q + 2] = LAND_RGB[2]; px[q + 3] = a;
        }
      }
      gctx.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(globeCanvas, 0, 0, view.W, view.H);

    ctx.beginPath();
    for (const ring of LAND_RINGS) tracePolyline(ring);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(12, 16, 22, 0.85)';
    ctx.stroke();
  }

  // Call with the map outline as the clip region: the copies at ±360° fill in whatever
  // part of a ring falls across the seam.
  function drawLand() {
    if (isGlobe()) { drawGlobeLand(); return; }
    ctx.beginPath();
    for (const ring of landRings) {
      const base = norm180(ring[0][0]) - ring[0][0];
      for (const k of [-360, 0, 360]) {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = projectRot(lon + base + k, lat);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
    ctx.fillStyle = '#5d6b4f';
    ctx.fill('evenodd');
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(12, 16, 22, 0.85)';
    ctx.stroke();
  }

  // ---------- polylines that may cross the map seam ----------
  // Points are Earth [lon, lat]; set `rotated` for points already in the observer frame.
  function tracePolyline(points, rotated = false) {
    if (isGlobe()) { traceGlobePolyline(points, rotated); return; }
    let prev = null;
    for (const p of points) {
      const [lonR, latR] = rotated ? p : toRot(p[1], p[0]);
      if (!prev) { ctx.moveTo(...projectRot(lonR, latR)); prev = [lonR, latR]; continue; }
      const [pLon, pLat] = prev;
      if (Math.abs(lonR - pLon) > 180) {
        const edge = pLon > 0 ? 180 : -180;
        const target = lonR + (pLon > 0 ? 360 : -360);
        const t = (edge - pLon) / (target - pLon);
        const latC = pLat + (latR - pLat) * t;
        ctx.lineTo(...projectRot(edge, latC));
        ctx.moveTo(...projectRot(-edge, latC));
      }
      ctx.lineTo(...projectRot(lonR, latR));
      prev = [lonR, latR];
    }
  }

  // Lines lying on the rim itself (the horizon, seen from overhead) count as near side.
  const RIM_EPS = -1e-9;
  // On the globe, only the near side is drawn; a line going round the back is cut where
  // it crosses the rim.
  function traceGlobePolyline(points, rotated) {
    let prev = null;
    for (const p of points) {
      const w = rotated ? globeVecRot(p[0], p[1]) : globeVecEarth(p[0], p[1]);
      if (!prev) {
        if (w[0] > RIM_EPS) ctx.moveTo(...globePoint(w));
      } else if (w[0] > RIM_EPS && prev[0] > RIM_EPS) {
        ctx.lineTo(...globePoint(w));
      } else if (w[0] > RIM_EPS || prev[0] > RIM_EPS) {
        const t = prev[0] / (prev[0] - w[0]);
        const rim = globePoint([0, prev[1] + (w[1] - prev[1]) * t, prev[2] + (w[2] - prev[2]) * t]);
        if (w[0] > RIM_EPS) { ctx.moveTo(...rim); ctx.lineTo(...globePoint(w)); }
        else ctx.lineTo(...rim);
      }
      prev = w;
    }
  }

  function strokePath(points, style, width, dash = [], rotated = false) {
    ctx.beginPath();
    tracePolyline(points, rotated);
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Great circle 90° from an Earth point: the terminator for the sub-solar point.
  function horizonOf(lat, lon) {
    const [x, y, z] = rotateVec(toVec(lat, lon));
    // Two orthonormal vectors perpendicular to the centre span the circle.
    const n = [x, y, z];
    const a = Math.abs(z) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const ul = Math.hypot(...u); u = u.map((c) => c / ul);
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const pts = [];
    for (let i = 0; i <= 360; i++) {
      const c = Math.cos(i * D2R), s = Math.sin(i * D2R);
      const px = u[0] * c + w[0] * s, py = u[1] * c + w[1] * s, pz = u[2] * c + w[2] * s;
      pts.push([Math.atan2(py, px) * R2D, Math.asin(Math.max(-1, Math.min(1, pz))) * R2D]);
    }
    return pts;
  }

  // Circle of constant altitude above the observer's horizon, in the rotated frame, where
  // the observer is [1, 0, 0]: every point on it is 90° - alt from them.
  function altitudeCircle(alt) {
    const d = (90 - alt) * D2R, c = Math.cos(d), s = Math.sin(d);
    return range(0, 360, 2).map((th) => {
      const y = s * Math.cos(th * D2R), z = s * Math.sin(th * D2R);
      return [Math.atan2(y, c) * R2D, Math.asin(z) * R2D];
    });
  }

  // ---------- day/night + visible-region shading ----------
  // Rendered at reduced resolution into an offscreen canvas and scaled up smoothly.
  // Pixel vectors live in the rotated frame, where the observer is [1, 0, 0].
  const OVERLAY_SCALE = 3;
  let overlayVecs = null, overlayKey = '';

  function ensureOverlayVecs() {
    const ow = Math.ceil(view.W / OVERLAY_SCALE), oh = Math.ceil(view.H / OVERLAY_SCALE);
    const key = [ow, oh, projection, view.W, isGlobe() ? cam.lat + ',' + cam.lon + ',' + observer.lat + ',' + observer.lon : ''].join('|');
    if (key === overlayKey) return;
    overlayKey = key;
    overlay.width = ow; overlay.height = oh;
    overlayVecs = new Float32Array(ow * oh * 3).fill(NaN);
    for (let j = 0; j < oh; j++) {
      for (let i = 0; i < ow; i++) {
        const p = unprojectRot(((i + 0.5) / ow) * view.W, ((j + 0.5) / oh) * view.H);
        if (!p) continue;
        const v = toVec(p[1], p[0]), o = (j * ow + i) * 3;
        overlayVecs[o] = v[0]; overlayVecs[o + 1] = v[1]; overlayVecs[o + 2] = v[2];
      }
    }
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function blitOverlay(img) {
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(overlay, 0, 0, view.W, view.H);
  }

  function drawNight(sky) {
    ensureOverlayVecs();
    const ow = overlay.width, oh = overlay.height;
    const img = octx.createImageData(ow, oh);
    const px = img.data;
    const s = rotateVec(toVec(sky.sun.lat, sky.sun.lon));

    for (let p = 0, o = 0; p < ow * oh; p++, o += 3) {
      const x = overlayVecs[o], y = overlayVecs[o + 1], z = overlayVecs[o + 2];
      if (Number.isNaN(x)) continue;
      const alt = Math.asin(x * s[0] + y * s[1] + z * s[2]) * R2D;
      // A soft step at sunset, then deepening through the 18 degrees of twilight.
      const a = 0.34 * clamp01((0.8 - alt) / 1.6) + 0.44 * clamp01(-alt / 18);
      const q = p * 4;
      px[q] = 4; px[q + 1] = 8; px[q + 2] = 30; px[q + 3] = a * 255;
    }
    blitOverlay(img);
  }

  // Beyond the observer's horizon the map is washed toward a flat gray-blue: low contrast,
  // desaturated, fading in from just inside the horizon to about 20° past it. In the
  // rotated frame this depends only on x (the cosine of the distance from the observer).
  const HAZE = [62, 70, 90], HAZE_ALPHA = 0.62;
  let hazeImg = null, hazeKey = '';
  function drawHaze() {
    ensureOverlayVecs();
    if (hazeKey === overlayKey) { blitOverlay(hazeImg); return; }
    hazeKey = overlayKey;
    const ow = overlay.width, oh = overlay.height;
    const img = hazeImg = octx.createImageData(ow, oh);
    const px = img.data;
    const x0 = Math.cos(88 * D2R), x1 = Math.cos(110 * D2R);
    for (let p = 0, o = 0; p < ow * oh; p++, o += 3) {
      const x = overlayVecs[o];
      if (Number.isNaN(x)) continue;
      const f = clamp01((x0 - x) / (x0 - x1)), a = HAZE_ALPHA * f * f * (3 - 2 * f);
      const q = p * 4;
      px[q] = HAZE[0]; px[q + 1] = HAZE[1]; px[q + 2] = HAZE[2]; px[q + 3] = a * 255;
    }
    blitOverlay(img);
  }

  // ---------- grid ----------
  const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);

  function drawGrid() {
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(210, 222, 245, 0.16)';
    ctx.beginPath();
    for (let lon = -180; lon < 180; lon += 30) tracePolyline(range(-90, 90, 2).map((lat) => [lon, lat]));
    for (const lat of [-60, -30, 30, 60]) tracePolyline(range(-180, 180, 2).map((lon) => [lon, lat]));
    ctx.stroke();

    // Equator: the terrestrial equator and, projected, the celestial equator.
    strokePath(range(-180, 180, 2).map((lon) => [lon, 0]), 'rgba(198, 210, 234, 0.75)', 1.4);
  }

  // ---------- tonight: sunset to solar midnight ----------
  const HOUR = 3600e3, DAY = 86400e3, SUN_RATE = 360.9856; // degrees of sub-solar longitude per day
  const SUNSET_ALT = -0.833;
  const sunAlt = (t) => {
    const s = sunSubpoint(new Date(t));
    return altAz(observer.lat, observer.lon, s.lat, s.lon).alt;
  };

  // First moment after t when the Sun is directly beneath the observer's meridian.
  function solarMidnightAfter(t) {
    const target = observer.lon + 180;
    t += norm360(sunSubpoint(new Date(t)).lon - target) / SUN_RATE * DAY;
    for (let i = 0; i < 2; i++) t += norm180(sunSubpoint(new Date(t)).lon - target) / SUN_RATE * DAY;
    return t;
  }

  // Time in [a, b] where the Sun descends through `alt`, or null.
  function sunCrossing(a, b, alt) {
    const step = 10 * 60e3;
    for (let t = a; t < b; t += step) {
      const t2 = Math.min(b, t + step);
      if (sunAlt(t) >= alt && sunAlt(t2) < alt) {
        let lo = t, hi = t2;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (sunAlt(mid) >= alt) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
      }
    }
    return null;
  }

  let evening = null, eveningKey = '';

  // The observer's solar noon that begins the observing night containing t. Nights run
  // noon to noon at the observer, as astronomers count them, so solar midnight always
  // sits in the middle and the evening never wraps, whatever your own time zone.
  function nightNoon(t) {
    return solarMidnightAfter(t - 12 * HOUR) - 12 * HOUR;
  }

  // Calendar date at the observer, by local mean time (longitude / 15 hours from UTC).
  // Read it with the UTC getters.
  const observerDate = (t) => new Date(t + observer.lon * 4 * 60e3);

  function updateEvening(t) {
    // "Tonight" ends at the first solar midnight after the noon that starts this night.
    const end = solarMidnightAfter(nightNoon(t));
    const key = [Math.round(end / 60e3), observer.lat, observer.lon].join('|');
    if (key === eveningKey) return;
    eveningKey = key;

    const noon = end - 12 * HOUR;
    const sunset = sunCrossing(noon, end, SUNSET_ALT);
    const dark = sunCrossing(noon, end, -18);
    let start = sunset, note = '';
    if (sunset === null) {
      start = end - 6 * HOUR;
      note = sunAlt(end) > SUNSET_ALT ? 'The Sun does not set tonight.' : 'The Sun does not rise today.';
    }

    const n = Math.max(12, Math.ceil((end - start) / (10 * 60e3)));
    const trails = new Map();
    for (let i = 0; i <= n; i++) {
      const tt = start + (end - start) * i / n;
      for (const b of computeSky(new Date(tt)).bodies) {
        const alt = altAz(observer.lat, observer.lon, b.lat, b.lon).alt;
        if (!trails.has(b.name)) trails.set(b.name, []);
        trails.get(b.name).push({ t: tt, lon: b.lon, lat: b.lat, alt });
      }
    }
    evening = { start, end, sunset, dark, note, trails };
  }

  // Intervals (in ms) during tonight's window when a body is above the horizon.
  function upIntervals(samples) {
    const out = [];
    let from = null;
    samples.forEach((s, i) => {
      const prev = samples[i - 1];
      const cross = prev ? prev.t + (s.t - prev.t) * (prev.alt / (prev.alt - s.alt)) : s.t;
      if (s.alt > 0 && from === null) from = prev ? cross : s.t;
      if (s.alt <= 0 && from !== null) { out.push([from, cross]); from = null; }
    });
    if (from !== null) out.push([from, samples[samples.length - 1].t]);
    return out;
  }

  function tonightSummary(b) {
    if (!evening) return '';
    if (b.kind === 'sun') return evening.sunset ? `sets ${fmtClock(evening.sunset)}` : '—';
    const iv = upIntervals(evening.trails.get(b.name));
    if (!iv.length) return 'not up';
    const [a, z] = iv[0], fromStart = a <= evening.start + 1, toEnd = z >= evening.end - 1;
    if (iv.length === 1 && fromStart && toEnd) return 'all evening';
    if (iv.length === 1 && fromStart) return `until ${fmtClock(z)}`;
    if (iv.length === 1 && toEnd) return `rises ${fmtClock(a)}`;
    return `${fmtClock(a)}–${fmtClock(z)}`;
  }

  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');

  // Tails: where each body has been over the last couple of hours, oldest first.
  const TRAIL_SPAN = 2 * HOUR, TRAIL_STEPS = 16;

  function trailSamples(t) {
    const trails = new Map();
    for (let i = 0; i <= TRAIL_STEPS; i++) {
      const tt = t - TRAIL_SPAN * (1 - i / TRAIL_STEPS);
      for (const b of computeSky(new Date(tt)).bodies) {
        const alt = altAz(observer.lat, observer.lon, b.lat, b.lon).alt;
        if (!trails.has(b.name)) trails.set(b.name, []);
        trails.get(b.name).push({ t: tt, lon: b.lon, lat: b.lat, alt });
      }
    }
    return trails;
  }

  function drawTrails(t, sky) {
    const dark = observerDarkness(sky);
    for (const [name, samples] of trailSamples(t)) {
      const kind = name === 'Sun' ? 'sun' : name === 'Moon' ? 'moon' : PLANET_COLORS[name] ? 'planet' : 'star';
      // The Sun's trail is a deeper orange than its disc so it reads against the sunlit side.
      const color = kind === 'star' ? '255, 255, 255' : kind === 'sun' ? '255, 170, 50'
        : hexToRgb(bodyColor({ kind, name }));
      const width = kind === 'star' ? 1.2 : kind === 'sun' ? 3 : 1.6;
      const upAlpha = kind === 'star' ? 0.6 : kind === 'sun' ? 0.95 : 0.8, downAlpha = kind === 'sun' ? 0.6 : 0.2;
      // Star and planet trails brighten with the observer's darkness, like the bodies.
      const vis = kind === 'sun' || kind === 'moon' ? 1 : FAINT + (1 - FAINT) * dark;

      // Each segment is drawn on its own so the tail can fade from nothing at its old end
      // to full strength at the body; it also dims below the horizon.
      const n = samples.length - 1;
      for (let i = 0; i < n; i++) {
        const a = samples[i], b = samples[i + 1];
        const up = a.alt + b.alt > 0;
        const age = Math.pow((i + 1) / n, 1.2);
        const alpha = (up ? upAlpha * vis : downAlpha) * age;
        if (alpha < 0.005) continue;
        strokePath([[a.lon, a.lat], [b.lon, b.lat]], `rgba(${color}, ${alpha.toFixed(3)})`, up ? width : 1);
      }
    }
  }

  // ---------- bodies ----------
  const PLANET_COLORS = {
    Mercury: '#cfc6b8', Venus: '#fff3d1', Mars: '#ff7b54', Jupiter: '#f2cf9c', Saturn: '#e9c86f',
  };
  const bodyColor = (b) => (b.kind === 'sun' ? '#ffd36b' : b.kind === 'moon' ? '#e8ecf5'
    : b.kind === 'planet' ? PLANET_COLORS[b.name] : '#ffffff');
  const bodyRadius = (b) => (b.kind === 'sun' ? 10 : b.kind === 'moon' ? 9
    : b.kind === 'planet' ? Math.max(3.5, Math.min(6.5, 4.2 - 0.55 * b.mag))
    : Math.max(1.6, Math.min(5, 3.2 - 0.8 * b.mag)));

  let hits = [];

  function drawSun(x, y, r) {
    const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3);
    g.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
    g.addColorStop(1, 'rgba(255, 200, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd36b';
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Angle (degrees, counterclockwise from "up") of the Moon's bright limb as the observer
  // sees it, with up meaning toward their zenith: the bright-limb position angle minus the
  // parallactic angle.
  function moonLimbAngle(moon, sun, sky) {
    const dRa = (sun.ra - moon.ra) * D2R, dm = moon.dec * D2R, ds = sun.dec * D2R;
    const chi = Math.atan2(Math.cos(ds) * Math.sin(dRa),
      Math.sin(ds) * Math.cos(dm) - Math.cos(ds) * Math.sin(dm) * Math.cos(dRa));
    const H = (sky.gmst + observer.lon - moon.ra) * D2R, phi = observer.lat * D2R;
    const q = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(dm) - Math.sin(dm) * Math.cos(H));
    return (chi - q) * R2D;
  }

  // The Moon as it looks from the observer: true illuminated fraction, bright limb turned
  // the way it appears relative to their horizon.
  function drawMoon(x, y, r, moon) {
    const theta = moon.limbAngle * D2R;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(-Math.cos(theta), -Math.sin(theta)));
    ctx.fillStyle = '#2a2f3d';
    ctx.strokeStyle = 'rgba(10, 12, 20, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Lit half faces +x; the terminator is a half-ellipse whose width follows the phase.
    const k = moon.illum, a = Math.abs(2 * k - 1) * r;
    ctx.fillStyle = '#eef1f8';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    if (k >= 0.5) ctx.ellipse(0, 0, a, r, 0, Math.PI / 2, Math.PI * 1.5, false);
    else ctx.ellipse(0, 0, a, r, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.fill();
    ctx.restore();
  }

  // The point directly opposite the Sun: the middle of the night side.
  function drawAntiSolar(sun) {
    const r = toRot(-sun.lat, sun.lon + 180);
    if (!globeFacing(...r)) return;
    const [x, y] = projectRot(...r);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  }

  // What matters is whether the observer's own sky is dark. Stars and planets stay faint
  // while the observer is in daylight, then those in view brighten together through
  // twilight, reaching full strength when the Sun is 12° down (nautical dusk) there.
  // Out of view they stay faint. The Sun and Moon are unaffected.
  const FAINT = 0.25, DARK_ALT = -12;
  function observerDarkness(sky) {
    if (!layers.night) return 1;
    const f = clamp01((SUNSET_ALT - sky.sun.altAz.alt) / (SUNSET_ALT - DARK_ALT));
    return f * f * (3 - 2 * f);
  }
  function bodyAlpha(b, dark) {
    const up = b.altAz.alt > 0;
    if (b.kind === 'sun' || b.kind === 'moon') return up ? 1 : 0.5;
    return up ? FAINT + (1 - FAINT) * dark : FAINT;
  }

  function drawBodies(sky) {
    hits = [];
    drawAntiSolar(sky.sun);
    const dark = observerDarkness(sky);
    // Draw faint things first so bright ones sit on top.
    const order = [...sky.bodies].sort((a, b) => b.mag - a.mag);
    for (const b of order) {
      const rp = toRot(b.lat, b.lon);
      if (!globeFacing(...rp)) continue;
      const [x, y] = projectRot(...rp), r = bodyRadius(b);
      ctx.globalAlpha = bodyAlpha(b, dark);

      if (b.kind === 'sun') drawSun(x, y, r);
      else if (b.kind === 'moon') drawMoon(x, y, r, b);
      else if (b.kind === 'planet') {
        ctx.fillStyle = bodyColor(b);
        ctx.strokeStyle = 'rgba(10, 12, 20, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = bodyColor(b);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(8, 10, 20, 0.7)';
        ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      if (layers.labels) {
        const bold = b.kind !== 'star';
        ctx.font = (bold ? '600 12px' : '11px') + ' system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lx = x + r + (b.kind === 'planet' ? 6 : 4);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(6, 9, 20, 0.85)';
        ctx.strokeText(b.name, lx, y);
        ctx.fillStyle = b.kind === 'star' ? 'rgba(235, 240, 255, 0.9)' : bodyColor(b);
        ctx.fillText(b.name, lx, y);
      }
      ctx.globalAlpha = 1;
      hits.push({ x, y, r: Math.max(r, 4) + 4, body: b });
    }
  }

  function drawObserver() {
    if (!globeFacing(0, 0)) return;
    const [x, y] = projectRot(0, 0);
    ctx.fillStyle = '#ff3b30';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // ---------- globe dressing ----------
  // A thin glow just outside the rim, and a gentle darkening toward it, so the disc reads
  // as a ball. Both are kept faint: brightness already carries day and night.
  function drawAtmosphere() {
    const cx = view.W / 2, cy = view.H / 2, R = view.scale;
    const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.06);
    g.addColorStop(0, 'rgba(126, 170, 255, 0.35)');
    g.addColorStop(1, 'rgba(126, 170, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.fill();
  }
  function drawLimbShade() {
    const cx = view.W / 2, cy = view.H / 2, R = view.scale;
    const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }

  // ---------- frame ----------
  let sky = null;

  function render() {
    const t = simTime();
    updateLand();
    sky = computeSky(new Date(t));
    for (const b of sky.bodies) b.altAz = altAz(observer.lat, observer.lon, b.lat, b.lon);
    sky.moon.limbAngle = moonLimbAngle(sky.moon, sky.sun, sky);
    // Tonight's times are the slow part; hold them until a drag ends.
    if (!drag) updateEvening(t);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.W, view.H);
    if (isGlobe()) drawAtmosphere();
    ctx.save();
    traceOutline();
    ctx.fillStyle = '#1d3550';
    ctx.fill();
    ctx.clip();
    drawLand();
    if (layers.night) drawNight(sky);
    if (layers.grid) drawGrid();
    if (layers.ecliptic) strokePath(sky.ecliptic, 'rgba(206, 150, 255, 0.85)', 1.6);
    if (layers.night) strokePath(horizonOf(sky.sun.lat, sky.sun.lon), 'rgba(244, 213, 141, 0.9)', 1.6, [], true);
    if (layers.trails) drawTrails(t, sky);
    // The haze goes over everything drawn so far, so the lines fade out past the horizon too.
    if (layers.visible) {
      drawHaze();
      // The observer's horizon is the pair of rotated meridians at ±90°.
      for (const m of [-90, 90]) {
        strokePath(range(-90, 90, 2).map((lat) => [m, lat]), 'rgba(126, 224, 255, 0.7)', 1.4, [], true);
      }
    }
    // Altitude 30° and 60° rings: the horizon is 0°, and 90° would be the observer's own spot.
    if (layers.altitude) {
      for (const alt of [30, 60]) strokePath(altitudeCircle(alt), 'rgba(126, 224, 255, 0.3)', 1, [], true);
    }
    if (isGlobe()) drawLimbShade();
    ctx.restore();

    traceOutline();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(160, 180, 220, 0.5)';
    ctx.stroke();
    drawBodies(sky);
    drawObserver();
  }

  // ---------- formatting ----------
  const fmtLat = (lat) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const fmtLon = (lon) => { const l = norm180(lon); return `${Math.abs(l).toFixed(2)}°${l >= 0 ? 'E' : 'W'}`; };
  const fmtHours = (deg) => {
    const h = norm360(deg) / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${hh}h ${String(mm).padStart(2, '0')}m`;
  };
  const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const cardinal = (az) => CARDINALS[Math.round(az / 22.5) % 16];
  const pad = (n) => String(n).padStart(2, '0');

  function sunStatus(alt) {
    if (alt > SUNSET_ALT) return 'Daylight';
    if (alt > -6) return 'Civil twilight';
    if (alt > -12) return 'Nautical twilight';
    if (alt > -18) return 'Astronomical twilight';
    return 'Night';
  }

  function moonPhaseName(m) {
    if (m.illum < 0.03) return 'New moon';
    if (m.illum > 0.97) return 'Full moon';
    if (Math.abs(m.illum - 0.5) < 0.05) return m.waxing ? 'First quarter' : 'Last quarter';
    return (m.waxing ? 'Waxing ' : 'Waning ') + (m.illum < 0.5 ? 'crescent' : 'gibbous');
  }

  // ---------- side panel and scrubbers ----------
  const tbody = document.querySelector('#bodies tbody');
  const obsEl = document.getElementById('observer');
  const utcEl = document.getElementById('utc');
  const localEl = document.getElementById('local');
  const dtInput = document.getElementById('datetime');
  const nowBtn = document.getElementById('now');
  const speedSel = document.getElementById('speed');
  const tonightEl = document.getElementById('tonight');
  const todBands = document.getElementById('todBands'), todMarks = document.getElementById('todMarks');
  const doySlider = document.getElementById('doy'), doyOut = document.getElementById('doyOut');
  const todSlider = document.getElementById('tod'), todOut = document.getElementById('todOut');

  // Day-of-year helpers work on observer dates (UTC getters; see observerDate).
  const dayOfYear = (d) => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
  const daysInYear = (y) => (new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1 ? 366 : 365);
  const fmtDay = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Equinoxes and solstices: when the Sun's ecliptic longitude reaches 0°, 90°, 180°, 270°,
  // found by bisection within a few days of the usual dates.
  const SEASONS = [
    { lon: 0, month: 2, day: 20, name: 'Equinox' },
    { lon: 90, month: 5, day: 21, name: 'Solstice' },
    { lon: 180, month: 8, day: 22, name: 'Equinox' },
    { lon: 270, month: 11, day: 21, name: 'Solstice' },
  ];
  function seasonMoments(year) {
    return SEASONS.map((s) => {
      let lo = Date.UTC(year, s.month, s.day - 4), hi = Date.UTC(year, s.month, s.day + 4);
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (norm180(Astro.sunLongitude(new Date(mid)) - s.lon) < 0) lo = mid; else hi = mid;
      }
      return { ...s, t: (lo + hi) / 2 };
    });
  }

  let doyMarksKey = '';
  function updateDoyMarks(year) {
    // Dates are the observer's, so the markers can shift a day as the observer moves.
    const key = year + '|' + Math.round(observer.lon);
    if (key === doyMarksKey) return;
    doyMarksKey = key;
    const n = daysInYear(year);
    document.getElementById('doyMarks').innerHTML = seasonMoments(year).map((s) => {
      const d = observerDate(s.t), f = (dayOfYear(d) - 1) / (n - 1);
      const label = `${s.name} ${fmtDay(d)}`;
      const align = f < 0.08 ? 'transform:none' : f > 0.92 ? 'transform:translateX(-100%)' : '';
      return `<div class="slider-mark season" style="left:calc(8px + ${f} * (100% - 16px))"`
        + ` title="${label}, ${fmtClock(s.t)}"><span style="${align}">${label}</span></div>`;
    }).join('');
  }

  // The time-of-day slider runs from the observer's solar noon to the next (minutes since
  // that noon), so solar midnight is always at the middle. Sunset,
  // full dark and solar midnight marked and the evening between them shaded.
  const TOD_MAX = 1439;
  let todMarksKey = '';
  function updateTodMarks(e, noon) {
    const key = [noon, e.start, e.dark, e.end].join('|');
    if (key === todMarksKey) return;
    todMarksKey = key;
    const minuteOf = (t) => Math.max(0, Math.min(TOD_MAX, Math.round((t - noon) / 60e3)));
    const pos = (m) => `calc(8px + ${m / TOD_MAX} * (100% - 16px))`;
    const mark = (cls, t, text) => {
      const m = minuteOf(t), f = m / TOD_MAX;
      const align = f < 0.08 ? 'transform:none' : f > 0.92 ? 'transform:translateX(-100%)' : '';
      return `<div class="slider-mark ${cls}" style="left:${pos(m)}" title="${text}">`
        + (cls === 'dark' ? '' : `<span style="${align}">${text}</span>`) + '</div>';
    };
    const s = minuteOf(e.start), m = minuteOf(e.end);
    todBands.innerHTML = `<div class="tod-band" style="left:${pos(s)};width:calc(${(m - s) / TOD_MAX} * (100% - 16px))"></div>`;
    todMarks.innerHTML = (e.sunset ? mark('sunset', e.sunset, `Sunset ${fmtClock(e.sunset)}`) : '')
      + (e.dark ? mark('dark', e.dark, `Dark ${fmtClock(e.dark)}`) : '')
      + mark('midnight', e.end, `Midnight ${fmtClock(e.end)}`);
  }

  function updatePanels() {
    if (!sky) return;
    const d = sky.date;
    utcEl.textContent = d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    localEl.textContent = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) + ' (your time)';
    if (document.activeElement !== dtInput) {
      dtInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    nowBtn.classList.toggle('live', clock.speed === 1 && Math.abs(simTime() - Date.now()) < 2000);

    // Both scrubbers work in observing nights: the date is the observer's date at the
    // noon that starts the night.
    const noon = nightNoon(d.getTime()), night = observerDate(noon);
    doySlider.max = String(daysInYear(night.getUTCFullYear()));
    updateDoyMarks(night.getUTCFullYear());
    if (document.activeElement !== doySlider) doySlider.value = String(dayOfYear(night));
    if (document.activeElement !== todSlider) todSlider.value = String(Math.round((d.getTime() - noon) / 60e3));
    doyOut.textContent = `Night of ${fmtDay(night)}`;
    todOut.textContent = fmtClock(d);

    if (evening) {
      const e = evening;
      tonightEl.innerHTML = `
        <div><span class="dim">Sunset</span> ${e.sunset ? fmtClock(e.sunset) : '—'}
          &nbsp;<span class="dim">Dark</span> ${e.dark ? fmtClock(e.dark) : '—'}
          &nbsp;<span class="dim">Midnight</span> ${fmtClock(e.end)}</div>
        ${e.note ? `<div class="dim">${e.note}</div>` : ''}
        <div class="dim small">Times are on your clock. "Midnight" is solar midnight at the observer.</div>`;
      updateTodMarks(e, noon);
    }

    const sunA = sky.sun.altAz.alt, m = sky.moon;
    const lst = norm360(sky.gmst + observer.lon);
    updateLocationBar();
    obsEl.innerHTML = `
      <div><span class="dim">Local sidereal time</span> ${fmtHours(lst)}</div>
      <div><span class="dim">Sun</span> ${sunA.toFixed(1)}° · ${sunStatus(sunA)}</div>
      <div><span class="dim">Moon</span> ${moonPhaseName(m)}, ${Math.round(m.illum * 100)}% lit</div>`;

    const rank = { sun: 0, moon: 1, planet: 2, star: 3 };
    const upTonight = (b) => (evening && b.kind === 'star' && upIntervals(evening.trails.get(b.name)).length ? 0 : 1);
    const rows = [...sky.bodies].sort((a, b) => (rank[a.kind] - rank[b.kind])
      || (a.kind === 'star' ? (upTonight(a) - upTonight(b)) || (a.mag - b.mag) : 0));
    tbody.innerHTML = rows.map((b) => {
      const { alt, az } = b.altAz;
      return `<tr class="${alt > 0 ? '' : 'below'}">
        <td><span class="dot" style="background:${bodyColor(b)}"></span>${b.name}</td>
        <td>${alt.toFixed(0)}°</td>
        <td>${cardinal(az)}</td>
        <td class="tonight-col">${tonightSummary(b)}</td></tr>`;
    }).join('');
  }

  // ---------- tooltip ----------
  const tip = document.getElementById('tooltip');

  function showTooltip(hit, mx, my) {
    const b = hit.body, { alt, az } = b.altAz;
    const lines = [
      `<b>${b.name}</b> <span class="dim">${b.kind}</span>`,
      `<span class="dim">RA</span> ${fmtHours(b.ra)} &nbsp;<span class="dim">Dec</span> ${b.dec.toFixed(2)}°`,
      `<span class="dim">Overhead at</span> ${fmtLat(b.lat)}, ${fmtLon(b.lon)}`,
      `<span class="dim">From observer</span> alt ${alt.toFixed(1)}°, az ${Math.round(az)}° ${cardinal(az)}${alt > 0 ? '' : ' (below horizon)'}`,
    ];
    if (b.kind === 'moon') lines.push(`<span class="dim">Phase</span> ${moonPhaseName(b)}, ${Math.round(b.illum * 100)}% lit`);
    if (evening && b.kind !== 'sun') lines.push(`<span class="dim">Tonight</span> ${tonightSummary(b)}`);
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = mx + 14, top = my + 14;
    if (left + tw > view.W) left = mx - tw - 14;
    if (top + th > view.H) top = my - th - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, top) + 'px';
  }

  function hitAt(mx, my) {
    let best = null, bestD = Infinity;
    for (const h of hits) {
      const d = Math.hypot(h.x - mx, h.y - my);
      if (d < h.r && d < bestD) { best = h; bestD = d; }
    }
    return best;
  }

  // ---------- interaction ----------
  function eventPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }

  function setObserver(lat, lon, persist = true) {
    observer.lat = Math.max(-89.9, Math.min(89.9, lat));
    observer.lon = norm180(lon);
    if (persist) store.set('observer', observer);
    // The globe swings round to face the observer's new spot.
    cam.lat = observer.lat; cam.lon = observer.lon;
    updateRotation();
    dirty = true;
  }

  // Rotated [lon, lat] of Earth unit vector v for an observer at (lat, lon).
  function rotatedFor(lat, lon, [x, y, z]) {
    const cl = Math.cos(lon * D2R), sl = Math.sin(lon * D2R), cp = Math.cos(lat * D2R), sp = Math.sin(lat * D2R);
    const x1 = x * cl + y * sl, y1 = -x * sl + y * cl;
    const x2 = x1 * cp + z * sp, z2 = -x1 * sp + z * cp;
    return [Math.atan2(y1, x2) * R2D, Math.asin(Math.max(-1, Math.min(1, z2))) * R2D];
  }

  // Observer position that puts Earth vector v at rotated coordinates `target`, found by
  // Newton's method from the current observer. North stays up, so some targets can't be
  // reached exactly; steps are capped and only kept while they reduce the miss.
  function solveObserver(v, target) {
    let lat = observer.lat, lon = observer.lon;
    const miss = (la, lo) => {
      const r = rotatedFor(la, lo, v);
      return [norm180(r[0] - target[0]), r[1] - target[1]];
    };
    let f = miss(lat, lon);
    for (let i = 0; i < 6 && Math.hypot(...f) > 1e-3; i++) {
      const h = 1e-3, fa = miss(lat + h, lon), fo = miss(lat, lon + h);
      const j = [[(fa[0] - f[0]) / h, (fo[0] - f[0]) / h], [(fa[1] - f[1]) / h, (fo[1] - f[1]) / h]];
      const det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
      if (Math.abs(det) < 1e-9) break;
      let dLat = -(j[1][1] * f[0] - j[0][1] * f[1]) / det, dLon = -(-j[1][0] * f[0] + j[0][0] * f[1]) / det;
      const step = Math.hypot(dLat, dLon);
      if (step > 20) { dLat *= 20 / step; dLon *= 20 / step; }
      const nLat = Math.max(-89.9, Math.min(89.9, lat + dLat)), nLon = norm180(lon + dLon);
      const nf = miss(nLat, nLon);
      if (Math.hypot(...nf) >= Math.hypot(...f)) break;
      lat = nLat; lon = nLon; f = nf;
    }
    return { lat, lon };
  }

  // Dragging grabs the globe and slides it under the fixed center: the observer moves so
  // the grabbed spot stays under the pointer. On the 3-D globe it spins the globe instead,
  // leaving the observer where they are.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const { mx, my } = eventPos(e);
    const p = unprojectRot(mx, my);
    if (!p) return;
    const g = fromRot(p[1], p[0]);
    drag = { v: toVec(g.lat, g.lon), mx, my, cam: { ...cam } };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    tip.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    const { mx, my } = eventPos(e);
    if (drag && isGlobe()) {
      cam.lat = Math.max(-90, Math.min(90, drag.cam.lat + (my - drag.my) / view.scale * R2D));
      cam.lon = norm180(drag.cam.lon - (mx - drag.mx) / view.scale * R2D);
      updateGlobe();
      dirty = true;
      return;
    }
    if (drag) {
      const p = unprojectRot(mx, my);
      if (!p) return;
      const o = solveObserver(drag.v, p);
      setObserver(o.lat, o.lon, false);
      return;
    }
    const h = hitAt(mx, my);
    if (h) showTooltip(h, mx, my); else tip.hidden = true;
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('dragging');
    store.set('observer', observer);
    dirty = true;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) tip.hidden = true; });

  // Double-click jumps straight to a spot.
  canvas.addEventListener('dblclick', (e) => {
    const { mx, my } = eventPos(e);
    const p = unprojectRot(mx, my);
    if (!p) return;
    const g = fromRot(p[1], p[0]);
    setObserver(g.lat, g.lon);
  });

  document.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => setClock(simTime() + Number(btn.dataset.step) * 1000));
  });
  speedSel.addEventListener('change', () => setClock(simTime(), Number(speedSel.value)));
  nowBtn.addEventListener('click', () => setClock(Date.now(), 1));
  dtInput.addEventListener('change', () => {
    const t = new Date(dtInput.value).getTime();
    if (!Number.isNaN(t)) setClock(t);
  });

  // Scrubbing pauses the clock so the chosen moment holds still.
  // Changing the night keeps the same offset from its noon; the time slider is minutes since noon.
  doySlider.addEventListener('input', () => {
    const t = simTime(), noon = nightNoon(t), year = observerDate(noon).getUTCFullYear();
    // Mean noon at the observer on the chosen day, snapped to that day's true solar noon.
    const meanNoon = Date.UTC(year, 0, Number(doySlider.value), 12) - observer.lon * 4 * 60e3;
    const newNoon = solarMidnightAfter(meanNoon - 6 * HOUR) - 12 * HOUR;
    setClock(newNoon + (t - noon), 0);
  });
  todSlider.addEventListener('input', () => {
    setClock(nightNoon(simTime()) + Number(todSlider.value) * 60e3, 0);
  });
  document.getElementById('goSunset').addEventListener('click', () => {
    if (evening) setClock(evening.start, 0);
  });

  document.querySelectorAll('[data-layer]').forEach((input) => {
    const key = input.dataset.layer;
    input.checked = !!layers[key];
    input.addEventListener('change', () => {
      layers[key] = input.checked;
      store.set('layers', layers);
      dirty = true;
    });
  });

  const projSel = document.getElementById('projection');
  projSel.value = projection;
  const hintEl = document.querySelector('.hint');
  function updateHint() {
    hintEl.textContent = isGlobe()
      ? 'The globe starts facing the observer (red dot), with the sky they can see on the near side. '
        + 'Drag to spin it and look round the back; double-click a spot to move the observer there.'
      : 'The map is centered on the observer (red dot). Drag the globe to move them, or '
        + 'double-click a spot to jump there. The middle half of the map is the sky they can see.';
  }
  projSel.addEventListener('change', () => {
    projection = projSel.value;
    store.set('projection', projection);
    cam.lat = observer.lat; cam.lon = observer.lon;
    updateGlobe();
    updateHint();
    resize();
    dirty = true;
  });
  updateHint();

  // "Here" is your own location: remembered from the last successful geolocation, and
  // refreshed each time the button is pressed.
  let home = store.get('home', null), locating = false, locateFailed = false;
  const hereBtn = document.getElementById('here');

  function locate() {
    if (!navigator.geolocation) return;
    locating = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      locating = false;
      home = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      store.set('home', home);
      setObserver(home.lat, home.lon);
    }, () => { locating = false; locateFailed = true; });
  }

  hereBtn.addEventListener('click', () => {
    if (home) setObserver(home.lat, home.lon);
    locate();
  });

  document.querySelectorAll('[data-move]').forEach((btn) => {
    const [axis, step] = btn.dataset.move.split(':');
    btn.addEventListener('click', () => {
      if (axis === 'lat') setObserver(observer.lat + Number(step), observer.lon);
      else setObserver(observer.lat, observer.lon + Number(step));
    });
  });

  const latIn = document.getElementById('latIn'), lonIn = document.getElementById('lonIn');
  for (const input of [latIn, lonIn]) {
    input.addEventListener('change', () => {
      const lat = parseFloat(latIn.value), lon = parseFloat(lonIn.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) setObserver(lat, lon);
    });
  }

  // City picker: type-ahead from CITIES; accents and case are ignored, and a unique
  // prefix is enough ("bost" finds Boston).
  const cityIn = document.getElementById('cityIn');
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  document.getElementById('cityList').innerHTML = CITIES.map(([name]) => `<option value="${name}">`).join('');

  function findCity(text) {
    const q = fold(text);
    if (!q) return null;
    return CITIES.find(([name]) => fold(name) === q)
      || CITIES.find(([name]) => fold(name).startsWith(q))
      || CITIES.find(([name]) => fold(name).includes(q)) || null;
  }
  cityIn.addEventListener('change', () => {
    const c = findCity(cityIn.value);
    cityIn.classList.toggle('invalid', !c && cityIn.value.trim() !== '');
    if (!c) return;
    cityIn.value = c[0];
    setObserver(c[1], c[2]);
  });
  cityIn.addEventListener('input', () => cityIn.classList.remove('invalid'));

  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(norm180(a.lon - b.lon)) < 0.01;
  const cityAtObserver = () => CITIES.find(([, lat, lon]) => near({ lat, lon }, observer));

  function updateLocationBar() {
    const atHome = home && near(home, observer), city = cityAtObserver();
    hereBtn.classList.toggle('live', !!atHome);
    document.getElementById('coords').textContent = `${fmtLat(observer.lat)}, ${fmtLon(observer.lon)}`;
    document.getElementById('place').textContent = locating ? 'Finding your location…'
      : atHome ? 'Your location' : city ? city[0]
      : locateFailed && !home ? 'Your location is unavailable' : 'Observer location';
    if (document.activeElement !== latIn) latIn.value = observer.lat.toFixed(2);
    if (document.activeElement !== lonIn) lonIn.value = observer.lon.toFixed(2);
    if (document.activeElement !== cityIn && !cityIn.classList.contains('invalid')) cityIn.value = city ? city[0] : '';
  }

  new ResizeObserver(resize).observe(canvas.parentElement);
  window.addEventListener('resize', resize);

  // ---------- loop ----------
  let lastDraw = 0, lastPanel = 0;
  function tick(t) {
    // Real time moves the sky only 15° per hour, so one redraw a second is plenty.
    const moving = clock.speed !== 0 && (Math.abs(clock.speed) > 1 || t - lastDraw > 1000);
    if (view.W > 0 && (dirty || moving)) {
      render();
      dirty = false;
      lastDraw = t;
    }
    if (t - lastPanel > 250) { updatePanels(); lastPanel = t; }
    requestAnimationFrame(tick);
  }

  updateRotation();
  resize();
  if (!savedObserver) locate();
  requestAnimationFrame(tick);
})();
