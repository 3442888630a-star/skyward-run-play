// 2D Canvas cockpit instruments HUD and interactive UI overlays (Title, Pause, Help, End).
// Designed to stay razor-sharp over the WebGL1 3D scene with clickable hit regions.

import { FIELD, FONT, MISSION_RINGS, MODE_FREE, MODE_MISSION, MONO_FONT, PALETTE, PLANE, RUNWAY, WORLD } from './config.js';
import { clamp, wrapAngle } from './math.js';
import { terrainHeight } from './terrain.js';
import { OUTCOME_FUEL, OUTCOME_WIN } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_HELP = 'help';
export const SCREEN_OVER = 'over';

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

export function createHudRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const buttons = [];

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

  function drawPanelBox(x, y, w, h, r = 10, fill = PALETTE.hudBg, stroke = PALETTE.hudBezel) {
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  function drawButton(id, x, y, w, h, label, active, hoverId, accent = PALETTE.hudAmber) {
    addButton(id, x, y, w, h);
    const hovered = hoverId === id;
    const fill = active
      ? 'rgba(255, 190, 85, 0.24)'
      : hovered
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(18, 27, 40, 0.85)';
    const stroke = active || hovered ? accent : 'rgba(255, 255, 255, 0.22)';
    drawPanelBox(x, y, w, h, 8, fill, stroke);
    ctx.font = `600 16px ${FONT}`;
    ctx.fillStyle = active ? accent : PALETTE.hudText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w * 0.5, y + h * 0.5);
  }

  function drawCompassStrip(state, targetPos) {
    const cx = FIELD.width * 0.5;
    const x = cx - 210;
    const y = 14;
    const w = 420;
    const h = 44;
    drawPanelBox(x, y, w, h, 8);

    const headingDeg = ((state.plane.heading * 180) / Math.PI) % 360;
    const pxPerDeg = 3.2;

    ctx.save();
    roundRectPath(ctx, x + 4, y + 2, w - 8, h - 4, 6);
    ctx.clip();

    // Ticks every 15 deg
    const labels = new Map([
      [0, '36'],
      [30, '03'],
      [60, '06'],
      [90, 'E'],
      [120, '12'],
      [150, '15'],
      [180, 'S'],
      [210, '21'],
      [240, '24'],
      [270, 'W'],
      [300, '30'],
      [330, '33'],
    ]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let deg = 0; deg < 360; deg += 15) {
      let diff = deg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const tx = cx + diff * pxPerDeg;
      if (tx < x - 20 || tx > x + w + 20) continue;

      const major = deg % 30 === 0;
      ctx.strokeStyle = deg === 0 ? PALETTE.hudGreen : 'rgba(244, 241, 234, 0.48)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, y + h - (major ? 14 : 9));
      ctx.lineTo(tx, y + h - 3);
      ctx.stroke();

      if (major) {
        ctx.font = `700 13px ${MONO_FONT}`;
        ctx.fillStyle = deg === 0 ? PALETTE.hudGreen : PALETTE.hudText;
        ctx.fillText(labels.get(deg) || '', tx, y + 6);
      }
    }

    // Target bearing bug on compass strip
    if (targetPos) {
      const dx = targetPos.x - state.plane.pos.x;
      const dz = targetPos.z - state.plane.pos.z;
      const targetBrg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      let diff = targetBrg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const bx = clamp(cx + diff * pxPerDeg, x + 14, x + w - 14);
      const isRwy = state.mode === MODE_FREE || state.ringsPassed >= MISSION_RINGS.length;
      ctx.fillStyle = isRwy ? PALETTE.hudGreen : PALETTE.hudCyan;
      ctx.beginPath();
      ctx.moveTo(bx, y + h - 2);
      ctx.lineTo(bx - 6, y + h - 12);
      ctx.lineTo(bx + 6, y + h - 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Center lubber triangle & digital heading readout
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.beginPath();
    ctx.moveTo(cx, y + 1);
    ctx.lineTo(cx - 6, y - 5);
    ctx.lineTo(cx + 6, y - 5);
    ctx.closePath();
    ctx.fill();

    drawPanelBox(cx - 38, y + h + 3, 76, 22, 5, 'rgba(11, 17, 26, 0.88)', PALETTE.hudAmber);
    const dispHdg = Math.round(headingDeg) || 360;
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`HDG ${String(dispHdg).padStart(3, '0')}°`, cx, y + h + 14);
  }

  function drawMissionPanel(state, targetPos) {
    const x = 18;
    const y = 14;
    drawPanelBox(x, y, 290, 86, 10);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (state.mode === MODE_MISSION) {
      const done = state.ringsPassed;
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.fillText(`MISSION  •  TIME ${formatClock(state.missionTime)}`, x + 14, y + 11);

      // 8 ring pips
      for (let i = 0; i < MISSION_RINGS.length; i += 1) {
        const px = x + 16 + i * 24;
        const py = y + 36;
        ctx.beginPath();
        ctx.arc(px + 7, py + 7, 7, 0, Math.PI * 2);
        if (i < done) {
          ctx.fillStyle = PALETTE.hudGreen;
          ctx.fill();
        } else if (i === done) {
          ctx.fillStyle = PALETTE.hudCyan;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fill();
        }
      }
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.textAlign = 'right';
      ctx.fillText(`${state.ringScore} PTS`, x + 276, y + 35);

      ctx.textAlign = 'left';
      ctx.font = `600 13px ${FONT}`;
      if (done < MISSION_RINGS.length) {
        const ring = MISSION_RINGS[done];
        const dist = Math.round(Math.hypot(ring.x - state.plane.pos.x, ring.z - state.plane.pos.z));
        ctx.fillStyle = PALETTE.hudCyan;
        ctx.fillText(`NEXT: RING ${done + 1} (${ring.label}) — ${dist} m`, x + 14, y + 61);
      } else {
        const dist = Math.round(Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z));
        ctx.fillStyle = PALETTE.hudGreen;
        ctx.fillText(`LAND RUNWAY 36 — ${dist} m`, x + 14, y + 61);
      }
    } else {
      ctx.font = `700 15px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(`FREE FLIGHT  •  ${formatClock(state.missionTime)}`, x + 14, y + 13);
      const dist = Math.round(Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z));
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.fillText(`Runway 36 Threshold: ${dist} m`, x + 14, y + 38);
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.fillText('Practice circuits & smooth landings', x + 14, y + 59);
    }
  }

  function drawTopRightControls(hoverId, muted, mouseYoke) {
    const y = 14;
    drawButton('btn-help', FIELD.width - 372, y, 82, 32, '[H] HELP', false, hoverId, PALETTE.hudCyan);
    drawButton('btn-yoke', FIELD.width - 282, y, 88, 32, mouseYoke ? 'YOKE ON' : '[U] YOKE', mouseYoke, hoverId, PALETTE.hudCyan);
    drawButton('btn-mute', FIELD.width - 186, y, 82, 32, muted ? 'MUTED' : '[M] SFX', muted, hoverId, PALETTE.hudAmber);
    drawButton('btn-pause', FIELD.width - 96, y, 78, 32, '[P] PAUSE', false, hoverId, PALETTE.hudAmber);
  }

  function drawArtificialHorizon(plane) {
    const cx = FIELD.width * 0.5;
    const cy = FIELD.height - 86;
    const r = 68;

    drawPanelBox(cx - r - 8, cy - r - 8, (r + 8) * 2, (r + 8) * 2, r + 8);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Rotate by -roll, shift vertically by pitch
    const pitchPx = clamp((plane.pitch * 180) / Math.PI, -45, 45) * 2.1;
    ctx.translate(cx, cy);
    ctx.rotate(-plane.roll);

    // Sky & ground halves
    ctx.fillStyle = PALETTE.hudSky;
    ctx.fillRect(-r * 2, -r * 3 + pitchPx, r * 4, r * 3);
    ctx.fillStyle = PALETTE.hudGround;
    ctx.fillRect(-r * 2, pitchPx, r * 4, r * 3);

    // Horizon line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, pitchPx);
    ctx.lineTo(r * 1.5, pitchPx);
    ctx.stroke();

    // Pitch ladder (-20, -10, +10, +20 deg)
    ctx.font = `700 10px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textBaseline = 'middle';
    for (const deg of [-20, -10, 10, 20]) {
      const py = pitchPx - deg * 2.1;
      const hw = Math.abs(deg) === 20 ? 22 : 14;
      ctx.strokeStyle = 'rgba(255,255,255,0.82)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-hw, py);
      ctx.lineTo(-5, py);
      ctx.moveTo(5, py);
      ctx.lineTo(hw, py);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.abs(deg)), -hw - 3, py);
    }
    ctx.restore();

    // Fixed roll scale ticks at top of bezel
    ctx.save();
    ctx.translate(cx, cy);
    for (const deg of [-45, -30, -15, 0, 15, 30, 45]) {
      const a = (deg * Math.PI) / 180 - Math.PI * 0.5;
      const rIn = deg === 0 ? r - 9 : r - 6;
      ctx.strokeStyle = deg === 0 ? PALETTE.hudAmber : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = deg === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      ctx.lineTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1));
      ctx.stroke();
    }
    ctx.restore();

    // Fixed center aircraft waterline symbol
    ctx.strokeStyle = PALETTE.hudAmber;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.lineTo(cx - 4, cy + 5);
    ctx.moveTo(cx + 24, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx + 4, cy + 5);
    ctx.stroke();
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Bezel ring
    ctx.strokeStyle = PALETTE.hudBezel;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawLeftInstruments(state) {
    const p = state.plane;
    const kts = Math.round(p.speed * 1.94384);
    const thrPct = Math.round(p.throttle * 100);
    const fuelPct = Math.round(p.fuel);

    // Airspeed Indicator
    const sx = 20;
    const sy = FIELD.height - 154;
    drawPanelBox(sx, sy, 146, 136, 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('AIRSPEED', sx + 12, sy + 10);

    ctx.font = `700 34px ${MONO_FONT}`;
    ctx.fillStyle = p.isStalling ? PALETTE.hudRed : PALETTE.hudText;
    ctx.fillText(`${kts}`, sx + 12, sy + 28);
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('KT', sx + 88, sy + 44);

    // Speed bar with stall marker
    const bx = sx + 12;
    const by = sy + 80;
    const bw = 122;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(bx, by, bw, 12);
    const stallFrac = (PLANE.stallSpeed * 1.94384) / 170;
    ctx.fillStyle = 'rgba(255, 93, 85, 0.45)';
    ctx.fillRect(bx, by, bw * stallFrac, 12);
    const spdFrac = clamp(kts / 170, 0, 1);
    ctx.fillStyle = p.isStalling ? PALETTE.hudRed : PALETTE.hudCyan;
    ctx.fillRect(bx, by, bw * spdFrac, 12);

    ctx.font = `600 11px ${MONO_FONT}`;
    ctx.fillStyle = p.isStalling ? PALETTE.hudRed : PALETTE.hudMuted;
    ctx.fillText(p.isStalling ? '!! STALL SPEED !!' : 'STALL < 45 KT', sx + 12, sy + 104);

    // Throttle & Fuel dual vertical panel
    const gx = 178;
    const gy = FIELD.height - 154;
    drawPanelBox(gx, gy, 152, 136, 10);

    // Throttle bar
    drawVerticalGauge(gx + 16, gy + 12, 52, 112, p.throttle, 'THR', `${thrPct}%`, PALETTE.hudAmber);
    // Fuel bar
    const isFree = state.mode === MODE_FREE;
    const fuelColor = isFree
      ? PALETTE.hudCyan
      : fuelPct <= 10
        ? PALETTE.hudRed
        : fuelPct <= 25
          ? PALETTE.hudAmber
          : PALETTE.hudGreen;
    drawVerticalGauge(
      gx + 84,
      gy + 12,
      52,
      112,
      isFree ? 1 : p.fuel / 100,
      'FUEL',
      isFree ? 'UNL' : `${fuelPct}%`,
      fuelColor,
    );
  }

  function drawVerticalGauge(x, y, w, h, ratio, label, valueText, color) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText(label, x + w * 0.5, y);

    const barW = 18;
    const barH = 68;
    const bx = x + (w - barW) * 0.5;
    const by = y + 18;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(bx, by, barW, barH);
    const fillH = clamp(ratio, 0, 1) * barH;
    ctx.fillStyle = color;
    ctx.fillRect(bx, by + barH - fillH, barW, fillH);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, barW, barH);

    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(valueText, x + w * 0.5, y + 92);
  }

  function drawRightInstruments(state) {
    const p = state.plane;
    const altFt = Math.round(p.pos.y * 3.28084);
    const groundY = Math.max(WORLD.waterY, terrainHeight(p.pos.x, p.pos.z));
    const aglFt = Math.max(0, Math.round((p.pos.y - groundY) * 3.28084));
    const fpm = Math.round(p.verticalSpeed * 196.85);

    // Altimeter
    const ax = FIELD.width - 330;
    const ay = FIELD.height - 154;
    drawPanelBox(ax, ay, 152, 136, 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('ALTITUDE', ax + 14, ay + 10);

    ctx.font = `700 32px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(`${altFt}`, ax + 14, ay + 30);
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('FT MSL', ax + 14, ay + 68);

    ctx.font = `600 13px ${MONO_FONT}`;
    ctx.fillStyle = aglFt < 80 ? PALETTE.hudAmber : PALETTE.hudCyan;
    ctx.fillText(`AGL ${aglFt} FT`, ax + 14, ay + 102);

    // Vertical Speed Indicator (VSI)
    const vx = FIELD.width - 166;
    const vy = FIELD.height - 154;
    drawPanelBox(vx, vy, 146, 136, 10);
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('VERT SPD', vx + 12, vy + 10);

    const sign = fpm >= 0 ? '+' : '';
    const safeSink = fpm <= -80 && fpm >= -600;
    const hardSink = fpm < -850;
    ctx.font = `700 24px ${MONO_FONT}`;
    ctx.fillStyle = hardSink ? PALETTE.hudRed : safeSink ? PALETTE.hudGreen : PALETTE.hudText;
    ctx.fillText(`${sign}${fpm}`, vx + 12, vy + 32);
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('FPM', vx + 12, vy + 62);

    // Center-zero vertical bar (-1500 to +1500 FPM)
    const barX = vx + 114;
    const barY = vy + 18;
    const barH = 100;
    const midY = barY + barH * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, 16, barH);
    // Safe landing descent bracket (-100 to -600 fpm)
    const safeTop = midY + (100 / 1500) * (barH * 0.5);
    const safeBot = midY + (600 / 1500) * (barH * 0.5);
    ctx.fillStyle = 'rgba(106, 230, 123, 0.32)';
    ctx.fillRect(barX - 3, safeTop, 22, safeBot - safeTop);

    const norm = clamp(fpm / 1500, -1, 1);
    const tipY = midY - norm * (barH * 0.5);
    ctx.fillStyle = hardSink ? PALETTE.hudRed : safeSink ? PALETTE.hudGreen : PALETTE.hudCyan;
    if (tipY < midY) ctx.fillRect(barX, tipY, 16, midY - tipY);
    else ctx.fillRect(barX, midY, 16, tipY - midY);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX - 4, midY);
    ctx.lineTo(barX + 20, midY);
    ctx.stroke();

    ctx.font = `600 11px ${MONO_FONT}`;
    ctx.fillStyle = safeSink ? PALETTE.hudGreen : PALETTE.hudMuted;
    ctx.fillText(safeSink ? 'GLIDESLOPE OK' : p.onGround ? 'ON GROUND' : 'GREEN = LAND', vx + 12, vy + 104);
  }

  function drawWarningsAndToast(state, targetPos) {
    const cx = FIELD.width * 0.5;
    // Off-axis directional indicator if target is > 28 deg off nose
    if (targetPos && !state.plane.onGround) {
      const dx = targetPos.x - state.plane.pos.x;
      const dz = targetPos.z - state.plane.pos.z;
      const brg = Math.atan2(dx, -dz);
      const diff = wrapAngle(brg - state.plane.heading);
      if (Math.abs(diff) > 0.48) {
        const side = diff > 0 ? 1 : -1;
        const ax = cx + side * 410;
        const ay = FIELD.height * 0.48;
        drawPanelBox(ax - 54, ay - 20, 108, 40, 8, 'rgba(11,17,26,0.72)', PALETTE.hudCyan);
        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = PALETTE.hudCyan;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(side > 0 ? 'TURN  ▶' : '◀  TURN', ax, ay);
      }
    }

    // Critical warnings above artificial horizon
    const warnY = FIELD.height - 196;
    if (state.plane.isStalling && !state.plane.onGround) {
      drawPanelBox(cx - 110, warnY, 220, 28, 6, 'rgba(180, 28, 24, 0.88)', PALETTE.hudRed);
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STALL — NOSE DOWN / THRUST', cx, warnY + 14);
    } else if (state.mode === MODE_MISSION && state.plane.fuel <= 0) {
      drawPanelBox(cx - 125, warnY, 250, 28, 6, 'rgba(180, 70, 18, 0.88)', PALETTE.hudRed);
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FUEL EMPTY — GLIDE TO RWY 36', cx, warnY + 14);
    } else if (state.toastTimer > 0 && state.toastText) {
      drawPanelBox(cx - 245, 88, 490, 32, 8, 'rgba(11, 17, 26, 0.82)', PALETTE.hudAmber);
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.toastText, cx, 104);
    }
  }

  function drawTitleScreen(selectedMode, best, hoverId) {
    // Sleek left-aligned glass card leaving the propeller plane & golden valley glowing on the right
    const x = 56;
    const y = 78;
    const w = 520;
    const h = 564;
    drawPanelBox(x, y, w, h, 16, 'rgba(11, 16, 26, 0.82)', 'rgba(255, 198, 112, 0.45)');

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 14px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('GOLDEN-HOUR FLIGHT CHALLENGE', x + 32, y + 30);

    ctx.font = `800 54px ${FONT}`;
    ctx.fillStyle = '#fff8ec';
    ctx.fillText('SKYWARD RUN', x + 30, y + 54);

    ctx.font = `400 17px ${FONT}`;
    ctx.fillStyle = '#d4d9e2';
    ctx.fillText('Carve through golden valley skies, clear 8 glowing rings,', x + 32, y + 124);
    ctx.fillText('manage your fuel, and touch down softly on Runway 36.', x + 32, y + 148);

    // Mode selector cards
    const m1Y = y + 196;
    const m2Y = y + 292;
    drawModeCard(
      'mode-mission',
      x + 32,
      m1Y,
      w - 64,
      82,
      'MISSION MODE',
      '8 Target Rings • Limited Fuel • Scored Runway 36 Landing',
      selectedMode === MODE_MISSION,
      hoverId,
    );
    drawModeCard(
      'mode-free',
      x + 32,
      m2Y,
      w - 64,
      82,
      'FREE FLIGHT',
      'No Rings • Unlimited Fuel • Open Exploration & Landing Practice',
      selectedMode === MODE_FREE,
      hoverId,
    );

    // Primary Start CTA
    drawButton('btn-start', x + 32, y + 398, w - 64, 54, 'TAKE OFF  (SPACE / ENTER)', true, hoverId, PALETTE.hudAmber);

    // Best score + secondary Help button
    ctx.font = `700 15px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudCyan;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`BEST MISSION SCORE: ${best}`, x + 34, y + 482);
    drawButton('btn-help', x + w - 166, y + 464, 134, 36, '[H] CONTROLS', false, hoverId, PALETTE.hudCyan);

    // Compact footer controls hint
    ctx.font = `500 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.textAlign = 'left';
    ctx.fillText('W/S Pitch  •  A/D Roll  •  Q/E Yaw  •  Shift/X Throttle  •  Mouse Drag', x + 32, y + 528);
  }

  function drawModeCard(id, x, y, w, h, title, desc, selected, hoverId) {
    addButton(id, x, y, w, h);
    const hovered = hoverId === id;
    const fill = selected ? 'rgba(255, 190, 85, 0.18)' : hovered ? 'rgba(255,255,255,0.1)' : 'rgba(20, 30, 44, 0.72)';
    const stroke = selected ? PALETTE.hudAmber : hovered ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
    drawPanelBox(x, y, w, h, 10, fill, stroke);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 19px ${FONT}`;
    ctx.fillStyle = selected ? PALETTE.hudAmber : PALETTE.hudText;
    ctx.fillText((selected ? '▸ ' : '  ') + title, x + 18, y + 16);

    ctx.font = `400 14px ${FONT}`;
    ctx.fillStyle = selected ? '#f2e8d5' : PALETTE.hudMuted;
    ctx.fillText(desc, x + 18, y + 46);
  }

  function drawPauseModal(hoverId, invertPitch) {
    const w = 440;
    const h = 360;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    drawPanelBox(x, y, w, h, 16, 'rgba(11, 16, 26, 0.90)', PALETTE.hudAmber);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 36px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText('FLIGHT PAUSED', FIELD.width * 0.5, y + 30);

    drawButton('btn-resume', x + 50, y + 96, w - 100, 46, 'RESUME FLIGHT  (P / ESC)', true, hoverId, PALETTE.hudAmber);
    drawButton('btn-invert', x + 50, y + 154, w - 100, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'}  (I)`, invertPitch, hoverId, PALETTE.hudCyan);
    drawButton('btn-help', x + 50, y + 208, w - 100, 42, 'CONTROLS & HELP  (H)', false, hoverId, PALETTE.hudCyan);
    drawButton('btn-restart', x + 50, y + 262, 162, 42, 'RESTART', false, hoverId, PALETTE.hudAmber);
    drawButton('btn-title', x + w - 212, y + 262, 162, 42, 'TITLE SCREEN', false, hoverId, PALETTE.hudMuted);
  }

  function drawHelpModal(hoverId, invertPitch) {
    const w = 740;
    const h = 500;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    drawPanelBox(x, y, w, h, 16, 'rgba(10, 15, 24, 0.94)', PALETTE.hudCyan);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 32px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText('FLIGHT CONTROLS & PILOT GUIDE', FIELD.width * 0.5, y + 26);

    const rows = [
      ['W / S  or  ↑ / ↓', 'Pitch Nose Down / Pull Nose Up (Press I to invert)'],
      ['A / D  or  ← / →', 'Bank / Roll Left & Right (turns smoothly into bank)'],
      ['Q / E', 'Rudder Yaw Left / Right (aligns on final approach)'],
      ['Shift / R  &  X / F', 'Throttle Up / Down (or Mouse Wheel)'],
      ['B', 'Airbrake & Runway Wheel Brakes'],
      ['Mouse Drag  or  U', 'Virtual Yoke Steering (click-drag or toggle with U)'],
      ['P / Esc  •  H  •  M  •  C', 'Pause • Help • Mute Audio • Chase Camera Distance'],
    ];

    ctx.textAlign = 'left';
    let ry = y + 86;
    for (const [key, desc] of rows) {
      drawPanelBox(x + 34, ry - 4, 210, 32, 6, 'rgba(88, 226, 199, 0.12)', 'rgba(88, 226, 199, 0.35)');
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(key, x + 46, ry + 5);

      ctx.font = `400 15px ${FONT}`;
      ctx.fillStyle = '#e5e9f0';
      ctx.fillText(desc, x + 262, ry + 5);
      ry += 42;
    }

    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('Landing Tip: Approach Runway 36 heading North (360°) with speed ~55-70 KT and VSI in the green band.', x + 36, y + 392);

    drawButton('btn-invert', x + 36, y + 432, 230, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'} (I)`, invertPitch, hoverId, PALETTE.hudCyan);
    drawButton('btn-close-help', x + w - 236, y + 432, 200, 42, 'CLOSE  (H / ESC)', true, hoverId, PALETTE.hudAmber);
  }

  function drawEndScreen(state, best, hoverId) {
    const win = state.outcome === OUTCOME_WIN;
    const fuelOut = state.outcome === OUTCOME_FUEL;
    const w = 540;
    const h = win ? 470 : 370;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    const accent = win ? PALETTE.hudGreen : fuelOut ? PALETTE.hudAmber : PALETTE.hudRed;
    drawPanelBox(x, y, w, h, 16, 'rgba(10, 15, 24, 0.90)', accent);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 14px ${MONO_FONT}`;
    ctx.fillStyle = accent;
    ctx.fillText(win ? 'MISSION COMPLETE' : fuelOut ? 'OUT OF FUEL' : 'FLIGHT TERMINATED', FIELD.width * 0.5, y + 26);

    ctx.font = `800 36px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(win ? 'SAFE TOUCHDOWN — RWY 36' : state.failReason || 'CRASH LANDING', FIELD.width * 0.5, y + 52);

    if (win) {
      const b = state.scoreBreakdown;
      const rows = [
        ['Target Rings (8 / 8)', `${b.rings}`],
        [`Time (${formatClock(state.missionTime)})`, `+${b.time}`],
        [`Fuel Remaining (${Math.round(state.plane.fuel)}%)`, `+${b.fuel}`],
        [`Landing Grade: ${state.plane.landingGrade}`, `+${b.landing}`],
      ];
      let ry = y + 124;
      for (const [label, val] of rows) {
        ctx.textAlign = 'left';
        ctx.font = `500 17px ${FONT}`;
        ctx.fillStyle = '#cfd6e2';
        ctx.fillText(label, x + 56, ry);
        ctx.textAlign = 'right';
        ctx.font = `700 18px ${MONO_FONT}`;
        ctx.fillStyle = PALETTE.hudAmber;
        ctx.fillText(val, x + w - 56, ry);
        ry += 36;
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(x + 56, ry + 6);
      ctx.lineTo(x + w - 56, ry + 6);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = `800 24px ${FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.fillText('FINAL SCORE', x + 56, ry + 22);
      ctx.textAlign = 'right';
      ctx.font = `800 28px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudGreen;
      ctx.fillText(`${b.total}`, x + w - 56, ry + 20);

      ctx.textAlign = 'center';
      ctx.font = `600 14px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(`BEST SCORE: ${best}`, FIELD.width * 0.5, ry + 66);
    } else {
      ctx.font = `500 17px ${FONT}`;
      ctx.fillStyle = '#cfd6e2';
      ctx.fillText(`Rings Cleared: ${state.ringsPassed} / 8   •   Flight Time: ${formatClock(state.missionTime)}`, FIELD.width * 0.5, y + 124);
      ctx.font = `700 20px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.fillText(`SCORE: ${state.scoreBreakdown.total}   (BEST: ${best})`, FIELD.width * 0.5, y + 170);
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.fillText(
        fuelOut
          ? 'Tip: Ease throttle back to 55-65% once airborne to conserve fuel.'
          : 'Tip: Flare nose slightly up before touchdown to keep descent smooth.',
        FIELD.width * 0.5,
        y + 216,
      );
    }

    const btnY = y + h - 78;
    drawButton('btn-restart', x + 48, btnY, 212, 48, 'FLY AGAIN  (SPACE)', true, hoverId, accent);
    drawButton('btn-title', x + w - 260, btnY, 212, 48, 'TITLE SCREEN', false, hoverId, PALETTE.hudMuted);
  }

  function draw(state, screen, opts) {
    resize();
    buttons.length = 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    const { best = 0, selectedMode = MODE_MISSION, hoverId = null, muted = false, invertPitch = false, mouseYoke = false } = opts || {};

    if (screen === SCREEN_TITLE) {
      drawTitleScreen(selectedMode, best, hoverId);
      return;
    }

    // Active target position for compass & turn indicator
    let targetPos = { x: RUNWAY.x, z: RUNWAY.zStart };
    if (state.mode === MODE_MISSION && state.ringsPassed < MISSION_RINGS.length) {
      targetPos = MISSION_RINGS[state.ringsPassed];
    }

    drawCompassStrip(state, targetPos);
    drawMissionPanel(state, targetPos);
    drawArtificialHorizon(state.plane);
    drawLeftInstruments(state);
    drawRightInstruments(state);

    if (screen === SCREEN_PLAY) {
      drawTopRightControls(hoverId, muted, mouseYoke);
      drawWarningsAndToast(state, targetPos);
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
