/* ═══════════════════════════════════════════════
   FACEATTEND — app.js  (v2 — fixed)
═══════════════════════════════════════════════ */

'use strict';

// ─── CONFIGURATION ───────────────────────────────────────────
const APP_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  FACE_THRESHOLD: 0.5,
  MODEL_URL: '/weights',
  GEO_ALLOWED_LAT: 30.0000,
  GEO_ALLOWED_LNG: 75.0000,
  GEO_RADIUS_METERS: 50,
  DETECTION_INTERVAL: 800,

  // SET TO false IN PRODUCTION — true bypasses geo check for testing
  GEO_BYPASS: true
};

// ─── STATE ───────────────────────────────────────────────────
const STATE = {
  modelsLoaded: false,
  tinyOptions: null,          // FIX: created AFTER models load
  knownUsers: [],
  capturedDescriptor: null,
  currentLat: null,
  currentLng: null,
  geoAllowed: false,
  detectionLoop: null,
  addDetectionLoop: null,
  addCurrentDescriptor: null,
  isProcessing: false,
  lastMatchedUser: null,
  punchButtonMode: 'IN'
};

// ─── DOM ─────────────────────────────────────────────────────
const $id = id => document.getElementById(id);

const DOM = {
  screens: {
    main:      $id('screen-main'),
    result:    $id('screen-result'),
    addUser:   $id('screen-add-user'),
    confirmed: $id('screen-user-added')
  },
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
  faceBox:         $id('face-box'),
  clock:           $id('clock'),
  resultIcon:      $id('result-icon'),
  resultName:      $id('result-name'),
  resultBadge:     $id('result-badge'),
  resultTime:      $id('result-time'),
  resultDate:      $id('result-date'),
  resultDistance:  $id('result-distance'),
  resultWorkhours:    $id('result-workhours'),
  resultWorkhoursRow: $id('result-workhours-row'),
  resultPunchin:      $id('result-punchin'),
  resultPunchinRow:   $id('result-punchin-row'),
  btnResultBack:   $id('btn-result-back'),
  videoAdd:        $id('video-add'),
  overlayAdd:      $id('overlay-canvas-add'),
  inputName:       $id('input-name'),
  captureStatus:   $id('capture-status'),
  btnCapture:      $id('btn-capture'),
  btnSaveUser:     $id('btn-save-user'),
  btnAddBack:      $id('btn-add-back'),
  addFaceInd:      $id('add-face-indicator'),
  confirmName:     $id('confirm-name'),
  btnConfirmBack:  $id('btn-confirm-back'),
  toast:           $id('toast')
};

// ─── SCREEN NAV ──────────────────────────────────────────────
function showScreen(name) {
  Object.entries(DOM.screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ─── TOAST ───────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type, duration) {
  type = type || '';
  duration = duration || 3500;
  DOM.toast.textContent = msg;
  DOM.toast.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { DOM.toast.classList.add('hidden'); }, duration);
}

// ─── CLOCK ───────────────────────────────────────────────────
function updateClock() {
  DOM.clock.textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
setInterval(updateClock, 1000);
updateClock();

// ─── GEOLOCATION ─────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startGeolocation() {
  if (APP_CONFIG.GEO_BYPASS) {
    STATE.currentLat = APP_CONFIG.GEO_ALLOWED_LAT;
    STATE.currentLng = APP_CONFIG.GEO_ALLOWED_LNG;
    STATE.geoAllowed = true;
    DOM.geoText.textContent = '✓ Location OK (test mode)';
    DOM.geoDot.className = 'geo-dot ok';
    return;
  }

  if (!navigator.geolocation) {
    DOM.geoText.textContent = 'Geolocation not supported';
    DOM.geoDot.className = 'geo-dot err';
    return;
  }

  function updateGeo(pos) {
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    STATE.currentLat = lat;
    STATE.currentLng = lng;
    var dist = haversineDistance(lat, lng, APP_CONFIG.GEO_ALLOWED_LAT, APP_CONFIG.GEO_ALLOWED_LNG);
    STATE.geoAllowed = dist <= APP_CONFIG.GEO_RADIUS_METERS;
    if (STATE.geoAllowed) {
      DOM.geoText.textContent = '✓ Within radius (' + Math.round(dist) + 'm)';
      DOM.geoDot.className = 'geo-dot ok';
    } else {
      DOM.geoText.textContent = '✗ ' + Math.round(dist) + 'm away (max: ' + APP_CONFIG.GEO_RADIUS_METERS + 'm)';
      DOM.geoDot.className = 'geo-dot err';
    }
  }

  function onError() {
    DOM.geoText.textContent = 'Location denied — attendance blocked';
    DOM.geoDot.className = 'geo-dot err';
    STATE.geoAllowed = false;
  }

  navigator.geolocation.getCurrentPosition(updateGeo, onError, { enableHighAccuracy: true });
  navigator.geolocation.watchPosition(updateGeo, onError, { enableHighAccuracy: true, maximumAge: 10000 });
}

