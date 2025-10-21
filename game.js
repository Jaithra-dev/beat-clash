// === Beat Clash Game Logic ===

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const lanesPerPlayer = 4;
const laneW = 100;
const laneGap = 20;
const leftMargin = (W - (laneW*lanesPerPlayer*2 + laneGap))/2;
const hitLineY = H - 120;
const judgementWindow = 0.18;
const perfectWindow = 0.07;
const noteSpeed = 420;

// Audio
let audioCtx = null;
let audioBuffer = null;
let audioSource = null;
let gameStartAudioTime = null;
let useAudioTiming = false;

// Round timing
const roundLengthInput = document.getElementById('roundLength'); // expects seconds (0 = full song)
let roundEndTime = null; // seconds from start (relative to game start)

// Game state
let running = false;
let startTimePerf = 0;
let notes = [];
let score = [0,0];
let combo = [0,0];

// UI references
const fileInput = document.getElementById('audioFile');
const bpmInput = document.getElementById('bpmInput');
const densityInput = document.getElementById('density');
const densityVal = document.getElementById('densityVal');
const offsetMsInput = document.getElementById('offsetMs');
const genMapBtn = document.getElementById('genMap');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const restartBtn = document.getElementById('restartBtn');
const statusEl = document.getElementById('status');
const songInfoEl = document.getElementById('songInfo');
const info1 = document.getElementById('info1');
const info2 = document.getElementById('info2');
const leaderboardEl = document.getElementById('leaderboard'); // leaderboard <ol> in HTML

densityInput.addEventListener('input', ()=> densityVal.innerText = densityInput.value);

// === File loading ===
fileInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  songInfoEl.innerText = `Loaded: ${file.name} — ${audioBuffer.duration.toFixed(2)}s`;
  statusEl.innerText = 'Track loaded — set BPM and generate beatmap.';
});

// === Beatmap Generation ===
// bpm: number, density: 0..1, offsetMs: milliseconds to shift, endTimeSeconds: optional end time (seconds)
function generateBeatmap(bpm, density, offsetMs, endTimeSeconds = null){
  const map = [];
  // seconds per beat
  const spb = 60 / Math.max(1, bpm);
  const audioDuration = audioBuffer ? audioBuffer.duration : 30;
  // determine effective end
  const end = (endTimeSeconds && endTimeSeconds > 0) ? Math.min(endTimeSeconds, audioDuration) : audioDuration;
  const startOffset = Math.max(0, (offsetMs || 0) / 1000);
  // generate notes for every beat between startOffset+spb and end
  for(let t = startOffset + spb; t < end - 0.05; t += spb){
    let added = false;
    if(Math.random() < density){ map.push({time:t,lane:Math.floor(Math.random()*lanesPerPlayer)}); added=true; }
    if(Math.random() < density){ map.push({time:t,lane:Math.floor(Math.random()*lanesPerPlayer)+lanesPerPlayer}); added=true; }
    if(!added && Math.random()<0.25){
      const side = Math.random()<0.5?0:1;
      const lane = side===0?Math.floor(Math.random()*lanesPerPlayer):Math.floor(Math.random()*lanesPerPlayer)+lanesPerPlayer;
      map.push({time:t,lane});
    }
  }
  return map.sort((a,b)=>a.time-b.time);
}

function loadMapToNotes(map){
  notes = map.map(n=>({time:n.time,lane:n.lane,hit:false}));
  updateNoteCounts();
  statusEl.innerText = 'Beatmap ready — press PLAY (or SPACE) to start.';
}
function updateNoteCounts(){
  const leftCount = notes.filter(n=>n.lane<lanesPerPlayer).length;
  const rightCount = notes.filter(n=>n.lane>=lanesPerPlayer).length;
  info1.innerText = 'Notes: '+leftCount;
  info2.innerText = 'Notes: '+rightCount;
}

// === Buttons ===
genMapBtn.addEventListener('click',()=>{
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const bpm = Number(bpmInput.value) || 120;
  const density = Number(densityInput.value) || 0.6;
  const offsetMs = Number(offsetMsInput.value) || 0;
  const roundLen = Number(roundLengthInput.value) || 0;
  const map = generateBeatmap(bpm, density, offsetMs, roundLen > 0 ? roundLen : null);
  loadMapToNotes(map);
});

playBtn.addEventListener('click', ()=> { if(!running) startGame(); });
stopBtn.addEventListener('click', ()=> { stopGame(); });
restartBtn.addEventListener('click', ()=> { resetGame(); });

