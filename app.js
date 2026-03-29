/* ═══════════════════════════════════════════════
   FACEATTEND — app.js
   Complete Vanilla JS Frontend
═══════════════════════════════════════════════ */

'use strict';

// ─── CONFIGURATION ───────────────────────────────────────────
const APP_CONFIG = {
  // ⚠️ Replace with your deployed Google Apps Script Web App URL
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyr671rirHipJsIg8UqC0FOHpARher_9-k6KqtwEYVwgMNVdy4yowDFDVBVqfUYFCM/exec',

  // Face recognition threshold (lower = stricter)
  FACE_THRESHOLD: 0.5,

  // CDN base for face-api models
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights',

  // Geolocation settings
  GEO_ALLOWED_LAT: 30.0000,   // ← Change to your office latitude
  GEO_ALLOWED_LNG: 75.0000,   // ← Change to your office longitude
  GEO_RADIUS_METERS: 50,

  // Detection interval (ms)
  DETECTION_INTERVAL: 600
};

// ─── STATE ───────────────────────────────────────────────────
const STATE = {
  modelsLoaded: false,
  knownUsers: [],
  capturedDescriptor: null,
  currentLat: null,
  currentLng: null,
  geoAllowed: false,
  detectionLoop: null,
  addDetectionLoop: null,
  addFaceDetected: false,
  addCurrentDescriptor: null,
  isProcessing: false
};

// ─── DOM REFS ────────────────────────────────────────────────
const $id = id => document.getElementById(id);

const DOM = {
  screens: {
    main:      $id('screen-main'),
    result:    $id('screen-result'),
    addUser:   $id('screen-add-user'),
    confirmed: $id('screen-user-added')
  },
  // Main
  video:           $id('video'),
  overlayCanvas:   $id('overlay-canvas'),
  camStatus:       $id('cam-status'),
  modelStatus:     $id('model-status'),
  modelStatusText: $id('model-status-text'),
  modelRing:       document.querySelector('#model-status .loader-ring'),
  btnPunch:        $id('btn-punch'),
  btnAddUser:      $id('btn-add-user'),
  geoText:         $id('geo-text'),
  geoDot:          document.querySelector('.geo-dot'),
  scanLine:        $id('scan-line'),
  faceBox:         $id('face-box'),
  clock:           $id('clock'),
  // Result
  resultIcon:      $id('result-icon'),
  resultName:      $id('result-name'),
  resultBadge:     $id('result-badge'),
  resultTime:      $id('result-time'),
  resultDate:      $id('result-date'),
  resultDistance:  $id('result-distance'),
  resultWorkhours:     $id('result-workhours'),
  resultWorkhoursRow:  $id('result-workhours-row'),
  resultPunchin:       $id('result-punchin'),
  resultPunchinRow:    $id('result-punchin-row'),
  btnResultBack:   $id('btn-result-back'),
  // Add User
  videoAdd:        $id('video-add'),
  overlayAdd:      $id('overlay-canvas-add'),
  inputName:       $id('input-name'),
  captureStatus:   $id('capture-status'),
  btnCapture:      $id('btn-capture'),
  btnSaveUser:     $id('btn-save-user'),
  btnAddBack:      $id('btn-add-back'),
  addFaceInd:      $id('add-face-indicator'),
  // Confirmed
  confirmName:     $id('confirm-name'),
  btnConfirmBack:  $id('btn-confirm-back'),
  // Toast
  toast:           $id('toast')
};

// ─── SCREEN NAVIGATION ───────────────────────────────────────
function showScreen(name) {
  Object.entries(DOM.screens).forEach(([key, el]) => {
    if (key === name) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// ─── TOAST ───────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '', duration = 3200) {
  DOM.toast.textContent = msg;
  DOM.toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    DOM.toast.classList.add('hidden');
  }, duration);
}

// ─── CLOCK ───────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  DOM.clock.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ─── GEOLOCATION ─────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startGeolocation() {
  if (!navigator.geolocation) {
    DOM.geoText.textContent = 'Geolocation not supported';
    DOM.geoDot.className = 'geo-dot err';
    return;
  }

  const updateGeo = (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    STATE.currentLat = lat;
    STATE.currentLng = lng;
    const dist = haversineDistance(lat, lng, APP_CONFIG.GEO_ALLOWED_LAT, APP_CONFIG.GEO_ALLOWED_LNG);
    STATE.geoAllowed = dist <= APP_CONFIG.GEO_RADIUS_METERS;

    if (STATE.geoAllowed) {
      DOM.geoText.textContent = `✓ Within radius (${Math.round(dist)}m away)`;
      DOM.geoDot.className = 'geo-dot ok';
    } else {
      DOM.geoText.textContent = `✗ ${Math.round(dist)}m away (limit: ${APP_CONFIG.GEO_RADIUS_METERS}m)`;
      DOM.geoDot.className = 'geo-dot err';
    }
  };

  const onError = (e) => {
    DOM.geoText.textContent = 'Location denied — attendance blocked';
    DOM.geoDot.className = 'geo-dot err';
    STATE.geoAllowed = false;
  };

  navigator.geolocation.getCurrentPosition(updateGeo, onError, { enableHighAccuracy: true });
  navigator.geolocation.watchPosition(updateGeo, onError, { enableHighAccuracy: true, maximumAge: 10000 });
}