// ─── CAMERA ──────────────────────────────────────────────────
function startCamera(videoEl) {
  return new Promise(function(resolve) {
    var constraints = {
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .catch(function() {
        // fallback: any camera
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      })
      .then(function(stream) {
        videoEl.srcObject = stream;
        videoEl.onloadedmetadata = function() {
          videoEl.play();
          resolve(true);
        };
        // timeout safety
        setTimeout(function() { resolve(true); }, 5000);
      })
      .catch(function(err) {
        console.error('Camera error:', err);
        resolve(false);
      });
  });
}

function stopCamera(videoEl) {
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(function(t) { t.stop(); });
    videoEl.srcObject = null;
  }
}

// ─── LOAD MODELS ─────────────────────────────────────────────
function loadModels() {
  DOM.modelStatusText.textContent = 'Loading models (1/3)…';

  return faceapi.nets.tinyFaceDetector.loadFromUri(APP_CONFIG.MODEL_URL)
    .then(function() {
      DOM.modelStatusText.textContent = 'Loading models (2/3)…';
      return faceapi.nets.faceLandmark68TinyNet.loadFromUri(APP_CONFIG.MODEL_URL);
    })
    .then(function() {
      DOM.modelStatusText.textContent = 'Loading models (3/3)…';
      return faceapi.nets.faceRecognitionNet.loadFromUri(APP_CONFIG.MODEL_URL);
    })
    .then(function() {
      // ✅ KEY FIX: TinyFaceDetectorOptions created AFTER models are loaded
      STATE.tinyOptions = new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.3
      });
      STATE.modelsLoaded = true;
      DOM.modelStatusText.textContent = '✓ AI Ready';
      DOM.modelRing.classList.add('done');
      DOM.modelStatus.classList.add('ready');
      DOM.btnPunch.disabled = false;
      setTimeout(function() { DOM.modelStatus.classList.add('hidden'); }, 2500);
      DOM.camStatus.textContent = 'Point camera at face';
      return true;
    })
    .catch(function(err) {
      console.error('Model load error:', err);
      DOM.modelStatusText.textContent = 'Load failed — check connection';
      showToast('AI models failed to load. Check internet.', 'error', 8000);
      return false;
    });
}

