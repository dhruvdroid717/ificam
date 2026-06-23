const statusText = document.getElementById('statusText');
const dot = document.getElementById('dot');
const overlay = document.getElementById('overlay');
const stage = document.getElementById('stage');
const preview = document.getElementById('preview');
const startBtn = document.getElementById('startBtn');
const pinField = document.getElementById('pinField');
const pinInput = document.getElementById('pinInput');
const phoneControls = document.getElementById('phoneControls');
const recordBtn = document.getElementById('recordBtn');
const recordTimer = document.getElementById('recordTimer');
const flipBtn = document.getElementById('flipBtn');
const zoomButtons = Array.from(document.querySelectorAll('.zoom'));
const focusRing = document.getElementById('focusRing');
const phoneStats = document.getElementById('phoneStats');
const resolutionValue = document.getElementById('resolutionValue');
const latencyValue = document.getElementById('latencyValue');
const miniAudioBars = Array.from(document.querySelectorAll('#miniAudio i'));

const VIDEO_BITRATE = 8_000_000;
const ZOOM_LEVELS = [0.5, 1, 2, 3];

let ws = null;
let pc = null;
let localStream = null;
let videoSender = null;
let pcPresent = false;
let started = false;
let offering = false;
let reconnectTimer = null;
let pin = '';
let facingMode = 'environment';
let recording = false;
let recordingStartedAt = 0;
let recordingTimer = null;
let currentZoom = 1;
let statsTimer = null;
let audioContext = null;
let audioAnalyser = null;
let audioData = null;
let audioFrame = null;
let savedStateTimer = null;

const hashPin = new URLSearchParams(location.hash.slice(1)).get('pin');
if (hashPin && /^\d{4}$/.test(hashPin)) {
  pinInput.value = hashPin;
  pinField.classList.add('hidden');
}

function orientation() {
  return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
}

