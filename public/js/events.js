// ============================================================================
// EVENTS -- DOM event binding & landing logic
// ============================================================================

import { state, elements, STORAGE_KEYS, getOrCreateBrowserId } from './state.js';
import { clearSession, removeFromStorage } from './storage.js';
import {
  showLanding, hideModal, flashStatus,
  handlePlayAgain, handleQuit,
} from './ui.js';
import { cancelPromotion } from './board.js';

// ============================================================================
// MUTATOR SETTINGS
// ============================================================================

export async function initMutatorSettings() {
  try {
    const res = await fetch('/api/rules');
    const data = await res.json();
    state.allRules = data.rules;
    renderMutatorSettings(data.rules, data.categories);
  } catch (err) {
    console.warn('Failed to load mutator rules:', err);
  }
}

export function renderMutatorSettings(rules, categories) {
  const container = document.getElementById('mutator-categories');
  if (!container) return;
  container.innerHTML = '';

  const grouped = {};
  for (const cat of categories) grouped[cat] = [];
  for (const rule of rules) {
    if (grouped[rule.category]) grouped[rule.category].push(rule);
  }

  for (const [cat, catRules] of Object.entries(grouped)) {
    if (catRules.length === 0) continue;
    const catName = cat.charAt(0).toUpperCase() + cat.slice(1);

    const section = document.createElement('div');
    section.className = 'mutator-cat-section';
    section.innerHTML = `
      <div class="mutator-cat-header" data-cat="${cat}">
        <span class="mutator-cat-arrow">&#9656;</span>
        <span>${catName} (${catRules.length})</span>
        <label class="toggle-label cat-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" class="cat-toggle-input" data-cat="${cat}" checked> All
        </label>
      </div>
      <div class="mutator-cat-rules hidden" data-cat-rules="${cat}"></div>
    `;

    const rulesContainer = section.querySelector('.mutator-cat-rules');
    for (const rule of catRules) {
      const row = document.createElement('label');
      row.className = 'mutator-rule-toggle';
      row.title = rule.description;
      row.innerHTML = `<input type="checkbox" class="rule-toggle-input" data-rule-id="${rule.id}" checked> ${rule.name}`;
      rulesContainer.appendChild(row);
    }

    section.querySelector('.mutator-cat-header').addEventListener('click', () => {
      const rulesDiv = section.querySelector('.mutator-cat-rules');
      const arrow = section.querySelector('.mutator-cat-arrow');
      rulesDiv.classList.toggle('hidden');
      arrow.textContent = rulesDiv.classList.contains('hidden') ? '\u25B8' : '\u25BE';
    });

    container.appendChild(section);
  }

  // Wire individual toggles
  container.querySelectorAll('.rule-toggle-input').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) {
        state.disabledMutators.delete(input.dataset.ruleId);
      } else {
        state.disabledMutators.add(input.dataset.ruleId);
      }
      updateMutatorSummary();
    });
  });

  // Wire category toggles
  container.querySelectorAll('.cat-toggle-input').forEach(input => {
    input.addEventListener('change', () => {
      const cat = input.dataset.cat;
      const ruleInputs = container.querySelectorAll(`.mutator-cat-rules[data-cat-rules="${cat}"] .rule-toggle-input`);
      ruleInputs.forEach(ri => {
        ri.checked = input.checked;
        if (input.checked) state.disabledMutators.delete(ri.dataset.ruleId);
        else state.disabledMutators.add(ri.dataset.ruleId);
      });
      updateMutatorSummary();
    });
  });

  // Wire master toggle
  const masterToggle = document.getElementById('mutator-toggle-all');
  if (masterToggle) {
    masterToggle.addEventListener('change', () => {
      const allInputs = container.querySelectorAll('.rule-toggle-input');
      const catInputs = container.querySelectorAll('.cat-toggle-input');
      allInputs.forEach(i => { i.checked = masterToggle.checked; });
      catInputs.forEach(i => { i.checked = masterToggle.checked; });
      if (masterToggle.checked) {
        state.disabledMutators.clear();
      } else {
        state.allRules.forEach(r => state.disabledMutators.add(r.id));
      }
      updateMutatorSummary();
    });
  }

  // Wire manual coin flip checkbox
  const manualFlipCb = document.getElementById('manual-coin-flip');
  if (manualFlipCb) {
    manualFlipCb.addEventListener('change', () => {
      state.manualCoinFlip = manualFlipCb.checked;
      updateMutatorSummary();
    });
  }

  // Wire collapsible panel toggle
  const toggle = document.getElementById('mutator-settings-toggle');
  const panel = document.getElementById('mutator-settings-panel');
  if (toggle && panel) {
    toggle.addEventListener('click', () => panel.classList.toggle('hidden'));
  }
}

