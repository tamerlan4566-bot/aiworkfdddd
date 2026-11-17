/* ===== Чертоги Разума — app.js ===== */
/* global CryptoJS */
'use strict';

// ==================== СОСТОЯНИЕ ====================
const STORAGE_KEY_DATA     = 'mind_palace_encrypted_v1';
const STORAGE_KEY_PIN_HASH = 'mind_palace_pin_hash_v1';
const DEFAULT_PIN          = '5477';

let currentPin          = null;
let vaultData           = { cards: [], links: [] };
let currentViewMode     = 'board'; // 'board' или 'notes'
let notesFilterTag      = 'all';
let notesSearchQuery    = '';
let linkMode            = false;
let firstSelectedCardId = null;
let calcInput           = '';

// Единственные ссылки на window-обработчики (делегированные)
let _activeDrag = null;  // { el, cardObj, startX, startY, origX, origY }

// Панорамирование доски
let _panState = null;    // { startX, startY, origScrollX, origScrollY }

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', () => {
    // Инициализируем хэш PIN по умолчанию при первом запуске (или обновляем старый дефолтный 0000)
    const existingHash = localStorage.getItem(STORAGE_KEY_PIN_HASH);
    const oldDefaultHash = CryptoJS.SHA256('0000').toString();
    if (!existingHash || existingHash === oldDefaultHash) {
        localStorage.setItem(STORAGE_KEY_PIN_HASH, CryptoJS.SHA256(DEFAULT_PIN).toString());
    }

    // Привязываем единые делегированные обработчики
    bindCalcButtons();
    bindKeyboard();
    bindDelegatedDrag();
    bindBoardPanning();
    bindSidebarToggle();
    bindModalButtons();
    bindViewSwitcher();
    bindNotesEvents();

    // Регистрация PWA Service Worker
    registerServiceWorker();
});

// ==================== SERVICE WORKER (PWA) ====================
function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js', { scope: './' })
                .then((registration) => {
                    console.log('[PWA] Service Worker успешно зарегистрирован:', registration.scope);
                })
                .catch((error) => {
                    console.warn('[PWA] Ошибка регистрации Service Worker:', error);
                });
        });
    }
}

// ==================== КАЛЬКУЛЯТОР ====================
function bindCalcButtons() {
    document.getElementById('calculator-facade').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-calc]');
        if (!btn) return;
        const action = btn.dataset.calc;

        if (action === 'clear')     { calcClear(); return; }
        if (action === 'backspace') { calcBackspace(); return; }
        if (action === 'eval')      { calcEvaluate(); return; }
        // append
        calcAppend(action);
    });
}

function calcAppend(val) {
    if (calcInput.length > 18) return;
    calcInput += val;
    document.getElementById('calc-display').textContent = calcInput;
}

function calcClear() {
    calcInput = '';
    document.getElementById('calc-display').textContent = '0';
    document.getElementById('calc-history').textContent = '';
}

function calcBackspace() {
    calcInput = calcInput.slice(0, -1);
    document.getElementById('calc-display').textContent = calcInput || '0';
}

function calcEvaluate() {
    if (!calcInput) return;

    // Проверка: это 4-значный PIN?
    if (/^\d{4}$/.test(calcInput)) {
        const enteredHash = CryptoJS.SHA256(calcInput).toString();
        const savedHash   = localStorage.getItem(STORAGE_KEY_PIN_HASH);
        if (enteredHash === savedHash) {
            unlockVault(calcInput);
            calcClear();
            return;
        }
    }

    // Обычный расчёт
    try {
        const sanitized = calcInput.replace(/[^0-9+\-*/.]/g, '');
        const result = Function('"use strict";return (' + sanitized + ')')();
        document.getElementById('calc-history').textContent = calcInput + ' =';
        calcInput = String(Number.isFinite(result) ? Number(result.toFixed(6)) : 'Ошибка');
        document.getElementById('calc-display').textContent = calcInput;
    } catch {
        document.getElementById('calc-display').textContent = 'Ошибка';
        calcInput = '';
    }
}

