//========================
// DOM Element References
//========================
const timelineEl = document.getElementById('timeline');
const timelineHead = document.getElementById('timeline-head');
const comboOutput = document.getElementById('combo-output');
const timeReadout = document.getElementById('time-readout');
const timelineDurationInput = document.getElementById('timeline-duration');
const statePopup = document.getElementById('state-popup');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const clearButton = document.getElementById('clear-button');

const videoUpload = document.getElementById('video-upload');
const videoPlayer = document.getElementById('video-player');
const videoInfo = document.getElementById('video-info');

//========================
// Global State Variables
//========================
let timelineLength = 10;
let playhead = 0;
let playing = false;
let typingMode = false;
let lastFrameTime = null;

let gamepad = null;
let prevButtons = [];
let prevButtonsInitialized = false;

let timelineInputs = [];
let nextNodeId = 1;
let repositioning = null;

let popupActive = false;
let popupIndex = 0;
let popupNode = null;
let popupIsConnector = false;
let lastPopupNav = 0;

videoPlayer.muted = true; // This allows autoplay

// Hold detection for Select
let selectPressTime = null;
let selectHeld = false;

// Constants
const DEADZONE = 0.1;
const FRAME_RATE = 60;
const START_HOLD_THRESHOLD = 500;
const SELECT_HOLD_DELETE_MS = 2500;

const PROFILES = {
  '2xko': {
    0: 'T', 1: 'H', 2: 'L', 3: 'M', 4: 'P', 5: 'D',
    6: 'S1', 7: 'S2', 10: 'TH', 11: 'TA'
  }
};
let currentMapping = PROFILES['2xko'];

//========================
// Utilities
//========================
function clampPlayhead(t) {
  while (t < 0) t += timelineLength;
  while (t >= timelineLength) t -= timelineLength;
  return t;
}

function getDirection(axes, buttons) {
  const [lx, ly] = axes || [0, 0];
  const u = buttons?.[12]?.pressed, d = buttons?.[13]?.pressed,
        l = buttons?.[14]?.pressed, r = buttons?.[15]?.pressed;
  if (u && l) return '7';
  if (u && r) return '9';
  if (d && l) return '1';
  if (d && r) return '3';
  if (u) return '8';
  if (d) return '2';
  if (l) return '4';
  if (r) return '6';
  if (Math.abs(lx) < DEADZONE && Math.abs(ly) < DEADZONE) return '5';
  if (ly > DEADZONE) return lx > DEADZONE ? '3' : lx < -DEADZONE ? '1' : '2';
  if (ly < -DEADZONE) return lx > DEADZONE ? '9' : lx < -DEADZONE ? '7' : '8';
  if (lx > DEADZONE) return '6';
  if (lx < -DEADZONE) return '4';
  return '5';
}

function nodeDisplayString(n) {
  let dir = n.dir || '5';
  let btn = (n.buttons && n.buttons.length > 1) ? `(${n.buttons.join('+')})` : (n.buttons[0] || '');
  let out = (dir === '5' ? '' : dir) + btn;
  if (n.state === 'air') out = 'j.' + out;
  if (n.state === 'j.C') out = 'j.C' + out;
  if (n.state === 'hold') out = '[' + out + ']';
  if (n.state === 'release') out = ']' + out + '[';
  if (n.state === 'mash') out = 'Mash ' + out;
  if (n.state && !['air', 'hold', 'j.C', 'mash', 'release'].includes(n.state)) out = out + `(${n.state})`;
  return out;
}

function findNodeAtPlayhead(t = playhead, tol = 0.1) {
  return timelineInputs.find(n => Math.abs(n.time - t) < tol) || null;
}

function getClosestNode() {
  if (timelineInputs.length === 0) return null;
  return timelineInputs.reduce((a, b) => Math.abs(a.time - playhead) < Math.abs(b.time - playhead) ? a : b);
}

function getCurrentlyPressedMappedButtons(gp) {
  const labels = [];
  for (const k of Object.keys(currentMapping)) {
    const idx = parseInt(k);
    if (gp.buttons[idx]?.pressed) labels.push(currentMapping[idx]);
  }
  return labels;
}

