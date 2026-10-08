/**
 * go2rtc NVR Dashboard
 * Modern Multi-Camera Surveillance UI
 */

// ═══════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════
const NVR_STATE = {
    streams: {},           // { name: { online, consumers, ... } }
    gridLayout: 4,         // 1, 4, 6, 9, 12, 16
    gridCameras: [],       // Array of camera names in grid slots
    sidebarCollapsed: false,
    selectedCamera: null,  // Camera name selected in sidebar
    filter: 'all',         // all, online, offline
    searchQuery: '',
    fullscreenCamera: null, // Camera name in fullscreen
};

const STORAGE_KEY = 'go2rtc_nvr_state';

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            gridLayout: NVR_STATE.gridLayout,
            gridCameras: NVR_STATE.gridCameras,
            sidebarCollapsed: NVR_STATE.sidebarCollapsed,
        }));
    } catch (e) { /* ignore */ }
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved) {
            if (saved.gridLayout) NVR_STATE.gridLayout = saved.gridLayout;
            if (saved.gridCameras) NVR_STATE.gridCameras = saved.gridCameras;
            if (saved.sidebarCollapsed) NVR_STATE.sidebarCollapsed = saved.sidebarCollapsed;
        }
    } catch (e) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════
async function fetchStreams() {
    try {
        const res = await fetch('api/streams', { cache: 'no-cache' });
        const data = await res.json();
        NVR_STATE.streams = data;
        return data;
    } catch (e) {
        console.error('Failed to fetch streams:', e);
        return {};
    }
}

function getStreamNames() {
    return Object.keys(NVR_STATE.streams).sort();
}

function isStreamOnline(name) {
    const s = NVR_STATE.streams[name];
    if (!s) return false;
    return !!(s.producers && s.producers.length > 0);
}

function getStreamInfo(name) {
    const s = NVR_STATE.streams[name];
    if (!s || !s.producers || s.producers.length === 0) return null;
    const prod = s.producers[0];
    const media = prod.medias || [];
    let video = null, audio = null;
    for (const m of media) {
        if (m.includes('video') && !video) video = m;
        if (m.includes('audio') && !audio) audio = m;
    }
    return {
        name,
        online: true,
        consumers: s.consumers ? s.consumers.length : 0,
        video,
        audio: !!audio,
        recv: prod.recv || 0,
    };
}

// ═══════════════════════════════════════════════════════════
// RENDER - HEADER
// ═══════════════════════════════════════════════════════════
function renderHeader() {
    const names = getStreamNames();
    const online = names.filter(isStreamOnline).length;
    const offline = names.length - online;

    document.querySelector('.stat-online .stat-count').textContent = online;
    document.querySelector('.stat-offline .stat-count').textContent = offline;

    document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.layout) === NVR_STATE.gridLayout);
    });
}