// Клавиатура: единый глобальный обработчик
function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
        const facade = document.getElementById('calculator-facade');
        if (facade.classList.contains('hidden')) return;

        if (/^[0-9+\-*/.]$/.test(e.key))        { calcAppend(e.key); }
        else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); calcEvaluate(); }
        else if (e.key === 'Backspace')           { calcBackspace(); }
        else if (e.key === 'Escape')              { calcClear(); }
    });
}

// ==================== РАЗБЛОКИРОВКА / ШИФРОВАНИЕ ====================
function unlockVault(pin) {
    currentPin = pin;
    const encrypted = localStorage.getItem(STORAGE_KEY_DATA);

    if (encrypted) {
        try {
            const bytes        = CryptoJS.AES.decrypt(encrypted, currentPin);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
            vaultData          = JSON.parse(decryptedStr);
        } catch (err) {
            console.error('Ошибка расшифровки:', err);
            vaultData = { cards: [], links: [] };
        }
    } else {
        // Демонстрационные карточки
        vaultData = {
            cards: [
                { id: 'card_1', title: 'Дело №001: Вход в Чертоги', desc: 'Все данные шифруются локально алгоритмом AES-256 с ключом на основе твоего PIN-кода.', tag: 'cyan', image: null, x: 120, y: 120 },
                { id: 'card_2', title: 'Красная нить', desc: 'Включи режим «Нить» сверху и нажми на обе карточки, чтобы связать улики.', tag: 'rose', image: null, x: 480, y: 220 }
            ],
            links: [{ from: 'card_1', to: 'card_2' }]
        };
        saveVault();
    }

    document.getElementById('calculator-facade').classList.add('hidden');
    const app = document.getElementById('vault-app');
    app.classList.add('visible');

    // Эффект кинематографичной дешифровки перед показом
    playDecryptAnimation(() => {
        if (currentViewMode === 'board') {
            renderBoard();
        } else {
            renderNotes();
        }
    });
}

function playDecryptAnimation(callback) {
    const overlay = document.getElementById('decrypt-overlay');
    const matrixText = document.getElementById('decrypt-matrix-text');
    const progressBar = document.getElementById('decrypt-progress-bar');
    if (!overlay || !matrixText || !progressBar) {
        if (callback) callback();
        return;
    }

    overlay.classList.remove('hidden');
    let progress = 0;
    const chars = '0123456789ABCDEF!@#$%^&*<>~[]{}';

    const interval = setInterval(() => {
        progress += 10;
        progressBar.style.width = progress + '%';

        let randomStr = '';
        for (let i = 0; i < 35; i++) {
            randomStr += chars[Math.floor(Math.random() * chars.length)];
        }
        matrixText.textContent = randomStr;

        if (progress >= 100) {
            clearInterval(interval);
            setTimeout(() => {
                overlay.classList.add('hidden');
                if (callback) callback();
            }, 180);
        }
    }, 40);
}

function lockVault() {
    saveVault();
    currentPin = null;
    vaultData  = { cards: [], links: [] };
    document.getElementById('cards-layer').innerHTML    = '';
    document.getElementById('strings-layer').innerHTML  = '';
    const app = document.getElementById('vault-app');
    app.classList.remove('visible');
    document.getElementById('calculator-facade').classList.remove('hidden');
}

function saveVault() {
    if (!currentPin) return;
    const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(vaultData), currentPin).toString();
    localStorage.setItem(STORAGE_KEY_DATA, ciphertext);
    updateStats();
}

function changePin() {
    const input  = document.getElementById('new-pin-input');
    const newPin = input.value.trim();
    if (!/^\d{4}$/.test(newPin)) {
        alert('PIN должен состоять ровно из 4 цифр.');
        return;
    }
    currentPin = newPin;
    localStorage.setItem(STORAGE_KEY_PIN_HASH, CryptoJS.SHA256(newPin).toString());
    saveVault();
    input.value = '';
    alert('PIN-код успешно обновлен и база перешифрована.');
}

function hardResetVault() {
    if (confirm('Удалить все карточки, нити и сбросить PIN на 0000? Это действие необратимо.')) {
        localStorage.removeItem(STORAGE_KEY_DATA);
        localStorage.setItem(STORAGE_KEY_PIN_HASH, CryptoJS.SHA256(DEFAULT_PIN).toString());
        lockVault();
    }
}