// ─── FACE DETECTION ──────────────────────────────────────────
function detectFace(videoEl, canvasEl, faceBoxEl, indicatorEl) {
  if (!STATE.modelsLoaded || !STATE.tinyOptions) return Promise.resolve(null);
  if (!videoEl || videoEl.paused || videoEl.ended || !videoEl.videoWidth) return Promise.resolve(null);

  var displaySize = { width: videoEl.videoWidth, height: videoEl.videoHeight };
  faceapi.matchDimensions(canvasEl, displaySize);

  return faceapi.detectSingleFace(videoEl, STATE.tinyOptions)
    .withFaceLandmarks(true)
    .withFaceDescriptor()
    .then(function(detection) {
      var ctx = canvasEl.getContext('2d');
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      if (detection) {
        var resized = faceapi.resizeResults(detection, displaySize);
        faceapi.draw.drawFaceLandmarks(canvasEl, resized, {
          drawLines: false,
          pointColor: 'rgba(79,142,247,0.6)',
          pointSize: 1.5
        });

        if (faceBoxEl) {
          var box = resized.detection.box;
          var rect = videoEl.getBoundingClientRect();
          var scaleX = rect.width / displaySize.width;
          var scaleY = rect.height / displaySize.height;
          faceBoxEl.style.left   = (box.x * scaleX) + 'px';
          faceBoxEl.style.top    = (box.y * scaleY) + 'px';
          faceBoxEl.style.width  = (box.width * scaleX) + 'px';
          faceBoxEl.style.height = (box.height * scaleY) + 'px';
          faceBoxEl.classList.remove('hidden');
        }
        if (indicatorEl) indicatorEl.classList.remove('hidden');

        return detection.descriptor;
      } else {
        if (faceBoxEl) faceBoxEl.classList.add('hidden');
        if (indicatorEl) indicatorEl.classList.add('hidden');
        return null;
      }
    })
    .catch(function() { return null; });
}

// ─── FACE MATCHING ───────────────────────────────────────────
function euclideanDistance(a, b) {
  var sum = 0;
  for (var i = 0; i < a.length; i++) sum += (a[i] - b[i]) * (a[i] - b[i]);
  return Math.sqrt(sum);
}

function matchFace(descriptor) {
  if (!STATE.knownUsers.length) return null;
  var bestMatch = null;
  var bestDist = Infinity;
  STATE.knownUsers.forEach(function(user) {
    var dist = euclideanDistance(descriptor, user.descriptor);
    if (dist < bestDist) { bestDist = dist; bestMatch = user; }
  });
  return bestDist <= APP_CONFIG.FACE_THRESHOLD ? { user: bestMatch, distance: bestDist } : null;
}

// ─── LOAD USERS FROM BACKEND ─────────────────────────────────
function loadUsers() {
  return fetch(APP_CONFIG.BACKEND_URL + '?action=getUsers')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.users) {
        STATE.knownUsers = data.users.map(function(u) {
          return { id: u.id, name: u.name, descriptor: new Float32Array(u.descriptor) };
        });
        DOM.camStatus.textContent = STATE.knownUsers.length > 0
          ? STATE.knownUsers.length + ' user(s) loaded — point camera at face'
          : 'No users yet — tap Add User first';
        console.log('[FaceAttend] ' + STATE.knownUsers.length + ' users loaded');
      }
    })
    .catch(function(err) {
      console.warn('Could not load users:', err.message);
      DOM.camStatus.textContent = 'Could not reach server — check BACKEND_URL';
    });
}

// ─── BACKEND API POST ────────────────────────────────────────
function apiPost(action, payload) {
  var body = Object.assign({ action: action }, payload);
  return fetch(APP_CONFIG.BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  }).then(function(res) { return res.json(); });
}

// ─── PUNCH BUTTON — update label based on today's record ─────
var punchCheckTimer = null;

function updatePunchButtonForUser(name) {
  if (punchCheckTimer) return; // throttle to once per 5s per user
  punchCheckTimer = setTimeout(function() { punchCheckTimer = null; }, 5000);

  fetch(APP_CONFIG.BACKEND_URL + '?action=getTodayAttendance&name=' + encodeURIComponent(name))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var label = DOM.btnPunch.querySelector('.btn-label');
      if (!data.found || !data.punchIn) {
        STATE.punchButtonMode = 'IN';
        label.textContent = 'PUNCH IN';
        DOM.btnPunch.style.background = 'linear-gradient(135deg, #22d47b, #1aaa62)';
        DOM.btnPunch.style.boxShadow = '0 4px 20px rgba(34,212,123,0.35)';
      } else if (data.punchIn && !data.punchOut) {
        STATE.punchButtonMode = 'OUT';
        label.textContent = 'PUNCH OUT';
        DOM.btnPunch.style.background = 'linear-gradient(135deg, #f74f4f, #c0392b)';
        DOM.btnPunch.style.boxShadow = '0 4px 20px rgba(247,79,79,0.35)';
      } else {
        STATE.punchButtonMode = 'DONE';
        label.textContent = 'DONE ✓';
        DOM.btnPunch.style.background = 'linear-gradient(135deg, #444, #222)';
        DOM.btnPunch.style.boxShadow = 'none';
      }
    })
    .catch(function() { /* silently ignore */ });
}