// ═══════════════════════════════════════════════════════════
// RENDER - SIDEBAR
// ═══════════════════════════════════════════════════════════
function renderSidebar() {
    const list = document.getElementById('camera-list');
    const names = getStreamNames();
    const query = NVR_STATE.searchQuery.toLowerCase();

    let filtered = names;
    if (query) filtered = filtered.filter(n => n.toLowerCase().includes(query));
    if (NVR_STATE.filter === 'online') filtered = filtered.filter(isStreamOnline);
    if (NVR_STATE.filter === 'offline') filtered = filtered.filter(n => !isStreamOnline(n));

    // Group by prefix (before first space/hyphen/underscore)
    const groups = {};
    filtered.forEach(name => {
        const prefix = name.split(/[\s\-_]/)[0] || 'Other';
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(name);
    });

    let html = '';
    const groupKeys = Object.keys(groups);
    if (groupKeys.length > 1) {
        groupKeys.forEach(group => {
            html += `<div class="camera-group-header" data-group="${group}">
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                ${group} <span>(${groups[group].length})</span>
            </div>`;
            groups[group].forEach(name => {
                html += renderCameraItem(name);
            });
        });
    } else {
        filtered.forEach(name => {
            html += renderCameraItem(name);
        });
    }

    if (filtered.length === 0) {
        html = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No cameras found</div>`;
    }

    list.innerHTML = html;
    bindSidebarEvents();
}

function renderCameraItem(name) {
    const online = isStreamOnline(name);
    const info = getStreamInfo(name);
    const inGrid = NVR_STATE.gridCameras.includes(name);
    const meta = info ? (info.video ? info.video.split(' ')[0] : '') : '';

    return `
    <div class="camera-item ${NVR_STATE.selectedCamera === name ? 'active' : ''}"
         data-name="${name}"
         draggable="true">
        <div class="camera-item-status ${online ? 'online' : 'offline'}"></div>
        <div class="camera-item-info">
            <div class="camera-item-name">${name}</div>
            <div class="camera-item-meta">${online ? 'Online' : 'Offline'}${meta ? ' · ' + meta : ''}</div>
        </div>
        <button class="camera-item-add" data-action="${inGrid ? 'remove' : 'add'}" data-name="${name}" title="${inGrid ? 'Remove from grid' : 'Add to grid'}">
            ${inGrid ? '×' : '+'}
        </button>
    </div>`;
}

function bindSidebarEvents() {
    // Camera item click = select
    document.querySelectorAll('.camera-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.camera-item-add')) return;
            const name = el.dataset.name;
            NVR_STATE.selectedCamera = name;
            renderSidebar();
        });

        // Drag start
        el.addEventListener('dragstart', (e) => {
            el.classList.add('dragging');
            e.dataTransfer.setData('text/plain', el.dataset.name);
            e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    // Add/Remove button
    document.querySelectorAll('.camera-item-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = btn.dataset.name;
            if (btn.dataset.action === 'add') {
                addToGrid(name);
            } else {
                removeFromGrid(name);
            }
        });
    });

    // Group collapse
    document.querySelectorAll('.camera-group-header').forEach(h => {
        h.addEventListener('click', () => h.classList.toggle('collapsed'));
    });
}

// ═══════════════════════════════════════════════════════════
// GRID MANAGEMENT
// ═══════════════════════════════════════════════════════════
function addToGrid(name) {
    const maxSlots = NVR_STATE.gridLayout;
    // Find first empty slot
    const emptyIdx = NVR_STATE.gridCameras.findIndex((c, i) => !c || !NVR_STATE.streams[c]);
    if (emptyIdx >= 0 && NVR_STATE.gridCameras.length <= maxSlots) {
        // Replace empty slot only if within range
        let idx = NVR_STATE.gridCameras.indexOf(null);
        if (idx < 0) idx = NVR_STATE.gridCameras.indexOf(undefined);
        if (idx >= 0 && idx < maxSlots) {
            NVR_STATE.gridCameras[idx] = name;
        } else if (NVR_STATE.gridCameras.length < maxSlots) {
            NVR_STATE.gridCameras.push(name);
        } else {
            // Grid full - replace last empty or show toast
            showToast('Grid is full', 'error');
            return;
        }
    } else if (NVR_STATE.gridCameras.length < maxSlots) {
        NVR_STATE.gridCameras.push(name);
    } else {
        showToast('Grid is full', 'error');
        return;
    }
    saveState();
    renderGrid();
    renderSidebar();
}

function removeFromGrid(name) {
    const idx = NVR_STATE.gridCameras.indexOf(name);
    if (idx >= 0) {
        NVR_STATE.gridCameras[idx] = null;
        saveState();
        renderGrid();
        renderSidebar();
    }
}

function setLayout(layout) {
    NVR_STATE.gridLayout = layout;
    // Trim excess cameras
    while (NVR_STATE.gridCameras.length > layout) {
        NVR_STATE.gridCameras.pop();
    }
    saveState();
    renderHeader();
    renderGrid();
    renderSidebar();
}

function renderGrid() {
    const container = document.getElementById('grid-container');
    container.className = `grid-${NVR_STATE.gridLayout}`;

    // Ensure gridCameras array has correct length
    while (NVR_STATE.gridCameras.length < NVR_STATE.gridLayout) {
        NVR_STATE.gridCameras.push(null);
    }
    NVR_STATE.gridCameras = NVR_STATE.gridCameras.slice(0, NVR_STATE.gridLayout);

    let html = '';
    for (let i = 0; i < NVR_STATE.gridLayout; i++) {
        const camName = NVR_STATE.gridCameras[i];
        if (camName && NVR_STATE.streams[camName] !== undefined) {
            html += renderTile(camName, i);
        } else {
            html += renderEmptyTile(i);
        }
    }
    container.innerHTML = html;
    bindGridEvents();
    initVideoStreams();
}

function renderTile(name, index) {
    const online = isStreamOnline(name);
    const info = getStreamInfo(name);
    const videoCodec = info?.video ? info.video.split(',')[0]?.trim() || '' : '';
    const hasAudio = info?.audio || false;

    return `
    <div class="camera-tile" data-index="${index}" data-name="${name}">
        <div class="tile-video">
            <video-stream id="vs-${index}" style="display:block;width:100%;height:100%;"></video-stream>
            ${!online ? `
            <div class="tile-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Camera offline</span>
                <button class="reconnect-btn" data-name="${name}">Reconnect</button>
            </div>` : `
            <div class="tile-loading">
                <div class="spinner"></div>
                <span>Connecting...</span>
            </div>`}
        </div>
        <div class="tile-overlay">
            <div class="tile-header">
                <div class="tile-name">
                    <span class="dot ${online ? 'online' : 'offline'}"></span>
                    ${name}
                </div>
                <div class="tile-actions">
                    <button class="tile-action-btn" data-action="snapshot" title="Snapshot">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </button>
                    <button class="tile-action-btn" data-action="fullscreen" title="Fullscreen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
                    </button>
                    <button class="tile-action-btn" data-action="remove" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <div class="tile-footer">
                <span class="tag">LIVE</span>
                ${videoCodec ? `<span>${videoCodec}</span>` : ''}
                ${hasAudio ? '<span>🔊 Audio</span>' : ''}
            </div>
        </div>
    </div>`;
}

function renderEmptyTile(index) {
    return `
    <div class="camera-tile empty" data-index="${index}">
        <div class="empty-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>
            <p>Drag camera here</p>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// GRID EVENTS (Drag & Drop, Actions)
// ═══════════════════════════════════════════════════════════
function bindGridEvents() {
    const tiles = document.querySelectorAll('.camera-tile');

    tiles.forEach(tile => {
        // Drag over / drop on tiles
        tile.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tile.classList.add('drag-over');
        });
        tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
        tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drag-over');
            const sourceName = e.dataTransfer.getData('text/plain');
            if (!sourceName) return;
            const targetIdx = parseInt(tile.dataset.index);
            handleDrop(sourceName, targetIdx);
        });

        // Double click = fullscreen
        tile.addEventListener('dblclick', (e) => {
            if (e.target.closest('.tile-action-btn')) return;
            const name = tile.dataset.name;
            if (name) openFullscreen(name);
        });

        // Action buttons
        tile.querySelectorAll('.tile-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const name = tile.dataset.name;
                const idx = parseInt(tile.dataset.index);
                switch (action) {
                    case 'fullscreen': openFullscreen(name); break;
                    case 'remove': removeFromGrid(name); break;
                    case 'snapshot': takeSnapshot(name); break;
                }
            });
        });

        // Reconnect button
        const reconnectBtn = tile.querySelector('.reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => {
                const name = reconnectBtn.dataset.name;
                reconnectStream(name);
            });
        }

        // Context menu
        tile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const name = tile.dataset.name;
            if (name) showContextMenu(e.clientX, e.clientY, name);
        });
    });
}