function setStatus(text, state) {
  statusText.textContent = text;
  dot.className = 'dot' + (state ? ' ' + state : '');
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendPhoneState() {
  send({ type: 'phone-state', orientation: orientation(), facing: facingMode, zoom: currentZoom });
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateRecordingTimer() {
  if (!recordingStartedAt) {
    recordTimer.textContent = '00:00';
    return;
  }
  recordTimer.textContent = formatElapsed(Math.floor((Date.now() - recordingStartedAt) / 1000));
}

function startRecordingTimer() {
  recordingStartedAt = Date.now();
  updateRecordingTimer();
  recordTimer.classList.remove('hidden');
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = setInterval(updateRecordingTimer, 500);
}

function stopRecordingTimer() {
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = null;
}

function resetRecordingTimer() {
  stopRecordingTimer();
  recordingStartedAt = 0;
  recordTimer.textContent = '00:00';
  recordTimer.classList.add('hidden');
}

function setRecordingState(next) {
  window.clearTimeout(savedStateTimer);
  recording = next;
  setRecordButtonText(recording ? 'Stop recording' : 'Start recording');
  recordBtn.classList.toggle('active', recording);
  recordBtn.classList.remove('saving', 'saved');
  recordBtn.disabled = false;
  if (recording) {
    startRecordingTimer();
    setStatus('REC - recording on PC', 'rec');
  } else {
    resetRecordingTimer();
    if (started && pc && pc.connectionState === 'connected') setStatus('Live - streaming to PC', 'live');
  }
}

function setSavingState() {
  recording = false;
  stopRecordingTimer();
  recordBtn.disabled = true;
  recordBtn.classList.remove('active', 'saved');
  recordBtn.classList.add('saving');
  setRecordButtonText('Saving video');
  setStatus('Saving recording...', 'warn');
}

function setSavedState() {
  recording = false;
  stopRecordingTimer();
  recordBtn.disabled = true;
  recordBtn.classList.remove('active', 'saving');
  recordBtn.classList.add('saved');
  setRecordButtonText('Saved');
  setStatus('Recording saved ✓', 'live');
  window.clearTimeout(savedStateTimer);
  savedStateTimer = window.setTimeout(() => {
    recordBtn.classList.remove('saved');
    recordBtn.disabled = false;
    setRecordButtonText('Start recording');
    resetRecordingTimer();
    if (started && pc && pc.connectionState === 'connected') setStatus('Live - streaming to PC', 'live');
  }, 1500);
}

function setRecordButtonText(text) {
  const label = recordBtn.querySelector('.record-label');
  if (label) label.textContent = text;
}

function updateResolutionValue() {
  const track = getVideoTrack();
  const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
  const width = settings.width || preview.videoWidth;
  const height = settings.height || preview.videoHeight;
  resolutionValue.textContent = width && height ? `${width}x${height}` : '--';
}

async function updateConnectionStats() {
  updateResolutionValue();
  if (!pc || pc.connectionState !== 'connected') {
    latencyValue.textContent = '--';
    return;
  }
  try {
    const report = await pc.getStats();
    let rtt = null;
    report.forEach((entry) => {
      if (entry.type === 'candidate-pair' && (entry.nominated || entry.selected) && typeof entry.currentRoundTripTime === 'number') {
        rtt = Math.round(entry.currentRoundTripTime * 1000);
      }
    });
    latencyValue.textContent = rtt === null ? '--' : String(rtt);
  } catch {
    latencyValue.textContent = '--';
  }
}

function startStats() {
  phoneStats.classList.remove('hidden');
  updateConnectionStats();
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = setInterval(updateConnectionStats, 1000);
}

function startAudioMeter() {
  const audioTrack = localStream && localStream.getAudioTracks()[0];
  if (!audioTrack || audioAnalyser) return;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioData = new Uint8Array(audioAnalyser.frequencyBinCount);
    audioContext.createMediaStreamSource(new MediaStream([audioTrack])).connect(audioAnalyser);
  } catch {
    return;
  }

  const paint = () => {
    if (!audioAnalyser || !audioData) return;
    audioAnalyser.getByteFrequencyData(audioData);
    const level = audioData.reduce((sum, value) => sum + value, 0) / audioData.length / 255;
    miniAudioBars.forEach((bar, index) => {
      const active = level > (index + 1) * 0.08;
      bar.style.height = `${7 + Math.min(22, level * 34 * (index + 1) * 0.42)}px`;
      bar.style.background = active ? 'rgba(103, 232, 249, 0.9)' : 'rgba(255, 255, 255, 0.22)';
    });
    audioFrame = requestAnimationFrame(paint);
  };
  paint();
}

function connect() {
  ws = new WebSocket(`wss://${location.host}/ws`);
  ws.onopen = () => {
    send({ type: 'hello', role: 'phone', pin });
    sendPhoneState();
  };
  ws.onmessage = (event) => handleMessage(event.data);
  ws.onclose = () => {
    pcPresent = false;
    setStatus('Reconnecting...', 'warn');
    reconnectTimer = setTimeout(connect, 1500);
  };
  ws.onerror = () => ws && ws.close();
}

async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  switch (message.type) {
    case 'error':
      if (message.reason === 'bad-pin') {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
        started = false;
        pinField.classList.remove('hidden');
        startBtn.classList.remove('hidden');
        startBtn.disabled = false;
        startBtn.textContent = 'Start streaming';
        setStatus('Wrong PIN - check the PC', 'error');
      }
      break;
    case 'peers':
      pcPresent = Boolean(message.pc);
      if (started && pcPresent) {
        maybeOffer();
      } else if (!pcPresent) {
        setStatus(started ? 'Waiting for PC...' : 'Tap start to connect', 'warn');
      }
      break;
    case 'answer':
      if (pc && message.answer) {
        await pc.setRemoteDescription(message.answer);
      }
      break;
    case 'ice':
      if (pc && message.candidate) {
        try {
          await pc.addIceCandidate(message.candidate);
        } catch {}
      }
      break;
    case 'cmd':
      if (message.action === 'record.started') setRecordingState(true);
      if (message.action === 'record.saving') setSavingState();
      if (message.action === 'record.stopped') setSavedState();
      break;
  }
}

async function getCameraStream() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: true,
  });
}

async function getVideoStream() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

async function startCamera() {
  const entered = (pinInput.value || '').trim();
  if (!/^\d{4}$/.test(entered)) {
    pinField.classList.remove('hidden');
    setStatus('Enter the 4-digit PIN', 'error');
    pinInput.focus();
    return;
  }
  pin = entered;

  startBtn.disabled = true;
  setStatus('Requesting camera...', 'warn');
  try {
    localStream = await getCameraStream();
  } catch {
    setStatus('Camera/mic blocked', 'error');
    startBtn.disabled = false;
    startBtn.textContent = 'Retry';
    return;
  }

  preview.srcObject = localStream;
  overlay.classList.add('hidden');
  startBtn.classList.add('hidden');
  pinField.classList.add('hidden');
  phoneControls.classList.remove('hidden');
  started = true;
  setStatus('Pairing...', 'warn');
  updateZoomButtons();
  updateResolutionValue();
  startStats();
  startAudioMeter();

  connect();
}

function maybeOffer() {
  if (!started || !pcPresent || offering) return;
  if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) return;
  void createOffer();
}

