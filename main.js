import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// -------------------- basic helpers --------------------
const $ = (s)=>document.querySelector(s);
const canvas = $('#game');
const nameModal = $('#nameModal');
const nameInput = $('#nameInput');
const serverInput = $('#serverInput');
const joinBtn = $('#joinBtn');
const hudName = $('#playerName');
const bananaCountEl = $('#bananaCount');
const onlineCountEl = $('#onlineCount');
const connStatus = $('#connStatus');

let socket = null;
let myId = null;
let myName = null;
let bananas = new Map(); // id -> mesh
let otherPlayers = new Map(); // id -> {mesh, nameTag}
let bananaCount = 0;

// -------------------- THREE setup --------------------
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0f0d, 40, 220);

// sky
const skyGeo = new THREE.SphereGeometry(500, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    topColor: { value: new THREE.Color(0x0a0f0d) },
    bottomColor: { value: new THREE.Color(0x16331f) },
    offset: { value: 33 },
    exponent: { value: 0.9 }
  },
  vertexShader: `varying vec3 vWorldPosition; void main(){ vec4 p = modelMatrix * vec4(position,1.0); vWorldPosition = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }`,
  fragmentShader: `varying vec3 vWorldPosition; uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; void main(){ float h = normalize(vWorldPosition + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0); }`
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// ground
const groundGeo = new THREE.CircleGeometry(200, 64);
groundGeo.rotateX(-Math.PI/2);
const groundMat = new THREE.MeshStandardMaterial({color:0x274d2d, roughness:.95, metalness:0});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

// jungle props
const rng = (a,b)=>a + Math.random()*(b-a);
const trees = new THREE.Group();
for(let i=0;i<60;i++){
  const r = rng(30, 180);
  const a = rng(0, Math.PI*2);
  const x = Math.cos(a)*r;
  const z = Math.sin(a)*r;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.9,rng(6,10),8), new THREE.MeshStandardMaterial({color:0x5b3d1a}));
  const crown = new THREE.Mesh(new THREE.ConeGeometry(rng(2.5,4), rng(4,7), 8), new THREE.MeshStandardMaterial({color:0x2f6b34}));
  trunk.position.set(x, trunk.geometry.parameters.height/2, z);
  crown.position.set(x, trunk.geometry.parameters.height + crown.geometry.parameters.height/2 - 0.6, z);
  trees.add(trunk, crown);
}
scene.add(trees);

// lights
const hemi = new THREE.HemisphereLight(0xcde7d8, 0x0b0f0d, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(40, 60, 30);
sun.castShadow = true;
scene.add(sun);

// camera
const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

// my player (funny monkey-like capsule)
function makeMonkey(color=0xffcc66){
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshStandardMaterial({color}));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshStandardMaterial({color:0x8f5b2e}));
  head.position.y = 1.2;
  const earL = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), new THREE.MeshStandardMaterial({color:0x8f5b2e, side:THREE.DoubleSide}));
  const earR = earL.clone();
  earL.position.set(-0.6, 1.3, 0.3); earL.rotation.y = Math.PI/2;
  earR.position.set( 0.6, 1.3, 0.3); earR.rotation.y = -Math.PI/2;
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 20, Math.PI*1.3), new THREE.MeshStandardMaterial({color:0x8f5b2e}));
  tail.position.set(-0.7, 0.6, -0.2); tail.rotation.z = Math.PI/1.5;
  group.add(body, head, earL, earR, tail);
  group.castShadow = true;
  return group;
}

const myPlayer = makeMonkey();
myPlayer.position.set(0, 0.9, 0);
scene.add(myPlayer);

function makeNameTag(text){
  const div = document.createElement('div');
  div.className = 'nameTag';
  div.textContent = text;
  div.style.position='absolute';
  div.style.padding='2px 6px';
  div.style.background='rgba(0,0,0,.5)';
  div.style.border='1px solid rgba(255,255,255,.15)';
  div.style.borderRadius='10px';
  div.style.fontSize='12px';
  div.style.pointerEvents='none';
  document.body.appendChild(div);
  return div;
}

function worldToScreen(obj){
  const v = obj.position.clone();
  v.project(camera);
  const x = (v.x *  0.5 + 0.5) * window.innerWidth;
  const y = ( -v.y * 0.5 + 0.5) * window.innerHeight;
  return {x,y};
}

// -------------------- INPUT --------------------
const keys = Object.create(null);

function setKey(code, isDown){
  keys[code] = isDown;
}

window.addEventListener('keydown', (e)=>{
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  setKey(e.code, true);
});
window.addEventListener('keyup', (e)=>{
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  setKey(e.code, false);
});