// ==================== РЕНДЕР ДОСКИ ====================
function renderBoard() {
    const cardsLayer = document.getElementById('cards-layer');
    cardsLayer.innerHTML = '';

    const tagBadge = { cyan: 'badge-cyan', rose: 'badge-rose', amber: 'badge-amber' };

    vaultData.cards.forEach(card => {
        const el       = document.createElement('div');
        el.className   = 'evidence-card' + (firstSelectedCardId === card.id ? ' selected-for-link' : '');
        el.dataset.cardId = card.id;      // для делегированного drag & click
        el.style.left  = card.x + 'px';
        el.style.top   = card.y + 'px';

        const badge = tagBadge[card.tag] || tagBadge.cyan;

        el.innerHTML =
            `<div class="card-topbar">` +
                `<span class="card-badge ${badge}">УЛИКА</span>` +
                `<div class="pin-dot" title="Точка крепления нити"></div>` +
                `<button class="card-delete" data-delete="${card.id}" title="Удалить карточку">✕</button>` +
            `</div>` +
            (card.image ? `<img src="${card.image}" class="card-img" alt="">` : '') +
            `<div class="card-title">${escapeHtml(card.title)}</div>` +
            `<p class="card-desc">${escapeHtml(card.desc)}</p>`;

        cardsLayer.appendChild(el);
    });

    renderStrings();
    updateStats();
}

// ==================== ДЕЛЕГИРОВАННЫЙ DRAG (ЕДИНЫЙ ОБРАБОТЧИК) ====================
function bindDelegatedDrag() {
    const cardsLayer = document.getElementById('cards-layer');

    // ---- Pointer Down (начало перетаскивания ИЛИ клик-связь) ----
    cardsLayer.addEventListener('mousedown',  onCardPointerDown);
    cardsLayer.addEventListener('touchstart', onCardTouchDown, { passive: false });

    // ---- Единый window move / up ----
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup',   onDragEnd);
    window.addEventListener('touchmove', onTouchDragMove, { passive: false });
    window.addEventListener('touchend',  onDragEnd);

    // ---- Клик для удаления карточки и связывания нитей ----
    cardsLayer.addEventListener('click', onCardLayerClick);
}

function getCardContext(target) {
    const el = target.closest('.evidence-card');
    if (!el) return null;
    const id   = el.dataset.cardId;
    const card = vaultData.cards.find(c => c.id === id);
    return card ? { el, card } : null;
}

function onCardPointerDown(e) {
    if (e.target.closest('.card-delete')) return; // кнопка удаления
    const ctx = getCardContext(e.target);
    if (!ctx || linkMode) return;
    e.preventDefault();
    startDrag(ctx, e.clientX, e.clientY);
}

function onCardTouchDown(e) {
    if (e.target.closest('.card-delete')) return;
    const ctx = getCardContext(e.target);
    if (!ctx || linkMode) return;
    e.preventDefault(); // предотвращаем скролл и выделение текста
    const t = e.touches[0];
    startDrag(ctx, t.clientX, t.clientY);
}

function startDrag(ctx, clientX, clientY) {
    _activeDrag = {
        el:     ctx.el,
        cardObj: ctx.card,
        startX: clientX,
        startY: clientY,
        origX:  ctx.card.x,
        origY:  ctx.card.y
    };
    ctx.el.classList.add('dragging');
}

function onDragMove(e) {
    if (!_activeDrag) return;
    moveDrag(e.clientX, e.clientY);
}

function onTouchDragMove(e) {
    if (!_activeDrag) return;
    e.preventDefault(); // предотвращаем скролл страницы
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
}

function moveDrag(cx, cy) {
    const d  = _activeDrag;
    const dx = cx - d.startX;
    const dy = cy - d.startY;
    d.cardObj.x = Math.max(10, d.origX + dx);
    d.cardObj.y = Math.max(10, d.origY + dy);
    d.el.style.left = d.cardObj.x + 'px';
    d.el.style.top  = d.cardObj.y + 'px';
    renderStrings();
}

function onDragEnd() {
    if (!_activeDrag) return;
    _activeDrag.el.classList.remove('dragging');
    _activeDrag = null;
    saveVault();
}