// === Game Flow ===
function startGame(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') audioCtx.resume();

  // compute roundEndTime (relative seconds from game start)
  const userLength = Number(roundLengthInput.value) || 0;

  if(audioBuffer){
    if(audioSource) try{ audioSource.stop(); }catch(e){}
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioCtx.destination);

    // schedule audio and set timing
    const startAt = audioCtx.currentTime + 0.2;
    audioSource.start(startAt);
    gameStartAudioTime = startAt;
    useAudioTiming = true;

    // if user specified length > 0, use min(userLength, audioDuration), else full song
    roundEndTime = userLength > 0 ? Math.min(userLength, audioBuffer.duration) : audioBuffer.duration;
  } else {
    // no audio: fallback to perf timing and user length or default 30s
    startTimePerf = performance.now();
    useAudioTiming = false;
    roundEndTime = userLength > 0 ? userLength : 30;
  }

  running = true;
  statusEl.innerText = `Playing... (round ends at ${roundEndTime.toFixed(2)}s)`;
  score = [0,0]; combo = [0,0];
  updateHUD();
  requestAnimationFrame(loop);
}

function stopGame(){
  if(audioSource){ try{ audioSource.stop(); }catch(e){} audioSource = null; }
  running = false;
  statusEl.innerText = 'Stopped';
}

function resetGame(){
  running = false;
  if(audioSource){ try{ audioSource.stop(); }catch(e){} audioSource = null; }
  score = [0,0]; combo = [0,0];
  updateHUD();
  statusEl.innerText = 'Ready — generate map and press PLAY';
}

// === Input ===
const keyToLane={'a':0,'s':1,'d':2,'f':3,'j':4,'k':5,'l':6,';':7};
window.addEventListener('keydown',(e)=>{
  if(e.code === 'Space'){ if(!running) startGame(); return; }
  const k = e.key.toLowerCase();
  if(keyToLane.hasOwnProperty(k)) handleHit(keyToLane[k]);
});

// === Hit Logic ===
function handleHit(lane){
  if(!running) return;
  const now = getNow();
  let candidate = null; let bestDelta = 999;
  for(const note of notes){
    if(note.hit) continue;
    if(note.lane !== lane) continue;
    const delta = Math.abs(note.time - now);
    if(delta < bestDelta){ bestDelta = delta; candidate = note; }
  }
  if(candidate && bestDelta <= judgementWindow){
    if(bestDelta <= perfectWindow) registerHit(lane, 'Perfect');
    else registerHit(lane, 'Good');
    candidate.hit = true;
  } else registerMiss(lane);
}

function registerHit(lane, grade){
  const player = lane < lanesPerPlayer ? 0 : 1;
  const points = (grade === 'Perfect') ? 100 : 50;
  score[player] += points;
  combo[player] += 1;
  playClick(grade === 'Perfect' ? 1200 : 800, 0.06);
  spawnHitFx(lane, grade);
  updateHUD();
  animateCombo(player);
}

function registerMiss(lane){
  const player = lane < lanesPerPlayer ? 0 : 1;
  combo[player] = 0;
  score[player] = Math.max(0, score[player] - 5);
  spawnMissFx(lane);
  updateHUD();
}

// === HUD ===
function updateHUD(){
  document.getElementById('score1').innerText = 'P1 Score: ' + score[0];
  document.getElementById('score2').innerText = 'P2 Score: ' + score[1];
  document.getElementById('combo1').innerText = 'Combo: ' + combo[0];
  document.getElementById('combo2').innerText = 'Combo: ' + combo[1];
}
function animateCombo(player){
  const el = document.getElementById(player === 0 ? 'combo1' : 'combo2');
  el.classList.add('combo-animate');
  setTimeout(()=>el.classList.remove('combo-animate'),250);
}

// === Leaderboard (localStorage) ===
function saveScore(playerName, playerScore){
  let scores = JSON.parse(localStorage.getItem("beatClashScores")) || [];
  // Normalize tie name
  const name = (playerName === 'Tie!' ? 'Tie' : playerName);
  scores.push({ name: name, score: playerScore });
  scores.sort((a,b)=>b.score - a.score);
  scores = scores.slice(0,100);
  localStorage.setItem("beatClashScores", JSON.stringify(scores));
  renderLeaderboard();
}
function renderLeaderboard(){
  if(!leaderboardEl) return;
  let scores = JSON.parse(localStorage.getItem("beatClashScores")) || [];
  leaderboardEl.innerHTML = "";
  scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.textContent = `${s.name}: ${s.score}`;
    leaderboardEl.appendChild(li);
  });
}
renderLeaderboard();

// === Sound FX ===
function playClick(freq=880, dur=0.06){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine'; o.frequency.value = freq; g.gain.value = 0.12;
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur + 0.02);
}

// === Visual FX ===
let fx = [];
function spawnHitFx(lane, grade){ fx.push({x: laneXCenter(lane), y: hitLineY, t: performance.now(), type:'hit', label:grade}); }
function spawnMissFx(lane){ fx.push({x: laneXCenter(lane), y: hitLineY, t: performance.now(), type:'miss'}); }
function laneXCenter(lane){ const side = lane < lanesPerPlayer ? 0 : 1; const index = lane % lanesPerPlayer; return leftMargin + side*(lanesPerPlayer*laneW + laneGap) + index*laneW + laneW/2; }