export function updateMutatorSummary() {
  const summary = document.getElementById('mutator-settings-summary');
  if (summary) {
    const enabled = state.allRules.length - state.disabledMutators.size;
    if (enabled === state.allRules.length) {
      summary.textContent = '(All enabled)';
    } else {
      summary.textContent = `(${enabled}/${state.allRules.length} enabled)`;
    }
  }

  // Heads-up notice on the create form: custom rule pool / manual flip won't count
  const notice = document.getElementById('create-leaderboard-notice');
  if (notice) {
    const isModified = state.disabledMutators.size > 0 || state.manualCoinFlip;
    notice.textContent = isModified
      ? "Heads-up: this room won't count toward the leaderboard (custom rule pool)."
      : '';
    notice.classList.toggle('hidden', !isModified);
  }
}

// ============================================================================
// LANDING PAGE EVENTS
// ============================================================================

export function bindLandingEvents() {
  if (elements.createRoomBtn) {
    elements.createRoomBtn.addEventListener('click', () => {
      elements.joinCodeSection?.classList.add('hidden');
      elements.createOptionsSection?.classList.toggle('hidden');
    });
  }

  if (elements.joinRoomBtn) {
    elements.joinRoomBtn.addEventListener('click', () => {
      elements.createOptionsSection?.classList.add('hidden');
      elements.joinCodeSection?.classList.toggle('hidden');
      if (!elements.joinCodeSection?.classList.contains('hidden')) {
        elements.roomCodeInput?.focus();
      }
    });
  }

  if (elements.playBotBtn) {
    elements.playBotBtn.addEventListener('click', () => {
      const name = getPlayerName();
      if (!name) return;
      setButtonsLoading(true);
      state.socket.emit('joinBot', {
        name,
        browserId: getOrCreateBrowserId(),
        disabledMutators: [...state.disabledMutators],
        manualCoinFlip: state.manualCoinFlip,
      });
    });
  }

  if (elements.createRoomSubmit) {
    elements.createRoomSubmit.addEventListener('click', () => {
      const name = getPlayerName();
      if (!name) return;
      const color = elements.colorSelect?.value || undefined;
      const isPrivate = elements.privateCheck?.checked || false;
      setButtonsLoading(true);
      state.socket.emit('createRoom', {
        name,
        browserId: getOrCreateBrowserId(),
        preferredColor: color || undefined,
        isPrivate,
        disabledMutators: [...state.disabledMutators],
        manualCoinFlip: state.manualCoinFlip,
      });
    });
  }

  if (elements.joinCodeSubmit) {
    elements.joinCodeSubmit.addEventListener('click', submitJoinCode);
  }

  if (elements.roomCodeInput) {
    elements.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitJoinCode();
      }
    });
  }

}

function submitJoinCode() {
  const name = getPlayerName();
  if (!name) return;
  const code = elements.roomCodeInput?.value.trim();
  if (!code) {
    showJoinError('Please enter a room code.');
    return;
  }
  setButtonsLoading(true);
  state.socket.emit('joinRoom', { name, roomCode: code, browserId: getOrCreateBrowserId() });
}

export function getPlayerName() {
  const name = elements.nameInput?.value.trim();
  if (!name) {
    showJoinError('Please enter a name.');
    return null;
  }
  return name;
}

export function showJoinError(message) {
  if (elements.joinError) {
    elements.joinError.textContent = message;
  }
}

export function clearJoinError() {
  if (elements.joinError) {
    elements.joinError.textContent = '';
  }
}

export function setButtonsLoading(loading) {
  const btns = [
    elements.createRoomBtn,
    elements.joinRoomBtn,
    elements.playBotBtn,
    elements.createRoomSubmit,
    elements.joinCodeSubmit,
  ];
  btns.forEach(btn => {
    if (btn) btn.disabled = loading;
  });
  if (elements.nameInput) {
    elements.nameInput.disabled = loading;
  }
}