function resetPunchButton() {
  var label = DOM.btnPunch.querySelector('.btn-label');
  if (label) label.textContent = 'PUNCH';
  DOM.btnPunch.style.background = '';
  DOM.btnPunch.style.boxShadow = '';
  STATE.punchButtonMode = 'IN';
  STATE.lastMatchedUser = null;
}

// ─── MAIN DETECTION LOOP ─────────────────────────────────────
function startMainDetectionLoop() {
  if (STATE.detectionLoop) clearInterval(STATE.detectionLoop);

  STATE.detectionLoop = setInterval(function() {
    if (!STATE.modelsLoaded) return;

    detectFace(DOM.video, DOM.overlayCanvas, DOM.faceBox, null)
      .then(function(descriptor) {
        if (!descriptor) {
          if (STATE.lastMatchedUser) resetPunchButton();
          if (STATE.knownUsers.length > 0) DOM.camStatus.textContent = 'Point camera at face';
          return;
        }

        if (STATE.knownUsers.length === 0) {
          DOM.camStatus.textContent = 'No users registered — tap Add User';
          return;
        }

        var match = matchFace(descriptor);
        if (match) {
          STATE.lastMatchedUser = match.user;
          DOM.camStatus.textContent = '👤 ' + match.user.name + ' — tap PUNCH';
          updatePunchButtonForUser(match.user.name);
        } else {
          STATE.lastMatchedUser = null;
          DOM.camStatus.textContent = 'Face not recognized';
          resetPunchButton();
        }
      });
  }, APP_CONFIG.DETECTION_INTERVAL);
}

// ─── ADD USER DETECTION LOOP ─────────────────────────────────
function startAddDetectionLoop() {
  if (STATE.addDetectionLoop) clearInterval(STATE.addDetectionLoop);

  // ALWAYS enable capture button immediately - don't wait for detection
  DOM.btnCapture.disabled = false;
  DOM.btnCapture.style.opacity = '1';
  DOM.captureStatus.textContent = 'Look at camera and tap Capture Face';
  DOM.captureStatus.className = 'capture-status';

  // Background loop keeps descriptor fresh
  STATE.addDetectionLoop = setInterval(function() {
    if (!STATE.modelsLoaded) return;
    detectFace(DOM.videoAdd, DOM.overlayAdd, null, DOM.addFaceInd)
      .then(function(desc) {
        if (desc) {
          STATE.addCurrentDescriptor = desc;
          if (!STATE.capturedDescriptor) {
            DOM.captureStatus.textContent = 'Face detected - tap Capture Face!';
            DOM.captureStatus.className = 'capture-status ok';
          }
        }
      });
  }, APP_CONFIG.DETECTION_INTERVAL);
}