function handleDrop(sourceName, targetIdx) {
    // Find source index
    const sourceIdx = NVR_STATE.gridCameras.indexOf(sourceName);
    if (sourceIdx >= 0) {
        // Swap
        const targetName = NVR_STATE.gridCameras[targetIdx];
        NVR_STATE.gridCameras[targetIdx] = sourceName;
        NVR_STATE.gridCameras[sourceIdx] = targetName || null;
    } else {
        // From sidebar to grid
        const existing = NVR_STATE.gridCameras[targetIdx];
        NVR_STATE.gridCameras[targetIdx] = sourceName;
    }
    saveState();
    renderGrid();
    renderSidebar();
    showToast(`Moved ${sourceName}`, 'success');
}

// ═══════════════════════════════════════════════════════════
// VIDEO STREAM INITIALIZATION
// ═══════════════════════════════════════════════════════════
function initVideoStreams() {
    for (let i = 0; i < NVR_STATE.gridLayout; i++) {
        const camName = NVR_STATE.gridCameras[i];
        if (!camName || !isStreamOnline(camName)) continue;

        const vs = document.getElementById(`vs-${i}`);
        if (!vs) continue;

        const tile = vs.closest('.camera-tile');
        const loading = tile.querySelector('.tile-loading');
        const error = tile.querySelector('.tile-error');

        try {
            // Set src to go2rtc WebSocket API
            vs.src = new URL(`api/ws?src=${encodeURIComponent(camName)}`, location.href);
            vs.background = false;
            vs.mode = 'webrtc,mse,hls,mjpeg';

            // Listen for connection events (if custom element supports it)
            if (vs.addEventListener) {
                // Remove loading when connected
                const observer = new MutationObserver(() => {
                    const modeEl = vs.querySelector('.mode');
                    if (modeEl && modeEl.textContent && modeEl.textContent !== 'loading' && modeEl.textContent !== 'error') {
                        if (loading) loading.style.display = 'none';
                    }
                    if (modeEl && modeEl.textContent === 'error') {
                        if (loading) loading.style.display = 'none';
                        if (error) {
                            error.innerHTML = `
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
                                    <line x1="9" y1="9" x2="15" y2="15"/>
                                </svg>
                                <span>Stream error</span>
                                <button class="reconnect-btn" data-name="${camName}">Reconnect</button>`;
                            const rb = error.querySelector('.reconnect-btn');
                            if (rb) rb.addEventListener('click', () => reconnectStream(camName));
                        }
                    }
                });
                observer.observe(vs, { childList: true, subtree: true, attributes: true });

                // Fallback: hide loading after timeout
                setTimeout(() => {
                    if (loading && loading.style.display !== 'none') {
                        loading.style.display = 'none';
                    }
                }, 10000);
            }
        } catch (err) {
            console.error(`Error initializing stream ${camName}:`, err);
            if (loading) loading.style.display = 'none';
            if (error) error.style.display = 'flex';
        }
    }
}

