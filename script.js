(() => {
  'use strict';

  /*
   * หมากฮอสไทย (Mak-hot)
   * - กระดาน 8x8 ฝ่ายละ 8 ตัว วางบนช่องสีเข้มของ 2 แถวแรกของแต่ละฝ่าย ขาวเดินก่อน
   * - เบี้ยเดินเฉียงไปข้างหน้าทีละ 1 ช่อง และกินได้เฉพาะข้างหน้า (ถอยหลังกินไม่ได้)
   * - เบี้ยที่ถึงแถวสุดท้ายกลายเป็น "ฮอส" ซึ่งเดินได้ไกลทุกทิศตามแนวเฉียง
   * - ฮอสกินระยะไกลได้ทั้งหน้าและหลัง แต่ต้องลงช่องที่อยู่ติดหลังหมากที่กินทันที
   * - ถ้ากินได้ต้องกิน เลือกทางกินใดก็ได้ (ไม่บังคับกินจำนวนมากที่สุด) กินต่อเนื่องได้
   * - หมากที่ถูกกินยกออกทันที เบี้ยที่กินจนถึงแถวสุดท้ายเป็นฮอสและจบตา
   * - ฝ่ายที่ไม่มีหมากหรือเดินไม่ได้ เป็นฝ่ายแพ้
   * - เสมอ: ตำแหน่งซ้ำ 3 ครั้ง หรือเดินฮอสล้วนโดยไม่กินครบฝ่ายละ 32 ตา
   */

  const SIZE = 8;
  const ROWS_PER_SIDE = 2;
  const NAME = { white: 'ขาว', black: 'ดำ' };
  const DEPTH = { easy: 1, normal: 4, hard: 7 };
  const LEVEL_NAME = { easy: 'ง่าย', normal: 'ปานกลาง', hard: 'ยาก' };
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const QUIET_LIMIT = 64; // 32 ตาต่อฝ่าย = 64 ply

  const $ = id => document.getElementById(id);
  const screens = {
    title: $('screen-title'),
    mode: $('screen-mode'),
    game: $('screen-game'),
  };
  const boardEl = $('board');
  const statusEl = $('status');
  const turnDot = $('turn-dot');
  const whiteCountEl = $('white-count');
  const blackCountEl = $('black-count');
  const moveCountEl = $('move-count');
  const nameWhiteEl = $('name-white');
  const nameBlackEl = $('name-black');
  const modeLabelEl = $('mode-label');
  const overlays = {
    gameover: $('overlay-gameover'),
    rules: $('overlay-rules'),
    confirm: $('overlay-confirm'),
  };

  // การตั้งค่าที่ผู้เล่นเลือกในหน้าเลือกโหมด
  const settings = { mode: 'ai', level: 'normal', side: 'white' };
  let aiColor = 'black';
  let state = null;

  /* ====================================================== */
  /*  ตรรกะเกม                                                */
  /* ====================================================== */
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const opp = color => (color === 'white' ? 'black' : 'white');
  const promoRow = color => (color === 'white' ? 0 : SIZE - 1);
  const forward = color => (color === 'white' ? -1 : 1);
  const cloneBoard = b => b.map(row => row.map(p => (p ? { ...p } : null)));
  const same = (a, b) => a.r === b.r && a.c === b.c;

  function countPieces(board) {
    const n = { white: 0, black: 0 };
    board.forEach(row => row.forEach(p => { if (p) n[p.color]++; }));
    return n;
  }

  function initialBoard() {
    const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 !== 1) continue;
        if (r < ROWS_PER_SIDE) b[r][c] = { color: 'black', king: false };
        else if (r >= SIZE - ROWS_PER_SIDE) b[r][c] = { color: 'white', king: false };
      }
    }
    return b;
  }

  function positionKey(board, turn) {
    return turn[0] + board.map(row => row.map(p => {
      if (!p) return '.';
      const ch = p.color === 'white' ? 'w' : 'b';
      return p.king ? ch.toUpperCase() : ch;
    }).join('')).join('/');
  }

  // ลำดับการเดิน = { path: [จุดลงจอดต่อเนื่อง], caps: [หมากที่ถูกกินในแต่ละก้าว หรือ null] }
  function captureDFS(work, piece, r, c, path, caps, out) {
    let found = false;
    const dirs = piece.king ? DIRS : DIRS.filter(([dr]) => dr === forward(piece.color));

    for (const [dr, dc] of dirs) {
      let or = r + dr, oc = c + dc;
      if (piece.king) {
        while (inBounds(or, oc) && !work[or][oc]) { or += dr; oc += dc; }
      }
      if (!inBounds(or, oc)) continue;

      const over = work[or][oc];
      if (!over || over.color === piece.color) continue;

      // ต้องลงช่องที่ติดหลังหมากที่กินทันที และช่องนั้นต้องว่าง
      const lr = or + dr, lc = oc + dc;
      if (!inBounds(lr, lc) || work[lr][lc]) continue;

      found = true;
      work[or][oc] = null; // ยกหมากที่ถูกกินออกทันที
      const nPath = [...path, { r: lr, c: lc }];
      const nCaps = [...caps, { r: or, c: oc }];
      if (!piece.king && lr === promoRow(piece.color)) {
        out.push({ path: nPath, caps: nCaps }); // เบี้ยถึงแถวสุดท้าย เป็นฮอสและจบตา
      } else {
        captureDFS(work, piece, lr, lc, nPath, nCaps, out);
      }
      work[or][oc] = over;
    }

    if (!found && path.length > 1) out.push({ path, caps });
  }

  function getSeqs(board, color) {
    const jumps = [];
    const walks = [];

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = board[r][c];
        if (!p || p.color !== color) continue;

        board[r][c] = null; // เอาตัวที่เดินออกชั่วคราว
        captureDFS(board, p, r, c, [{ r, c }], [], jumps);
        board[r][c] = p;

        for (const [dr, dc] of DIRS) {
          if (!p.king && dr !== forward(color)) continue;
          let nr = r + dr, nc = c + dc;
          while (inBounds(nr, nc) && !board[nr][nc]) {
            walks.push({ path: [{ r, c }, { r: nr, c: nc }], caps: [null] });
            if (!p.king) break;
            nr += dr; nc += dc;
          }
        }
      }
    }

    return jumps.length ? jumps : walks; // ถ้ากินได้ ต้องกิน
  }

  function applySeq(board, seq) {
    const b = cloneBoard(board);
    const from = seq.path[0];
    const to = seq.path[seq.path.length - 1];
    const p = b[from.r][from.c];
    b[from.r][from.c] = null;
    seq.caps.forEach(cap => { if (cap) b[cap.r][cap.c] = null; });
    if (!p.king && to.r === promoRow(p.color)) p.king = true;
    b[to.r][to.c] = p;
    return b;
  }

  /* ---------- คอมพิวเตอร์ (minimax + alpha-beta) ---------- */
  function evaluate(b) {
    let s = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = b[r][c];
        if (!p) continue;
        const adv = p.color === 'white' ? (SIZE - 1 - r) : r;
        const v = p.king ? 3.2 : 1 + adv / 30;
        s += p.color === aiColor ? v : -v;
      }
    }
    return s;
  }

  function minimax(board, color, depth, alpha, beta) {
    const seqs = getSeqs(board, color);
    if (!seqs.length) return color === aiColor ? -1000 - depth : 1000 + depth;
    if (depth === 0) return evaluate(board);

    if (color === aiColor) {
      let best = -Infinity;
      for (const s of seqs) {
        best = Math.max(best, minimax(applySeq(board, s), opp(color), depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const s of seqs) {
      best = Math.min(best, minimax(applySeq(board, s), opp(color), depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  function chooseAISeq() {
    const seqs = state.all;
    if (settings.level === 'easy' && Math.random() < 0.25) {
      return seqs[Math.floor(Math.random() * seqs.length)];
    }
    const depth = DEPTH[settings.level];
    let bestScore = -Infinity;
    let pool = [];
    for (const s of seqs) {
      const score = minimax(applySeq(state.board, s), opp(aiColor), depth - 1, -Infinity, Infinity);
      if (score > bestScore + 1e-9) { bestScore = score; pool = [s]; }
      else if (Math.abs(score - bestScore) < 1e-9) pool.push(s);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* ====================================================== */
  /*  สถานะและการเล่น                                         */
  /* ====================================================== */
  function isAIMode() { return settings.mode === 'ai'; }
  function isAITurn() { return state && isAIMode() && state.turn === aiColor; }
  function humanColor() { return opp(aiColor); }

  function newGame() {
    aiColor = isAIMode() ? opp(settings.side) : null;
    state = {
      board: initialBoard(),
      turn: 'white',
      all: [],
      cands: [],
      step: 0,
      sel: null,
      over: false,
      winner: null,     // null เมื่อเสมอ
      drawReason: '',
      endReason: '',
      busy: false,
      last: [],
      moveInfo: null,
      quiet: 0,
      moves: 0,
      history: {},
      flip: isAIMode() && settings.side === 'black', // เล่นเป็นดำ ให้หมุนกระดานให้ฝั่งเราอยู่ด้านล่าง
    };
    state.history[positionKey(state.board, state.turn)] = 1;
    state.all = getSeqs(state.board, state.turn);

    // ป้ายชื่อ
    if (isAIMode()) {
      nameWhiteEl.textContent = 'ขาว · ' + (settings.side === 'white' ? 'คุณ' : 'คอมพิวเตอร์');
      nameBlackEl.textContent = 'ดำ · ' + (settings.side === 'black' ? 'คุณ' : 'คอมพิวเตอร์');
      modeLabelEl.textContent = `เล่นกับคอมพิวเตอร์ · ระดับ${LEVEL_NAME[settings.level]}`;
    } else {
      nameWhiteEl.textContent = 'ขาว · ผู้เล่น 1';
      nameBlackEl.textContent = 'ดำ · ผู้เล่น 2';
      modeLabelEl.textContent = 'เล่น 2 คน';
    }
    $('btn-surrender').textContent = isAIMode() ? '🏳 ยอมแพ้' : '🏳 ยอมแพ้ (ตานี้)';

    render();
    if (isAITurn()) runAI();
  }

  function movePiece(from, to, cap) {
    const b = state.board;
    if (!state.moveInfo) state.moveInfo = { king: b[from.r][from.c].king, capture: !!cap };
    b[to.r][to.c] = b[from.r][from.c];
    b[from.r][from.c] = null;
    if (cap) b[cap.r][cap.c] = null; // ยกหมากที่ถูกกินออกทันที
    state.last = [from, to];
  }

  function finishTurn(endPos) {
    const b = state.board;

    // เบี้ยที่จบตาที่แถวสุดท้าย กลายเป็นฮอส
    const p = b[endPos.r][endPos.c];
    if (p && !p.king && endPos.r === promoRow(p.color)) p.king = true;

    // นับตาเดินฮอสล้วนโดยไม่กิน
    const info = state.moveInfo || { king: false, capture: true };
    state.quiet = info.king && !info.capture ? state.quiet + 1 : 0;
    state.moveInfo = null;
    state.moves++;

    state.turn = opp(state.turn);
    state.cands = [];
    state.step = 0;
    state.sel = null;
    state.busy = false;
    state.all = getSeqs(b, state.turn);

    const key = positionKey(b, state.turn);
    state.history[key] = (state.history[key] || 0) + 1;

    if (!state.all.length) {
      const loser = state.turn;
      state.over = true;
      state.winner = opp(loser);
      state.endReason = countPieces(b)[loser] === 0
        ? `${NAME[loser]}ไม่มีหมากเหลือแล้ว`
        : `${NAME[loser]}ไม่มีทางเดินแล้ว`;
    } else if (state.history[key] >= 3) {
      state.over = true;
      state.drawReason = 'ตำแหน่งซ้ำ 3 ครั้ง';
    } else if (state.quiet >= QUIET_LIMIT) {
      state.over = true;
      state.drawReason = 'เดินฮอสโดยไม่กินครบ 32 ตาต่อฝ่าย';
    }
    render();

    if (state.over) {
      const st = state;
      setTimeout(() => { if (state === st) showGameOver(); }, 900);
      return;
    }
    if (isAITurn()) runAI();
  }

  function runAI() {
    const st = state;
    st.busy = true;
    render();
    setTimeout(() => {
      if (state !== st) return;
      const seq = chooseAISeq();
      let i = 0;
      const tick = () => {
        if (state !== st) return;
        movePiece(seq.path[i], seq.path[i + 1], seq.caps[i]);
        i++;
        render();
        if (i < seq.path.length - 1) setTimeout(tick, 420);
        else setTimeout(() => { if (state === st) finishTurn(seq.path[i]); }, 300);
      };
      tick();
    }, 450);
  }

  /* ---------- จัดการการคลิกบนกระดาน ---------- */
  function destinations() {
    const seen = [];
    state.cands.forEach(s => {
      const d = s.path[state.step + 1];
      if (!seen.some(x => same(x, d))) seen.push(d);
    });
    return seen;
  }

  function onSquareClick(r, c) {
    if (!state || state.over || state.busy || isAITurn()) return;
    const pos = { r, c };
    const piece = state.board[r][c];

    // คลิกช่องปลายทาง
    if (state.sel && destinations().some(d => same(d, pos))) {
      const from = state.sel;
      state.cands = state.cands.filter(s => same(s.path[state.step + 1], pos));
      movePiece(from, pos, state.cands[0].caps[state.step]);
      state.step++;

      if (state.cands.some(s => s.path.length - 1 === state.step)) {
        finishTurn(pos);
      } else {
        state.sel = pos;
        render();
      }
      return;
    }

    // เลือก/เปลี่ยนหมาก (ทำได้เฉพาะก่อนเริ่มเดิน)
    if (state.step === 0 && piece && piece.color === state.turn) {
      const cands = state.all.filter(s => same(s.path[0], pos));
      if (cands.length) {
        state.sel = pos;
        state.cands = cands;
      } else {
        state.sel = null;
        state.cands = [];
      }
      render();
    }
  }

  /* ---------- แสดงผลกระดาน ---------- */
  function render() {
    if (!state) return;
    boardEl.innerHTML = '';
    const dests = state.sel ? destinations() : [];
    const movable = state.step === 0 && !state.over && !state.busy && !isAITurn()
      ? state.all.map(s => s.path[0])
      : [];

    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        const r = state.flip ? SIZE - 1 - i : i;
        const c = state.flip ? SIZE - 1 - j : j;

        const sq = document.createElement('div');
        const dark = (r + c) % 2 === 1;
        sq.className = 'square ' + (dark ? 'dark' : 'light');
        sq.dataset.r = r;
        sq.dataset.c = c;

        if (state.last.some(p => p.r === r && p.c === c)) sq.classList.add('last');
        if (dests.some(d => d.r === r && d.c === c)) sq.classList.add('dest');

        const p = state.board[r][c];
        if (p) {
          const el = document.createElement('div');
          el.className = `piece ${p.color}` + (p.king ? ' king' : '');
          if (state.sel && state.sel.r === r && state.sel.c === c) el.classList.add('selected');
          else if (!state.sel && movable.some(m => m.r === r && m.c === c)) el.classList.add('movable');
          sq.appendChild(el);
        }
        boardEl.appendChild(sq);
      }
    }

    const n = countPieces(state.board);
    whiteCountEl.textContent = n.white;
    blackCountEl.textContent = n.black;
    moveCountEl.textContent = state.moves;
    turnDot.className = 'chip ' + (state.over ? (state.winner || 'draw') : state.turn);

    if (state.over) {
      statusEl.textContent = state.winner ? `จบเกม · ${NAME[state.winner]}ชนะ` : 'จบเกม · เสมอ';
    } else if (state.busy) {
      statusEl.textContent = 'คอมพิวเตอร์กำลังคิด...';
    } else {
      let who = `ตาของ${NAME[state.turn]}`;
      if (isAIMode()) who = `ตาของคุณ (${NAME[state.turn]})`;
      if (state.step > 0) who += ' · กินต่อเนื่อง';
      else if (state.all[0] && state.all[0].caps[0]) who += ' · ต้องกิน!';
      statusEl.textContent = who;
    }
  }

  /* ====================================================== */
  /*  หน้าจอและเมนู                                           */
  /* ====================================================== */
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle('active', key === name));
    window.scrollTo(0, 0);
  }

  function openOverlay(name) { overlays[name].classList.remove('hidden'); }
  function closeOverlay(name) { overlays[name].classList.add('hidden'); }
  function closeAllOverlays() { Object.keys(overlays).forEach(closeOverlay); clearConfetti(); }

  function ask(message, onOk) {
    $('confirm-text').textContent = message;
    openOverlay('confirm');
    $('confirm-ok').onclick = () => { closeOverlay('confirm'); onOk(); };
    $('confirm-cancel').onclick = () => closeOverlay('confirm');
  }

  function syncSettingsUI() {
    document.querySelectorAll('.mode-card').forEach(el =>
      el.classList.toggle('selected', el.dataset.mode === settings.mode));
    document.querySelectorAll('.seg').forEach(seg => {
      const group = seg.dataset.group;
      seg.querySelectorAll('button').forEach(b =>
        b.classList.toggle('selected', b.dataset.value === settings[group]));
    });
    $('ai-options').classList.toggle('hidden', !isAIMode());
  }

  function startGame() {
    closeAllOverlays();
    showScreen('game');
    newGame();
  }

  function leaveGame(to) {
    closeAllOverlays();
    state = null; // ยกเลิกงานที่ค้างอยู่ (เช่นคอมพิวเตอร์กำลังคิด)
    showScreen(to);
  }

  /* ---------- หน้าจบเกม ---------- */
  function showGameOver() {
    const st = state;
    const card = $('go-card');
    let kind, icon, title, sub;

    if (!st.winner) {
      kind = 'draw'; icon = '🤝'; title = 'เสมอ'; sub = 'สูสีกันมาก ไม่มีใครเอาชนะได้';
    } else if (isAIMode()) {
      const won = st.winner === humanColor();
      kind = won ? 'win' : 'lose';
      icon = won ? '🏆' : '💔';
      title = won ? 'คุณชนะ!' : 'คุณแพ้';
      sub = won ? 'ยอดเยี่ยม! คุณเอาชนะคอมพิวเตอร์ได้' : 'เสียใจด้วย ลองสู้ใหม่อีกครั้งนะ';
    } else {
      kind = 'win'; icon = '🏆'; title = `${NAME[st.winner]}ชนะ!`; sub = 'ยินดีด้วยกับผู้ชนะ';
    }

    card.className = 'dialog gameover ' + kind;
    $('go-icon').textContent = icon;
    $('go-title').textContent = title;
    $('go-sub').textContent = sub;
    $('go-reason').textContent = st.winner ? st.endReason : st.drawReason;

    const n = countPieces(st.board);
    $('go-stats').innerHTML =
      `<div><strong>${st.moves}</strong>ตาที่เดิน</div>` +
      `<div><strong>${n.white}</strong>ขาวเหลือ</div>` +
      `<div><strong>${n.black}</strong>ดำเหลือ</div>`;

    openOverlay('gameover');
    if (kind === 'win') launchConfetti();
  }

  function launchConfetti() {
    clearConfetti();
    const box = document.createElement('div');
    box.className = 'confetti';
    box.id = 'confetti';
    const colors = ['#f9ca24', '#ff7675', '#74b9ff', '#55efc4', '#fd79a8', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      s.style.animationDelay = Math.random() * 1.2 + 's';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(clearConfetti, 7000);
  }

  function clearConfetti() {
    const el = $('confetti');
    if (el) el.remove();
  }

  function surrender() {
    if (!state || state.over || state.busy) return;
    const loser = isAIMode() ? humanColor() : state.turn;
    state.over = true;
    state.winner = opp(loser);
    state.endReason = `${NAME[loser]}ยอมแพ้`;
    render();
    showGameOver();
  }

  /* ====================================================== */
  /*  เหตุการณ์                                               */
  /* ====================================================== */
  boardEl.addEventListener('click', e => {
    const sq = e.target.closest('.square');
    if (!sq) return;
    onSquareClick(Number(sq.dataset.r), Number(sq.dataset.c));
  });

  // หน้าแรก
  $('btn-play').addEventListener('click', () => { syncSettingsUI(); showScreen('mode'); });
  $('btn-howto').addEventListener('click', () => openOverlay('rules'));

  // หน้าเลือกโหมด
  document.querySelectorAll('.mode-card').forEach(el =>
    el.addEventListener('click', () => { settings.mode = el.dataset.mode; syncSettingsUI(); }));
  document.querySelectorAll('.seg').forEach(seg =>
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[seg.dataset.group] = b.dataset.value;
      syncSettingsUI();
    }));
  $('btn-back-title').addEventListener('click', () => showScreen('title'));
  $('btn-start').addEventListener('click', startGame);

  // หน้าเล่นเกม
  $('btn-menu').addEventListener('click', () => {
    if (state && !state.over && state.moves > 0) {
      ask('ออกจากเกมนี้และกลับไปหน้าแรก?', () => leaveGame('title'));
    } else {
      leaveGame('title');
    }
  });
  $('btn-rules').addEventListener('click', () => openOverlay('rules'));
  $('btn-restart').addEventListener('click', () => {
    if (state && !state.over && state.moves > 0) ask('เริ่มเกมใหม่? ความคืบหน้าจะหายไป', startGame);
    else startGame();
  });
  $('btn-surrender').addEventListener('click', () => {
    if (!state || state.over || state.busy) return;
    ask('ต้องการยอมแพ้ใช่ไหม?', surrender);
  });

  // หน้าจบเกม
  $('btn-again').addEventListener('click', startGame);
  $('btn-change-mode').addEventListener('click', () => { leaveGame('mode'); syncSettingsUI(); });
  $('btn-home').addEventListener('click', () => leaveGame('title'));

  // กติกา
  $('btn-rules-close').addEventListener('click', () => closeOverlay('rules'));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeOverlay('rules'); closeOverlay('confirm'); }
  });

  syncSettingsUI();
  showScreen('title');
})();