// ─── PUNCH HANDLER ───────────────────────────────────────────
function handlePunch() {
  if (STATE.isProcessing) return;
  if (!STATE.modelsLoaded) { showToast('AI still loading…', 'error'); return; }
  if (!STATE.geoAllowed) { showToast('Outside allowed location!', 'error', 4000); return; }

  if (STATE.punchButtonMode === 'DONE') {
    showToast('Already punched in & out today ✓', '', 4000);
    return;
  }

  STATE.isProcessing = true;
  DOM.btnPunch.disabled = true;
  DOM.btnPunch.querySelector('.btn-label').textContent = 'SCANNING…';

  detectFace(DOM.video, DOM.overlayCanvas, DOM.faceBox, null)
    .then(function(descriptor) {
      if (!descriptor) {
        showToast('No face detected — look at camera', 'error');
        STATE.isProcessing = false;
        DOM.btnPunch.disabled = false;
        resetPunchButton();
        return;
      }

      var match = matchFace(descriptor);
      if (!match) {
        showToast('Face not recognized — add user first', 'error', 4000);
        DOM.camStatus.textContent = 'Unknown face';
        STATE.isProcessing = false;
        DOM.btnPunch.disabled = false;
        resetPunchButton();
        return;
      }

      DOM.camStatus.textContent = 'Matched: ' + match.user.name + ' — saving…';

      return apiPost('markAttendance', {
        name: match.user.name,
        lat: STATE.currentLat,
        lng: STATE.currentLng
      }).then(function(result) {
        if (result.error) {
          if (result.alreadyDone) {
            showToast('Already done today: IN ' + result.punchIn + ' → OUT ' + result.punchOut, '', 5000);
          } else {
            showToast(result.error, 'error', 5000);
          }
          return;
        }
        punchCheckTimer = null; // force refresh on next detection
        showResultScreen(result, match.user.name);
      });
    })
    .catch(function(err) {
      console.error(err);
      showToast('Network error — check connection', 'error');
    })
    .finally(function() {
      STATE.isProcessing = false;
      DOM.btnPunch.disabled = false;
    });
}

