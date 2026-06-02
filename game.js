
'use strict';

// Polyfill Canvas roundRect to be completely safe across all browsers
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === 'undefined') r = 0;
    if (typeof r === 'number') {
      r = { tl: r, tr: r, br: r, bl: r };
    } else if (Array.isArray(r)) {
      if (r.length === 1) r = { tl: r[0], tr: r[0], br: r[0], bl: r[0] };
      else if (r.length === 2) r = { tl: r[0], tr: r[1], br: r[0], bl: r[1] };
      else if (r.length === 4) r = { tl: r[0], tr: r[1], br: r[2], bl: r[3] };
      else r = { tl: 0, tr: 0, br: 0, bl: 0 };
    } else {
      r = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, r);
    }
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
    return this;
  };
}

// ─── STARS ───────────────────────────────────────────────────────────────────
(function createStars() {
  ['stars', 'hub-stars', 'galactic-stars', 'slingshot-stars', 'brick-stars'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      const sz = Math.random() * 2.5 + 0.5;
      s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random()*100}%;left:${Math.random()*100}%;--dur:${(Math.random()*3+2).toFixed(1)}s;--delay:-${(Math.random()*5).toFixed(1)}s`;
      c.appendChild(s);
    }
  });
})();

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const LANE_COUNT = 3;
const BASE_SPEED = 4;
const VOTE_SCORE = 50;
const DAY_CYCLE = 1800; // frames per day/night

const MAPS = {
  chennai:    { name:'CHENNAI',    skyDay:['#87CEEB','#FDB97D'], skyNight:['#0A0A2E','#1a1a4e'], ground:'#8B6914', road:'#444', accent:'#FF6B00' },
  coimbatore: { name:'COIMBATORE', skyDay:['#90D5FF','#C8E6C9'], skyNight:['#0D1B2A','#1B2A3B'], ground:'#5D4037', road:'#555', accent:'#4CAF50' },
  madurai:    { name:'MADURAI',    skyDay:['#FFD180','#FF8A65'], skyNight:['#1A0533','#2D0A55'], ground:'#795548', road:'#3A3A3A', accent:'#9C27B0' },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let gameState = 'idle'; // idle | running | paused | over
let selectedMap = 'chennai';
let score, votes, distance, speed, frame, lane, targetLane;
let isJumping, isSlideing, jumpVY, playerY, baseY;
let hasPowerup, powerupTimer, powerupType;
let dayNight; // 0=day, 1=night
let obstacles, collectibles, bgObjects, particles;
let lastTime = 0, animId;

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function getLeaderboard() {
  try {
    const raw = localStorage.getItem('vq_lb');
    if (!raw) return [];
    const lb = JSON.parse(raw);
    return Array.isArray(lb) ? lb : [];
  } catch(e){
    return [];
  }
}
function saveLeaderboard(lb) {
  try { localStorage.setItem('vq_lb', JSON.stringify(lb)); } catch(e){}
}
function addScore(name, sc, vt) {
  const lb = getLeaderboard();
  lb.push({ name, score: sc, votes: vt, date: new Date().toLocaleDateString() });
  lb.sort((a,b) => b.score - a.score);
  lb.splice(10);
  saveLeaderboard(lb);
}

// ─── SCREEN MANAGER ──────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── INIT CANVAS ─────────────────────────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}
function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  baseY = H * 0.72;
}

// ─── GAME INIT ────────────────────────────────────────────────────────────────
function initGame() {
  score = 0; votes = 0; distance = 0; speed = BASE_SPEED; frame = 0;
  lane = 1; targetLane = 1;
  isJumping = false; isSlideing = false; jumpVY = 0;
  playerY = 0; // offset from baseY
  hasPowerup = false; powerupTimer = 0; powerupType = null;
  dayNight = 0;
  obstacles = []; collectibles = []; bgObjects = []; particles = [];
  updateHUD();
  spawnBGObjects();
}

// ─── LANE HELPERS ─────────────────────────────────────────────────────────────
function laneX(l) {
  const margin = W * 0.15;
  const spacing = (W - margin*2) / (LANE_COUNT - 1);
  return margin + l * spacing;
}
function playerX() { return laneX(lane) + (laneX(targetLane) - laneX(lane)) * 0.2; }

// ─── SPAWN ────────────────────────────────────────────────────────────────────
let obTimer = 0, colTimer = 0;
function spawnBGObjects() {
  for (let i = 0; i < 12; i++) {
    bgObjects.push({
      x: Math.random() * W,
      y: baseY - Math.random() * H * 0.35 - 20,
      type: Math.random() < 0.5 ? 'building' : 'tree',
      w: 30 + Math.random() * 50,
      h: 40 + Math.random() * 80,
      speed: 1 + Math.random() * 1.5,
      color: randomBGColor()
    });
  }
}
function randomBGColor() {
  const cols = ['#2c3e50','#34495e','#1a2533','#2d4a22','#3a2d1a'];
  return cols[Math.floor(Math.random()*cols.length)];
}

const OB_TYPES = [
  { label:'🚧', w:60, h:50, canSlide:false, canJump:true  },
  { label:'📢', w:80, h:35, canSlide:true,  canJump:false },
  { label:'🚗', w:65, h:45, canSlide:false, canJump:true  },
  { label:'🪨', w:50, h:40, canSlide:false, canJump:true  },
];
function spawnObstacle() {
  const t = OB_TYPES[Math.floor(Math.random()*OB_TYPES.length)];
  const l = Math.floor(Math.random()*LANE_COUNT);
  obstacles.push({ x:laneX(l), y:baseY - t.h/2, lane:l, ...t, ox:W+60 });
}
function spawnCollectible() {
  const l = Math.floor(Math.random()*LANE_COUNT);
  const isPowerup = Math.random() < 0.08;
  collectibles.push({
    x: laneX(l), y: baseY - 60 - Math.random()*40,
    lane:l, isPowerup, frame:0,
    label: isPowerup ? '🚁' : '🗳️',
    ox: W+40
  });
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────
function burst(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI*2/count)*i + Math.random()*0.5;
    const spd = 2 + Math.random()*4;
    particles.push({ x, y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd - 2, life:40, color });
  }
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  frame++;
  speed = BASE_SPEED + Math.floor(distance/500)*0.4;
  distance += speed * 0.05;
  score += 1;
  dayNight = (frame % DAY_CYCLE) / DAY_CYCLE;

  // lane lerp
  lane += (targetLane - lane) * 0.15;

  // jump
  if (isJumping) {
    playerY += jumpVY;
    jumpVY += 0.6; // gravity
    if (playerY >= 0) { playerY = 0; isJumping = false; jumpVY = 0; }
  }

  // powerup countdown
  if (hasPowerup) {
    powerupTimer--;
    if (powerupTimer <= 0) { hasPowerup = false; powerupType = null; document.getElementById('hud-powerup').textContent=''; }
  }

  // spawn obstacles
  obTimer++;
  const obInterval = Math.max(50, 120 - Math.floor(distance/300)*5);
  if (obTimer >= obInterval) { obTimer = 0; spawnObstacle(); }

  // spawn collectibles
  colTimer++;
  if (colTimer >= 60) { colTimer = 0; spawnCollectible(); }

  // bg objects
  bgObjects.forEach(b => {
    b.x -= b.speed * (speed/BASE_SPEED);
    if (b.x + b.w < -10) { b.x = W + 10; b.y = baseY - Math.random()*H*0.35 - 20; }
  });

  // obstacles
  for (let i = obstacles.length-1; i >= 0; i--) {
    const ob = obstacles[i];
    ob.x -= speed;
    if (ob.x < -100) { obstacles.splice(i,1); continue; }

    // collision check
    if (!hasPowerup && Math.abs(ob.x - playerX()) < 35 && Math.abs(ob.lane - lane) < 0.5) {
      const pAbsY = baseY + playerY;
      const obTop = ob.y - ob.h/2;
      const obBot = ob.y + ob.h/2;
      // banner: can slide under
      if (ob.canSlide && isSlideing) continue;
      // roadblock: can jump over
      if (ob.canJump && playerY < -40) continue;
      // hit!
      endGame();
      return;
    }
  }

  // collectibles
  for (let i = collectibles.length-1; i >= 0; i--) {
    const c = collectibles[i];
    c.x -= speed;
    c.frame++;
    if (c.x < -60) { collectibles.splice(i,1); continue; }
    if (Math.abs(c.x - playerX()) < 40 && Math.abs(c.lane - lane) < 0.5) {
      if (c.isPowerup) {
        hasPowerup = true; powerupTimer = 300; powerupType = 'helicopter';
        document.getElementById('hud-powerup').textContent = '🚁';
        showPowerupBanner('🚁 HELICOPTER ACTIVATED!');
      } else {
        votes++; score += VOTE_SCORE;
        burst(c.x, c.y, 8, '#FFD700');
      }
      collectibles.splice(i,1);
      updateHUD();
    }
  }

  // particles
  for (let i = particles.length-1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0) particles.splice(i,1);
  }

  updateHUD();
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
function draw() {
  const map = MAPS[selectedMap];
  const t = dayNight; // 0=dawn, 0.5=midday, 1=dusk/night
  const isNight = t > 0.75 || t < 0.1;

  // Sky gradient
  const skyColors = isNight ? map.skyNight : map.skyDay;
  const sky = ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0, skyColors[0]);
  sky.addColorStop(1, skyColors[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,W,H);

  // Sun/Moon
  drawCelestialBody(isNight, t);

  // BG objects
  bgObjects.forEach(b => drawBGObject(b, map));

  // Ground
  ctx.fillStyle = map.ground;
  ctx.fillRect(0, baseY+20, W, H - baseY - 20);

  // Road
  const roadW = W * 0.55;
  const roadX = (W - roadW)/2;
  ctx.fillStyle = map.road;
  ctx.fillRect(roadX, baseY+5, roadW, H - baseY);

  // Lane lines
  for (let i = 0; i < LANE_COUNT-1; i++) {
    const lx = laneX(i) + (laneX(i+1)-laneX(i))/2;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([30,20]);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lx, baseY+5); ctx.lineTo(lx, H); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Collectibles
  collectibles.forEach(c => {
    const bob = Math.sin(c.frame*0.15)*5;
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.label, c.x, c.y + bob);
    // glow
    ctx.shadowColor = c.isPowerup ? '#FFD700' : '#FF6B00';
    ctx.shadowBlur = 15;
    ctx.fillText(c.label, c.x, c.y + bob);
    ctx.shadowBlur = 0;
  });

  // Obstacles
  obstacles.forEach(ob => {
    ctx.font = '36px serif';
    ctx.textAlign = 'center';
    ctx.fillText(ob.label, ob.x, ob.y + 18);
    // shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(ob.x, baseY+12, 25, 8, 0, 0, Math.PI*2);
    ctx.fill();
  });

  // Player
  drawPlayer();

  // Particles
  particles.forEach(p => {
    ctx.globalAlpha = p.life/40;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Helicopter halo
  if (hasPowerup) {
    const px = playerX(), py = baseY + playerY - 60;
    ctx.strokeStyle = `rgba(255,215,0,${0.3 + 0.3*Math.sin(frame*0.1)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 55 + Math.sin(frame*0.1)*5, 0, Math.PI*2);
    ctx.stroke();
  }

  // Day/night overlay
  if (isNight) {
    ctx.fillStyle = `rgba(0,0,20,${0.25})`;
    ctx.fillRect(0,0,W,H);
  }
}

function drawCelestialBody(isNight, t) {
  const x = W * (0.1 + t * 0.8);
  const y = H * 0.25 - Math.sin(t * Math.PI) * H * 0.15;
  if (isNight) {
    ctx.fillStyle = '#FFFDE7';
    ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI*2); ctx.fill();
    // craters
    ctx.fillStyle = 'rgba(200,200,180,0.4)';
    [[x-6,y-4,4],[x+5,y+6,3],[x-2,y+8,2]].forEach(([cx,cy,r]) => {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    });
  } else {
    const grad = ctx.createRadialGradient(x,y,0,x,y,35);
    grad.addColorStop(0,'#FFF176'); grad.addColorStop(0.5,'#FFD54F'); grad.addColorStop(1,'rgba(255,213,79,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x,y,35,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#FFEE58';
    ctx.beginPath(); ctx.arc(x,y,22,0,Math.PI*2); ctx.fill();
    // rays
    ctx.strokeStyle = 'rgba(255,238,88,0.4)'; ctx.lineWidth = 2;
    for (let a=0; a<8; a++) {
      const ang = a*Math.PI/4 + frame*0.01;
      ctx.beginPath();
      ctx.moveTo(x+Math.cos(ang)*26, y+Math.sin(ang)*26);
      ctx.lineTo(x+Math.cos(ang)*40, y+Math.sin(ang)*40);
      ctx.stroke();
    }
  }
}

function drawBGObject(b, map) {
  if (b.type === 'building') {
    // building
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y - b.h, b.w, b.h);
    // windows
    ctx.fillStyle = 'rgba(255,255,150,0.5)';
    for (let wy=b.y-b.h+8; wy<b.y-10; wy+=18) {
      for (let wx=b.x+6; wx<b.x+b.w-10; wx+=14) {
        if (Math.random() > 0.3) { ctx.fillRect(wx,wy,8,10); }
      }
    }
    // roof detail (Tamil gopuram-ish)
    ctx.fillStyle = map.accent;
    ctx.fillRect(b.x+2, b.y-b.h-8, b.w-4, 8);
  } else {
    // palm/banyan tree
    ctx.fillStyle = '#4a3728';
    ctx.fillRect(b.x+b.w/2-5, b.y, 10, b.h*0.5);
    ctx.fillStyle = b.color === '#2d4a22' ? '#2d6a2d' : '#1a4a1a';
    ctx.beginPath();
    ctx.arc(b.x+b.w/2, b.y - b.h*0.15, b.w*0.55, 0, Math.PI*2);
    ctx.fill();
  }
}

/* ══════════════════════════════════════════════════════
   tVK VIJAY — Live running character
   Continuous sin/cos kinematics for fluid motion
   ══════════════════════════════════════════════════════ */

// Running cycle time — smooth continuous float
function runT() { return frame * 0.18; }

// Squash factor after landing from jump
let squashTimer = 0;
let prevJumping = false;
function updateSquash() {
  if (prevJumping && !isJumping) squashTimer = 10;
  prevJumping = isJumping;
  if (squashTimer > 0) squashTimer--;
}
function squash() {
  if (squashTimer > 0) {
    const s = squashTimer / 10;
    return { sx: 1 + s * 0.25, sy: 1 - s * 0.18 };
  }
  return { sx: 1, sy: 1 };
}

// Emit foot dust particles when running
function emitFootDust(px, py) {
  if (frame % 9 === 0 && !isJumping && !isSlideing) {
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: px + (Math.random() - 0.5) * 16,
        y: py + 4,
        vx: (Math.random() - 0.5) * 1.5 - 1.2,
        vy: -(Math.random() * 1.5),
        life: 18 + Math.random() * 10,
        color: '#C8A96E'
      });
    }
  }
}

function drawPlayer() {
  const px = playerX();
  const py = baseY + playerY;

  updateSquash();
  emitFootDust(px, py);

  ctx.save();
  ctx.translate(px, py);

  // Ground shadow — breathes with bob
  const bob = Math.sin(runT()) * 2.5;
  const shadowW = isSlideing ? 38 : 20 + Math.abs(Math.sin(runT())) * 4;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 6, shadowW, isSlideing ? 7 : 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Motion speed lines behind character
  if (!isSlideing && !isJumping) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ly = -30 - i * 18;
      const llen = 18 + i * 6;
      ctx.beginPath();
      ctx.moveTo(-22, ly); ctx.lineTo(-22 - llen, ly);
      ctx.stroke();
    }
  }

  if (isSlideing) {
    drawVijaySlide();
  } else {
    drawVijayRun(bob);
  }

  if (hasPowerup) {
    ctx.save();
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚁', 0, -95 + Math.sin(frame * 0.14) * 5);
    ctx.restore();
  }

  ctx.restore();
}

/* ══════════════════════════════════════
   VIJAY RUNNING — fluid sin kinematics
   ══════════════════════════════════════ */
function drawVijayRun(bob) {
  const t = runT();
  const hipSwing    =  Math.sin(t) * 0.42;
  const kneeBend    =  Math.abs(Math.sin(t)) * 0.55;
  const armFwd      =  Math.sin(t) * 0.55;
  const elbowBend   =  0.4 + Math.abs(Math.sin(t)) * 0.3;
  const bodyLean    =  0.08;
  const bodyWave    =  Math.sin(t * 2) * 0.025;
  const { sx, sy } = squash();

  ctx.save();
  ctx.scale(sx * 1.15, sy * 1.15);
  ctx.translate(0, bob);
  ctx.rotate(bodyLean + bodyWave);

  // ── Back leg (opposite phase) ──
  const backHip  = -hipSwing;
  const backKnee =  Math.abs(Math.sin(t + Math.PI)) * 0.5;
  _drawLeg(-1, backHip, backKnee, '#16305A', '#131828');

  // ── Torso with shirt ripple ──
  const ripple = Math.sin(t * 2) * 1.2;
  ctx.fillStyle = '#F5F5F5';
  ctx.beginPath();
  ctx.moveTo(-14 + ripple, -22);
  ctx.lineTo( 14 - ripple, -22);
  ctx.lineTo( 15,  14);
  ctx.lineTo(-15,  14);
  ctx.closePath();
  ctx.fill();

  // tVK sash (diagonal yellow)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-14 + ripple, -22);
  ctx.lineTo(14 - ripple,  -22);
  ctx.lineTo(15, 14); ctx.lineTo(-15, 14); ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#F5C518';
  ctx.beginPath();
  ctx.moveTo(-15, -10 + ripple);
  ctx.lineTo(15, -22);
  ctx.lineTo(15, -10);
  ctx.lineTo(-15, 2 + ripple);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 6px Outfit,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('tVK', 2, -13);
  ctx.restore();

  // shirt collar
  ctx.fillStyle = '#E0E0E0';
  ctx.beginPath();
  ctx.moveTo(-5,-22); ctx.lineTo(0,-16); ctx.lineTo(5,-22); ctx.fill();

  // ── Back arm ──
  _drawArm(1, -armFwd, elbowBend);

  // ── Front leg ──
  _drawLeg(1, hipSwing, kneeBend, '#1E3A5F', '#1a1a2e');

  // ── Front arm ──
  _drawArm(-1, armFwd, elbowBend);

  // ── Neck ──
  ctx.fillStyle = '#C8A070';
  ctx.beginPath();
  ctx.roundRect(-4, -30, 8, 10, 3);
  ctx.fill();

  // ── Head with windswept hair ──
  drawVijayHead(0, -44, t);

  ctx.restore();
}

/* ── Draw one leg: hip pivot + shin pivot ── */
function _drawLeg(side, hipA, kneeA, thighCol, shinCol) {
  ctx.save();
  ctx.translate(side * 5, 12);
  ctx.rotate(hipA);
  // thigh
  ctx.fillStyle = thighCol;
  ctx.beginPath(); ctx.roundRect(-5, 0, 10, 20, 3); ctx.fill();
  // shin
  ctx.save();
  ctx.translate(0, 20);
  ctx.rotate(kneeA * side);
  ctx.fillStyle = shinCol;
  ctx.beginPath(); ctx.roundRect(-4, 0, 8, 17, 2); ctx.fill();
  // shoe
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(side * 2, 19, 8, 4, 0.1 * side, 0, Math.PI * 2);
  ctx.fill();
  // white sole stripe
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(-5, 18, 10, 2);
  ctx.restore();
  ctx.restore();
}