function reconnectStream(name) {
    const idx = NVR_STATE.gridCameras.indexOf(name);
    if (idx >= 0) {
        // Force re-render this tile
        const vs = document.getElementById(`vs-${idx}`);
        if (vs) {
            vs.src = new URL(`api/ws?src=${encodeURIComponent(name)}&_=${Date.now()}`, location.href);
        }
        showToast(`Reconnecting ${name}...`, 'success');
    }
}

function takeSnapshot(name) {
    // Try go2rtc snapshot API
    const url = `api/frame?src=${encodeURIComponent(name)}`;
    fetch(url).then(res => {
        if (!res.ok) throw new Error('Snapshot failed');
        return res.blob();
    }).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}_${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(`Snapshot saved: ${name}`, 'success');
    }).catch(err => {
        showToast(`Snapshot failed: ${name}`, 'error');
    });
}

// ═══════════════════════════════════════════════════════════
// FULLSCREEN
// ═══════════════════════════════════════════════════════════
function openFullscreen(name) {
    NVR_STATE.fullscreenCamera = name;
    const overlay = document.getElementById('fullscreen-overlay');
    overlay.classList.add('active');

    const online = isStreamOnline(name);
    const info = getStreamInfo(name);
    const videoCodec = info?.video ? info.video.split(',')[0]?.trim() || '' : '';

    overlay.innerHTML = `
        <div class="tile-header">
            <div class="tile-name">
                <span class="dot ${online ? 'online' : 'offline'}"></span>
                ${name}
            </div>
            <div class="tile-actions" style="opacity:1;">
                <button class="tile-action-btn" data-action="snapshot" title="Snapshot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
                <button class="tile-action-btn" id="exit-fullscreen-btn" title="Exit Fullscreen">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
                </button>
            </div>
        </div>
        <video-stream id="vs-fullscreen" style="display:block;width:100%;height:100%;"></video-stream>
        <div class="tile-footer" style="opacity:1;">
            <span class="tag">LIVE</span>
            ${videoCodec ? `<span>${videoCodec}</span>` : ''}
            <span>${new Date().toLocaleTimeString()}</span>
        </div>`;

    // Init fullscreen video
    setTimeout(() => {
        const vs = document.getElementById('vs-fullscreen');
        if (vs && online) {
            vs.src = new URL(`api/ws?src=${encodeURIComponent(name)}`, location.href);
            vs.background = false;
            vs.mode = 'webrtc,mse,hls,mjpeg';
        }
        document.getElementById('exit-fullscreen-btn')?.addEventListener('click', closeFullscreen);
        overlay.querySelector('[data-action="snapshot"]')?.addEventListener('click', () => takeSnapshot(name));

        // Try native fullscreen
        if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
    }, 100);

    // Update time every second
    window._fsTimeInterval = setInterval(() => {
        const timeEl = overlay.querySelector('.tile-footer span:last-child');
        if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
    }, 1000);
}