// ─── RESULT SCREEN ───────────────────────────────────────────
function showResultScreen(result, name) {
  var isIn = result.type === 'IN';
  DOM.resultIcon.textContent = isIn ? '🟢' : '🔴';
  DOM.resultName.textContent = result.name || name;
  DOM.resultBadge.textContent = isIn ? '✓ PUNCH IN' : '✓ PUNCH OUT';
  DOM.resultBadge.className = 'result-badge ' + (isIn ? 'in' : 'out');
  DOM.resultTime.textContent = result.time || '—';
  DOM.resultDate.textContent = result.date || new Date().toLocaleDateString();
  DOM.resultDistance.textContent = (result.distance || 0) + 'm from office';

  if (!isIn && result.workingHours) {
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

// ─── OPEN ADD USER SCREEN ────────────────────────────────────
function openAddUser() {
  STATE.capturedDescriptor = null;
  STATE.addCurrentDescriptor = null;
  DOM.inputName.value = '';
  DOM.captureStatus.textContent = 'Position your face in the frame';
  DOM.captureStatus.className = 'capture-status';
  DOM.btnCapture.disabled = true;
  DOM.btnCapture.style.opacity = '0.4';
  DOM.btnCapture.innerHTML = '<span class="btn-icon">◎</span> Capture Face';
  DOM.btnSaveUser.disabled = true;

  showScreen('addUser');

  // Small delay for screen transition
  setTimeout(function() {
    startCamera(DOM.videoAdd).then(function(ok) {
      if (!ok) {
        DOM.captureStatus.textContent = '✗ Camera access denied';
        DOM.captureStatus.className = 'capture-status err';
        showToast('Camera permission denied', 'error');
        return;
      }
      // Wait for video stream
      setTimeout(function() {
        startAddDetectionLoop();
      }, 600);
    });
  }, 300);
}

// ─── CAPTURE FACE BUTTON ─────────────────────────────────────
function handleCaptureFace() {
  DOM.captureStatus.textContent = 'Capturing…';
  DOM.captureStatus.className = 'capture-status';
  DOM.btnCapture.disabled = true;

  // Try background descriptor first, then do fresh detections
  if (STATE.addCurrentDescriptor) {
    saveCapturedFace(STATE.addCurrentDescriptor);
    return;
  }

  // Do 3 attempts with small delays for slow phones
  var attempts = 0;
  function tryDetect() {
    attempts++;
    detectFace(DOM.videoAdd, DOM.overlayAdd, null, DOM.addFaceInd)
      .then(function(desc) {
        if (desc) {
          saveCapturedFace(desc);
        } else if (attempts < 3) {
          DOM.captureStatus.textContent = 'Detecting… attempt ' + attempts + '/3';
          setTimeout(tryDetect, 800);
        } else {
          // Last resort: save without descriptor (will fail at save stage with clear message)
          showToast('Could not detect face. Move closer, improve lighting, try removing hat briefly.', 'error', 6000);
          DOM.captureStatus.textContent = 'Face not detected - check lighting';
          DOM.captureStatus.className = 'capture-status err';
          DOM.btnCapture.disabled = false;
        }
      });
  }
  tryDetect();
}

function saveCapturedFace(desc) {
  STATE.capturedDescriptor = desc;
  DOM.captureStatus.textContent = '✓ Face captured! Enter name and save.';
  DOM.captureStatus.className = 'capture-status ok';
  DOM.btnCapture.innerHTML = '<span class="btn-icon">↺</span> Recapture';
  DOM.btnCapture.style.opacity = '1';
  DOM.btnCapture.disabled = false;
  if (DOM.inputName.value.trim()) {
    DOM.btnSaveUser.disabled = false;
  }
}

// ─── SAVE USER ───────────────────────────────────────────────
function handleSaveUser() {
  var name = DOM.inputName.value.trim();
  if (!name) { showToast('Enter a name first', 'error'); DOM.inputName.focus(); return; }
  if (!STATE.capturedDescriptor) { showToast('Capture face first', 'error'); return; }

  DOM.btnSaveUser.disabled = true;
  DOM.btnSaveUser.innerHTML = '<span class="btn-icon">↻</span> Saving…';

  apiPost('addUser', { name: name, descriptor: Array.from(STATE.capturedDescriptor) })
    .then(function(result) {
      if (result.error) {
        showToast(result.error, 'error');
        DOM.btnSaveUser.disabled = false;
        DOM.btnSaveUser.innerHTML = '<span class="btn-icon">✓</span> Save User';
        return;
      }
      clearInterval(STATE.addDetectionLoop);
      stopCamera(DOM.videoAdd);
      return loadUsers().then(function() {
        DOM.confirmName.textContent = name;
        showScreen('confirmed');
      });
    })
    .catch(function() {
      showToast('Network error — check connection', 'error');
      DOM.btnSaveUser.disabled = false;
      DOM.btnSaveUser.innerHTML = '<span class="btn-icon">✓</span> Save User';
    });
}

function handleAddBack() {
  clearInterval(STATE.addDetectionLoop);
  stopCamera(DOM.videoAdd);
  STATE.capturedDescriptor = null;
  showScreen('main');
}

// ─── INPUT LISTENER ──────────────────────────────────────────
DOM.inputName.addEventListener('input', function() {
  DOM.btnSaveUser.disabled = !(DOM.inputName.value.trim() && STATE.capturedDescriptor);
});

// ─── BUTTON BINDINGS ─────────────────────────────────────────
DOM.btnPunch.addEventListener('click', handlePunch);
DOM.btnAddUser.addEventListener('click', openAddUser);
DOM.btnResultBack.addEventListener('click', function() { resetPunchButton(); showScreen('main'); });
DOM.btnAddBack.addEventListener('click', handleAddBack);
DOM.btnCapture.addEventListener('click', handleCaptureFace);
DOM.btnSaveUser.addEventListener('click', handleSaveUser);
DOM.btnConfirmBack.addEventListener('click', function() { showScreen('main'); });

// ─── INIT ────────────────────────────────────────────────────
function init() {
  showScreen('main');
  startGeolocation();

  DOM.camStatus.textContent = 'Starting camera…';
  startCamera(DOM.video).then(function(camOk) {
    if (!camOk) {
      DOM.camStatus.textContent = '✗ Camera error — allow camera permission';
      showToast('Allow camera access to use this app', 'error', 8000);
      return;
    }
    DOM.camStatus.textContent = 'Camera ready — loading AI models…';

    loadModels().then(function(ok) {
      if (!ok) return;
      startMainDetectionLoop();
      loadUsers();
    });
  });
}

// Wait for face-api.js CDN to load
function waitForFaceApi() {
  if (typeof faceapi !== 'undefined' && faceapi.nets) {
    init();
  } else {
    setTimeout(waitForFaceApi, 250);
  }
}

waitForFaceApi();