/* ── Draw one arm: shoulder + elbow ── */
function _drawArm(side, shoulderA, elbowA) {
  ctx.save();
  ctx.translate(side * 15, -18);
  ctx.rotate(shoulderA);
  // upper arm
  ctx.fillStyle = '#D4A574';
  ctx.beginPath(); ctx.roundRect(-4, 0, 8, 14, 3); ctx.fill();
  ctx.save();
  ctx.translate(0, 14);
  ctx.rotate(-elbowA * side);
  // forearm
  ctx.fillStyle = '#C89060';
  ctx.beginPath(); ctx.roundRect(-3, 0, 6, 12, 2); ctx.fill();
  // fist
  ctx.fillStyle = '#B87840';
  ctx.beginPath(); ctx.arc(0, 13, 5, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/* ── Vijay: Slide pose ── */
function drawVijaySlide() {
  ctx.save();
  ctx.rotate(-0.42);
  ctx.scale(1.15, 0.72);
  ctx.translate(0, 14);

  // back legs
  ctx.fillStyle = '#16305A';
  ctx.beginPath(); ctx.roundRect(-38, -9, 36, 11, 3); ctx.fill();
  ctx.fillStyle = '#131828';
  ctx.beginPath(); ctx.roundRect(-50, -9, 16, 9, 2); ctx.fill();
  // shoe
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.ellipse(-50, -2, 9, 5, -0.2, 0, Math.PI*2); ctx.fill();

  // body horizontal
  ctx.fillStyle = '#F5F5F5';
  ctx.beginPath(); ctx.roundRect(-10, -24, 32, 15, 4); ctx.fill();
  // tVK sash stripe
  ctx.save();
  ctx.beginPath(); ctx.rect(-10, -24, 32, 15); ctx.clip();
  ctx.fillStyle = '#F5C518';
  ctx.fillRect(-10, -24, 32, 7);
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 6px Outfit,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('tVK', 6, -19);
  ctx.restore();

  // forward arm
  ctx.fillStyle = '#D4A574';
  ctx.beginPath(); ctx.roundRect(20, -22, 16, 8, 3); ctx.fill();
  ctx.fillStyle = '#B87840';
  ctx.beginPath(); ctx.arc(37, -18, 6, 0, Math.PI*2); ctx.fill();

  // head forward
  ctx.save();
  ctx.translate(34, -22);
  drawVijayHead(0, 0, 0);
  ctx.restore();

  ctx.restore();
}

/* ── Vijay face: animated windswept hair + shades ── */
function drawVijayHead(x, y, t) {
  const hw = Math.sin((t || 0) * 0.9) * 3; // hair wind sway
  ctx.save();
  ctx.translate(x, y);

  // face
  ctx.fillStyle = '#D4A574';
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // hair base
  ctx.fillStyle = '#140e04';
  ctx.beginPath();
  ctx.ellipse(0, -11, 13, 9, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // right swept side
  ctx.beginPath();
  ctx.moveTo(10, -10);
  ctx.bezierCurveTo(18 + hw, -14, 16 + hw, -3, 13, 0);
  ctx.bezierCurveTo(10, -5, 11, -9, 10, -10);
  ctx.fill();
  // left side
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.bezierCurveTo(-16, -12, -14, -2, -12, 0);
  ctx.bezierCurveTo(-11, -5, -11, -9, -10, -10);
  ctx.fill();
  // forelock — flicks with wind
  ctx.beginPath();
  ctx.moveTo(-5, -14);
  ctx.bezierCurveTo(-6 - hw, -24, 4 + hw, -24, 5, -14);
  ctx.bezierCurveTo(3, -18, -3, -18, -5, -14);
  ctx.fill();
  // hair sheen
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.ellipse(3, -14, 5, 3, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // sunglasses bridge
  ctx.fillStyle = '#111';
  ctx.fillRect(-3, -4, 6, 2);
  // left lens
  ctx.fillStyle = 'rgba(15,15,35,0.95)';
  ctx.beginPath(); ctx.roundRect(-12, -8, 10, 7, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.ellipse(-9, -6, 3, 1.5, -0.4, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(-12, -8, 10, 7, 2); ctx.stroke();
  // right lens
  ctx.fillStyle = 'rgba(15,15,35,0.95)';
  ctx.beginPath(); ctx.roundRect(2, -8, 10, 7, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.ellipse(5, -6, 3, 1.5, -0.4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(2, -8, 10, 7, 2); ctx.stroke();
  // temple arms
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-16, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, -5);  ctx.lineTo(16, -4);  ctx.stroke();

  // smile
  ctx.strokeStyle = '#906030'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 5, 5, 0.2, Math.PI - 0.2); ctx.stroke();

  // gold ear studs
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.arc(-12, 0, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( 12, 0, 2.5, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

// ─── HUD UPDATE ───────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-score').textContent = score.toLocaleString();
  document.getElementById('hud-votes').textContent = votes;
  const isNight = (frame % DAY_CYCLE) / DAY_CYCLE > 0.65;
  document.getElementById('hud-cycle').textContent = isNight ? '🌙 Night' : '☀️ Day';
  document.getElementById('hud-city').textContent = MAPS[selectedMap].name;
}

// ─── POWER-UP BANNER ──────────────────────────────────────────────────────────
function showPowerupBanner(text) {
  const el = document.getElementById('powerup-banner');
  document.getElementById('powerup-text').textContent = text;
  el.classList.remove('hidden'); el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.classList.add('hidden'); }, 2500);
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
function loop(ts) {
  if (gameState !== 'running') return;
  update();
  draw();
  animId = requestAnimationFrame(loop);
}

function startGame() {
  initGame();
  gameState = 'running';
  showScreen('game-screen');
  animId = requestAnimationFrame(loop);
}

function pauseGame() {
  if (gameState === 'running') { gameState = 'paused'; cancelAnimationFrame(animId); showScreen('pause-screen'); }
}

function resumeGame() {
  if (gameState === 'paused') { gameState = 'running'; showScreen('game-screen'); animId = requestAnimationFrame(loop); }
}

function endGame() {
  gameState = 'over';
  cancelAnimationFrame(animId);
  document.getElementById('result-score').textContent = score.toLocaleString();
  document.getElementById('result-votes').textContent = votes;
  document.getElementById('result-dist').textContent  = Math.floor(distance)+'m';
  document.getElementById('gameover-title').textContent = votes > 20 ? '🏆 Landslide Victory!' : votes > 10 ? '🎉 Campaign Won!' : '💥 Campaign Over!';
  showScreen('gameover-screen');
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function jump() { if (!isJumping && gameState === 'running') { isJumping = true; jumpVY = -16; } }
function slide() { if (gameState === 'running') { isSlideing = true; setTimeout(()=>{ isSlideing=false; }, 500); } }
function moveLeft()  { if (gameState==='running' && targetLane > 0)            targetLane--; }
function moveRight() { if (gameState==='running' && targetLane < LANE_COUNT-1) targetLane++; }

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  switch(e.key) {
    case 'ArrowUp':   case 'w': case ' ': e.preventDefault(); jump();      break;
    case 'ArrowDown': case 's':           e.preventDefault(); slide();     break;
    case 'ArrowLeft': case 'a':           e.preventDefault(); moveLeft();  break;
    case 'ArrowRight':case 'd':           e.preventDefault(); moveRight(); break;
    case 'Escape': case 'p':              if(gameState==='running') pauseGame(); break;
  }
});

// ─── POINTER / TOUCH / SWIPE ──────────────────────────────────────────────────
let pointerStartX = 0, pointerStartY = 0;
window.addEventListener('pointerdown', e => {
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
});
window.addEventListener('pointerup', e => {
  if (gameState !== 'running') return;
  // Ignore if clicking buttons, HUD elements, or inactive screens
  if (e.target.closest('button') || e.target.closest('#hud') || e.target.closest('.screen:not(#game-screen)')) return;

  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 15 && ady < 15) { jump(); return; }
  if (ady > adx) { dy < 0 ? jump() : slide(); }
  else           { dx < 0 ? moveLeft() : moveRight(); }
});

// ─── LEADERBOARD UI ───────────────────────────────────────────────────────────
function renderLeaderboard() {
  const lb = getLeaderboard();
  const el = document.getElementById('leaderboard-list');
  if (!lb.length) { el.innerHTML = '<p class="lb-empty">No scores yet. Start running!</p>'; return; }
  const ranks = ['🥇','🥈','🥉'];
  const rankClass = ['gold','silver','bronze'];
  el.innerHTML = lb.map((e,i) => `
    <div class="lb-row">
      <span class="lb-rank ${rankClass[i]||''}">${ranks[i]||i+1}</span>
      <span class="lb-name">${e.name||'Anonymous'}</span>
      <span class="lb-votes">🗳️${e.votes}</span>
      <span class="lb-score">${e.score.toLocaleString()}</span>
    </div>
  `).join('');
}

// ─── BUTTON EVENTS ────────────────────────────────────────────────────────────
document.getElementById('btn-play').onclick = startGame;
document.getElementById('btn-pause').onclick = pauseGame;
document.getElementById('btn-resume').onclick = resumeGame;
document.getElementById('btn-quit').onclick = () => { gameState='idle'; cancelAnimationFrame(animId); showScreen('start-screen'); };
document.getElementById('btn-restart').onclick = startGame;
document.getElementById('btn-menu').onclick = () => { gameState='idle'; showScreen('start-screen'); };

document.getElementById('btn-save-score').onclick = () => {
  const name = document.getElementById('player-name').value.trim() || 'Anonymous';
  addScore(name, score, votes);
  document.getElementById('name-input-area').innerHTML = '<p style="color:rgba(255,215,0,0.8);font-weight:700">✅ Score Saved!</p>';
};

document.getElementById('btn-leaderboard-open').onclick = () => { renderLeaderboard(); showScreen('leaderboard-screen'); };
document.getElementById('btn-leaderboard-close').onclick = () => showScreen('start-screen');

document.querySelectorAll('.map-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMap = btn.dataset.map;
  };
});

// Portal Transitions
document.getElementById('btn-goto-campaign').onclick = () => {
  sfx.play('click');
  showScreen('start-screen');
};

document.getElementById('btn-campaign-back').onclick = () => {
  sfx.play('click');
  showScreen('hub-screen');
};

document.getElementById('btn-goto-factory').onclick = () => {
  sfx.play('click');
  initFactoryBoss();
  showScreen('factory-screen');
};

document.getElementById('btn-factory-back').onclick = () => {
  sfx.play('click');
  exitFactoryBoss();
  showScreen('hub-screen');
};

document.getElementById('btn-goto-galactic').onclick = () => {
  sfx.play('click');
  initGalactic();
  showScreen('galactic-screen');
};

document.getElementById('btn-galactic-back').onclick = () => {
  sfx.play('click');
  exitGalactic();
  showScreen('hub-screen');
};

document.getElementById('btn-galactic-restart').onclick = () => {
  sfx.play('click');
  document.getElementById('galactic-gameover').classList.add('hidden');
  startGalacticGame();
};

document.getElementById('btn-galactic-menu').onclick = () => {
  sfx.play('click');
  exitGalactic();
  showScreen('hub-screen');
};

document.getElementById('btn-galactic-victory-ok').onclick = () => {
  sfx.play('click');
  exitGalactic();
  showScreen('hub-screen');
};

// Slingshot Transitions
document.getElementById('btn-goto-slingshot').onclick = () => {
  sfx.play('click');
  initSlingshot();
  showScreen('slingshot-screen');
};

document.getElementById('btn-slingshot-back').onclick = () => {
  sfx.play('click');
  exitSlingshot();
  showScreen('hub-screen');
};

document.getElementById('btn-slingshot-select-back').onclick = () => {
  sfx.play('click');
  exitSlingshot();
  showScreen('hub-screen');
};

document.getElementById('btn-slingshot-restart').onclick = () => {
  sfx.play('click');
  document.getElementById('slingshot-gameover').classList.add('hidden');
  startSlingshotLevel(currentLevelIdx);
};

document.getElementById('btn-slingshot-gameover-menu').onclick = () => {
  sfx.play('click');
  exitSlingshot();
  showScreen('hub-screen');
};

document.getElementById('btn-slingshot-next').onclick = () => {
  sfx.play('click');
  document.getElementById('slingshot-victory').classList.add('hidden');
  if (currentLevelIdx < 2) {
    currentLevelIdx++;
    startSlingshotLevel(currentLevelIdx);
  } else {
    exitSlingshot();
    showScreen('hub-screen');
  }
};

document.getElementById('btn-slingshot-victory-menu').onclick = () => {
  sfx.play('click');
  exitSlingshot();
  showScreen('hub-screen');
};

// Brick Breaker Transitions
document.getElementById('btn-goto-brick').onclick = () => {
  sfx.play('click');
  initBrickGame();
  showScreen('brick-screen');
};

document.getElementById('btn-brick-back').onclick = () => {
  sfx.play('click');
  exitBrickGame();
  showScreen('hub-screen');
};

document.getElementById('btn-brick-gameover-menu').onclick = () => {
  sfx.play('click');
  exitBrickGame();
  showScreen('hub-screen');
};

document.getElementById('btn-brick-victory-menu').onclick = () => {
  sfx.play('click');
  exitBrickGame();
  showScreen('hub-screen');
};

document.getElementById('btn-brick-restart').onclick = () => {
  sfx.play('click');
  document.getElementById('brick-gameover').classList.add('hidden');
  startBrickGame();
};

document.getElementById('btn-brick-next').onclick = () => {
  sfx.play('click');
  document.getElementById('brick-victory').classList.add('hidden');
  startBrickGame();
};

// Platform Campaign Transitions
document.getElementById('btn-goto-platformer').onclick = () => {
  sfx.play('click');
  initPlatformer();
  showScreen('platformer-screen');
};

document.getElementById('btn-platformer-back').onclick = () => {
  sfx.play('click');
  exitPlatformer();
  showScreen('hub-screen');
};

document.getElementById('btn-platformer-select-back').onclick = () => {
  sfx.play('click');
  exitPlatformer();
  showScreen('hub-screen');
};

document.getElementById('btn-platformer-gameover-menu').onclick = () => {
  sfx.play('click');
  exitPlatformer();
  showScreen('hub-screen');
};

document.getElementById('btn-platformer-victory-menu').onclick = () => {
  sfx.play('click');
  exitPlatformer();
  showScreen('hub-screen');
};

document.getElementById('btn-platformer-restart').onclick = () => {
  sfx.play('click');
  document.getElementById('platformer-gameover').classList.add('hidden');
  startPlatformerLevel(pCurrentLevelIdx);
};

document.getElementById('btn-platformer-next').onclick = () => {
  sfx.play('click');
  document.getElementById('platformer-victory').classList.add('hidden');
  if (pCurrentLevelIdx < 2) {
    pCurrentLevelIdx++;
    startPlatformerLevel(pCurrentLevelIdx);
  } else {
    exitPlatformer();
    showScreen('hub-screen');
  }
};


// ─── BOOT ─────────────────────────────────────────────────────────────────────
initCanvas();
showScreen('hub-screen');


// ==============================================================================
// ─── FACTORY BOSS GAME MODULE ─────────────────────────────────────────────────
// ==============================================================================

// Web Audio API Synthesizer
const sfx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  play(type) {
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const now = this.ctx.currentTime;
      if (type === 'click') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
      } else if (type === 'make') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
      } else if (type === 'pack') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.2);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
      } else if (type === 'cash') {
        [0, 0.08].forEach((delay, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.connect(gain); gain.connect(this.ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(idx === 0 ? 1200 : 1500, now + delay);
          gain.gain.setValueAtTime(0.05, now + delay);
          gain.gain.linearRampToValueAtTime(0, now + delay + 0.25);
          osc.start(now + delay); osc.stop(now + delay + 0.25);
        });
      } else if (type === 'level') {
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
          const delay = idx * 0.08;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.connect(gain); gain.connect(this.ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.06, now + delay);
          gain.gain.linearRampToValueAtTime(0, now + delay + 0.25);
          osc.start(now + delay); osc.stop(now + delay + 0.25);
        });
      } else if (type === 'error') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
      } else if (type === 'laser') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
      } else if (type === 'explosion') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'shield') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(950, now + 0.2);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
      } else if (type === 'launch') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
      } else if (type === 'hit') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(40, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
      } else if (type === 'pop') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
      } else if (type === 'boost') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
      } else if (type === 'bounce') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(480, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
      } else if (type === 'powerup') {
        [0, 0.06, 0.12].forEach((delay, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.connect(gain); gain.connect(this.ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(560 + idx * 180, now + delay);
          gain.gain.setValueAtTime(0.06, now + delay);
          gain.gain.linearRampToValueAtTime(0, now + delay + 0.15);
          osc.start(now + delay); osc.stop(now + delay + 0.15);
        });
      }
    } catch (e) {
      console.log('Audio error:', e);
    }
  }
};

let factoryActive = false;
let factoryLastTime = 0;
let factoryAnimId = null;

// Game State Variables
let fCash = 0.00;
let fXp = 0;
let fLevel = 1;
let fName = "Apprentice's Shop";
let fRank = "Apprentice";

let stockUnpacked = 0;
let stockPacked = 0;

let productTier = 0;
let boxSize = 5;
let conveyorSpeedMult = 1.0;

// Automation Rates (units/sec)
let autoMakeRate = 0.0;
let autoPackRate = 0.0;
let autoShipRate = 0.0;

// Base durations (seconds)
const MAKE_BASE_DUR = 1.5;
const PACK_BASE_DUR = 2.0;
const SHIP_BASE_DUR = 3.0;

// Progress trackers (0 to 100)
let makeProgress = 0;
let makeIsRunning = false;

let packProgress = 0;
let packIsRunning = false;

let shipProgress = 0;
let shipIsRunning = false;

// Accumulators for smooth float updates
let accumAutoPack = 0;
let accumAutoShip = 0;
let partiallyPackedUnits = 0;

// Costs
let costAutoMake = 25;
let costAutoPack = 75;
let costAutoShip = 150;
let costSpeed = 50;
let costTier = 100;
let costBoxSize = 120;

// Achievements
let unlockedAchievements = [];

const PRODUCT_TIERS = [
  { name: "Widgets", emoji: "🔧", baseVal: 1.50 },
  { name: "Toys", emoji: "🧸", baseVal: 4.50 },
  { name: "Gears", emoji: "⚙️", baseVal: 12.00 },
  { name: "Appliances", emoji: "📺", baseVal: 45.00 },
  { name: "Automobiles", emoji: "🚗", baseVal: 200.00 },
  { name: "Robots", emoji: "🤖", baseVal: 800.00 }
];

const FACTORY_ACHIEVEMENTS = [
  { id: "first_dollar", title: "First Revenue", desc: "Earn your first $10", target: 10, type: "cash", badge: "🪙" },
  { id: "mechanization", title: "Mechanization", desc: "Own 1 Assemble-o-Matic", target: 1, type: "automake", badge: "🤖" },
  { id: "assembly_line", title: "Assembly Line", desc: "Own 1 Packing Robot Arm", target: 1, type: "autopack", badge: "🦾" },
  { id: "logistics_boss", title: "Logistics Boss", desc: "Own 1 Courier Drone", target: 1, type: "autoship", badge: "🛸" },
  { id: "investor", title: "Investor", desc: "Accumulate $1,000 Cash", target: 1000, type: "cash", badge: "💰" },
  { id: "automation_master", title: "Automation Master", desc: "Reach level 5 automation on all three machines", target: 5, type: "automaster", badge: "⚡" },
  { id: "ceo_status", title: "CEO Status", desc: "Reach Level 10", target: 10, type: "level", badge: "👑" },
  { id: "factory_boss", title: "Factory Boss", desc: "Unlock Robots (Product Tier 5)", target: 5, type: "tier", badge: "🏭" }
];

// Helper calculations
function getCashMultiplier() {
  let mult = 1.0;
  if (unlockedAchievements.includes("first_dollar")) mult += 0.10;
  if (unlockedAchievements.includes("investor")) mult += 0.15;
  if (unlockedAchievements.includes("ceo_status")) mult += 0.25;
  const boxUpgrades = (boxSize - 5) / 5;
  mult += boxUpgrades * 0.15;
  return mult;
}

function getSpeedMultiplier() {
  let mult = conveyorSpeedMult;
  if (unlockedAchievements.includes("mechanization")) mult += 0.10;
  if (unlockedAchievements.includes("assembly_line")) mult += 0.10;
  if (unlockedAchievements.includes("logistics_boss")) mult += 0.10;
  if (unlockedAchievements.includes("automation_master")) mult += 0.25;
  if (unlockedAchievements.includes("factory_boss")) mult += 0.50;
  return mult;
}

// Manual Task Clicks
document.getElementById('btn-action-make').onclick = () => {
  sfx.init();
  if (makeIsRunning) return;
  sfx.play('click');
  makeIsRunning = true;
  makeProgress = 0;
};

document.getElementById('btn-action-pack').onclick = () => {
  sfx.init();
  if (packIsRunning) return;
  if (Math.floor(stockUnpacked) < boxSize) {
    sfx.play('error');
    createFloater('task-pack', "Need raw products!", "#e74c3c");
    return;
  }
  sfx.play('click');
  packIsRunning = true;
  packProgress = 0;
};

document.getElementById('btn-action-ship').onclick = () => {
  sfx.init();
  if (shipIsRunning) return;
  if (stockPacked < 1) {
    sfx.play('error');
    createFloater('task-ship', "No boxes packed!", "#e74c3c");
    return;
  }
  sfx.play('click');
  shipIsRunning = true;
  shipProgress = 0;
};

// Tabs Switching
document.querySelectorAll('.upgrades-panel .tab-btn').forEach(btn => {
  btn.onclick = () => {
    sfx.init();
    document.querySelectorAll('.upgrades-panel .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.upgrades-panel .tab-pane').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    document.getElementById(tabId).classList.add('active');
    sfx.play('click');
  };
});

