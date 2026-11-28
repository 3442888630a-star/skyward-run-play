// 2D Canvas AAA smoked-glass + warm-amber HUD and interactive UI overlays (Title, Pause, Help, End).
// Redesigned per blueprint language: round corner speed/altitude dials, circular terrain radar,
// ring-progress checklist, in-world target diamond, cockpit pitch ladder, and clean smoked glass.

import { FIELD, FONT, MISSION_RINGS, MODE_FREE, MODE_MISSION, MONO_FONT, PALETTE, PLANE, RUNWAY, WORLD } from './config.js';
import { clamp, dot3, normalize3, wrapAngle } from './math.js';
import { terrainHeight, waterLevelAt } from './terrain.js';
import { OUTCOME_FUEL, OUTCOME_WIN } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_HELP = 'help';
export const SCREEN_OVER = 'over';

// Unified warm-amber + smoked-glass UI theme (no neon green anywhere)
const UI = {
  amber: '#f5b642',
  amberBright: '#ffd778',
  amberDeep: '#d47f24',
  amberSoft: 'rgba(245, 182, 66, 0.24)',
  amberBorder: 'rgba(245, 182, 66, 0.48)',
  glassTop: 'rgba(16, 19, 25, 0.74)',
  glassBot: 'rgba(9, 11, 16, 0.86)',
  glassBorder: 'rgba(255, 240, 210, 0.16)',
  text: '#f5f1e8',
  textSoft: '#d5cfc4',
  muted: '#9ba3b0',
  danger: '#ef4d44',
  caution: '#f28c38',
};

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatDist(distM) {
  return distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
}