function closeFullscreen() {
    NVR_STATE.fullscreenCamera = null;
    const overlay = document.getElementById('fullscreen-overlay');
    overlay.classList.remove('active');
    overlay.innerHTML = '';

    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    if (window._fsTimeInterval) {
        clearInterval(window._fsTimeInterval);
        window._fsTimeInterval = null;
    }
}

// ═══════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════
function showContextMenu(x, y, name) {
    hideContextMenu();
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `
        <div class="context-menu-item" data-action="fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
            Fullscreen
        </div>
        <div class="context-menu-item" data-action="snapshot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Snapshot
        </div>
        <div class="context-menu-item" data-action="links">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            Open Links
        </div>
        <div class="context-menu-item" data-action="reconnect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            Reconnect
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item danger" data-action="remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Remove from Grid
        </div>`;

    // Position
    const menuW = 200, menuH = 250;
    let posX = x, posY = y;
    if (x + menuW > window.innerWidth) posX = x - menuW;
    if (y + menuH > window.innerHeight) posY = y - menuH;
    menu.style.left = posX + 'px';
    menu.style.top = posY + 'px';
    menu.classList.add('active');

    // Bind actions
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            switch (action) {
                case 'fullscreen': openFullscreen(name); break;
                case 'snapshot': takeSnapshot(name); break;
                case 'links': window.open(`links.html?src=${encodeURIComponent(name)}`, '_blank'); break;
                case 'reconnect': reconnectStream(name); break;
                case 'remove': removeFromGrid(name); break;
            }
            hideContextMenu();
        });
    });
}

function hideContextMenu() {
    document.getElementById('context-menu').classList.remove('active');
}

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
function handleKeyboard(e) {
    // Don't intercept when typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
        case '1': setLayout(1); break;
        case '4': setLayout(4); break;
        case '6': setLayout(6); break;
        case '9': setLayout(9); break;
        case '0': setLayout(16); break;
        case 'Escape':
            if (NVR_STATE.fullscreenCamera) closeFullscreen();
            hideContextMenu();
            break;
        case 'f': case 'F':
            if (NVR_STATE.selectedCamera) openFullscreen(NVR_STATE.selectedCamera);
            break;
        case 's': case 'S':
            toggleSidebar();
            break;
        case 'r': case 'R':
            if (NVR_STATE.selectedCamera) reconnectStream(NVR_STATE.selectedCamera);
            break;
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('nvr-sidebar');
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('mobile-open');
    } else {
        sidebar.classList.toggle('collapsed');
        NVR_STATE.sidebarCollapsed = sidebar.classList.contains('collapsed');
        saveState();
    }
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════
async function init() {
    loadState();

    // Load video-stream custom element
    const script = document.createElement('script');
    script.type = 'module';
    script.src = './video-stream.js';
    document.head.appendChild(script);

    // Wait for custom element to be defined
    await customElements.whenDefined('video-stream').catch(() => {});

    // Bind header events
    document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLayout(parseInt(btn.dataset.layout));
        });
    });

    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    });

    // Search input
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        NVR_STATE.searchQuery = e.target.value;
        renderSidebar();
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            NVR_STATE.filter = tab.dataset.filter;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderSidebar();
        });
    });

    // Click outside to hide context menu
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) hideContextMenu();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Fullscreen change event
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && NVR_STATE.fullscreenCamera) {
            closeFullscreen();
        }
    });

    // Initial fetch
    await fetchStreams();

    // If no cameras in grid, auto-fill with first N cameras
    if (NVR_STATE.gridCameras.length === 0 || NVR_STATE.gridCameras.every(c => !c)) {
        const names = getStreamNames();
        NVR_STATE.gridCameras = [];
        for (let i = 0; i < Math.min(NVR_STATE.gridLayout, names.length); i++) {
            NVR_STATE.gridCameras.push(names[i]);
        }
        saveState();
    }

    // Render everything
    renderHeader();
    renderSidebar();
    renderGrid();

    // Apply sidebar state
    if (NVR_STATE.sidebarCollapsed) {
        document.getElementById('nvr-sidebar')?.classList.add('collapsed');
    }

    // Poll for updates
    setInterval(async () => {
        await fetchStreams();
        renderHeader();
        renderSidebar();
        // Don't re-render grid to avoid video flicker
    }, 5000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ═══════════════════════════════════════════════════════════
// MOBILE-FIRST RESPONSIVE FEATURES
// ═══════════════════════════════════════════════════════════

const MOBILE_BREAKPOINT = 768;

function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

// ── Bottom Navigation ──
function createBottomNav() {
    if (document.querySelector('.bottom-nav')) return;
    
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.innerHTML = `
        <button class="bottom-nav-item active" data-action="cameras">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>
            <span>Cameras</span>
        </button>
        <button class="bottom-nav-item" data-action="layout">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>Layout</span>
        </button>
        <button class="bottom-nav-item" data-action="sidebar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            <span>Menu</span>
        </button>
        <button class="bottom-nav-item" data-action="settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
            <span>Settings</span>
        </button>
    `;
    document.body.appendChild(nav);
    
    // Bind events
    nav.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            nav.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            switch (action) {
                case 'cameras':
                    // Show camera selector bottom sheet
                    showCameraSelector();
                    break;
                case 'layout':
                    // Show layout picker
                    showLayoutPicker();
                    break;
                case 'sidebar':
                    toggleSidebar();
                    break;
                case 'settings':
                    // Navigate to settings
                    window.location.href = 'index.html';
                    break;
            }
        });
    });
}