// Upgrades Buying logic
document.getElementById('btn-buy-auto-make').onclick = () => {
  sfx.init();
  if (fCash < costAutoMake) return;
  fCash -= costAutoMake;
  autoMakeRate += 1.0;
  costAutoMake = Math.floor(25 * Math.pow(1.45, autoMakeRate));
  sfx.play('cash');
  createFloater('upg-auto-make', "Purchased Assemble-o-Matic!", "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

document.getElementById('btn-buy-auto-pack').onclick = () => {
  sfx.init();
  if (fCash < costAutoPack) return;
  fCash -= costAutoPack;
  autoPackRate += 1.0;
  costAutoPack = Math.floor(75 * Math.pow(1.45, autoPackRate));
  sfx.play('cash');
  createFloater('upg-auto-pack', "Purchased Packing Arm!", "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

document.getElementById('btn-buy-auto-ship').onclick = () => {
  sfx.init();
  if (fCash < costAutoShip) return;
  fCash -= costAutoShip;
  autoShipRate += 0.2;
  costAutoShip = Math.floor(150 * Math.pow(1.5, autoShipRate * 5));
  sfx.play('cash');
  createFloater('upg-auto-ship', "Purchased Courier Drone!", "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

document.getElementById('btn-buy-speed').onclick = () => {
  sfx.init();
  if (fCash < costSpeed) return;
  fCash -= costSpeed;
  const speedLevels = Math.round((conveyorSpeedMult - 1.0) / 0.1);
  conveyorSpeedMult += 0.1;
  costSpeed = Math.floor(50 * Math.pow(1.8, speedLevels + 1));
  sfx.play('cash');
  createFloater('upg-speed', "Conveyors Sped Up!", "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

document.getElementById('btn-buy-tier').onclick = () => {
  sfx.init();
  if (fCash < costTier) return;
  if (productTier >= PRODUCT_TIERS.length - 1) return;
  fCash -= costTier;
  productTier += 1;
  costTier = Math.floor(100 * Math.pow(4, productTier));
  sfx.play('cash');
  createFloater('upg-tier', `Unlocked ${PRODUCT_TIERS[productTier].name}!`, "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

document.getElementById('btn-buy-box-size').onclick = () => {
  sfx.init();
  if (fCash < costBoxSize) return;
  fCash -= costBoxSize;
  boxSize += 5;
  costBoxSize = Math.floor(120 * Math.pow(2.0, (boxSize / 5) - 1));
  sfx.play('cash');
  createFloater('upg-box-size', "Box Size Increased!", "#2ecc71");
  checkAchievements();
  saveFactoryGame();
  updateFactoryUI();
};

// Floaters Logic
function createFloater(elementId, text, color) {
  const container = document.getElementById('factory-floaters');
  const target = document.getElementById(elementId);
  if (!container || !target) return;
  const tRect = target.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  
  const x = tRect.left - cRect.left + tRect.width / 2 + (Math.random() - 0.5) * 35;
  const y = tRect.top - cRect.top + (Math.random() - 0.5) * 10;
  
  const div = document.createElement('div');
  div.className = 'floater';
  div.textContent = text;
  div.style.left = `${x}px`;
  div.style.top = `${y}px`;
  div.style.color = color;
  container.appendChild(div);
  
  setTimeout(() => div.remove(), 800);
}

// Deliver Boxes Logic
function deliverBoxes(count, isManual) {
  const activeProduct = PRODUCT_TIERS[productTier];
  const cashReward = count * boxSize * activeProduct.baseVal * getCashMultiplier();
  const xpReward = count * Math.floor(boxSize * (productTier + 1) * 3);
  
  fCash += cashReward;
  fXp += xpReward;
  
  // Level up check
  let nextXp = Math.floor(100 * Math.pow(1.35, fLevel - 1));
  let leveledUp = false;
  while (fXp >= nextXp) {
    fXp -= nextXp;
    fLevel++;
    nextXp = Math.floor(100 * Math.pow(1.35, fLevel - 1));
    leveledUp = true;
  }
  
  sfx.play('cash');
  
  // Create floaters
  const targetCard = isManual ? 'btn-action-ship' : 'task-ship';
  createFloater(targetCard, `+$${cashReward.toFixed(2)}`, "#2ecc71");
  createFloater('factory-xp-fill', `+${xpReward} XP`, "#3498db");
  
  if (leveledUp) {
    sfx.play('level');
    createFloater('factory-level', "Level Up! 🎉", "#ff1493");
    showPowerupBanner(`🎉 LEVEL ${fLevel}! NEW DIGNITY UNLOCKED.`);
  }
  
  checkAchievements();
}

// Achievements Check
function checkAchievements() {
  let changed = false;
  
  FACTORY_ACHIEVEMENTS.forEach(ach => {
    if (unlockedAchievements.includes(ach.id)) return;
    
    let isFulfilled = false;
    switch(ach.type) {
      case 'cash':
        if (fCash >= ach.target) isFulfilled = true;
        break;
      case 'automake':
        if (autoMakeRate >= ach.target) isFulfilled = true;
        break;
      case 'autopack':
        if (autoPackRate >= ach.target) isFulfilled = true;
        break;
      case 'autoship':
        if (autoShipRate >= ach.target) isFulfilled = true;
        break;
      case 'level':
        if (fLevel >= ach.target) isFulfilled = true;
        break;
      case 'tier':
        if (productTier >= ach.target) isFulfilled = true;
        break;
      case 'automaster':
        if (autoMakeRate >= 5 && autoPackRate >= 5 && autoShipRate >= 1.0) isFulfilled = true;
        break;
    }
    
    if (isFulfilled) {
      unlockedAchievements.push(ach.id);
      sfx.play('level');
      createFloater('factory-screen', `🏆 Milestone: ${ach.title}!`, "#f1c40f");
      changed = true;
    }
  });
  
  if (changed) {
    renderAchievements();
    saveFactoryGame();
  }
}

function renderAchievements() {
  const el = document.getElementById('factory-achievements-list');
  if (!el) return;
  el.innerHTML = FACTORY_ACHIEVEMENTS.map(ach => {
    const isUnlocked = unlockedAchievements.includes(ach.id);
    return `
      <div class="ach-card ${isUnlocked ? 'unlocked' : ''}">
        <span class="ach-badge">${ach.badge}</span>
        <div class="ach-details">
          <span class="ach-title">${ach.title}</span>
          <span class="ach-desc">${ach.desc}</span>
          <span class="ach-status">${isUnlocked ? 'Completed' : 'Locked'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Formatting helpers
function formatCash(val) {
  if (val >= 1000000000) return `$${(val / 1000000000).toFixed(2)}B`;
  if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(2)}K`;
  return `$${val.toFixed(2)}`;
}

// UI updates
function updateFactoryUI() {
  document.getElementById('factory-cash').textContent = formatCash(fCash);
  document.getElementById('factory-level').textContent = fLevel;
  document.getElementById('factory-current-xp').textContent = fXp;
  const nextXp = Math.floor(100 * Math.pow(1.35, fLevel - 1));
  document.getElementById('factory-next-xp').textContent = nextXp;
  const xpPct = Math.min(100, (fXp / nextXp) * 100);
  document.getElementById('factory-xp-fill').style.width = `${xpPct}%`;
  
  let rank = "Apprentice";
  if (fLevel >= 25) rank = "Factory Boss 👑";
  else if (fLevel >= 20) rank = "Plant Head 🏭";
  else if (fLevel >= 15) rank = "Maintenance Manager 🔧";
  else if (fLevel >= 10) rank = "Senior Engineer ⚙️";
  else if (fLevel >= 5) rank = "Technician 🛠️";
  document.getElementById('factory-rank').textContent = rank;
  document.getElementById('factory-name').textContent = fName;

  document.getElementById('val-stock-unpacked').textContent = `${Math.floor(stockUnpacked)} in stock`;
  document.getElementById('val-stock-packed').textContent = `${stockPacked} box${stockPacked === 1 ? '' : 'es'} packed`;
  
  const activeProduct = PRODUCT_TIERS[productTier];
  document.getElementById('val-product-name').textContent = activeProduct.name;
  document.getElementById('val-make-reward').textContent = activeProduct.baseVal.toFixed(2);
  document.getElementById('val-box-size').textContent = boxSize;
  
  const boxValue = boxSize * activeProduct.baseVal * getCashMultiplier();
  const boxXp = Math.floor(boxSize * (productTier + 1) * 3);
  document.getElementById('val-ship-reward').textContent = boxValue.toFixed(2);
  document.getElementById('val-ship-xp').textContent = boxXp;
  
  document.getElementById('auto-make-lbl').textContent = autoMakeRate > 0 ? `Auto: ${autoMakeRate}/s` : "Auto: Off";
  document.getElementById('auto-make-lbl').className = autoMakeRate > 0 ? "auto-indicator active" : "auto-indicator";
  
  document.getElementById('auto-pack-lbl').textContent = autoPackRate > 0 ? `Auto: ${autoPackRate}/s` : "Auto: Off";
  document.getElementById('auto-pack-lbl').className = autoPackRate > 0 ? "auto-indicator active" : "auto-indicator";
  
  document.getElementById('auto-ship-lbl').textContent = autoShipRate > 0 ? `Auto: ${autoShipRate.toFixed(1)}/s` : "Auto: Off";
  document.getElementById('auto-ship-lbl').className = autoShipRate > 0 ? "auto-indicator active" : "auto-indicator";
  
  const totalRate = autoMakeRate + autoPackRate + autoShipRate * boxSize;
  document.getElementById('factory-total-rate').textContent = totalRate.toFixed(1);

  document.getElementById('val-auto-make-rate').textContent = `${autoMakeRate}/s`;
  document.getElementById('cost-auto-make').textContent = costAutoMake;
  document.getElementById('btn-buy-auto-make').disabled = fCash < costAutoMake;

  document.getElementById('val-auto-pack-rate').textContent = `${autoPackRate}/s`;
  document.getElementById('cost-auto-pack').textContent = costAutoPack;
  document.getElementById('btn-buy-auto-pack').disabled = fCash < costAutoPack;

  document.getElementById('val-auto-ship-rate').textContent = `${autoShipRate.toFixed(1)}/s`;
  document.getElementById('cost-auto-ship').textContent = costAutoShip;
  document.getElementById('btn-buy-auto-ship').disabled = fCash < costAutoShip;

  const speedPct = Math.round((conveyorSpeedMult - 1.0) * 100);
  document.getElementById('val-speed-boost').textContent = speedPct;
  document.getElementById('cost-speed').textContent = costSpeed;
  document.getElementById('btn-buy-speed').disabled = fCash < costSpeed;

  const nextTier = PRODUCT_TIERS[productTier + 1];
  if (nextTier) {
    document.getElementById('val-next-product').textContent = `${nextTier.emoji} ${nextTier.name}`;
    document.getElementById('cost-tier').textContent = costTier;
    document.getElementById('btn-buy-tier').disabled = fCash < costTier;
  } else {
    document.getElementById('val-next-product').textContent = "MAXED OUT";
    document.getElementById('cost-tier').textContent = "---";
    document.getElementById('btn-buy-tier').disabled = true;
  }

  document.getElementById('val-next-box-size').textContent = boxSize + 5;
  document.getElementById('cost-box-size').textContent = costBoxSize;
  document.getElementById('btn-buy-box-size').disabled = fCash < costBoxSize;
}

// Save/Load States
function saveFactoryGame() {
  const data = {
    fCash,
    fXp,
    fLevel,
    fName,
    stockUnpacked,
    stockPacked,
    productTier,
    boxSize,
    conveyorSpeedMult,
    autoMakeRate,
    autoPackRate,
    autoShipRate,
    costAutoMake,
    costAutoPack,
    costAutoShip,
    costSpeed,
    costTier,
    costBoxSize,
    unlockedAchievements
  };
  localStorage.setItem('fb_save', JSON.stringify(data));
}

function loadFactoryGame() {
  try {
    const saved = localStorage.getItem('fb_save');
    if (!saved) return;
    const data = JSON.parse(saved);
    if (!data || typeof data !== 'object') return;
    fCash = data.fCash ?? 0;
    fXp = data.fXp ?? 0;
    fLevel = data.fLevel ?? 1;
    fName = data.fName ?? "Apprentice's Shop";
    stockUnpacked = data.stockUnpacked ?? 0;
    stockPacked = data.stockPacked ?? 0;
    productTier = data.productTier ?? 0;
    boxSize = data.boxSize ?? 5;
    conveyorSpeedMult = data.conveyorSpeedMult ?? 1.0;
    autoMakeRate = data.autoMakeRate ?? 0;
    autoPackRate = data.autoPackRate ?? 0;
    autoShipRate = data.autoShipRate ?? 0;
    costAutoMake = data.costAutoMake ?? 25;
    costAutoPack = data.costAutoPack ?? 75;
    costAutoShip = data.costAutoShip ?? 150;
    costSpeed = data.costSpeed ?? 50;
    costTier = data.costTier ?? 100;
    costBoxSize = data.costBoxSize ?? 120;
    unlockedAchievements = data.unlockedAchievements ?? [];
  } catch(e) {
    console.error("Error loading factory save:", e);
  }
}

// Main tick loop
function factoryTick(timestamp) {
  if (!factoryActive) return;
  if (!factoryLastTime) factoryLastTime = timestamp;
  let dt = (timestamp - factoryLastTime) / 1000;
  factoryLastTime = timestamp;
  
  if (dt > 1.0) dt = 1.0;

  const spdMult = getSpeedMultiplier();

  // 1. Manual tasks progress bars
  if (makeIsRunning) {
    makeProgress += (100 / (MAKE_BASE_DUR / spdMult)) * dt;
    if (makeProgress >= 100) {
      makeProgress = 0;
      makeIsRunning = false;
      stockUnpacked++;
      sfx.play('make');
      createFloater('btn-action-make', "+1 Product", "#3498db");
      checkAchievements();
    }
    document.getElementById('pb-make').style.width = `${makeProgress}%`;
  } else {
    document.getElementById('pb-make').style.width = '0%';
  }

  if (packIsRunning) {
    packProgress += (100 / (PACK_BASE_DUR / spdMult)) * dt;
    if (packProgress >= 100) {
      packProgress = 0;
      packIsRunning = false;
      if (Math.floor(stockUnpacked) >= boxSize) {
        stockUnpacked -= boxSize;
        stockPacked++;
        sfx.play('pack');
        createFloater('btn-action-pack', "+1 Box", "#e67e22");
        checkAchievements();
      } else {
        sfx.play('error');
        createFloater('task-pack', "Interrupted! Low Stock", "#e74c3c");
      }
    }
    document.getElementById('pb-pack').style.width = `${packProgress}%`;
  } else {
    document.getElementById('pb-pack').style.width = '0%';
  }

  if (shipIsRunning) {
    shipProgress += (100 / (SHIP_BASE_DUR / spdMult)) * dt;
    if (shipProgress >= 100) {
      shipProgress = 0;
      shipIsRunning = false;
      if (stockPacked >= 1) {
        stockPacked--;
        deliverBoxes(1, true);
      } else {
        sfx.play('error');
        createFloater('task-ship', "Interrupted! No Box", "#e74c3c");
      }
    }
    document.getElementById('pb-ship').style.width = `${shipProgress}%`;
  } else {
    document.getElementById('pb-ship').style.width = '0%';
  }

  // 2. Automation processing
  if (autoMakeRate > 0) {
    stockUnpacked += autoMakeRate * dt;
  }

  if (autoPackRate > 0 && Math.floor(stockUnpacked) > 0) {
    accumAutoPack += autoPackRate * dt;
    let unitsToPack = Math.min(Math.floor(accumAutoPack), Math.floor(stockUnpacked));
    if (unitsToPack > 0) {
      stockUnpacked -= unitsToPack;
      accumAutoPack -= unitsToPack;
      
      partiallyPackedUnits += unitsToPack;
      while (partiallyPackedUnits >= boxSize) {
        partiallyPackedUnits -= boxSize;
        stockPacked++;
        createFloater('task-pack', "+1 Box (Auto)", "#f39c12");
      }
    }
  }

  if (autoShipRate > 0 && stockPacked > 0) {
    accumAutoShip += autoShipRate * dt;
    let boxesToShip = Math.min(Math.floor(accumAutoShip), stockPacked);
    if (boxesToShip > 0) {
      stockPacked -= boxesToShip;
      accumAutoShip -= boxesToShip;
      deliverBoxes(boxesToShip, false);
    }
  }

  // Auto-save every 10 seconds approximately
  if (Math.random() < 0.002) {
    saveFactoryGame();
  }

  updateFactoryUI();
  factoryAnimId = requestAnimationFrame(factoryTick);
}

function initFactoryBoss() {
  loadFactoryGame();
  factoryActive = true;
  factoryLastTime = 0;
  accumAutoPack = 0;
  accumAutoShip = 0;
  makeIsRunning = false;
  packIsRunning = false;
  shipIsRunning = false;
  
  // Set default factory name if none set
  if (fName === "Apprentice's Shop" || !fName) {
    const names = ["Robo Assembly", "Gear Works", "Micro Fab", "Apex Mfg", "Widgetry Labs"];
    fName = names[Math.floor(Math.random() * names.length)];
  }

  renderAchievements();
  updateFactoryUI();
  factoryAnimId = requestAnimationFrame(factoryTick);
}

function exitFactoryBoss() {
  saveFactoryGame();
  factoryActive = false;
  if (factoryAnimId) cancelAnimationFrame(factoryAnimId);
}


// ==============================================================================
// ─── GALACTIC CAMPAIGN GAME MODULE ────────────────────────────────────────────
// ==============================================================================
let galacticActive = false;
let galacticAnimId = null;
let galacticLastTime = 0;
let gCanvas = null;
let gCtx = null;
let gW = 0, gH = 0;

// Upgrades & Progress state (saved in gc_save)
let gcVotes = 0;
let gcHighscore = 0;
let upgWeapon = 1;
let upgShield = 1;
let upgSpeed = 1;

// Costs
const WEAPON_COSTS = [0, 30, 75, 150];
const SHIELD_COSTS = [0, 25, 50, 100, 200];
const SPEED_COSTS = [0, 20, 45, 90];

// Game Objects
let gPlayer = { x: 0, y: 0, size: 20, shield: 100, maxShield: 100, speed: 5 };
let gLasers = [];
let gEnemyLasers = [];
let gEnemies = [];
let gAsteroids = [];
let gPowerups = [];
let gParticles = [];
let gBackgroundStars = [];

// Game play parameters
let gScore = 0;
let gVotesEarned = 0;
let gState = 'idle'; // running | over | victory
let gFrame = 0;
let bossSpawned = false;
let bossShip = null;
let gScreenShake = 0;
let fireCooldown = 0;

// Controls
let keys = {};
let pointerX = null, pointerY = null, isPointerDown = false;

// Upgrades UI hooks
function toggleGalacticShop(show) {
  const shop = document.getElementById('galactic-shop');
  if (show) {
    sfx.init();
    updateHangarUI();
    shop.classList.remove('hidden');
  } else {
    shop.classList.add('hidden');
    saveGalacticGame();
  }
}

function updateHangarUI() {
  document.getElementById('galactic-votes').textContent = gcVotes;
  
  // Weapon UI
  const weaponLvl = upgWeapon;
  const weaponDesc = weaponLvl === 1 ? "Level 1 (Single Shot)" : weaponLvl === 2 ? "Level 2 (Dual Shot)" : weaponLvl === 3 ? "Level 3 (Triple Spread)" : "Level 4 (Plasma Stream!)";
  document.getElementById('g-desc-weapon').textContent = weaponDesc;
  const weaponCost = WEAPON_COSTS[weaponLvl] || 0;
  document.getElementById('g-cost-weapon').textContent = weaponCost > 0 ? weaponCost : "MAXED";
  document.getElementById('btn-g-buy-weapon').disabled = weaponCost === 0 || gcVotes < weaponCost;
  
  // Shield UI
  const shieldLvl = upgShield;
  const maxShieldVal = 100 + (shieldLvl - 1) * 50;
  document.getElementById('g-desc-shield').textContent = `${maxShieldVal} HP (Lvl ${shieldLvl})`;
  const shieldCost = SHIELD_COSTS[shieldLvl] || 0;
  document.getElementById('g-cost-shield').textContent = shieldCost > 0 ? shieldCost : "MAXED";
  document.getElementById('btn-g-buy-shield').disabled = shieldCost === 0 || gcVotes < shieldCost;
  
  // Speed UI
  const speedLvl = upgSpeed;
  const speedVal = 5 + (speedLvl - 1) * 2;
  document.getElementById('g-desc-speed').textContent = `Speed ${speedVal} (Lvl ${speedLvl})`;
  const speedCost = SPEED_COSTS[speedLvl] || 0;
  document.getElementById('g-cost-speed').textContent = speedCost > 0 ? speedCost : "MAXED";
  document.getElementById('btn-g-buy-speed').disabled = speedCost === 0 || gcVotes < speedCost;
}

// Purchase upgrade
document.getElementById('btn-g-buy-weapon').onclick = () => {
  const cost = WEAPON_COSTS[upgWeapon];
  if (cost && gcVotes >= cost) {
    gcVotes -= cost;
    upgWeapon++;
    sfx.play('cash');
    updateHangarUI();
  }
};

document.getElementById('btn-g-buy-shield').onclick = () => {
  const cost = SHIELD_COSTS[upgShield];
  if (cost && gcVotes >= cost) {
    gcVotes -= cost;
    upgShield++;
    sfx.play('cash');
    updateHangarUI();
  }
};

document.getElementById('btn-g-buy-speed').onclick = () => {
  const cost = SPEED_COSTS[upgSpeed];
  if (cost && gcVotes >= cost) {
    gcVotes -= cost;
    upgSpeed++;
    sfx.play('cash');
    updateHangarUI();
  }
};

document.getElementById('btn-g-hangar').onclick = () => {
  sfx.play('click');
  toggleGalacticShop(true);
};
document.getElementById('btn-g-close-shop').onclick = () => {
  sfx.play('click');
  toggleGalacticShop(false);
};

// Save/Load
function saveGalacticGame() {
  const data = { gcVotes, gcHighscore, upgWeapon, upgShield, upgSpeed };
  localStorage.setItem('gc_save', JSON.stringify(data));
}

function loadGalacticGame() {
  try {
    const saved = localStorage.getItem('gc_save');
    if (!saved) return;
    const data = JSON.parse(saved);
    if (!data || typeof data !== 'object') return;
    gcVotes = data.gcVotes ?? 0;
    gcHighscore = data.gcHighscore ?? 0;
    upgWeapon = data.upgWeapon ?? 1;
    upgShield = data.upgShield ?? 1;
    upgSpeed = data.upgSpeed ?? 1;
  } catch (e) {
    console.error("Error loading Galactic save:", e);
  }
}

// Spark Particles
function createSpark(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    gParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 1,
      color,
      alpha: 1,
      decay: Math.random() * 0.03 + 0.015
    });
  }
}

// Start Game
function startGalacticGame() {
  loadGalacticGame();
  
  const speedVal = 5 + (upgSpeed - 1) * 2;
  const maxShieldVal = 100 + (upgShield - 1) * 50;
  
  gPlayer = {
    x: gW / 2,
    y: gH * 0.8,
    size: 20,
    shield: maxShieldVal,
    maxShield: maxShieldVal,
    speed: speedVal,
    weaponLvl: upgWeapon
  };
  
  gLasers = [];
  gEnemyLasers = [];
  gEnemies = [];
  gAsteroids = [];
  gPowerups = [];
  gParticles = [];
  
  gScore = 0;
  gVotesEarned = 0;
  gState = 'running';
  gFrame = 0;
  bossSpawned = false;
  bossShip = null;
  gScreenShake = 0;
  fireCooldown = 0;
  
  document.getElementById('galactic-score').textContent = gScore;
  document.getElementById('galactic-votes').textContent = gcVotes;
  document.getElementById('galactic-shield-fill').style.width = '100%';
  document.getElementById('galactic-gameover').classList.add('hidden');
  document.getElementById('galactic-victory').classList.add('hidden');
}

function initGalactic() {
  gCanvas = document.getElementById('galacticCanvas');
  gCtx = gCanvas.getContext('2d');
  
  // Resize
  gW = gCanvas.width = window.innerWidth;
  gH = gCanvas.height = window.innerHeight;
  
  loadGalacticGame();
  
  // Starfield
  gBackgroundStars = [];
  for (let i = 0; i < 60; i++) {
    gBackgroundStars.push({
      x: Math.random() * gW,
      y: Math.random() * gH,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 3 + 1
    });
  }
  
  // Handlers
  window.addEventListener('keydown', handleGCKeyDown);
  window.addEventListener('keyup', handleGCKeyUp);
  
  gCanvas.addEventListener('pointerdown', handleGCPointerDown);
  gCanvas.addEventListener('pointermove', handleGCPointerMove);
  gCanvas.addEventListener('pointerup', handleGCPointerUp);
  gCanvas.addEventListener('pointercancel', handleGCPointerUp);

  galacticActive = true;
  galacticLastTime = 0;
  
  startGalacticGame();
  galacticAnimId = requestAnimationFrame(galacticTick);
}

function exitGalactic() {
  saveGalacticGame();
  galacticActive = false;
  if (galacticAnimId) cancelAnimationFrame(galacticAnimId);
  
  window.removeEventListener('keydown', handleGCKeyDown);
  window.removeEventListener('keyup', handleGCKeyUp);
  if (gCanvas) {
    gCanvas.removeEventListener('pointerdown', handleGCPointerDown);
    gCanvas.removeEventListener('pointermove', handleGCPointerMove);
    gCanvas.removeEventListener('pointerup', handleGCPointerUp);
    gCanvas.removeEventListener('pointercancel', handleGCPointerUp);
  }
}

function handleGCKeyDown(e) { keys[e.key] = true; }
function handleGCKeyUp(e) { keys[e.key] = false; }
function handleGCPointerDown(e) {
  isPointerDown = true;
  pointerX = e.clientX;
  pointerY = e.clientY;
}
function handleGCPointerMove(e) {
  if (isPointerDown) {
    pointerX = e.clientX;
    pointerY = e.clientY;
  }
}
function handleGCPointerUp() {
  isPointerDown = false;
  pointerX = null;
  pointerY = null;
}

function endGalacticGame(victory) {
  gState = victory ? 'victory' : 'over';
  
  gcVotes += gVotesEarned;
  if (gScore > gcHighscore) {
    gcHighscore = gScore;
  }
  saveGalacticGame();
  
  if (victory) {
    sfx.play('level');
    document.getElementById('galactic-victory').classList.remove('hidden');
  } else {
    sfx.play('error');
    document.getElementById('g-result-votes').textContent = gVotesEarned;
    document.getElementById('galactic-gameover').classList.remove('hidden');
  }
}

function handlePlayerFiring() {
  if (fireCooldown > 0) {
    fireCooldown--;
    return;
  }
  
  // Fire if Space is pressed OR pointer is down
  if (keys[' '] || isPointerDown) {
    sfx.play('laser');
    
    // Weapon configurations
    const lvl = gPlayer.weaponLvl;
    const baseLaserSpeed = 15;
    
    if (lvl === 1) {
      gLasers.push({ x: gPlayer.x, y: gPlayer.y - 12, vx: 0, vy: -baseLaserSpeed, color: '#00ffff', size: 3 });
    } else if (lvl === 2) {
      gLasers.push({ x: gPlayer.x - 10, y: gPlayer.y - 4, vx: 0, vy: -baseLaserSpeed, color: '#00ffff', size: 3 });
      gLasers.push({ x: gPlayer.x + 10, y: gPlayer.y - 4, vx: 0, vy: -baseLaserSpeed, color: '#00ffff', size: 3 });
    } else if (lvl === 3) {
      gLasers.push({ x: gPlayer.x, y: gPlayer.y - 12, vx: 0, vy: -baseLaserSpeed, color: '#00ffff', size: 3 });
      gLasers.push({ x: gPlayer.x - 12, y: gPlayer.y, vx: -3, vy: -baseLaserSpeed + 1, color: '#00ffff', size: 3 });
      gLasers.push({ x: gPlayer.x + 12, y: gPlayer.y, vx: 3, vy: -baseLaserSpeed + 1, color: '#00ffff', size: 3 });
    } else {
      // Plasma Stream (level 4)
      gLasers.push({ x: gPlayer.x, y: gPlayer.y - 12, vx: 0, vy: -baseLaserSpeed - 3, color: '#ff00ff', size: 4 });
      gLasers.push({ x: gPlayer.x - 15, y: gPlayer.y - 2, vx: -1.5, vy: -baseLaserSpeed - 1, color: '#00ffff', size: 3 });
      gLasers.push({ x: gPlayer.x + 15, y: gPlayer.y - 2, vx: 1.5, vy: -baseLaserSpeed - 1, color: '#00ffff', size: 3 });
    }
    
    // Cooldown
    fireCooldown = lvl >= 4 ? 6 : lvl === 3 ? 9 : 12;
  }
}

// Collision Helper
function checkCircleCollision(c1, c2) {
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < (c1.size + c2.size);
}

function playerHit(damage) {
  gPlayer.shield -= damage;
  gScreenShake = 12;
  updateShieldHUD();
  sfx.play('error');
  createSpark(gPlayer.x, gPlayer.y, '#ff007f', 10);
  
  if (gPlayer.shield <= 0) {
    gPlayer.shield = 0;
    updateShieldHUD();
    createSpark(gPlayer.x, gPlayer.y, '#ff00ff', 30);
    sfx.play('explosion');
    endGalacticGame(false);
  }
}

function updateShieldHUD() {
  const pct = (gPlayer.shield / gPlayer.maxShield) * 100;
  document.getElementById('galactic-shield-fill').style.width = `${pct}%`;
}

function spawnPowerupChance(x, y) {
  const rand = Math.random();
  if (rand < 0.22) { // 22% chance to drop powerup
    let type = 'vote';
    let label = '🗳️';
    let color = '#f1c40f';
    const typeRand = Math.random();
    
    if (typeRand > 0.8) {
      type = 'bomb';
      label = '💣';
      color = '#ff007f';
    } else if (typeRand > 0.55) {
      type = 'weapon';
      label = '⚡';
      color = '#00ffff';
    } else if (typeRand > 0.3) {
      type = 'shield';
      label = '🛡️';
      color = '#2ecc71';
    }
    
    gPowerups.push({
      x, y,
      type, label, color,
      size: 15
    });
  }
}

function updateGalactic(dt) {
  gFrame++;
  
  if (gScreenShake > 0) gScreenShake *= 0.9;
  
  // Stars scroll
  gBackgroundStars.forEach(s => {
    s.y += s.speed;
    if (s.y > gH) {
      s.y = 0;
      s.x = Math.random() * gW;
    }
  });
  
  if (gState !== 'running') return;
  
  // Player Movement (Desktop)
  let dx = 0;
  let dy = 0;
  if (keys['ArrowLeft'] || keys['a']) dx = -gPlayer.speed;
  if (keys['ArrowRight'] || keys['d']) dx = gPlayer.speed;
  if (keys['ArrowUp'] || keys['w']) dy = -gPlayer.speed;
  if (keys['ArrowDown'] || keys['s']) dy = gPlayer.speed;
  
  gPlayer.x += dx;
  gPlayer.y += dy;
  
  // Player Movement (Mouse/Touch Drag)
  if (isPointerDown && pointerX !== null && pointerY !== null) {
    const lerpSpeed = 0.15;
    gPlayer.x += (pointerX - gPlayer.x) * lerpSpeed;
    gPlayer.y += (pointerY - gPlayer.y) * lerpSpeed;
  }
  
  // Constraints
  gPlayer.x = Math.max(gPlayer.size, Math.min(gW - gPlayer.size, gPlayer.x));
  gPlayer.y = Math.max(gPlayer.size + 80, Math.min(gH - gPlayer.size, gPlayer.y));
  
  // Handle Firing
  handlePlayerFiring();
  
  // Lasers Update
  for (let i = gLasers.length - 1; i >= 0; i--) {
    const l = gLasers[i];
    l.x += l.vx;
    l.y += l.vy;
    if (l.y < 80 || l.x < 0 || l.x > gW) {
      gLasers.splice(i, 1);
    }
  }
  
  for (let i = gEnemyLasers.length - 1; i >= 0; i--) {
    const l = gEnemyLasers[i];
    l.x += l.vx;
    l.y += l.vy;
    if (l.y > gH || l.x < 0 || l.x > gW) {
      gEnemyLasers.splice(i, 1);
    }
  }
  
  // Hazard/Enemy Spawns
  if (!bossSpawned) {
    // Regular gameplay
    if (gFrame % 80 === 0 && gEnemies.length < 8) {
      const typeChance = Math.random();
      let type = 'scout';
      let size = 15;
      let shield = 1;
      let color = '#2ecc71';
      let scoreVal = 50;
      
      if (typeChance > 0.85) {
        type = 'destroyer';
        size = 25;
        shield = 4;
        color = '#ff00ff';
        scoreVal = 200;
      } else if (typeChance > 0.55) {
        type = 'fighter';
        size = 18;
        shield = 2;
        color = '#e67e22';
        scoreVal = 100;
      }
      
      gEnemies.push({
        x: Math.random() * (gW - 60) + 30,
        y: -30,
        type, size, shield, maxShield: shield,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 1.5 + 1.5,
        color, scoreVal,
        shootTimer: Math.random() * 100 + 40
      });
    }
    
    // Spawn Asteroids
    if (gFrame % 90 === 0 && gAsteroids.length < 5) {
      const sizeVal = Math.random() * 30 + 15;
      gAsteroids.push({
        x: Math.random() * gW,
        y: -40,
        size: sizeVal,
        vx: (Math.random() - 0.5) * 1.5,
        vy: Math.random() * 2 + 1,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.04,
        shield: Math.floor(sizeVal / 10)
      });
    }
    
    // Boss trigger at score 2500
    if (gScore >= 2500) {
      bossSpawned = true;
      bossShip = {
        x: gW / 2,
        y: -100,
        size: 70,
        shield: 100,
        maxShield: 100,
        vx: 2,
        vy: 1,
        shootTimer: 0
      };
      // Clear out regular spawns with an explosion effect
      gEnemies.forEach(e => {
        createSpark(e.x, e.y, e.color, 12);
        sfx.play('explosion');
      });
      gEnemies = [];
      gAsteroids = [];
      showPowerupBanner("⚠️ BOSS WARNING: MOTHERSHIP INCOMING!");
    }
  } else if (bossShip) {
    // Boss update
    if (bossShip.y < 160) {
      bossShip.y += bossShip.vy;
    } else {
      bossShip.x += bossShip.vx;
      if (bossShip.x - bossShip.size < 0 || bossShip.x + bossShip.size > gW) {
        bossShip.vx *= -1;
      }
    }
    
    // Boss Shooting
    bossShip.shootTimer++;
    if (bossShip.shootTimer >= 45) {
      bossShip.shootTimer = 0;
      sfx.play('laser');
      // Fire 3 laser spread
      const laserSpeed = 8;
      gEnemyLasers.push({ x: bossShip.x, y: bossShip.y + 40, vx: 0, vy: laserSpeed, color: '#e74c3c', size: 4 });
      gEnemyLasers.push({ x: bossShip.x - 30, y: bossShip.y + 20, vx: -2, vy: laserSpeed - 0.5, color: '#e74c3c', size: 3 });
      gEnemyLasers.push({ x: bossShip.x + 30, y: bossShip.y + 20, vx: 2, vy: laserSpeed - 0.5, color: '#e74c3c', size: 3 });
    }
  }
  
  // Update Enemies
  for (let i = gEnemies.length - 1; i >= 0; i--) {
    const e = gEnemies[i];
    e.x += e.vx;
    e.y += e.vy;
    
    // Bounds check
    if (e.x - e.size < 0 || e.x + e.size > gW) e.vx *= -1;
    if (e.y > gH + 50) {
      gEnemies.splice(i, 1);
      continue;
    }
    
    // Enemy shooting
    e.shootTimer--;
    if (e.shootTimer <= 0) {
      e.shootTimer = Math.random() * 150 + 80;
      sfx.play('laser');
      gEnemyLasers.push({
        x: e.x,
        y: e.y + e.size,
        vx: 0,
        vy: 6,
        color: '#ff0055',
        size: 3
      });
    }
    
    // Player collision with enemy
    if (checkCircleCollision(gPlayer, e)) {
      playerHit(25);
      createSpark(e.x, e.y, e.color, 12);
      gEnemies.splice(i, 1);
      sfx.play('explosion');
    }
  }
  
  // Update Asteroids
  for (let i = gAsteroids.length - 1; i >= 0; i--) {
    const a = gAsteroids[i];
    a.x += a.vx;
    a.y += a.vy;
    a.angle += a.spin;
    
    if (a.y > gH + 50) {
      gAsteroids.splice(i, 1);
      continue;
    }
    
    // Player collision with Asteroid
    if (checkCircleCollision(gPlayer, a)) {
      playerHit(Math.floor(a.size));
      createSpark(a.x, a.y, '#95a5a6', 15);
      gAsteroids.splice(i, 1);
      sfx.play('explosion');
    }
  }
  
  // Update Powerups
  for (let i = gPowerups.length - 1; i >= 0; i--) {
    const p = gPowerups[i];
    p.y += 2.5;
    
    if (p.y > gH + 20) {
      gPowerups.splice(i, 1);
      continue;
    }
    
    // Collide with player
    if (checkCircleCollision(gPlayer, p)) {
      sfx.play('shield');
      if (p.type === 'vote') {
        gVotesEarned += 5;
        createFloater('galacticCanvas', "+5 Credits 🗳️", "#f1c40f");
      } else if (p.type === 'shield') {
        gPlayer.shield = Math.min(gPlayer.maxShield, gPlayer.shield + 40);
        updateShieldHUD();
        createFloater('galacticCanvas', "Shield Restored! 🛡️", "#2ecc71");
      } else if (p.type === 'weapon') {
        // Upgrade weapon temporarily (for this run only, up to level 4)
        if (gPlayer.weaponLvl < 4) {
          gPlayer.weaponLvl++;
          createFloater('galacticCanvas', "Weapon Level UP! ⚡", "#00ffff");
        } else {
          gScore += 500;
          createFloater('galacticCanvas', "+500 Pts!", "#00ffff");
        }
      } else if (p.type === 'bomb') {
        // Explode all standard enemies on screen
        gEnemies.forEach(e => {
          createSpark(e.x, e.y, e.color, 12);
          gScore += e.scoreVal;
        });
        gEnemies = [];
        gAsteroids = [];
        gScreenShake = 20;
        sfx.play('explosion');
        createFloater('galacticCanvas', "Smart Bomb! 💣", "#ff007f");
      }
      gPowerups.splice(i, 1);
    }
  }
  
  // Laser collisions with Enemies / Asteroids
  for (let li = gLasers.length - 1; li >= 0; li--) {
    const l = gLasers[li];
    let laserHitObstacle = false;
    
    // Hit asteroids
    for (let ai = gAsteroids.length - 1; ai >= 0; ai--) {
      const a = gAsteroids[ai];
      if (checkCircleCollision(l, a)) {
        laserHitObstacle = true;
        a.shield--;
        createSpark(l.x, l.y, '#95a5a6', 4);
        
        if (a.shield <= 0) {
          createSpark(a.x, a.y, '#7f8c8d', 10);
          spawnPowerupChance(a.x, a.y);
          gAsteroids.splice(ai, 1);
          gScore += 20;
          document.getElementById('galactic-score').textContent = gScore;
          sfx.play('explosion');
        }
        break;
      }
    }
    
    if (laserHitObstacle) {
      gLasers.splice(li, 1);
      continue;
    }
    
    // Hit enemies
    for (let ei = gEnemies.length - 1; ei >= 0; ei--) {
      const e = gEnemies[ei];
      if (checkCircleCollision(l, e)) {
        laserHitObstacle = true;
        e.shield--;
        createSpark(l.x, l.y, e.color, 4);
        
        if (e.shield <= 0) {
          createSpark(e.x, e.y, e.color, 14);
          spawnPowerupChance(e.x, e.y);
          gEnemies.splice(ei, 1);
          gScore += e.scoreVal;
          document.getElementById('galactic-score').textContent = gScore;
          sfx.play('explosion');
        }
        break;
      }
    }
    
    if (laserHitObstacle) {
      gLasers.splice(li, 1);
      continue;
    }
    
    // Hit Boss
    if (bossShip && checkCircleCollision(l, bossShip)) {
      gLasers.splice(li, 1);
      bossShip.shield -= l.size; // weapon level determines damage
      createSpark(l.x, l.y, '#ff00ff', 6);
      gScreenShake = 4;
      
      if (bossShip.shield <= 0) {
        createSpark(bossShip.x, bossShip.y, '#ff0055', 40);
        gScore += 5000;
        document.getElementById('galactic-score').textContent = gScore;
        bossShip = null;
        sfx.play('explosion');
        endGalacticGame(true);
      }
    }
  }
  
  // Hit player with Enemy Lasers
  for (let li = gEnemyLasers.length - 1; li >= 0; li--) {
    const el = gEnemyLasers[li];
    if (checkCircleCollision(el, gPlayer)) {
      playerHit(15);
      gEnemyLasers.splice(li, 1);
    }
  }
  
  // Particles Update
  for (let i = gParticles.length - 1; i >= 0; i--) {
    const p = gParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      gParticles.splice(i, 1);
    }
  }
}

function drawGalactic() {
  gCtx.fillStyle = '#050510';
  gCtx.fillRect(0, 0, gW, gH);
  
  gCtx.save();
  // Screen shake
  if (gScreenShake > 0.5) {
    const dx = (Math.random() - 0.5) * gScreenShake;
    const dy = (Math.random() - 0.5) * gScreenShake;
    gCtx.translate(dx, dy);
  }
  
  // Stars
  gCtx.fillStyle = '#ffffff';
  gBackgroundStars.forEach(s => {
    gCtx.globalAlpha = s.speed / 4; // parallax alpha
    gCtx.fillRect(s.x, s.y, s.size, s.size);
  });
  gCtx.globalAlpha = 1.0;
  
  // Powerups
  gPowerups.forEach(p => {
    gCtx.save();
    gCtx.shadowColor = p.color;
    gCtx.shadowBlur = 10;
    gCtx.fillStyle = p.color;
    gCtx.beginPath();
    gCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    gCtx.fill();
    
    // Label
    gCtx.fillStyle = '#000';
    gCtx.font = '10px Outfit,sans-serif';
    gCtx.textAlign = 'center';
    gCtx.textBaseline = 'middle';
    gCtx.fillText(p.label === '🗳️' ? 'V' : p.label, p.x, p.y);
    gCtx.restore();
  });
  
  // Lasers
  gLasers.forEach(l => {
    gCtx.save();
    gCtx.strokeStyle = l.color;
    gCtx.lineWidth = l.size;
    gCtx.lineCap = 'round';
    gCtx.shadowColor = l.color;
    gCtx.shadowBlur = 8;
    gCtx.beginPath();
    gCtx.moveTo(l.x, l.y);
    gCtx.lineTo(l.x - l.vx * 0.4, l.y - l.vy * 0.4);
    gCtx.stroke();
    gCtx.restore();
  });
  
  gEnemyLasers.forEach(l => {
    gCtx.save();
    gCtx.strokeStyle = l.color;
    gCtx.lineWidth = l.size;
    gCtx.lineCap = 'round';
    gCtx.shadowColor = l.color;
    gCtx.shadowBlur = 8;
    gCtx.beginPath();
    gCtx.moveTo(l.x, l.y);
    gCtx.lineTo(l.x - l.vx * 0.4, l.y - l.vy * 0.4);
    gCtx.stroke();
    gCtx.restore();
  });
  
  // Player Ship
  if (gState === 'running') {
    gCtx.save();
    gCtx.shadowColor = '#00ffff';
    gCtx.shadowBlur = 15;
    gCtx.fillStyle = '#050510';
    gCtx.strokeStyle = '#00ffff';
    gCtx.lineWidth = 3;
    
    // Draw delta wing ship
    gCtx.beginPath();
    gCtx.moveTo(gPlayer.x, gPlayer.y - gPlayer.size);
    gCtx.lineTo(gPlayer.x - gPlayer.size, gPlayer.y + gPlayer.size);
    gCtx.lineTo(gPlayer.x, gPlayer.y + gPlayer.size * 0.4);
    gCtx.lineTo(gPlayer.x + gPlayer.size, gPlayer.y + gPlayer.size);
    gCtx.closePath();
    gCtx.fill();
    gCtx.stroke();
    
    // Neon Thruster flame
    const flameH = Math.random() * 12 + 6;
    gCtx.fillStyle = '#ff007f';
    gCtx.beginPath();
    gCtx.moveTo(gPlayer.x - 6, gPlayer.y + gPlayer.size * 0.5);
    gCtx.lineTo(gPlayer.x, gPlayer.y + gPlayer.size * 0.5 + flameH);
    gCtx.lineTo(gPlayer.x + 6, gPlayer.y + gPlayer.size * 0.5);
    gCtx.closePath();
    gCtx.fill();
    gCtx.restore();
  }
  
  // Enemies
  gEnemies.forEach(e => {
    gCtx.save();
    gCtx.shadowColor = e.color;
    gCtx.shadowBlur = 10;
    gCtx.strokeStyle = e.color;
    gCtx.lineWidth = 2.5;
    gCtx.fillStyle = '#050510';
    
    if (e.type === 'scout') {
      // Small triangle downward
      gCtx.beginPath();
      gCtx.moveTo(e.x, e.y + e.size);
      gCtx.lineTo(e.x - e.size, e.y - e.size * 0.6);
      gCtx.lineTo(e.x + e.size, e.y - e.size * 0.6);
      gCtx.closePath();
      gCtx.fill(); gCtx.stroke();
    } else if (e.type === 'fighter') {
      // Diamond
      gCtx.beginPath();
      gCtx.moveTo(e.x, e.y - e.size);
      gCtx.lineTo(e.x + e.size * 0.8, e.y);
      gCtx.lineTo(e.x, e.y + e.size);
      gCtx.lineTo(e.x - e.size * 0.8, e.y);
      gCtx.closePath();
      gCtx.fill(); gCtx.stroke();
    } else {
      // Destroyer (chevron)
      gCtx.beginPath();
      gCtx.moveTo(e.x, e.y - e.size);
      gCtx.lineTo(e.x + e.size, e.y - e.size * 0.5);
      gCtx.lineTo(e.x + e.size * 0.5, e.y + e.size);
      gCtx.lineTo(e.x, e.y + e.size * 0.3);
      gCtx.lineTo(e.x - e.size * 0.5, e.y + e.size);
      gCtx.lineTo(e.x - e.size, e.y - e.size * 0.5);
      gCtx.closePath();
      gCtx.fill(); gCtx.stroke();
    }
    
    // Draw mini shield bar if hit
    if (e.shield < e.maxShield) {
      const barW = e.size * 1.5;
      gCtx.fillStyle = 'rgba(255,255,255,0.1)';
      gCtx.fillRect(e.x - barW / 2, e.y - e.size - 10, barW, 4);
      gCtx.fillStyle = e.color;
      gCtx.fillRect(e.x - barW / 2, e.y - e.size - 10, barW * (e.shield / e.maxShield), 4);
    }
    gCtx.restore();
  });
  
  // Asteroids
  gAsteroids.forEach(a => {
    gCtx.save();
    gCtx.translate(a.x, a.y);
    gCtx.rotate(a.angle);
    gCtx.strokeStyle = '#95a5a6';
    gCtx.fillStyle = '#1e272c';
    gCtx.lineWidth = 2;
    
    // Draw rough polygon
    gCtx.beginPath();
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const ang = (Math.PI * 2 / steps) * i;
      // random radius factor for craggy look
      const r = a.size * (0.8 + (Math.sin(i * 1.7) + 1) * 0.12);
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) gCtx.moveTo(px, py);
      else gCtx.lineTo(px, py);
    }
    gCtx.closePath();
    gCtx.fill();
    gCtx.stroke();
    gCtx.restore();
  });
  
  // Boss Ship
  if (bossShip) {
    gCtx.save();
    gCtx.shadowColor = '#e74c3c';
    gCtx.shadowBlur = 20;
    gCtx.strokeStyle = '#e74c3c';
    gCtx.fillStyle = '#0a0505';
    gCtx.lineWidth = 4;
    
    // Draw massive Mothership
    gCtx.beginPath();
    gCtx.moveTo(bossShip.x, bossShip.y + bossShip.size * 0.6);
    gCtx.lineTo(bossShip.x - bossShip.size, bossShip.y - bossShip.size * 0.3);
    gCtx.lineTo(bossShip.x - bossShip.size * 0.5, bossShip.y - bossShip.size * 0.8);
    gCtx.lineTo(bossShip.x + bossShip.size * 0.5, bossShip.y - bossShip.size * 0.8);
    gCtx.lineTo(bossShip.x + bossShip.size, bossShip.y - bossShip.size * 0.3);
    gCtx.closePath();
    gCtx.fill();
    gCtx.stroke();
    
    // Boss cores
    gCtx.fillStyle = '#ff007f';
    gCtx.beginPath();
    gCtx.arc(bossShip.x - 30, bossShip.y - 10, 8, 0, Math.PI * 2);
    gCtx.arc(bossShip.x + 30, bossShip.y - 10, 8, 0, Math.PI * 2);
    gCtx.fill();
    
    // Boss main shield bar
    const barW = bossShip.size * 2.2;
    gCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    gCtx.fillRect(bossShip.x - barW / 2, bossShip.y - bossShip.size - 18, barW, 8);
    gCtx.fillStyle = '#e74c3c';
    gCtx.fillRect(bossShip.x - barW / 2, bossShip.y - bossShip.size - 18, barW * (bossShip.shield / bossShip.maxShield), 8);
    
    gCtx.restore();
  }
  
  // Particles
  gParticles.forEach(p => {
    gCtx.save();
    gCtx.globalAlpha = p.alpha;
    gCtx.fillStyle = p.color;
    gCtx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    gCtx.restore();
  });
  gCtx.globalAlpha = 1.0;
  
  gCtx.restore();
}

function galacticTick(timestamp) {
  if (!galacticActive) return;
  if (!galacticLastTime) galacticLastTime = timestamp;
  let dt = (timestamp - galacticLastTime) / 1000;
  galacticLastTime = timestamp;
  
  if (dt > 0.1) dt = 0.1;
  
  updateGalactic(dt);
  drawGalactic();
  
  galacticAnimId = requestAnimationFrame(galacticTick);
}


// ==============================================================================
// ─── SLINGSHOT CAMPAIGN GAME MODULE ───────────────────────────────────────────
// ==============================================================================
let slingshotActive = false;
let slingshotLastTime = 0;
let slingshotAnimId = null;

let sCanvas, sCtx, sW, sH;
let sGameState = 'select'; // select | ready | dragging | flying | settled | win | fail

let currentLevelIdx = 0;
let shotsRemaining = 3;
let sScore = 0;

let sBlocks = [];
let sTargets = [];
let sProjectiles = []; // active flying ones
let currentProjectile = null; // one loaded in the slingshot
let sParticles = [];
let sScreenShake = 0;

const slingshotPos = { x: 180, y: 0 };
const maxDragDist = 110;
const launchForceMultiplier = 0.17;
const gravity = 0.32;
let groundY = 0;

// Mouse/touch drag state
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };

const levelQueues = [
  ['Standard', 'Triple', 'Megaphone'],
  ['Heavy', 'Triple', 'Megaphone'],
  ['Heavy', 'Standard', 'Triple', 'Heavy']
];

const levelNames = [
  "LEVEL 1: SIMPLE STACK",
  "LEVEL 2: THE FORT",
  "LEVEL 3: DOUBLE TROUBLE"
];

function createBlock(x, y, w, h, type) {
  let hp = 40;
  let density = 1;
  let color = '#8E5A36';
  let border = '#6D3F21';
  let scoreVal = 100;
  
  if (type === 'stone') {
    hp = 100; density = 2.8; color = '#7F8C8D'; border = '#5F6C6D'; scoreVal = 250;
  } else if (type === 'glass') {
    hp = 15; density = 0.5; color = 'rgba(135, 206, 250, 0.7)'; border = '#87CEFA'; scoreVal = 50;
  }
  return { x, y, w, h, vx: 0, vy: 0, type, hp, maxHp: hp, density, color, border, scoreVal, isStatic: false };
}

function createTarget(x, y, type = 'boss') {
  return {
    x, y, r: 18,
    vx: 0, vy: 0,
    hp: 20, maxHp: 20,
    color: '#FF6B00',
    border: '#E74C3C',
    type
  };
}

function loadSlingshotScores() {
  try {
    const raw = localStorage.getItem('vq_slingshot_scores');
    if (!raw) return [0, 0, 0];
    const scores = JSON.parse(raw);
    if (Array.isArray(scores)) {
      while (scores.length < 3) {
        scores.push(0);
      }
      return scores;
    }
    return [0, 0, 0];
  } catch(e) {
    return [0, 0, 0];
  }
}

function saveSlingshotScore(lvlIdx, score) {
  try {
    const scores = loadSlingshotScores();
    if (score > scores[lvlIdx]) {
      scores[lvlIdx] = score;
      localStorage.setItem('vq_slingshot_scores', JSON.stringify(scores));
    }
  } catch(e) {}
}

function renderSlingshotLevels() {
  const scores = loadSlingshotScores();
  const btns = document.querySelectorAll('.s-level-btn');
  btns.forEach((btn, idx) => {
    btn.innerHTML = `${levelNames[idx]}<br><span style="font-size:0.75rem; color:var(--gold);">High Score: ${scores[idx] || 0}</span>`;
  });
}

function initSlingshot() {
  sCanvas = document.getElementById('slingshotCanvas');
  sCtx = sCanvas.getContext('2d');
  
  resizeSlingshot();
  window.addEventListener('resize', resizeSlingshot);
  
  // Wire level selector click events
  document.querySelectorAll('.s-level-btn').forEach(btn => {
    btn.onclick = (e) => {
      sfx.play('click');
      const lvl = parseInt(btn.dataset.level);
      startSlingshotLevel(lvl);
    };
  });
  
  // Drag and active click events
  sCanvas.onpointerdown = handlePointerDown;
  sCanvas.onpointermove = handlePointerMove;
  sCanvas.onpointerup = handlePointerUp;
  
  renderSlingshotLevels();
  document.getElementById('slingshot-level-select').classList.remove('hidden');
  
  slingshotActive = true;
  slingshotLastTime = 0;
  slingshotAnimId = requestAnimationFrame(slingshotTick);
}

function handlePointerDown(e) {
  e.preventDefault();
  sfx.init();
  const rect = sCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  
  if (sGameState === 'ready' && currentProjectile) {
    const dx = px - slingshotPos.x;
    const dy = py - slingshotPos.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 60) { // Clicked near slingshot base
      isDragging = true;
      dragStart.x = slingshotPos.x;
      dragStart.y = slingshotPos.y;
      dragCurrent.x = px;
      dragCurrent.y = py;
      sGameState = 'dragging';
    }
  } else if (sGameState === 'flying') {
    // Check if player clicked during flight to trigger mid-air ability!
    triggerSpecialAbility();
  }
}

function triggerSpecialAbility() {
  sProjectiles.forEach(p => {
    if (p.state === 'flying' && !p.abilityUsed) {
      if (p.type === 'Megaphone') {
        p.abilityUsed = true;
        let speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
        if (speed > 0.5) {
          p.vx = (p.vx / speed) * (speed * 1.8);
          p.vy = (p.vy / speed) * (speed * 1.8);
        }
        sfx.play('boost');
        sScreenShake = 8;
        // Spawn trail sparks
        for (let i = 0; i < 20; i++) {
          sParticles.push({
            x: p.x, y: p.y,
            vx: (Math.random() - 0.5) * 6 - p.vx * 0.3,
            vy: (Math.random() - 0.5) * 6 - p.vy * 0.3,
            size: Math.random() * 4 + 2,
            color: '#3498db',
            alpha: 1,
            decay: Math.random() * 0.05 + 0.02
          });
        }
      } else if (p.type === 'Triple') {
        p.abilityUsed = true;
        sfx.play('boost');
        
        // Spawn 2 clone balls at slightly offset launch vectors
        const vx1 = p.vx * 0.96 - p.vy * 0.08;
        const vy1 = p.vy * 0.96 + p.vx * 0.08;
        
        const vx2 = p.vx * 0.96 + p.vy * 0.08;
        const vy2 = p.vy * 0.96 - p.vx * 0.08;
        
        const clone1 = { ...p, vx: vx1, vy: vy1, abilityUsed: true };
        const clone2 = { ...p, vx: vx2, vy: vy2, abilityUsed: true };
        
        sProjectiles.push(clone1, clone2);
        
        // Trailing particles
        spawnSlingshotParticles(p.x, p.y, '#9b59b6', 15);
      }
    }
  });
}

function handlePointerMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  const rect = sCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  
  const dx = px - slingshotPos.x;
  const dy = py - slingshotPos.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  
  if (dist > maxDragDist) {
    dragCurrent.x = slingshotPos.x + (dx / dist) * maxDragDist;
    dragCurrent.y = slingshotPos.y + (dy / dist) * maxDragDist;
  } else {
    dragCurrent.x = px;
    dragCurrent.y = py;
  }
}

function handlePointerUp(e) {
  if (!isDragging) return;
  e.preventDefault();
  isDragging = false;
  
  const dx = slingshotPos.x - dragCurrent.x;
  const dy = slingshotPos.y - dragCurrent.y;
  
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
    // Launch!
    sfx.play('launch');
    
    currentProjectile.vx = dx * launchForceMultiplier;
    currentProjectile.vy = dy * launchForceMultiplier;
    currentProjectile.state = 'flying';
    
    sProjectiles = [currentProjectile];
    currentProjectile = null;
    sGameState = 'flying';
    shotsRemaining--;
    
    document.getElementById('slingshot-shots').textContent = shotsRemaining;
  } else {
    // Cancel drag
    sGameState = 'ready';
  }
}

function buildLevel(idx) {
  sBlocks = [];
  sTargets = [];
  sParticles = [];
  
  const floorY = groundY;
  const bx = Math.max(300, sW - 340); // responsive structures starting base
  
  if (idx === 0) {
    // Level 1: Simple Stack
    sBlocks.push(createBlock(bx, floorY - 80, 20, 80, 'wood'));
    sBlocks.push(createBlock(bx + 100, floorY - 80, 20, 80, 'wood'));
    sBlocks.push(createBlock(bx - 20, floorY - 100, 140, 20, 'wood'));
    sTargets.push(createTarget(bx + 50, floorY - 120));
  } 
  else if (idx === 1) {
    // Level 2: The Fort
    sBlocks.push(createBlock(bx, floorY - 80, 25, 80, 'stone'));
    sBlocks.push(createBlock(bx + 100, floorY - 80, 25, 80, 'stone'));
    sBlocks.push(createBlock(bx + 200, floorY - 80, 25, 80, 'stone'));
    sBlocks.push(createBlock(bx - 20, floorY - 100, 260, 20, 'wood'));
    
    sTargets.push(createTarget(bx + 50, floorY - 120));
    sTargets.push(createTarget(bx + 150, floorY - 120));
    
    sBlocks.push(createBlock(bx + 50, floorY - 180, 20, 80, 'wood'));
    sBlocks.push(createBlock(bx + 130, floorY - 180, 20, 80, 'wood'));
    sBlocks.push(createBlock(bx + 40, floorY - 200, 120, 20, 'glass'));
    
    sTargets.push(createTarget(bx + 100, floorY - 220));
  } 
  else if (idx === 2) {
    // Level 3: Double Trouble
    // Structure 1: Glass tower (Fragile) on the left
    sBlocks.push(createBlock(bx, floorY - 60, 15, 60, 'glass'));
    sBlocks.push(createBlock(bx + 70, floorY - 60, 15, 60, 'glass'));
    sBlocks.push(createBlock(bx - 10, floorY - 80, 105, 20, 'glass'));
    sTargets.push(createTarget(bx + 42, floorY - 100));
    
    sBlocks.push(createBlock(bx + 10, floorY - 140, 15, 60, 'glass'));
    sBlocks.push(createBlock(bx + 60, floorY - 140, 15, 60, 'glass'));
    sBlocks.push(createBlock(bx, floorY - 160, 90, 20, 'glass'));
    sTargets.push(createTarget(bx + 45, floorY - 180));
    
    // Structure 2: Heavy stone fortress on the right
    sBlocks.push(createBlock(bx + 150, floorY - 80, 30, 80, 'stone'));
    sBlocks.push(createBlock(bx + 240, floorY - 80, 30, 80, 'stone'));
    sBlocks.push(createBlock(bx + 130, floorY - 100, 160, 20, 'stone'));
    
    // Wood column on top of stone
    sBlocks.push(createBlock(bx + 200, floorY - 180, 20, 80, 'wood'));
    sTargets.push(createTarget(bx + 210, floorY - 200));
  }
}

function prepareNextProjectile() {
  const queue = levelQueues[currentLevelIdx];
  const firedCount = queue.length - shotsRemaining;
  
  if (firedCount >= 0 && firedCount < queue.length) {
    ammoType = queue[firedCount];
    
    let radius = 15;
    let mass = 1;
    let color = '#F5C518';
    
    if (ammoType === 'Megaphone') {
      radius = 13; mass = 0.85; color = '#3498db';
    } else if (ammoType === 'Triple') {
      radius = 12; mass = 0.95; color = '#9b59b6';
    } else if (ammoType === 'Heavy') {
      radius = 22; mass = 3.6; color = '#7f8c8d';
    }
    
    currentProjectile = {
      x: slingshotPos.x,
      y: slingshotPos.y,
      vx: 0,
      vy: 0,
      r: radius,
      mass: mass,
      color: color,
      type: ammoType,
      state: 'idle',
      abilityUsed: false
    };
    
    sProjectiles = [currentProjectile];
    sGameState = 'ready';
    
    // Update ammo label on HUD
    document.getElementById('slingshot-ammo-type').textContent = getAmmoDisplayName(ammoType);
    document.getElementById('slingshot-ammo-type').style.color = color;
    document.getElementById('slingshot-ammo-type').style.borderColor = color + '40';
    document.getElementById('slingshot-ammo-type').style.background = color + '15';
  } else {
    currentProjectile = null;
    sProjectiles = [];
  }
}

function getAmmoDisplayName(type) {
  if (type === 'Standard') return 'Standard Ballot';
  if (type === 'Megaphone') return 'Sonic Megaphone';
  if (type === 'Triple') return 'Triple Vote';
  if (type === 'Heavy') return 'Heavy Ballot Box';
  return type;
}

function spawnSlingshotParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 1.5;
    sParticles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 4 + 1.5,
      color: color,
      alpha: 1.0,
      decay: Math.random() * 0.04 + 0.02
    });
  }
}