/** Pre-bake a crisp muted terrain + water radar map texture once at HUD startup (zero per-frame terrain loop). */
function buildRadarTerrainMap() {
  const size = 256;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  const img = octx.createImageData(size, size);
  const data = img.data;

  for (let py = 0; py < size; py += 1) {
    const wz = ((py + 0.5) / size * 2 - 1) * WORLD.half;
    for (let px = 0; px < size; px += 1) {
      const wx = ((px + 0.5) / size * 2 - 1) * WORLD.half;
      const h = terrainHeight(wx, wz);
      const wl = waterLevelAt(wx, wz);
      const idx = (py * size + px) * 4;
      let r;
      let g;
      let b;
      if (h < wl - 0.15) {
        // River, Mirror Lake & Alpine Tarns
        r = 34;
        g = 62;
        b = 84;
      } else {
        const contour = Math.abs(((h * 0.04) % 1) - 0.5) < 0.06 ? 1.12 : 1.0;
        if (h < 55) {
          r = 40;
          g = 46;
          b = 40;
        } else if (h < 220) {
          r = 58;
          g = 53;
          b = 44;
        } else if (h < 420) {
          r = 76;
          g = 68;
          b = 58;
        } else {
          r = 104;
          g = 104;
          b = 110;
        }
        r = Math.min(255, Math.round(r * contour));
        g = Math.min(255, Math.round(g * contour));
        b = Math.min(255, Math.round(b * contour));
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  // Subtle Runway 36 vector tick on the map
  const rx = ((RUNWAY.x / WORLD.half) * 0.5 + 0.5) * size;
  const rz0 = ((RUNWAY.zEnd / WORLD.half) * 0.5 + 0.5) * size;
  const rz1 = ((RUNWAY.zStart / WORLD.half) * 0.5 + 0.5) * size;
  octx.strokeStyle = 'rgba(245, 182, 66, 0.85)';
  octx.lineWidth = 2.2;
  octx.beginPath();
  octx.moveTo(rx, rz0);
  octx.lineTo(rx, rz1);
  octx.stroke();

  return off;
}

export function createHudRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const buttons = [];
  const radarMapCanvas = buildRadarTerrainMap();

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * ratio));
    const h = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    view.scale = Math.min(w / FIELD.width, h / FIELD.height);
    view.x = (w - FIELD.width * view.scale) / 2;
    view.y = (h - FIELD.height * view.scale) / 2;
  }

  function addButton(id, x, y, w, h) {
    buttons.push({ id, x, y, w, h });
  }

  function hitTest(lx, ly) {
    for (let i = buttons.length - 1; i >= 0; i -= 1) {
      const b = buttons[i];
      if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
        return b.id;
      }
    }
    return null;
  }

  function drawPanelBox(x, y, w, h, r = 8, fill = null, stroke = UI.glassBorder, shadow = true) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
    }
    roundRectPath(ctx, x, y, w, h, r);
    if (!fill) {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, UI.glassTop);
      grad.addColorStop(1, UI.glassBot);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = fill;
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.lineWidth = 1.15;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // Fine top hairline inner glass reflection
    if (w > 24 && h > 16) {
      const inset = 1.1;
      const rad = Math.min(Math.max(2, r - inset), (w - inset * 2) * 0.5, (h - inset * 2) * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset + rad);
      ctx.quadraticCurveTo(x + inset, y + inset, x + inset + rad, y + inset);
      ctx.lineTo(x + w - inset - rad, y + inset);
      ctx.quadraticCurveTo(x + w - inset, y + inset, x + w - inset, y + inset + rad);
      ctx.strokeStyle = 'rgba(255, 240, 210, 0.12)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAmberBrackets(x, y, w, h, len = 8, color = UI.amber) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Top-left & Top-right subtle tactical corner brackets
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.stroke();
    ctx.restore();
  }

  function drawButton(id, x, y, w, h, label, active, hoverId, accent = UI.amber, primary = false) {
    addButton(id, x, y, w, h);
    const hovered = hoverId === id;
    ctx.save();
    if (primary) {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (hovered) {
        grad.addColorStop(0, '#ffe094');
        grad.addColorStop(1, '#e89532');
      } else {
        grad.addColorStop(0, '#f7c158');
        grad.addColorStop(1, '#d67d22');
      }
      ctx.shadowColor = hovered ? 'rgba(245, 182, 66, 0.48)' : 'rgba(245, 182, 66, 0.25)';
      ctx.shadowBlur = hovered ? 16 : 10;
      ctx.shadowOffsetY = 3;
      roundRectPath(ctx, x, y, w, h, 7);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = 'rgba(255, 246, 224, 0.78)';
      ctx.stroke();

      ctx.font = `800 14.5px ${FONT}`;
      ctx.fillStyle = '#141310';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 0.5);
    } else {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (active) {
        grad.addColorStop(0, 'rgba(245, 182, 66, 0.28)');
        grad.addColorStop(1, 'rgba(210, 128, 36, 0.16)');
      } else if (hovered) {
        grad.addColorStop(0, 'rgba(245, 182, 66, 0.16)');
        grad.addColorStop(1, 'rgba(25, 28, 36, 0.80)');
      } else {
        grad.addColorStop(0, 'rgba(16, 19, 26, 0.74)');
        grad.addColorStop(1, 'rgba(10, 12, 17, 0.84)');
      }
      const stroke = active || hovered ? accent : 'rgba(255, 238, 206, 0.18)';
      drawPanelBox(x, y, w, h, 6, grad, stroke, false);
      ctx.font = `700 12px ${MONO_FONT}`;
      ctx.fillStyle = active ? accent : UI.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 0.5);
    }
    ctx.restore();
  }

  function drawCompassStrip(state, targetPos) {
    const cx = FIELD.width * 0.5;
    const x = cx - 210;
    const y = 14;
    const w = 420;
    const h = 36;
    drawPanelBox(x, y, w, h, 7, 'rgba(12, 15, 20, 0.68)', 'rgba(255, 240, 210, 0.14)');

    const headingDeg = ((state.plane.heading * 180) / Math.PI) % 360;
    const pxPerDeg = 3.2;

    ctx.save();
    roundRectPath(ctx, x + 6, y + 2, w - 12, h - 4, 6);
    ctx.clip();

    const labels = new Map([
      [0, 'N'],
      [30, '03'],
      [45, 'NE'],
      [60, '06'],
      [90, 'E'],
      [120, '12'],
      [135, 'SE'],
      [150, '15'],
      [180, 'S'],
      [210, '21'],
      [225, 'SW'],
      [240, '24'],
      [270, 'W'],
      [300, '30'],
      [315, 'NW'],
      [330, '33'],
    ]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 5) {
      let diff = deg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const tx = cx + diff * pxPerDeg;
      if (tx < x - 20 || tx > x + w + 20) continue;

      const hasLabel = labels.has(deg);
      const cardinal = deg % 90 === 0;
      const major = deg % 15 === 0;
      const edgeFade = clamp(1 - Math.max(0, Math.abs(tx - cx) - w * 0.36) / (w * 0.14), 0.08, 1);
      ctx.globalAlpha = edgeFade;

      ctx.strokeStyle = cardinal ? UI.amber : major ? 'rgba(245, 241, 232, 0.55)' : 'rgba(245, 241, 232, 0.25)';
      ctx.lineWidth = cardinal ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, y + h - (major ? 7 : 5));
      ctx.lineTo(tx, y + h - 1);
      ctx.stroke();

      if (hasLabel) {
        ctx.font = `${cardinal ? 800 : 600} ${cardinal ? 13 : 11}px ${MONO_FONT}`;
        ctx.fillStyle = cardinal ? UI.amber : UI.text;
        ctx.fillText(labels.get(deg) || '', tx, y + 16);
      }
    }
    ctx.globalAlpha = 1;

    // Target bearing amber triangle inside compass strip
    if (targetPos) {
      const dx = targetPos.x - state.plane.pos.x;
      const dz = targetPos.z - state.plane.pos.z;
      const targetBrg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      let diff = targetBrg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const bx = clamp(cx + diff * pxPerDeg, x + 14, x + w - 14);
      ctx.fillStyle = UI.amberBright;
      ctx.beginPath();
      ctx.moveTo(bx, y + h - 1);
      ctx.lineTo(bx - 5, y + h - 9);
      ctx.lineTo(bx + 5, y + h - 9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Top center amber pointer + compact heading chip below
    ctx.fillStyle = UI.amber;
    ctx.beginPath();
    ctx.moveTo(cx, y + 3);
    ctx.lineTo(cx - 5, y - 4);
    ctx.lineTo(cx + 5, y - 4);
    ctx.closePath();
    ctx.fill();

    drawPanelBox(cx - 34, y + h + 4, 68, 22, 5, 'rgba(11, 13, 18, 0.86)', UI.amberBorder, false);
    const dispHdg = Math.round(headingDeg) || 360;
    ctx.font = `700 12.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${String(dispHdg).padStart(3, '0')}°`, cx, y + h + 15.5);
  }

  function drawMissionPanel(state) {
    const x = 18;
    const y = 14;
    const w = 312;
    const isMission = state.mode === MODE_MISSION;
    const h = isMission ? 116 : 92;
    drawPanelBox(x, y, w, h, 8, null, 'rgba(245, 182, 66, 0.28)');
    drawAmberBrackets(x, y, w, h, 8, UI.amber);

    // Header bar with diamond marker + title + timer + combo
    const dxIcon = x + 20;
    const dyIcon = y + 20;
    ctx.save();
    ctx.strokeStyle = UI.amber;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(dxIcon, dyIcon - 7);
    ctx.lineTo(dxIcon + 7, dyIcon);
    ctx.lineTo(dxIcon, dyIcon + 7);
    ctx.lineTo(dxIcon - 7, dyIcon);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = UI.amber;
    ctx.beginPath();
    ctx.moveTo(dxIcon, dyIcon - 3);
    ctx.lineTo(dxIcon + 3, dyIcon);
    ctx.lineTo(dxIcon, dyIcon + 3);
    ctx.lineTo(dxIcon - 3, dyIcon);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 12px ${MONO_FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.fillText(isMission ? 'MAIN MISSION' : 'FREE FLIGHT', x + 34, y + 20);

    ctx.textAlign = 'right';
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = UI.textSoft;
    const mult = state.comboMult || 1;
    const streak = state.ringCombo || 0;
    if (isMission) {
      const badgeText = streak > 0 ? `×${mult} (${streak})  •  ${state.ringScore} PTS` : `${state.ringScore} PTS`;
      ctx.fillStyle = mult >= 2 ? UI.amberBright : UI.textSoft;
      ctx.fillText(badgeText, x + w - 14, y + 20);
    } else {
      ctx.fillText(formatClock(state.missionTime), x + w - 14, y + 20);
    }

    // Thin divider rule
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 34);
    ctx.lineTo(x + w - 12, y + 34);
    ctx.stroke();

    if (isMission) {
      const done = state.ringsPassed;

      // Connected 8-ring dots + x/8 numeric progress + timer (per ref-ui-hud-canyon)
      const dotY = y + 51;
      const dotSpacing = 22;
      const dotStartX = x + 22;
      for (let i = 0; i < MISSION_RINGS.length; i += 1) {
        const px = dotStartX + i * dotSpacing;
        if (i > 0) {
          ctx.strokeStyle = i <= done ? 'rgba(245, 182, 66, 0.65)' : 'rgba(255, 255, 255, 0.18)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(px - dotSpacing + 6, dotY);
          ctx.lineTo(px - 6, dotY);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(px, dotY, 5.5, 0, Math.PI * 2);
        if (i < done) {
          ctx.fillStyle = UI.amber;
          ctx.fill();
          ctx.strokeStyle = UI.amberBright;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (i === done) {
          ctx.fillStyle = 'rgba(245, 182, 66, 0.22)';
          ctx.fill();
          ctx.strokeStyle = UI.amberBright;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, dotY, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = UI.amberBright;
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      ctx.textAlign = 'right';
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = UI.text;
      ctx.fillText(`${done} / ${MISSION_RINGS.length}`, x + w - 14, dotY + 0.5);

      // Checklist row 1: active ring objective (or all rings done)
      const r1Y = y + 76;
      const r2Y = y + 98;
      ctx.textAlign = 'left';
      if (done < MISSION_RINGS.length) {
        const ring = MISSION_RINGS[done];
        const distM = Math.hypot(ring.x - state.plane.pos.x, ring.z - state.plane.pos.z);
        // Active glowing bullseye dot
        ctx.beginPath();
        ctx.arc(x + 20, r1Y, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = UI.amber;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 20, r1Y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = UI.amberBright;
        ctx.fill();

        ctx.font = `600 12.5px ${FONT}`;
        ctx.fillStyle = UI.text;
        ctx.fillText(`Ring ${done + 1}: ${ring.label}`, x + 34, r1Y);

        ctx.textAlign = 'right';
        ctx.font = `700 12px ${MONO_FONT}`;
        ctx.fillStyle = UI.amber;
        ctx.fillText(formatDist(distM), x + w - 14, r1Y);
      } else {
        ctx.fillStyle = UI.amber;
        ctx.font = `700 12px ${MONO_FONT}`;
        ctx.fillText('✓', x + 16, r1Y);
        ctx.font = `600 12.5px ${FONT}`;
        ctx.fillStyle = UI.textSoft;
        ctx.fillText('All 8 Target Rings Cleared', x + 34, r1Y);
        ctx.textAlign = 'right';
        ctx.font = `700 11.5px ${MONO_FONT}`;
        ctx.fillStyle = UI.amber;
        ctx.fillText(formatClock(state.missionTime), x + w - 14, r1Y);
      }

      // Checklist row 2: Runway 36 Landing
      const rwyDist = Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z);
      const rwyActive = done >= MISSION_RINGS.length;
      ctx.textAlign = 'left';
      ctx.beginPath();
      ctx.arc(x + 20, r2Y, 5.2, 0, Math.PI * 2);
      ctx.strokeStyle = rwyActive ? UI.amberBright : 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = rwyActive ? 1.6 : 1.1;
      ctx.stroke();
      if (rwyActive) {
        ctx.beginPath();
        ctx.arc(x + 20, r2Y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = UI.amberBright;
        ctx.fill();
      }
      ctx.font = `${rwyActive ? 700 : 400} 12px ${FONT}`;
      ctx.fillStyle = rwyActive ? UI.amberBright : UI.muted;
      ctx.fillText('Land on Runway 36', x + 34, r2Y);
      ctx.textAlign = 'right';
      ctx.font = `700 11.5px ${MONO_FONT}`;
      ctx.fillStyle = rwyActive ? UI.amber : UI.muted;
      ctx.fillText(rwyActive ? formatDist(rwyDist) : formatClock(state.missionTime), x + w - 14, r2Y);
    } else {
      const dist = Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z);
      ctx.textAlign = 'left';
      ctx.font = `600 12.5px ${FONT}`;
      ctx.fillStyle = UI.text;
      ctx.fillText('Runway 36 Threshold', x + 18, y + 54);
      ctx.textAlign = 'right';
      ctx.font = `700 12px ${MONO_FONT}`;
      ctx.fillStyle = UI.amber;
      ctx.fillText(formatDist(dist), x + w - 14, y + 54);
      ctx.textAlign = 'left';
      ctx.font = `400 11.5px ${FONT}`;
      ctx.fillStyle = UI.muted;
      ctx.fillText('Open exploration • Unlimited fuel', x + 18, y + 75);
    }
  }

  function drawCircularRadar(state, targetPos) {
    const cx = FIELD.width - 78;
    const cy = 78;
    const r = 60;
    const p = state.plane;
    const radarRange = 2800; // meters visible per radar radius

    ctx.save();
    // Smoked circular radar backing & shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.52)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 14, 20, 0.86)';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Clip to interior circular radar disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.clip();

    // Rotate heading-up terrain/water map around player position
    const scalePxPerM = r / radarRange;
    const mapSizeWorld = WORLD.size;
    const mapScale = mapSizeWorld * scalePxPerM;
    const pxPlayerOnMap = ((p.pos.x / WORLD.half) * 0.5 + 0.5) * mapScale;
    const pyPlayerOnMap = ((p.pos.z / WORLD.half) * 0.5 + 0.5) * mapScale;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-p.heading);
    ctx.globalAlpha = 0.88;
    ctx.drawImage(radarMapCanvas, -pxPlayerOnMap, -pyPlayerOnMap, mapScale, mapScale);
    ctx.restore();

    // Subtle smoked vignette & concentric range rings
    const radTint = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    radTint.addColorStop(0, 'rgba(10, 14, 20, 0.08)');
    radTint.addColorStop(1, 'rgba(8, 10, 14, 0.42)');
    ctx.fillStyle = radTint;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    ctx.strokeStyle = 'rgba(255, 240, 210, 0.14)';
    ctx.lineWidth = 1;
    for (const frac of [0.42, 0.78]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Target bearing vector + active target diamond inside radar (heading-up space)
    if (targetPos) {
      const dx = targetPos.x - p.pos.x;
      const dz = targetPos.z - p.pos.z;
      const ch = Math.cos(p.heading);
      const sh = Math.sin(p.heading);
      // Forward axis = (sh, -ch), Right axis = (ch, sh)
      const localRight = dx * ch + dz * sh;
      const localFwd = dx * sh - dz * ch;
      let rx = localRight * scalePxPerM;
      let ry = -localFwd * scalePxPerM;
      const distPx = Math.hypot(rx, ry);
      const maxDotR = r - 9;
      if (distPx > maxDotR) {
        rx = (rx / distPx) * maxDotR;
        ry = (ry / distPx) * maxDotR;
      }

      ctx.strokeStyle = 'rgba(245, 182, 66, 0.52)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + rx, cy + ry);
      ctx.stroke();
      ctx.setLineDash([]);

      // Target amber diamond beacon
      ctx.save();
      ctx.translate(cx + rx, cy + ry);
      ctx.fillStyle = UI.amberBright;
      ctx.strokeStyle = '#141310';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Center white aircraft marker
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 5.5, cy + 6);
    ctx.lineTo(cx, cy + 3.5);
    ctx.lineTo(cx - 5.5, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Outer circular bezel & N North rim indicator
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.28)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const northAng = -p.heading - Math.PI * 0.5;
    const nx = cx + Math.cos(northAng) * (r - 10);
    const ny = cy + Math.sin(northAng) * (r - 10);
    ctx.fillStyle = 'rgba(12, 15, 20, 0.85)';
    ctx.beginPath();
    ctx.arc(nx, ny, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `800 9px ${MONO_FONT}`;
    ctx.fillStyle = UI.amberBright;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
    ctx.restore();
  }

  function drawTopRightControls(hoverId, muted, mouseYoke) {
    // Sleek compact buttons positioned cleanly to the left of the circular radar
    const y = 16;
    drawButton('btn-help', FIELD.width - 512, y, 78, 30, '[H] HELP', false, hoverId, UI.amber);
    drawButton('btn-yoke', FIELD.width - 426, y, 86, 30, mouseYoke ? 'YOKE ON' : '[U] YOKE', mouseYoke, hoverId, UI.amber);
    drawButton('btn-mute', FIELD.width - 332, y, 78, 30, muted ? 'MUTED' : '[M] SFX', muted, hoverId, UI.amber);
    drawButton('btn-pause', FIELD.width - 246, y, 88, 30, '[P] PAUSE', false, hoverId, UI.amber);
  }

  /** Round corner speed/altitude dial in the ref-ui-hud-lakes style. */
  function drawRoundDial(cx, cy, r, title, bigNum, unitText, subText, frac, opts = {}) {
    const {
      startA = Math.PI * 0.75,
      spanA = Math.PI * 1.5,
      tickCount = 24,
      warnFrac = 0,
      warnColor = UI.danger,
      accentColor = UI.amber,
      subColor = UI.muted,
      labels = [],
    } = opts;

    ctx.save();
    // Smoked circular disc
    ctx.shadowColor = 'rgba(0, 0, 0, 0.50)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(cx, cy - r * 0.25, 6, cx, cy, r);
    bg.addColorStop(0, 'rgba(20, 24, 32, 0.78)');
    bg.addColorStop(1, 'rgba(9, 11, 16, 0.88)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Outer subtle metallic rim
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Base track arc
    const trackR = r - 7;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.beginPath();
    ctx.arc(cx, cy, trackR, startA, startA + spanA);
    ctx.stroke();

    // Optional low/stall warning zone arc
    if (warnFrac > 0.01) {
      ctx.strokeStyle = warnColor;
      ctx.beginPath();
      ctx.arc(cx, cy, trackR, startA, startA + spanA * clamp(warnFrac, 0, 1));
      ctx.stroke();
    }

    // Active warm amber swept arc
    const clFrac = clamp(frac, 0, 1);
    if (clFrac > 0.01) {
      ctx.strokeStyle = accentColor;
      ctx.beginPath();
      ctx.arc(cx, cy, trackR, startA, startA + spanA * clFrac);
      ctx.stroke();
    }

    // Radial tick marks & scale numbers
    ctx.lineCap = 'butt';
    for (let i = 0; i <= tickCount; i += 1) {
      const f = i / tickCount;
      const a = startA + f * spanA;
      const major = i % 4 === 0;
      const rIn = major ? r - 17 : r - 13;
      const rOut = r - 10;
      ctx.strokeStyle = major ? 'rgba(245, 241, 232, 0.72)' : 'rgba(245, 241, 232, 0.28)';
      ctx.lineWidth = major ? 1.5 : 0.9;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.stroke();
    }

    ctx.font = `700 9.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.textSoft;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [f, lbl] of labels) {
      const a = startA + f * spanA;
      ctx.fillText(lbl, cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
    }

    // Small title crown pill above center
    drawPanelBox(cx - 38, cy - r - 9, 76, 17, 4, 'rgba(12, 14, 20, 0.88)', 'rgba(245, 182, 66, 0.36)', false);
    ctx.font = `700 9.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, cx, cy - r - 0.5);

    // Big crisp center readout
    ctx.font = `800 28px ${MONO_FONT}`;
    ctx.fillStyle = UI.text;
    ctx.fillText(bigNum, cx, cy - 2);

    ctx.font = `700 10.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.muted;
    ctx.fillText(unitText, cx, cy + 19);

    if (subText) {
      ctx.font = `700 10px ${MONO_FONT}`;
      ctx.fillStyle = subColor;
      ctx.fillText(subText, cx, cy + r - 18);
    }
    ctx.restore();
  }

  function drawArtificialHorizon(plane) {
    // Ultra-compact bottom-hugging attitude badge beside Fuel (out of the central view)
    const cx = 348;
    const cy = FIELD.height - 48;
    const r = 28;
    const pxPerDeg = 0.86;

    ctx.save();
    ctx.globalAlpha = 0.58;
    drawPanelBox(cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2, r + 4, 'rgba(11, 14, 20, 0.84)', UI.amberBorder, false);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const pitchPx = clamp((plane.pitch * 180) / Math.PI, -45, 45) * pxPerDeg;
    ctx.translate(cx, cy);
    ctx.rotate(-plane.roll);

    ctx.fillStyle = '#295685';
    ctx.fillRect(-r * 2, -r * 3 + pitchPx, r * 4, r * 3);
    ctx.fillStyle = '#6c4223';
    ctx.fillRect(-r * 2, pitchPx, r * 4, r * 3);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.6, pitchPx);
    ctx.lineTo(r * 1.6, pitchPx);
    ctx.stroke();

    for (const deg of [-10, 10]) {
      const py = pitchPx - deg * pxPerDeg;
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-8, py);
      ctx.lineTo(-2, py);
      ctx.moveTo(2, py);
      ctx.lineTo(8, py);
      ctx.stroke();
    }
    ctx.restore();

    // Fixed amber waterline chevron
    ctx.strokeStyle = UI.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx - 4, cy);
    ctx.lineTo(cx, cy + 3.5);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.stroke();

    ctx.strokeStyle = UI.amberBorder;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLeftInstruments(state) {
    const p = state.plane;
    const kts = Math.round(p.speed * 1.94384);
    const thrPct = Math.round(p.throttle * 100);
    const fuelPct = Math.round(p.fuel);
    const maxK = 160;
    const stallFrac = (PLANE.stallSpeed * 1.94384) / maxK;

    // Bottom-left Round Airspeed Dial (primary ref 1 dial)
    drawRoundDial(
      92,
      FIELD.height - 92,
      68,
      'AIRSPEED',
      `${kts}`,
      'KNOTS',
      p.isStalling ? 'STALL' : 'STALL < 45',
      clamp(kts / maxK, 0, 1),
      {
        tickCount: 20,
        warnFrac: stallFrac,
        warnColor: UI.danger,
        accentColor: p.isStalling ? UI.danger : UI.amber,
        subColor: p.isStalling ? UI.danger : UI.muted,
        labels: [
          [0, '0'],
          [0.25, '40'],
          [0.5, '80'],
          [0.75, '120'],
          [1, '160'],
        ],
      },
    );

    // Compact Fuel + Throttle card tucked cleanly beside Airspeed
    const fx = 172;
    const fy = FIELD.height - 88;
    const fw = 136;
    const fh = 64;
    drawPanelBox(fx, fy, fw, fh, 8, null, 'rgba(255, 240, 210, 0.16)');
    drawAmberBrackets(fx, fy, fw, fh, 6, UI.amber);

    // Small fuel nozzle glyph
    ctx.save();
    ctx.strokeStyle = UI.amber;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(fx + 12, fy + 11, 8, 10);
    ctx.beginPath();
    ctx.moveTo(fx + 20, fy + 13);
    ctx.lineTo(fx + 23, fy + 15);
    ctx.lineTo(fx + 23, fy + 20);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 10.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.muted;
    ctx.fillText('FUEL', fx + 29, fy + 16);

    ctx.textAlign = 'right';
    ctx.font = `700 10.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.fillText(`THR ${thrPct}%`, fx + fw - 10, fy + 16);

    const isFree = state.mode === MODE_FREE;
    const fuelCol = isFree ? UI.amberBright : fuelPct <= 10 ? UI.danger : fuelPct <= 25 ? UI.caution : UI.amber;
    ctx.textAlign = 'left';
    ctx.font = `800 20px ${MONO_FONT}`;
    ctx.fillStyle = UI.text;
    ctx.fillText(isFree ? 'UNL' : `${fuelPct}%`, fx + 12, fy + 38);

    // Horizontal fuel bar along card bottom
    const bx = fx + 12;
    const by = fy + 51;
    const bw = fw - 24;
    roundRectPath(ctx, bx, by, bw, 5, 2.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();
    const fFrac = isFree ? 1 : clamp(p.fuel / 100, 0, 1);
    if (fFrac > 0.01) {
      roundRectPath(ctx, bx, by, Math.max(5, bw * fFrac), 5, 2.5);
      ctx.fillStyle = fuelCol;
      ctx.fill();
    }
  }

  function drawRightInstruments(state) {
    const p = state.plane;
    const altFt = Math.round(p.pos.y * 3.28084);
    const groundY = Math.max(waterLevelAt(p.pos.x, p.pos.z), terrainHeight(p.pos.x, p.pos.z));
    const aglFt = Math.max(0, Math.round((p.pos.y - groundY) * 3.28084));
    const fpm = Math.round(p.verticalSpeed * 196.85);

    // Bottom-right Round Altitude Dial (primary ref 1 dial)
    const maxScaleAlt = 4000;
    drawRoundDial(
      FIELD.width - 92,
      FIELD.height - 92,
      68,
      'ALTITUDE',
      `${altFt}`,
      'FT MSL',
      `AGL ${aglFt} FT`,
      clamp(altFt / maxScaleAlt, 0, 1),
      {
        tickCount: 20,
        accentColor: aglFt < 80 ? UI.caution : UI.amber,
        subColor: aglFt < 80 ? UI.caution : UI.amberBright,
        labels: [
          [0, '0'],
          [0.25, '1K'],
          [0.5, '2K'],
          [0.75, '3K'],
          [1, '4K'],
        ],
      },
    );

    // Vertical Speed (V/S) card tucked cleanly left of Altitude
    const vx = FIELD.width - 308;
    const vy = FIELD.height - 88;
    const vw = 136;
    const vh = 64;
    drawPanelBox(vx, vy, vw, vh, 8, null, 'rgba(255, 240, 210, 0.16)');
    drawAmberBrackets(vx, vy, vw, vh, 6, UI.amber);

    const sign = fpm >= 0 ? '+' : '';
    const safeSink = fpm <= -80 && fpm >= -600;
    const hardSink = fpm < -850;
    const vsiCol = hardSink ? UI.danger : safeSink ? UI.amberBright : UI.text;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 10.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.muted;
    ctx.fillText('V/S', vx + 12, vy + 15);

    // Tiny up/down trend triangle
    ctx.fillStyle = hardSink ? UI.danger : UI.amber;
    ctx.beginPath();
    if (fpm >= 0) {
      ctx.moveTo(vx + 40, vy + 11);
      ctx.lineTo(vx + 36, vy + 18);
      ctx.lineTo(vx + 44, vy + 18);
    } else {
      ctx.moveTo(vx + 40, vy + 19);
      ctx.lineTo(vx + 36, vy + 12);
      ctx.lineTo(vx + 44, vy + 12);
    }
    ctx.closePath();
    ctx.fill();

    ctx.font = `800 18.5px ${MONO_FONT}`;
    ctx.fillStyle = vsiCol;
    ctx.fillText(`${sign}${fpm}`, vx + 12, vy + 34);

    ctx.font = `600 9.5px ${MONO_FONT}`;
    ctx.fillStyle = safeSink ? UI.amber : UI.muted;
    ctx.fillText(safeSink ? 'GLIDESLOPE OK' : p.onGround ? 'ON GROUND' : 'ft/min', vx + 12, vy + 52);

    // Compact vertical glideslope bar on right side of V/S card
    const barX = vx + vw - 16;
    const barY = vy + 10;
    const barH = 44;
    const midY = barY + barH * 0.5;
    roundRectPath(ctx, barX, barY, 7, barH, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();

    const safeTop = midY + (100 / 1500) * (barH * 0.5);
    const safeBot = midY + (600 / 1500) * (barH * 0.5);
    ctx.fillStyle = 'rgba(245, 182, 66, 0.28)';
    ctx.fillRect(barX - 1.5, safeTop, 10, safeBot - safeTop);

    const norm = clamp(fpm / 1500, -1, 1);
    const tipY = midY - norm * (barH * 0.5);
    ctx.fillStyle = hardSink ? UI.danger : UI.amber;
    if (tipY < midY) ctx.fillRect(barX + 1, tipY, 5, midY - tipY);
    else ctx.fillRect(barX + 1, midY, 5, tipY - midY);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX - 2, midY);
    ctx.lineTo(barX + 9, midY);
    ctx.stroke();
  }

  /** Cockpit-only thin amber center pitch ladder (per Addendum 7 & ref-ui-hud-canyon). */
  function drawCockpitPitchLadder(state) {
    if (state.camMode !== 2) return;
    const p = state.plane;
    const cx = FIELD.width * 0.5;
    const cy = FIELD.height * 0.44;
    const pxPerDeg = 11.5;
    const pitchDeg = (p.pitch * 180) / Math.PI;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 210, cy - 125, 420, 235);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-p.roll);
    const pitchOffset = pitchDeg * pxPerDeg;

    // Subtle fixed boresight cross
    ctx.strokeStyle = 'rgba(245, 182, 66, 0.62)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-5, 0);
    ctx.moveTo(5, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, -4);
    ctx.stroke();

    ctx.font = `600 10.5px ${MONO_FONT}`;
    ctx.textBaseline = 'middle';
    for (const deg of [-10, -5, 0, 5, 10]) {
      const py = pitchOffset - deg * pxPerDeg;
      const isHorizon = deg === 0;
      const halfSpan = isHorizon ? 88 : 66;
      const gap = 30;
      ctx.strokeStyle = isHorizon ? 'rgba(245, 182, 66, 0.62)' : 'rgba(245, 182, 66, 0.44)';
      ctx.lineWidth = isHorizon ? 1.4 : 1.1;
      if (deg < 0) ctx.setLineDash([5, 4]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(-halfSpan, py);
      ctx.lineTo(-gap, py);
      ctx.moveTo(gap, py);
      ctx.lineTo(halfSpan, py);
      ctx.stroke();
      ctx.setLineDash([]);

      // End ticks
      const tickDir = deg >= 0 ? 5 : -5;
      ctx.beginPath();
      ctx.moveTo(-halfSpan, py);
      ctx.lineTo(-halfSpan, py + tickDir);
      ctx.moveTo(halfSpan, py);
      ctx.lineTo(halfSpan, py + tickDir);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 222, 150, 0.72)';
      ctx.textAlign = 'right';
      ctx.fillText(`${deg}°`, -halfSpan - 6, py);
      ctx.textAlign = 'left';
      ctx.fillText(`${deg}°`, halfSpan + 6, py);
    }
    ctx.restore();
  }

  /** In-world amber target diamond + label (coexists cleanly with edge arrow). */
  function drawTargetDiamondAndEdgeArrow(state, targetPos, cam) {
    if (!targetPos || state.plane.onGround) return;
    const p = state.plane;
    const tx = targetPos.x;
    const ty = targetPos.y !== undefined ? targetPos.y : RUNWAY.elevation + 10;
    const tz = targetPos.z;
    const distM = Math.hypot(tx - p.pos.x, ty - p.pos.y, tz - p.pos.z);
    const isRwy = state.mode === MODE_FREE || state.ringsPassed >= MISSION_RINGS.length;
    const tag = isRwy ? 'RWY 36' : `RING 0${state.ringsPassed + 1}`;
    const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;

    let sx = FIELD.width * 0.5;
    let sy = FIELD.height * 0.42;
    let onScreen = false;
    let dirX = 0;
    let dirY = 0;

    if (cam && cam.forward) {
      const vx = tx - cam.pos.x;
      const vy = ty - cam.pos.y;
      const vz = tz - cam.pos.z;
      const cx = vx * cam.right.x + vy * cam.right.y + vz * cam.right.z;
      const cy = vx * cam.up.x + vy * cam.up.y + vz * cam.up.z;
      const cz = vx * cam.forward.x + vy * cam.forward.y + vz * cam.forward.z;
      const tanY = Math.tan((cam.fovy || 1.0) * 0.5);
      const tanX = tanY * (FIELD.width / FIELD.height);
      const nx = cz > 1e-3 ? cx / (cz * tanX) : cx >= 0 ? 2 : -2;
      const ny = cz > 1e-3 ? -cy / (cz * tanY) : -cy >= 0 ? 2 : -2;
      if (cz > 10 && Math.abs(nx) <= 0.88 && Math.abs(ny) <= 0.80) {
        onScreen = true;
        sx = FIELD.width * 0.5 + nx * (FIELD.width * 0.5);
        sy = FIELD.height * 0.5 + ny * (FIELD.height * 0.5);
      } else {
        dirX = cx / tanX;
        dirY = -cy / tanY;
      }
    }

    if (onScreen) {
      // Float clean amber waypoint diamond above the 3D ring torus so the ring stays clear
      const dy = Math.max(84, sy - (distM < 320 ? 34 : 26));
      ctx.save();
      // Soft amber outer halo & diamond
      ctx.shadowColor = 'rgba(245, 182, 66, 0.55)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = UI.amberBright;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, dy - 10);
      ctx.lineTo(sx + 10, dy);
      ctx.lineTo(sx, dy + 10);
      ctx.lineTo(sx - 10, dy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20, 18, 14, 0.45)';
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = UI.amberBright;
      ctx.beginPath();
      ctx.arc(sx, dy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Downward pointer tick
      ctx.beginPath();
      ctx.moveTo(sx - 4, dy + 13);
      ctx.lineTo(sx + 4, dy + 13);
      ctx.lineTo(sx, dy + 18);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Crisp smoked label chip right beside / above diamond
      const chipText = `${tag} • ${distLabel}`;
      ctx.font = `700 11.5px ${MONO_FONT}`;
      const tw = ctx.measureText(chipText).width + 14;
      drawPanelBox(sx - tw * 0.5, dy - 33, tw, 19, 5, 'rgba(11, 13, 18, 0.72)', 'rgba(245, 182, 66, 0.40)', false);
      ctx.fillStyle = UI.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chipText, sx, dy - 23.5);
      ctx.restore();
      return;
    }

    // Off-screen directional edge arrow (styled identically in amber smoked glass)
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;

    const halfW = FIELD.width * 0.5 - 66;
    const minY = 140;
    const maxY = state.camMode === 2 ? FIELD.height - 96 : FIELD.height - 190;
    const cyMid = (minY + maxY) * 0.5;
    const halfH = (maxY - minY) * 0.5;
    const txScale = Math.abs(dirX) > 1e-4 ? halfW / Math.abs(dirX) : 1e6;
    const tyScale = Math.abs(dirY) > 1e-4 ? halfH / Math.abs(dirY) : 1e6;
    const tEdge = Math.min(txScale, tyScale);
    const ax = clamp(FIELD.width * 0.5 + dirX * tEdge, 66, FIELD.width - 66);
    const ay = clamp(cyMid + dirY * tEdge, minY, maxY);

    ctx.save();
    drawPanelBox(ax - 46, ay - 20, 92, 40, 7, 'rgba(11, 13, 18, 0.84)', UI.amberBorder);
    const ang = Math.atan2(dirY, dirX);
    ctx.save();
    ctx.translate(ax - 24, ay);
    ctx.rotate(ang);
    ctx.fillStyle = UI.amber;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = UI.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(distLabel, ax + 13, ay + 0.5);
    ctx.restore();
  }

  function drawWarningsAndToast(state, targetPos, cam) {
    const cx = FIELD.width * 0.5;
    drawTargetDiamondAndEdgeArrow(state, targetPos, cam);

    if (state.calloutTimer > 0 && state.calloutText) {
      const alpha = clamp(state.calloutTimer / 0.35, 0, 1);
      const cy = FIELD.height * 0.25;
      const isBad = /miss|stall|fail/i.test(state.calloutText);
      const col = isBad ? UI.danger : UI.amberBright;
      ctx.save();
      ctx.globalAlpha = alpha;
      drawPanelBox(cx - 145, cy - 26, 290, 52, 9, 'rgba(11, 13, 18, 0.86)', col);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 18px ${FONT}`;
      ctx.fillStyle = col;
      ctx.fillText(state.calloutText, cx, cy - 6);
      if (state.calloutSub) {
        ctx.font = `700 12px ${MONO_FONT}`;
        ctx.fillStyle = UI.text;
        ctx.fillText(state.calloutSub, cx, cy + 14);
      }
      ctx.restore();
    }

    const warnY = state.camMode === 2 ? 124 : FIELD.height - 186;
    if (state.plane.isStalling && !state.plane.onGround) {
      drawPanelBox(cx - 115, warnY, 230, 28, 6, 'rgba(175, 32, 28, 0.88)', UI.danger);
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STALL — NOSE DOWN / THRUST', cx, warnY + 14);
    } else if (state.mode === MODE_MISSION && state.plane.fuel <= 0) {
      drawPanelBox(cx - 130, warnY, 260, 28, 6, 'rgba(180, 74, 20, 0.88)', UI.caution);
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FUEL EMPTY — GLIDE TO RWY 36', cx, warnY + 14);
    } else if (state.toastTimer > 0 && state.toastText) {
      drawPanelBox(cx - 245, 84, 490, 28, 6, 'rgba(11, 13, 18, 0.80)', UI.amberBorder);
      ctx.font = `600 13.5px ${FONT}`;
      ctx.fillStyle = UI.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.toastText, cx, 98);
    }
  }

  function drawSunGlare(cam) {
    if (!cam || !cam.isCockpit) return;
    const sunDir = normalize3({ x: PALETTE.sunDir[0], y: PALETTE.sunDir[1], z: PALETTE.sunDir[2] });
    const sunDot = dot3(cam.forward, sunDir);
    const cosLimit = 0.875;
    if (sunDot <= cosLimit) return;

    const glare = clamp((sunDot - cosLimit) / (1.0 - cosLimit), 0, 1);
    const tanY = Math.tan((cam.fovy || 1.0) * 0.5);
    const tanX = tanY * (FIELD.width / FIELD.height);
    const cx = dot3(sunDir, cam.right);
    const cy = dot3(sunDir, cam.up);
    const cz = Math.max(0.05, dot3(sunDir, cam.forward));
    const sx = FIELD.width * 0.5 + (cx / (cz * tanX)) * (FIELD.width * 0.5);
    const sy = FIELD.height * 0.5 - (cy / (cz * tanY)) * (FIELD.height * 0.5);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(sx, sy, 12, sx, sy, 420);
    glow.addColorStop(0.0, `rgba(255, 224, 155, ${0.26 * glare})`);
    glow.addColorStop(0.32, `rgba(255, 178, 92, ${0.13 * glare})`);
    glow.addColorStop(0.7, `rgba(240, 124, 58, ${0.04 * glare})`);
    glow.addColorStop(1.0, 'rgba(240, 120, 50, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    ctx.restore();
  }

  function drawWingEmblem(cx, cy) {
    ctx.save();
    const grad = ctx.createLinearGradient(cx - 42, cy - 10, cx + 42, cy + 10);
    grad.addColorStop(0, '#ffe4a2');
    grad.addColorStop(0.5, UI.amber);
    grad.addColorStop(1, UI.amberDeep);
    ctx.strokeStyle = grad;
    ctx.fillStyle = grad;
    ctx.lineWidth = 2;

    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 12, cy);
      ctx.lineTo(cx + side * 44, cy - 8);
      ctx.lineTo(cx + side * 35, cy);
      ctx.lineTo(cx + side * 14, cy + 4);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx + side * 12, cy + 6);
      ctx.lineTo(cx + side * 31, cy + 3);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTitleScreen(selectedMode, best, hoverId) {
    // Subtle left gradient scrim per ref-ui-menu leaving Eagle Gorge, Ring 6, and cockpit panel open
    const scrim = ctx.createLinearGradient(0, 0, 520, 0);
    scrim.addColorStop(0, 'rgba(7, 9, 13, 0.48)');
    scrim.addColorStop(0.7, 'rgba(7, 9, 13, 0.14)');
    scrim.addColorStop(1, 'rgba(7, 9, 13, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, 520, FIELD.height);

    // Top-left display branding: wing emblem + SKYWARD RUN title
    const lx = 44;
    const ly = 32;
    drawWingEmblem(lx + 42, ly + 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.fillText('GOLDEN-HOUR FLIGHT CHALLENGE', lx + 98, ly + 15);

    ctx.textBaseline = 'top';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.60)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    const titleGrad = ctx.createLinearGradient(lx, ly + 30, lx, ly + 82);
    titleGrad.addColorStop(0, '#ffffff');
    titleGrad.addColorStop(1, '#f3d49c');
    ctx.font = `900 46px ${FONT}`;
    ctx.fillStyle = titleGrad;
    ctx.fillText('SKYWARD RUN', lx, ly + 30);
    ctx.restore();

    ctx.font = `600 13px ${MONO_FONT}`;
    ctx.fillStyle = UI.textSoft;
    ctx.fillText('ALPINE CORDILLERA  •  EAGLE GORGE  •  RWY 36', lx + 2, ly + 86);

    // Ref-ui-menu style smoked vertical menu box (compact height stops at y=408 above gauges)
    const mx = lx;
    const my = 144;
    const mw = 326;
    const mh = 264;
    drawPanelBox(mx, my, mw, mh, 10, null, 'rgba(245, 182, 66, 0.34)', true);
    drawAmberBrackets(mx, my, mw, mh, 10, UI.amber);

    const rows = [
      { id: 'mode-mission', label: 'MISSION MODE', sub: '8 Rings • Wind & Fuel', active: selectedMode === MODE_MISSION, primary: false },
      { id: 'mode-free', label: 'FREE FLIGHT', sub: 'Open Exploration • Unlim Fuel', active: selectedMode === MODE_FREE, primary: false },
      { id: 'btn-start', label: 'TAKE OFF  (SPACE)', sub: 'Launch from Runway 36', active: true, primary: true },
      { id: 'btn-help', label: '[H] FLIGHT CONTROLS', sub: 'Keybindings & Landing Tips', active: false, primary: false },
    ];

    let ry = my + 16;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rh = row.primary ? 52 : 50;
      addButton(row.id, mx + 14, ry, mw - 28, rh);
      const hovered = hoverId === row.id;

      if (row.primary) {
        drawButton(row.id, mx + 14, ry, mw - 28, rh, row.label, true, hoverId, UI.amber, true);
      } else {
        const bgGrad = ctx.createLinearGradient(mx + 14, ry, mx + mw - 14, ry);
        if (row.active || hovered) {
          bgGrad.addColorStop(0, 'rgba(245, 182, 66, 0.24)');
          bgGrad.addColorStop(1, 'rgba(210, 128, 36, 0.06)');
        } else {
          bgGrad.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
          bgGrad.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
        }
        const stroke = row.active ? UI.amberBorder : hovered ? 'rgba(255, 240, 210, 0.34)' : 'rgba(255, 255, 255, 0.08)';
        drawPanelBox(mx + 14, ry, mw - 28, rh, 6, bgGrad, stroke, false);

        if (row.active) {
          ctx.fillStyle = UI.amber;
          ctx.fillRect(mx + 15, ry + 10, 3, rh - 20);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `700 14.5px ${FONT}`;
        ctx.fillStyle = row.active ? UI.amberBright : UI.text;
        ctx.fillText(row.label, mx + 28, ry + 9);

        ctx.font = `400 11.5px ${FONT}`;
        ctx.fillStyle = row.active ? UI.textSoft : UI.muted;
        ctx.fillText(row.sub, mx + 28, ry + 29);

        if (row.active) {
          ctx.textAlign = 'right';
          ctx.font = `700 14px ${MONO_FONT}`;
          ctx.fillStyle = UI.amber;
          ctx.fillText('‹ ›', mx + mw - 26, ry + 15);
        }
      }
      ry += rh + 8;
    }

    // Top-right info stack (matching ref-ui-menu top-right cards): Mission Brief + BEST SCORE card
    const rx = FIELD.width - 308;
    const rW = 268;
    drawPanelBox(rx, 28, rW, 56, 8, null, 'rgba(255, 240, 210, 0.18)');
    drawAmberBrackets(rx, 28, rW, 56, 7, UI.amber);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.fillText('COURSE: 8 LANDMARK RINGS', rx + 16, 39);
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = UI.textSoft;
    ctx.fillText('Glacier Tarn • Eagle Gorge • RWY 36', rx + 16, 58);

    drawPanelBox(rx, 94, rW, 44, 8, null, UI.amberBorder);
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = UI.textSoft;
    ctx.textBaseline = 'middle';
    ctx.fillText('BEST SCORE', rx + 16, 116);
    ctx.textAlign = 'right';
    ctx.font = `800 17px ${MONO_FONT}`;
    ctx.fillStyle = UI.amberBright;
    ctx.fillText(`${best} PTS`, rx + rW - 16, 116);

    // Subtle footer hint strip on left below menu
    drawPanelBox(lx, 418, mw, 28, 6, 'rgba(10, 12, 16, 0.66)', 'rgba(255, 240, 210, 0.12)', false);
    ctx.font = `600 10.5px ${MONO_FONT}`;
    ctx.fillStyle = UI.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('W/S Pitch • A/D Roll • V Cockpit • Shift/X Thr', lx + mw * 0.5, 432);
  }

  function drawPauseModal(hoverId, invertPitch) {
    ctx.fillStyle = 'rgba(6, 8, 12, 0.42)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const w = 436;
    const h = 356;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    drawPanelBox(x, y, w, h, 12, null, UI.amberBorder, true);
    drawAmberBrackets(x, y, w, h, 12, UI.amber);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillStyle = UI.text;
    ctx.fillText('FLIGHT PAUSED', FIELD.width * 0.5, y + 28);

    drawButton('btn-resume', x + 48, y + 92, w - 96, 46, 'RESUME FLIGHT  (P / ESC)', true, hoverId, UI.amber, true);
    drawButton('btn-invert', x + 48, y + 150, w - 96, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'}  (I)`, invertPitch, hoverId, UI.amber);
    drawButton('btn-help', x + 48, y + 204, w - 96, 42, 'CONTROLS & HELP  (H)', false, hoverId, UI.amber);
    drawButton('btn-restart', x + 48, y + 258, 162, 42, 'RESTART', false, hoverId, UI.amber);
    drawButton('btn-title', x + w - 210, y + 258, 162, 42, 'TITLE SCREEN', false, hoverId, UI.muted);
  }

  function drawHelpModal(hoverId, invertPitch) {
    ctx.fillStyle = 'rgba(6, 8, 12, 0.50)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const w = 740;
    const h = 500;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    drawPanelBox(x, y, w, h, 12, null, UI.amberBorder, true);
    drawAmberBrackets(x, y, w, h, 12, UI.amber);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 28px ${FONT}`;
    ctx.fillStyle = UI.text;
    ctx.fillText('FLIGHT CONTROLS & PILOT GUIDE', FIELD.width * 0.5, y + 26);

    const rows = [
      ['W / S  or  ↑ / ↓', 'Pitch Nose Down / Pull Nose Up (Press I to invert)'],
      ['A / D  or  ← / →', 'Bank / Roll Left & Right (turns smoothly into bank)'],
      ['Q / E', 'Rudder Yaw Left / Right (aligns on final approach)'],
      ['Shift / R  &  X / F', 'Throttle Up / Down (or Mouse Wheel)'],
      ['B', 'Airbrake & Runway Wheel Brakes'],
      ['Mouse Drag  or  U', 'Virtual Yoke Steering (click-drag or toggle with U)'],
      ['C  •  V', 'Chase Camera Distance  •  Toggle Cockpit View (First-Person)'],
      ['P / Esc  •  H  •  M', 'Pause • Help • Mute Audio'],
    ];

    ctx.textAlign = 'left';
    let ry = y + 80;
    for (const [key, desc] of rows) {
      drawPanelBox(x + 34, ry - 4, 210, 30, 6, 'rgba(245, 182, 66, 0.12)', UI.amberBorder, false);
      ctx.font = `700 12.5px ${MONO_FONT}`;
      ctx.fillStyle = UI.amberBright;
      ctx.fillText(key, x + 46, ry + 5);

      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = UI.textSoft;
      ctx.fillText(desc, x + 262, ry + 4);
      ry += 38;
    }

    ctx.font = `600 13.5px ${FONT}`;
    ctx.fillStyle = UI.amber;
    ctx.fillText('Landing Tip: Approach Runway 36 heading North (360°) with speed ~55-70 KT and V/S -100 to -600 ft/min.', x + 36, y + 392);

    drawButton('btn-invert', x + 36, y + 432, 230, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'} (I)`, invertPitch, hoverId, UI.amber);
    drawButton('btn-close-help', x + w - 236, y + 432, 200, 42, 'CLOSE  (H / ESC)', true, hoverId, UI.amber, true);
  }

  function drawEndScreen(state, best, hoverId) {
    ctx.fillStyle = 'rgba(6, 8, 12, 0.42)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const win = state.outcome === OUTCOME_WIN;
    const fuelOut = state.outcome === OUTCOME_FUEL;
    const w = 576;
    const h = win ? 506 : 374;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5 + 8;
    const accent = win ? UI.amber : fuelOut ? UI.caution : UI.danger;
    drawPanelBox(x, y, w, h, 12, null, win ? UI.amberBorder : accent, true);
    drawAmberBrackets(x, y, w, h, 14, accent);

    // Top accent glow line
    ctx.fillStyle = accent;
    roundRectPath(ctx, x + 120, y + 1, w - 240, 2.5, 1.25);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = accent;
    ctx.fillText(win ? 'MISSION COMPLETE' : fuelOut ? 'OUT OF FUEL' : 'FLIGHT TERMINATED', FIELD.width * 0.5, y + 18);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 10;
    ctx.font = `800 28px ${FONT}`;
    ctx.fillStyle = UI.text;
    ctx.fillText(win ? 'SAFE TOUCHDOWN — RWY 36' : state.failReason || 'CRASH LANDING', FIELD.width * 0.5, y + 38);
    ctx.restore();

    if (win) {
      const b = state.scoreBreakdown;
      const maxStreak = state.maxCombo || 0;
      const maxMult = maxStreak >= 5 ? 3 : maxStreak >= 3 ? 2 : 1;
      const sinkFpm = Math.round(-(state.plane.touchdownSink || 0) * 196.85);
      const rows = [
        ['Target Rings (8 / 8)', `${b.rings}`, UI.amber],
        [`Time (${formatClock(state.missionTime)})`, `+${b.time}`, UI.amber],
        [`Fuel Remaining (${Math.round(state.plane.fuel)}%)`, `+${b.fuel}`, UI.amber],
        [`Landing Grade: ${state.plane.landingGrade}`, `+${b.landing}`, UI.amberBright],
        ['PERFECT Rings', `${state.perfectRings || 0} / 8`, UI.amberBright],
        ['Max Combo', `×${maxMult} (${maxStreak} streak)`, UI.text],
        ['Final Glideslope', state.plane.glideslopeGrade || 'ON GLIDESLOPE (A)', UI.textSoft],
        ['Touchdown V/S', `-${(state.plane.touchdownSink || 0).toFixed(2)} m/s (${sinkFpm} fpm)`, UI.amber],
      ];
      let ry = y + 88;
      for (let idx = 0; idx < rows.length; idx += 1) {
        const [label, val, valCol] = rows[idx];
        if (idx % 2 === 0) {
          roundRectPath(ctx, x + 40, ry - 4, w - 80, 26, 5);
          ctx.fillStyle = 'rgba(255, 240, 210, 0.04)';
          ctx.fill();
        }
        ctx.textAlign = 'left';
        ctx.font = `500 14px ${FONT}`;
        ctx.fillStyle = UI.textSoft;
        ctx.fillText(label, x + 54, ry);
        ctx.textAlign = 'right';
        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = valCol;
        ctx.fillText(val, x + w - 54, ry);
        ry += 28;
      }

      ctx.strokeStyle = 'rgba(255, 240, 210, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 48, ry + 6);
      ctx.lineTo(x + w - 48, ry + 6);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = `800 21px ${FONT}`;
      ctx.fillStyle = UI.text;
      ctx.fillText('FINAL SCORE', x + 54, ry + 16);
      ctx.textAlign = 'right';
      ctx.font = `800 26px ${MONO_FONT}`;
      ctx.fillStyle = UI.amberBright;
      ctx.fillText(`${b.total}`, x + w - 54, ry + 14);

      ctx.textAlign = 'center';
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = UI.amber;
      ctx.fillText(`BEST SCORE: ${best} PTS`, FIELD.width * 0.5, ry + 52);
    } else {
      ctx.font = `500 17px ${FONT}`;
      ctx.fillStyle = UI.textSoft;
      ctx.fillText(`Rings Cleared: ${state.ringsPassed} / 8   •   Flight Time: ${formatClock(state.missionTime)}`, FIELD.width * 0.5, y + 124);
      ctx.font = `700 20px ${MONO_FONT}`;
      ctx.fillStyle = UI.amber;
      ctx.fillText(`SCORE: ${state.scoreBreakdown.total}   (BEST: ${best})`, FIELD.width * 0.5, y + 170);
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = UI.muted;
      ctx.fillText(
        fuelOut
          ? 'Tip: Ease throttle back to 55-65% once airborne to conserve fuel.'
          : 'Tip: Flare nose slightly up before touchdown to keep descent smooth.',
        FIELD.width * 0.5,
        y + 216,
      );
    }

    const btnY = y + h - 76;
    drawButton('btn-restart', x + 48, btnY, 214, 46, 'FLY AGAIN  (SPACE)', true, hoverId, accent, true);
    drawButton('btn-title', x + w - 262, btnY, 214, 46, 'TITLE SCREEN', false, hoverId, UI.muted);
  }

  function draw(state, screen, opts) {
    resize();
    buttons.length = 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    const { best = 0, selectedMode = MODE_MISSION, hoverId = null, muted = false, invertPitch = false, mouseYoke = false, cam = null } = opts || {};

    drawSunGlare(cam);

    if (screen === SCREEN_TITLE) {
      drawTitleScreen(selectedMode, best, hoverId);
      return;
    }

    let targetPos = { x: RUNWAY.x, y: RUNWAY.elevation + 14, z: RUNWAY.zStart };
    if (state.mode === MODE_MISSION && state.ringsPassed < MISSION_RINGS.length) {
      targetPos = MISSION_RINGS[state.ringsPassed];
    }

    drawCockpitPitchLadder(state);
    drawCompassStrip(state, targetPos);
    drawMissionPanel(state);
    drawCircularRadar(state, targetPos);

    if (state.camMode !== 2 && screen !== SCREEN_OVER) {
      drawArtificialHorizon(state.plane);
      drawLeftInstruments(state);
      drawRightInstruments(state);
    }

    if (screen === SCREEN_PLAY) {
      drawTopRightControls(hoverId, muted, mouseYoke);
      drawWarningsAndToast(state, targetPos, cam);
    } else if (screen === SCREEN_PAUSED) {
      drawPauseModal(hoverId, invertPitch);
    } else if (screen === SCREEN_HELP) {
      drawHelpModal(hoverId, invertPitch);
    } else if (screen === SCREEN_OVER) {
      drawEndScreen(state, best, hoverId);
    }
  }

  return { draw, hitTest };
}