// Делегированный click: удаление карточки + режим нити
function onCardLayerClick(e) {
    // Удаление
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
        e.stopPropagation();
        const cardId = delBtn.dataset.delete;
        vaultData.cards = vaultData.cards.filter(c => c.id !== cardId);
        vaultData.links = vaultData.links.filter(l => l.from !== cardId && l.to !== cardId);
        saveVault();
        renderBoard();
        return;
    }

    // Режим связывания нитью
    if (!linkMode) return;
    const ctx = getCardContext(e.target);
    if (!ctx) return;
    e.stopPropagation();
    handleCardLinkClick(ctx.card.id);
}

// ==================== ПАНОРАМИРОВАНИЕ ДОСКИ (одним пальцем / мышью по пустому фону) ====================
function bindBoardPanning() {
    const container = document.getElementById('board-container');
    const canvas    = document.getElementById('board-canvas');

    let panOffsetX = 0, panOffsetY = 0;

    function applyTransform() {
        canvas.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;
    }

    // --- Mouse ---
    container.addEventListener('mousedown', (e) => {
        // Только если кликнули по фону (не по карточке)
        if (e.target.closest('.evidence-card')) return;
        e.preventDefault();
        _panState = { startX: e.clientX, startY: e.clientY, origOX: panOffsetX, origOY: panOffsetY };
        container.classList.add('panning');
    });
    window.addEventListener('mousemove', (e) => {
        if (!_panState) return;
        panOffsetX = clampPan(_panState.origOX + (e.clientX - _panState.startX), container.clientWidth, canvas.offsetWidth);
        panOffsetY = clampPan(_panState.origOY + (e.clientY - _panState.startY), container.clientHeight, canvas.offsetHeight);
        applyTransform();
    });
    window.addEventListener('mouseup', () => {
        if (_panState) {
            _panState = null;
            container.classList.remove('panning');
        }
    });

    // --- Touch (только если не карточка) ---
    container.addEventListener('touchstart', (e) => {
        if (e.target.closest('.evidence-card')) return;
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        _panState = { startX: t.clientX, startY: t.clientY, origOX: panOffsetX, origOY: panOffsetY };
        container.classList.add('panning');
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!_panState || _activeDrag) return;
        const t = e.touches[0];
        panOffsetX = clampPan(_panState.origOX + (t.clientX - _panState.startX), container.clientWidth, canvas.offsetWidth);
        panOffsetY = clampPan(_panState.origOY + (t.clientY - _panState.startY), container.clientHeight, canvas.offsetHeight);
        applyTransform();
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (_panState && !_activeDrag) {
            _panState = null;
            container.classList.remove('panning');
        }
    });
}

function clampPan(offset, viewportSize, canvasSize) {
    const minOffset = -(canvasSize - viewportSize);
    if (minOffset >= 0) return 0; // canvas меньше viewport
    return Math.min(0, Math.max(minOffset, offset));
}

// ==================== КРАСНЫЕ НИТИ (SVG) ====================
function toggleLinkMode() {
    linkMode = !linkMode;
    firstSelectedCardId = null;
    const btn = document.getElementById('link-mode-btn');
    if (linkMode) {
        btn.textContent = '🔗 Нить: ВКЛ (выбери 2)';
        btn.classList.add('active');
    } else {
        btn.textContent = '🔗 Нить: ВЫКЛ';
        btn.classList.remove('active');
    }
    renderBoard();
}

function handleCardLinkClick(cardId) {
    if (!firstSelectedCardId) {
        firstSelectedCardId = cardId;
        renderBoard();
        return;
    }
    if (firstSelectedCardId === cardId) {
        firstSelectedCardId = null;
        renderBoard();
        return;
    }

    // Проверяем существующую связь
    const existingIdx = vaultData.links.findIndex(l =>
        (l.from === firstSelectedCardId && l.to === cardId) ||
        (l.from === cardId && l.to === firstSelectedCardId)
    );

    if (existingIdx !== -1) {
        vaultData.links.splice(existingIdx, 1);
    } else {
        vaultData.links.push({ from: firstSelectedCardId, to: cardId });
    }

    firstSelectedCardId = null;
    saveVault();
    renderBoard();
}