function updateSlingshot(dt) {
  // 1. Gravity and position updates
  sBlocks.forEach(b => {
    b.vy += gravity;
    b.x += b.vx;
    b.y += b.vy;
    
    // Friction
    b.vx *= 0.985;
    b.vy *= 0.985;
    
    // Ground collision
    if (b.y + b.h > groundY) {
      b.y = groundY - b.h;
      b.vy = -b.vy * 0.15; // light elastic bounce
      b.vx *= 0.65; // ground friction
      if (Math.abs(b.vy) < 0.15) b.vy = 0;
      if (Math.abs(b.vx) < 0.15) b.vx = 0;
    }
  });
  
  sTargets.forEach(t => {
    if (t.hp <= 0) return;
    t.vy += gravity;
    t.x += t.vx;
    t.y += t.vy;
    
    // Friction
    t.vx *= 0.985;
    t.vy *= 0.985;
    
    // Ground collision
    if (t.y + t.r > groundY) {
      t.y = groundY - t.r;
      t.vy = -t.vy * 0.2;
      t.vx *= 0.7;
      
      // Damage target if hitting hard
      if (Math.abs(t.vy) > 2.0) {
        t.hp -= Math.abs(t.vy) * 3;
        sfx.play('hit');
      }
    }
  });
  
  sProjectiles.forEach(p => {
    if (p.state !== 'flying') return;
    p.vy += gravity;
    p.x += p.vx;
    p.y += p.vy;
    
    // Air friction
    p.vx *= 0.995;
    p.vy *= 0.995;
    
    // Ground collision
    if (p.y + p.r > groundY) {
      p.y = groundY - p.r;
      p.vy = -p.vy * 0.35; // bounce
      p.vx *= 0.8;
      if (Math.abs(p.vx) < 0.2 && Math.abs(p.vy) < 0.2) {
        p.state = 'settled';
      }
    }
    
    // Offscreen checks
    if (p.x < -100 || p.x > sW + 100 || p.y > sH + 100) {
      p.state = 'settled';
    }
  });
  
  // 2. Physics collisions resolution (relaxation loop for stack stability)
  for (let iter = 0; iter < 4; iter++) {
    // Block vs Block
    for (let i = 0; i < sBlocks.length; i++) {
      for (let j = i + 1; j < sBlocks.length; j++) {
        let a = sBlocks[i];
        let b = sBlocks[j];
        if (checkAABBOverlap(a, b)) {
          let overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          let overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapX < overlapY) {
            let sign = (a.x + a.w/2 < b.x + b.w/2) ? -1 : 1;
            let totalD = a.density + b.density;
            let ratioA = b.density / totalD;
            let ratioB = a.density / totalD;
            a.x += sign * overlapX * ratioA;
            b.x -= sign * overlapX * ratioB;
            // Momentum transfer
            let avg = (a.vx + b.vx) / 2;
            a.vx = avg * 0.7;
            b.vx = avg * 0.7;
          } else {
            let sign = (a.y + a.h/2 < b.y + b.h/2) ? -1 : 1;
            let totalD = a.density + b.density;
            let ratioA = b.density / totalD;
            let ratioB = a.density / totalD;
            a.y += sign * overlapY * ratioA;
            b.y -= sign * overlapY * ratioB;
            // Bounce/rest
            let temp = a.vy;
            a.vy = b.vy * 0.2;
            b.vy = temp * 0.2;
          }
        }
      }
    }
    
    // Projectile vs Block
    sProjectiles.forEach(p => {
      if (p.state !== 'flying') return;
      sBlocks.forEach(b => {
        let closestX = Math.max(b.x, Math.min(p.x, b.x + b.w));
        let closestY = Math.max(b.y, Math.min(p.y, b.y + b.h));
        let dx = p.x - closestX;
        let dy = p.y - closestY;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < p.r) {
          let overlap = p.r - dist;
          let nx = dx / (dist || 1);
          let ny = dy / (dist || 1);
          if (dist === 0) { nx = 0; ny = -1; overlap = p.r; }
          
          p.x += nx * overlap;
          p.y += ny * overlap;
          
          let speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
          let impactForce = speed * p.mass;
          
          b.hp -= impactForce * 4.5 + 4;
          
          b.vx += nx * speed * 0.5 * (p.mass / b.density);
          b.vy += ny * speed * 0.5 * (p.mass / b.density);
          
          let dot = p.vx * nx + p.vy * ny;
          p.vx = (p.vx - 2 * dot * nx) * 0.35;
          p.vy = (p.vy - 2 * dot * ny) * 0.35;
          
          sScreenShake = Math.max(sScreenShake, impactForce * 1.5);
          spawnSlingshotParticles(closestX, closestY, b.color, 8);
          sfx.play('hit');
        }
      });
    });
    
    // Target vs Block
    sTargets.forEach(t => {
      if (t.hp <= 0) return;
      sBlocks.forEach(b => {
        let closestX = Math.max(b.x, Math.min(t.x, b.x + b.w));
        let closestY = Math.max(b.y, Math.min(t.y, b.y + b.h));
        let dx = t.x - closestX;
        let dy = t.y - closestY;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < t.r) {
          let overlap = t.r - dist;
          let nx = dx / (dist || 1);
          let ny = dy / (dist || 1);
          if (dist === 0) { nx = 0; ny = -1; overlap = t.r; }
          
          t.x += nx * overlap;
          t.y += ny * overlap;
          
          let relVX = t.vx - b.vx;
          let relVY = t.vy - b.vy;
          let speed = Math.sqrt(relVX*relVX + relVY*relVY);
          if (speed > 1.2) {
            t.hp -= speed * 4.0;
            sfx.play('hit');
            spawnSlingshotParticles(t.x, t.y, '#e74c3c', 8);
          }
          
          let dot = t.vx * nx + t.vy * ny;
          t.vx = (t.vx - 2 * dot * nx) * 0.2;
          t.vy = (t.vy - 2 * dot * ny) * 0.2;
        }
      });
    });
    
    // Target vs Target
    for (let i = 0; i < sTargets.length; i++) {
      for (let j = i + 1; j < sTargets.length; j++) {
        let a = sTargets[i];
        let b = sTargets[j];
        if (a.hp <= 0 || b.hp <= 0) return;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        let sumR = a.r + b.r;
        if (dist < sumR) {
          let overlap = sumR - dist;
          let nx = dx / (dist || 1);
          let ny = dy / (dist || 1);
          
          a.x -= nx * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.y += ny * overlap * 0.5;
          
          let tempX = a.vx; let tempY = a.vy;
          a.vx = b.vx * 0.4; a.vy = b.vy * 0.4;
          b.vx = tempX * 0.4; b.vy = tempY * 0.4;
        }
      }
    }
    
    // Projectile vs Target
    sProjectiles.forEach(p => {
      if (p.state !== 'flying') return;
      sTargets.forEach(t => {
        if (t.hp <= 0) return;
        let dx = t.x - p.x;
        let dy = t.y - p.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        let sumR = p.r + t.r;
        if (dist < sumR) {
          let overlap = sumR - dist;
          let nx = dx / (dist || 1);
          let ny = dy / (dist || 1);
          
          p.x -= nx * overlap * 0.5;
          t.x += nx * overlap * 0.5;
          p.y -= ny * overlap * 0.5;
          t.y += ny * overlap * 0.5;
          
          let speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
          t.hp -= speed * p.mass * 5 + 6;
          sScreenShake = Math.max(sScreenShake, speed * 2);
          
          let dot = p.vx * nx + p.vy * ny;
          p.vx = (p.vx - 2 * dot * nx) * 0.4;
          p.vy = (p.vy - 2 * dot * ny) * 0.4;
          
          spawnSlingshotParticles(t.x, t.y, '#e74c3c', 10);
          sfx.play('hit');
        }
      });
    });
  }
  
  // 3. Remove dead blocks and targets, award scores & particles
  for (let i = sBlocks.length - 1; i >= 0; i--) {
    if (sBlocks[i].hp <= 0) {
      const b = sBlocks[i];
      spawnSlingshotParticles(b.x + b.w/2, b.y + b.h/2, b.color, 14);
      sScore += b.scoreVal;
      sBlocks.splice(i, 1);
      sfx.play('explosion');
      sScreenShake = Math.max(sScreenShake, 6);
    }
  }
  
  for (let i = sTargets.length - 1; i >= 0; i--) {
    if (sTargets[i].hp <= 0) {
      const t = sTargets[i];
      spawnSlingshotParticles(t.x, t.y, '#FF6B00', 25);
      spawnSlingshotParticles(t.x, t.y, '#FFD700', 10);
      sScore += 1000;
      sTargets.splice(i, 1);
      sfx.play('pop');
      sScreenShake = 12;
    }
  }
  
  document.getElementById('slingshot-score').textContent = sScore;
  
  // 4. Update particles
  sParticles.forEach((p, idx) => {
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      sParticles.splice(idx, 1);
    }
  });
  
  // 5. State transitions (Win / Loss checking)
  if (sTargets.length === 0 && sGameState !== 'win') {
    sGameState = 'win';
    saveSlingshotScore(currentLevelIdx, sScore);
    setTimeout(() => {
      document.getElementById('slingshot-victory-score').textContent = sScore;
      document.getElementById('slingshot-victory').classList.remove('hidden');
      renderSlingshotLevels();
    }, 1200);
    return;
  }
  
  if (sGameState === 'flying') {
    let allSettled = sProjectiles.every(p => p.state === 'settled');
    if (allSettled) {
      if (shotsRemaining > 0) {
        sGameState = 'ready';
        prepareNextProjectile();
      } else {
        sGameState = 'settling_down';
        setTimeout(() => {
          if (sTargets.length > 0 && sGameState === 'settling_down') {
            sGameState = 'fail';
            document.getElementById('slingshot-gameover').classList.remove('hidden');
          }
        }, 1500);
      }
    }
  }
}