// ── Sidebar Overlay ──
function createSidebarOverlay() {
    if (document.querySelector('.sidebar-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', closeSidebar);
    document.body.appendChild(overlay);
}

function openSidebar() {
    const sidebar = document.getElementById('nvr-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    if (isMobile()) {
        sidebar.classList.add('mobile-open');
        overlay?.classList.add('active');
    } else {
        sidebar.classList.remove('collapsed');
        NVR_STATE.sidebarCollapsed = false;
        saveState();
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('nvr-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    
    sidebar.classList.remove('mobile-open');
    overlay?.classList.remove('active');
}

// Override toggleSidebar for mobile
const originalToggleSidebar = window.toggleSidebar || function() {};
window.toggleSidebar = function() {
    const sidebar = document.getElementById('nvr-sidebar');
    
    if (isMobile()) {
        if (sidebar.classList.contains('mobile-open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    } else {
        sidebar.classList.toggle('collapsed');
        NVR_STATE.sidebarCollapsed = sidebar.classList.contains('collapsed');
        saveState();
    }
};

// ── Camera Selector Bottom Sheet ──
function showCameraSelector() {
    let sheet = document.querySelector('.camera-selector-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.className = 'camera-selector-sheet';
        document.body.appendChild(sheet);
    }
    
    const names = getStreamNames();
    const items = names.map(name => {
        const online = isStreamOnline(name);
        const inGrid = NVR_STATE.gridCameras.includes(name);
        return `
            <div class="camera-selector-item ${inGrid ? 'active' : ''}" data-name="${name}">
                <div class="camera-item-status ${online ? 'online' : 'offline'}"></div>
                <div class="camera-item-info">
                    <div class="camera-item-name">${name}</div>
                    <div class="camera-item-meta">${online ? 'Online' : 'Offline'}</div>
                </div>
                <button class="camera-item-add" data-action="${inGrid ? 'remove' : 'add'}" data-name="${name}">
                    ${inGrid ? '×' : '+'}
                </button>
            </div>
        `;
    }).join('');
    
    sheet.innerHTML = `
        <div class="camera-selector-handle"></div>
        <div class="camera-selector-header">
            <div class="camera-selector-title">Select Camera</div>
            <button class="camera-selector-close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
        <div class="camera-selector-list">
            ${items.length > 0 ? items : '<div style="padding:20px;text-align:center;color:var(--text-muted);">No cameras available</div>'}
        </div>
    `;
    
    setTimeout(() => sheet.classList.add('active'), 10);
    
    // Bind events
    sheet.querySelector('.camera-selector-close').addEventListener('click', hideCameraSelector);
    
    sheet.querySelectorAll('.camera-selector-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.camera-item-add')) return;
            const name = item.dataset.name;
            if (NVR_STATE.gridCameras.includes(name)) {
                removeFromGrid(name);
            } else {
                addToGrid(name);
            }
            hideCameraSelector();
        });
    });
    
    sheet.querySelectorAll('.camera-item-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = btn.dataset.name;
            if (btn.dataset.action === 'add') {
                addToGrid(name);
            } else {
                removeFromGrid(name);
            }
            hideCameraSelector();
        });
    });
    
    // Swipe down to close
    let startY = 0;
    sheet.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    });
    sheet.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        if (endY - startY > 100) {
            hideCameraSelector();
        }
    });
}