function renderStrings() {
    const svg = document.getElementById('strings-layer');
    svg.innerHTML = '';

    vaultData.links.forEach(link => {
        const c1 = vaultData.cards.find(c => c.id === link.from);
        const c2 = vaultData.cards.find(c => c.id === link.to);
        if (!c1 || !c2) return;

        const x1 = c1.x + 120, y1 = c1.y + 18;
        const x2 = c2.x + 120, y2 = c2.y + 18;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 + 35;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`);
        path.setAttribute('stroke', '#f43f5e');
        path.setAttribute('stroke-width', '2.2');
        path.setAttribute('fill', 'none');
        path.setAttribute('style', 'filter: drop-shadow(0 0 6px rgba(244, 63, 94, 0.75));');
        svg.appendChild(path);
    });
}

// ==================== МОДАЛЬНОЕ ОКНО ====================
function bindModalButtons() {
    document.getElementById('btn-open-modal').addEventListener('click', openAddModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeAddModal);
    document.getElementById('modal-save-btn').addEventListener('click', saveNewCard);
    document.getElementById('link-mode-btn').addEventListener('click', toggleLinkMode);
    document.getElementById('btn-export').addEventListener('click', exportEncryptedBackup);
    document.getElementById('import-file').addEventListener('change', importEncryptedBackup);
    document.getElementById('btn-lock').addEventListener('click', lockVault);
    document.getElementById('btn-change-pin').addEventListener('click', changePin);
    document.getElementById('btn-hard-reset').addEventListener('click', hardResetVault);
}

function openAddModal() {
    document.getElementById('add-modal').classList.add('visible');
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('visible');
    document.getElementById('card-title').value = '';
    document.getElementById('card-desc').value  = '';
    document.getElementById('card-image').value  = '';
}

function saveNewCard() {
    const title     = document.getElementById('card-title').value.trim() || 'Без названия';
    const desc      = document.getElementById('card-desc').value.trim();
    const tag       = document.getElementById('card-tag').value;
    const fileInput = document.getElementById('card-image');

    const createAndPush = (imgBase64) => {
        vaultData.cards.push({
            id:    'card_' + Date.now(),
            title,
            desc,
            tag,
            image: imgBase64,
            x:     100 + Math.floor(Math.random() * 200),
            y:     100 + Math.floor(Math.random() * 200)
        });
        saveVault();
        renderBoard();
        if (currentViewMode === 'notes') renderNotes();
        closeAddModal();
    };

    if (fileInput.files && fileInput.files[0]) {
        compressImage(fileInput.files[0], 480, 0.72, (dataUrl) => createAndPush(dataUrl));
    } else {
        createAndPush(null);
    }
}

function compressImage(file, maxWidth, quality, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > maxWidth) {
                h = Math.round((h * maxWidth) / w);
                w = maxWidth;
            }
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ==================== ЭКСПОРТ / ИМПОРТ ====================
function exportEncryptedBackup() {
    const encrypted = localStorage.getItem(STORAGE_KEY_DATA);
    if (!encrypted) return;
    const payload = JSON.stringify({
        app:        'ChertogiRazuma',
        version:    1,
        exportedAt: new Date().toISOString(),
        cipher:     encrypted
    }, null, 2);

    const blob = new Blob([payload], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `chertogi_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importEncryptedBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.cipher) throw new Error('Неверный формат файла');
            const bytes     = CryptoJS.AES.decrypt(parsed.cipher, currentPin);
            const decrypted = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
            vaultData = decrypted;
            saveVault();
            renderBoard();
            alert('Бэкап успешно расшифрован и загружен!');
        } catch {
            alert('Не удалось расшифровать файл. Убедись, что PIN-код совпадает с тем, которым был зашифрован бэкап.');
        }
    };
    reader.readAsText(file);
    // Сбрасываем input, чтобы можно было повторно выбрать тот же файл
    event.target.value = '';
}