function drawSlingshot() {
  sCtx.clearRect(0, 0, sW, sH);
  
  sCtx.save();
  
  // Camera shake
  if (sScreenShake > 0.1) {
    const dx = (Math.random() - 0.5) * sScreenShake;
    const dy = (Math.random() - 0.5) * sScreenShake;
    sCtx.translate(dx, dy);
    sScreenShake *= 0.9;
  }
  
  // 1. Draw slingshot fork structure (underneath projectile)
  sCtx.strokeStyle = '#5e3e24';
  sCtx.lineWidth = 8;
  sCtx.lineCap = 'round';
  
  sCtx.beginPath();
  sCtx.moveTo(slingshotPos.x, slingshotPos.y + 70);
  sCtx.lineTo(slingshotPos.x, slingshotPos.y);
  sCtx.stroke();
  
  sCtx.beginPath();
  sCtx.moveTo(slingshotPos.x, slingshotPos.y);
  sCtx.quadraticCurveTo(slingshotPos.x - 20, slingshotPos.y - 20, slingshotPos.x - 25, slingshotPos.y - 45);
  sCtx.stroke();
  
  sCtx.beginPath();
  sCtx.moveTo(slingshotPos.x, slingshotPos.y);
  sCtx.quadraticCurveTo(slingshotPos.x + 20, slingshotPos.y - 20, slingshotPos.x + 25, slingshotPos.y - 45);
  sCtx.stroke();
  
  // 2. Draw ground
  const grad = sCtx.createLinearGradient(0, groundY, 0, sH);
  grad.addColorStop(0, '#1E272C');
  grad.addColorStop(1, '#0C0F12');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, groundY, sW, sH - groundY);
  
  sCtx.strokeStyle = '#2A363D';
  sCtx.lineWidth = 3;
  sCtx.beginPath();
  sCtx.moveTo(0, groundY);
  sCtx.lineTo(sW, groundY);
  sCtx.stroke();
  
  sCtx.fillStyle = '#2ecc71';
  sCtx.globalAlpha = 0.45;
  for (let i = 0; i < sW; i += 20) {
    sCtx.beginPath();
    sCtx.moveTo(i, groundY);
    sCtx.lineTo(i + 5, groundY - 8);
    sCtx.lineTo(i + 10, groundY);
    sCtx.fill();
  }
  sCtx.globalAlpha = 1.0;
  
  // 3. Draw slingshot rubber bands (back band)
  if (sGameState === 'dragging' && isDragging) {
    sCtx.strokeStyle = '#ff7675';
    sCtx.lineWidth = 4;
    sCtx.beginPath();
    sCtx.moveTo(slingshotPos.x - 25, slingshotPos.y - 40);
    sCtx.lineTo(dragCurrent.x, dragCurrent.y);
    sCtx.stroke();
  }
  
  // 4. Draw blocks
  sBlocks.forEach(b => {
    sCtx.save();
    
    sCtx.fillStyle = b.color;
    sCtx.strokeStyle = b.border;
    sCtx.lineWidth = 2.5;
    
    sCtx.beginPath();
    sCtx.roundRect(b.x, b.y, b.w, b.h, 4);
    sCtx.fill();
    sCtx.stroke();
    
    if (b.type === 'wood') {
      sCtx.strokeStyle = 'rgba(0,0,0,0.12)';
      sCtx.lineWidth = 2;
      sCtx.beginPath();
      sCtx.moveTo(b.x + 4, b.y + b.h * 0.35);
      sCtx.lineTo(b.x + b.w - 4, b.y + b.h * 0.35);
      sCtx.moveTo(b.x + 4, b.y + b.h * 0.7);
      sCtx.lineTo(b.x + b.w - 4, b.y + b.h * 0.7);
      sCtx.stroke();
    } else if (b.type === 'glass') {
      sCtx.strokeStyle = 'rgba(255,255,255,0.4)';
      sCtx.lineWidth = 1.5;
      sCtx.beginPath();
      sCtx.moveTo(b.x + 3, b.y + 3);
      sCtx.lineTo(b.x + b.w - 3, b.y + b.h - 3);
      sCtx.stroke();
    } else if (b.type === 'stone') {
      sCtx.strokeStyle = 'rgba(0,0,0,0.2)';
      sCtx.lineWidth = 2;
      sCtx.beginPath();
      sCtx.moveTo(b.x + b.w/2, b.y);
      sCtx.lineTo(b.x + b.w/3, b.y + b.h/2);
      sCtx.lineTo(b.x + b.w * 0.7, b.y + b.h);
      sCtx.stroke();
    }
    
    if (b.hp < b.maxHp) {
      let pct = b.hp / b.maxHp;
      sCtx.fillStyle = 'rgba(0,0,0,0.4)';
      sCtx.fillRect(b.x + 2, b.y + 2, b.w - 4, 3);
      sCtx.fillStyle = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
      sCtx.fillRect(b.x + 2, b.y + 2, (b.w - 4) * pct, 3);
    }
    
    sCtx.restore();
  });
  
  // 5. Draw targets (grumpy corrupt politician faces!)
  sTargets.forEach(t => {
    sCtx.save();
    
    sCtx.fillStyle = t.color;
    sCtx.strokeStyle = t.border;
    sCtx.lineWidth = 3;
    
    sCtx.beginPath();
    sCtx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.stroke();
    
    sCtx.strokeStyle = '#000';
    sCtx.lineWidth = 2;
    sCtx.lineCap = 'round';
    sCtx.beginPath();
    sCtx.arc(t.x, t.y + 7, 5, Math.PI + 0.3, Math.PI*2 - 0.3);
    sCtx.stroke();
    
    sCtx.strokeStyle = '#fff';
    sCtx.lineWidth = 4;
    sCtx.beginPath();
    sCtx.moveTo(t.x - t.r * 0.7, t.y + t.r * 0.2);
    sCtx.lineTo(t.x + t.r * 0.7, t.y - t.r * 0.4);
    sCtx.stroke();
    
    sCtx.fillStyle = '#111';
    sCtx.beginPath();
    sCtx.roundRect(t.x - 12, t.y - 7, 10, 6, 1.5);
    sCtx.roundRect(t.x + 2, t.y - 7, 10, 6, 1.5);
    sCtx.fill();
    
    sCtx.beginPath();
    sCtx.moveTo(t.x - 2, t.y - 4);
    sCtx.lineTo(t.x + 2, t.y - 4);
    sCtx.stroke();
    
    sCtx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    sCtx.font = 'bold 8px Outfit';
    sCtx.textAlign = 'center';
    sCtx.fillText('$', t.x, t.y - 1);
    
    sCtx.restore();
  });
  
  // 6. Draw active projectiles
  sProjectiles.forEach(p => {
    sCtx.save();
    
    sCtx.shadowBlur = 10;
    sCtx.shadowColor = p.color;
    
    sCtx.fillStyle = p.color;
    sCtx.strokeStyle = 'rgba(255,255,255,0.4)';
    sCtx.lineWidth = 2;
    
    sCtx.beginPath();
    sCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.stroke();
    
    sCtx.fillStyle = '#000';
    sCtx.font = `bold ${Math.floor(p.r * 0.9)}px Outfit`;
    sCtx.textAlign = 'center';
    sCtx.textBaseline = 'middle';
    
    let label = '🗳️';
    if (p.type === 'Megaphone') label = '📣';
    else if (p.type === 'Triple') label = '🗳️';
    else if (p.type === 'Heavy') label = '📦';
    
    sCtx.fillText(label, p.x, p.y);
    
    sCtx.restore();
  });
  
  // 7. Draw projectile currently loaded in slingshot (ready/dragging)
  if (sGameState === 'ready' && currentProjectile) {
    sCtx.save();
    sCtx.fillStyle = currentProjectile.color;
    sCtx.beginPath();
    sCtx.arc(slingshotPos.x, slingshotPos.y - 5, currentProjectile.r, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.restore();
  } 
  else if (sGameState === 'dragging' && isDragging && currentProjectile) {
    sCtx.save();
    sCtx.fillStyle = currentProjectile.color;
    sCtx.beginPath();
    sCtx.arc(dragCurrent.x, dragCurrent.y, currentProjectile.r, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.restore();
  }
  
  // 8. Draw front rubber band (in front of projectile)
  if (sGameState === 'dragging' && isDragging) {
    sCtx.strokeStyle = '#ff7675';
    sCtx.lineWidth = 4;
    sCtx.beginPath();
    sCtx.moveTo(slingshotPos.x + 25, slingshotPos.y - 40);
    sCtx.lineTo(dragCurrent.x, dragCurrent.y);
    sCtx.stroke();
  }
  
  // 9. Draw trajectory path dots (if dragging)
  if (sGameState === 'dragging' && isDragging && currentProjectile) {
    sCtx.save();
    sCtx.fillStyle = 'rgba(255, 215, 0, 0.45)';
    
    const dx = slingshotPos.x - dragCurrent.x;
    const dy = slingshotPos.y - dragCurrent.y;
    let px = dragCurrent.x;
    let py = dragCurrent.y;
    let vx = dx * launchForceMultiplier;
    let vy = dy * launchForceMultiplier;
    
    for (let i = 0; i < 45; i++) {
      px += vx;
      py += vy;
      vy += gravity;
      
      vx *= 0.995;
      vy *= 0.995;
      
      if (py > groundY) break;
      if (i % 2 === 0) {
        sCtx.beginPath();
        sCtx.arc(px, py, Math.max(1, 3.5 - (i * 0.04)), 0, Math.PI*2);
        sCtx.fill();
      }
    }
    sCtx.restore();
  }
  
  // 10. Draw particles
  sParticles.forEach(p => {
    sCtx.save();
    sCtx.globalAlpha = p.alpha;
    sCtx.fillStyle = p.color;
    sCtx.beginPath();
    sCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.restore();
  });
  
  sCtx.restore();
}

function checkAABBOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function resizeSlingshot() {
  if (!sCanvas) return;
  sW = sCanvas.width = window.innerWidth;
  sH = sCanvas.height = window.innerHeight;
  
  slingshotPos.x = 180;
  slingshotPos.y = sH - 180;
  groundY = sH - 80;
  
  if (slingshotActive) {
    buildLevel(currentLevelIdx);
    prepareNextProjectile();
  }
}

function startSlingshotLevel(idx) {
  currentLevelIdx = idx;
  sScore = 0;
  
  document.getElementById('slingshot-score').textContent = sScore;
  document.getElementById('slingshot-level-name').textContent = levelNames[idx];
  
  if (idx === 0) shotsRemaining = 3;
  else if (idx === 1) shotsRemaining = 3;
  else if (idx === 2) shotsRemaining = 4;
  
  document.getElementById('slingshot-shots').textContent = shotsRemaining;
  
  document.getElementById('slingshot-level-select').classList.add('hidden');
  document.getElementById('slingshot-gameover').classList.add('hidden');
  document.getElementById('slingshot-victory').classList.add('hidden');
  
  buildLevel(currentLevelIdx);
  prepareNextProjectile();
}

function exitSlingshot() {
  slingshotActive = false;
  if (slingshotAnimId) {
    cancelAnimationFrame(slingshotAnimId);
    slingshotAnimId = null;
  }
  document.getElementById('slingshot-level-select').classList.add('hidden');
  document.getElementById('slingshot-gameover').classList.add('hidden');
  document.getElementById('slingshot-victory').classList.add('hidden');
}

function slingshotTick(timestamp) {
  if (!slingshotActive) return;
  if (!slingshotLastTime) slingshotLastTime = timestamp;
  let dt = (timestamp - slingshotLastTime) / 1000;
  slingshotLastTime = timestamp;
  
  if (dt > 0.1) dt = 0.1;
  
  updateSlingshot(dt);
  drawSlingshot();
  
  slingshotAnimId = requestAnimationFrame(slingshotTick);
}


// ==============================================================================
// ─── BALLOT BREAKER (BRICK BREAKER) GAME MODULE ───────────────────────────────
// ==============================================================================
let brickActive = false;
let brickLastTime = 0;
let brickAnimId = null;

let bCanvas, bCtx, bW, bH;
let bGameState = 'ready'; // ready | playing | over | win

let bScore = 0;
let bLives = 3;
let bLevel = 1;

let bPaddle = { x: 0, y: 0, w: 120, h: 15, baseW: 120, speed: 12 };
let bBalls = []; // list of active balls
let bBricks = [];
let bPowerups = [];
let bParticles = [];
let bLasers = [];
let bScreenShake = 0;

let pKeys = { Left: false, Right: false, Space: false };

// Timers for active powerups
let powerupTimers = {
  wide: 0,
  laser: 0
};

function initBrickGame() {
  bCanvas = document.getElementById('brickCanvas');
  bCtx = bCanvas.getContext('2d');
  
  resizeBrickGame();
  window.addEventListener('resize', resizeBrickGame);
  
  // Connect input listeners
  bCanvas.onpointermove = (e) => {
    const rect = bCanvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    bPaddle.x = px - bPaddle.w / 2;
    // Keep paddle on-screen
    if (bPaddle.x < 0) bPaddle.x = 0;
    if (bPaddle.x + bPaddle.w > bW) bPaddle.x = bW - bPaddle.w;
  };
  
  bCanvas.onpointerdown = (e) => {
    sfx.init();
    if (bGameState === 'ready') {
      bGameState = 'playing';
      bBalls.forEach(b => {
        if (b.stuck) {
          b.stuck = false;
          b.vx = (Math.random() - 0.5) * 4;
          b.vy = -6;
        }
      });
    } else if (bGameState === 'playing' && powerupTimers.laser > 0) {
      shootLasers();
    }
  };
  
  window.onkeydown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') pKeys.Left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') pKeys.Right = true;
    if (e.key === ' ' || e.key === 'Spacebar') {
      pKeys.Space = true;
      if (bGameState === 'ready') {
        bGameState = 'playing';
        bBalls.forEach(b => {
          if (b.stuck) {
            b.stuck = false;
            b.vx = (Math.random() - 0.5) * 4;
            b.vy = -6;
          }
        });
      } else if (bGameState === 'playing' && powerupTimers.laser > 0) {
        shootLasers();
      }
    }
  };
  window.onkeyup = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') pKeys.Left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') pKeys.Right = false;
    if (e.key === ' ' || e.key === 'Spacebar') pKeys.Space = false;
  };
  
  startBrickGame();
  
  brickActive = true;
  brickLastTime = 0;
  brickAnimId = requestAnimationFrame(brickTick);
}

