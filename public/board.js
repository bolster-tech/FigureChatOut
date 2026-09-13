// Drayco Gameshow: Figure Chat Out - Game Board Controller (2x4 Grid & Single-Screen Fit)
(() => {
  const gameBoard = document.getElementById('gameBoard');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const boardChatterName = document.getElementById('boardChatterName');
  const boardCategoryHint = document.getElementById('boardCategoryHint');
  const boardTimerBadge = document.getElementById('boardTimerBadge');
  const boardTimerText = document.getElementById('boardTimerText');
  const panelistRoster = document.getElementById('panelistRoster');
  const clueBox = document.getElementById('clueBox');
  const boardWordHint = document.getElementById('boardWordHint');

  // ==========================================================================
  // STRICT READ-ONLY LOCK: viewers can NEVER click or unreveal board boxes.
  // Belt-and-suspenders companion to the CSS lock in board.css.
  // ==========================================================================
  const BLOCKED_BOARD_EVENTS = [
    'click', 'dblclick', 'mousedown', 'mouseup',
    'pointerdown', 'pointerup', 'touchstart', 'touchend',
    'contextmenu', 'keydown'
  ];
  (function enforceBoardReadOnly() {
    if (!gameBoard) return;
    gameBoard.style.pointerEvents = 'none';
    gameBoard.style.userSelect = 'none';
    gameBoard.style.webkitUserSelect = 'none';
    BLOCKED_BOARD_EVENTS.forEach((type) => {
      gameBoard.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true, passive: false });
    });
  })();

  let ws = null;
  let reconnectTimer = null;
  let audioCtx = null;

  const roomCode = (() => {
    const requestedRoom = new URLSearchParams(window.location.search).get('room');
    return (requestedRoom || 'lobby').trim().slice(0, 64) || 'lobby';
  })();

  // Default starter words: 8 words total for the 2x4 grid layout
  let currentWords = ['DRAYCO', 'GAMESHOW', 'FIGURE', 'CHAT', 'OUT', 'SECRET', 'PHRASE', 'REVEAL'];

  // Default panelists
  let panelists = ['Streamer 1', 'Streamer 2', 'Streamer 3', 'Streamer 4'];
  let activePanelistIndex = -1;

  // ==========================================================================
  // Web Audio API: Nickelodeon-Style Cartoony Sound Effects
  // ==========================================================================
  let masterGain = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        // Global Volume Cap at 30% for streaming balance
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.3;
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return { ctx: audioCtx, master: masterGain };
  }

  // Bouncy pop for tile reveals
  function playBouncyPop() {
    try {
      const { ctx, master } = getAudioContext();
      if (!ctx || !master) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      
      // Quick pitch drop for a "pop"
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {}
  }

  // Slide whistle/ascending blip for turn switches
  function playTurnSwitchSound() {
    try {
      const { ctx, master } = getAudioContext();
      if (!ctx || !master) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      
      // Ascending slide
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(900, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {}
  }

  // Buzzer pop for timer alerts
  function playTimerBuzzer() {
    try {
      const { ctx, master } = getAudioContext();
      if (!ctx || !master) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      
      osc.frequency.setValueAtTime(150, now);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.8, now + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {}
  }

  // Squish/splat synth for secret action revelations
  function playSquishSplat() {
    try {
      const { ctx, master } = getAudioContext();
      if (!ctx || !master) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      // Gritty FM-like squish using a low sawtooth
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {}
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

  function updateStatus(state, msg) {
    if (!statusDot || !statusText) return;
    statusDot.className = 'status-dot';
    if (state === 'connected') {
      statusDot.classList.add('connected');
      statusText.textContent = 'LIVE';
    } else if (state === 'disconnected') {
      statusDot.classList.add('disconnected');
      statusText.textContent = msg || 'OFFLINE';
    } else {
      statusText.textContent = 'CONNECTING...';
    }
  }

  // ==========================================================================
  // Render Panelist Roster Bar
  // ==========================================================================
  function renderPanelistRoster() {
    if (!panelistRoster) return;
    panelistRoster.innerHTML = '';

    panelists.forEach((name, index) => {
      const card = document.createElement('div');
      card.className = 'panelist-card';
      card.setAttribute('data-index', index);
      card.id = `panelistCard-${index}`;

      if (index === activePanelistIndex) {
        card.classList.add('active-turn');
      }

      card.innerHTML = `
        <span class="panelist-name">${escapeHtml(name)}</span>
        <span class="speaking-badge"><span class="speaking-dot"></span>SPEAKING</span>
      `;

      panelistRoster.appendChild(card);
    });
  }

  // ==========================================================================
  // Dynamic Word Scaling: Fit font size and aspect to fill container perfectly
  // ==========================================================================
  function fitWord(wordEl) {
    if (!wordEl) return;
    const stage = wordEl.closest('.revealed-stage');
    if (!stage) return;

    const text = (wordEl.textContent || '').trim();
    if (!text) return;

    // Available container area reserving 8px left buffer + 28px right buffer (for 4px drop shadow & letter-spacing)
    const availW = Math.max(20, stage.clientWidth - 42);
    const availH = Math.max(20, stage.clientHeight - 14);

    // Responsive horizontal compression based on character length:
    let squeeze = 1.0;
    if (text.length >= 14) {
      squeeze = 0.74;
    } else if (text.length >= 10) {
      squeeze = 0.82;
    } else if (text.length >= 7) {
      squeeze = 0.90;
    }

    // Unconstrained baseline measurement without any clipping
    wordEl.style.maxWidth = 'none';
    wordEl.style.fontSize = '40px';
    wordEl.style.transform = 'none';
    wordEl.style.display = 'inline-block';
    wordEl.style.whiteSpace = 'nowrap';
    wordEl.style.lineHeight = '1';

    // Measure raw unscaled dimensions
    const rawW = wordEl.scrollWidth || wordEl.offsetWidth;
    const rawH = wordEl.scrollHeight || wordEl.offsetHeight;

    if (rawW > 0 && rawH > 0) {
      const effectiveW = rawW * squeeze;
      const fitFactor = Math.min(availW / effectiveW, availH / rawH);

      // Target font size: allows shrinking down as small as needed to NEVER overflow or cut off
      let targetSize = Math.max(6, Math.min(Math.floor(40 * fitFactor), 96));
      wordEl.style.fontSize = `${targetSize}px`;
      wordEl.style.transform = squeeze < 1.0 ? `scaleX(${squeeze})` : 'none';
      wordEl.style.transformOrigin = 'center';

      // Verification loop: check actual rendered width and scale down if still exceeding availW
      let currentW = (wordEl.scrollWidth || wordEl.offsetWidth) * squeeze;
      let count = 0;
      while (currentW > availW && targetSize > 6 && count < 8) {
        targetSize = Math.max(6, Math.floor(targetSize * (availW / currentW)));
        wordEl.style.fontSize = `${targetSize}px`;
        currentW = (wordEl.scrollWidth || wordEl.offsetWidth) * squeeze;
        count++;
      }
    }
  }

  function fitAllWords() {
    const wordEls = document.querySelectorAll('.revealed-word');
    wordEls.forEach(fitWord);
  }

  // ==========================================================================
  // Render 2x4 Word Board (2 Rows x 4 Columns, Up to 8 Words)
  // ==========================================================================
  function renderBoard(words) {
    gameBoard.innerHTML = '';
    currentWords = words;

    // Render word tiles up to 8 total
    const count = Math.min(8, words.length);

    for (let index = 0; index < count; index++) {
      const word = words[index];
      const boxNumber = index + 1;

      const row = document.createElement('div');
      row.className = 'word-row';
      row.setAttribute('data-box', boxNumber);
      row.id = `wordRow-${boxNumber}`;

      // Solid White Box Architecture with strict containment
      row.innerHTML = `
        <div class="word-box" id="wordBox-${boxNumber}">
          <!-- REVEALED STAGE -->
          <div class="revealed-stage">
            <span class="revealed-word" id="revealedWord-${boxNumber}">${escapeHtml(word.toUpperCase())}</span>
          </div>

          <!-- MYSTERY SLIDING COVER -->
          <div class="mystery-cover" aria-hidden="true">
            <div class="circle-number">${boxNumber}</div>
          </div>
        </div>
      `;

      // Strict read-only enforcement: tiles are display-only (no click/reveal)
      row.style.pointerEvents = 'none';
      row.style.userSelect = 'none';
      row.style.webkitUserSelect = 'none';

      gameBoard.appendChild(row);
    }

    requestAnimationFrame(() => {
      fitAllWords();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // Reveal / Hide Handlers
  // ==========================================================================
  function revealBox(boxNumber, wordText, playSound = true) {
    const row = document.querySelector(`.word-row[data-box="${boxNumber}"]`);
    if (!row) return;

    const wordEl = row.querySelector('.revealed-word');
    if (wordText && wordEl) {
      wordEl.textContent = wordText.toUpperCase();
    }
    if (wordEl) {
      fitWord(wordEl);
    }

    if (!row.classList.contains('revealed')) {
      row.classList.add('revealed');
      if (playSound) {
        playBouncyPop();
      }
    }
  }

  function hideBox(boxNumber) {
    const row = document.querySelector(`.word-row[data-box="${boxNumber}"]`);
    if (row) {
      row.classList.remove('revealed');
    }
  }

  function toggleReveal(boxNumber) {
    const row = document.querySelector(`.word-row[data-box="${boxNumber}"]`);
    if (row) {
      if (row.classList.contains('revealed')) {
        hideBox(boxNumber);
      } else {
        revealBox(boxNumber);
      }
    }
  }

  function revealAllBoxes() {
    const rows = document.querySelectorAll('.word-row');
    rows.forEach((row, idx) => {
      const box = row.getAttribute('data-box');
      setTimeout(() => {
        revealBox(box, null, idx === 0 || idx === rows.length - 1);
      }, idx * 100);
    });
    playBouncyPop();
  }

  function hideAllBoxes() {
    document.querySelectorAll('.word-row').forEach(row => {
      row.classList.remove('revealed');
    });
  }

  // ==========================================================================
  // Contestant & Timer Sync Handlers
  // ==========================================================================
  function updateContestant(name, category) {
    const hasName = name && name.trim().length > 0;
    const hasCategory = category && category.trim().length > 0;

    boardChatterName.textContent = hasName ? name.trim() : '@Chatter';
    boardCategoryHint.textContent = hasCategory ? category.trim().toUpperCase() : 'SECRET PHRASE';
  }

  function updateTimer(seconds, state) {
    if (!boardTimerBadge || !boardTimerText) return;

    if (state === 'reset' || seconds === null || seconds === undefined) {
      boardTimerText.textContent = '1:00';
      boardTimerBadge.classList.remove('urgent');
      return;
    }

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    boardTimerText.textContent = `${m}:${s.toString().padStart(2, '0')}`;

    if (seconds <= 10 && seconds > 0) {
      if (!boardTimerBadge.classList.contains('urgent')) {
         boardTimerBadge.classList.add('urgent');
      }
      playTimerBuzzer();
    } else {
      boardTimerBadge.classList.remove('urgent');
      if (seconds === 0 && state !== 'reset') {
        playTimerBuzzer(); // Extra pop on exactly 0
      }
    }
  }

  // ==========================================================================
  // Host-Controlled Single Word Hint
  // ==========================================================================
  function updateWordHint(boxNumber, hint, active = true) {
    if (!clueBox || !boardWordHint) return;

    const normalizedHint = typeof hint === 'string' ? hint.trim() : '';
    const validBox = Number(boxNumber);

    if (!active || !normalizedHint || !Number.isInteger(validBox) || validBox < 1 || validBox > 8) {
      clueBox.classList.remove('has-hint');
      boardWordHint.textContent = 'WAITING FOR HOST CLUE';
      return;
    }

    boardWordHint.textContent = `HINT FOR WORD #${validBox}: ${normalizedHint}`;
    clueBox.classList.add('has-hint');
  }

  // ==========================================================================
  // WebSocket Message Dispatcher
  // ==========================================================================
  function handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.roomCode && data.roomCode !== roomCode) return;
      console.log('Board received payload:', data);

      switch (data.action) {
        case 'reveal':
          if (data.box !== undefined) {
            revealBox(data.box, data.word);
          }
          break;

        case 'hide':
          if (data.box !== undefined) {
            hideBox(data.box);
          }
          break;

        case 'reveal_all':
          revealAllBoxes();
          break;

        case 'hide_all':
        case 'reset':
          hideAllBoxes();
          updateWordHint(null, '', false);
          break;

        case 'setup':
          if (Array.isArray(data.words)) {
            renderBoard(data.words);
          }
          break;

        case 'contestant':
          updateContestant(data.name, data.category);
          break;

        case 'timer':
           updateTimer(data.seconds, data.state);
           break;

        case 'word_hint':
          updateWordHint(data.box, data.hint, data.active !== false);
          break;

        case 'panelist_turn':
          if (Array.isArray(data.panelists)) {
            panelists = data.panelists;
          }
          const prevIndex = activePanelistIndex;
          activePanelistIndex = (data.activeIndex !== undefined) ? data.activeIndex : -1;
          renderPanelistRoster();

          if (activePanelistIndex >= 0 && activePanelistIndex !== prevIndex) {
            playTurnSwitchSound();
          }
          break;

        case 'secret_action':
          playSquishSplat();
          const hintEl = document.getElementById('boardCategoryHint');
          if (hintEl && data.text) {
             hintEl.textContent = data.text;
             hintEl.style.color = '#84cc16'; // slime green
          }
          break;

        default:
          break;
      }
    } catch (err) {
      console.warn('Failed to parse WebSocket message:', event.data, err);
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const wsUrl = getWebSocketUrl();

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('WebSocket connection error:', err);
      updateStatus('disconnected', 'ERROR');
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log(`Board overlay connected to WebSocket at ${wsUrl} in room ${roomCode}`);
      ws.send(JSON.stringify({
        action: 'join-room',
        roomCode
      }));
      updateStatus('connected');
    };

    ws.onclose = () => {
      console.warn('Board overlay disconnected.');
      updateStatus('disconnected', 'OFFLINE');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('Board WebSocket error:', err);
      updateStatus('disconnected', 'ERROR');
    };

    ws.onmessage = handleMessage;
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      updateStatus('connecting');
      connect();
    }, 2000);
  }

  // Initialize roster, 2x4 board and connection
  renderPanelistRoster();
  renderBoard(currentWords);
  connect();

  // Resize and font ready hooks for dynamic word container scaling
  window.addEventListener('resize', fitAllWords);
  if (window.ResizeObserver && gameBoard) {
    new ResizeObserver(fitAllWords).observe(gameBoard);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAllWords);
  }
})();