//========================
// Node operations
//========================
function setNodeAtPlayhead(labels, dir) {
  if (popupActive || repositioning) return;
  const t = clampPlayhead(playhead);
  const existingNode = timelineInputs.find(n => Math.abs(n.time - t) < 0.1);
  if (existingNode) {
    existingNode.buttons = [...new Set(labels)];
    existingNode.dir = dir || existingNode.dir;
  } else {
    timelineInputs.push({ id: nextNodeId++, time: t, dir: dir || '5', buttons: [...new Set(labels)], state: null });
  }
  renderEverything();
}

function deleteNodeAtPlayhead() {
  const node = findNodeAtPlayhead();
  if (!node) return;
  timelineInputs = timelineInputs.filter(n => n !== node);
  if (repositioning === node) repositioning = null;
  renderEverything();
}

//========================
// Popup Management
//========================
function updatePopupHighlights() {
  const highlightableItems = Array.from(statePopup.children).filter(el => el.tagName === 'DIV');  
  Array.from(statePopup.children).forEach(c => c.classList.remove('selected'));  
  if (popupIndex >= 0 && popupIndex < highlightableItems.length) {
    highlightableItems[popupIndex].classList.add('selected');
  }
}

function buildPopupOptions(forNode, isConnector) {
  statePopup.innerHTML = '';
  if (forNode) {
    statePopup.innerHTML = `
      <div data-action="move">Move Node</div>
	  <hr>
      <div data-action="air">Toggle In Air</div>
      <div data-action="jC">Toggle Jump Cancel</div>
      <div data-action="hold">Toggle Hold</div>
      <div data-action="release">Toggle Release</div>
      <div data-action="mash">Toggle Mash</div>
	  <hr>
      <div data-action="clear">Clear Timeline</div>
      <div data-action="delete">Delete Node</div>      
    `;
  } else if (isConnector) {
    statePopup.innerHTML = `
	  <div data-action="revertDefault">Revert to Default (>)</div>
      <div data-action="setCancel">Set to Cancel (xx)</div>
      <div data-action="setLink">Set to Link (,)</div>
      <div data-action="setImmediate">Set to Immediate (~)</div>
      <hr>
      <div data-action="counter">Insert Counter</div>
      <div data-action="electric">Insert Electric</div>
      <div data-action="whiff">Insert Whiff</div>
	  <hr>
      <div data-action="clear">Clear Timeline</div>
    `;
  } else {
    statePopup.innerHTML = `
      <div data-action="counter">Insert Counter</div>
      <div data-action="electric">Insert Electric</div>
      <div data-action="whiff">Insert Whiff</div>
	  <hr>
      <div data-action="clear">Clear Timeline</div>
    `;
  }
}

function getPrecedingNode() {
  const sorted = timelineInputs.slice().sort((a, b) => a.time - b.time);
  let precedingNode = null;
  for (const n of sorted) {
    if (n.time < playhead) {
      precedingNode = n;
    } else {
      break;
    }
  }
  return precedingNode;
}

function openPopup(forNode, isConnector) {
  buildPopupOptions(!!forNode, isConnector);
  const rect = timelineEl.getBoundingClientRect();
  const x = rect.left + (playhead / timelineLength) * rect.width;
  const y = rect.top;
  statePopup.style.left = x + 'px';
  statePopup.style.top = (y - 200) + 'px';
  statePopup.classList.add('active');
  popupActive = true;
  popupNode = forNode || null;
  popupIsConnector = isConnector;
  popupIndex = 0;
  lastPopupNav = performance.now();
  updatePopupHighlights();
}

function closePopup() {
  popupActive = false;
  popupNode = null;
  statePopup.classList.remove('active');
}