// ─── CAMERA ──────────────────────────────────────────────────
async function startCamera(videoEl, facingMode = 'user') {
  try {
    const constraints = {
      video: {
        facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await new Promise(res => videoEl.onloadedmetadata = res);
    videoEl.play();
    return true;
  } catch (err) {
    console.error('Camera error:', err);
    return false;
  }
}

function stopCamera(videoEl) {
  const stream = videoEl.srcObject;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
}

// ─── FACE-API MODELS ─────────────────────────────────────────
async function loadModels() {
  DOM.modelStatusText.textContent = 'Loading models (1/3)…';
  try {
    // Load only necessary models
    await faceapi.nets.tinyFaceDetector.loadFromUri(APP_CONFIG.MODEL_URL);
    DOM.modelStatusText.textContent = 'Loading models (2/3)…';
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(APP_CONFIG.MODEL_URL);
    DOM.modelStatusText.textContent = 'Loading models (3/3)…';
    await faceapi.nets.faceRecognitionNet.loadFromUri(APP_CONFIG.MODEL_URL);

    STATE.modelsLoaded = true;
    DOM.modelStatusText.textContent = 'AI Ready';
    DOM.modelRing.classList.add('done');
    DOM.modelStatus.classList.add('ready');
    DOM.btnPunch.disabled = false;
    setTimeout(() => DOM.modelStatus.classList.add('hidden'), 2500);

    DOM.camStatus.textContent = 'Point camera at face';
    return true;
  } catch (err) {
    console.error('Model load error:', err);
    DOM.modelStatusText.textContent = 'Model load failed — retry';
    showToast('Failed to load AI models. Check connection.', 'error', 6000);
    return false;
  }
}

// ─── FACE DETECTION LOOP ─────────────────────────────────────
const TINY_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

async function detectFaceOnCanvas(videoEl, canvasEl, faceBoxEl, indicatorEl) {
  if (videoEl.paused || videoEl.ended) return null;

  // Sync canvas size
  const displaySize = { width: videoEl.videoWidth, height: videoEl.videoHeight };
  if (!displaySize.width) return null;
  faceapi.matchDimensions(canvasEl, displaySize);

  const detection = await faceapi
    .detectSingleFace(videoEl, TINY_OPTIONS)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (detection) {
    const resized = faceapi.resizeResults(detection, displaySize);

    // Draw a subtle landmark overlay
    faceapi.draw.drawFaceLandmarks(canvasEl, resized, { drawLines: false, lineColor: 'rgba(79,142,247,0.3)', pointColor: 'rgba(79,142,247,0.5)', pointSize: 1.5 });

    // Show face box overlay
    if (faceBoxEl) {
      const box = resized.detection.box;
      const rect = videoEl.getBoundingClientRect();
      const scaleX = rect.width / displaySize.width;
      const scaleY = rect.height / displaySize.height;

      faceBoxEl.style.left = (box.x * scaleX) + 'px';
      faceBoxEl.style.top = (box.y * scaleY) + 'px';
      faceBoxEl.style.width = (box.width * scaleX) + 'px';
      faceBoxEl.style.height = (box.height * scaleY) + 'px';
      faceBoxEl.classList.remove('hidden');
    }

    if (indicatorEl) indicatorEl.classList.remove('hidden');
  } else {
    if (faceBoxEl) faceBoxEl.classList.add('hidden');
    if (indicatorEl) indicatorEl.classList.add('hidden');
  }

  return detection ? detection.descriptor : null;
}

function startMainDetectionLoop() {
  if (STATE.detectionLoop) clearInterval(STATE.detectionLoop);
  STATE.detectionLoop = setInterval(async () => {
    if (!STATE.modelsLoaded) return;
    await detectFaceOnCanvas(DOM.video, DOM.overlayCanvas, DOM.faceBox, null);
  }, APP_CONFIG.DETECTION_INTERVAL);
}

function startAddDetectionLoop() {
  if (STATE.addDetectionLoop) clearInterval(STATE.addDetectionLoop);
  STATE.addDetectionLoop = setInterval(async () => {
    if (!STATE.modelsLoaded) return;
    const desc = await detectFaceOnCanvas(DOM.videoAdd, DOM.overlayAdd, null, DOM.addFaceInd);
    STATE.addCurrentDescriptor = desc;
    STATE.addFaceDetected = !!desc;
    DOM.btnCapture.disabled = !STATE.addFaceDetected;
  }, APP_CONFIG.DETECTION_INTERVAL);
}

// ─── LOAD USERS FROM BACKEND ─────────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch(`${APP_CONFIG.BACKEND_URL}?action=getUsers`);
    const data = await res.json();
    if (data.users) {
      STATE.knownUsers = data.users.map(u => ({
        ...u,
        descriptor: new Float32Array(u.descriptor)
      }));
      console.log(`[FaceAttend] Loaded ${STATE.knownUsers.length} users`);
    }
  } catch (err) {
    console.error('Failed to load users:', err);
    showToast('Could not load user database', 'error');
  }
}

