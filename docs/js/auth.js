// auth.js — removed (no authentication required)


  // ── Lockout state (persisted so it survives page reload) ──
  function getLockout() {
    return Storage.lsGet('lockout', { attempts: 0, lockedUntil: 0 });
  }
  function saveLockout(state) {
    Storage.lsSet('lockout', state);
  }
  function resetLockout() {
    saveLockout({ attempts: 0, lockedUntil: 0 });
  }

  function isLockedOut() {
    const { lockedUntil } = getLockout();
    return Date.now() < lockedUntil;
  }

  function lockoutSecondsLeft() {
    const { lockedUntil } = getLockout();
    return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  }

  function recordFailedAttempt() {
    const state = getLockout();
    state.attempts += 1;
    if (state.attempts >= MAX_ATTEMPTS) {
      state.lockedUntil = Date.now() + LOCKOUT_MS;
      state.attempts = 0;
    }
    saveLockout(state);
  }

  // ── Profile setup ────────────────────────────────

  async function setupProfile(name, pin) {
    const hash = await hashPIN(pin);
    Storage.saveProfile({ name: name.trim(), pinHash: hash });
    resetLockout();
    sessionStorage.setItem('fp_authed', '1');
  }

  // ── Verify PIN ───────────────────────────────────

  async function verifyPIN(pin) {
    const profile = Storage.getProfile();
    if (!profile) return false;
    const hash = await hashPIN(pin);
    return hash === profile.pinHash;
  }

  // ── Session auth ─────────────────────────────────

  function isAuthenticated() {
    return sessionStorage.getItem('fp_authed') === '1';
  }

  function authenticate() {
    sessionStorage.setItem('fp_authed', '1');
    resetLockout();
  }

  function deauthenticate() {
    sessionStorage.removeItem('fp_authed');
  }

  // ── Change PIN ───────────────────────────────────

  async function changePIN(newPin) {
    const profile = Storage.getProfile();
    if (!profile) return;
    profile.pinHash = await hashPIN(newPin);
    Storage.saveProfile(profile);
  }

  return {
    setupProfile,
    verifyPIN,
    isAuthenticated,
    authenticate,
    deauthenticate,
    changePIN,
    isLockedOut,
    lockoutSecondsLeft,
    recordFailedAttempt,
    resetLockout,
  };
})();

// ── PIN screen controller ────────────────────────────────────────────────────

const PinScreen = (() => {
  let _entered = '';
  let _lockoutTimer = null;

  function init() {
    const profile = Storage.getProfile();

    if (!profile) {
      // First time — show setup
      document.getElementById('screen-setup').classList.remove('hidden');
      initSetup();
      return;
    }

    document.getElementById('screen-pin').classList.remove('hidden');
    const greeting = document.getElementById('pin-greeting');
    if (greeting) greeting.textContent = `Привет, ${profile.name}! Введите PIN-код:`;
    initKeypad();

    // Check if already locked out on page load
    if (Auth.isLockedOut()) {
      startLockoutCountdown();
    }
  }

  function initSetup() {
    const btn = document.getElementById('setup-submit');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const name = document.getElementById('setup-name').value.trim();
      const pin  = document.getElementById('setup-pin').value;
      const pin2 = document.getElementById('setup-pin2').value;
      const err  = document.getElementById('setup-error');

      if (!name) { err.textContent = 'Введите имя.'; return; }
      if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN-код должен состоять из 4 цифр.'; return; }
      if (pin !== pin2) { err.textContent = 'PIN-коды не совпадают.'; return; }

      err.textContent = '';
      await Auth.setupProfile(name, pin);
      window.location.href = 'home.html';
    });

    // Allow Enter key on last field
    document.getElementById('setup-pin2').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('setup-submit').click();
    });
  }

  function initKeypad() {
    document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
      btn.addEventListener('click', () => pressDigit(btn.dataset.digit));
    });
    const del = document.getElementById('pin-del');
    if (del) del.addEventListener('click', pressDelete);
  }

  function pressDigit(d) {
    if (Auth.isLockedOut()) return;
    if (_entered.length >= 4) return;
    _entered += d;
    updateDots();
    if (_entered.length === 4) {
      submitPIN();
    }
  }

  function pressDelete() {
    if (_entered.length > 0) {
      _entered = _entered.slice(0, -1);
      updateDots();
    }
  }

  function updateDots() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) {
        dot.classList.toggle('filled', i < _entered.length);
        dot.classList.remove('error');
      }
    }
  }

  function showError() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) { dot.classList.remove('filled'); dot.classList.add('error'); }
    }
    setTimeout(() => {
      _entered = '';
      updateDots();
    }, 600);
  }

  async function submitPIN() {
    const pin = _entered;
    _entered = '';
    updateDots();

    const ok = await Auth.verifyPIN(pin);
    if (ok) {
      Auth.authenticate();
      window.location.href = 'home.html';
    } else {
      Auth.recordFailedAttempt();
      showError();

      if (Auth.isLockedOut()) {
        startLockoutCountdown();
      } else {
        const state = Storage.lsGet('lockout', { attempts: 0 });
        const left  = MAX_ATTEMPTS - state.attempts;
        const msg   = document.getElementById('pin-message');
        if (msg) msg.textContent = `Неверный PIN. Осталось попыток: ${left}`;
      }
    }
  }

  function startLockoutCountdown() {
    const msg = document.getElementById('pin-message');

    function tick() {
      const s = Auth.lockoutSecondsLeft();
      if (s <= 0) {
        if (msg) msg.textContent = '';
        clearInterval(_lockoutTimer);
        return;
      }
      if (msg) msg.textContent = `Слишком много попыток. Подождите ${s} сек.`;
    }
    tick();
    _lockoutTimer = setInterval(tick, 500);
  }

  return { init };
})();