function applyPopupAction(idx, node) {
  const highlightableItems = Array.from(statePopup.children).filter(el => el.tagName === 'DIV');
  const el = highlightableItems[idx];
  if (!el) return;
  const action = el.dataset.action;

  const isConnectorAction = ['setCancel', 'setLink', 'setImmediate', 'revertDefault'].includes(action);
  if (isConnectorAction) {
    const targetNode = getPrecedingNode();
    if (targetNode) {
      if (action === 'setCancel') targetNode.connector = 'xx';
      else if (action === 'setLink') targetNode.connector = ',';
      else if (action === 'setImmediate') targetNode.connector = '~';
      else if (action === 'revertDefault') delete targetNode.connector;
    }
  } else if (action === 'delete' && node) {
    timelineInputs = timelineInputs.filter(n => n !== node);
    if (repositioning === node) repositioning = null;
  } else if (action === 'air') {
    if (node) node.state = (node.state === 'air') ? null : 'air';
  } else if (action === 'jC') {
    if (node) node.state = (node.state === 'j.C') ? null : 'j.C';
  } else if (action === 'hold') {
    if (node) node.state = (node.state === 'hold') ? null : 'hold';
  } else if (action === 'release') {
    if (node) node.state = (node.state === 'release') ? null : 'release';
  } else if (action === 'mash') {
    if (node) node.state = (node.state === 'mash') ? null : 'mash';
  } else if (action === 'move') {
    if (node) repositioning = node;
  } else if (action === 'clear') {
    timelineInputs = [];
    repositioning = null;
    playhead = 0;
  } else if (action) {
    if (!node) {
      timelineInputs.push({ id: nextNodeId++, time: playhead, dir: '5', buttons: [], state: action });
    } else {
      node.state = action;
    }
  }

  closePopup();
  renderEverything();
}

function updatePopupHighlights() {
  const highlightableItems = Array.from(statePopup.children).filter(el => el.tagName === 'DIV');
  Array.from(statePopup.children).forEach(c => c.classList.remove('selected'));
  
  if (popupIndex >= 0 && popupIndex < highlightableItems.length) {
    highlightableItems[popupIndex].classList.add('selected');
  }
}

//========================
// Rendering
//========================
function renderEverything() {
  timelineEl.innerHTML = '';

  const tempInputs = timelineInputs.map(n => (n === repositioning ? { ...n, time: playhead } : n));
  const sorted = tempInputs.slice().sort((a, b) => a.time - b.time);
  
  let somethingIsHighlighted = false;
  
  for (const node of sorted) {
    const el = document.createElement('div');
    el.className = 'node';
    el.textContent = nodeDisplayString(node);
    el.style.left = (node.time / timelineLength * 100) + '%';

    if (Math.abs(node.time - playhead) < 0.05 && repositioning !== node) {
      el.classList.add('highlighted');
    }

    if (repositioning && repositioning.id === node.id) {
      el.classList.add('repositioning');
    }

    el.dataset.nodeId = node.id;
    timelineEl.appendChild(el);
  }

  const comboSpans = sorted.map(n => {
    let isNodeHighlighted = false;
    if (repositioning && repositioning.id === n.id) {
      isNodeHighlighted = true;
      somethingIsHighlighted = true;
    } else if (!somethingIsHighlighted && Math.abs(n.time - playhead) < 0.05) {
      isNodeHighlighted = true;
      somethingIsHighlighted = true;
    }
    
    return `<span class="${isNodeHighlighted ? 'highlight' : ''}">${nodeDisplayString(n)}</span>`;
  });

  let comboHTML = comboSpans[0] || '';
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentNode = sorted[i];
    const nextNode = sorted[i + 1];
    
    const connectorSymbol = currentNode.connector || '>';
    
    let isConnectorHighlighted = false;
    if (!somethingIsHighlighted && playhead > currentNode.time && playhead < nextNode.time) {
      if (!playing) isConnectorHighlighted = true;
      somethingIsHighlighted = true;
    }
    
    comboHTML += `<span class="${isConnectorHighlighted ? 'highlight' : ''}"> ${connectorSymbol} </span>` + comboSpans[i + 1];
  }
  
  comboOutput.innerHTML = comboHTML;

  timelineHead.style.left = (playhead / timelineLength * 100) + '%';
  const frames = Math.floor(playhead * FRAME_RATE);
  const totalFrames = Math.floor(timelineLength * FRAME_RATE);
  timeReadout.textContent = `${playhead.toFixed(2)}s / ${frames}f (of ${timelineLength.toFixed(2)}s / ${totalFrames}f)`;
}