// ==================== БОКОВАЯ ПАНЕЛЬ (ШТОРКА) ====================
function bindSidebarToggle() {
    const btn      = document.getElementById('btn-sidebar-toggle');
    const sidebar  = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (!btn || !sidebar) return;

    const toggle = () => {
        const isOpen = sidebar.classList.toggle('open');
        if (isOpen) {
            backdrop.classList.add('visible');
        } else {
            backdrop.classList.remove('visible');
        }
    };

    btn.addEventListener('click', toggle);
    backdrop.addEventListener('click', toggle);
}

// ==================== УТИЛИТЫ ====================
function updateStats() {
    const statCards = document.getElementById('stat-cards');
    const statLinks = document.getElementById('stat-links');
    if (statCards) statCards.textContent = vaultData.cards.length;
    if (statLinks) statLinks.textContent = vaultData.links.length;
}

// ==================== ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ (ДОСКА / НЕОНОВЫЕ ЗАМЕТКИ) ====================
function bindViewSwitcher() {
    const btnBoard = document.getElementById('view-mode-board');
    const btnNotes = document.getElementById('view-mode-notes');
    const boardContainer = document.getElementById('board-container');
    const notesContainer = document.getElementById('notes-container');
    const linkBtn = document.getElementById('link-mode-btn');

    if (!btnBoard || !btnNotes) return;

    btnBoard.addEventListener('click', () => {
        currentViewMode = 'board';
        btnBoard.classList.add('active');
        btnNotes.classList.remove('active');
        boardContainer.classList.remove('hidden');
        notesContainer.classList.add('hidden');
        if (linkBtn) linkBtn.style.display = 'inline-flex';
        renderBoard();
    });

    btnNotes.addEventListener('click', () => {
        currentViewMode = 'notes';
        btnNotes.classList.add('active');
        btnBoard.classList.remove('active');
        notesContainer.classList.remove('hidden');
        boardContainer.classList.add('hidden');
        if (linkBtn) linkBtn.style.display = 'none';
        renderNotes();
    });
}

function bindNotesEvents() {
    const searchInput = document.getElementById('notes-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            notesSearchQuery = e.target.value.toLowerCase().trim();
            renderNotes();
        });
    }

    const filterContainer = document.querySelector('.notes-filter-tags');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-filter-btn');
            if (!btn) return;
            filterContainer.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            notesFilterTag = btn.dataset.tag || 'all';
            renderNotes();
        });
    }
}

function renderNotes() {
    const grid = document.getElementById('notes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = vaultData.cards.filter(card => {
        const matchesTag = (notesFilterTag === 'all' || card.tag === notesFilterTag);
        const matchesSearch = !notesSearchQuery || 
            (card.title && card.title.toLowerCase().includes(notesSearchQuery)) ||
            (card.desc && card.desc.toLowerCase().includes(notesSearchQuery));
        return matchesTag && matchesSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 40px; font-size: 13px;">Заметок не найдено. Нажмите «+ Добавить», чтобы создать первую!</div>';
        return;
    }

    filtered.forEach(card => {
        const el = document.createElement('div');
        el.className = `note-card tag-${card.tag || 'cyan'}`;
        
        const tagLabels = {
            cyan: '🔵 Факт',
            rose: '🔴 Улика',
            amber: '🟡 Зацепка'
        };

        el.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size: 10px; font-weight:700; text-transform:uppercase; color: ${card.tag === 'rose' ? '#f43f5e' : card.tag === 'amber' ? '#f59e0b' : '#38bdf8'};">
                    ${tagLabels[card.tag] || '🔵 Факт'}
                </span>
                <button class="delete-note-btn" data-id="${card.id}" style="background:none; border:none; color:#64748b; cursor:pointer; font-size:12px; padding:2px 6px;">✕</button>
            </div>
            ${card.image ? `<img src="${card.image}" style="width:100%; height:140px; object-fit:cover; border-radius:6px; border:1px solid #1e293b; margin:4px 0;">` : ''}
            <h3 style="font-size:13px; font-weight:700; color:#f1f5f9; margin-top:2px;">${escapeHtml(card.title)}</h3>
            <p style="font-size:11px; color:#94a3b8; line-height:1.5; white-space:pre-wrap;">${escapeHtml(card.desc)}</p>
        `;

        el.querySelector('.delete-note-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteCard(e, card.id);
            renderNotes();
        });

        grid.appendChild(el);
    });

    updateStats();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}
