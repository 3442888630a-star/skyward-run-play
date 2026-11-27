// 2D Canvas cockpit instruments HUD and interactive UI overlays (Title, Pause, Help, End).
// Designed to stay razor-sharp over the WebGL1 3D scene with clickable hit regions.

import { FIELD, FONT, MISSION_RINGS, MODE_FREE, MODE_MISSION, MONO_FONT, PALETTE, PLANE, RUNWAY, WORLD } from './config.js';
import { clamp, dot3, normalize3, wrapAngle } from './math.js';
import { terrainHeight, waterLevelAt } from './terrain.js';
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

  function drawPanelBox(x, y, w, h, r = 10, fill = PALETTE.hudBg, stroke = PALETTE.hudBezel, shadow = true) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(4, 8, 16, 0.46)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;
    }
    roundRectPath(ctx, x, y, w, h, r);
    if (typeof fill === 'string' && fill === PALETTE.hudBg) {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, 'rgba(18, 27, 42, 0.78)');
      grad.addColorStop(1, 'rgba(9, 14, 24, 0.86)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = fill;
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.lineWidth = 1.25;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // Subtle top-edge inner glass specular highlight
    if (w > 24 && h > 16) {
      const inset = 1.25;
      const rad = Math.min(Math.max(2, r - inset), (w - inset * 2) * 0.5, (h - inset * 2) * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset + rad);
      ctx.quadraticCurveTo(x + inset, y + inset, x + inset + rad, y + inset);
      ctx.lineTo(x + w - inset - rad, y + inset);
      ctx.quadraticCurveTo(x + w - inset, y + inset, x + w - inset, y + inset + rad);
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawButton(id, x, y, w, h, label, active, hoverId, accent = PALETTE.hudAmber, primary = false) {
    addButton(id, x, y, w, h);
    const hovered = hoverId === id;
    ctx.save();
    if (primary) {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (hovered) {
        grad.addColorStop(0, '#ffd478');
        grad.addColorStop(1, '#e89030');
      } else {
        grad.addColorStop(0, '#f8be56');
        grad.addColorStop(1, '#d87b24');
      }
      ctx.shadowColor = hovered ? 'rgba(255, 190, 85, 0.45)' : 'rgba(255, 170, 60, 0.26)';
      ctx.shadowBlur = hovered ? 18 : 12;
      ctx.shadowOffsetY = 4;
      roundRectPath(ctx, x, y, w, h, 9);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.72)';
      ctx.stroke();

      ctx.font = `800 16px ${FONT}`;
      ctx.fillStyle = '#131720';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 0.5);
    } else {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      if (active) {
        grad.addColorStop(0, 'rgba(255, 194, 92, 0.28)');
        grad.addColorStop(1, 'rgba(215, 130, 42, 0.18)');
      } else if (hovered) {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        grad.addColorStop(1, 'rgba(200, 216, 240, 0.09)');
      } else {
        grad.addColorStop(0, 'rgba(22, 33, 50, 0.80)');
        grad.addColorStop(1, 'rgba(11, 17, 28, 0.88)');
      }
      const stroke = active || hovered ? accent : 'rgba(255, 255, 255, 0.20)';
      drawPanelBox(x, y, w, h, 8, grad, stroke, false);
      ctx.font = `600 14px ${FONT}`;
      ctx.fillStyle = active ? accent : PALETTE.hudText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 0.5);
    }
    ctx.restore();
  }

  function drawCompassStrip(state, targetPos) {
    const cx = FIELD.width * 0.5;
    const x = cx - 216;
    const y = 14;
    const w = 432;
    const h = 44;
    drawPanelBox(x, y, w, h, 10);

    const headingDeg = ((state.plane.heading * 180) / Math.PI) % 360;
    const pxPerDeg = 3.2;

    ctx.save();
    roundRectPath(ctx, x + 6, y + 2, w - 12, h - 4, 8);
    ctx.clip();

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
    for (let deg = 0; deg < 360; deg += 5) {
      let diff = deg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const tx = cx + diff * pxPerDeg;
      if (tx < x - 20 || tx > x + w + 20) continue;

      const major = deg % 30 === 0;
      const med = deg % 15 === 0;
      const edgeFade = clamp(1 - Math.max(0, Math.abs(tx - cx) - (w * 0.36)) / (w * 0.14), 0.1, 1);
      ctx.globalAlpha = edgeFade;
      ctx.strokeStyle = deg === 0 ? PALETTE.hudGreen : major ? 'rgba(244, 241, 234, 0.72)' : 'rgba(244, 241, 234, 0.32)';
      ctx.lineWidth = major ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, y + h - (major ? 14 : med ? 9 : 6));
      ctx.lineTo(tx, y + h - 3);
      ctx.stroke();

      if (major) {
        ctx.font = `700 13px ${MONO_FONT}`;
        ctx.fillStyle = deg === 0 ? PALETTE.hudGreen : PALETTE.hudText;
        ctx.fillText(labels.get(deg) || '', tx, y + 6);
      }
    }
    ctx.globalAlpha = 1;

    // Target bearing bug on compass strip
    if (targetPos) {
      const dx = targetPos.x - state.plane.pos.x;
      const dz = targetPos.z - state.plane.pos.z;
      const targetBrg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      let diff = targetBrg - headingDeg;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      const bx = clamp(cx + diff * pxPerDeg, x + 16, x + w - 16);
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
    ctx.moveTo(cx, y + 2);
    ctx.lineTo(cx - 5.5, y - 5);
    ctx.lineTo(cx + 5.5, y - 5);
    ctx.closePath();
    ctx.fill();

    drawPanelBox(cx - 42, y + h + 4, 84, 23, 6, 'rgba(11, 17, 28, 0.88)', 'rgba(255, 190, 85, 0.65)', false);
    const dispHdg = Math.round(headingDeg) || 360;
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`HDG ${String(dispHdg).padStart(3, '0')}°`, cx, y + h + 15.5);
  }

  function drawMissionPanel(state, targetPos) {
    const x = 18;
    const y = 14;
    const w = 298;
    const h = 88;
    drawPanelBox(x, y, w, h, 12);

    // Subtle top accent bar
    ctx.save();
    const isMission = state.mode === MODE_MISSION;
    ctx.fillStyle = isMission ? PALETTE.hudAmber : PALETTE.hudCyan;
    roundRectPath(ctx, x + 14, y + 1, 54, 2.5, 1.25);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (isMission) {
      const done = state.ringsPassed;
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.fillText(`MISSION  •  ${formatClock(state.missionTime)}`, x + 15, y + 11);

      // Combo multiplier badge on top right of mission card
      const mult = state.comboMult || 1;
      const streak = state.ringCombo || 0;
      const comboCol = mult >= 3 ? PALETTE.hudGreen : mult >= 2 ? PALETTE.hudCyan : PALETTE.hudMuted;
      ctx.font = `700 12px ${MONO_FONT}`;
      ctx.fillStyle = comboCol;
      ctx.textAlign = 'right';
      ctx.fillText(streak > 0 ? `COMBO ×${mult} (${streak})` : 'COMBO ×1', x + w - 14, y + 12);
      ctx.textAlign = 'left';

      // 8 ring pips
      for (let i = 0; i < MISSION_RINGS.length; i += 1) {
        const px = x + 16 + i * 24;
        const py = y + 36;
        const cxPip = px + 7;
        const cyPip = py + 7;
        ctx.beginPath();
        ctx.arc(cxPip, cyPip, 7, 0, Math.PI * 2);
        if (i < done) {
          ctx.fillStyle = PALETTE.hudGreen;
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.beginPath();
          ctx.arc(cxPip - 2, cyPip - 2, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (i === done) {
          ctx.fillStyle = PALETTE.hudCyan;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.textAlign = 'right';
      ctx.fillText(`${state.ringScore} PTS`, x + w - 14, y + 35);

      ctx.textAlign = 'left';
      ctx.font = `600 13px ${FONT}`;
      if (done < MISSION_RINGS.length) {
        const ring = MISSION_RINGS[done];
        const dist = Math.round(Math.hypot(ring.x - state.plane.pos.x, ring.z - state.plane.pos.z));
        ctx.fillStyle = PALETTE.hudCyan;
        ctx.fillText(`NEXT: RING ${done + 1} (${ring.label}) — ${dist} m`, x + 15, y + 63);
      } else {
        const dist = Math.round(Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z));
        ctx.fillStyle = PALETTE.hudGreen;
        ctx.fillText(`LAND RUNWAY 36 — ${dist} m`, x + 15, y + 63);
      }
    } else {
      ctx.font = `700 15px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(`FREE FLIGHT  •  ${formatClock(state.missionTime)}`, x + 15, y + 13);
      const dist = Math.round(Math.hypot(RUNWAY.x - state.plane.pos.x, RUNWAY.zStart - state.plane.pos.z));
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.fillText(`Runway 36 Threshold: ${dist} m`, x + 15, y + 39);
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.fillText('Practice circuits & smooth landings', x + 15, y + 61);
    }
  }

  function drawTopRightControls(hoverId, muted, mouseYoke) {
    const y = 14;
    drawButton('btn-help', FIELD.width - 376, y, 82, 32, '[H] HELP', false, hoverId, PALETTE.hudCyan);
    drawButton('btn-yoke', FIELD.width - 286, y, 88, 32, mouseYoke ? 'YOKE ON' : '[U] YOKE', mouseYoke, hoverId, PALETTE.hudCyan);
    drawButton('btn-mute', FIELD.width - 190, y, 82, 32, muted ? 'MUTED' : '[M] SFX', muted, hoverId, PALETTE.hudAmber);
    drawButton('btn-pause', FIELD.width - 100, y, 82, 32, '[P] PAUSE', false, hoverId, PALETTE.hudAmber);
  }

  function drawArtificialHorizon(plane) {
    const cx = FIELD.width * 0.5;
    const cy = FIELD.height - 88;
    const r = 68;

    ctx.save();
    ctx.globalAlpha = 0.45;
    drawPanelBox(cx - r - 9, cy - r - 9, (r + 9) * 2, (r + 9) * 2, r + 9);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Rotate by -roll, shift vertically by pitch
    const pitchPx = clamp((plane.pitch * 180) / Math.PI, -45, 45) * 2.1;
    ctx.translate(cx, cy);
    ctx.rotate(-plane.roll);

    // Gradient sky & ground halves (synthetic glass cockpit attitude look)
    const skyGrad = ctx.createLinearGradient(0, -r * 2 + pitchPx, 0, pitchPx);
    skyGrad.addColorStop(0, '#183963');
    skyGrad.addColorStop(0.65, '#2f639b');
    skyGrad.addColorStop(1, '#5897cb');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-r * 2, -r * 3 + pitchPx, r * 4, r * 3);

    const gndGrad = ctx.createLinearGradient(0, pitchPx, 0, r * 2 + pitchPx);
    gndGrad.addColorStop(0, '#855532');
    gndGrad.addColorStop(0.5, '#5b361c');
    gndGrad.addColorStop(1, '#341e0e');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(-r * 2, pitchPx, r * 4, r * 3);

    // Subtle horizon glow + crisp horizon line
    ctx.fillStyle = 'rgba(255, 226, 180, 0.16)';
    ctx.fillRect(-r * 2, pitchPx - 3, r * 4, 6);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.6, pitchPx);
    ctx.lineTo(r * 1.6, pitchPx);
    ctx.stroke();

    // Pitch ladder (-20, -10, +10, +20 deg + 5 deg minor ticks)
    ctx.font = `700 10px ${MONO_FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.textBaseline = 'middle';
    for (const deg of [-20, -10, -5, 5, 10, 20]) {
      const py = pitchPx - deg * 2.1;
      const isMajor = Math.abs(deg) >= 10;
      const hw = Math.abs(deg) === 20 ? 23 : Math.abs(deg) === 10 ? 15 : 8;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.52)';
      ctx.lineWidth = isMajor ? 1.5 : 1.1;
      ctx.beginPath();
      ctx.moveTo(-hw, py);
      ctx.lineTo(-5, py);
      ctx.moveTo(5, py);
      ctx.lineTo(hw, py);
      ctx.stroke();
      if (isMajor) {
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.abs(deg)), -hw - 3, py);
      }
    }

    // Dynamic roll pointer triangle under top scale
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -r + 11);
    ctx.lineTo(-4.5, -r + 18);
    ctx.lineTo(4.5, -r + 18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Subtle glass dome reflection sheen
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const gloss = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.4, cy + r * 0.4);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    gloss.addColorStop(0.45, 'rgba(255, 255, 255, 0.03)');
    gloss.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
    ctx.fillStyle = gloss;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Fixed roll scale ticks at top of bezel
    ctx.save();
    ctx.translate(cx, cy);
    for (const deg of [-45, -30, -15, 0, 15, 30, 45]) {
      const a = (deg * Math.PI) / 180 - Math.PI * 0.5;
      const rIn = deg === 0 ? r - 9 : r - 6;
      ctx.strokeStyle = deg === 0 ? PALETTE.hudAmber : 'rgba(255,255,255,0.72)';
      ctx.lineWidth = deg === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      ctx.lineTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1));
      ctx.stroke();
    }
    ctx.restore();

    // Fixed center aircraft waterline symbol with subtle shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = PALETTE.hudAmber;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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
    ctx.restore();

    // Machined bezel ring
    ctx.strokeStyle = 'rgba(255, 200, 120, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLeftInstruments(state) {
    const p = state.plane;
    const kts = Math.round(p.speed * 1.94384);
    const thrPct = Math.round(p.throttle * 100);
    const fuelPct = Math.round(p.fuel);

    // Airspeed Indicator
    const sx = 20;
    const sy = FIELD.height - 154;
    drawPanelBox(sx, sy, 146, 136, 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('AIRSPEED', sx + 13, sy + 11);

    ctx.font = `700 34px ${MONO_FONT}`;
    ctx.fillStyle = p.isStalling ? PALETTE.hudRed : PALETTE.hudText;
    ctx.fillText(`${kts}`, sx + 13, sy + 28);
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('KT', sx + 88, sy + 44);

    // Speed bar with stall marker
    const bx = sx + 13;
    const by = sy + 80;
    const bw = 120;
    roundRectPath(ctx, bx, by, bw, 12, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();

    const stallFrac = (PLANE.stallSpeed * 1.94384) / 170;
    roundRectPath(ctx, bx, by, bw * stallFrac, 12, 4);
    ctx.fillStyle = 'rgba(255, 93, 85, 0.36)';
    ctx.fill();

    const spdFrac = clamp(kts / 170, 0, 1);
    if (spdFrac > 0.02) {
      const spdGrad = ctx.createLinearGradient(bx, by, bx + bw * spdFrac, by);
      spdGrad.addColorStop(0, p.isStalling ? '#d93832' : '#2ea89c');
      spdGrad.addColorStop(1, p.isStalling ? PALETTE.hudRed : PALETTE.hudCyan);
      roundRectPath(ctx, bx, by, Math.max(6, bw * spdFrac), 12, 4);
      ctx.fillStyle = spdGrad;
      ctx.fill();
    }
    roundRectPath(ctx, bx, by, bw, 12, 4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = `600 11px ${MONO_FONT}`;
    ctx.fillStyle = p.isStalling ? PALETTE.hudRed : PALETTE.hudMuted;
    ctx.fillText(p.isStalling ? '!! STALL SPEED !!' : 'STALL < 45 KT', sx + 13, sy + 104);

    // Throttle & Fuel dual vertical panel
    const gx = 178;
    const gy = FIELD.height - 154;
    drawPanelBox(gx, gy, 152, 136, 12);

    drawVerticalGauge(gx + 16, gy + 12, 52, 112, p.throttle, 'THR', `${thrPct}%`, PALETTE.hudAmber);
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
    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();

    const fillH = clamp(ratio, 0, 1) * barH;
    if (fillH > 1) {
      ctx.save();
      roundRectPath(ctx, bx, by, barW, barH, 5);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(bx, by + barH - fillH, barW, fillH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(bx + 2, by + barH - fillH, 4, fillH);
      ctx.restore();
    }

    // Subtle quarter tick marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const ty = by + barH * frac;
      ctx.beginPath();
      ctx.moveTo(bx + 1, ty);
      ctx.lineTo(bx + 5, ty);
      ctx.stroke();
    }

    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.stroke();

    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(valueText, x + w * 0.5, y + 93);
  }

  function drawRightInstruments(state) {
    const p = state.plane;
    const altFt = Math.round(p.pos.y * 3.28084);
    const groundY = Math.max(waterLevelAt(p.pos.x, p.pos.z), terrainHeight(p.pos.x, p.pos.z));
    const aglFt = Math.max(0, Math.round((p.pos.y - groundY) * 3.28084));
    const fpm = Math.round(p.verticalSpeed * 196.85);

    // Altimeter
    const ax = FIELD.width - 330;
    const ay = FIELD.height - 154;
    drawPanelBox(ax, ay, 152, 136, 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('ALTITUDE', ax + 14, ay + 11);

    ctx.font = `700 32px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(`${altFt}`, ax + 14, ay + 30);
    ctx.font = `700 12px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('FT MSL', ax + 14, ay + 68);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax + 14, ay + 92);
    ctx.lineTo(ax + 138, ay + 92);
    ctx.stroke();

    ctx.font = `600 13px ${MONO_FONT}`;
    ctx.fillStyle = aglFt < 80 ? PALETTE.hudAmber : PALETTE.hudCyan;
    ctx.fillText(`AGL ${aglFt} FT`, ax + 14, ay + 102);

    // Vertical Speed Indicator (VSI)
    const vx = FIELD.width - 166;
    const vy = FIELD.height - 154;
    drawPanelBox(vx, vy, 146, 136, 12);
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('VERT SPD', vx + 13, vy + 11);

    const sign = fpm >= 0 ? '+' : '';
    const safeSink = fpm <= -80 && fpm >= -600;
    const hardSink = fpm < -850;
    ctx.font = `700 24px ${MONO_FONT}`;
    ctx.fillStyle = hardSink ? PALETTE.hudRed : safeSink ? PALETTE.hudGreen : PALETTE.hudText;
    ctx.fillText(`${sign}${fpm}`, vx + 13, vy + 32);
    ctx.font = `700 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.fillText('FPM', vx + 13, vy + 62);

    const barX = vx + 114;
    const barY = vy + 18;
    const barH = 100;
    const midY = barY + barH * 0.5;
    roundRectPath(ctx, barX, barY, 16, barH, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();

    // Safe landing descent bracket (-100 to -600 fpm)
    const safeTop = midY + (100 / 1500) * (barH * 0.5);
    const safeBot = midY + (600 / 1500) * (barH * 0.5);
    ctx.fillStyle = 'rgba(106, 230, 123, 0.28)';
    ctx.fillRect(barX - 3, safeTop, 22, safeBot - safeTop);

    const norm = clamp(fpm / 1500, -1, 1);
    const tipY = midY - norm * (barH * 0.5);
    ctx.fillStyle = hardSink ? PALETTE.hudRed : safeSink ? PALETTE.hudGreen : PALETTE.hudCyan;
    if (tipY < midY) ctx.fillRect(barX + 1, tipY, 14, midY - tipY);
    else ctx.fillRect(barX + 1, midY, 14, tipY - midY);

    roundRectPath(ctx, barX, barY, 16, barH, 4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX - 4, midY);
    ctx.lineTo(barX + 20, midY);
    ctx.stroke();

    ctx.font = `600 11px ${MONO_FONT}`;
    ctx.fillStyle = safeSink ? PALETTE.hudGreen : PALETTE.hudMuted;
    ctx.fillText(safeSink ? 'GLIDESLOPE OK' : p.onGround ? 'ON GROUND' : 'GREEN = LAND', vx + 13, vy + 104);
  }

  function drawSunGlare(cam) {
    if (!cam || !cam.isCockpit) return;
    const sunDir = normalize3({ x: PALETTE.sunDir[0], y: PALETTE.sunDir[1], z: PALETTE.sunDir[2] });
    const sunDot = dot3(cam.forward, sunDir);
    const cosLimit = 0.875; // ~29 deg outer onset, strong inside ~25 deg (0.906)
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
    glow.addColorStop(0.0, `rgba(255, 224, 155, ${0.28 * glare})`);
    glow.addColorStop(0.32, `rgba(255, 178, 92, ${0.14 * glare})`);
    glow.addColorStop(0.7, `rgba(240, 124, 58, ${0.05 * glare})`);
    glow.addColorStop(1.0, 'rgba(240, 120, 50, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    // Subtle soft secondary lens-flare discs along optical axis (keeps gauges legible)
    const ox = FIELD.width * 0.5;
    const oy = FIELD.height * 0.5;
    for (const [t, rad, col] of [
      [-0.35, 42, `rgba(255, 195, 115, ${0.08 * glare})`],
      [-0.68, 66, `rgba(255, 160, 95, ${0.06 * glare})`],
    ]) {
      const fx = ox + (sx - ox) * t;
      const fy = oy + (sy - oy) * t;
      const fg = ctx.createRadialGradient(fx, fy, 4, fx, fy, rad);
      fg.addColorStop(0, col);
      fg.addColorStop(1, 'rgba(255, 160, 95, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOffscreenEdgeArrow(state, targetPos, cam) {
    if (!targetPos || state.plane.onGround) return;
    const p = state.plane;
    const tx = targetPos.x;
    const ty = targetPos.y !== undefined ? targetPos.y : RUNWAY.elevation + 10;
    const tz = targetPos.z;
    const distM = Math.hypot(tx - p.pos.x, ty - p.pos.y, tz - p.pos.z);

    let dirX = 0;
    let dirY = 0;
    let offscreen = false;

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
      if (cz <= 0 || Math.abs(nx) > 0.90 || Math.abs(ny) > 0.84) {
        offscreen = true;
        dirX = cx / tanX;
        dirY = -cy / tanY;
      }
    } else {
      const brg = Math.atan2(tx - p.pos.x, -(tz - p.pos.z));
      const diff = wrapAngle(brg - p.heading);
      if (Math.abs(diff) > 0.48) {
        offscreen = true;
        dirX = diff > 0 ? 1 : -1;
        dirY = 0;
      }
    }

    if (!offscreen) return;
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;

    const halfW = FIELD.width * 0.5 - 66;
    const minY = 126;
    const maxY = state.camMode === 2 ? FIELD.height - 96 : FIELD.height - 196;
    const cyMid = (minY + maxY) * 0.5;
    const halfH = (maxY - minY) * 0.5;
    const txScale = Math.abs(dirX) > 1e-4 ? halfW / Math.abs(dirX) : 1e6;
    const tyScale = Math.abs(dirY) > 1e-4 ? halfH / Math.abs(dirY) : 1e6;
    const tEdge = Math.min(txScale, tyScale);
    const ax = clamp(FIELD.width * 0.5 + dirX * tEdge, 66, FIELD.width - 66);
    const ay = clamp(cyMid + dirY * tEdge, minY, maxY);

    const isRwy = state.mode === MODE_FREE || state.ringsPassed >= MISSION_RINGS.length;
    const col = isRwy ? PALETTE.hudGreen : PALETTE.hudCyan;
    const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(1)}km` : `${Math.round(distM)}m`;

    ctx.save();
    drawPanelBox(ax - 44, ay - 22, 88, 44, 10, 'rgba(11, 17, 26, 0.80)', col);
    // Directional arrow rotated toward target
    const ang = Math.atan2(dirY, dirX);
    ctx.save();
    ctx.translate(ax - 22, ay);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(distLabel, ax + 12, ay + 1);
    ctx.restore();
  }

  function drawWarningsAndToast(state, targetPos, cam) {
    const cx = FIELD.width * 0.5;
    drawOffscreenEdgeArrow(state, targetPos, cam);

    // Center-screen PERFECT / GOOD / GRAZE / MISSED callout
    if (state.calloutTimer > 0 && state.calloutText) {
      const alpha = clamp(state.calloutTimer / 0.35, 0, 1);
      const cy = FIELD.height * 0.28;
      const col = state.calloutColor || PALETTE.hudAmber;
      ctx.save();
      ctx.globalAlpha = alpha;
      drawPanelBox(cx - 145, cy - 28, 290, 56, 12, 'rgba(11, 17, 26, 0.84)', col);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 19px ${FONT}`;
      ctx.fillStyle = col;
      ctx.fillText(state.calloutText, cx, cy - 7);
      if (state.calloutSub) {
        ctx.font = `700 12.5px ${MONO_FONT}`;
        ctx.fillStyle = PALETTE.hudText;
        ctx.fillText(state.calloutSub, cx, cy + 14);
      }
      ctx.restore();
    }

    // Critical warnings above artificial horizon
    const warnY = state.camMode === 2 ? 130 : FIELD.height - 196;
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

  function drawWingEmblem(cx, cy) {
    ctx.save();
    const grad = ctx.createLinearGradient(cx - 40, cy - 10, cx + 40, cy + 10);
    grad.addColorStop(0, '#ffd888');
    grad.addColorStop(0.5, '#f6b148');
    grad.addColorStop(1, '#d97c28');
    ctx.strokeStyle = grad;
    ctx.fillStyle = grad;
    ctx.lineWidth = 2;

    // Stylized aviation wings + center horizon chevron
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 12, cy);
      ctx.lineTo(cx + side * 42, cy - 7);
      ctx.lineTo(cx + side * 34, cy);
      ctx.lineTo(cx + side * 14, cy + 4);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx + side * 12, cy + 6);
      ctx.lineTo(cx + side * 30, cy + 3);
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
    // Subtle left atmospheric scrim so glassy card pops without darkening the 3D scene
    const scrim = ctx.createLinearGradient(0, 0, 560, 0);
    scrim.addColorStop(0, 'rgba(7, 11, 20, 0.36)');
    scrim.addColorStop(0.75, 'rgba(7, 11, 20, 0.10)');
    scrim.addColorStop(1, 'rgba(7, 11, 20, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, 560, FIELD.height);

    // Compact left-aligned glass card leaving the cockpit gauges, canyon & plane unobstructed
    const x = 34;
    const y = 30;
    const w = 440;
    const h = 426;
    const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
    cardGrad.addColorStop(0, 'rgba(15, 23, 36, 0.78)');
    cardGrad.addColorStop(1, 'rgba(8, 13, 22, 0.86)');
    drawPanelBox(x, y, w, h, 16, cardGrad, 'rgba(255, 204, 128, 0.36)', true);

    // Top golden accent hairline
    ctx.save();
    const topBar = ctx.createLinearGradient(x + 28, y, x + w - 28, y);
    topBar.addColorStop(0, 'rgba(255, 190, 85, 0.85)');
    topBar.addColorStop(0.5, 'rgba(255, 224, 160, 0.55)');
    topBar.addColorStop(1, 'rgba(255, 190, 85, 0)');
    ctx.fillStyle = topBar;
    ctx.fillRect(x + 28, y + 1, w - 56, 2);
    ctx.restore();

    drawWingEmblem(x + 64, y + 28);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11.5px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('GOLDEN-HOUR FLIGHT CHALLENGE', x + 112, y + 29);

    ctx.textBaseline = 'top';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    const titleGrad = ctx.createLinearGradient(x + 24, y + 46, x + 24, y + 96);
    titleGrad.addColorStop(0, '#fffdf7');
    titleGrad.addColorStop(1, '#f3d49c');
    ctx.font = `800 44px ${FONT}`;
    ctx.fillStyle = titleGrad;
    ctx.fillText('SKYWARD RUN', x + 24, y + 46);
    ctx.restore();

    ctx.font = `400 13.5px ${FONT}`;
    ctx.fillStyle = '#d8dee8';
    ctx.fillText('Carve through alpine peaks & canyon walls, clear 8 rings,', x + 26, y + 100);
    ctx.fillText('manage your fuel, and touch down softly on Runway 36.', x + 26, y + 119);

    // Mode selector cards
    const m1Y = y + 150;
    const m2Y = y + 220;
    drawModeCard(
      'mode-mission',
      x + 24,
      m1Y,
      w - 48,
      62,
      'MISSION MODE',
      '8 Target Rings • Wind & Fuel • Scored RWY 36 Landing',
      selectedMode === MODE_MISSION,
      hoverId,
    );
    drawModeCard(
      'mode-free',
      x + 24,
      m2Y,
      w - 48,
      62,
      'FREE FLIGHT',
      'No Rings • Unlimited Fuel • Open Exploration',
      selectedMode === MODE_FREE,
      hoverId,
    );

    // Primary Start CTA
    drawButton('btn-start', x + 24, y + 296, w - 48, 44, 'TAKE OFF  (SPACE / ENTER)', true, hoverId, PALETTE.hudAmber, true);

    // Best score + secondary Help button
    ctx.font = `700 12.5px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudCyan;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`BEST SCORE: ${best}`, x + 26, y + 364);
    drawButton('btn-help', x + w - 152, y + 348, 128, 32, '[H] CONTROLS', false, hoverId, PALETTE.hudCyan);

    // Compact footer controls hint
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 24, y + 392);
    ctx.lineTo(x + w - 24, y + 392);
    ctx.stroke();

    ctx.font = `500 11px ${MONO_FONT}`;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.textAlign = 'left';
    ctx.fillText('W/S Pitch • A/D Roll • Q/E Yaw • V Cockpit • Shift/X Thr', x + 24, y + 408);
  }

  function drawModeCard(id, x, y, w, h, title, desc, selected, hoverId) {
    addButton(id, x, y, w, h);
    const hovered = hoverId === id;
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    if (selected) {
      grad.addColorStop(0, 'rgba(255, 192, 88, 0.20)');
      grad.addColorStop(1, 'rgba(220, 138, 42, 0.09)');
    } else if (hovered) {
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
    } else {
      grad.addColorStop(0, 'rgba(22, 32, 48, 0.68)');
      grad.addColorStop(1, 'rgba(14, 21, 33, 0.76)');
    }
    const stroke = selected ? PALETTE.hudAmber : hovered ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.14)';
    drawPanelBox(x, y, w, h, 11, grad, stroke, false);

    if (selected) {
      ctx.fillStyle = PALETTE.hudAmber;
      roundRectPath(ctx, x + 2, y + 14, 3.5, h - 28, 2);
      ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = selected ? PALETTE.hudAmber : PALETTE.hudText;
    ctx.fillText((selected ? '▸ ' : '  ') + title, x + 16, y + 11);

    ctx.font = `400 12.5px ${FONT}`;
    ctx.fillStyle = selected ? '#f2e8d5' : PALETTE.hudMuted;
    ctx.fillText(desc, x + 16, y + 36);
  }

  function drawPauseModal(hoverId, invertPitch) {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.34)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const w = 440;
    const h = 360;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(15, 23, 38, 0.90)');
    grad.addColorStop(1, 'rgba(8, 13, 22, 0.94)');
    drawPanelBox(x, y, w, h, 16, grad, 'rgba(255, 190, 85, 0.65)', true);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 34px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText('FLIGHT PAUSED', FIELD.width * 0.5, y + 30);

    drawButton('btn-resume', x + 50, y + 96, w - 100, 46, 'RESUME FLIGHT  (P / ESC)', true, hoverId, PALETTE.hudAmber, true);
    drawButton('btn-invert', x + 50, y + 154, w - 100, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'}  (I)`, invertPitch, hoverId, PALETTE.hudCyan);
    drawButton('btn-help', x + 50, y + 208, w - 100, 42, 'CONTROLS & HELP  (H)', false, hoverId, PALETTE.hudCyan);
    drawButton('btn-restart', x + 50, y + 262, 162, 42, 'RESTART', false, hoverId, PALETTE.hudAmber);
    drawButton('btn-title', x + w - 212, y + 262, 162, 42, 'TITLE SCREEN', false, hoverId, PALETTE.hudMuted);
  }

  function drawHelpModal(hoverId, invertPitch) {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.42)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const w = 740;
    const h = 500;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(13, 20, 34, 0.94)');
    grad.addColorStop(1, 'rgba(7, 12, 20, 0.96)');
    drawPanelBox(x, y, w, h, 16, grad, 'rgba(88, 226, 199, 0.55)', true);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
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
      drawPanelBox(x + 34, ry - 4, 210, 30, 6, 'rgba(88, 226, 199, 0.12)', 'rgba(88, 226, 199, 0.35)', false);
      ctx.font = `700 13px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(key, x + 46, ry + 5);

      ctx.font = `400 14.5px ${FONT}`;
      ctx.fillStyle = '#e5e9f0';
      ctx.fillText(desc, x + 262, ry + 4);
      ry += 38;
    }

    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.fillText('Landing Tip: Approach Runway 36 heading North (360°) with speed ~55-70 KT and VSI in the green band.', x + 36, y + 392);

    drawButton('btn-invert', x + 36, y + 432, 230, 42, `INVERT PITCH: ${invertPitch ? 'ON' : 'OFF'} (I)`, invertPitch, hoverId, PALETTE.hudCyan);
    drawButton('btn-close-help', x + w - 236, y + 432, 200, 42, 'CLOSE  (H / ESC)', true, hoverId, PALETTE.hudAmber, true);
  }

  function drawEndScreen(state, best, hoverId) {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.32)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);

    const win = state.outcome === OUTCOME_WIN;
    const fuelOut = state.outcome === OUTCOME_FUEL;
    const w = 576;
    const h = win ? 506 : 374;
    const x = (FIELD.width - w) * 0.5;
    const y = (FIELD.height - h) * 0.5 + 8;
    const accent = win ? PALETTE.hudGreen : fuelOut ? PALETTE.hudAmber : PALETTE.hudRed;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(14, 22, 36, 0.88)');
    grad.addColorStop(1, 'rgba(8, 13, 22, 0.94)');
    drawPanelBox(x, y, w, h, 18, grad, accent, true);

    // Top accent glow line
    ctx.fillStyle = accent;
    roundRectPath(ctx, x + 120, y + 1, w - 240, 3, 1.5);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 12.5px ${MONO_FONT}`;
    ctx.fillStyle = accent;
    ctx.fillText(win ? 'MISSION COMPLETE' : fuelOut ? 'OUT OF FUEL' : 'FLIGHT TERMINATED', FIELD.width * 0.5, y + 18);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 10;
    ctx.font = `800 30px ${FONT}`;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(win ? 'SAFE TOUCHDOWN — RWY 36' : state.failReason || 'CRASH LANDING', FIELD.width * 0.5, y + 38);
    ctx.restore();

    if (win) {
      const b = state.scoreBreakdown;
      const maxStreak = state.maxCombo || 0;
      const maxMult = maxStreak >= 5 ? 3 : maxStreak >= 3 ? 2 : 1;
      const sinkFpm = Math.round(-(state.plane.touchdownSink || 0) * 196.85);
      const rows = [
        ['Target Rings (8 / 8)', `${b.rings}`, PALETTE.hudAmber],
        [`Time (${formatClock(state.missionTime)})`, `+${b.time}`, PALETTE.hudAmber],
        [`Fuel Remaining (${Math.round(state.plane.fuel)}%)`, `+${b.fuel}`, PALETTE.hudAmber],
        [`Landing Grade: ${state.plane.landingGrade}`, `+${b.landing}`, PALETTE.hudAmber],
        ['PERFECT Rings', `${state.perfectRings || 0} / 8`, PALETTE.hudGreen],
        ['Max Combo', `×${maxMult} (${maxStreak} streak)`, PALETTE.hudCyan],
        ['Final Glideslope', state.plane.glideslopeGrade || 'ON GLIDESLOPE (A)', PALETTE.hudCyan],
        ['Touchdown V/S', `-${(state.plane.touchdownSink || 0).toFixed(2)} m/s (${sinkFpm} fpm)`, PALETTE.hudGreen],
      ];
      let ry = y + 88;
      for (let idx = 0; idx < rows.length; idx += 1) {
        const [label, val, valCol] = rows[idx];
        if (idx % 2 === 0) {
          roundRectPath(ctx, x + 40, ry - 4, w - 80, 26, 6);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.fill();
        }
        ctx.textAlign = 'left';
        ctx.font = `500 14.5px ${FONT}`;
        ctx.fillStyle = '#d3dae6';
        ctx.fillText(label, x + 54, ry);
        ctx.textAlign = 'right';
        ctx.font = `700 14.5px ${MONO_FONT}`;
        ctx.fillStyle = valCol;
        ctx.fillText(val, x + w - 54, ry);
        ry += 28;
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 48, ry + 6);
      ctx.lineTo(x + w - 48, ry + 6);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = `800 22px ${FONT}`;
      ctx.fillStyle = PALETTE.hudText;
      ctx.fillText('FINAL SCORE', x + 54, ry + 16);
      ctx.textAlign = 'right';
      ctx.font = `800 26px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudGreen;
      ctx.fillText(`${b.total}`, x + w - 54, ry + 14);

      ctx.textAlign = 'center';
      ctx.font = `600 13.5px ${MONO_FONT}`;
      ctx.fillStyle = PALETTE.hudCyan;
      ctx.fillText(`BEST SCORE: ${best}`, FIELD.width * 0.5, ry + 52);
    } else {
      ctx.font = `500 17px ${FONT}`;
      ctx.fillStyle = '#d3dae6';
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

    const btnY = y + h - 76;
    drawButton('btn-restart', x + 48, btnY, 214, 48, 'FLY AGAIN  (SPACE)', true, hoverId, accent, true);
    drawButton('btn-title', x + w - 262, btnY, 214, 48, 'TITLE SCREEN', false, hoverId, PALETTE.hudMuted);
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

    // Active target position for compass & edge arrow
    let targetPos = { x: RUNWAY.x, y: RUNWAY.elevation + 14, z: RUNWAY.zStart };
    if (state.mode === MODE_MISSION && state.ringsPassed < MISSION_RINGS.length) {
      targetPos = MISSION_RINGS[state.ringsPassed];
    }

    drawCompassStrip(state, targetPos);
    drawMissionPanel(state, targetPos);
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