async function createOffer() {
  offering = true;
  setStatus('Connecting...', 'warn');

  if (pc) {
    pc.close();
    pc = null;
  }

  pc = new RTCPeerConnection({ iceServers: [] });
  videoSender = null;

  for (const track of localStream.getTracks()) {
    const sender = pc.addTrack(track, localStream);
    if (track.kind === 'video') videoSender = sender;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) videoTrack.contentHint = 'motion';

  preferH264(pc);
  tuneVideoSender(pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      send({ type: 'ice', candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      setStatus(recording ? 'REC - recording on PC' : 'Live - streaming to PC', recording ? 'rec' : 'live');
      sendPhoneState();
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setStatus('Reconnecting...', 'warn');
      offering = false;
      maybeOffer();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'offer', offer });
  offering = false;
}

function preferH264(peer) {
  if (typeof RTCRtpSender.getCapabilities !== 'function') return;
  const caps = RTCRtpSender.getCapabilities('video');
  if (!caps) return;
  const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === 'video') {
      try {
        transceiver.setCodecPreferences([...h264, ...rest]);
      } catch {}
    }
  }
}

async function tuneVideoSender(peer) {
  const sender = peer.getSenders().find((s) => s.track && s.track.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = VIDEO_BITRATE;
  params.encodings[0].maxFramerate = 30;
  params.degradationPreference = 'maintain-framerate';
  try {
    await sender.setParameters(params);
  } catch {}
}

async function switchCamera() {
  if (!started) return;
  const previousFacingMode = facingMode;
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  setStatus('Switching camera...', 'warn');
  try {
    const oldVideoTrack = getVideoTrack();
    const nextVideoStream = await getVideoStream();
    const nextVideoTrack = nextVideoStream.getVideoTracks()[0];
    if (!nextVideoTrack) throw new Error('No video track returned.');

    nextVideoTrack.contentHint = 'motion';
    if (videoSender && pc && pc.connectionState !== 'closed') {
      await videoSender.replaceTrack(nextVideoTrack);
    }

    if (oldVideoTrack) {
      localStream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }
    localStream.addTrack(nextVideoTrack);
    preview.srcObject = localStream;
    currentZoom = 1;
    updateZoomButtons();
    updateResolutionValue();
    sendPhoneState();
    setStatus(recording ? 'REC - camera switched' : 'Live - streaming to PC', recording ? 'rec' : 'live');

    if (pcPresent && !videoSender) {
      if (pc) pc.close();
      pc = null;
      void createOffer();
    }
  } catch {
    facingMode = previousFacingMode;
    setStatus('Camera switch failed', 'error');
  }
}

function getVideoTrack() {
  return localStream && localStream.getVideoTracks()[0];
}

function getZoomCapabilities() {
  const track = getVideoTrack();
  if (!track || typeof track.getCapabilities !== 'function') return null;
  const caps = track.getCapabilities();
  if (typeof caps.zoom !== 'object') return null;
  return caps.zoom;
}

function updateZoomButtons() {
  const caps = getZoomCapabilities();
  zoomButtons.forEach((button) => {
    const value = Number(button.dataset.zoom);
    const supported = caps ? value >= caps.min && value <= caps.max : value === 1;
    button.disabled = !supported;
    button.classList.toggle('active', Math.abs(value - currentZoom) < 0.01);
  });
}

async function setZoom(value) {
  const track = getVideoTrack();
  const caps = getZoomCapabilities();
  if (!track || !caps || value < caps.min || value > caps.max) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom: value }] });
    currentZoom = value;
    updateZoomButtons();
    sendPhoneState();
  } catch {
    setStatus('Zoom not supported here', 'warn');
  }
}

async function focusAt(event) {
  const track = getVideoTrack();
  if (!track) return;
  const rect = stage.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  focusRing.style.left = `${event.clientX - rect.left}px`;
  focusRing.style.top = `${event.clientY - rect.top}px`;
  focusRing.classList.remove('hidden');
  window.clearTimeout(focusRing._hideTimer);
  focusRing._hideTimer = window.setTimeout(() => focusRing.classList.add('hidden'), 900);

  try {
    await track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }], focusMode: 'single-shot' }] });
    setStatus(recording ? 'REC - focus set' : 'Focus set', recording ? 'rec' : 'live');
  } catch {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
  }
}

recordBtn.addEventListener('click', () => {
  const stopping = recording;
  send({ type: 'cmd', action: stopping ? 'record.stop' : 'record.start' });
  recordBtn.disabled = true;
  if (stopping) {
    setSavingState();
  } else {
    setRecordButtonText('Starting...');
  }
  setTimeout(() => {
    if (!recordBtn.classList.contains('saving')) {
      recordBtn.disabled = false;
      setRecordButtonText(recording ? 'Stop recording' : 'Start recording');
    }
  }, 1200);
});

flipBtn.addEventListener('click', () => void switchCamera());
zoomButtons.forEach((button) => button.addEventListener('click', () => void setZoom(Number(button.dataset.zoom))));
stage.addEventListener('click', (event) => {
  if (started) void focusAt(event);
});
window.addEventListener('orientationchange', () => setTimeout(sendPhoneState, 250));
window.addEventListener('resize', () => setTimeout(sendPhoneState, 250));
startBtn.addEventListener('click', startCamera);