// === Game Loop ===
function loop(){
  ctx.clearRect(0,0,W,H);
  drawGrid(); drawLanes();
  const now = getNow();

  // Round timer check: stop when time runs out
  if(roundEndTime && now >= roundEndTime){
    running = false;
    const winner = score[0] === score[1] ? 'Tie!' : (score[0] > score[1] ? 'Player 1' : 'Player 2');
    const winningScore = score[0] >= score[1] ? score[0] : score[1];
    statusEl.innerText = 'Round Over — ' + (winner === 'Tie!' ? 'Tie!' : winner + ' Wins!');
    saveScore(winner, winningScore);
    if(audioSource){ try{ audioSource.stop(); }catch(e){} audioSource = null; }
    showWinnerCelebration(winner)
    return; // stop processing further frames
  }

  for(const note of notes){
    if(note.hit) continue;
    const dt = note.time - now;
    const y = hitLineY - dt * noteSpeed;
    if(y > -40 && y < H + 40){
      const x = laneXCenter(note.lane) - laneW/2 + 6;
      drawNote(x, y, laneW-12, 18, note.lane);
    }
    if(dt < -judgementWindow && !note.hit){
      note.hit = true;
      registerMiss(note.lane);
    }
  }

  drawFx();

  const remaining = notes.filter(n => !n.hit).length;
  if(running && remaining === 0){
    running = false;
    const winner = score[0] === score[1] ? 'Tie!' : (score[0] > score[1] ? 'Player 1' : 'Player 2');
    const winningScore = score[0] >= score[1] ? score[0] : score[1];
    statusEl.innerText = 'Finished — ' + winner;
    saveScore(winner, winningScore);
    if(audioSource){ try{ audioSource.stop(); }catch(e){} audioSource = null; }
    showWinnerCelebration(winner);
    return;
  }

  if(running) requestAnimationFrame(loop);
}

function getNow(){
  if(useAudioTiming && audioCtx && gameStartAudioTime != null){
    return audioCtx.currentTime - gameStartAudioTime;
  } else {
    return (performance.now() - startTimePerf) / 1000;
  }
}

// === Drawing helpers ===
function drawGrid(){
  ctx.save();
  ctx.fillStyle = '#061221';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for(let y=0;y<H;y+=28){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
}

function drawLanes(){
  for(let side=0; side<2; side++){
    for(let i=0;i<lanesPerPlayer;i++){
      const x = leftMargin + side*(lanesPerPlayer*laneW + laneGap) + i*laneW;
      ctx.fillStyle = side===0 ? 'rgba(34,211,238,0.06)' : 'rgba(255,107,107,0.05)';
      roundRect(ctx, x+4, 40, laneW-8, H-200, 8, true, false);
      const keyLabel = getKeyLabel(side, i);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '18px Verdana';
      ctx.textAlign = 'center';
      ctx.fillText(keyLabel, x + laneW/2, H - 60);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x+6, hitLineY); ctx.lineTo(x+laneW-6, hitLineY); ctx.stroke();
    }
  }
}

function getKeyLabel(side,i){ const p1=['A','S','D','F']; const p2=['J','K','L',';']; return side===0? p1[i] : p2[i]; }

function drawNote(x,y,w,h,lane){
  ctx.save();
  const side = lane < lanesPerPlayer ? 0 : 1;
  ctx.shadowBlur = 20;
  ctx.shadowColor = side===0 ? '#22d3ee' : '#ff6b6b';
  ctx.fillStyle = side===0 ? '#22d3ee' : '#ff6b6b';
  roundRect(ctx, x, y, w, h, 6, true, false);
  ctx.restore();
}

function drawFx(){
  const now = performance.now();
  for(let i=fx.length-1;i>=0;i--){
    const e = fx[i];
    const age = (now - e.t) / 1000;
    if(age > 0.6){ fx.splice(i,1); continue; }
    ctx.save();
    ctx.globalAlpha = 1 - age*1.6;
    ctx.textAlign = 'center';
    ctx.font = '20px Verdana';
    if(e.type === 'hit'){
      ctx.fillStyle = e.label === 'Perfect' ? '#fff' : '#ffd';
      ctx.fillText(e.label, e.x, e.y - age*40);
    } else {
      ctx.fillStyle = '#f88';
      ctx.fillText('MISS', e.x, e.y - age*40);
    }
    ctx.restore();
  }
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){
  if(typeof stroke === 'undefined') stroke = true;
  if(typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

document.getElementById("resetScores").addEventListener("click", () => {
  localStorage.removeItem("beatClashScores");
  renderLeaderboard(); // refresh empty leaderboard
});
// === Winner Celebration ===
// === Simple Winner Alert ===
function showWinnerCelebration(winner) {
  if (!winner || winner === "Tie!") {
    alert("It's a Tie ✨🤝!");
  } else {
    alert(`${winner} Wins 🎉🪄🎁!`);
  }
}

 