// ============================================================================
// WAITING ROOM EVENTS
// ============================================================================

export function bindWaitingEvents() {
  if (elements.roomCodeCopy) {
    elements.roomCodeCopy.addEventListener('click', () => {
      const code = elements.roomCodeText?.dataset.code;
      if (code) {
        copyToClipboard(code);
      }
    });
  }

  if (elements.roomCodeToggle) {
    elements.roomCodeToggle.addEventListener('click', () => {
      const codeEl = elements.roomCodeText;
      if (!codeEl?.dataset.code) return;
      const hidden = codeEl.textContent === '****';
      codeEl.textContent = hidden ? codeEl.dataset.code : '****';
      elements.roomCodeToggle.textContent = hidden ? 'Hide' : 'Show';
    });
  }

  if (elements.cancelWaitingBtn) {
    elements.cancelWaitingBtn.addEventListener('click', () => {
      if (state.socket) {
        state.socket.disconnect();
        state.socket.connect();
      }
      clearSession();
      showLanding();
    });
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    if (elements.copyFeedback) {
      elements.copyFeedback.classList.remove('hidden');
      setTimeout(() => {
        elements.copyFeedback.classList.add('hidden');
      }, 1500);
    }
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(textarea);
  });
}

// ============================================================================
// GAME EVENTS
// ============================================================================

export function bindGameEvents() {
  if (elements.resignButton) {
    elements.resignButton.addEventListener('click', () => {
      if (state.isSpectator) return;
      if (!state.isGameActive) {
        flashStatus('No active game to resign from.', 3000);
        return;
      }
      if (confirm('Are you sure you want to resign?')) {
        state.socket.emit('resign');
      }
    });
  }

  const quietResignBtn = document.getElementById('quiet-resign-btn');
  if (quietResignBtn) {
    quietResignBtn.addEventListener('click', () => {
      if (state.isSpectator || !state.isGameActive) return;
      if (confirm('Resign without penalty? Your opponent has been stalling, so neither of you will be scored.')) {
        state.socket.emit('quietResign');
      }
    });
  }

  if (elements.disableSpectatingBtn) {
    elements.disableSpectatingBtn.addEventListener('click', () => {
      if (confirm('Disable spectating? This cannot be undone.')) {
        state.socket.emit('disableSpectating');
        elements.disableSpectatingBtn.classList.add('hidden');
      }
    });
  }

  if (elements.sidebarCodeToggle) {
    elements.sidebarCodeToggle.addEventListener('click', () => {
      const codeEl = elements.sidebarRoomCode;
      if (!codeEl?.dataset.code) return;
      const hidden = codeEl.textContent === '****';
      codeEl.textContent = hidden ? codeEl.dataset.code : '****';
      elements.sidebarCodeToggle.textContent = hidden ? 'Hide' : 'Show';
    });
  }

  // Fullscreen toggle
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      document.body.classList.toggle('fullscreen');
      const isFullscreen = document.body.classList.contains('fullscreen');
      fullscreenBtn.textContent = isFullscreen ? '⛶' : '⛶';
      fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    });
  }

  // Exit fullscreen on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
      document.body.classList.remove('fullscreen');
      const fullscreenBtn = document.getElementById('fullscreen-btn');
      if (fullscreenBtn) {
        fullscreenBtn.textContent = '⛶';
        fullscreenBtn.title = 'Enter fullscreen';
      }
    }
  });
}

// ============================================================================
// MODAL EVENTS
// ============================================================================

export function bindModalEvents() {
  if (elements.gameOverNewGame) {
    elements.gameOverNewGame.addEventListener('click', handlePlayAgain);
  }
  if (elements.gameOverQuit) {
    elements.gameOverQuit.addEventListener('click', handleQuit);
  }
  if (elements.gameOverModal) {
    elements.gameOverModal.addEventListener('click', (e) => {
      if (e.target === elements.gameOverModal) hideModal('game-over-modal');
    });
  }

  if (elements.promotionModal) {
    elements.promotionModal.addEventListener('click', (e) => {
      if (e.target === elements.promotionModal) {
        cancelPromotion();
      }
    });
  }
}
