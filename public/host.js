// Drayco Gameshow: Figure Chat Out - Host Controller (2x4 Grid & Single-Screen Fit)
(() => {
  // DOM Elements - Connection
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  // DOM Elements - Panelists
  const panelistInputs = [
    document.getElementById('panelistInput0'),
    document.getElementById('panelistInput1'),
    document.getElementById('panelistInput2'),
    document.getElementById('panelistInput3')
  ];
  const turnButtons = [
    document.getElementById('turnBtn0'),
    document.getElementById('turnBtn1'),
    document.getElementById('turnBtn2'),
    document.getElementById('turnBtn3')
  ];
  const turnNames = [
    document.getElementById('turnName0'),
    document.getElementById('turnName1'),
    document.getElementById('turnName2'),
    document.getElementById('turnName3')
  ];
  const activeTurnStatus = document.getElementById('activeTurnStatus');
  const nextTurnBtn = document.getElementById('nextTurnBtn');
  const clearTurnBtn = document.getElementById('clearTurnBtn');

  // DOM Elements - Contestant
  const chatterNameInput = document.getElementById('chatterNameInput');
  const categoryHintInput = document.getElementById('categoryHintInput');
  
  // DOM Elements - Timer
  const timerDisplay = document.getElementById('timerDisplay');
  const preset60Btn = document.getElementById('preset60Btn');
  const preset90Btn = document.getElementById('preset90Btn');
  const customTimerInput = document.getElementById('customTimerInput');
  const startTimerBtn = document.getElementById('startTimerBtn');
  const pauseTimerBtn = document.getElementById('pauseTimerBtn');
  const resetTimerBtn = document.getElementById('resetTimerBtn');

  // DOM Elements - Board Setup
  const sentenceInput = document.getElementById('sentenceInput');
  const wordCountInput = document.getElementById('wordCountInput');
  const setupForm = document.getElementById('setupForm');
  const wordsList = document.getElementById('wordsList');
  const lastSentPayload = document.getElementById('lastSentPayload');
  const revealAllBtn = document.getElementById('revealAllBtn');
  const hideAllBtn = document.getElementById('hideAllBtn');

  let ws = null;
  let reconnectTimer = null;
  let audioCtx = null;

  // Starter 8 words matching 2x4 grid layout
  let currentWords = ['DRAYCO', 'GAMESHOW', 'FIGURE', 'CHAT', 'OUT', 'SECRET', 'PHRASE', 'REVEAL'];

  // Panelist State
  let panelists = ['Streamer 1', 'Streamer 2', 'Streamer 3', 'Streamer 4'];
  let activePanelistIndex = -1;

  // Timer state
  let timerDuration = 60;
  let timeRemaining = 60;
  let timerInterval = null;
  let isTimerRunning = false;
  let activeHintButton = null;

  // ==========================================================================
  // Web Audio API: Mechanical Click & Timer Buzzer
  // ==========================================================================
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playMechanicalClick() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const oscSnap = ctx.createOscillator();
      const gainSnap = ctx.createGain();
      oscSnap.type = 'triangle';
      oscSnap.frequency.setValueAtTime(1600, now);
      oscSnap.frequency.exponentialRampToValueAtTime(320, now + 0.03);

      gainSnap.gain.setValueAtTime(0.35, now);
      gainSnap.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      oscSnap.connect(gainSnap);
      gainSnap.connect(ctx.destination);
      oscSnap.start(now);
      oscSnap.stop(now + 0.03);

      const oscThud = ctx.createOscillator();
      const gainThud = ctx.createGain();
      oscThud.type = 'sine';
      oscThud.frequency.setValueAtTime(260, now);
      oscThud.frequency.exponentialRampToValueAtTime(75, now + 0.05);

      gainThud.gain.setValueAtTime(0.40, now);
      gainThud.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      oscThud.connect(gainThud);
      gainThud.connect(ctx.destination);
      oscThud.start(now);
      oscThud.stop(now + 0.05);
    } catch (err) {
      console.warn('Click audio error:', err);
    }
  }

  function playTimeUpBuzzer() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      [0, 0.18].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now + offset);
        osc.frequency.setValueAtTime(180, now + offset + 0.08);

        gain.gain.setValueAtTime(0.25, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.15);
      });
    } catch (err) {
      console.warn('Buzzer audio error:', err);
    }
  }

  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // ==========================================================================
  // WebSocket Connection
  // ==========================================================================
  function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    return `${protocol}//${host}`;
  }

  function updateConnectionStatus(state, message) {
    statusDot.className = 'status-dot';
    if (state === 'connected') {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      enableAllButtons(true);
    } else if (state === 'disconnected') {
      statusDot.classList.add('disconnected');
      statusText.textContent = message || 'Disconnected';
      enableAllButtons(false);
    } else {
      statusText.textContent = 'Connecting...';
      enableAllButtons(false);
    }
  }

  function enableAllButtons(enabled) {
    document.querySelectorAll('.reveal-btn, .hint-toggle-btn, .btn-batch, .btn-submit, .btn-timer, .btn-turn, .btn-turn-sub').forEach(btn => {
      btn.disabled = !enabled;
    });
    if (enabled && !isTimerRunning) {
      pauseTimerBtn.disabled = true;
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const wsUrl = getWebSocketUrl();

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      updateConnectionStatus('disconnected', 'Connection Error');
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('Host connected to WebSocket at', wsUrl);
      updateConnectionStatus('connected');
      broadcastPanelists();
      broadcastContestant();
    };

    ws.onclose = () => {
      console.warn('Host WebSocket disconnected.');
      updateConnectionStatus('disconnected', 'Disconnected');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('Host WebSocket error:', err);
      updateConnectionStatus('disconnected', 'Error');
    };

    ws.onmessage = (event) => {
      console.log('Host received message:', event.data);
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      updateConnectionStatus('connecting');
      connect();
    }, 2000);
  }

  function sendPayload(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected. Unable to send:', payload);
      return false;
    }

    const jsonString = JSON.stringify(payload);
    ws.send(jsonString);

    if (lastSentPayload) {
      lastSentPayload.textContent = jsonString;
    }
    console.log('Sent payload:', payload);
    return true;
  }

  // ==========================================================================
  // Panelist Management & Turn Switcher
  // ==========================================================================
  function updatePanelistNamesFromInputs() {
    panelistInputs.forEach((input, idx) => {
      const name = input.value.trim() || `Streamer ${idx + 1}`;
      panelists[idx] = name;
      if (turnNames[idx]) {
        turnNames[idx].textContent = name;
      }
    });
    updateTurnUI();
    broadcastPanelists();
  }

  function updateTurnUI() {
    turnButtons.forEach((btn, idx) => {
      const badge = btn.querySelector('.btn-turn-badge');
      if (idx === activePanelistIndex) {
        btn.classList.add('active-turn');
        if (badge) badge.textContent = 'SPEAKING 🎤';
      } else {
        btn.classList.remove('active-turn');
        if (badge) badge.textContent = 'Floor';
      }
    });

    if (activePanelistIndex >= 0 && activePanelistIndex < panelists.length) {
      activeTurnStatus.textContent = `Active: P${activePanelistIndex + 1} (${panelists[activePanelistIndex]})`;
    } else {
      activeTurnStatus.textContent = 'Active: None';
    }
  }

  function setActiveTurn(index) {
    playMechanicalClick();
    activePanelistIndex = index;
    updateTurnUI();
    broadcastPanelists();
  }

  function broadcastPanelists() {
    sendPayload({
      action: 'panelist_turn',
      activeIndex: activePanelistIndex,
      panelists: panelists
    });
  }

  panelistInputs.forEach((input) => {
    input.addEventListener('input', updatePanelistNamesFromInputs);
  });

  turnButtons.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      if (activePanelistIndex === idx) {
        setActiveTurn(-1);
      } else {
        setActiveTurn(idx);
      }
    });
  });

  nextTurnBtn.addEventListener('click', () => {
    playMechanicalClick();
    if (activePanelistIndex < 0) {
      activePanelistIndex = 0;
    } else {
      activePanelistIndex = (activePanelistIndex + 1) % panelists.length;
    }
    updateTurnUI();
    broadcastPanelists();
  });

  clearTurnBtn.addEventListener('click', () => {
    playMechanicalClick();
    activePanelistIndex = -1;
    updateTurnUI();
    broadcastPanelists();
  });

  // ==========================================================================
  // Contestant Name & Category Hint Sync
  // ==========================================================================
  function broadcastContestant() {
    const name = chatterNameInput.value.trim();
    const category = categoryHintInput.value.trim();

    sendPayload({
      action: 'contestant',
      name: name,
      category: category
    });
  }

  chatterNameInput.addEventListener('input', broadcastContestant);
  categoryHintInput.addEventListener('input', broadcastContestant);

  // ==========================================================================
  // Round Countdown Timer
  // ==========================================================================
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateTimerUI() {
    timerDisplay.textContent = formatTime(timeRemaining);
    if (timeRemaining <= 10 && timeRemaining > 0) {
      timerDisplay.classList.add('urgent');
    } else {
      timerDisplay.classList.remove('urgent');
    }
  }

  function setTimerDuration(seconds) {
    timerDuration = Math.max(5, Math.min(300, seconds));
    timeRemaining = timerDuration;
    customTimerInput.value = timerDuration;
    updateTimerUI();

    if (isTimerRunning) {
      pauseTimer();
    }

    sendPayload({
      action: 'timer',
      seconds: timeRemaining,
      state: 'reset'
    });
  }

  function startTimer() {
    playMechanicalClick();
    if (isTimerRunning) return;

    if (timeRemaining <= 0) {
      timeRemaining = timerDuration;
      updateTimerUI();
    }

    isTimerRunning = true;
    startTimerBtn.disabled = true;
    pauseTimerBtn.disabled = false;

    sendPayload({
      action: 'timer',
      seconds: timeRemaining,
      state: 'running'
    });

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeRemaining--;
      updateTimerUI();

      sendPayload({
        action: 'timer',
        seconds: timeRemaining,
        state: 'running'
      });

      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        isTimerRunning = false;
        startTimerBtn.disabled = false;
        pauseTimerBtn.disabled = true;
        playTimeUpBuzzer();

        sendPayload({
          action: 'timer',
          seconds: 0,
          state: 'ended'
        });
      }
    }, 1000);
  }

  function pauseTimer() {
    playMechanicalClick();
    clearInterval(timerInterval);
    isTimerRunning = false;
    startTimerBtn.disabled = false;
    pauseTimerBtn.disabled = true;

    sendPayload({
      action: 'timer',
      seconds: timeRemaining,
      state: 'paused'
    });
  }

  function resetTimer() {
    playMechanicalClick();
    clearInterval(timerInterval);
    isTimerRunning = false;
    timeRemaining = timerDuration;
    updateTimerUI();
    startTimerBtn.disabled = false;
    pauseTimerBtn.disabled = true;

    sendPayload({
      action: 'timer',
      seconds: timeRemaining,
      state: 'reset'
    });
  }

  preset60Btn.addEventListener('click', () => {
    playMechanicalClick();
    preset60Btn.classList.add('active');
    preset90Btn.classList.remove('active');
    setTimerDuration(60);
  });

  preset90Btn.addEventListener('click', () => {
    playMechanicalClick();
    preset90Btn.classList.add('active');
    preset60Btn.classList.remove('active');
    setTimerDuration(90);
  });

  customTimerInput.addEventListener('change', () => {
    playMechanicalClick();
    const val = parseInt(customTimerInput.value, 10);
    if (!isNaN(val)) {
      preset60Btn.classList.remove('active');
      preset90Btn.classList.remove('active');
      setTimerDuration(val);
    }
  });

  startTimerBtn.addEventListener('click', startTimer);
  pauseTimerBtn.addEventListener('click', pauseTimer);
  resetTimerBtn.addEventListener('click', resetTimer);

  // ==========================================================================
  // Secret Sentence & 2x4 Board Generation
  // ==========================================================================
  sentenceInput.addEventListener('input', () => {
    const raw = sentenceInput.value.trim();
    if (!raw) return;

    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length >= 3 && words.length <= 8) {
      wordCountInput.value = words.length;
    } else if (words.length > 8) {
      wordCountInput.value = 8;
    }
  });

  wordCountInput.addEventListener('change', () => {
    let val = parseInt(wordCountInput.value, 10);
    if (isNaN(val) || val < 3) val = 3;
    if (val > 8) val = 8;
    wordCountInput.value = val;
  });

  function generateWordBoard() {
    let count = parseInt(wordCountInput.value, 10);
    if (isNaN(count) || count < 3) count = 3;
    if (count > 8) count = 8;
    wordCountInput.value = count;

    const rawSentence = sentenceInput.value.trim();
    const sentenceWords = rawSentence ? rawSentence.split(/\s+/).filter(Boolean) : [];

    const words = [];
    for (let i = 0; i < count; i++) {
      if (i < sentenceWords.length) {
        words.push(sentenceWords[i]);
      } else {
        words.push(currentWords[i] || `WORD ${i + 1}`);
      }
    }

    currentWords = words;
    renderWordRows(words);

    sendPayload({
      action: 'setup',
      count: words.length,
      words: words
    });
  }

  // Push or clear one live hint. The board keeps only the latest active hint.
  function pushWordHint(wordNumber, hintInput, hintButton) {
    const hint = hintInput.value.trim();
    const isActive = hintButton.classList.contains('is-active');

    if (isActive || !hint) {
      if (sendPayload({
        action: 'word_hint',
        box: wordNumber,
        hint: '',
        active: false
      })) {
        hintButton.classList.remove('is-active');
        hintButton.textContent = 'Push Hint';
        if (activeHintButton === hintButton) {
          activeHintButton = null;
        }
      }
      return;
    }

    if (activeHintButton && activeHintButton !== hintButton) {
      activeHintButton.classList.remove('is-active');
      activeHintButton.textContent = 'Push Hint';
    }

    if (sendPayload({
      action: 'word_hint',
      box: wordNumber,
      hint: hint,
      active: true
    })) {
      hintButton.classList.add('is-active');
      hintButton.textContent = 'Hint Live ✓';
      activeHintButton = hintButton;
    }
  }

  // Render 2x4 Grid Word Controls
  function renderWordRows(words) {
    wordsList.innerHTML = '';

    words.forEach((word, index) => {
      const boxNumber = index + 1;

      const card = document.createElement('div');
      card.className = 'word-card-host';
      card.id = `wordCardHost-${boxNumber}`;
      card.setAttribute('role', 'listitem');

      card.innerHTML = `
        <div class="word-card-top">
          <span class="word-badge">#${boxNumber}</span>
          <input type="text" class="word-input" id="wordInput-${boxNumber}" value="${escapeHtml(word)}" data-box="${boxNumber}">
        </div>
        <button type="button" class="reveal-btn" id="revealBtn-${boxNumber}" data-box="${boxNumber}">
          Reveal #${boxNumber}
        </button>
        <div class="hint-control">
          <input type="text" class="hint-input" id="hintInput-${boxNumber}" placeholder="Word #${boxNumber} clue" maxlength="120" aria-label="Hint for word ${boxNumber}">
          <button type="button" class="hint-toggle-btn" id="hintBtn-${boxNumber}" data-box="${boxNumber}">
            Push Hint
          </button>
        </div>
      `;

      const input = card.querySelector('.word-input');
      input.addEventListener('input', () => {
        currentWords[index] = input.value.trim();
      });

      const button = card.querySelector('.reveal-btn');
      const hintInput = card.querySelector('.hint-input');
      const hintButton = card.querySelector('.hint-toggle-btn');
      button.disabled = (!ws || ws.readyState !== WebSocket.OPEN);
      hintButton.disabled = (!ws || ws.readyState !== WebSocket.OPEN);

      hintButton.addEventListener('click', () => {
        playMechanicalClick();
        pushWordHint(boxNumber, hintInput, hintButton);
      });

      hintInput.addEventListener('input', () => {
        if (hintButton.classList.contains('is-active')) {
          hintButton.classList.remove('is-active');
          hintButton.textContent = 'Push Hint';
          if (activeHintButton === hintButton) {
            activeHintButton = null;
          }
        }
      });

      button.addEventListener('click', () => {
        playMechanicalClick();

        const wordText = input.value.trim();
        const payload = {
          action: 'reveal',
          box: boxNumber,
          word: wordText
        };

        if (sendPayload(payload)) {
          button.classList.add('revealed');
          button.textContent = `Revealed ✓`;
          card.classList.add('is-revealed');
        }
      });

      wordsList.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    playMechanicalClick();
    generateWordBoard();
  });

  // Reveal All / Hide All Handlers
  revealAllBtn.addEventListener('click', () => {
    playMechanicalClick();

    document.querySelectorAll('.word-card-host').forEach(card => card.classList.add('is-revealed'));
    document.querySelectorAll('.reveal-btn').forEach(btn => {
      btn.classList.add('revealed');
      btn.textContent = `Revealed ✓`;
    });

    sendPayload({ action: 'reveal_all' });
  });

  hideAllBtn.addEventListener('click', () => {
    playMechanicalClick();

    document.querySelectorAll('.word-card-host').forEach(card => card.classList.remove('is-revealed'));
    document.querySelectorAll('.reveal-btn').forEach(btn => {
      btn.classList.remove('revealed');
      const box = btn.getAttribute('data-box');
      btn.textContent = `Reveal #${box}`;
    });

    sendPayload({ action: 'hide_all' });
  });

  // Initialize
  updatePanelistNamesFromInputs();
  updateTimerUI();
  generateWordBoard();
  connect();
})();