//========================
// Input / Gamepad logic
//========================
let lastAngle = null;
const DAMPING = 0.12;

let startPressTime = null;
let startHoldToggled = false;

function scrubRightStick(gp) {
  const rx = gp.axes[2] ?? 0;
  const ry = gp.axes[3] ?? 0;
  const mag = Math.sqrt(rx*rx + ry*ry);

  if (mag > DEADZONE) {
    const ang = Math.atan2(ry, rx);
    if (lastAngle !== null) {
      let delta = ang - lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      const scale = mag * mag;
      playhead += delta * (timelineLength / (2 * Math.PI)) * scale * DAMPING;
      playhead = clampPlayhead(playhead);

      // Close popup if open
      if (popupActive) closePopup();

      // Update the video time
      if (videoPlayer && videoPlayer.src) {
        videoPlayer.currentTime = Math.min(playhead, videoPlayer.duration || playhead);
      }

      renderEverything();
    }
    lastAngle = ang;
  } else {
    lastAngle = null;
  }
}

function processGamepad(gp) {
  if (!prevButtonsInitialized || prevButtons.length !== gp.buttons.length) {
    prevButtons = new Array(gp.buttons.length).fill(false);
    prevButtonsInitialized = true;
  }
  const now = performance.now();

  gp.buttons.forEach((btn, i) => {
    const was = !!prevButtons[i];
    const nowPressed = !!btn.pressed;
    const justPressed = nowPressed && !was;

    if (justPressed) {
      if (i === 8) { // SELECT button
        if (popupActive) {
          applyPopupAction(popupIndex, popupNode);
        } else {
          // Check for a node at the playhead first, using a tighter tolerance
          const node = findNodeAtPlayhead(playhead, 0.05);
          if (node) {
            openPopup(node, false);
          } else {
            // If no node, check for a connector
            const precedingNode = getPrecedingNode();
            const followingNodes = timelineInputs.filter(n => n.time > playhead).sort((a,b) => a.time - b.time);
            const isConnector = !!precedingNode && followingNodes.length > 0;
            openPopup(null, isConnector);
          }
        }
        if (!popupActive) {
          selectPressTime = now;
          selectHeld = false;
        }
      } else if (i === 1) { // B button
        if (popupActive) {
          closePopup();
        } else if (!repositioning) {
          const dir = getDirection(gp.axes, gp.buttons);
          const labels = getCurrentlyPressedMappedButtons(gp);
          if (labels.length > 0) setNodeAtPlayhead(labels, dir);
        }
      } else if (i === 0) { // A button
        if (repositioning) {
          repositioning.time = clampPlayhead(playhead);
          repositioning = null;
          renderEverything();
        } else if (popupActive) {
          applyPopupAction(popupIndex, popupNode);
        } else {
          const dir = getDirection(gp.axes, gp.buttons);
          const labels = getCurrentlyPressedMappedButtons(gp);
          if (labels.length > 0) setNodeAtPlayhead(labels, dir);
        }
      } else if (i === 9) { // Start button
		const gpStart = gp.buttons[9]?.pressed;

		if (gpStart) {
			if (startPressTime === null) startPressTime = now;

			// Long press toggles typingMode
			if (!startHoldToggled && (now - startPressTime) >= START_HOLD_THRESHOLD) {
				typingMode = !typingMode;
				startHoldToggled = true;

				if (typingMode) {
					playing = false;
					videoPlayer?.pause();
				}
			}
		} else {
			if (startPressTime !== null) {
				// Short press toggles play/pause
				if (!startHoldToggled) {
					playing = !playing;

					if (playing) {
						// Gamepad-first autoplay: mute ensures it works
						videoPlayer.muted = true;
						videoPlayer.play().catch(() => {
							console.warn("Playback blocked; will retry on next Start press.");
							playing = false;
						});
					} else {
						videoPlayer.pause();
					}
				}

				// Reset
				startPressTime = null;
				startHoldToggled = false;
			}
		}
      } else if (i === 12 && popupActive) { // D-pad Up
        const highlightableItems = Array.from(statePopup.children).filter(el => el.tagName === 'DIV');
        if (now - lastPopupNav > 150) {
          popupIndex = (popupIndex - 1 + highlightableItems.length) % highlightableItems.length;
          lastPopupNav = now;
          updatePopupHighlights();
        }
      } else if (i === 13 && popupActive) { // D-pad Down
        const highlightableItems = Array.from(statePopup.children).filter(el => el.tagName === 'DIV');
        if (now - lastPopupNav > 150) {
          popupIndex = (popupIndex + 1) % highlightableItems.length;
          lastPopupNav = now;
          updatePopupHighlights();
        }
      } else {
        if (!popupActive && !repositioning && currentMapping[i]) {
          const dir = getDirection(gp.axes, gp.buttons);
          const labels = getCurrentlyPressedMappedButtons(gp);
          if (labels.length > 0) setNodeAtPlayhead(labels, dir);
        }
      }
    }

    prevButtons[i] = nowPressed;
  });

  const selectBtn = gp.buttons[8]?.pressed;
  if (selectBtn) {
    if (selectPressTime && !selectHeld && (now - selectPressTime) >= SELECT_HOLD_DELETE_MS) {
      deleteNodeAtPlayhead();
      selectHeld = true;
    }
  } else {
    selectPressTime = null;
    selectHeld = false;
  }

  const gpStart = gp.buttons[9]?.pressed;
  if (gpStart) {
    if (startPressTime && !startHoldToggled && (now - startPressTime) >= START_HOLD_THRESHOLD) {
      typingMode = !typingMode;
      startHoldToggled = true;
      if (typingMode) playing = false;
    }
  } else {
    if (startPressTime) {
      if (!startHoldToggled) playing = !playing;
      startPressTime = null;
      startHoldToggled = false;
    }
  }
  scrubRightStick(gp);
}

