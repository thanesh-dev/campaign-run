
'use strict';

// ─── STARS ───────────────────────────────────────────────────────────────────
(function createStars() {
  ['stars', 'hub-stars'].forEach(id => {
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
  try { return JSON.parse(localStorage.getItem('vq_lb') || '[]'); } catch(e){ return []; }
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
          gain.gain.linearRampToValueAtTime(0, now + delay + 0.2);
          osc.start(now + delay); osc.stop(now + delay + 0.2);
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