// On-screen touch controls for phones/tablets
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) {
  const pad = document.createElement('div');
  pad.style.position = 'fixed';
  pad.style.bottom = '16px';
  pad.style.left = '16px';
  pad.style.display = 'grid';
  pad.style.gridTemplateColumns = '60px 60px 60px';
  pad.style.gridTemplateRows = '60px 60px 60px';
  pad.style.gap = '8px';
  pad.style.zIndex = '20';
  pad.style.opacity = '0.9';

  const mkBtn = (label, code)=>{
    const b = document.createElement('button');
    b.textContent = label;
    b.style.width='60px'; b.style.height='60px';
    b.style.border='1px solid rgba(255,255,255,.2)';
    b.style.borderRadius='12px';
    b.style.background='rgba(40,40,60,.6)';
    b.style.color='#fff';
    b.style.fontWeight='700';
    b.style.touchAction='none';
    const on = (ev)=>{ ev.preventDefault(); setKey(code, true); };
    const off= (ev)=>{ ev.preventDefault(); setKey(code, false); };
    b.addEventListener('touchstart', on, {passive:false});
    b.addEventListener('touchend', off, {passive:false});
    b.addEventListener('touchcancel', off, {passive:false});
    return b;
  };

  // layout arrows
  pad.appendChild(document.createElement('div'));
  pad.appendChild(mkBtn('▲','KeyW'));
  pad.appendChild(document.createElement('div'));
  pad.appendChild(mkBtn('◀','KeyA'));
  pad.appendChild(document.createElement('div'));
  pad.appendChild(mkBtn('▶','KeyD'));
  pad.appendChild(document.createElement('div'));
  pad.appendChild(mkBtn('▼','KeyS'));
  pad.appendChild(document.createElement('div'));
  document.body.appendChild(pad);

  // jump button right side
  const jump = mkBtn('⤴','Space');
  jump.style.position='fixed';
  jump.style.bottom='24px';
  jump.style.right='24px';
  jump.style.width='70px'; jump.style.height='70px';
  jump.style.fontSize='20px';
  jump.style.borderRadius='50%';
  document.body.appendChild(jump);
}

let vel = new THREE.Vector3();
let yaw = 0;

// -------------------- BANANAS --------------------
function makeBanana(){
  const g = new THREE.TorusKnotGeometry(0.25, 0.08, 60, 8);
  const m = new THREE.MeshStandardMaterial({color:0xffe460, metalness:.1, roughness:.5});
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.rotation.x = Math.PI/2;
  return mesh;
}

function spawnBanana(id, x, z){
  const b = makeBanana();
  b.position.set(x, 0.35, z);
  bananas.set(id, b);
  scene.add(b);
}

function removeBanana(id){
  const b = bananas.get(id);
  if(!b) return;
  scene.remove(b);
  bananas.delete(id);
}

// -------------------- OTHER PLAYERS --------------------
function addOtherPlayer(id, name, x, z, rotY){
  const mesh = makeMonkey(0xffd699);
  mesh.position.set(x||0, 0.9, z||0);
  mesh.rotation.y = rotY||0;
  scene.add(mesh);
  const tag = makeNameTag(name||'Player');
  otherPlayers.set(id, {mesh, tag, name});
  onlineCountEl.textContent = otherPlayers.size + 1;
}

function removeOtherPlayer(id){
  const p = otherPlayers.get(id);
  if(!p) return;
  scene.remove(p.mesh);
  p.tag.remove();
  otherPlayers.delete(id);
  onlineCountEl.textContent = otherPlayers.size + 1;
}

// -------------------- RESIZE --------------------
window.addEventListener('resize', ()=>{
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
});

// -------------------- JOIN FLOW --------------------
joinBtn.addEventListener('click', ()=>{
  const name = (nameInput.value || '').trim() || 'Monkey'+Math.floor(Math.random()*1000);
  const url = (serverInput.value || '').trim();
  start(name, url);
});

