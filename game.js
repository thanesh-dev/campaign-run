
'use strict';

// ─── STARS ───────────────────────────────────────────────────────────────────
(function createStars() {
  const c = document.getElementById('stars');
  for (let i = 0; i < 80; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const sz = Math.random() * 2.5 + 0.5;
    s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random()*100}%;left:${Math.random()*100}%;--dur:${(Math.random()*3+2).toFixed(1)}s;--delay:-${(Math.random()*5).toFixed(1)}s`;
    c.appendChild(s);
  }
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

// ─── TOUCH / SWIPE ────────────────────────────────────────────────────────────
let touchStartX = 0, touchStartY = 0;
window.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
window.addEventListener('touchend', e => {
  if (gameState !== 'running') return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 10 && ady < 10) { jump(); return; }
  if (ady > adx) { dy < 0 ? jump() : slide(); }
  else           { dx < 0 ? moveLeft() : moveRight(); }
}, { passive: true });

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

// ─── BOOT ─────────────────────────────────────────────────────────────────────
initCanvas();
showScreen('start-screen');