function exitBrickGame() {
  brickActive = false;
  if (brickAnimId) {
    cancelAnimationFrame(brickAnimId);
    brickAnimId = null;
  }
  window.onkeydown = null;
  window.onkeyup = null;
  document.getElementById('brick-gameover').classList.add('hidden');
  document.getElementById('brick-victory').classList.add('hidden');
}

function startBrickGame() {
  bScore = 0;
  bLives = 3;
  bLevel = 1;
  
  powerupTimers.wide = 0;
  powerupTimers.laser = 0;
  bPaddle.w = bPaddle.baseW;
  
  document.getElementById('brick-score').textContent = bScore;
  document.getElementById('brick-lives').textContent = bLives;
  document.getElementById('brick-power-type').textContent = 'None';
  
  document.getElementById('brick-gameover').classList.add('hidden');
  document.getElementById('brick-victory').classList.add('hidden');
  
  bPowerups = [];
  bParticles = [];
  bLasers = [];
  bScreenShake = 0;
  
  buildBrickLevel();
  resetBall();
}

function resetBall() {
  bPaddle.x = bW / 2 - bPaddle.w / 2;
  bPaddle.y = bH - 110;
  
  bBalls = [{
    x: bW / 2,
    y: bPaddle.y - 12,
    vx: 0,
    vy: 0,
    r: 9,
    stuck: true,
    speed: 6.5
  }];
  
  bGameState = 'ready';
}