// ─── FACE MATCHING ───────────────────────────────────────────
function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function matchFace(descriptor) {
  if (!STATE.knownUsers.length) return null;

  let bestMatch = null;
  let bestDist = Infinity;

  STATE.knownUsers.forEach(user => {
    const dist = euclideanDistance(descriptor, user.descriptor);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = user;
    }
  });

  if (bestDist <= APP_CONFIG.FACE_THRESHOLD) {
    return { user: bestMatch, distance: bestDist };
  }
  return null;
}

// ─── BACKEND API ─────────────────────────────────────────────
async function apiPost(action, payload) {
  const res = await fetch(APP_CONFIG.BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // GAS requires text/plain for POST CORS
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

// ─── PUNCH ACTION ─────────────────────────────────────────────
async function handlePunch() {
  if (STATE.isProcessing) return;
  if (!STATE.modelsLoaded) {
    showToast('AI models still loading…', 'error');
    return;
  }

  // Geo check first
  if (STATE.currentLat === null) {
    showToast('Waiting for location…', 'error');
    return;
  }
  if (!STATE.geoAllowed) {
    showToast('You are outside the allowed radius!', 'error', 4000);
    return;
  }

  STATE.isProcessing = true;
  DOM.btnPunch.disabled = true;
  DOM.btnPunch.querySelector('.btn-label').textContent = 'SCANNING…';

  try {
    // Capture descriptor
    const descriptor = await detectFaceOnCanvas(DOM.video, DOM.overlayCanvas, DOM.faceBox, null);

    if (!descriptor) {
      showToast('No face detected — look at camera', 'error');
      return;
    }

    // Match against known users
    const match = matchFace(descriptor);
    if (!match) {
      showToast('Face not recognized. Register first.', 'error', 4000);
      return;
    }

    DOM.camStatus.textContent = `Matched: ${match.user.name}`;

    // Call backend
    const result = await apiPost('markAttendance', {
      name: match.user.name,
      lat: STATE.currentLat,
      lng: STATE.currentLng
    });

    if (result.error) {
      if (result.alreadyDone) {
        showToast(`Already punched in & out today (${result.punchIn} → ${result.punchOut})`, 'error', 5000);
      } else if (result.outsideRadius) {
        showToast(result.error, 'error', 5000);
      } else {
        showToast(result.error, 'error');
      }
      return;
    }

    // Show result screen
    showResultScreen(result, match.user.name);

  } catch (err) {
    console.error('Punch error:', err);
    showToast('Network error — please retry', 'error');
  } finally {
    STATE.isProcessing = false;
    DOM.btnPunch.disabled = false;
    DOM.btnPunch.querySelector('.btn-label').textContent = 'PUNCH';
  }
}

// ─── RESULT SCREEN ───────────────────────────────────────────
function showResultScreen(result, name) {
  const isPunchIn = result.type === 'IN';
  DOM.resultIcon.textContent = isPunchIn ? '🟢' : '🔴';
  DOM.resultName.textContent = result.name || name;

  DOM.resultBadge.textContent = isPunchIn ? 'PUNCH IN' : 'PUNCH OUT';
  DOM.resultBadge.className = `result-badge ${isPunchIn ? 'in' : 'out'}`;

  DOM.resultTime.textContent = result.time || '—';
  DOM.resultDate.textContent = result.date || new Date().toLocaleDateString();
  DOM.resultDistance.textContent = `${result.distance || 0}m from office`;

  if (!isPunchIn && result.workingHours) {
    DOM.resultWorkhoursRow.classList.remove('hidden');
    DOM.resultWorkhours.textContent = result.workingHours;
    DOM.resultPunchinRow.classList.remove('hidden');
    DOM.resultPunchin.textContent = result.punchIn || '—';
  } else {
    DOM.resultWorkhoursRow.classList.add('hidden');
    DOM.resultPunchinRow.classList.add('hidden');
  }

  showScreen('result');
}

// ─── ADD USER FLOW ───────────────────────────────────────────
async function openAddUser() {
  STATE.capturedDescriptor = null;
  DOM.inputName.value = '';
  DOM.captureStatus.textContent = '';
  DOM.captureStatus.className = 'capture-status';
  DOM.btnCapture.disabled = true;
  DOM.btnSaveUser.disabled = true;

  showScreen('addUser');

  const ok = await startCamera(DOM.videoAdd);
  if (!ok) {
    DOM.captureStatus.textContent = 'Camera access denied';
    DOM.captureStatus.className = 'capture-status err';
    return;
  }

  startAddDetectionLoop();
}

async function handleCaptureFace() {
  if (!STATE.addCurrentDescriptor) {
    showToast('No face in frame', 'error');
    return;
  }

  STATE.capturedDescriptor = STATE.addCurrentDescriptor;
  DOM.captureStatus.textContent = '✓ Face captured successfully';
  DOM.captureStatus.className = 'capture-status ok';
  DOM.btnCapture.textContent = '◎ Recapture';

  // Enable save if name is also filled
  if (DOM.inputName.value.trim()) {
    DOM.btnSaveUser.disabled = false;
  }
}

async function handleSaveUser() {
  const name = DOM.inputName.value.trim();
  if (!name) {
    showToast('Please enter a name', 'error');
    DOM.inputName.focus();
    return;
  }
  if (!STATE.capturedDescriptor) {
    showToast('Please capture face first', 'error');
    return;
  }

  DOM.btnSaveUser.disabled = true;
  DOM.btnSaveUser.querySelector('.btn-label') && (DOM.btnSaveUser.innerHTML = '<span class="btn-icon">↻</span> Saving…');

  try {
    const result = await apiPost('addUser', {
      name,
      descriptor: Array.from(STATE.capturedDescriptor)
    });

    if (result.error) {
      showToast(result.error, 'error');
      DOM.btnSaveUser.disabled = false;
      DOM.btnSaveUser.innerHTML = '<span class="btn-icon">✓</span> Save User';
      return;
    }

    // Stop add camera
    clearInterval(STATE.addDetectionLoop);
    stopCamera(DOM.videoAdd);

    // Reload users list
    await loadUsers();

    // Show confirmation
    DOM.confirmName.textContent = name;
    showScreen('confirmed');

  } catch (err) {
    console.error('Save user error:', err);
    showToast('Network error saving user', 'error');
    DOM.btnSaveUser.disabled = false;
    DOM.btnSaveUser.innerHTML = '<span class="btn-icon">✓</span> Save User';
  }
}

function handleAddBack() {
  clearInterval(STATE.addDetectionLoop);
  stopCamera(DOM.videoAdd);
  STATE.capturedDescriptor = null;
  showScreen('main');
}

// ─── INPUT LISTENERS ─────────────────────────────────────────
DOM.inputName.addEventListener('input', () => {
  const hasName = DOM.inputName.value.trim().length > 0;
  const hasFace = !!STATE.capturedDescriptor;
  DOM.btnSaveUser.disabled = !(hasName && hasFace);
});

// ─── EVENT BINDINGS ───────────────────────────────────────────
DOM.btnPunch.addEventListener('click', handlePunch);
DOM.btnAddUser.addEventListener('click', openAddUser);
DOM.btnResultBack.addEventListener('click', () => showScreen('main'));
DOM.btnAddBack.addEventListener('click', handleAddBack);
DOM.btnCapture.addEventListener('click', handleCaptureFace);
DOM.btnSaveUser.addEventListener('click', handleSaveUser);
DOM.btnConfirmBack.addEventListener('click', () => showScreen('main'));

// ─── INIT ─────────────────────────────────────────────────────
async function init() {
  showScreen('main');
  startGeolocation();

  // Start main camera
  const camOk = await startCamera(DOM.video);
  DOM.camStatus.textContent = camOk ? 'Camera ready' : 'Camera error — check permissions';

  // Load face-api models
  const modelsOk = await loadModels();
  if (!modelsOk) return;

  // Start detection loop
  startMainDetectionLoop();

  // Load registered users
  await loadUsers();
}

// Wait for face-api to be available
function waitForFaceApi() {
  if (typeof faceapi !== 'undefined') {
    init();
  } else {
    setTimeout(waitForFaceApi, 200);
  }
}

waitForFaceApi();