//========================
// Mouse / DOM interactions
//========================
timelineEl.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const nodeEl = ev.target.closest('.node');
  if (!nodeEl) return;
  const nodeId = parseInt(nodeEl.dataset.nodeId);
  const nodeObj = timelineInputs.find(n => n.id === nodeId);
  if (!nodeObj) return;
  openPopup(nodeObj);
});

document.addEventListener('click', (ev) => {
  if (!popupActive) return;
  if (!statePopup.contains(ev.target)) closePopup();
});

statePopup.addEventListener('click', (ev) => {
  const item = ev.target.closest('[data-action]');
  if (!item) return;
  const idx = [...statePopup.children].indexOf(item);
  applyPopupAction(idx, popupNode);
});

settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('open'));

clearButton.addEventListener('click', () => {
  timelineInputs = [];
  repositioning = null;
  playhead = 0;
  renderEverything();
});

timelineDurationInput.addEventListener('input', (e) => {
  timelineLength = Math.max(1, parseFloat(e.target.value) || 10);
  timelineInputs.forEach(n => n.time = clampPlayhead(n.time));
  playhead = clampPlayhead(playhead);
  renderEverything();
});

// Video upload & sync
let draggingPlayhead = false;
timelineHead.addEventListener('mousedown', (ev) => {
  draggingPlayhead = true;
  ev.preventDefault();
});
document.addEventListener('mousemove', (ev) => {
  if (!draggingPlayhead) return;
  const rect = timelineEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
  const pct = x / rect.width;
  playhead = clampPlayhead(pct * timelineLength);
  if (popupActive) closePopup();
  if (videoPlayer && videoPlayer.src) {
    try { videoPlayer.currentTime = Math.min(playhead, videoPlayer.duration || playhead); } catch (e) {}
  }
  renderEverything();
});
document.addEventListener('mouseup', () => { if (draggingPlayhead) draggingPlayhead = false; });