function buildBrickLevel() {
  bBricks = [];
  
  const cols = 9;
  const rows = 5;
  const brickH = 22;
  const padding = 6;
  const topOffset = 110;
  
  const totalPadding = (cols + 1) * padding;
  const brickW = (bW - totalPadding) / cols;
  
  const colors = {
    normal: '#ff4d4d',
    double: '#ff9f43',
    armored: '#95a5a6',
    golden: '#f1c40f'
  };
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let type = 'normal';
      let hp = 1;
      
      if (r === 0) {
        type = 'armored'; hp = 3;
      } else if (r === 1) {
        type = 'double'; hp = 2;
      } else if (r === 2) {
        type = 'golden'; hp = 1;
      } else {
        type = 'normal'; hp = 1;
      }
      
      const bx = padding + c * (brickW + padding);
      const by = topOffset + r * (brickH + padding);
      
      bBricks.push({
        x: bx,
        y: by,
        w: brickW,
        h: brickH,
        type: type,
        hp: hp,
        maxHp: hp,
        color: colors[type],
        points: hp * 150
      });
    }
  }
}

function shootLasers() {
  sfx.play('laser');
  bLasers.push({ x: bPaddle.x + 10, y: bPaddle.y, w: 4, h: 12, vy: -9 });
  bLasers.push({ x: bPaddle.x + bPaddle.w - 14, y: bPaddle.y, w: 4, h: 12, vy: -9 });
}

function catchPowerup(type) {
  sfx.play('powerup');
  
  if (type === 'wide') {
    powerupTimers.wide = 10;
    bPaddle.w = bPaddle.baseW * 1.5;
    document.getElementById('brick-power-type').textContent = 'Wide Paddle 📏';
    spawnBrickParticles(bPaddle.x + bPaddle.w/2, bPaddle.y, '#f1c40f', 12);
  } 
  else if (type === 'laser') {
    powerupTimers.laser = 8;
    document.getElementById('brick-power-type').textContent = 'Laser Blaster ⚡';
    spawnBrickParticles(bPaddle.x + bPaddle.w/2, bPaddle.y, '#ff4d4d', 12);
  } 
  else if (type === 'multi') {
    const baseBall = bBalls[0] || { x: bW/2, y: bH/2, vx: 0, vy: -5 };
    bBalls.push({
      x: baseBall.x,
      y: baseBall.y,
      vx: baseBall.vx + 2.5,
      vy: baseBall.vy * 0.9,
      r: 9,
      stuck: false,
      speed: 6.5
    });
    bBalls.push({
      x: baseBall.x,
      y: baseBall.y,
      vx: baseBall.vx - 2.5,
      vy: baseBall.vy * 0.9,
      r: 9,
      stuck: false,
      speed: 6.5
    });
    spawnBrickParticles(baseBall.x, baseBall.y, '#55efc4', 15);
  } 
  else if (type === 'life') {
    bLives++;
    document.getElementById('brick-lives').textContent = bLives;
    spawnBrickParticles(bPaddle.x + bPaddle.w/2, bPaddle.y, '#ff4757', 15);
  }
}

function spawnBrickParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 1.2;
    bParticles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3.5 + 1.5,
      color: color,
      alpha: 1.0,
      decay: Math.random() * 0.05 + 0.02
    });
  }
}

function updateBrickGame(dt) {
  if (powerupTimers.wide > 0) {
    powerupTimers.wide -= dt;
    if (powerupTimers.wide <= 0) {
      bPaddle.w = bPaddle.baseW;
      document.getElementById('brick-power-type').textContent = 'None';
    }
  }
  if (powerupTimers.laser > 0) {
    powerupTimers.laser -= dt;
    if (powerupTimers.laser <= 0) {
      document.getElementById('brick-power-type').textContent = 'None';
    }
  }
  
  if (pKeys.Left) {
    bPaddle.x -= bPaddle.speed;
    if (bPaddle.x < 0) bPaddle.x = 0;
  }
  if (pKeys.Right) {
    bPaddle.x += bPaddle.speed;
    if (bPaddle.x + bPaddle.w > bW) bPaddle.x = bW - bPaddle.w;
  }
  
  for (let i = bLasers.length - 1; i >= 0; i--) {
    let laser = bLasers[i];
    laser.y += laser.vy;
    
    let hitBrick = false;
    for (let j = bBricks.length - 1; j >= 0; j--) {
      let b = bBricks[j];
      if (laser.x > b.x && laser.x < b.x + b.w && laser.y > b.y && laser.y < b.y + b.h) {
        b.hp--;
        bScore += 50;
        spawnBrickParticles(laser.x, laser.y, b.color, 6);
        sfx.play('hit');
        hitBrick = true;
        
        if (b.hp <= 0) {
          bScore += b.points;
          spawnBrickParticles(b.x + b.w/2, b.y + b.h/2, b.color, 14);
          if (b.type === 'golden') {
            triggerPowerupDrop(b.x + b.w/2, b.y + b.h);
          }
          bBricks.splice(j, 1);
        }
        break;
      }
    }
    
    if (hitBrick || laser.y < 80) {
      bLasers.splice(i, 1);
    }
  }
  
  for (let i = bPowerups.length - 1; i >= 0; i--) {
    let p = bPowerups[i];
    p.y += p.vy;
    
    if (p.x > bPaddle.x && p.x < bPaddle.x + bPaddle.w && p.y + p.size > bPaddle.y && p.y < bPaddle.y + bPaddle.h) {
      catchPowerup(p.type);
      bPowerups.splice(i, 1);
      continue;
    }
    
    if (p.y > bH) {
      bPowerups.splice(i, 1);
    }
  }
  
  for (let i = bBalls.length - 1; i >= 0; i--) {
    let ball = bBalls[i];
    
    if (ball.stuck) {
      ball.x = bPaddle.x + bPaddle.w / 2;
      ball.y = bPaddle.y - ball.r - 2;
      continue;
    }
    
    ball.x += ball.vx;
    ball.y += ball.vy;
    
    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx = -ball.vx;
      sfx.play('bounce');
    }
    if (ball.x + ball.r > bW) {
      ball.x = bW - ball.r;
      ball.vx = -ball.vx;
      sfx.play('bounce');
    }
    
    if (ball.y - ball.r < 80) {
      ball.y = 80 + ball.r;
      ball.vy = -ball.vy;
      sfx.play('bounce');
    }
    
    if (ball.y + ball.r > bPaddle.y && ball.y - ball.r < bPaddle.y + bPaddle.h && ball.x + ball.r > bPaddle.x && ball.x - ball.r < bPaddle.x + bPaddle.w) {
      if (ball.vy > 0) {
        ball.y = bPaddle.y - ball.r;
        ball.vy = -ball.vy;
        sfx.play('bounce');
        
        let hitPos = (ball.x - (bPaddle.x + bPaddle.w / 2)) / (bPaddle.w / 2);
        ball.vx = hitPos * 5.5;
        
        let curSpeed = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy);
        ball.vx = (ball.vx / curSpeed) * ball.speed;
        ball.vy = (ball.vy / curSpeed) * ball.speed;
      }
    }
    
    for (let j = bBricks.length - 1; j >= 0; j--) {
      let b = bBricks[j];
      
      let closestX = Math.max(b.x, Math.min(ball.x, b.x + b.w));
      let closestY = Math.max(b.y, Math.min(ball.y, b.y + b.h));
      let dx = ball.x - closestX;
      let dy = ball.y - closestY;
      let dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist < ball.r) {
        b.hp--;
        bScore += 100;
        spawnBrickParticles(closestX, closestY, b.color, 6);
        sfx.play('hit');
        
        let nx = dx / (dist || 1);
        let ny = dy / (dist || 1);
        
        if (dist === 0) {
          nx = 0;
          ny = -1;
          dist = 0.001;
        }
        
        // Resolve overlap/penetration (push ball out of brick)
        let overlap = ball.r - dist;
        ball.x += nx * overlap;
        ball.y += ny * overlap;
        
        // Reverse velocity based on collision normal
        if (Math.abs(nx) > Math.abs(ny)) {
          ball.vx = -ball.vx;
        } else {
          ball.vy = -ball.vy;
        }
        
        if (b.hp <= 0) {
          bScore += b.points;
          spawnBrickParticles(b.x + b.w/2, b.y + b.h/2, b.color, 14);
          sfx.play('explosion');
          bScreenShake = 8;
          
          if (b.type === 'golden') {
            triggerPowerupDrop(b.x + b.w/2, b.y + b.h);
          }
          bBricks.splice(j, 1);
        }
        break;
      }
    }
    
    if (ball.y - ball.r > bH) {
      bBalls.splice(i, 1);
    }
  }
  
  if (bBalls.length === 0 && bGameState !== 'over') {
    bLives--;
    document.getElementById('brick-lives').textContent = bLives;
    
    if (bLives <= 0) {
      bGameState = 'over';
      document.getElementById('brick-gameover').classList.remove('hidden');
    } else {
      resetBall();
    }
  }
  
  if (bBricks.length === 0 && bGameState !== 'win') {
    bGameState = 'win';
    sfx.play('level');
    setTimeout(() => {
      document.getElementById('brick-victory-score').textContent = bScore;
      document.getElementById('brick-victory').classList.remove('hidden');
    }, 1000);
  }
  
  bParticles.forEach((p, idx) => {
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      bParticles.splice(idx, 1);
    }
  });
  
  document.getElementById('brick-score').textContent = bScore;
}

function triggerPowerupDrop(x, y) {
  const types = ['wide', 'laser', 'multi', 'life'];
  const type = types[Math.floor(Math.random() * types.length)];
  const colors = { wide: '#f1c40f', laser: '#ff4d4d', multi: '#55efc4', life: '#ff4757' };
  
  bPowerups.push({
    x: x,
    y: y,
    vy: 2.2,
    size: 14,
    type: type,
    color: colors[type]
  });
}

function drawBrickGame() {
  bCtx.clearRect(0, 0, bW, bH);
  
  bCtx.save();
  
  if (bScreenShake > 0.1) {
    const dx = (Math.random() - 0.5) * bScreenShake;
    const dy = (Math.random() - 0.5) * bScreenShake;
    bCtx.translate(dx, dy);
    bScreenShake *= 0.9;
  }
  
  bBricks.forEach(b => {
    bCtx.save();
    
    bCtx.fillStyle = b.color;
    bCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    bCtx.lineWidth = 1;
    
    bCtx.shadowBlur = 8;
    bCtx.shadowColor = b.color;
    
    bCtx.beginPath();
    bCtx.roundRect(b.x, b.y, b.w, b.h, 4);
    bCtx.fill();
    bCtx.stroke();
    
    bCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    bCtx.beginPath();
    bCtx.moveTo(b.x + 4, b.y + 3);
    bCtx.lineTo(b.x + b.w - 4, b.y + 3);
    bCtx.stroke();
    
    if (b.hp < b.maxHp) {
      let pct = b.hp / b.maxHp;
      bCtx.fillStyle = 'rgba(0,0,0,0.5)';
      bCtx.fillRect(b.x + b.w/4, b.y + b.h - 6, b.w/2, 3);
      bCtx.fillStyle = '#ff4757';
      bCtx.fillRect(b.x + b.w/4, b.y + b.h - 6, (b.w/2) * pct, 3);
    }
    
    bCtx.restore();
  });
  
  bLasers.forEach(l => {
    bCtx.save();
    bCtx.fillStyle = '#ff4d4d';
    bCtx.shadowBlur = 8;
    bCtx.shadowColor = '#ff4d4d';
    bCtx.fillRect(l.x, l.y, l.w, l.h);
    bCtx.restore();
  });
  
  bPowerups.forEach(p => {
    bCtx.save();
    
    bCtx.fillStyle = p.color;
    bCtx.strokeStyle = '#fff';
    bCtx.lineWidth = 1.5;
    bCtx.shadowBlur = 10;
    bCtx.shadowColor = p.color;
    
    bCtx.beginPath();
    bCtx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.stroke();
    
    bCtx.fillStyle = '#000';
    bCtx.font = 'bold 8px Outfit';
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    let icon = '🎁';
    if (p.type === 'wide') icon = '📏';
    else if (p.type === 'laser') icon = '⚡';
    else if (p.type === 'multi') icon = '🥎';
    else if (p.type === 'life') icon = '❤️';
    bCtx.fillText(icon, p.x, p.y);
    
    bCtx.restore();
  });
  
  bCtx.save();
  let grad = bCtx.createLinearGradient(bPaddle.x, bPaddle.y, bPaddle.x, bPaddle.y + bPaddle.h);
  if (powerupTimers.laser > 0) {
    grad.addColorStop(0, '#ff7675'); grad.addColorStop(1, '#ff4d4d');
    bCtx.shadowColor = '#ff4d4d';
  } else if (powerupTimers.wide > 0) {
    grad.addColorStop(0, '#ffeaa7'); grad.addColorStop(1, '#f1c40f');
    bCtx.shadowColor = '#f1c40f';
  } else {
    grad.addColorStop(0, '#55efc4'); grad.addColorStop(1, '#00b894');
    bCtx.shadowColor = '#00b894';
  }
  
  bCtx.fillStyle = grad;
  bCtx.strokeStyle = '#fff';
  bCtx.lineWidth = 2;
  bCtx.shadowBlur = 12;
  
  bCtx.beginPath();
  bCtx.roundRect(bPaddle.x, bPaddle.y, bPaddle.w, bPaddle.h, 6);
  bCtx.fill();
  bCtx.stroke();
  
  if (powerupTimers.laser > 0) {
    bCtx.fillStyle = '#2d3436';
    bCtx.fillRect(bPaddle.x + 6, bPaddle.y - 6, 8, 6);
    bCtx.fillRect(bPaddle.x + bPaddle.w - 14, bPaddle.y - 6, 8, 6);
  }
  bCtx.restore();
  
  bBalls.forEach(b => {
    bCtx.save();
    
    bCtx.fillStyle = '#fff';
    bCtx.strokeStyle = '#1dd1a1';
    bCtx.lineWidth = 2.5;
    bCtx.shadowBlur = 8;
    bCtx.shadowColor = '#1dd1a1';
    
    bCtx.beginPath();
    bCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.stroke();
    
    bCtx.restore();
  });
  
  bParticles.forEach(p => {
    bCtx.save();
    bCtx.globalAlpha = p.alpha;
    bCtx.fillStyle = p.color;
    bCtx.beginPath();
    bCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.restore();
  });
  
  bCtx.strokeStyle = '#1a3d54';
  bCtx.lineWidth = 4;
  bCtx.beginPath();
  bCtx.moveTo(0, 80);
  bCtx.lineTo(bW, 80);
  bCtx.stroke();
  
  bCtx.restore();
}

function resizeBrickGame() {
  if (!bCanvas) return;
  bW = bCanvas.width = window.innerWidth;
  bH = bCanvas.height = window.innerHeight;
  bPaddle.y = bH - 110;
  
  if (brickActive && bBricks.length === 0) {
    buildBrickLevel();
    resetBall();
  }
}

function brickTick(timestamp) {
  if (!brickActive) return;
  if (!brickLastTime) brickLastTime = timestamp;
  let dt = (timestamp - brickLastTime) / 1000;
  brickLastTime = timestamp;
  
  if (dt > 0.1) dt = 0.1;
  
  updateBrickGame(dt);
  drawBrickGame();
  
  brickAnimId = requestAnimationFrame(brickTick);
}


// ==============================================================================
// ─── PLATFORM CAMPAIGN GAME MODULE ────────────────────────────────────────────
// ==============================================================================

const P_BLOCK_SIZE = 40;
let pActive = false;
let pCanvas, pCtx;
let pW = 800, pH = 600;
let pLastTime = 0;
let pAnimId = null;
let pCurrentLevelIdx = 0;
let pScore = 0;
let pLives = 3;
let pGameState = 'select'; // 'select', 'playing', 'victory', 'gameover'

let pPlayer = {
  x: 80,
  y: 100,
  vx: 0,
  vy: 0,
  w: 30,
  h: 44,
  grounded: false,
  hurtCooldown: 0,
  facing: 'right',
  animFrame: 0,
  capeAngle: 0
};