// -------------------- NETWORK START --------------------
function start(name, serverUrl){
  myName = name; hudName.textContent = myName;
  nameModal.classList.add('hidden');

  const DEFAULT_SERVER = 'https://banana-bandits-server.onrender.com';
  const ioUrl = (serverUrl && serverUrl.startsWith('http')) ? serverUrl : DEFAULT_SERVER;

  socket = io(ioUrl, {
    path: '/socket.io',
    transports: ['websocket','polling'],
    timeout: 15000,
    reconnectionAttempts: 5
  });

  const showErr = (label, err)=>{ 
    connStatus.textContent = label + (err?.message ? `: ${err.message}` : '');
    connStatus.classList.remove('good'); 
    connStatus.classList.add('bad'); 
  };

  socket.on('connect', ()=>{
    connStatus.textContent = 'connected';
    connStatus.classList.remove('bad'); connStatus.classList.add('good');
    myId = socket.id;
    socket.emit('join', {name: myName});
  });

  socket.on('connect_error', (err)=> showErr('connect_error', err));
  socket.on('error',         (err)=> showErr('error', err));
  socket.on('reconnect_error',(err)=> showErr('reconnect_error', err));
  socket.on('disconnect', (reason)=> showErr('disconnected', {message: reason}));

  socket.on('init', (data)=>{
    data.bananas.forEach(b=> spawnBanana(b.id, b.x, b.z));
    Object.values(data.players).forEach(p=>{
      if(p.id !== socket.id){
        addOtherPlayer(p.id, p.name, p.x, p.z, p.rotY);
      }
    });
    onlineCountEl.textContent = otherPlayers.size + 1;
  });

  socket.on('playerJoined', (p)=>{
    if(p.id===socket.id) return;
    addOtherPlayer(p.id, p.name, p.x, p.z, p.rotY);
  });

  socket.on('playerLeft', (id)=> removeOtherPlayer(id));

  socket.on('playerMoved', (p)=>{
    const o = otherPlayers.get(p.id);
    if(!o) return;
    o.mesh.position.set(p.x, 0.9, p.z);
    o.mesh.rotation.y = p.rotY||0;
  });

  socket.on('bananaPicked', (data)=>{
    removeBanana(data.bananaId);
    if(data.playerId === socket.id){
      bananaCount++;
      bananaCountEl.textContent = bananaCount;
    }
  });

  socket.on('peelThrown', (data)=>{
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 24), new THREE.MeshStandardMaterial({color:0xffd27f}));
    t.position.set(data.x, 0.1, data.z);
    t.rotation.x = Math.PI/2;
    scene.add(t);
    setTimeout(()=>scene.remove(t), 4000);
  });
}

// -------------------- INTERACTION --------------------
window.addEventListener('click', ()=>{
  if(!socket || !socket.connected) return;
  const dir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), myPlayer.rotation.y);
  const pos = myPlayer.position.clone().add(dir.clone().multiplyScalar(1.2));
  socket.emit('throwPeel', {x: pos.x, z: pos.z});
});

// Hop animation with Space (or touch jump)
let hopT = 0; // 0..1 during hop
function triggerHop(){
  if (hopT > 0 && hopT < 1) return; // already hopping
  hopT = 0.0001;
}
window.addEventListener('keydown', (e)=>{
  if (e.code === 'Space') { e.preventDefault(); triggerHop(); }
});

// -------------------- GAME LOOP --------------------
const clock = new THREE.Clock();
let accumNet = 0;

function tick(){
  const dt = Math.min(clock.getDelta(), 0.033);
  const speed = 5.2;

  // support WASD and Arrow keys
  const W = keys['KeyW'] || keys['ArrowUp'];
  const S = keys['KeyS'] || keys['ArrowDown'];
  const A = keys['KeyA'] || keys['ArrowLeft'];
  const D = keys['KeyD'] || keys['ArrowRight'];

  const forward = (W?1:0) - (S?1:0);
  const strafe  = (D?1:0) - (A?1:0);

  if (forward !== 0 || strafe !== 0){
    yaw = Math.atan2(strafe, forward);
    myPlayer.rotation.y = THREE.MathUtils.lerpAngle(myPlayer.rotation.y, yaw + camera.rotation.y, 0.2);
  }

  const dir = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), myPlayer.rotation.y);
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).negate();

  vel.set(0,0,0);
  vel.addScaledVector(dir, forward);
  vel.addScaledVector(right, strafe);
  if(vel.lengthSq()>0) vel.setLength(speed*dt);

  myPlayer.position.add(vel);

  // hop motion
  if (hopT > 0 && hopT <= 1){
    myPlayer.position.y = 0.9 + Math.sin(hopT * Math.PI) * 0.6;
    hopT += dt * 2; // hop lasts ~0.5s
    if (hopT > 1){ hopT = 0; myPlayer.position.y = 0.9; }
  }

  // clamp inside arena
  const r = 195;
  myPlayer.position.x = THREE.MathUtils.clamp(myPlayer.position.x, -r, r);
  myPlayer.position.z = THREE.MathUtils.clamp(myPlayer.position.z, -r, r);

  // camera follow
  const camTarget = myPlayer.position.clone().add(new THREE.Vector3(0,2.5,6).applyAxisAngle(new THREE.Vector3(0,1,0), myPlayer.rotation.y));
  camera.position.lerp(camTarget, 0.08);
  camera.lookAt(myPlayer.position.clone().add(new THREE.Vector3(0,1.2,0)));

  // update name tags
  otherPlayers.forEach((p)=>{
    const s = worldToScreen(p.mesh);
    p.tag.style.left = (s.x - 30) + 'px';
    p.tag.style.top  = (s.y - 48) + 'px';
    p.tag.style.opacity = (s.x>=0 && s.x<=window.innerWidth && s.y>=0 && s.y<=window.innerHeight)? '1':'0';
  });

  // send network updates @20Hz
  accumNet += dt;
  if(socket && socket.connected && accumNet > 0.05){
    accumNet = 0;
    socket.emit('move', {x: myPlayer.position.x, z: myPlayer.position.z, rotY: myPlayer.rotation.y});
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