function hideCameraSelector() {
    const sheet = document.querySelector('.camera-selector-sheet');
    if (sheet) {
        sheet.classList.remove('active');
        setTimeout(() => sheet.remove(), 300);
    }
}

// ── Layout Picker Modal ──
function showLayoutPicker() {
    let modal = document.querySelector('.layout-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'layout-picker-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div style="
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            max-width: 320px;
            width: 90%;
        ">
            <div style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text-primary);">
                Select Layout
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                <button class="layout-picker-btn" data-layout="1" style="
                    padding: 20px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                ">1×1</button>
                <button class="layout-picker-btn" data-layout="4" style="
                    padding: 20px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                ">2×2</button>
                <button class="layout-picker-btn" data-layout="9" style="
                    padding: 20px;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                ">3×3</button>
            </div>
            <button id="close-layout-picker" style="
                width: 100%;
                margin-top: 16px;
                padding: 12px;
                background: var(--accent);
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
            ">Close</button>
        </div>
    `;
    
    modal.querySelectorAll('.layout-picker-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLayout(parseInt(btn.dataset.layout));
            hideLayoutPicker();
        });
    });
    
    modal.querySelector('#close-layout-picker').addEventListener('click', hideLayoutPicker);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideLayoutPicker();
    });
}

function hideLayoutPicker() {
    const modal = document.querySelector('.layout-picker-modal');
    if (modal) modal.remove();
}

// ── Touch Gestures for Fullscreen ──
function setupTouchGestures() {
    const overlay = document.getElementById('fullscreen-overlay');
    if (!overlay) return;
    
    let touchStartX = 0;
    let touchStartY = 0;
    
    overlay.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });
    
    overlay.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        
        // Swipe down to close fullscreen
        if (deltaY > 100 && Math.abs(deltaX) < 50) {
            closeFullscreen();
        }
        
        // Swipe left/right to switch cameras
        if (Math.abs(deltaX) > 100 && Math.abs(deltaY) < 50) {
            const currentIndex = NVR_STATE.gridCameras.indexOf(NVR_STATE.fullscreenCamera);
            if (currentIndex >= 0) {
                let nextIndex;
                if (deltaX < 0) {
                    // Swipe left - next camera
                    nextIndex = (currentIndex + 1) % NVR_STATE.gridCameras.length;
                } else {
                    // Swipe right - previous camera
                    nextIndex = (currentIndex - 1 + NVR_STATE.gridCameras.length) % NVR_STATE.gridCameras.length;
                }
                
                const nextCamera = NVR_STATE.gridCameras[nextIndex];
                if (nextCamera) {
                    openFullscreen(nextCamera);
                }
            }
        }
    });
}

// ── Double Tap for Fullscreen ──
function setupDoubleTap() {
    let lastTap = 0;
    
    document.addEventListener('touchend', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        
        if (tapLength < 500 && tapLength > 0) {
            const tile = e.target.closest('.camera-tile');
            if (tile && tile.dataset.name) {
                e.preventDefault();
                openFullscreen(tile.dataset.name);
            }
        }
        lastTap = currentTime;
    });
}

// ── Initialize Mobile Features ──
function initMobileFeatures() {
    if (isMobile()) {
        createBottomNav();
        createSidebarOverlay();
        setupDoubleTap();
    }
    
    // Watch for orientation/size changes
    window.addEventListener('resize', () => {
        if (isMobile() && !document.querySelector('.bottom-nav')) {
            createBottomNav();
            createSidebarOverlay();
        } else if (!isMobile()) {
            // Remove mobile UI when switching to desktop
            document.querySelector('.bottom-nav')?.remove();
            document.querySelector('.sidebar-overlay')?.remove();
            closeSidebar();
        }
    });
    
    // Setup touch gestures when fullscreen opens
    const observer = new MutationObserver(() => {
        const overlay = document.getElementById('fullscreen-overlay');
        if (overlay && overlay.classList.contains('active')) {
            setupTouchGestures();
        }
    });
    
    observer.observe(document.getElementById('fullscreen-overlay') || document.body, {
        attributes: true,
        attributeFilter: ['class']
    });
}

// ── Update sidebar toggle for mobile ──
document.getElementById('sidebar-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSidebar();
});

// Call mobile init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileFeatures);
} else {
    initMobileFeatures();
}