let platKeys = { Left: false, Right: false, Jump: false };
let pCamX = 0;
let pBlocks = [];
let pEnemies = [];
let pCollectibles = [];
let pParticles = [];
let pPodium = { x: 0, y: 0, w: 40, h: 120 };

const pLevelTitles = [
  "LEVEL 1: GRASSROOTS TRAIL",
  "LEVEL 2: STATE PRIMARIES",
  "LEVEL 3: CAPITAL HILL CLIMB"
];

const pLevels = [
  // LEVEL 1: GRASSROOTS TRAIL
  [
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                  ?  ?                                          ",
    "                                 ######                                         ",
    "                     ###                                  ###                   ",
    "                                                                                ",
    "              ###                                                            P  ",
    "                                 E          E                               ####",
    "###################   #######################################   ################"
  ],
  // LEVEL 2: STATE PRIMARIES
  [
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                 ?  ?                                           ",
    "                                ######                                          ",
    "                                                                                ",
    "                             ###      ###                                       ",
    "                                                                                ",
    "                   ###                         ###                              ",
    "                                                                                ",
    "             ###                                     ###                     P  ",
    "                                E                                           ####",
    "##################     ##########    ##########     ############################"
  ],
  // LEVEL 3: CAPITAL HILL CLIMB
  [
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "                                   ?  ?                                         ",
    "                                  ######                                        ",
    "                             #              #                                   ",
    "                            ###            ###                                  ",
    "                           #####          #####                                 ",
    "                                                                                ",
    "                     ###                         ###                            ",
    "              ###                                      ###                      ",
    "                                                                             P  ",
    "                                 E                                          ####",
    "###########          ###########    ######    ###########          #############"
  ]
];

function initPlatformer() {
  pCanvas = document.getElementById('platformerCanvas');
  pCtx = pCanvas.getContext('2d');
  
  resizePlatformer();
  window.addEventListener('resize', resizePlatformer);
  
  // Wire level selector buttons
  document.querySelectorAll('.p-level-btn').forEach(btn => {
    btn.onclick = (e) => {
      sfx.play('click');
      const lvl = parseInt(btn.dataset.level);
      startPlatformerLevel(lvl);
    };
  });
  
  // Touch controls for mobile
  const wireMobileBtn = (id, key) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const press = (e) => { e.preventDefault(); sfx.init(); platKeys[key] = true; };
    const release = (e) => { e.preventDefault(); platKeys[key] = false; };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerout', release);
  };
  wireMobileBtn('btn-p-left', 'Left');
  wireMobileBtn('btn-p-right', 'Right');
  wireMobileBtn('btn-p-jump', 'Jump');
  
  window.addEventListener('keydown', handlePKeyDown);
  window.addEventListener('keyup', handlePKeyUp);
  
  document.getElementById('platformer-level-select').classList.remove('hidden');
  pGameState = 'select';
  pActive = true;
  pLastTime = 0;
  pAnimId = requestAnimationFrame(platformerTick);
}

function exitPlatformer() {
  pActive = false;
  if (pAnimId) {
    cancelAnimationFrame(pAnimId);
    pAnimId = null;
  }
  window.removeEventListener('resize', resizePlatformer);
  window.removeEventListener('keydown', handlePKeyDown);
  window.removeEventListener('keyup', handlePKeyUp);
  
  document.getElementById('platformer-level-select').classList.add('hidden');
  document.getElementById('platformer-gameover').classList.add('hidden');
  document.getElementById('platformer-victory').classList.add('hidden');
}

function resizePlatformer() {
  if (!pCanvas) return;
  pW = pCanvas.width = window.innerWidth;
  pH = pCanvas.height = window.innerHeight;
}

function handlePKeyDown(e) {
  if (!pActive) return;
  sfx.init();
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') platKeys.Left = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') platKeys.Right = true;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') {
    platKeys.Jump = true;
    e.preventDefault();
  }
}

function handlePKeyUp(e) {
  if (!pActive) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') platKeys.Left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') platKeys.Right = false;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') platKeys.Jump = false;
}

function startPlatformerLevel(lvlIdx) {
  document.getElementById('platformer-level-select').classList.add('hidden');
  document.getElementById('platformer-gameover').classList.add('hidden');
  document.getElementById('platformer-victory').classList.add('hidden');
  
  pCurrentLevelIdx = lvlIdx;
  document.getElementById('platformer-level-name').textContent = pLevelTitles[lvlIdx];
  
  pScore = 0;
  pLives = 3;
  updatePHud();
  
  pPlayer.x = 80;
  pPlayer.y = 100;
  pPlayer.vx = 0;
  pPlayer.vy = 0;
  pPlayer.grounded = false;
  pPlayer.hurtCooldown = 0;
  pPlayer.facing = 'right';
  pPlayer.animFrame = 0;
  pPlayer.capeAngle = 0;
  
  pCamX = 0;
  pBlocks = [];
  pEnemies = [];
  pCollectibles = [];
  pParticles = [];
  
  buildPlatformerMap(lvlIdx);
  pGameState = 'playing';
}

function updatePHud() {
  document.getElementById('platformer-score').textContent = pScore;
  document.getElementById('platformer-lives').textContent = pLives;
}

function buildPlatformerMap(lvlIdx) {
  const mapGrid = pLevels[lvlIdx];
  const rows = mapGrid.length;
  const cols = mapGrid[0].length;
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const char = mapGrid[r].charAt(c);
      const bx = c * P_BLOCK_SIZE;
      const by = r * P_BLOCK_SIZE;
      
      if (char === '#') {
        pBlocks.push({ x: bx, y: by, w: P_BLOCK_SIZE, h: P_BLOCK_SIZE, type: 'solid', color: '#6d3f21', border: '#8e5a36' });
      } else if (char === '?') {
        pBlocks.push({ x: bx, y: by, w: P_BLOCK_SIZE, h: P_BLOCK_SIZE, type: 'question', hit: false, color: '#f1c40f', border: '#ffeaa7' });
      } else if (char === 'B') {
        pCollectibles.push({ x: bx + 10, y: by + 10, w: 20, h: 20, type: 'ballot', vy: 0, bobOffset: Math.random() * Math.PI });
      } else if (char === 'E') {
        pEnemies.push({ x: bx, y: by + (P_BLOCK_SIZE - 32), w: 32, h: 32, vx: -1.5, type: 'slinger', rangeLeft: bx - 80, rangeRight: bx + 80, isGrounded: true });
      } else if (char === 'P') {
        pPodium = { x: bx, y: by - 80, w: 40, h: 120 };
      }
    }
  }
}

function updatePlatformer(dt) {
  if (pGameState !== 'playing') return;
  
  if (pPlayer.hurtCooldown > 0) {
    pPlayer.hurtCooldown--;
  }
  
  let moveX = 0;
  if (platKeys.Left) {
    moveX = -4.5;
    pPlayer.facing = 'left';
  }
  if (platKeys.Right) {
    moveX = 4.5;
    pPlayer.facing = 'right';
  }
  
  pPlayer.vx = moveX;
  pPlayer.vy += 0.55;
  if (pPlayer.vy > 12) pPlayer.vy = 12;
  
  if (platKeys.Jump && pPlayer.grounded) {
    pPlayer.vy = -12.5;
    pPlayer.grounded = false;
    sfx.play('launch');
  }
  
  pPlayer.grounded = false;
  pPlayer.x += pPlayer.vx;
  resolveCollisionsX();
  
  pPlayer.y += pPlayer.vy;
  resolveCollisionsY();
  
  if (Math.abs(pPlayer.vx) > 0.1) {
    pPlayer.animFrame += 0.18;
  } else {
    pPlayer.animFrame = 0;
  }
  
  const targetCapeAngle = (pPlayer.vx * -0.08) + (pPlayer.vy * 0.05);
  pPlayer.capeAngle += (targetCapeAngle - pPlayer.capeAngle) * 0.15;
  
  if (pPlayer.y > 650) {
    playerHurt();
  }
  
  pCollectibles.forEach(c => {
    if (c.vy) {
      c.y += c.vy;
      c.vy += 0.2;
      if (c.vy >= 0) c.vy = 0;
    }
    c.yOffset = Math.sin(frame * 0.1 + c.bobOffset) * 4;
    
    if (checkAABB(pPlayer, { x: c.x, y: c.y + c.yOffset, w: c.w, h: c.h })) {
      c.collected = true;
      pScore += 100;
      updatePHud();
      sfx.play('powerup');
    }
  });
  pCollectibles = pCollectibles.filter(c => !c.collected);
  
  pEnemies.forEach(e => {
    e.x += e.vx;
    
    if (e.x <= e.rangeLeft) {
      e.x = e.rangeLeft;
      e.vx = Math.abs(e.vx);
    } else if (e.x >= e.rangeRight) {
      e.x = e.rangeRight;
      e.vx = -Math.abs(e.vx);
    }
    
    let enemyHitSolid = false;
    pBlocks.forEach(b => {
      if (b.type === 'solid' && checkAABB(e, b)) {
        enemyHitSolid = true;
      }
    });
    if (enemyHitSolid) {
      e.vx = -e.vx;
      e.x += e.vx;
    }
    
    if (checkAABB(pPlayer, e)) {
      if (pPlayer.vy > 0 && (pPlayer.y + pPlayer.h - pPlayer.vy) <= e.y + 12) {
        e.dead = true;
        pPlayer.vy = -7.5;
        pScore += 200;
        updatePHud();
        sfx.play('pop');
        
        for (let i = 0; i < 8; i++) {
          pParticles.push({
            x: e.x + e.w/2,
            y: e.y + 5,
            vx: (Math.random() - 0.5) * 4,
            vy: -Math.random() * 3 - 2,
            r: Math.random() * 3 + 2,
            color: '#ff7d5f',
            life: 30
          });
        }
      } else {
        playerHurt();
      }
    }
  });
  pEnemies = pEnemies.filter(e => !e.dead);
  
  pParticles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
  });
  pParticles = pParticles.filter(p => p.life > 0);
  
  if (checkAABB(pPlayer, pPodium)) {
    pGameState = 'victory';
    sfx.play('level');
    document.getElementById('platformer-victory-score').textContent = pScore;
    document.getElementById('platformer-victory').classList.remove('hidden');
  }
}

function playerHurt() {
  if (pPlayer.hurtCooldown > 0) return;
  
  pLives--;
  updatePHud();
  sfx.play('hit');
  
  if (pLives <= 0) {
    pGameState = 'gameover';
    document.getElementById('platformer-gameover').classList.remove('hidden');
  } else {
    pPlayer.x = 80;
    pPlayer.y = 100;
    pPlayer.vx = 0;
    pPlayer.vy = 0;
    pPlayer.hurtCooldown = 60;
  }
}

function checkAABB(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function resolveCollisionsX() {
  pBlocks.forEach(b => {
    if (b.type === 'solid' || b.type === 'question') {
      if (checkAABB(pPlayer, b)) {
        if (pPlayer.vx > 0) {
          pPlayer.x = b.x - pPlayer.w;
          pPlayer.vx = 0;
        } else if (pPlayer.vx < 0) {
          pPlayer.x = b.x + b.w;
          pPlayer.vx = 0;
        }
      }
    }
  });
}

function resolveCollisionsY() {
  pBlocks.forEach(b => {
    if (b.type === 'solid' || b.type === 'question') {
      if (checkAABB(pPlayer, b)) {
        if (pPlayer.vy > 0) {
          pPlayer.y = b.y - pPlayer.h;
          pPlayer.vy = 0;
          pPlayer.grounded = true;
        } else if (pPlayer.vy < 0) {
          pPlayer.y = b.y + b.h;
          pPlayer.vy = 0;
          
          if (b.type === 'question' && !b.hit) {
            b.hit = true;
            sfx.play('bounce');
            
            pCollectibles.push({
              x: b.x + 10,
              y: b.y - 30,
              w: 20,
              h: 20,
              type: 'ballot',
              vy: -4,
              bobOffset: Math.random() * Math.PI
            });
            
            pScore += 100;
            updatePHud();
          }
        }
      }
    }
  });
}

function drawBlock(ctx, b) {
  ctx.save();
  ctx.shadowBlur = 4;
  ctx.shadowColor = b.type === 'question' ? 'rgba(241, 196, 15, 0.4)' : 'rgba(0,0,0,0.3)';
  
  if (b.type === 'solid') {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(b.x, b.y, b.w, 8);
    
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  } else if (b.type === 'question') {
    if (b.hit) {
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#95a5a6';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    } else {
      let grad = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      grad.addColorStop(0, '#f1c40f');
      grad.addColorStop(1, '#d35400');
      ctx.fillStyle = grad;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Outfit';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', b.x + b.w/2, b.y + b.h/2);
    }
  }
  ctx.restore();
}

function drawEnemy(ctx, e) {
  ctx.save();
  ctx.translate(e.x + e.w/2, e.y + e.h/2);
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#e74c3c';
  
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(0, 0, e.w/2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  const rot = (e.x * 0.08) % (Math.PI * 2);
  ctx.rotate(rot);
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc(e.w/4, 0, 4, 0, Math.PI*2);
  ctx.fill();
  
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(e.w/4 + 1.5, -1.5, 1.5, 0, Math.PI*2);
  ctx.fill();
  
  ctx.restore();
}

function drawCollectible(ctx, c) {
  ctx.save();
  const cy = c.y + (c.yOffset || 0);
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#2ecc71';
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(c.x, cy, c.w, c.h);
  
  ctx.strokeStyle = '#bdc3c7';
  ctx.lineWidth = 1;
  ctx.strokeRect(c.x, cy, c.w, c.h);
  
  ctx.beginPath();
  ctx.moveTo(c.x, cy);
  ctx.lineTo(c.x + c.w/2, cy + c.h/2);
  ctx.lineTo(c.x + c.w, cy);
  ctx.stroke();
  
  ctx.fillStyle = '#2ecc71';
  ctx.font = 'bold 8px Outfit';
  ctx.fillText('✔', c.x + c.w/2 - 4, cy + c.h - 2);
  
  ctx.restore();
}

function drawPodium(ctx, p) {
  ctx.save();
  ctx.fillStyle = '#7f8c8d';
  ctx.fillRect(p.x + p.w/2 - 3, p.y, 6, p.h);
  
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(p.x + p.w/2, p.y, 6, 0, Math.PI*2);
  ctx.fill();
  
  const flagW = 28;
  const flagH = 18;
  const flagWave = Math.sin(frame * 0.15) * 2;
  
  ctx.fillStyle = '#3498db';
  ctx.fillRect(p.x + p.w/2 + 3, p.y + 4 + flagWave, flagW, flagH);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px Outfit';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', p.x + p.w/2 + 3 + flagW/2, p.y + 4 + flagWave + flagH/2);
  
  ctx.fillStyle = '#34495e';
  ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(p.x, p.y + p.h - 12, p.w, 12);
  
  ctx.restore();
}

function drawPlayerCape(ctx, px, py, pWidth, pHeight) {
  ctx.save();
  ctx.translate(px + (pPlayer.facing === 'right' ? 8 : pWidth - 8), py + 12);
  ctx.fillStyle = '#ff3838';
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 1.5;
  
  const wWidth = 24;
  const wHeight = 32;
  const wave = Math.sin(frame * 0.2) * 2;
  
  ctx.beginPath();
  ctx.moveTo(0, 0);
  
  if (pPlayer.facing === 'right') {
    const capeAngle = pPlayer.capeAngle || 0;
    const cx1 = -16 - capeAngle * 10;
    const cy1 = 12 + wave;
    const cx2 = -wWidth - capeAngle * 20;
    const cy2 = wHeight;
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2 - 8, cx2, cy2);
    ctx.lineTo(cx2 + 6, cy2);
    ctx.bezierCurveTo(cx2 + 4, cy2 - 10, -6, 12, 0, 8);
  } else {
    const capeAngle = pPlayer.capeAngle || 0;
    const cx1 = 16 + capeAngle * 10;
    const cy1 = 12 + wave;
    const cx2 = wWidth + capeAngle * 20;
    const cy2 = wHeight;
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2 - 8, cx2, cy2);
    ctx.lineTo(cx2 - 6, cy2);
    ctx.bezierCurveTo(cx2 - 4, cy2 - 10, 6, 12, 0, 8);
  }
  
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlatformerPlayer(ctx) {
  const px = pPlayer.x;
  const py = pPlayer.y;
  const pw = pPlayer.w;
  const ph = pPlayer.h;
  
  if (pPlayer.hurtCooldown > 0 && Math.floor(frame / 4) % 2 === 0) {
    return;
  }
  
  drawPlayerCape(ctx, px, py, pw, ph);
  
  ctx.save();
  ctx.translate(px + pw/2, py + ph/2);
  
  if (pPlayer.facing === 'left') {
    ctx.scale(-1, 1);
  }
  
  const bob = Math.sin(pPlayer.animFrame) * 1.5;
  
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, ph/2 - 2, 12, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = '#ff7675';
  const lOffset = Math.sin(pPlayer.animFrame) * 6;
  ctx.fillRect(-8, ph/2 - 8 + bob + (lOffset > 0 ? -2 : 0), 6, 8);
  ctx.fillRect(2, ph/2 - 8 + bob + (lOffset < 0 ? -2 : 0), 6, 8);
  
  ctx.fillStyle = '#7d5fff';
  ctx.fillRect(-10, -8 + bob, 20, 18);
  
  ctx.fillStyle = '#f1c40f';
  ctx.fillRect(-11, 8 + bob, 22, 3);
  
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, -2 + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = '#ffdbac';
  ctx.beginPath();
  ctx.arc(0, -18 + bob, 8, 0, Math.PI*2);
  ctx.fill();
  
  ctx.fillStyle = '#2d3436';
  ctx.beginPath();
  ctx.arc(0, -22 + bob, 9, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-8, -21 + bob, 3, 5);
  
  ctx.fillStyle = '#ff7675';
  ctx.fillRect(-6, -20 + bob, 12, 3);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-4, -19 + bob, 2, 2);
  ctx.fillRect(2, -19 + bob, 2, 2);
  
  ctx.restore();
}

function drawPlatformerParallaxBackground(ctx, yOffset) {
  ctx.save();
  ctx.fillStyle = '#170921';
  ctx.beginPath();
  for (let x = pCamX * 0.5 - 200; x < pCamX * 0.5 + pW + 400; x += 300) {
    ctx.quadraticCurveTo(x + 150, 200, x + 300, 300);
  }
  ctx.lineTo(pCamX * 0.5 + pW + 400, 600);
  ctx.lineTo(pCamX * 0.5 - 200, 600);
  ctx.fill();
  ctx.restore();
  
  ctx.save();
  ctx.fillStyle = '#261036';
  ctx.beginPath();
  for (let x = pCamX * 0.7 - 200; x < pCamX * 0.7 + pW + 400; x += 200) {
    ctx.quadraticCurveTo(x + 100, 320, x + 200, 420);
  }
  ctx.lineTo(pCamX * 0.7 + pW + 400, 600);
  ctx.lineTo(pCamX * 0.7 - 200, 600);
  ctx.fill();
  ctx.restore();
}

function drawPlatformerGame() {
  pCtx.clearRect(0, 0, pW, pH);
  
  const yOffset = Math.max(0, pH - 600);
  const targetCamX = pPlayer.x - pW / 3;
  pCamX += (targetCamX - pCamX) * 0.15;
  const mapGridWidth = pLevels[pCurrentLevelIdx][0].length * P_BLOCK_SIZE;
  if (pCamX < 0) pCamX = 0;
  if (pCamX > mapGridWidth - pW) pCamX = mapGridWidth - pW;
  
  pCtx.save();
  pCtx.translate(-pCamX, yOffset);
  
  drawPlatformerParallaxBackground(pCtx, yOffset);
  
  pBlocks.forEach(b => {
    if (b.x + b.w >= pCamX - P_BLOCK_SIZE && b.x <= pCamX + pW) {
      drawBlock(pCtx, b);
    }
  });
  
  drawPodium(pCtx, pPodium);
  
  pCollectibles.forEach(c => {
    drawCollectible(pCtx, c);
  });
  
  pEnemies.forEach(e => {
    drawEnemy(pCtx, e);
  });
  
  pParticles.forEach(p => {
    pCtx.save();
    pCtx.fillStyle = p.color;
    pCtx.globalAlpha = p.life / 30;
    pCtx.beginPath();
    pCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    pCtx.fill();
    pCtx.restore();
  });
  
  drawPlatformerPlayer(pCtx);
  
  pCtx.restore();
}

function platformerTick(timestamp) {
  if (!pActive) return;
  if (!pLastTime) pLastTime = timestamp;
  let dt = (timestamp - pLastTime) / 1000;
  pLastTime = timestamp;
  
  if (dt > 0.1) dt = 0.1;
  
  updatePlatformer(dt);
  drawPlatformerGame();
  
  pAnimId = requestAnimationFrame(platformerTick);
}