let userSeeking = false;
videoUpload.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  videoPlayer.src = url;
  videoPlayer.style.display = 'block';
  videoInfo.textContent = `Loading video: ${file.name}`;
});
videoPlayer.addEventListener('loadedmetadata', () => {
  timelineLength = Math.max(1, videoPlayer.duration || 10);
  timelineDurationInput.value = timelineLength;
  playhead = 0;
  videoInfo.textContent = `Video loaded — ${videoPlayer.duration.toFixed(2)}s`;
  renderEverything();
});
videoPlayer.addEventListener('timeupdate', () => {
  if (userSeeking) return;
  if (!isNaN(videoPlayer.currentTime)) {
    playhead = Math.min(Math.max(0, videoPlayer.currentTime), timelineLength);
    renderEverything();
  }
});
videoPlayer.addEventListener('seeking', () => { userSeeking = true; });
videoPlayer.addEventListener('seeked', () => { userSeeking = false; playhead = Math.min(Math.max(0, videoPlayer.currentTime), timelineLength); renderEverything(); });

//========================
// Main Loop
//========================
function mainLoop() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  if (!gamepad) {
    for (let i = 0; i < gps.length; i++) {
      if (gps[i]) { gamepad = gps[i]; prevButtons = new Array(gamepad.buttons.length).fill(false); break; }
    }
  }
  if (gamepad) {
    const fresh = navigator.getGamepads()[gamepad.index];
    if (fresh) gamepad = fresh;
    processGamepad(gamepad);
  }

	if (playing) {
	  const now = performance.now();
	  if (lastFrameTime !== null) {
		const dt = (now - lastFrameTime) / 1000;
		playhead += dt;
		if (playhead >= timelineLength) playhead = 0;

		// Update video
		if (videoPlayer && videoPlayer.src) {
		  videoPlayer.currentTime = Math.min(playhead, videoPlayer.duration || playhead);
		}

		renderEverything();
	  }
	  lastFrameTime = performance.now();
	} else {
	  lastFrameTime = performance.now();
	}

  requestAnimationFrame(mainLoop);
}

//========================
// Timeline clicks
//========================
timelineEl.addEventListener('mousedown', (ev) => {
  const rect = timelineEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
  const pct = x / rect.width;
  playhead = clampPlayhead(pct * timelineLength);
  if (popupActive) closePopup();
  if (videoPlayer && videoPlayer.src) {
    try { userSeeking = true; videoPlayer.currentTime = Math.min(playhead, videoPlayer.duration || playhead); } catch(e) {}
    setTimeout(()=>userSeeking=false, 50);
  }
  renderEverything();
});

// Double-click empty area opens insertion popup
timelineEl.addEventListener('dblclick', (ev) => {
  const rect = timelineEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
  const pct = x / rect.width;
  playhead = clampPlayhead(pct * timelineLength);
  
  const node = findNodeAtPlayhead(playhead, 0.05); // Use a tighter tolerance for precision
  if (node) {
    openPopup(node, false);
  } else {
    const precedingNode = getPrecedingNode();
    const followingNodes = timelineInputs.filter(n => n.time > playhead).sort((a,b) => a.time - b.time);
    const isConnector = !!precedingNode && followingNodes.length > 0;
    openPopup(null, isConnector);
  }
});

// Click a node jumps playhead
timelineEl.addEventListener('click', (ev) => {
  const nodeEl = ev.target.closest('.node');
  if (!nodeEl) return;
  const nodeId = parseInt(nodeEl.dataset.nodeId);
  const nodeObj = timelineInputs.find(n => n.id === nodeId);
  if (!nodeObj) return;
  playhead = clampPlayhead(nodeObj.time);
  if (videoPlayer && videoPlayer.src) {
    try { userSeeking = true; videoPlayer.currentTime = Math.min(playhead, videoPlayer.duration || playhead); } catch(e) {}
    setTimeout(()=>userSeeking=false, 50);
  }
  renderEverything();
});

//========================
// Init
//========================
renderEverything();
requestAnimationFrame(mainLoop);