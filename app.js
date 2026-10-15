// ==================== SUPABASE CONFIGURATION ====================
const SUPABASE_URL = 'https://dcdqmxsdazwattnrbjyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZHFteHNkYXp3YXR0bnJianliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDAwNTYsImV4cCI6MjA4NDY3NjA1Nn0.bKLAfK2RefFNCMUe4LHeggQisuEOb3o4DR8zjZVfamw';

let supabaseClient;
try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
    console.error('Failed to initialize Supabase:', err);
    modal.createModal('Connection Error', 'Failed to initialize database connection.', null, null, 'OK', 'Cancel', 'error');
}



// ==================== GLOBAL STATE ====================
const state = {
    currentUser: null,
    role: 'admin',
    isSidebarOpen: false,
    authMode: 'login',
    currentView: '',
    students: [],
    teachers: [],
    parents: [],
    classes: [],
    academicYears: [],
    currentAY: null,
    currentTerm: null,
    transactions: [],
    fees: [],
    reports: [],
    notifications: [],
    receivedReports: [],
    pendingAdmins: [],
    pendingTeachers: [],
    selectedUploadClass: '',
    isLoading: false,
    dataLoaded: false
};

// ── Money visibility toggle state ─────────────────────────────────────────────────
// Persists for the session. true = amounts hidden, false = amounts visible.
window._rvMoneyHidden = false;

// ==================== ERROR HANDLING ====================
function extractErrorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error_description) return error.error_description;
    if (error.details) return error.details;
    try {
        const str = JSON.stringify(error);
        if (str !== '{}') return str;
    } catch (e) {}
    return 'Unknown error';
}

// Escapes text before it is placed into HTML built with template strings.
// Use for anything a user typed (names, emails, messages, descriptions).
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Encodes a value as a JS string literal for use inside an inline handler,
// e.g. onclick="actions.deleteTeacher('${id}', ${jsArg(name)})".
function jsArg(value) {
    return escapeHtml(JSON.stringify(String(value ?? '')));
}

// The reports and payments buckets are private. Stored file URLs keep the
// public-URL format (it identifies the object); before use they are swapped
// for a short-lived signed URL. Links, images and iframes rendered anywhere in
// the app are handled automatically; use privateStorage.open() for window.open.
const privateStorage = {
    _cache: new Map(),
    _pattern: /\/storage\/v1\/object\/public\/(reports|payments)\/([^?#]+)/,

    parse(url) {
        const m = typeof url === 'string' ? url.match(this._pattern) : null;
        return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null;
    },

    async sign(url) {
        const ref = this.parse(url);
        if (!ref || !supabaseClient) return url;
        const cached = this._cache.get(url);
        if (cached && cached.expires > Date.now()) return cached.url;
        const { data, error } = await supabaseClient.storage.from(ref.bucket).createSignedUrl(ref.path, 3600);
        if (error || !data?.signedUrl) {
            console.warn('Could not sign storage URL:', error);
            return url;
        }
        this._cache.set(url, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
        return data.signedUrl;
    },

    async open(url) {
        // Open the tab synchronously so popup blockers allow it, then navigate.
        const win = window.open('', '_blank');
        const signed = await this.sign(url);
        if (win) win.location.href = signed;
        else window.open(signed, '_blank');
    },

    async _swapSrc(el) {
        const src = el.getAttribute('src');
        if (!this.parse(src)) return;
        el.setAttribute('src', await this.sign(src));
    },

    init() {
        document.addEventListener('click', (e) => {
            const a = e.target.closest?.('a[href]');
            if (!a || !this.parse(a.getAttribute('href'))) return;
            e.preventDefault();
            this.open(a.getAttribute('href'));
        }, true);

        const scan = (root) => {
            if (root.nodeType !== 1) return;
            if (root.matches('img[src], iframe[src]')) this._swapSrc(root);
            root.querySelectorAll?.('img[src], iframe[src]').forEach(el => this._swapSrc(el));
        };
        new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'attributes') scan(m.target);
                else m.addedNodes.forEach(scan);
            }
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
};
privateStorage.init();

// Parses a money amount typed by a user. Returns a positive number rounded to
// pesewas, or null if the value is empty, not a number, zero or negative.
function parseMoneyAmount(value) {
    const n = Number(String(value ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
}

function isNetworkError(error) {
    if (!error) return false;
    const msg = (error.message || error.toString() || '').toLowerCase();
    return msg.includes('failed to fetch') || 
           msg.includes('network') || 
           msg.includes('timeout') ||
           msg.includes('offline') ||
           msg.includes('connection refused');
}

// ==================== CLASS NAME UTILITIES ====================
// Single canonical normaliser used everywhere class strings are compared.
// FIX: aligned with report.js normalizeClassName so that class names saved by
// app.js and looked up by report.js always normalize to the same token.
// Both implementations must collapse dashes to a bare "-" (no surrounding spaces).
function normalizeClassName(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/\s*-\s*/g, '-')   // "pre - school" → "pre-school" (matches report.js)
        .replace(/\s+/g, ' ')
        .trim();
}

// NOTE: resolveClassNameFromId is defined above (after buildClassName) so it can
// use buildClassName with BASIC-prefix logic. Do not redefine it here.

// Builds the canonical class name string from a class object.
// Matches the same BASIC-prefix logic used in report.js buildResolvedClassName():
//   level="PRE-SCHOOL"    grade="NURSERY 1"      → "PRE-SCHOOL - NURSERY 1"
//   level="PRE-SCHOOL"    grade="KINDERGARTEN 2" → "PRE-SCHOOL - KINDERGARTEN 2"
//   level="LOWER PRIMARY" grade="1"              → "LOWER PRIMARY - BASIC 1"
//   level="UPPER PRIMARY" grade="4"              → "UPPER PRIMARY - BASIC 4"
// NOTE: Never prepend BASIC when the grade already has its own descriptive label.
function buildClassName(classObj) {
    if (!classObj) return '';
    const l = (classObj.level || '').trim();
    const g = (classObj.grade || '').trim();
    if (!l && !g) return '';
    if (!l) return g;
    if (!g) return l;
    const gl = g.toLowerCase();
    const gradeHasOwnLabel = (
        gl.startsWith('nursery')      ||
        gl.startsWith('kindergarten') ||
        gl.startsWith('kg')           ||
        gl.startsWith('creche')       ||
        gl.startsWith('basic')        // already prefixed — avoid "BASIC BASIC N"
    );
    return gradeHasOwnLabel
        ? `${l} - ${g}`           // e.g. "PRE-SCHOOL - NURSERY 1"
        : `${l} - BASIC ${g}`;    // e.g. "LOWER PRIMARY - BASIC 1"
}

// FIX: resolveClassNameFromId now uses buildClassName so the BASIC prefix
// is applied consistently when resolving teacher-to-student class matching.
function resolveClassNameFromId(classId) {
    if (!classId) return '';
    const classObj = (state.classes || []).find(c => c.id === classId);
    if (!classObj) return '';
    return buildClassName(classObj);
}

// Guard: throws if a UUID is about to be written into students.class.
// Call this before every Supabase insert/update on the students table.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertNotUUID(className, context) {
    if (UUID_PATTERN.test(String(className || '').trim())) {
        throw new Error(
            `[${context || 'students.class'}] UUID detected where a class name is required: "${className}". ` +
            'Resolve the class name using resolveClassNameFromId() before saving.'
        );
    }
}

// ==================== MODAL SYSTEM (Updated with better styling) ====================
const modal = {
    createModal(title, content, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', type = 'info') {
        const modalId = 'custom-modal-' + Date.now();

        const palette = {
            danger:  { bar: '#ef4444', btn: 'background:#ef4444',  icon: 'fa-exclamation-circle' },
            error:   { bar: '#ef4444', btn: 'background:#ef4444',  icon: 'fa-exclamation-circle' },
            warning: { bar: '#f59e0b', btn: 'background:#f59e0b',  icon: 'fa-exclamation-triangle' },
            info:    { bar: '#3b82f6', btn: 'background:#3b82f6',  icon: 'fa-info-circle' },
            success: { bar: '#10b981', btn: 'background:#10b981',  icon: 'fa-check-circle' },
            ridge:   { bar: '#1a56db', btn: 'background:#1a56db',  icon: 'fa-info-circle' }
        };
        const p = palette[type] || palette.info;

        const html = `
            <div id="${modalId}" style="
                position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);
                display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;
                opacity:0;transition:opacity .25s ease;">
                <div style="
                    width:100%;max-width:420px;border-radius:16px;overflow:hidden;
                    box-shadow:0 20px 60px rgba(0,0,0,0.35);
                    transform:translateY(16px);transition:transform .25s ease;">
                    <!-- Coloured top bar -->
                    <div style="background:${p.bar};padding:18px 24px;display:flex;align-items:center;gap:12px;">
                        <i class="fas ${p.icon}" style="color:#fff;font-size:22px;flex-shrink:0;"></i>
                        <span style="color:#fff;font-size:17px;font-weight:700;line-height:1.3;">${escapeHtml(title)}</span>
                    </div>
                    <!-- Body -->
                    <div style="background:#1e293b;padding:20px 24px 8px;color:#cbd5e1;font-size:14px;line-height:1.6;">
                        ${content}
                    </div>
                    <!-- Buttons -->
                    <div style="background:#1e293b;padding:12px 24px 20px;display:flex;gap:10px;justify-content:flex-end;">
                        ${onCancel ? `<button id="${modalId}-cancel" style="padding:9px 20px;border-radius:8px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;font-size:13px;cursor:pointer;">${cancelText}</button>` : ''}
                        <button id="${modalId}-confirm" style="padding:9px 20px;border-radius:8px;${p.btn};color:#fff;font-weight:700;font-size:13px;cursor:pointer;border:none;">${confirmText}</button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl  = document.getElementById(modalId);
        const innerEl  = modalEl.querySelector('div');

        requestAnimationFrame(() => {
            modalEl.style.opacity = '1';
            innerEl.style.transform = 'translateY(0)';
        });

        const closeModal = () => {
            modalEl.style.opacity = '0';
            innerEl.style.transform = 'translateY(16px)';
            setTimeout(() => modalEl.remove(), 260);
        };

        if (onCancel) {
            document.getElementById(`${modalId}-cancel`).onclick = () => { closeModal(); onCancel(); };
        }
        document.getElementById(`${modalId}-confirm`).onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
        modalEl.addEventListener('click', e => { if (e.target === modalEl) { closeModal(); if (onCancel) onCancel(); } });
    },

    confirmDelete(itemName, onConfirm) {
        this.createModal(
            'Confirm Deletion',
            `<div class="space-y-2">
                <p class="text-slate-700 dark:text-slate-300">Are you sure you want to delete <strong class="text-slate-900 dark:text-white">${escapeHtml(itemName)}</strong>?</p>
                <div class="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <i class="fas fa-exclamation-triangle text-red-500"></i>
                    <p class="text-sm text-red-600 dark:text-red-400 font-medium">This action cannot be undone.</p>
                </div>
            </div>`,
            onConfirm,
            null,
            'Delete',
            'Cancel',
            'danger'
        );
    },

    confirmAction(title, message, onConfirm, type = 'info') {
        this.createModal(title, message, onConfirm, null, 'Confirm', 'Cancel', type);
    },

    alert(title, message, type = 'info') {
        this.createModal(title, message, null, null, 'OK', null, type);
    },

    prompt(title, defaultValue = '', onConfirm) {
        const modalId = 'prompt-modal-' + Date.now();
        const html = `
            <div id="${modalId}" class="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 opacity-0 transition-opacity duration-300">
                <div class="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl border border-slate-200 dark:border-slate-700 transform scale-95 transition-transform duration-300">
                    <div class="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-pen text-white text-xl"></i>
                    </div>
                    <h3 class="text-xl font-bold mb-4 text-slate-800 dark:text-white text-center">${escapeHtml(title)}</h3>
                    <input type="text" id="${modalId}-input" class="w-full rounded-xl px-4 py-3 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 mb-6 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-800 dark:text-white" value="${defaultValue}" placeholder="Enter value...">
                    <div class="flex gap-3">
                        <button id="${modalId}-cancel" class="flex-1 py-3 px-4 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">Cancel</button>
                        <button id="${modalId}-confirm" class="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg">OK</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        const contentEl = modalEl.querySelector('div');
        const inputEl = document.getElementById(`${modalId}-input`);
        
        requestAnimationFrame(() => {
            modalEl.classList.remove('opacity-0');
            contentEl.classList.remove('scale-95');
            inputEl.focus();
            inputEl.select();
        });

        const closeModal = () => {
            modalEl.classList.add('opacity-0');
            contentEl.classList.add('scale-95');
            setTimeout(() => modalEl.remove(), 300);
        };

        document.getElementById(`${modalId}-cancel`).onclick = closeModal;
        
        const confirmHandler = () => {
            const value = inputEl.value.trim();
            closeModal();
            if (onConfirm && value) onConfirm(value);
        };

        document.getElementById(`${modalId}-confirm`).onclick = confirmHandler;
        inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') confirmHandler();
        });
    },

    // NEW: Styled form for selecting students (similar to delete confirmation style)
    selectStudent(title, students, onSelect) {
        const modalId = 'select-student-modal-' + Date.now();
        // Resolve a readable class label — never display raw UUIDs
        const resolveClassLabel = (s) => {
            if (s.class_id) {
                const classObj = state.classes.find(c => c.id === s.class_id);
                if (classObj) return buildClassName(classObj);
            }
            return s.class || '—';
        };
        const html = `
            <div id="${modalId}" class="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 opacity-0 transition-opacity duration-300">
                <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl border border-slate-200 dark:border-slate-700 transform scale-95 transition-transform duration-300 max-h-[80vh] flex flex-col">
                    <div class="flex items-center gap-3 mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                        <div class="w-10 h-10 bg-ridge-600 rounded-xl flex items-center justify-center">
                            <i class="fas fa-user-graduate text-white"></i>
                        </div>
                        <h3 class="text-xl font-bold text-slate-800 dark:text-white">${escapeHtml(title)}</h3>
                    </div>
                    <div class="relative mb-4">
                        <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                        <input type="text" id="${modalId}-search" class="w-full rounded-xl pl-10 pr-4 py-3 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-ridge-500 focus:border-transparent outline-none transition-all text-slate-800 dark:text-white" placeholder="Search by name...">
                    </div>
                    <div id="${modalId}-results" class="overflow-y-auto flex-1 max-h-96 space-y-2 pr-2">
                        ${students.length === 0 ? '<p class="text-center text-slate-500 py-4">No students available</p>' : students.map(s => `
                            <div class="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-600 transition-all border-2 border-transparent hover:border-blue-200 dark:hover:border-blue-800 student-result ${s.disabled ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${s.id}" data-name="${escapeHtml(s.name)}">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-full bg-ridge-600 flex items-center justify-center text-white font-bold">
                                        ${s.name.charAt(0)}
                                    </div>
                                    <div class="flex-1">
                                        <div class="font-semibold text-slate-800 dark:text-white">${escapeHtml(s.name)}</div>
                                        <div class="text-sm text-slate-500">${resolveClassLabel(s)} • Age: ${s.age || 'N/A'}${s.disabled ? ' <span class="text-red-500 font-bold">(Already linked)</span>' : ''}</div>
                                    </div>
                                    ${!s.disabled ? '<i class="fas fa-chevron-right text-slate-400"></i>' : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button id="${modalId}-cancel" class="mt-4 w-full py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        const contentEl = modalEl.querySelector('div');
        const searchInput = document.getElementById(`${modalId}-search`);
        const resultsContainer = document.getElementById(`${modalId}-results`);
        
        requestAnimationFrame(() => {
            modalEl.classList.remove('opacity-0');
            contentEl.classList.remove('scale-95');
            searchInput.focus();
        });

        const closeModal = () => {
            modalEl.classList.add('opacity-0');
            contentEl.classList.add('scale-95');
            setTimeout(() => modalEl.remove(), 300);
        };

        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const results = resultsContainer.querySelectorAll('.student-result');
            results.forEach(result => {
                const name = result.getAttribute('data-name').toLowerCase();
                if (name.includes(query)) {
                    result.classList.remove('hidden');
                } else {
                    result.classList.add('hidden');
                }
            });
        });

        resultsContainer.querySelectorAll('.student-result').forEach(el => {
            if (!el.classList.contains('opacity-50')) {
                el.addEventListener('click', () => {
                    const studentId = el.getAttribute('data-id');
                    const studentName = el.getAttribute('data-name');
                    closeModal();
                    if (onSelect) onSelect(studentId, studentName);
                });
            }
        });

        document.getElementById(`${modalId}-cancel`).onclick = closeModal;
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeModal();
        });
    },

    // NEW: Styled form for selecting terms
    selectTerm(title, terms, onSelect) {
        const modalId = 'select-term-modal-' + Date.now();
        const html = `
            <div id="${modalId}" class="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 opacity-0 transition-opacity duration-300">
                <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-slate-200 dark:border-slate-700 transform scale-95 transition-transform duration-300">
                    <div class="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-slate-700">
                        <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                            <i class="fas fa-calendar-alt text-white"></i>
                        </div>
                        <h3 class="text-xl font-bold text-slate-800 dark:text-white">${escapeHtml(title)}</h3>
                    </div>
                    <div class="space-y-3 max-h-96 overflow-y-auto">
                        ${terms.length === 0 ? '<p class="text-center text-slate-500 py-4">No terms available</p>' : terms.map(t => `
                            <button onclick="document.getElementById('${modalId}').dataset.selected='${t.id}'; document.getElementById('${modalId}-confirm').click();" 
                                class="w-full p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border-2 border-transparent hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-slate-600 transition-all text-left group">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <div class="font-bold text-slate-800 dark:text-white group-hover:text-blue-600 transition-colors">${escapeHtml(t.name)}</div>
                                        ${t.active ? '<span class="text-xs text-emerald-600 font-bold">Currently Active</span>' : ''}
                                    </div>
                                    <i class="fas fa-check-circle text-slate-300 group-hover:text-blue-500 transition-colors"></i>
                                </div>
                            </button>
                        `).join('')}
                    </div>
                    <button id="${modalId}-cancel" class="mt-4 w-full py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">Cancel</button>
                    <button id="${modalId}-confirm" class="hidden"></button>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        const contentEl = modalEl.querySelector('div');
        
        requestAnimationFrame(() => {
            modalEl.classList.remove('opacity-0');
            contentEl.classList.remove('scale-95');
        });

        const closeModal = () => {
            modalEl.classList.add('opacity-0');
            contentEl.classList.add('scale-95');
            setTimeout(() => modalEl.remove(), 300);
        };

        document.getElementById(`${modalId}-cancel`).onclick = closeModal;
        
        document.getElementById(`${modalId}-confirm`).onclick = () => {
            const selectedId = modalEl.dataset.selected;
            closeModal();
            if (onSelect && selectedId) onSelect(selectedId);
        };

        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeModal();
        });
    },

    searchStudents(title, students, onSelect) {
        this.selectStudent(title, students, onSelect);
    },

    previewReport(title, fileUrl, onPublish, onNotifyAdmin) {
        const modalId = 'preview-modal-' + Date.now();
        const html = `
            <div id="${modalId}" class="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 opacity-0 transition-opacity duration-300">
                <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-4xl w-full mx-4 shadow-2xl border border-slate-200 dark:border-slate-700 transform scale-95 transition-transform duration-300 max-h-[90vh] flex flex-col">
                    <div class="flex justify-between items-center mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                                <i class="fas fa-file-pdf text-white"></i>
                            </div>
                            <h3 class="text-xl font-bold text-slate-800 dark:text-white">${escapeHtml(title)}</h3>
                        </div>
                        <button id="${modalId}-close" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900 rounded-xl mb-4 min-h-[400px] border border-slate-200 dark:border-slate-700">
                        <iframe src="${fileUrl}" class="w-full h-full min-h-[400px] rounded-lg" frameborder="0"></iframe>
                    </div>
                    <div class="flex gap-3">
                        <button id="${modalId}-notify" class="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-700 transition-all shadow-lg">
                            <i class="fas fa-exclamation-triangle mr-2"></i> Notify Admin (Issue)
                        </button>
                        <button id="${modalId}-publish" class="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg">
                            <i class="fas fa-check mr-2"></i> Publish to Parents
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        const contentEl = modalEl.querySelector('div');
        
        requestAnimationFrame(() => {
            modalEl.classList.remove('opacity-0');
            contentEl.classList.remove('scale-95');
        });

        const closeModal = () => {
            modalEl.classList.add('opacity-0');
            contentEl.classList.add('scale-95');
            setTimeout(() => modalEl.remove(), 300);
        };

        document.getElementById(`${modalId}-close`).onclick = closeModal;
        document.getElementById(`${modalId}-publish`).onclick = () => {
            closeModal();
            if (onPublish) onPublish();
        };
        document.getElementById(`${modalId}-notify`).onclick = () => {
            closeModal();
            if (onNotifyAdmin) onNotifyAdmin();
        };
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeModal();
        });
    }
};

// ==================== INITIALIZATION ====================
// A page restored from the back/forward cache keeps old form values
window.addEventListener('pageshow', e => { if (e.persisted && !state.currentUser) app.clearAuthForm(); });

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    app.clearAuthForm();
    app.initAccountantGesture();
    await initApp();
});

function initTheme() {
    try {
        if (localStorage.getItem('darkMode') === 'true') {
            document.documentElement.classList.add('dark');
            const themeIcon = document.getElementById('theme-icon');
            if (themeIcon) themeIcon.className = 'fas fa-sun';
        }
    } catch (e) {
        console.warn('Theme init error:', e);
    }
}

async function initApp() {
    app.showLoading('Initializing...');
    try {
        // ── Password-reset redirect detection ────────────────────────────────
        // Supabase appends #access_token=...&type=recovery (implicit flow)
        // OR ?token_hash=...&type=recovery (PKCE flow) to the redirect URL.
        // Either way, getSession() exchanges it for a live session whose
        // aal level is still "recovery" — we intercept here before loading
        // any protected data and show the new-password form instead.
        const urlParams  = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
        const isRecovery =
            urlParams.get('type') === 'recovery' ||
            hashParams.get('type') === 'recovery' ||
            urlParams.get('reset') === '1';

        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;

        if (isRecovery && session) {
            // Clean the recovery tokens from the URL so a page-refresh doesn't
            // re-trigger this flow after the password has been changed.
            window.history.replaceState({}, document.title, window.location.pathname);
            app.hideLoading();
            app.showPasswordResetUI();
            return;
        }

        if (session) {
            await app.loadUserData(session.user);
        } else {
            await app.checkInitialAdmin();
        }
        
        setupRealtimeSubscriptions();
    } catch (error) {
        console.error('Init error:', error);
        if (isNetworkError(error)) {
            showNetworkErrorUI();
        } else {
            app.forceShowLogin();
        }
    } finally {
        app.hideLoading();
    }
}

// Coalesce bursts of realtime events (e.g. a bulk upload) into one refresh,
// and skip refreshing when nobody is logged in.
let _realtimeRefreshTimer = null;
function scheduleRealtimeRefresh() {
    if (!state.currentUser) return;
    clearTimeout(_realtimeRefreshTimer);
    _realtimeRefreshTimer = setTimeout(() => {
        if (state.currentUser) actions.refreshData();
    }, 1500);
}

function setupRealtimeSubscriptions() {
    const channels = [
        supabaseClient.channel('public:academic_years').on('postgres_changes', { event: '*', schema: 'public', table: 'academic_years' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:classes').on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:students').on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:teachers').on('postgres_changes', { event: '*', schema: 'public', table: 'teachers' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:parents').on('postgres_changes', { event: '*', schema: 'public', table: 'parents' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:transactions').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:fees').on('postgres_changes', { event: '*', schema: 'public', table: 'fees' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:reports').on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, scheduleRealtimeRefresh),
        supabaseClient.channel('public:received_reports').on('postgres_changes', { event: '*', schema: 'public', table: 'received_reports' }, scheduleRealtimeRefresh)
    ];
    
    channels.forEach(channel => channel.subscribe());
}

function showNetworkErrorUI() {
    const landing = document.getElementById('landing-page');
    if (landing) {
        landing.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900">
                <div class="text-center max-w-md w-full bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-slate-700">
                    <div class="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                        <i class="fas fa-wifi text-3xl text-red-500"></i>
                    </div>
                    <h2 class="text-2xl font-bold mb-2 text-slate-800 dark:text-white">Connection Error</h2>
                    <p class="text-slate-500 mb-6">Unable to connect to server. Please check your internet connection.</p>
                    <button onclick="location.reload()" class="w-full py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        <i class="fas fa-sync mr-2"></i> Retry Connection
                    </button>
                    <button onclick="app.forceShowLogin()" class="w-full mt-3 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">
                        Continue Offline
                    </button>
                </div>
            </div>
        `;
        landing.classList.remove('hidden');
    }
}

// ==================== APP CONTROLLER ====================
const app = {
    async checkInitialAdmin(retryCount = 0) {
        try {
            if (retryCount === 0) app.showLoading('Checking system...');
            
            // profiles is not readable before sign-in; ask the server instead
            const { data: adminExists, error } = await supabaseClient.rpc('admin_exists');

            if (error) {
                console.error('Admin check error:', error);
                if (error.message?.includes('infinite recursion') || 
                    error.message?.includes('permission') ||
                    error.message?.includes('policy')) {
                    console.warn('RLS error - forcing login');
                    this.forceShowLogin();
                    return;
                }
                
                if (isNetworkError(error) && retryCount < 3) {
                    setTimeout(() => this.checkInitialAdmin(retryCount + 1), 2000);
                    return;
                }
                
                this.forceShowLogin();
                return;
            }

            app.hideLoading();

            if (!adminExists) {
                this.showSetupModal();
                return;
            }

            const landing = document.getElementById('landing-page');
            if (landing) {
                landing.innerHTML = `
                    <div class="rv-welcome relative min-h-[100dvh] flex">
                        <div class="rv-bg-photo" aria-hidden="true">
                            <img src="assets/photos/welcome-1600.webp" srcset="assets/photos/welcome-800.webp 800w, assets/photos/welcome-1600.webp 1600w" sizes="100vw" alt="" width="1600" height="1060" decoding="async" fetchpriority="high">
                        </div>
                        <div class="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
                        <div class="mb-10 animate-fade-in">
                            <img src="1.png" alt="Ridge Valley Hybrid School crest" width="132" height="132" class="w-28 h-28 md:w-32 md:h-32 object-contain mx-auto mb-8 drop-shadow-sm" onerror="this.style.display='none'">
                            <h1 class="text-4xl md:text-5xl font-extrabold tracking-tight text-[#0f2044] dark:text-white mb-3">Ridgevalley SMS</h1>
                            <p class="text-slate-500 dark:text-slate-400 text-base md:text-lg">School Management System</p>
                        </div>
                        <button onclick="app.enterPortal()" class="inline-flex items-center gap-3 px-7 py-3.5 bg-ridge-600 hover:bg-ridge-700 text-white rounded-xl font-semibold text-base shadow-sm">
                            Enter Portal <i class="fas fa-arrow-right text-sm"></i>
                        </button>
                        </div>
                    </div>
                `;
                landing.classList.remove('hidden');
            }
            
        } catch (err) {
            console.error('CheckInitialAdmin error:', err);
            this.forceShowLogin();
        }
    },

    forceShowLogin() {
        app.hideLoading();
        const landing = document.getElementById('landing-page');
        const auth = document.getElementById('auth-container');
        if (landing) landing.classList.add('hidden');
        if (auth) {
            auth.classList.remove('hidden');
            this.setRole('admin');
        }
    },

    showSetupModal() {
        let modalEl = document.getElementById('system-inactive-modal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'system-inactive-modal';
            modalEl.className = 'fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50';
            modalEl.innerHTML = `
                <div class="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full mx-4 text-center shadow-2xl border border-slate-200 dark:border-slate-700 transform scale-100 transition-transform">
                    <div class="w-20 h-20 bg-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-cog text-3xl text-white animate-spin-slow"></i>
                    </div>
                    <h2 class="text-2xl font-bold mb-2 text-slate-800 dark:text-white">System Setup Required</h2>
                    <p class="text-slate-500 mb-6">No administrator found. Create the first admin account to get started.</p>
                    <button onclick="document.getElementById('system-inactive-modal').classList.add('hidden'); app.enterPortal();" 
                            class="w-full py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        Create Admin Account
                    </button>
                </div>
            `;
            document.body.appendChild(modalEl);
        } else {
            modalEl.classList.remove('hidden');
        }
    },

    async loadUserData(user) {
        app.showLoading('Loading profile...');
        try {
            const { data: profile, error } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            if (profile.role === 'admin' && !profile.approved && !profile.is_super_admin) {
                modal.alert('Account Pending', 'Your admin account is pending approval. Please wait for a super admin to approve your account.', 'warning');
                await auth.logout();
                return;
            }
            if (profile.role === 'accountant' && !profile.approved) {
                modal.alert('Account Pending', 'Your accountant account is waiting for approval from an existing accountant.', 'warning');
                await auth.logout();
                return;
            }
            if (profile.role === 'teacher' && !profile.approved) {
                modal.alert('Account Pending', 'Your teacher account is pending approval. Please wait for an administrator to approve your account.', 'warning');
                await auth.logout();
                return;
            }

            state.currentUser = { ...user, ...profile };
            state.role = profile.role;
            app.clearAuthForm();

            document.getElementById('landing-page')?.classList.add('hidden');
            document.getElementById('auth-container')?.classList.add('hidden');
            document.getElementById('main-nav')?.classList.remove('hidden');
            document.getElementById('dashboard')?.classList.remove('hidden');
            document.getElementById('drawer-btn')?.classList.remove('hidden');

            ui.updateSidebar();
            await this.loadInitialData();
            
            // Inject notification bell, start polling, request push permission
            setTimeout(async () => {
                notificationManager.injectBell();
                notificationManager._lastNotifCount = notificationManager.countUnread();
                notificationManager.updateBell();
                notificationManager.startPolling(30000);

                // FIX 4: Ask for browser notification permission (teachers and parents only,
                // but admins also benefit so we request for all roles)
                await notificationManager.requestPermission();

                // Show in-app entry prompt for unread notifications
                if (state.role === 'teacher' || state.role === 'parent') {
                    const unreadCount = notificationManager.countUnread();
                    if (unreadCount > 0) {
                        setTimeout(() => {
                            notificationManager.playBell();
                            notificationManager.showPrompt();
                        }, 2000);
                    }
                }
            }, 800);
            
            ui.route(ui.homeView());
            
            ui.showToast(`Welcome, ${profile.full_name || 'User'}!`, 'success');
            
        } catch (err) {
            console.error('Load user data error:', err);
            modal.alert('Error', 'Failed to load profile: ' + extractErrorMessage(err), 'error');
            await auth.logout();
        } finally {
            app.hideLoading();
        }
    },

    async loadInitialData() {
        console.log('Loading initial data...');
        try {
            // FIX 7: Load classes FIRST so that loadStudents() has the active
            // class UUID set available when it filters students.
            // All other loaders that don't depend on classes run in parallel.
            await Promise.all([
                dataManager.loadAcademicYears(),
                dataManager.loadClasses(),
                dataManager.loadTeachers(),
                dataManager.loadParents(),
                dataManager.loadFees(),
                dataManager.loadTransactions(),
                dataManager.loadReports(),
                dataManager.loadReceivedReports(),
                dataManager.loadNotifications(),
                dataManager.loadPendingAdmins()
            ]);
            // Students must load after classes so the active-class filter works
            await dataManager.loadStudents();
            state.dataLoaded = true;
            console.log('Data loaded successfully');

            // Now that state.currentAY and state.currentTerm are set (by
            // loadAcademicYears above), reload weeks so the week pill in the
            // nav bar shows correctly for ALL roles — admin, teacher, parent.
            // This runs after the Promise.all so the AY/term context is
            // guaranteed to be populated before _autoActivateCurrentWeek runs.
            if (typeof featureDB !== 'undefined') {
                featureDB.loadWeeks().catch(() => {});
            }

            // Silently backfill class_id on any legacy student records that
            // still only have a class string.  Non-fatal — runs in background.
            dataManager.migrateStudentClassIds().catch(() => {});
        } catch (err) {
            console.error('Error loading initial data:', err);
            ui.showToast('Some data failed to load', 'warning');
        }
    },

    enterPortal() {
        document.getElementById('landing-page')?.classList.add('hidden');
        document.getElementById('auth-container')?.classList.remove('hidden');
        this.setRole('admin');
    },

    setRole(role) {
        state.role = role;

        // ── Highlight the active role button ──────────────────────────────────
        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.classList.remove('bg-ridge-500', 'text-white', 'ring-2', 'ring-ridge-500', 'ring-offset-2');
            btn.classList.add('hover:bg-slate-200', 'dark:hover:bg-slate-700');
        });
        const activeBtn = document.getElementById(`btn-${role}`);
        if (activeBtn) {
            activeBtn.classList.add('bg-ridge-500', 'text-white', 'ring-2', 'ring-ridge-500', 'ring-offset-2');
            activeBtn.classList.remove('hover:bg-slate-200', 'dark:hover:bg-slate-700');
        }

        // ── Forgot-password / admin-note visibility ───────────────────────────
        const forgotSection = document.getElementById('forgot-password-section');
        const adminNote     = document.getElementById('admin-reg-note');
        if (forgotSection && adminNote) {
            if (role === 'admin' || role === 'accountant') {
                // Admin and accountant passwords are reset by the school, not by email link
                forgotSection.classList.add('hidden');
                adminNote.classList.toggle('hidden', role !== 'admin');
            } else {
                forgotSection.classList.remove('hidden');
                adminNote.classList.add('hidden');
            }
        }

        // ── Email placeholder ─────────────────────────────────────────────────
        const emailInput = document.getElementById('auth-email');
        if (emailInput) {
            emailInput.placeholder = (role === 'parent' && state.authMode !== 'register')
                ? 'Email or Phone Number'
                : 'Email Address';
        }

        // ── Submit-button colour ──────────────────────────────────────────────
        const submitBtn = document.getElementById('auth-submit-btn');
        if (submitBtn) {
            submitBtn.className = submitBtn.className.replace(/bg-(ridge|blue|purple)-(500|600)/g, '');
            if (role === 'teacher')      submitBtn.classList.add('bg-blue-600');
            else if (role === 'parent')  submitBtn.classList.add('bg-purple-600');
            else                         submitBtn.classList.add('bg-ridge-500');
        }

        // ── Register-mode adjustments (title + phone field) ───────────────────
        if (state.authMode === 'register') {
            const authTitle = document.getElementById('auth-title');
            if (authTitle) authTitle.textContent = role === 'admin' ? 'Admin Registration' : 'Create Account';

            // Ensure the phone field exists in the DOM
            this._ensurePhoneField();

            // Show phone field only for parent, hide for admin/teacher
            const phoneField = document.getElementById('phone-reg-field');
            if (phoneField) {
                if (role === 'parent') {
                    phoneField.classList.remove('hidden');
                } else {
                    phoneField.classList.add('hidden');
                }
            }
        }
    },

    // Inject the phone field into reg-fields if it isn't there yet.
    _ensurePhoneField() {
        if (document.getElementById('phone-reg-field')) return; // already exists
        const regFields = document.getElementById('reg-fields');
        if (!regFields) return;
        const phoneDiv = document.createElement('div');
        phoneDiv.id = 'phone-reg-field';
        phoneDiv.className = 'hidden';
        phoneDiv.innerHTML = `
            <label class="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                Phone Number <span class="text-red-500">*</span>
            </label>
            <input type="tel" id="auth-phone" maxlength="13"
                class="w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                placeholder="e.g. 0241234567"
                oninput="(function(el){
                    const v = ghanaPhone.validate(el.value.trim());
                    if (el.value.trim().length >= 10) {
                        ghanaPhone.showError(el, v.valid ? null : v.error);
                        el.style.borderColor = v.valid ? '#10b981' : '#ef4444';
                    } else {
                        ghanaPhone.showError(el, null);
                        el.style.borderColor = '';
                    }
                })(this)">
            <p class="text-xs text-slate-400 mt-1">
                Valid Ghana number — 10 digits starting with 0 (e.g. 0241234567).<br>
                Accepted: MTN (020/024/025/053–055/059), Telecel (050), AirtelTigo (026/027/056/057), Glo (023/028).
            </p>`;
        regFields.appendChild(phoneDiv);
    },

    toggleAuthMode() {
        state.authMode = state.authMode === 'login' ? 'register' : 'login';

        const regFields  = document.getElementById('reg-fields');
        const authTitle  = document.getElementById('auth-title');
        const submitText = document.getElementById('auth-submit-text');
        const toggleBtn  = document.getElementById('toggle-auth-btn');
        const modeText   = document.getElementById('auth-mode-text');
        const emailInput = document.getElementById('auth-email');

        if (state.authMode === 'register') {
            // ── Show registration fields ──────────────────────────────────────
            if (regFields)  regFields.classList.remove('hidden');
            if (authTitle)  authTitle.textContent = state.role === 'admin' ? 'Admin Registration' : 'Create Account';
            if (submitText) submitText.textContent = 'Create Account';
            if (toggleBtn)  toggleBtn.textContent  = 'Already have an account? Sign In';
            if (modeText)   modeText.textContent   = 'Have an account?';
            if (emailInput) emailInput.placeholder = 'Email Address';

            // Ensure phone field exists, then show/hide based on current role
            this._ensurePhoneField();
            const phoneField = document.getElementById('phone-reg-field');
            if (phoneField) {
                if (state.role === 'parent') {
                    phoneField.classList.remove('hidden');
                } else {
                    phoneField.classList.add('hidden');
                }
            }
        } else {
            // ── Back to login ─────────────────────────────────────────────────
            if (regFields)  regFields.classList.add('hidden');
            if (authTitle)  authTitle.textContent = 'Secure Login';
            if (submitText) submitText.textContent = 'Authorize Access';
            if (toggleBtn)  toggleBtn.textContent  = 'Create Account';
            if (modeText)   modeText.textContent   = 'New to Ridgevalley?';
            if (emailInput) emailInput.placeholder = state.role === 'parent' ? 'Email or Phone Number' : 'Email Address';

            // Always hide phone field in login mode
            const phoneField = document.getElementById('phone-reg-field');
            if (phoneField) phoneField.classList.add('hidden');
        }
        if (state.accountantLogin) this._applyAccountantChrome();
    },

    // Empties the sign-in form so the next visitor gets a clean page.
    clearAuthForm() {
        ['auth-name', 'auth-email', 'auth-password', 'auth-phone', 'reset-email'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const pw = document.getElementById('auth-password');
        if (pw && pw.type !== 'password') {
            pw.type = 'password';
            const icon = pw.nextElementSibling?.querySelector('i');
            if (icon) icon.className = 'fas fa-eye';
        }
    },

    // ── Hidden accountant sign-in ─────────────────────────────────────────────
    // Nothing on the login screen links to it. Double-click an empty part of
    // the login screen (desktop) or press and hold one (touch) to open it.
    _isEmptyAuthSpace(target) {
        return !!target && !target.closest('.glass-panel, button, a, input, select, textarea, label');
    },

    initAccountantGesture() {
        const screen = document.getElementById('auth-container');
        if (!screen || screen.dataset.rvAcct) return;
        screen.dataset.rvAcct = '1';

        screen.addEventListener('dblclick', e => {
            if (!this._isEmptyAuthSpace(e.target)) return;
            window.getSelection?.()?.removeAllRanges();
            this.showAccountantLogin();
        });

        let timer = null, startX = 0, startY = 0;
        const cancel = () => { clearTimeout(timer); timer = null; };
        screen.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' || !this._isEmptyAuthSpace(e.target)) return;
            startX = e.clientX; startY = e.clientY;
            cancel();
            timer = setTimeout(() => {
                timer = null;
                try { navigator.vibrate?.(15); } catch (_) {}
                this.showAccountantLogin();
            }, 650);
        });
        screen.addEventListener('pointermove', e => {
            if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => screen.addEventListener(t, cancel));
        // No "copy / save image" menu when holding the background
        screen.addEventListener('contextmenu', e => { if (this._isEmptyAuthSpace(e.target)) e.preventDefault(); });
    },

    showAccountantLogin() {
        if (state.accountantLogin) return;
        state.accountantLogin = true;
        if (state.authMode === 'register') this.toggleAuthMode();
        this.setRole('accountant');
        this._applyAccountantChrome();
        document.getElementById('auth-email')?.focus({ preventScroll: true });
    },

    exitAccountantLogin() {
        state.accountantLogin = false;
        if (state.authMode === 'register') this.toggleAuthMode();
        this._applyAccountantChrome();
        this.setRole('admin');
    },

    _applyAccountantChrome() {
        const on = !!state.accountantLogin;
        const register = state.authMode === 'register';
        document.getElementById('role-switch')?.classList.toggle('hidden', on);
        document.getElementById('accountant-exit')?.classList.toggle('hidden', !on);
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        if (title) title.textContent = on
            ? (register ? 'Accountant Registration' : 'Accounts Office')
            : (register ? 'Create Account' : 'Secure Login');
        if (subtitle) subtitle.textContent = on
            ? (register ? 'New accountants are approved by an existing accountant' : 'Finance staff sign in')
            : 'Ridgevalley Unified Security Gateway';
    },

    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const icon = input.nextElementSibling?.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            if (icon) icon.className = 'fas fa-eye';
        }
    },

    toggleDarkMode() {
        document.documentElement.classList.toggle('dark');
        const isDark = document.documentElement.classList.contains('dark');
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) themeIcon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        localStorage.setItem('darkMode', isDark);
    },

    showForgotPassword() {
        const modalEl = document.getElementById('forgot-password-modal');
        const content = document.getElementById('forgot-password-content');
        if (!modalEl || !content) return;
        modalEl.classList.remove('hidden');
        modalEl.classList.add('flex');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 10);
    },

    closeForgotPassword() {
        const modalEl = document.getElementById('forgot-password-modal');
        const content = document.getElementById('forgot-password-content');
        if (!modalEl || !content) return;
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modalEl.classList.add('hidden');
            modalEl.classList.remove('flex');
        }, 300);
    },

    // ── Password-reset UI (shown after clicking the email link) ────────────
    showPasswordResetUI() {
        // Hide everything else
        document.getElementById('landing-page')?.classList.add('hidden');
        document.getElementById('auth-container')?.classList.add('hidden');
        document.getElementById('main-nav')?.classList.add('hidden');
        document.getElementById('dashboard')?.classList.add('hidden');

        // Build or reveal the reset panel
        let panel = document.getElementById('password-reset-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'password-reset-panel';
            panel.className = 'min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900';
            panel.innerHTML = `
                <div class="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8">
                    <div class="text-center mb-8">
                        <div class="w-16 h-16 bg-ridge-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
                            <i class="fas fa-lock-open text-2xl text-white"></i>
                        </div>
                        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Set New Password</h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Enter and confirm your new password below.</p>
                    </div>

                    <div id="reset-panel-error" class="hidden mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm"></div>
                    <div id="reset-panel-success" class="hidden mb-4 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-300 text-sm"></div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">New Password</label>
                            <div class="relative">
                                <input type="password" id="reset-new-password"
                                    class="w-full rounded-xl px-4 py-3 pr-12 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none transition-all"
                                    placeholder="At least 8 characters"
                                    oninput="app._validateResetForm()">
                                <button type="button" onclick="app._toggleResetVisibility('reset-new-password', 'eye-new')"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    <i id="eye-new" class="fas fa-eye text-sm"></i>
                                </button>
                            </div>
                            <div id="reset-strength-bar" class="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden hidden">
                                <div id="reset-strength-fill" class="h-full rounded-full transition-all duration-300" style="width:0%"></div>
                            </div>
                            <p id="reset-strength-label" class="text-xs mt-1 hidden"></p>
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Confirm Password</label>
                            <div class="relative">
                                <input type="password" id="reset-confirm-password"
                                    class="w-full rounded-xl px-4 py-3 pr-12 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none transition-all"
                                    placeholder="Re-enter new password"
                                    oninput="app._validateResetForm()">
                                <button type="button" onclick="app._toggleResetVisibility('reset-confirm-password', 'eye-confirm')"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    <i id="eye-confirm" class="fas fa-eye text-sm"></i>
                                </button>
                            </div>
                            <p id="reset-match-msg" class="text-xs mt-1 hidden"></p>
                        </div>
                        <button id="reset-submit-btn" onclick="app.submitPasswordReset()"
                            class="w-full py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled>
                            <i class="fas fa-check-circle mr-2"></i> Update Password
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);
        } else {
            panel.classList.remove('hidden');
        }

        // Focus the first field
        setTimeout(() => document.getElementById('reset-new-password')?.focus(), 100);
    },

    _toggleResetVisibility(inputId, iconId) {
        const input = document.getElementById(inputId);
        const icon  = document.getElementById(iconId);
        if (!input || !icon) return;
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        icon.className = isHidden ? 'fas fa-eye-slash text-sm' : 'fas fa-eye text-sm';
    },

    _validateResetForm() {
        const pw  = document.getElementById('reset-new-password')?.value  || '';
        const cpw = document.getElementById('reset-confirm-password')?.value || '';
        const btn = document.getElementById('reset-submit-btn');

        // Strength bar
        const bar      = document.getElementById('reset-strength-bar');
        const fill     = document.getElementById('reset-strength-fill');
        const label    = document.getElementById('reset-strength-label');
        if (bar && fill && label) {
            if (pw.length > 0) {
                bar.classList.remove('hidden');
                label.classList.remove('hidden');
                let score = 0;
                if (pw.length >= 8)                     score++;
                if (/[A-Z]/.test(pw))                   score++;
                if (/[0-9]/.test(pw))                   score++;
                if (/[^A-Za-z0-9]/.test(pw))            score++;
                const levels = [
                    { w: '25%', color: 'bg-red-500',    text: 'Weak',   cls: 'text-red-500'    },
                    { w: '50%', color: 'bg-amber-500',   text: 'Fair',   cls: 'text-amber-500'  },
                    { w: '75%', color: 'bg-yellow-500',  text: 'Good',   cls: 'text-yellow-500' },
                    { w: '100%',color: 'bg-emerald-500', text: 'Strong', cls: 'text-emerald-500'}
                ];
                const lvl = levels[Math.max(0, score - 1)];
                fill.style.width  = lvl.w;
                fill.className    = `h-full rounded-full transition-all duration-300 ${lvl.color}`;
                label.textContent = lvl.text;
                label.className   = `text-xs mt-1 font-semibold ${lvl.cls}`;
            } else {
                bar.classList.add('hidden');
                label.classList.add('hidden');
            }
        }

        // Match message
        const matchMsg = document.getElementById('reset-match-msg');
        if (matchMsg) {
            if (cpw.length > 0) {
                matchMsg.classList.remove('hidden');
                if (pw === cpw) {
                    matchMsg.textContent = 'Passwords match';
                    matchMsg.className   = 'text-xs mt-1 text-emerald-600 dark:text-emerald-400 font-semibold';
                } else {
                    matchMsg.textContent = 'Passwords do not match';
                    matchMsg.className   = 'text-xs mt-1 text-red-500 font-semibold';
                }
            } else {
                matchMsg.classList.add('hidden');
            }
        }

        // Enable button only when both fields are valid
        if (btn) btn.disabled = !(pw.length >= 8 && pw === cpw);
    },

    async submitPasswordReset() {
        const pw  = document.getElementById('reset-new-password')?.value  || '';
        const cpw = document.getElementById('reset-confirm-password')?.value || '';
        const errEl  = document.getElementById('reset-panel-error');
        const succEl = document.getElementById('reset-panel-success');
        const btn    = document.getElementById('reset-submit-btn');

        if (errEl)  { errEl.classList.add('hidden');  errEl.textContent  = ''; }
        if (succEl) { succEl.classList.add('hidden'); succEl.textContent = ''; }

        if (pw.length < 8)  {
            if (errEl) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('hidden'); }
            return;
        }
        if (pw !== cpw) {
            if (errEl) { errEl.textContent = 'Passwords do not match.'; errEl.classList.remove('hidden'); }
            return;
        }

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Updating...'; }

        try {
            const { error } = await supabaseClient.auth.updateUser({ password: pw });
            if (error) throw error;

            if (succEl) {
                succEl.textContent = 'Password updated successfully! Redirecting to login…';
                succEl.classList.remove('hidden');
            }

            // Sign out so they log in fresh with the new password
            await supabaseClient.auth.signOut();

            setTimeout(() => {
                const panel = document.getElementById('password-reset-panel');
                if (panel) panel.classList.add('hidden');
                location.reload();
            }, 2000);

        } catch (err) {
            const msg = err?.message || 'Failed to update password. The reset link may have expired.';
            if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
            if (btn)   { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Update Password'; }
        }
    },

    showLoading(text = 'Processing...') {
        state.isLoading = true;
        const loadingText = document.getElementById('loading-text');
        const overlay = document.getElementById('loading-overlay');
        if (loadingText) loadingText.textContent = text;
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');
        }
    },

    hideLoading() {
        state.isLoading = false;
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }
    }
};

// ==================== GHANA PHONE VALIDATION ====================
const ghanaPhone = {
    // All active Ghana mobile prefixes as of 2025 (MTN, Telecel/Vodafone, AirtelTigo, Glo)
    // Format: 10 digits starting with 0XXXXXXXXX
    validPrefixes: [
        // MTN Ghana
        '020','024','054','055','059','025',
        // Telecel Ghana (formerly Vodafone)
        '020','050','020',
        // AirtelTigo
        '026','027','056','057',
        // Glo Ghana
        '023','028',
        // Newer / additional MTN ranges
        '053','055','059',
        // Telecel new ranges
        '050',
        // AT new ranges
        '057',
        // All valid confirmed current prefixes (deduplicated below)
    ],

    // Canonical set — covers all telcos including newer allocations
    _prefixSet: new Set([
        // MTN Ghana
        '020','024','054','055','059','025','053',
        // Telecel Ghana (formerly Vodafone Ghana, rebranded 2024)
        '050',
        // AirtelTigo (merged Airtel + Tigo)
        '026','027','056','057',
        // Glo Ghana
        '023','028',
    ]),

    /**
     * Normalise a Ghanaian phone number to 0XXXXXXXXX (10 digits).
     * Accepts: 0241234567 | +233241234567 | 233241234567 | 024 123 4567
     * Returns null if the number cannot be normalised.
     */
    normalise(raw) {
        if (!raw) return null;
        // Strip spaces, dashes, dots, parentheses
        let s = raw.replace(/[\s\-().]/g, '');
        // +233XXXXXXXXX → 0XXXXXXXXX
        if (s.startsWith('+233')) s = '0' + s.slice(4);
        // 233XXXXXXXXX → 0XXXXXXXXX
        else if (s.startsWith('233') && s.length === 12) s = '0' + s.slice(3);
        return s;
    },

    /**
     * Validate a Ghanaian mobile number.
     * Returns { valid: true, normalised: '0XXXXXXXXX' }
     * or      { valid: false, error: 'human-readable message' }
     */
    validate(raw) {
        const n = this.normalise(raw);
        if (!n) return { valid: false, error: 'Please enter a phone number.' };
        if (!/^\d+$/.test(n)) return { valid: false, error: 'Phone number must contain digits only.' };
        if (n.length !== 10) return { valid: false, error: `Phone number must be 10 digits (got ${n.length}). Format: 0XXXXXXXXX` };
        if (!n.startsWith('0')) return { valid: false, error: 'Phone number must start with 0 (e.g. 0241234567).' };
        const prefix = n.slice(0, 3);
        if (!this._prefixSet.has(prefix)) {
            return { valid: false, error: `"${prefix}" is not a recognised Ghana network prefix. Valid prefixes: 020, 023, 024, 025, 026, 027, 028, 050, 053, 054, 055, 056, 057, 059.` };
        }
        return { valid: true, normalised: n };
    },

    /** Show inline error under an input element. Pass null/'' to clear. */
    showError(inputEl, message) {
        if (!inputEl) return;
        const existingErr = inputEl.parentElement?.querySelector('.gh-phone-err');
        if (existingErr) existingErr.remove();
        if (message) {
            const err = document.createElement('p');
            err.className = 'gh-phone-err';
            err.style.cssText = 'color:#ef4444;font-size:11px;margin-top:4px;';
            err.textContent = message;
            inputEl.parentElement?.appendChild(err);
            inputEl.style.borderColor = '#ef4444';
        } else {
            inputEl.style.borderColor = '';
        }
    }
};

// ==================== AUTHENTICATION ====================
const auth = {
    async handleAction() {
        if (state.isLoading) return;

        const name = document.getElementById('auth-name')?.value.trim();
        const emailOrPhone = document.getElementById('auth-email')?.value.trim();
        const password = document.getElementById('auth-password')?.value;

        if (!emailOrPhone || !password) {
            modal.alert('Validation Error', 'Please fill in all fields', 'warning');
            return;
        }

        if (state.authMode === 'register') {
            if (!name) {
                modal.alert('Validation Error', 'Please enter your full name', 'warning');
                return;
            }
            // Validate Ghana phone number for parent registration
            if (state.role === 'parent') {
                const phoneInputEl = document.getElementById('auth-phone');
                const rawPhone = phoneInputEl?.value?.trim() || '';
                if (!rawPhone) {
                    modal.alert('Phone Required', 'A phone number is required to create a parent account. It allows you to log in with your phone number.', 'warning');
                    if (phoneInputEl) phoneInputEl.focus();
                    return;
                }
                const phoneCheck = ghanaPhone.validate(rawPhone);
                if (!phoneCheck.valid) {
                    ghanaPhone.showError(phoneInputEl, phoneCheck.error);
                    modal.alert('Invalid Phone Number', phoneCheck.error, 'warning');
                    return;
                }
                ghanaPhone.showError(phoneInputEl, null);
                // Store normalised form back so register() picks it up correctly
                if (phoneInputEl) phoneInputEl.value = phoneCheck.normalised;
            }
            await this.register(name, emailOrPhone, password);
        } else {
            // For login: if it looks like a phone number, resolve to email first
            let loginEmail = emailOrPhone;
            const looksLikePhone = /^[+\d\s\-().]{7,20}$/.test(emailOrPhone) && !emailOrPhone.includes('@');
            if (looksLikePhone) {
                // Only parents can log in with a phone number
                if (state.role !== 'parent') {
                    modal.alert('Login Error', 'Please enter a valid email address.', 'warning');
                    return;
                }
                const phoneCheck = ghanaPhone.validate(emailOrPhone);
                if (!phoneCheck.valid) {
                    modal.alert('Invalid Phone Number', phoneCheck.error, 'warning');
                    return;
                }
                const normalisedPhone = phoneCheck.normalised;
                app.showLoading('Looking up account...');
                try {
                    const { data: phoneEmail, error: phoneError } = await supabaseClient
                        .rpc('login_email_for_phone', { p_phone: normalisedPhone });
                    if (phoneError) throw phoneError;
                    if (phoneEmail) {
                        loginEmail = phoneEmail;
                    } else {
                        app.hideLoading();
                        modal.alert('Login Failed', 'No account found with that phone number. Please use your email address.', 'error');
                        return;
                    }
                } catch (err) {
                    app.hideLoading();
                    modal.alert('Error', 'Could not resolve phone number: ' + extractErrorMessage(err), 'error');
                    return;
                }
                app.hideLoading();
            }
            await this.login(loginEmail, password);
        }
    },

    async login(email, password) {
        app.showLoading('Authenticating...');
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Accountants sign in only through the accounts-office screen, and
            // that screen only lets accountants in.
            const { data: prof } = await supabaseClient
                .from('profiles').select('role').eq('id', data.user.id).maybeSingle();
            const isAccountant = prof?.role === 'accountant';
            if (isAccountant !== !!state.accountantLogin) {
                await supabaseClient.auth.signOut();
                app.hideLoading();
                modal.alert('Login Failed',
                    state.accountantLogin ? 'This sign-in is for the accounts office only.' : 'Invalid login credentials',
                    'error');
                return;
            }
            await app.loadUserData(data.user);
        } catch (error) {
            app.hideLoading();
            modal.alert('Login Failed', extractErrorMessage(error), 'error');
        }
    },

    async register(name, email, password) {
        app.showLoading('Creating account...');
        try {
            // Get phone number if parent role — already validated & normalised by handleAction
            const rawPhone = document.getElementById('auth-phone')?.value?.trim() || null;
            const phoneInput = rawPhone ? (ghanaPhone.validate(rawPhone).normalised || rawPhone) : null;

            const { error: authError } = await supabaseClient.auth.signUp({
                email,
                password,
                // The profile and teacher/parent rows are created by the
                // on_auth_user_created database trigger from this metadata.
                // Role, approval and super-admin status are decided server-side.
                options: {
                    data: { full_name: name, role: state.role, phone: phoneInput || null }
                }
            });

            if (authError) throw authError;

            app.hideLoading();
            const pendingMsg = {
                admin: 'Your account is pending approval from a super admin.',
                accountant: "Please verify your email address. If you are the school's first accountant you can sign in straight away; otherwise an existing accountant must approve your account first.",
                teacher: 'Please verify your email address. An administrator must approve your account before you can sign in.'
            };
            modal.alert(
                state.role === 'parent' ? 'Account Created' : 'Registration Successful',
                pendingMsg[state.role] || 'Please verify your email address.',
                'success'
            );
            app.toggleAuthMode();
            
        } catch (error) {
            console.error('Registration error:', error);
            app.hideLoading();
            modal.alert('Registration Failed', extractErrorMessage(error), 'error');
        }
    },

    async sendResetLink() {
        const email = document.getElementById('reset-email')?.value.trim();
        if (!email) {
            modal.alert('Validation Error', 'Please enter your email', 'warning');
            return;
        }

        app.showLoading('Sending reset link...');
        try {
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname + '?reset=1'
            });
            app.hideLoading();
            app.closeForgotPassword();
            if (error) throw error;
            modal.alert('Success', 'Password reset link sent to your email', 'success');
        } catch (error) {
            app.hideLoading();
            modal.alert('Error', extractErrorMessage(error), 'error');
        }
    },

    async logout() {
        await supabaseClient.auth.signOut();
        state.currentUser = null;
        state.role = 'admin';
        app.clearAuthForm();
        // replace() instead of reload(): a reload makes the browser refill the
        // sign-in form with what was typed before.
        location.replace(location.pathname);
    }
};

// ==================== DATA MANAGER ====================
const dataManager = {
    async loadAcademicYears() {
        try {
            const { data, error } = await supabaseClient
                .from('academic_years')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            state.academicYears = data || [];
            const active = state.academicYears.find(y => y.active);
            if (active) {
                state.currentAY = active;
                state.currentTerm = active.terms?.find(t => t.active);
                ui.updatePeriodDisplay();
            }
        } catch (err) {
            console.error('loadAcademicYears error:', err);
            state.academicYears = [];
        }
    },

    async loadClasses() {
        try {
            const { data, error } = await supabaseClient
                .from('classes')
                .select('*')
                .neq('is_deleted', true)
                .order('created_at');
            
            if (error) throw error;
            state.classes = data || [];
        } catch (err) {
            console.error('loadClasses error:', err);
            state.classes = [];
        }
    },

    async loadStudents() {
        try {
            const { data, error } = await supabaseClient
                .from('students')
                .select('*')
                .order('name');
            
            if (error) throw error;

            // FIX 2 + FIX 8: Only keep students whose class is currently active.
            // Build a set of active class UUIDs from state.classes (which already
            // filters is_deleted via loadClasses). Students with no class_id are
            // legacy records — keep them visible so they are not accidentally hidden.
            const allStudents = data || [];
            let filtered;
            if (state.classes && state.classes.length > 0) {
                const activeClassIds = new Set(state.classes.map(c => c.id));
                filtered = allStudents.filter(s => {
                    // Keep legacy students with no class_id (backward compat)
                    if (!s.class_id) return true;
                    // Keep only if their class is active (not soft-deleted)
                    return activeClassIds.has(s.class_id);
                });
            } else {
                // No classes loaded yet — keep all (will be refined on re-render)
                filtered = allStudents;
            }

            // NORMALIZATION: ensure every student has a readable class label and
            // a valid class_id. Runs synchronously so ALL views downstream
            // (admin registry, teacher dashboard, attendance, reports,
            //  promotion & graduation) receive consistent, UUID-free data.
            state.students = this.normalizeStudentRecords(filtered);
        } catch (err) {
            console.error('loadStudents error:', err);
            state.students = [];
        }
    },

    async loadTeachers() {
        try {
            // Primary: profiles table (always populated on registration)
            const { data: profiles, error: profilesError } = await supabaseClient
                .from('profiles')
                .select('id, full_name, email, approved, is_super_admin, created_at')
                .eq('role', 'teacher');

            if (profilesError) throw profilesError;

            // Secondary: teachers table for assigned_class
            const { data: teacherRows, error: teachersError } = await supabaseClient
                .from('teachers')
                .select('id, profile_id, assigned_class, email, full_name');

            if (teachersError) console.warn('teachers table query error:', teachersError);

            // Only attempt to backfill missing teachers rows when running as admin
            // (teachers may only be able to read their own row via RLS, which would
            // make every other teacher look "missing" and trigger spurious inserts).
            let finalTeacherRows = teacherRows || [];
            if (state.role === 'admin') {
                const missingRows = (profiles || []).filter(p =>
                    !(teacherRows || []).some(t => t.profile_id === p.id)
                );
                for (const p of missingRows) {
                    await supabaseClient.from('teachers').insert([{
                        profile_id: p.id,
                        email: p.email,
                        full_name: p.full_name,
                        assigned_class: null
                    }]);
                }
                if (missingRows.length > 0) {
                    const { data: refreshed } = await supabaseClient
                        .from('teachers')
                        .select('id, profile_id, assigned_class, email, full_name');
                    finalTeacherRows = refreshed || [];
                }
            }

            // Merge: always use profile_id as the stable identifier
            state.teachers = (profiles || []).map(p => {
                const tRow = finalTeacherRows.find(t => t.profile_id === p.id);
                return {
                    ...p,
                    id: tRow?.id || null,          // teachers table row id (for DB ops)
                    profile_id: p.id,              // auth/profiles uuid
                    assigned_class: tRow?.assigned_class || null,
                    full_name: p.full_name || tRow?.full_name || 'Unknown',
                    email: p.email || tRow?.email || ''
                };
            });
        } catch (err) {
            console.error('loadTeachers error:', err);
            state.teachers = [];
        }
    },

    async loadParents() {
        try {
            // Primary: profiles table (always populated on registration)
            const { data: profiles, error: profilesError } = await supabaseClient
                .from('profiles')
                .select('id, full_name, email, phone, created_at')
                .eq('role', 'parent');

            if (profilesError) throw profilesError;

            // Secondary: parents table for children_ids and phone
            const { data: parentRows, error: parentsError } = await supabaseClient
                .from('parents')
                .select('id, profile_id, children_ids, pending_children_ids, email, full_name, phone');

            if (parentsError) console.warn('parents table query error:', parentsError);

            // For any profile that has no parents row yet, insert one
            const missingRows = (profiles || []).filter(p =>
                !(parentRows || []).some(r => r.profile_id === p.id)
            );
            for (const p of missingRows) {
                await supabaseClient.from('parents').insert([{
                    profile_id: p.id,
                    email: p.email,
                    full_name: p.full_name,
                    phone: p.phone || null,
                    children_ids: []
                }]);
            }

            // Re-fetch if we inserted any missing ones
            let finalParentRows = parentRows || [];
            if (missingRows.length > 0) {
                const { data: refreshed } = await supabaseClient
                    .from('parents')
                    .select('id, profile_id, children_ids, pending_children_ids, email, full_name, phone');
                finalParentRows = refreshed || [];
            }

            // Merge profiles with parent rows — phone comes from parents table first, then profiles
            state.parents = (profiles || []).map(p => {
                const pRow = finalParentRows.find(r => r.profile_id === p.id);
                return {
                    ...p,
                    id: pRow?.id || null,          // parents table row id
                    profile_id: p.id,              // auth/profiles uuid
                    children_ids: pRow?.children_ids || [],
                    pending_children_ids: pRow?.pending_children_ids || [],
                    full_name: p.full_name || pRow?.full_name || 'Unknown',
                    email: p.email || pRow?.email || '',
                    phone: pRow?.phone || p.phone || null
                };
            });
        } catch (err) {
            console.error('loadParents error:', err);
            state.parents = [];
        }
    },

    async loadFees() {
        try {
            const { data, error } = await supabaseClient
                .from('fees')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            state.fees = data || [];
        } catch (err) {
            console.error('loadFees error:', err);
            state.fees = [];
        }
    },

    async loadTransactions() {
        try {
            const { data, error } = await supabaseClient
                .from('transactions')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            state.transactions = data || [];
        } catch (err) {
            console.error('loadTransactions error:', err);
            state.transactions = [];
        }
    },

    async loadReports() {
        try {
            const { data, error } = await supabaseClient
                .from('reports')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            state.reports = data || [];
        } catch (err) {
            console.error('loadReports error:', err);
            state.reports = [];
        }
    },


    async loadReceivedReports() {
        try {
            const { data, error } = await supabaseClient
                .from('received_reports')
                .select('*')
                .order('submitted_at', { ascending: false });

            if (error) {
                console.error('Received reports query error:', error);
                throw error;
            }

            state.receivedReports = data || [];
            console.log(`Loaded ${state.receivedReports.length} received reports`);

        } catch (err) {
            console.error('loadReceivedReports error:', err);
            state.receivedReports = [];
            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('Failed to load received reports: ' + extractErrorMessage(err), 'error');
            }
        }
    },

    async loadNotifications() {
        if (!state.currentUser) return;
        try {
            const roleTarget = state.role;

            // FIX 2: For admin — only fetch notifications explicitly addressed to the
            // admin's user_id (payment approvals, teacher report submissions, child-linking
            // events). Admin must NOT receive broadcast teacher/parent announcements or
            // personal messages meant for teachers/parents.
            if (roleTarget === 'admin') {
                const { data: adminNotifs } = await supabaseClient
                    .from('notifications')
                    .select('*')
                    .eq('user_id', state.currentUser.id)
                    // Payment alerts go to the accountant now
                    .in('type', ['report_submitted', 'child_linked', 'system', 'report_correction'])
                    .order('created_at', { ascending: false })
                    .limit(50);

                // Also load announcements this admin sent (for the Announcements page history)
                const { data: sentAnnouncements } = await supabaseClient
                    .from('notifications')
                    .select('*')
                    .eq('created_by', state.currentUser.id)
                    .eq('type', 'announcement')
                    .order('created_at', { ascending: false })
                    .limit(100);

                // Keep admin personal notifs separate from sent announcements
                // so the bell only counts truly unread admin-directed messages
                state.notifications = adminNotifs || [];
                state.sentAnnouncements = sentAnnouncements || [];
                return;
            }

            // For teachers and parents: personal + broadcast announcements for their role
            const { data, error } = await supabaseClient
                .from('notifications')
                .select('*')
                .or(`user_id.eq.${state.currentUser.id},and(user_id.is.null,type.eq.announcement)`)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            state.notifications = (data || []).filter(n => {
                if (n.user_id === state.currentUser.id) return true;
                if (n.type === 'announcement') {
                    return !n.target || n.target === 'all' || n.target === roleTarget + 's' || n.target === roleTarget;
                }
                return false;
            });
        } catch (err) {
            console.error('loadNotifications error:', err);
            state.notifications = [];
        }
    },

    // ── STUDENT NORMALIZATION ───────────────────────────────────────────────
    // Single source of truth: ensures every student object always has
    //   • class_id  → a valid UUID (never null if a matching class exists)
    //   • class     → a human-readable "Level - Grade" label (never a raw UUID)
    //
    // Called synchronously on the in-memory array after every load so ALL
    // views (admin registry, teacher dashboard, attendance, reports,
    // promotion/graduation) receive consistent data without extra queries.
    normalizeStudentRecords(students) {
        if (!state.classes || state.classes.length === 0) return students;

        // Build fast-lookup maps from the active classes list
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        // id → class object
        const classById = {};
        // normalised canonical class name → class object
        // FIX: use buildClassName() (which applies the BASIC prefix for numeric grades)
        // so string-based lookups match the same format written to students.class.
        const classByLabel = {};

        state.classes.forEach(c => {
            classById[c.id] = c;
            // FIX: use buildClassName() so numeric grades get the BASIC prefix,
            // matching the format stored in students.class by addStudent/editStudent.
            classByLabel[normalizeClassName(buildClassName(c))] = c;
        });

        return students.map(student => {
            // Work on a shallow copy so we don't mutate the original accidentally
            const s = { ...student };
            let classObj = null;

            // 1. Try resolving via class_id first (the authoritative FK)
            if (s.class_id && classById[s.class_id]) {
                classObj = classById[s.class_id];
            }

            // 2. If class field contains a raw UUID, attempt to resolve it
            if (!classObj && s.class && UUID_RE.test(s.class.trim())) {
                classObj = classById[s.class.trim()] || null;
                if (classObj) {
                    // The class_id may also be wrong/missing — repair it
                    s.class_id = classObj.id;
                }
            }

            // 3. If class_id is missing/unresolvable, try matching the label
            if (!classObj && s.class && !UUID_RE.test(s.class.trim())) {
                classObj = classByLabel[normalizeClassName(s.class)] || null;
                if (classObj) {
                    s.class_id = classObj.id;
                }
            }

            // 4. Apply the resolved canonical label & id
            if (classObj) {
                s.class    = buildClassName(classObj);
                s.class_id = classObj.id;
            } else if (s.class && UUID_RE.test(s.class.trim())) {
                // Last resort: class is still a UUID we could not resolve — clear it
                // to avoid displaying garbage in the UI. Keep class_id as-is.
                s.class = '';
            }

            return s;
        });
    },

    // ── UUID MIGRATION ──────────────────────────────────────────────────────
    // Backfills class_id on any student record that has a class string but no
    // class_id UUID yet, and also repairs UUID-in-class corruptions in the DB.
    // Runs silently in the background after initial load; failures are non-fatal.
    async migrateStudentClassIds() {
        try {
            if (!state.classes || state.classes.length === 0) return;

            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

            const classById   = {};
            const classByLabel = {};
            state.classes.forEach(c => {
                classById[c.id] = c;
                // FIX: use buildClassName() to match the BASIC-prefix format
                classByLabel[normalizeClassName(buildClassName(c))] = c.id;
            });

            const toFix = state.students.filter(s => {
                // Needs class_id backfill
                if (!s.class_id && s.class && !UUID_RE.test(s.class.trim())) return true;
                // Has UUID contaminating the class label field
                if (s.class && UUID_RE.test(s.class.trim())) return true;
                return false;
            });

            if (toFix.length === 0) return;

            for (const student of toFix) {
                let newClassId    = student.class_id || null;
                let newClassLabel = student.class    || null;
                let classObj      = null;

                // Resolve from UUID-in-class field
                if (student.class && UUID_RE.test(student.class.trim())) {
                    classObj = classById[student.class.trim()] || null;
                    if (classObj) {
                        newClassId    = classObj.id;
                        newClassLabel = buildClassName(classObj);
                    } else {
                        newClassLabel = ''; // can't resolve — clear rather than show UUID
                    }
                }

                // Resolve from label if still no class_id
                if (!newClassId && newClassLabel && !UUID_RE.test((newClassLabel || '').trim())) {
                    newClassId = classByLabel[normalizeClassName(newClassLabel)] || null;
                    if (newClassId) classObj = classById[newClassId];
                }

                const updates = {};
                if (newClassId   && newClassId   !== student.class_id) updates.class_id = newClassId;
                if (newClassLabel !== student.class)                    updates.class    = newClassLabel || '';

                if (Object.keys(updates).length === 0) continue;

                const { error } = await supabaseClient
                    .from('students')
                    .update(updates)
                    .eq('id', student.id);

                if (!error) {
                    const idx = state.students.findIndex(s => s.id === student.id);
                    if (idx !== -1) {
                        if (updates.class_id) state.students[idx].class_id = updates.class_id;
                        if ('class' in updates) state.students[idx].class   = updates.class;
                    }
                }
            }
            console.log(`[migration] repaired class data for ${toFix.length} student(s)`);
        } catch (e) {
            console.warn('[migration] migrateStudentClassIds error (non-fatal):', e);
        }
    },
    // ────────────────────────────────────────────────────────────────────────

    async loadPendingAdmins() {
        // Accountants approve new accountants; admins approve admins and teachers.
        if (state.role === 'accountant') {
            state.pendingAdmins = [];
            state.pendingTeachers = [];
            try {
                const { data, error } = await supabaseClient
                    .from('profiles')
                    .select('id, full_name, email, role, approved, created_at')
                    .eq('role', 'accountant')
                    .eq('approved', false)
                    .order('created_at', { ascending: true });
                if (error) throw error;
                state.pendingAccountants = (data || []).map(p => ({ ...p, profile_id: p.id }));
            } catch (err) {
                console.error('loadPendingAdmins (accountant) error:', err);
                state.pendingAccountants = [];
            }
            return;
        }
        if (state.role !== 'admin') {
            state.pendingAdmins = [];
            state.pendingTeachers = [];
            state.pendingAccountants = [];
            return;
        }
        try {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('id, full_name, email, role, approved, created_at')
                .in('role', ['admin', 'teacher'])
                .eq('approved', false);
            if (error) throw error;
            const rows = (data || []).map(p => ({ ...p, profile_id: p.id }));
            state.pendingAdmins = rows.filter(p => p.role === 'admin');
            state.pendingTeachers = rows.filter(p => p.role === 'teacher');
            state.pendingAccountants = [];
        } catch (err) {
            console.error('loadPendingAdmins error:', err);
            state.pendingAdmins = [];
            state.pendingTeachers = [];
            state.pendingAccountants = [];
        }
    },

    calculateStudentArrears(studentId) {
        const student = state.students.find(s => s.id === studentId);
        if (!student || !state.currentAY || !state.currentTerm) return 0;

        const applicableFees = state.fees.filter(fee => {
            if (fee.year_id !== state.currentAY.id || fee.term_id !== state.currentTerm.id) return false;
            if (fee.scope === 'global') return true;
            const studentClassLevel = student.class?.split(' - ')[0];
            return fee.scope === studentClassLevel;
        });

        const totalFees = applicableFees.reduce((sum, fee) => sum + (parseFloat(fee.amount) || 0), 0);
        
        const payments = state.transactions.filter(t => 
            t.student_id === studentId && 
            t.type === 'payment' &&
            t.status === 'confirmed' &&
            t.year_id === state.currentAY.id &&
            t.term_id === state.currentTerm.id
        );

        const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        return Math.max(0, totalFees - totalPaid);
    },

    getCurrentTeacher() {
        // Primary: find by profile_id (standard merge path)
        const byProfile = state.teachers.find(t => t.profile_id === state.currentUser?.id);
        if (byProfile) return byProfile;
        // Fallback: find by email in case profile_id linkage is missing
        const email = state.currentUser?.email;
        if (email) return state.teachers.find(t => t.email === email) || null;
        return null;
    },

    // Fetches the current teacher's record directly from the DB and patches
    // state.teachers so getCurrentTeacher() always returns the latest assignment.
    // Uses two query strategies so it works regardless of RLS configuration.
    async refreshCurrentTeacherAssignment() {
        const userId = state.currentUser?.id;
        const userEmail = state.currentUser?.email;
        if (!userId && !userEmail) return;
        try {
            // Strategy 1: query teachers table by profile_id
            let data = null;
            if (userId) {
                const { data: byProfile } = await supabaseClient
                    .from('teachers')
                    .select('id, profile_id, assigned_class, email, full_name')
                    .eq('profile_id', userId)
                    .limit(1);
                if (byProfile && byProfile.length > 0) data = byProfile[0];
            }
            // Strategy 2: fallback — query by email if profile_id returned nothing
            if (!data && userEmail) {
                const { data: byEmail } = await supabaseClient
                    .from('teachers')
                    .select('id, profile_id, assigned_class, email, full_name')
                    .eq('email', userEmail)
                    .limit(1);
                if (byEmail && byEmail.length > 0) data = byEmail[0];
            }
            if (!data) return;

            // Find the matching entry in state.teachers and patch it in-place
            const idx = state.teachers.findIndex(t =>
                t.profile_id === userId ||
                t.profile_id === data.profile_id ||
                (userEmail && t.email === userEmail)
            );
            if (idx !== -1) {
                state.teachers[idx].assigned_class = data.assigned_class;
                state.teachers[idx].id = data.id;
                if (data.profile_id) state.teachers[idx].profile_id = data.profile_id;
            } else {
                // Entry not in state.teachers at all — add it so getCurrentTeacher() works
                state.teachers.push({
                    id: data.id,
                    profile_id: data.profile_id || userId,
                    assigned_class: data.assigned_class,
                    email: data.email || userEmail || '',
                    full_name: data.full_name || state.currentUser?.full_name || ''
                });
            }
        } catch (e) { /* non-fatal */ }
    },

    getTeacherStudents() {
        const teacher = this.getCurrentTeacher();
        if (!teacher || !teacher.assigned_class) return [];

        // Resolve the assigned class object from state.classes using UUID
        const assignedClass = state.classes.find(c => c.id === teacher.assigned_class);
        if (!assignedClass) return [];

        const classId = assignedClass.id;
        // Canonical normalised string for fallback matching on legacy records
        const classString = buildClassName(assignedClass);

        return state.students.filter(s => {
            // Primary: UUID match (new records)
            if (s.class_id) return s.class_id === classId;
            // Fallback: normalised string match (legacy records without class_id)
            return normalizeClassName(s.class) === normalizeClassName(classString);
        });
    },

    getAllArrears() {
        return state.students.map(student => {
            const arrears = this.calculateStudentArrears(student.id);
            const parent = state.parents.find(p => p.children_ids?.includes(student.id));
            // Resolve readable class label — never expose raw UUIDs
            let resolvedClass = student.class;
            if (student.class_id) {
                const classObj = state.classes.find(c => c.id === student.class_id);
                if (classObj) resolvedClass = buildClassName(classObj);
            }
            return {
                studentId: student.id,
                studentName: student.name,
                studentClass: resolvedClass,
                amount: arrears,
                parentName: parent?.full_name || 'No Parent Linked',
                parentId: parent?.id
            };
        }).filter(item => item.amount > 0);
    }
};

// ==================== UI CONTROLLER ====================
const ui = {
    toggleSidebar() {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        state.isSidebarOpen = !state.isSidebarOpen;
        const isMobile = window.innerWidth <= 768;

        if (state.isSidebarOpen) {
            if (isMobile) {
                sidebar?.classList.add('mobile-open');
                document.body.classList.add('sidebar-open');
            } else {
                sidebar?.classList.remove('-translate-x-full');
            }
            overlay?.classList.remove('hidden');
            overlay?.classList.remove('pointer-events-none');
            setTimeout(() => overlay?.classList.remove('opacity-0'), 10);
        } else {
            if (isMobile) {
                sidebar?.classList.remove('mobile-open');
                document.body.classList.remove('sidebar-open');
            } else {
                sidebar?.classList.add('-translate-x-full');
            }
            overlay?.classList.add('opacity-0');
            overlay?.classList.add('pointer-events-none');
            setTimeout(() => overlay?.classList.add('hidden'), 300);
        }
    },

    closeSidebar() {
        if (!state.isSidebarOpen) return;
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        state.isSidebarOpen = false;
        sidebar?.classList.remove('mobile-open');
        sidebar?.classList.add('-translate-x-full');
        document.body.classList.remove('sidebar-open');
        overlay?.classList.add('opacity-0');
        overlay?.classList.add('pointer-events-none');
        setTimeout(() => overlay?.classList.add('hidden'), 300);
    },

    updateSidebar() {
        // ── Inject global design system CSS once ──────────────────────────────
        if (!document.getElementById('rv-design-system')) {
            const style = document.createElement('style');
            style.id = 'rv-design-system';
            style.textContent = `
                /* Ridgevalley design system — one font, one primary (school green),
                   navy chrome from the crest ribbon, blue kept for information only. */
                :root {
                    --rv-navy:       #0f2044;
                    --rv-navy-2:     #16295a;
                    --rv-blue:       #1d4ed8;
                    --rv-blue-light: #3b82f6;
                    --rv-green:      #047857;
                    --rv-green-500:  #059669;
                    --rv-green-soft: #ecfdf5;
                    --rv-gold:       #d97706;
                    --rv-emerald:    #059669;
                    --rv-red:        #dc2626;
                    --rv-surface:    #ffffff;
                    --rv-bg:         #f4f6fa;
                    --rv-border:     #e3e8ef;
                    --rv-text:       #0f172a;
                    --rv-muted:      #5b6577;
                    --rv-sidebar-w:  264px;
                    --rv-nav-h:      60px;
                    --rv-radius:     14px;
                    --rv-radius-sm:  10px;
                    --rv-shadow:     0 1px 2px rgba(15,32,68,0.05), 0 2px 10px rgba(15,32,68,0.05);
                    --rv-shadow-md:  0 2px 4px rgba(15,32,68,0.06), 0 10px 28px rgba(15,32,68,0.10);
                    --rv-ease-out:   cubic-bezier(0.23, 1, 0.32, 1);
                    --rv-ease-drawer:cubic-bezier(0.32, 0.72, 0, 1);
                    --rv-focus:      0 0 0 3px rgba(5,150,105,0.35);
                }

                .dark {
                    --rv-navy:    #000000;
                    --rv-surface: #0f0f0f;
                    --rv-bg:      #000000;
                    --rv-border:  #262626;
                    --rv-text:    #f5f5f5;
                    --rv-muted:   #a3a3a3;
                    --rv-green-soft: rgba(5,150,105,0.14);
                    --rv-shadow:  0 1px 2px rgba(0,0,0,0.3), 0 2px 10px rgba(0,0,0,0.25);
                    --rv-shadow-md: 0 2px 4px rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.35);
                }

                *, *::before, *::after { box-sizing: border-box; }

                html {
                    -webkit-tap-highlight-color: transparent;
                    -webkit-text-size-adjust: 100%;
                }

                body {
                    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
                    background: var(--rv-bg);
                    color: var(--rv-text);
                    font-feature-settings: 'cv11', 'ss01';
                }

                ::selection { background: rgba(5,150,105,0.22); color: inherit; }
                input, textarea, select { caret-color: var(--rv-green-500); }

                /* Numbers line up in tables, money and stat values */
                table, .rv-stat-value, .rv-money-val, [class*="text-2xl"], [class*="text-3xl"] {
                    font-variant-numeric: tabular-nums;
                }

                h1, h2, h3 { text-wrap: balance; }
                p { text-wrap: pretty; }

                /* Keyboard focus is always visible */
                :focus-visible {
                    outline: 2px solid var(--rv-green-500) !important;
                    outline-offset: 2px !important;
                }
                .input-field:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
                    outline: none !important;
                }

                /* Pressable things answer the press */
                button, a, [role="button"], .sidebar-item { touch-action: manipulation; }
                button:not(:disabled), .rv-btn { transition: transform 140ms var(--rv-ease-out), background-color 160ms ease, box-shadow 160ms ease, color 160ms ease, border-color 160ms ease; }
                button:not(:disabled):active, .rv-btn:active { transform: scale(0.97); }
                button:disabled { cursor: not-allowed; opacity: 0.55; }

                /* Hover lifts only where a real pointer exists */
                @media (hover: none) {
                    .card-hover:hover, [class*="hover:scale-"]:hover, [class*="hover:-translate-y"]:hover { transform: none !important; }
                }

                /* ── Sidebar ── */
                #admin-sidebar {
                    background: var(--rv-navy) !important;
                    border-right: none !important;
                    width: var(--rv-sidebar-w) !important;
                    display: flex;
                    flex-direction: column;
                    box-shadow: none !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                #admin-sidebar { border-radius: 0 !important; }
                #admin-sidebar > * { flex-shrink: 0; }
                #admin-sidebar #sidebar-nav { flex: 1 0 auto; display: flex; flex-direction: column; }
                #admin-sidebar [class*="border-"] { border-color: rgba(255,255,255,0.08) !important; }
                #admin-sidebar #sidebar-name { color: #ffffff !important; }
                #admin-sidebar #sidebar-role { color: #6ee7b7 !important; }
                #admin-sidebar #user-avatar {
                    background: rgba(255,255,255,0.10) !important;
                    border-radius: 10px !important;
                    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
                }
                #admin-sidebar .border-t { border-color: rgba(255,255,255,0.08) !important; }
                #admin-sidebar .bg-slate-50 { background: rgba(255,255,255,0.05) !important; }

                .rv-sidebar-logo {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 20px 20px 14px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                    margin-bottom: 8px;
                }
                .rv-sidebar-logo img {
                    width: 38px;
                    height: 38px;
                    object-fit: contain;
                    border-radius: 50%;
                    background: #fff;
                    padding: 2px;
                }
                .rv-sidebar-logo-fallback {
                    width: 38px;
                    height: 38px;
                    background: var(--rv-green-500);
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 800;
                    font-size: 16px;
                }
                .rv-sidebar-school { font-weight: 700; font-size: 14px; color: white; line-height: 1.25; }
                .rv-sidebar-tagline { font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 0.08em; text-transform: uppercase; }

                .sidebar-item {
                    font-family: inherit !important;
                    font-size: 13.5px !important;
                    font-weight: 500 !important;
                    line-height: 1.3 !important;
                    color: rgba(255,255,255,0.68) !important;
                    padding: 10px 14px !important;
                    min-height: 42px;
                    border-radius: 10px !important;
                    margin: 1px 10px !important;
                    width: calc(100% - 20px) !important;
                    border-left: none !important;
                    transition: background-color 160ms ease, color 160ms ease !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    text-align: left !important;
                    gap: 12px !important;
                    background: transparent !important;
                }
                .sidebar-item::before { display: none !important; }
                .sidebar-item:hover {
                    background: rgba(255,255,255,0.07) !important;
                    color: white !important;
                }
                .sidebar-item.active {
                    background: rgba(255,255,255,0.11) !important;
                    color: white !important;
                    font-weight: 700 !important;
                    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06) !important;
                }
                .sidebar-item i { width: 18px; flex: none; text-align: center; font-size: 14px; opacity: 0.8; }
                .sidebar-item.active i { opacity: 1; color: #6ee7b7; }

                .rv-user-card {
                    margin: 8px 10px;
                    padding: 12px 14px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.08);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .rv-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 10px;
                    background: var(--rv-green-500);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 800;
                    font-size: 15px;
                    flex-shrink: 0;
                }

                .rv-nav-section {
                    font-size: 10.5px;
                    font-weight: 700;
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                    color: rgba(255,255,255,0.38);
                    padding: 16px 24px 6px;
                }

                .rv-logout {
                    margin: 8px 10px;
                    padding: 10px 14px;
                    border-radius: 10px;
                    background: rgba(220,38,38,0.12);
                    color: #fca5a5 !important;
                    font-size: 13.5px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: calc(100% - 20px);
                    border: none;
                    cursor: pointer;
                    text-align: left;
                }
                .rv-logout:hover { background: rgba(220,38,38,0.22) !important; }
                /* When pinned to the bottom of the scrolling menu it must be opaque */
                #admin-sidebar .rv-logout {
                    background: linear-gradient(rgba(220,38,38,0.14), rgba(220,38,38,0.14)), var(--rv-navy) !important;
                    box-shadow: 0 -12px 16px -4px var(--rv-navy);
                    z-index: 2;
                }
                #admin-sidebar .rv-logout:hover {
                    background: linear-gradient(rgba(220,38,38,0.24), rgba(220,38,38,0.24)), var(--rv-navy) !important;
                }

                /* ── Top nav bar ── */
                #main-nav {
                    position: fixed !important;
                    top: 0; left: 0; right: 0;
                    height: var(--rv-nav-h) !important;
                    background: var(--rv-surface) !important;
                    border-bottom: 1px solid var(--rv-border) !important;
                    box-shadow: none !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    border-radius: 0 !important;
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    padding-left: max(16px, env(safe-area-inset-left));
                    padding-right: max(16px, env(safe-area-inset-right));
                }
                #main-nav > div:first-child {
                    max-width: none !important;
                    width: 100%;
                    margin: 0 !important;
                    padding: 0 !important;
                    gap: 12px;
                }
                #main-nav h1 {
                    white-space: nowrap;
                    background: none !important;
                    -webkit-text-fill-color: currentColor !important;
                    color: var(--rv-navy) !important;
                    letter-spacing: -0.01em;
                }
                .dark #main-nav h1 { color: #fff !important; }

                #dashboard { padding-top: var(--rv-nav-h) !important; background: var(--rv-bg) !important; }

                .rv-period-pill {
                    background: var(--rv-green-soft);
                    color: var(--rv-green);
                    border: 1px solid rgba(5,150,105,0.22);
                    border-radius: 999px;
                    padding: 4px 12px;
                    font-size: 12px;
                    font-weight: 600;
                }

                /* ── Cards / panels ── */
                .glass-panel, .rv-card {
                    background: var(--rv-surface) !important;
                    border: 1px solid var(--rv-border) !important;
                    box-shadow: var(--rv-shadow) !important;
                    border-radius: var(--rv-radius) !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    transition: box-shadow 200ms ease, transform 200ms var(--rv-ease-out);
                }
                @media (hover: hover) and (pointer: fine) {
                    .card-hover:hover {
                        box-shadow: var(--rv-shadow-md) !important;
                        transform: translateY(-2px);
                    }
                }

                /* ── Stat cards ── */
                .rv-stat { display: flex; flex-direction: column; gap: 4px; }
                .rv-stat-icon {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    margin-bottom: 12px;
                }
                .rv-stat-value {
                    font-family: inherit;
                    font-size: 30px;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                    color: var(--rv-text);
                    line-height: 1.05;
                }
                .rv-stat-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--rv-muted);
                    letter-spacing: 0.02em;
                }

                /* ── Inputs ── */
                .input-field {
                    font-family: inherit !important;
                    font-size: 14px !important;
                    border: 1.5px solid var(--rv-border) !important;
                    border-radius: var(--rv-radius-sm) !important;
                    padding: 10px 14px !important;
                    background: var(--rv-surface) !important;
                    color: var(--rv-text) !important;
                    transition: border-color 150ms ease, box-shadow 150ms ease !important;
                    outline: none !important;
                }
                .input-field:focus {
                    border-color: var(--rv-green-500) !important;
                    box-shadow: var(--rv-focus) !important;
                }
                .input-field::placeholder { color: #8a94a6; }

                /* ── Buttons ── */
                button[onclick], .rv-btn {
                    font-family: inherit !important;
                    font-weight: 600 !important;
                    letter-spacing: 0.01em;
                }

                /* ── Tables ── */
                table { border-collapse: collapse; }
                thead th {
                    font-size: 11px !important;
                    letter-spacing: 0.06em !important;
                    text-transform: uppercase !important;
                    font-weight: 700 !important;
                    color: var(--rv-muted) !important;
                    background: var(--rv-bg) !important;
                }
                tbody tr { transition: background-color 120ms ease; }

                /* ── Page headings ── */
                h2.rv-page-title, h2[class*="text-2xl font-bold"] {
                    font-family: inherit !important;
                    font-weight: 800 !important;
                    letter-spacing: -0.02em;
                    color: var(--rv-navy) !important;
                    font-size: 24px !important;
                }
                .dark h2.rv-page-title, .dark h2[class*="text-2xl font-bold"] { color: white !important; }
                .dark [style*="color:var(--rv-navy"], .dark [style*="color: var(--rv-navy"] { color: #ffffff !important; }
                .dark [style*="color:var(--rv-text"] { color: var(--rv-text) !important; }

                /* Light tint panels that were written without a dark variant */
                .dark .bg-amber-50:not([class*="dark:bg-"])   { background-color: rgba(217,119,6,0.12) !important; }
                .dark .bg-yellow-50:not([class*="dark:bg-"])  { background-color: rgba(202,138,4,0.12) !important; }
                .dark .bg-emerald-50:not([class*="dark:bg-"]),
                .dark .bg-green-50:not([class*="dark:bg-"]),
                .dark .bg-ridge-50:not([class*="dark:bg-"])   { background-color: rgba(5,150,105,0.12) !important; }
                .dark .bg-red-50:not([class*="dark:bg-"])     { background-color: rgba(220,38,38,0.12) !important; }
                .dark .bg-blue-50:not([class*="dark:bg-"])    { background-color: rgba(37,99,235,0.12) !important; }
                .dark .bg-slate-50:not([class*="dark:bg-"])   { background-color: rgba(148,163,184,0.08) !important; }
                .dark .bg-white:not([class*="dark:bg-"])      { background-color: var(--rv-surface) !important; }
                .dark .border-amber-200:not([class*="dark:border-"]) { border-color: rgba(217,119,6,0.35) !important; }
                .dark .text-amber-800:not([class*="dark:text-"]), .dark .text-amber-900:not([class*="dark:text-"]) { color: #fcd34d !important; }
                .dark .text-amber-700:not([class*="dark:text-"]) { color: #fbbf24 !important; }

                .dark [style*="background:#fffbeb"], .dark [style*="background:#fef9c3"] { background: rgba(217,119,6,0.12) !important; border-color: rgba(217,119,6,0.35) !important; }
                .dark [style*="background:#fef2f2"] { background: rgba(220,38,38,0.12) !important; border-color: rgba(220,38,38,0.35) !important; }
                .dark [style*="background:#f0fdf4"] { background: rgba(5,150,105,0.12) !important; border-color: rgba(5,150,105,0.35) !important; }
                .dark [style*="background:#f3e8ff"] { background: rgba(124,58,237,0.14) !important; }
                .dark [style*="color:#92400e"], .dark [style*="color:#b45309"] { color: #fcd34d !important; }
                .dark [style*="color:#991b1b"] { color: #fca5a5 !important; }

                /* The top bar already carries the school name on wide screens */
                @media (min-width: 1024px) { #admin-sidebar .rv-sidebar-logo { display: none; } }

                /* ── Badges ── */
                .rv-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 10px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.02em;
                }

                /* ── Messages ── */
                .rv-msg-card { transition: background-color 150ms ease; }

                /* ── Toasts sit below the nav and read as one family ── */
                .toastify.rv-toast {
                    margin-top: calc(var(--rv-nav-h) - 4px);
                    background: #111111 !important;
                    color: #fafafa !important;
                    font-family: inherit;
                    font-size: 13.5px;
                    font-weight: 500;
                    padding: 12px 16px 12px 36px;
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(15,23,42,0.25);
                    max-width: min(380px, calc(100vw - 32px));
                    position: fixed;
                }
                .toastify.rv-toast::before {
                    content: '';
                    position: absolute;
                    left: 16px;
                    top: 50%;
                    width: 8px;
                    height: 8px;
                    margin-top: -4px;
                    border-radius: 50%;
                    background: var(--rv-toast-dot, #3b82f6);
                }
                .rv-toast-success { --rv-toast-dot: #34d399; }
                .rv-toast-error   { --rv-toast-dot: #f87171; }
                .rv-toast-warning { --rv-toast-dot: #fbbf24; }
                .rv-toast-info    { --rv-toast-dot: #60a5fa; }

                #loading-overlay { backdrop-filter: blur(4px) !important; }

                /* Content area: the wrapper already pads, so no double gutter */
                #view-content { padding: 0 !important; max-width: 1240px; margin: 0 auto; }

                /* Views arrive with a short settle, not a slide */
                @keyframes rv-fade {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: none; }
                }
                #view-content > * { animation: rv-fade 220ms var(--rv-ease-out) both; }

                /* Themed scrollbars */
                * { scrollbar-color: #c3cad6 transparent; }
                .dark * { scrollbar-color: #333333 transparent; }
                .dark #admin-sidebar { border-right: 1px solid #1f1f1f !important; }
                .dark #admin-sidebar .sidebar-item.active { background: #1a1a1a !important; box-shadow: none !important; }
                .dark #admin-sidebar .sidebar-item:hover { background: #141414 !important; }
                .dark #admin-sidebar #user-avatar, .dark .rv-user-card { background: #1a1a1a !important; }
                .dark #main-nav { background: #000000 !important; border-bottom-color: #1f1f1f !important; }
                #admin-sidebar { scrollbar-color: rgba(255,255,255,0.18) transparent; }

                /* ── Light mode: white sidebar (dark mode keeps the black one) ── */
                html:not(.dark) #admin-sidebar {
                    background: #ffffff !important;
                    border-right: 1px solid #e6eaf0 !important;
                    scrollbar-color: #c3cad6 transparent;
                }
                html:not(.dark) #admin-sidebar [class*="border-"],
                html:not(.dark) #admin-sidebar .border-t,
                html:not(.dark) .rv-sidebar-logo { border-color: #eef1f5 !important; }
                html:not(.dark) #admin-sidebar #sidebar-name,
                html:not(.dark) .rv-sidebar-school { color: #0f2044 !important; }
                html:not(.dark) #admin-sidebar #sidebar-role { color: #047857 !important; }
                html:not(.dark) .rv-sidebar-tagline { color: #64748b; }
                html:not(.dark) .rv-sidebar-logo img { box-shadow: 0 0 0 1px #e6eaf0; }
                html:not(.dark) #admin-sidebar #user-avatar {
                    background: #047857 !important;
                    color: #ffffff !important;
                    box-shadow: none;
                }
                html:not(.dark) #admin-sidebar .bg-slate-50,
                html:not(.dark) #admin-sidebar .rv-user-card { background: #f6f8fb !important; border-color: #e6eaf0 !important; }
                html:not(.dark) #admin-sidebar .sidebar-item { color: #475569 !important; }
                html:not(.dark) #admin-sidebar .sidebar-item:hover { background: #f1f4f8 !important; color: #0f2044 !important; }
                html:not(.dark) #admin-sidebar .sidebar-item.active {
                    background: #ecfdf5 !important;
                    color: #065f46 !important;
                    box-shadow: inset 0 0 0 1px #d1fae5 !important;
                }
                html:not(.dark) #admin-sidebar .sidebar-item.active i { color: #059669; }
                html:not(.dark) #admin-sidebar .rv-nav-section { color: #94a3b8; }
                html:not(.dark) #admin-sidebar .rv-logout {
                    color: #b91c1c !important;
                    background: linear-gradient(rgba(220,38,38,0.07), rgba(220,38,38,0.07)), #ffffff !important;
                    box-shadow: 0 -12px 16px -4px #ffffff;
                }
                html:not(.dark) #admin-sidebar .rv-logout:hover {
                    background: linear-gradient(rgba(220,38,38,0.13), rgba(220,38,38,0.13)), #ffffff !important;
                }

                /* ── Desktop: the sidebar stays open beside the content ── */
                @media (min-width: 1024px) {
                    body:has(#dashboard:not(.hidden)) #admin-sidebar {
                        transform: none !important;
                        top: var(--rv-nav-h) !important;
                        height: calc(100dvh - var(--rv-nav-h)) !important;
                        z-index: 85 !important;
                    }
                    body:has(#dashboard:not(.hidden)) #dashboard { padding-left: var(--rv-sidebar-w) !important; }
                    body:has(#dashboard:not(.hidden)) #drawer-btn,
                    body:has(#dashboard:not(.hidden)) #sidebar-overlay { display: none !important; }
                }

                /* ── Mobile ── */
                @media (max-width: 768px) {
                    #admin-sidebar {
                        position: fixed !important;
                        left: 0 !important;
                        top: 0 !important;
                        bottom: 0 !important;
                        padding-top: var(--rv-nav-h) !important;
                        transform: translateX(-100%) !important;
                        transition: transform 320ms var(--rv-ease-drawer) !important;
                        width: min(300px, 86vw) !important;
                    }
                    #admin-sidebar.mobile-open { transform: translateX(0) !important; }

                    #drawer-btn { display: flex !important; }
                    #main-content { margin-left: 0 !important; width: 100% !important; }
                    #main-nav { gap: 8px !important; }

                    /* 16px stops iOS zooming into the field */
                    input, select, textarea, .input-field { font-size: 16px !important; }

                    .overflow-x-auto, table {
                        display: block;
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                    }

                    .grid-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                    .grid-cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                    .grid-cols-2 { grid-template-columns: repeat(1, minmax(0, 1fr)) !important; }
                    #view-content [style*="minmax(180px"] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 12px !important; }

                    .bulk-map-grid { grid-template-columns: 1fr !important; }
                    .rv-stat-value { font-size: 24px !important; }
                    .modal-btn-row { flex-direction: column !important; }
                    .rv-card, .glass-panel { padding: 16px !important; }
                    .rv-period-pill { display: none !important; }
                }

                @media (max-width: 420px) {
                    #main-nav h1 { display: none; }
                }

                @media (min-width: 1024px) {
                    #view-content [style*="minmax(180px"] { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important; }
                }

                @media (max-width: 480px) {
                    .grid-cols-4, .grid-cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                    .rv-stat-value { font-size: 22px !important; }
                    .sidebar-item { font-size: 15px !important; min-height: 46px; }
                }

                /* Reduced motion: keep fades that explain change, drop movement */
                @media (prefers-reduced-motion: reduce) {
                    #view-content > * { animation: rv-fade-only 160ms ease both; }
                    @keyframes rv-fade-only { from { opacity: 0; } to { opacity: 1; } }
                    .card-hover:hover, button:not(:disabled):active { transform: none !important; }
                    #admin-sidebar { transition: none !important; }
                    .animate-bounce, .animate-pulse, .logo-container { animation: none !important; }
                }
            `;
            document.head.appendChild(style);
        }

        // ── Update sidebar content ────────────────────────────────────────────
        const nav     = document.getElementById('sidebar-nav');
        const roleEl  = document.getElementById('sidebar-role');
        const nameEl  = document.getElementById('sidebar-name');
        const avatar  = document.getElementById('user-avatar');

        if (state.currentUser) {
            if (nameEl) nameEl.textContent = state.currentUser.full_name || 'User';
            if (avatar) avatar.textContent = (state.currentUser.full_name || 'U').charAt(0).toUpperCase();
        }

        // Nav item groups per role
        const adminItems = [
            { section: 'Main' },
            { id: 'overview',            label: 'Dashboard',          icon: 'fa-chart-line' },
            { id: 'academic',            label: 'Academic Setup',     icon: 'fa-calendar-alt' },
            { section: 'People' },
            { id: 'classes',             label: 'Classes',            icon: 'fa-school' },
            { id: 'students',            label: 'Students',           icon: 'fa-user-graduate' },
            { id: 'teachers',            label: 'Faculty',            icon: 'fa-chalkboard-teacher' },
            { id: 'parents',             label: 'Parents',            icon: 'fa-users' },
            { section: 'Operations' },
            { id: 'received_reports',    label: 'Class Reports',      icon: 'fa-folder-open' },
            { id: 'admin_upload_reports',label: 'Upload Reports',     icon: 'fa-cloud-upload-alt' },
            { section: 'Admin' },
            { id: 'approvals',           label: 'Approvals',          icon: 'fa-user-clock' },
            { id: 'announcements',       label: 'Announcements',      icon: 'fa-bullhorn' },
            { id: 'data_analysis',       label: 'Data Analysis',      icon: 'fa-chart-bar' },
        ];

        const teacherItems = [
            { section: 'Menu' },
            { id: 'teacher_dashboard',        label: 'My Dashboard',     icon: 'fa-home' },
            { id: 'teacher_students',         label: 'My Students',      icon: 'fa-users' },
            { id: 'teacher_create_report',    label: 'Create Report',    icon: 'fa-pen' },
            { id: 'announcements',            label: 'Announcements',    icon: 'fa-bullhorn' },
        ];

        const parentItems = [
            { section: 'Menu' },
            { id: 'parent_dashboard', label: 'Dashboard',   icon: 'fa-home' },
            { id: 'parent_children',  label: 'My Children', icon: 'fa-child' },
            { id: 'parent_finance',   label: 'Payments',    icon: 'fa-credit-card' },
            { id: 'parent_reports',   label: 'Reports',     icon: 'fa-file-alt' },
            { id: 'announcements',    label: 'Announcements',icon: 'fa-bullhorn' },
        ];

        const accountantItems = [
            { section: 'Finance' },
            { id: 'accountant_dashboard', label: 'Dashboard',        icon: 'fa-chart-line' },
            { id: 'finance',              label: 'Fees & Payments',  icon: 'fa-wallet' },
            { id: 'billing',              label: 'Billing',          icon: 'fa-file-invoice-dollar' },
            { id: 'screenshots',          label: 'Payment Proofs',   icon: 'fa-image' },
            { id: 'financial_report',     label: 'Financial Report', icon: 'fa-chart-pie' },
            { section: 'General' },
            { id: 'accountant_approvals', label: 'Approvals',        icon: 'fa-user-clock' },
            { id: 'announcements',        label: 'Announcements',    icon: 'fa-bullhorn' },
        ];

        const roleMap = { admin: adminItems, teacher: teacherItems, parent: parentItems, accountant: accountantItems };
        const roleLabel = { admin: 'Administrator', teacher: 'Teacher', parent: 'Parent', accountant: 'Accountant' };
        if (roleEl) roleEl.textContent = roleLabel[state.role] || '';

        const items = roleMap[state.role] || [];

        if (nav) {
            nav.innerHTML = items.map(item => {
                if (item.section) {
                    return `<div class="rv-nav-section">${item.section}</div>`;
                }
                const isActive = state.currentView === item.id;
                return `
                    <button onclick="ui.route('${item.id}'); if(window.innerWidth<=768){ui.closeSidebar();}"
                            class="sidebar-item ${isActive ? 'active' : ''}"
                            style="touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,255,255,0.1);">
                        <i class="fas ${item.icon}"></i>
                        <span>${item.label}</span>
                    </button>
                `;
            }).join('') + `
                <div style="flex:1"></div>
                <button onclick="auth.logout()" class="rv-logout">
                    <i class="fas fa-sign-out-alt"></i> Sign Out
                </button>
            `;
        }

        // Inject logo into sidebar header area if not already done
        const sidebar = document.getElementById('admin-sidebar');
        if (sidebar && !sidebar.querySelector('.rv-sidebar-logo')) {
            const logoHtml = `
                <div class="rv-sidebar-logo">
                    <img src="1.png" alt="Logo" style="width:36px;height:36px;object-fit:contain;border-radius:8px;"
                         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                    <div class="rv-sidebar-logo-fallback" style="display:none;">R</div>
                    <div>
                        <div class="rv-sidebar-school">Ridgevalley</div>
                        <div class="rv-sidebar-tagline">Building Future Today</div>
                    </div>
                </div>
            `;
            sidebar.insertAdjacentHTML('afterbegin', logoHtml);
        }
    },

    updatePeriodDisplay() {
        const display = document.getElementById('active-period-display');
        const weekBadge = document.getElementById('week-badge');
        const weekDisplay = document.getElementById('active-week-display');

        if (display) {
            if (state.currentAY && state.currentTerm) {
                display.textContent = `${state.currentAY.year} • ${state.currentTerm.name}`;
            } else {
                display.textContent = 'No Active Period';
            }
        }

        // Update the separate week pill in the nav
        if (weekBadge && weekDisplay && state.currentAY && state.currentTerm) {
            let activeWeek = null;
            if (typeof featureState !== 'undefined' && featureState.weeks) {
                activeWeek = featureState.weeks.find(w =>
                    w.status === 'active' &&
                    w.academic_year_id === state.currentAY.id &&
                    w.term_id === state.currentTerm.id
                );
            }
            if (activeWeek) {
                weekDisplay.textContent = activeWeek.week_name;
                weekBadge.style.display = 'flex';
            } else {
                weekBadge.style.display = 'none';
            }
        } else if (weekBadge) {
            weekBadge.style.display = 'none';
        }
    },

    // Home screen for the signed-in role.
    homeView() {
        return {
            admin: 'overview',
            teacher: 'teacher_dashboard',
            parent: 'parent_dashboard',
            accountant: 'accountant_dashboard'
        }[state.role] || 'overview';
    },

    // Finance screens belong to the accountant; the admin's menu no longer has
    // them. Keeps each role on its own screens even if a stale link or button
    // asks for another one.
    allowedView(view) {
        const FINANCE = ['finance', 'billing', 'screenshots', 'financial_report', 'financial_analytics', 'accountant_dashboard', 'accountant_approvals'];
        if (state.role === 'accountant') {
            if (view === 'financial_analytics') return 'financial_report';
            return FINANCE.includes(view) || view === 'announcements' ? view : 'accountant_dashboard';
        }
        if (state.role === 'admin' && FINANCE.includes(view)) return 'overview';
        return view;
    },

    route(view) {
        // Reset class filter when leaving the upload reports view
        if (state.currentView === 'admin_upload_reports' && view !== 'admin_upload_reports') {
            state.selectedUploadClass = '';
        }
        state.currentView = view;
        const container = document.getElementById('view-content');
        if (container) {
            container.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:200px;">
                    <div style="width:36px;height:36px;border:3px solid var(--rv-blue,#1a56db);border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div>
                </div>
                <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            `;
            window.scrollTo(0, 0);
        }

        // Update active sidebar item
        document.querySelectorAll('.sidebar-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('onclick')?.includes(`'${view}'`)) {
                btn.classList.add('active');
            }
        });

        setTimeout(async () => {
            try {
                switch(view) {
                    case 'overview':               views.renderOverview(); break;
                    case 'accountant_dashboard':   views.renderAccountantDashboard(); break;
                    case 'financial_report':       views.renderFinancialReport(); break;
                    case 'accountant_approvals':   await dataManager.loadPendingAdmins(); views.renderAccountantApprovals(); break;
                    case 'academic':               views.renderAcademic(); break;
                    case 'classes':                views.renderClasses(); break;
                    case 'students':               views.renderStudents(); break;
                    case 'teachers':               views.renderTeachers(); break;
                    case 'parents':                views.renderParents(); break;
                    case 'finance':                views.renderFinance(); break;
                    case 'attendance':             /* attendance removed */ break;
                    case 'received_reports':       views.renderClassReports(); break;
                    case 'admin_upload_reports':   views.renderAdminUploadReports(); break;
                    case 'screenshots':            views.renderScreenshots(); break;
                    case 'approvals':              views.renderApprovals(); break;
                    case 'announcements':          views.renderAnnouncements(); break;
                    case 'data_analysis':          views.renderDataAnalysis(); break;
                    case 'teacher_dashboard':      await views.renderTeacherDashboard(); break;
                    case 'teacher_students':       await views.renderTeacherStudents(); break;
                    case 'teacher_attendance':     /* attendance removed */ break;
                    case 'teacher_total_attendance': /* attendance removed */ break;
                    case 'teacher_create_report':  views.renderTeacherCreateReport(); break;
                    case 'parent_dashboard':       views.renderParentDashboard(); break;
                    case 'parent_children':        views.renderParentChildren(); break;
                    case 'parent_finance':         views.renderParentFinance(); break;
                    case 'parent_reports':         views.renderParentReports(); break;
                    default: ui.route(ui.homeView()); return;
                }
            } catch (err) {
                console.error(`Route render error [${view}]:`, err);
                const container = document.getElementById('view-content');
                if (container) {
                    container.innerHTML = `
                        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:16px;text-align:center;padding:24px;">
                            <div style="width:56px;height:56px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:22px;"></i>
                            </div>
                            <div>
                                <p style="font-weight:700;font-size:16px;color:var(--rv-navy,#0f2044);margin:0 0 6px;">Something went wrong</p>
                                <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">${escapeHtml(err.message || 'An unexpected error occurred loading this section.')}</p>
                            </div>
                            <button onclick="ui.route('${view}')" style="padding:10px 24px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">
                                <i class="fas fa-redo" style="margin-right:6px;"></i>Retry
                            </button>
                        </div>
                    `;
                }
            }
        }, 80);
    },

    showToast(message, type = 'success') {
        const msg = typeof message === 'string' ? message : extractErrorMessage(message);
        
        if (typeof Toastify !== 'undefined') {
            const colors = {
                success: '#10b981',
                error: '#ef4444',
                warning: '#f59e0b',
                info: '#3b82f6'
            };
            
            Toastify({
                text: msg,
                duration: 3000,
                gravity: "top",
                position: "right",
                backgroundColor: colors[type] || colors.info,
                className: `rv-toast rv-toast-${colors[type] ? type : 'info'}`,
                stopOnFocus: true
            }).showToast();
        } else {
            modal.alert(type.toUpperCase(), escapeHtml(msg), type);
        }
    }
};

// ==================== VIEWS ====================
const views = {
    // The accountant's home screen: the finance half of the old admin overview.
    renderAccountantDashboard() {
        this.renderOverview('accountant');
    },

    // Admin dashboard (people and classes). Finance figures appear only on the
    // accountant's dashboard, which renders through this function too.
    renderOverview(mode = 'admin') {
        const isFinance = mode === 'accountant';
        const totalStudents  = state.students.length;
        const totalTeachers  = state.teachers.length;
        const totalClasses   = state.classes.length;
        const totalParents   = state.parents.length;
        const pendingPayments = state.transactions.filter(t => t.status === 'pending').length;
        const totalRevenue   = state.transactions
            .filter(t => t.status === 'confirmed')
            .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
        const allArrears     = dataManager.getAllArrears();
        const totalArrears   = allArrears.reduce((sum, a) => sum + a.amount, 0);
        const pendingReports = 0; // teachers no longer submit report bundles

        const stats = isFinance ? [
            { label: 'Revenue (₵)',    value: totalRevenue.toLocaleString(), icon: 'fa-wallet',      img: 'revenue', color: '#059669', bg: 'rgba(5,150,105,0.1)',   action: "views.showDetailModal('revenue')" },
            { label: 'Arrears (₵)',    value: totalArrears.toLocaleString(), icon: 'fa-exclamation-triangle', img: 'arrears', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', action: "views.showDetailModal('arrears')" },
            { label: 'Pending Payments', value: pendingPayments,      icon: 'fa-clock',              img: 'outbox', color: '#d97706', bg: 'rgba(217,119,6,0.1)',   action: "ui.route('screenshots')" },
            { label: 'Students',       value: totalStudents,          icon: 'fa-user-graduate',      img: 'students', color: '#1a56db', bg: 'rgba(26,86,219,0.1)',  action: '' },
        ] : [
            { label: 'Students',       value: totalStudents,          icon: 'fa-user-graduate',      img: 'students', color: '#1a56db', bg: 'rgba(26,86,219,0.1)',  action: "views.showDetailModal('students')" },
            { label: 'Teaching Staff', value: totalTeachers,          icon: 'fa-chalkboard-teacher', img: 'teachers', color: '#059669', bg: 'rgba(5,150,105,0.1)',   action: "views.showDetailModal('teachers')" },
            { label: 'Classes',        value: totalClasses,           icon: 'fa-school',             img: 'classes', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)',  action: "views.showDetailModal('classes')" },
            { label: 'Parents',        value: totalParents,           icon: 'fa-users',              img: 'parents', color: '#0891b2', bg: 'rgba(8,145,178,0.1)',   action: '' },
        ];

        const html = `
            <!-- Page header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                <div>
                    <h2 style="font-family:inherit;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0;">${isFinance ? 'Finance Overview' : 'Dashboard Overview'}</h2>
                    <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:2px 0 0;">${state.currentAY?.year || ''} ${escapeHtml(state.currentTerm ? '· ' + state.currentTerm.name : '')}</p>
                </div>
                <button onclick="actions.refreshData()" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:var(--rv-surface);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>
            </div>

            <!-- Stat cards -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
                ${stats.map(s => {
                    const _isMoney = s.label.includes('₵');
                    const _hidden  = _isMoney && window._rvMoneyHidden;
                    const _dv      = _hidden ? '•••' : s.value;
                    const _vc      = s.label.includes('Arrears') ? '#dc2626' : 'var(--rv-text)';
                    const _eye     = _isMoney
                        ? `<button class="rv-eye-toggle" onclick="event.stopPropagation();views.toggleMoneyVisibility()" style="position:absolute;top:10px;right:10px;background:none;border:none;cursor:pointer;color:var(--rv-muted);padding:4px;border-radius:6px;line-height:1;" title="${window._rvMoneyHidden ? 'Show amounts' : 'Hide amounts'}"><i class="fas ${window._rvMoneyHidden ? 'fa-eye-slash' : 'fa-eye'}" style="font-size:13px;"></i></button>`
                        : '';
                    const _valHtml = _isMoney
                        ? `<span class="rv-money-val" data-raw="${s.value}">${_dv}</span>`
                        : s.value;
                    return `
                    <div onclick="${s.action}" style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow,0 2px 16px rgba(15,32,68,0.08));cursor:${s.action ? 'pointer' : 'default'};transition:all 0.18s;position:relative;" onmouseover="if('${s.action}')this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(15,32,68,0.12)'" onmouseout="this.style.transform='';this.style.boxShadow='var(--rv-shadow)'">
                        ${_eye}
                        <img src="assets/3d/${s.img}.png" alt="" width="52" height="52" loading="lazy" decoding="async" style="width:52px;height:52px;object-fit:contain;margin:-4px 0 12px -4px;display:block;">
                        <div style="font-family:inherit;font-size:28px;font-weight:700;color:${_vc};line-height:1;">${_valHtml}</div>
                        <div style="font-size:11px;font-weight:700;color:var(--rv-muted);text-transform:uppercase;letter-spacing:0.8px;margin-top:4px;">${s.label}</div>
                    </div>
                `;}).join('')}
            </div>

            <!-- Alert row -->
            ${isFinance && (pendingPayments > 0 || pendingReports > 0) ? `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
                ${pendingPayments > 0 ? `
                <div style="flex:1;min-width:200px;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-clock" style="color:#d97706;font-size:18px;"></i>
                        <div>
                            <p style="font-weight:700;font-size:13px;color:#92400e;margin:0;">${pendingPayments} Pending Payment${pendingPayments > 1 ? 's' : ''}</p>
                            <p style="font-size:11px;color:#b45309;margin:0;">Awaiting your approval</p>
                        </div>
                    </div>
                    <button onclick="ui.route('finance')" style="padding:6px 14px;background:#d97706;color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Review</button>
                </div>` : ''}
                ${pendingReports > 0 ? `
                <div style="flex:1;min-width:200px;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-file-import" style="color:#1a56db;font-size:18px;"></i>
                        <div>
                            <p style="font-weight:700;font-size:13px;color:#1e3a8a;margin:0;">${pendingReports} Report Bundle${pendingReports > 1 ? 's' : ''}</p>
                            <p style="font-size:11px;color:#1d4ed8;margin:0;">Pending review</p>
                        </div>
                    </div>
                    <button onclick="ui.route('received_reports')" style="padding:6px 14px;background:#1a56db;color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Review</button>
                </div>` : ''}
            </div>` : ''}

            <!-- Bottom panels -->
            <div class="rv-overview-panels" style="display:grid;grid-template-columns:${isFinance ? '1fr 1fr' : '1fr'};gap:16px;">

                ${isFinance ? `<!-- Arrears table -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                        <h3 style="font-size:14px;font-weight:700;color:var(--rv-text);margin:0;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-exclamation-circle" style="color:#dc2626;"></i> Students with Arrears
                        </h3>
                        ${allArrears.length > 5 ? `<button onclick="ui.route('finance')" style="font-size:11px;font-weight:700;color:#1a56db;background:none;border:none;cursor:pointer;">View all →</button>` : ''}
                    </div>
                    ${allArrears.length === 0
                        ? `<p style="text-align:center;color:var(--rv-muted);padding:24px 0;font-size:13px;">No outstanding arrears</p>`
                        : `<div style="overflow-x:auto;">
                            <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                                <thead>
                                    <tr style="background:var(--rv-bg);">
                                        <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Student</th>
                                        <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Class</th>
                                        <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Due</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${allArrears.slice(0, 5).map(a => `
                                        <tr style="border-top:1px solid var(--rv-border);">
                                            <td style="padding:10px 12px;font-weight:600;color:var(--rv-text);">${escapeHtml(a.studentName)}</td>
                                            <td style="padding:10px 12px;color:var(--rv-muted);">${a.studentClass}</td>
                                            <td style="padding:10px 12px;text-align:right;font-weight:700;color:#dc2626;">₵<span class="rv-money-val" data-raw="${a.amount.toFixed(2)}">${window._rvMoneyHidden ? '•••' : a.amount.toFixed(2)}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>`
                    }
                </div>` : ''}

                <!-- Recent notifications -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow);">
                    <h3 style="font-size:14px;font-weight:700;color:var(--rv-text);margin:0 0 14px;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-bell" style="color:#1a56db;"></i> Recent Notifications
                    </h3>
                    <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">
                        ${state.notifications.length > 0
                            ? state.notifications.slice(0, 6).map(n => `
                                <div style="padding:10px 14px;border-radius:10px;background:var(--rv-bg);border-left:3px solid ${n.read ? 'var(--rv-border)' : '#1a56db'};">
                                    <p style="font-weight:700;font-size:12.5px;color:var(--rv-text);margin:0;">${escapeHtml(n.title)}</p>
                                    <p style="font-size:11.5px;color:var(--rv-muted);margin:2px 0 0;">${escapeHtml(n.message?.substring(0, 80))}${escapeHtml(n.message?.length > 80 ? '...' : '')}</p>
                                </div>
                            `).join('')
                            : `<p style="text-align:center;color:var(--rv-muted);padding:24px 0;font-size:13px;">No notifications yet</p>`
                        }
                    </div>
                </div>

            </div>
        `;

        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    showDetailModal(type) {
        let title, content;
        
        switch(type) {
            case 'students':
                title = 'All Students';
                content = `
                    <div class="max-h-96 overflow-y-auto">
                        <table class="w-full text-left">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b">
                                <tr>
                                    <th class="px-4 py-2">Name</th>
                                    <th class="px-4 py-2">Class</th>
                                    <th class="px-4 py-2">Age</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y">
                                ${state.students.map(s => {
                                    // FIX 3: Resolve readable class label from class_id (UUID)
                                    // Fall back to s.class string for legacy records
                                    const classObj = s.class_id ? state.classes.find(c => c.id === s.class_id) : null;
                                    const classLabel = classObj ? buildClassName(classObj) : (s.class || '—');
                                    return `
                                    <tr class="text-sm">
                                        <td class="px-4 py-2 font-semibold">${escapeHtml(s.name)}</td>
                                        <td class="px-4 py-2 text-slate-500">${classLabel}</td>
                                        <td class="px-4 py-2 text-slate-500">${s.age || 'N/A'}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                break;
            case 'teachers':
                title = 'All Teachers';
                content = `
                    <div class="max-h-96 overflow-y-auto space-y-2">
                        ${state.teachers.map(t => `
                            <div class="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
                                <p class="font-semibold">${escapeHtml(t.full_name)}</p>
                                <p class="text-sm text-slate-500">${escapeHtml(t.email)}</p>
                            </div>
                        `).join('')}
                    </div>
                `;
                break;
            case 'classes':
                title = 'All Classes';
                content = `
                    <div class="max-h-96 overflow-y-auto space-y-2">
                        ${state.classes.map(c => `
                            <div class="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
                                <p class="font-semibold">${c.level} - ${c.grade}</p>
                            </div>
                        `).join('')}
                    </div>
                `;
                break;
            case 'revenue':
                const confirmed = state.transactions.filter(t => t.status === 'confirmed');
                const _revTotal = confirmed.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0).toLocaleString();
                title = 'Revenue Details';
                content = `
                    <div class="max-h-96 overflow-y-auto">
                        <p class="mb-4 font-bold text-emerald-600 text-xl">Total: ₵<span class="rv-money-val" data-raw="${_revTotal}">${window._rvMoneyHidden ? '•••' : _revTotal}</span></p>
                        <table class="w-full text-left">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b">
                                <tr>
                                    <th class="px-4 py-2">Date</th>
                                    <th class="px-4 py-2">Amount</th>
                                    <th class="px-4 py-2">Method</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y">
                                ${confirmed.map(t => `
                                    <tr class="text-sm">
                                        <td class="px-4 py-2">${new Date(t.created_at).toLocaleDateString()}</td>
                                        <td class="px-4 py-2 font-semibold text-emerald-600">₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span></td>
                                        <td class="px-4 py-2 text-slate-500">${t.method}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                break;
            case 'arrears':
                const arrears = dataManager.getAllArrears();
                const _arrTotal = arrears.reduce((sum, a) => sum + a.amount, 0).toLocaleString();
                title = 'Arrears Details';
                content = `
                    <div class="max-h-96 overflow-y-auto">
                        <p class="mb-4 font-bold text-red-600 text-xl">Total: ₵<span class="rv-money-val" data-raw="${_arrTotal}">${window._rvMoneyHidden ? '•••' : _arrTotal}</span></p>
                        <table class="w-full text-left">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b">
                                <tr>
                                    <th class="px-4 py-2">Student</th>
                                    <th class="px-4 py-2">Parent</th>
                                    <th class="px-4 py-2 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y">
                                ${arrears.map(a => `
                                    <tr class="text-sm">
                                        <td class="px-4 py-2 font-semibold">${escapeHtml(a.studentName)}</td>
                                        <td class="px-4 py-2 text-slate-500">${escapeHtml(a.parentName)}</td>
                                        <td class="px-4 py-2 text-right font-bold text-red-600">₵<span class="rv-money-val" data-raw="${a.amount.toFixed(2)}">${window._rvMoneyHidden ? '•••' : a.amount.toFixed(2)}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                break;
        }
        
        modal.createModal(title, content, null, null, 'Close', null, 'info');
    },

    renderAcademic() {
        const activeYear = state.academicYears.find(y => y.active);
        const inactiveYears = state.academicYears.filter(y => !y.active);
        
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Academic Year Setup</h2>
            </div>

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Academic Year (e.g., 2024/2025)</label>
                        <div class="flex gap-2">
                            <input type="text" id="year-input" class="input-field flex-1 rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="2024/2025">
                            <button onclick="actions.addAcademicYear()" class="px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="grid gap-4">
                ${!activeYear ? '<p class="text-center text-slate-500 py-8 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">No active academic year. Create and activate one above.</p>' : ''}
                ${activeYear ? `
                    <div class="glass-panel rounded-2xl p-6 border-2 border-ridge-500 ring-2 ring-ridge-500/20 bg-white dark:bg-slate-800 shadow-lg">
                        <div class="flex items-center justify-between mb-4">
                            <div>
                                <h3 class="text-xl font-bold text-ridge-600 dark:text-ridge-400">${activeYear.year}</h3>
                                <span class="text-xs font-bold text-ridge-600 bg-ridge-100 dark:bg-ridge-900/30 px-3 py-1 rounded-full mt-2 inline-block">Active</span>
                            </div>
                            <div class="flex gap-2">
                                <button onclick="actions.addTermPrompt('${activeYear.id}')" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all">
                                    <i class="fas fa-plus"></i> Add Term
                                </button>
                            </div>
                        </div>
                        
                        <div class="flex flex-wrap gap-2">
                            ${(activeYear.terms || []).length === 0 ? '<span class="text-sm text-slate-400">No terms added yet</span>' : ''}
                            ${(activeYear.terms || []).map(term => `
                                <button onclick="actions.activateTerm('${activeYear.id}', '${term.id}')" 
                                        class="px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all ${term.active ? 'border-ridge-500 text-ridge-600 bg-ridge-50 dark:bg-ridge-900/20 shadow-md' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-ridge-300 hover:bg-slate-50'}">
                                    ${term.name} ${term.active ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}
                                </button>
                            `).join('')}
                        </div>
                        
                        ${activeYear.terms?.find(t => t.active) ? `
                            <div class="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                                <p class="text-sm text-amber-800 dark:text-amber-200">
                                    <i class="fas fa-info-circle mr-2"></i>
                                    Current Active: ${activeYear.year} - ${activeYear.terms.find(t => t.active)?.name}
                                </p>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
                
                ${inactiveYears.length > 0 ? `
                    <div class="mt-6">
                        <h3 class="text-lg font-bold mb-4 text-slate-700 dark:text-slate-300">Previous Years</h3>
                        <div class="space-y-4">
                            ${inactiveYears.map(year => `
                                <div class="glass-panel rounded-2xl p-6 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300">${year.year}</h3>
                                            <span class="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-full mt-2 inline-block">Inactive</span>
                                            ${year.terms ? `<p class="text-sm text-slate-400 mt-1">${year.terms.length} terms defined</p>` : ''}
                                        </div>
                                        <button onclick="actions.activateYear('${year.id}')" class="px-4 py-2 bg-ridge-600 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all">
                                            Set as Active
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- ── Weeks Sub-section ── -->
            <div class="mt-8">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <img src="assets/3d/calendar.png" alt="" width="40" height="40" loading="lazy" decoding="async" style="width:40px;height:40px;object-fit:contain;flex:none;">
                        <div>
                            <h3 class="text-lg font-bold text-slate-800 dark:text-white">Academic Weeks</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400">Manage weekly periods for attendance, finance &amp; planning</p>
                        </div>
                    </div>
                    <button onclick="ui.route('weeks')"
                        class="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                        <i class="fas fa-arrow-right mr-2"></i>Manage Weeks
                    </button>
                </div>
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderClasses() {
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Class Management</h2>
                <button onclick="actions.refreshData()" class="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-bold transition-colors">
                    <i class="fas fa-sync mr-2"></i> Refresh Data
                </button>
            </div>

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input type="text" id="class-level" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Level (e.g., Primary)">
                    <input type="text" id="class-grade" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Grade (e.g., Grade 4)">
                    <button onclick="actions.addClass()" class="px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        <i class="fas fa-plus mr-2"></i> Create Class
                    </button>
                </div>
            </div>

            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                ${state.classes.length === 0 ? `
                    <div class="p-8 text-center text-slate-500">
                        <i class="fas fa-school text-4xl mb-3 text-slate-300"></i>
                        <p>No classes found. Create your first class above.</p>
                    </div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[600px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Level</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Grade</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${state.classes.map(c => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-4 text-slate-800 dark:text-slate-200">${c.level}</td>
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${c.grade}</td>
                                        <td class="px-6 py-4 text-right">
                                            <button onclick="actions.editClass('${c.id}', '${c.level}', '${c.grade}')" class="text-blue-500 hover:text-blue-700 transition-colors p-2 mr-2" title="Edit">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                            <button onclick="actions.deleteClass('${c.id}')" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderStudents() {
        // Use the global normalizeClassName for consistent class grouping.
        // Wraps it with a title-case display variant for group headings.
        const normaliseClass = raw => {
            if (!raw) return 'Unassigned';
            // Normalise via global helper then title-case for display
            const norm = normalizeClassName(raw);
            return norm.replace(/\b\w/g, c => c.toUpperCase());
        };

        // FIX 2/5: Build a set of active class UUIDs so we never show students
        // from deleted classes. state.students is already filtered by loadStudents(),
        // but this provides a defensive second layer for in-memory rendering.
        const activeClassIds = new Set(state.classes.map(c => c.id));

        // Build a map from normalised key → display label (use first seen canonical form)
        const keyToLabel = {};
        const studentsByClass = {};
        // FIX 2: Only render students whose class is active (or legacy without class_id)
        const activeStudents = state.students.filter(s => !s.class_id || activeClassIds.has(s.class_id));
        const sortedStudents = [...activeStudents].sort((a, b) => a.name.localeCompare(b.name));
        sortedStudents.forEach(s => {
            // Prefer class label resolved from class_id (UUID) over raw s.class string.
            // This prevents raw UUIDs from ever appearing in the UI as group headings.
            let displayLabel = null;
            if (s.class_id) {
                const classObj = state.classes.find(c => c.id === s.class_id);
                if (classObj) displayLabel = buildClassName(classObj);
            }
            const raw = displayLabel || s.class || '';
            const key = normaliseClass(raw);
            if (!studentsByClass[key]) {
                studentsByClass[key] = [];
                // Prefer a label from state.classes if we can match it, otherwise use normalised key
                const matchedClass = state.classes.find(c => normaliseClass(buildClassName(c)) === key);
                keyToLabel[key] = matchedClass ? buildClassName(matchedClass) : key;
            }
            studentsByClass[key].push(s);
        });
        const sortedClasses = Object.keys(studentsByClass).sort();

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Student Registry</h2>
                <div class="flex gap-2">
                    <button onclick="actions.refreshData()" class="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-bold transition-colors">
                        <i class="fas fa-sync mr-2"></i> Refresh
                    </button>
                    <button onclick="actions.openBulkUploadWizard()" class="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:shadow-lg transition-all">
                        <i class="fas fa-file-excel mr-2"></i> Bulk Upload
                    </button>
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-sm font-bold text-slate-600 dark:text-slate-400 mb-4 uppercase tracking-wide">Register New Student</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input type="text" id="student-admission" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Admission Number">
                    <input type="text" id="student-name" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Full Name">
                    <select id="student-gender" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                    </select>
                    <input type="date" id="student-dob" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" onchange="actions.calculateAge()">
                    <input type="text" id="student-age" class="input-field rounded-xl px-4 py-3 bg-slate-100 dark:bg-slate-600 text-slate-800 dark:text-white" placeholder="Age (auto-calculated)" readonly>
                    <select id="student-class" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="">Select Class</option>
                        ${state.classes.map(c => `<option value="${c.id}">${c.level} - ${c.grade}</option>`).join('')}
                    </select>
                    <input type="tel" id="student-parent-phone" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Parent Phone Number">
                    <button onclick="actions.addStudent()" class="md:col-span-3 px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        <i class="fas fa-plus mr-2"></i> Register Student
                    </button>
                </div>
            </div>

            <div class="space-y-6">
                ${activeStudents.length === 0 ? `
                    <div class="glass-panel rounded-2xl p-8 text-center text-slate-500 bg-white dark:bg-slate-800 shadow-lg">
                        <i class="fas fa-user-graduate text-4xl mb-3 text-slate-300"></i>
                        <p>No students registered yet.</p>
                    </div>
                ` : sortedClasses.map(cls => `
                    <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                        <div style="padding:14px 24px;background:#16295a;display:flex;align-items:center;justify-content:space-between;">
                            <div style="display:flex;align-items:center;gap:10px;">
                                <i class="fas fa-school" style="color:#fff;font-size:16px;"></i>
                                <span style="color:#fff;font-weight:700;font-size:15px;">${keyToLabel[cls]}</span>
                            </div>
                            <span style="background:rgba(255,255,255,0.2);color:#fff;font-size:12px;font-weight:700;padding:3px 12px;border-radius:20px;">${studentsByClass[cls].length} student${studentsByClass[cls].length !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left min-w-[700px]">
                                <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                    <tr>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Adm. No.</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Name</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Gender</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Date of Birth</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Age</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide">Parent Phone</th>
                                        <th class="px-5 py-3 font-bold text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wide text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                    ${studentsByClass[cls].map(s => `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td class="px-5 py-3 font-mono text-xs text-ridge-600 dark:text-ridge-400 font-bold">${escapeHtml(s.admission_number || '—')}</td>
                                            <td class="px-5 py-3 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(s.name)}</td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">
                                                ${s.gender ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${s.gender.toLowerCase().startsWith('m') ? 'rgba(59,130,246,0.15)' : s.gender.toLowerCase().startsWith('f') ? 'rgba(236,72,153,0.15)' : 'rgba(100,116,139,0.15)'};color:${s.gender.toLowerCase().startsWith('m') ? '#3b82f6' : s.gender.toLowerCase().startsWith('f') ? '#ec4899' : '#64748b'};">
                                                    <i class="fas fa-${s.gender.toLowerCase().startsWith('m') ? 'mars' : s.gender.toLowerCase().startsWith('f') ? 'venus' : 'genderless'}"></i>
                                                    ${s.gender}
                                                </span>` : '<span style="color:#64748b;">—</span>'}
                                            </td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">${s.dob ? new Date(s.dob).toLocaleDateString('en-GB') : '—'}</td>
                                            <td class="px-5 py-3 text-slate-800 dark:text-slate-200">${s.age || '—'}</td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">${escapeHtml(s.parent_phone || '—')}</td>
                                            <td class="px-5 py-3 text-right">
                                                <button onclick="actions.editStudent('${s.id}')" class="text-blue-500 hover:text-blue-700 transition-colors p-2 mr-1" title="Edit">
                                                    <i class="fas fa-edit"></i>
                                                </button>
                                                <button onclick="actions.deleteStudent('${s.id}')" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderTeachers() {
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Faculty Directory</h2>
                <button onclick="actions.refreshData()" class="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-bold transition-colors">
                    <i class="fas fa-sync mr-2"></i> Refresh
                </button>
            </div>
            
            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                ${state.teachers.length === 0 ? `
                    <div class="p-8 text-center text-slate-500">
                        <i class="fas fa-chalkboard-teacher text-4xl mb-3 text-slate-300"></i>
                        <p>No teachers registered yet.</p>
                    </div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[600px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Name</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Email</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Assigned Class</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${state.teachers.map(t => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(t.full_name)}</td>
                                        <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${escapeHtml(t.email)}</td>
                                        <td class="px-6 py-4">
                                            <select onchange="actions.assignTeacher('${t.profile_id}', this.value)" class="input-field rounded-lg px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                                                <option value="">Not Assigned</option>
                                                ${state.classes.map(c => `
                                                    <option value="${c.id}" ${t.assigned_class === c.id ? 'selected' : ''}>
                                                        ${c.level} - ${c.grade}
                                                    </option>
                                                `).join('')}
                                            </select>
                                        </td>
                                        <td class="px-6 py-4 text-right">
                                            <button onclick="actions.deleteTeacher('${t.profile_id}', ${jsArg(t.full_name)})" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderParents() {
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Parent Management</h2>
                <button onclick="actions.refreshData()" class="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-bold transition-colors">
                    <i class="fas fa-sync mr-2"></i> Refresh
                </button>
            </div>
            
            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                ${state.parents.length === 0 ? `
                    <div class="p-8 text-center text-slate-500">
                        <i class="fas fa-users text-4xl mb-3 text-slate-300"></i>
                        <p>No parents registered yet.</p>
                    </div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[700px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Name</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Email</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Phone</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Linked Children</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${state.parents.map(p => {
                                    const children = p.children_ids?.map(id => {
                                        const student = state.students.find(s => s.id === id);
                                        return student ? student.name : 'Unknown';
                                    }).join(', ') || 'None';
                                    
                                    return `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(p.full_name)}</td>
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${escapeHtml(p.email)}</td>
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${escapeHtml(p.phone || '—')}</td>
                                            <td class="px-6 py-4 text-sm max-w-xs truncate text-slate-600 dark:text-slate-400" title="${children}">${children}</td>
                                            <td class="px-6 py-4 text-right">
                                                <button onclick="actions.editParentChildren('${p.id}')" class="text-blue-500 hover:text-blue-700 mr-3 transition-colors p-2" title="Edit Children">
                                                    <i class="fas fa-edit"></i>
                                                </button>
                                                <button onclick="actions.deleteParent('${p.id}', ${jsArg(p.full_name)})" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderFinance() {
        const pendingPayments = state.transactions.filter(t => t.status === 'pending' && t.type === 'payment');
        const confirmedTransactions = state.transactions.filter(t => t.status === 'confirmed' || t.status === 'rejected');
        const allArrears = dataManager.getAllArrears();

        const html = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">Set Fee Structure</h3>
                    <select id="fee-scope" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-blue-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="global">Global (All Students)</option>
                        ${[...new Set(state.classes.map(c => c.level))].map(l => `<option value="${l}">Level: ${l}</option>`).join('')}
                    </select>
                    <input type="number" id="fee-amount" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Amount (₵)">
                    <input type="text" id="fee-desc" class="input-field w-full rounded-xl px-4 py-3 mb-4 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Description">
                    <button onclick="actions.addFee()" class="w-full py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        Publish Fee
                    </button>
                </div>

                <div class="lg:col-span-2 glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-blue-600">
                        <i class="fas fa-list mr-2"></i>Published Fee Structure (${state.fees.length})
                    </h3>
                    <div class="space-y-3 max-h-96 overflow-y-auto">
                        ${state.fees.length === 0 ? '<p class="text-slate-500 text-center py-4">No fees published yet</p>' : state.fees.map(fee => `
                            <div class="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                                <div>
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(fee.description)}</p>
                                    <p class="text-sm text-blue-700 dark:text-blue-300">₵<span class="rv-money-val" data-raw="${fee.amount}">${window._rvMoneyHidden ? '•••' : fee.amount}</span> • ${fee.scope === 'global' ? 'All Students' : fee.scope}</p>
                                    <p class="text-xs text-slate-500">${new Date(fee.created_at).toLocaleDateString()}</p>
                                </div>
                                <button onclick="actions.deleteFee('${fee.id}')" class="text-red-500 hover:text-red-700 transition-colors p-2 hover:bg-red-50 rounded-lg" title="Delete Fee">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg" id="arrears-section">
                <h3 class="text-lg font-bold mb-4 text-red-600" style="display:flex;align-items:center;justify-content:space-between;">
                    <span><i class="fas fa-exclamation-triangle mr-2"></i>Student Arrears (${allArrears.length} students owing)</span>
                    <button class="rv-eye-toggle" onclick="views.toggleMoneyVisibility()" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px 8px;border-radius:6px;font-size:14px;line-height:1;" title="${window._rvMoneyHidden ? 'Show amounts' : 'Hide amounts'}"><i class="fas ${window._rvMoneyHidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                </h3>
                <div class="overflow-x-auto">
                    ${allArrears.length === 0 ? '<p class="text-slate-500 text-center py-4">No outstanding arrears</p>' : `
                        <table class="w-full text-left min-w-[600px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200">Student</th>
                                    <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200">Class</th>
                                    <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200">Parent</th>
                                    <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Amount Due</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${allArrears.map(a => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(a.studentName)}</td>
                                        <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${a.studentClass}</td>
                                        <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${escapeHtml(a.parentName)}</td>
                                        <td class="px-6 py-3 text-right font-bold text-red-600">₵<span class="rv-money-val" data-raw="${a.amount.toFixed(2)}">${window._rvMoneyHidden ? '•••' : a.amount.toFixed(2)}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-lg font-bold mb-4 text-amber-600">
                    <i class="fas fa-clock mr-2"></i>Pending Verifications (${pendingPayments.length})
                </h3>
                <div class="space-y-3 max-h-96 overflow-y-auto">
                    ${pendingPayments.length === 0 ? '<p class="text-slate-500 text-center py-4">No pending transactions</p>' : pendingPayments.map(t => {
                        const student = state.students.find(s => s.id === t.student_id);
                        return `
                            <div class="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                                <div>
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(student?.name || 'Unknown')}</p>
                                    <p class="text-sm text-amber-700 dark:text-amber-300">₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span> • ${t.method}</p>
                                    ${t.proof ? `<a href="${t.proof}" target="_blank" class="text-xs text-blue-500 underline">View Proof</a>` : ''}
                                </div>
                                <div class="flex gap-2">
                                    <button onclick="actions.approveTransaction('${t.id}')" class="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition-colors">
                                        <i class="fas fa-check"></i> Approve
                                    </button>
                                    <button onclick="actions.rejectTransaction('${t.id}')" class="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition-colors">
                                        <i class="fas fa-times"></i> Reject
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                    <i class="fas fa-history mr-2"></i>Transaction History (Approved/Rejected)
                </h3>
                ${confirmedTransactions.length === 0 ? '<p class="text-slate-500 text-center py-4">No confirmed transactions yet</p>' : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[600px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Date</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Student</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Amount</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Status</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${confirmedTransactions.map(t => {
                                    const student = state.students.find(s => s.id === t.student_id);
                                    const statusColor = t.status === 'confirmed' ? 'text-emerald-600' : 'text-red-600';
                                    const statusBg = t.status === 'confirmed' ? 'bg-emerald-100' : 'bg-red-100';
                                    return `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${new Date(t.created_at).toLocaleDateString()}</td>
                                            <td class="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">${escapeHtml(student?.name || 'Unknown')}</td>
                                            <td class="px-6 py-4 font-bold text-emerald-600">₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span></td>
                                            <td class="px-6 py-4">
                                                <span class="px-2 py-1 rounded-full text-xs font-bold ${statusBg} ${statusColor}">
                                                    ${t.status === 'confirmed' ? 'Approved' : 'Rejected'}
                                                </span>
                                            </td>
                                            <td class="px-6 py-4 text-right">
                                                <button onclick="actions.deleteTransaction('${t.id}')" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    // Admin: pick a class to review the reports its teacher has saved.
    renderClassReports() {
        const term = state.currentTerm?.name || '';
        const year = state.currentAY?.year ? String(state.currentAY.year) : '';
        const rows = state.classes.map(c => {
                const students = state.students.filter(s => s.class_id
                    ? s.class_id === c.id
                    : normalizeClassName(s.class) === normalizeClassName(buildClassName(c)));
                const ids = new Set(students.map(s => s.id));
                const saved = new Set(state.reports
                    .filter(r => ids.has(r.student_id) && r.completed
                        && (!term || r.term === term)
                        && (!year || String(r.academic_year) === year))
                    .map(r => r.student_id)).size;
                const teacher = state.teachers.find(t => t.assigned_class === c.id);
                return { c, name: buildClassName(c), total: students.length, saved, teacher };
            });

        const html = `
            <div class="flex flex-wrap justify-between items-end gap-3 mb-6">
                <div>
                    <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Class Reports</h2>
                    <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${escapeHtml(term)}${term && year ? ' · ' : ''}${escapeHtml(year)} — open a class to read its reports, add the head teacher's remark and download the class report.</p>
                </div>
            </div>
            ${rows.length === 0 ? '<div class="glass-panel rounded-2xl p-10 text-center text-slate-500 bg-white dark:bg-slate-800">No classes set up yet.</div>' : `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                ${rows.map(r => {
                    const pct = r.total ? Math.round(r.saved / r.total * 100) : 0;
                    return `
                    <div class="glass-panel rounded-2xl p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-col gap-4">
                        <div class="min-w-0">
                            <h3 class="font-bold text-slate-800 dark:text-white truncate" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">${r.teacher ? escapeHtml(r.teacher.full_name || 'Class teacher') : 'No class teacher assigned'}</p>
                        </div>
                        <div>
                            <div class="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                                <span>Reports saved</span><span class="tabular-nums">${r.saved} / ${r.total}</span>
                            </div>
                            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                <div class="bg-ridge-600 h-2 rounded-full" style="width:${pct}%"></div>
                            </div>
                        </div>
                        <button onclick="actions.downloadBulkReports(${escapeHtml(JSON.stringify(r.name))}, ${escapeHtml(JSON.stringify(term))}, '${r.c.id}')" class="mt-auto w-full px-4 py-2.5 bg-ridge-600 hover:bg-ridge-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2">
                            <i class="fas fa-folder-open"></i> Open Class Reports
                        </button>
                    </div>`;
                }).join('')}
            </div>`}
        `;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderReceivedReports() {
        const pendingReports = state.receivedReports.filter(r => r.status === 'pending_review');
        const reviewedReports = state.receivedReports.filter(r => r.status === 'reviewed' || r.status === 'archived');
        
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Received Reports from Teachers</h2>
                <span class="px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 rounded-full text-sm font-bold">
                    ${pendingReports.length} Pending
                </span>
            </div>

            <!-- Pending Reports Section -->
            <div class="glass-panel rounded-2xl p-6 mb-8 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 class="text-lg font-bold mb-4 text-amber-600 flex items-center gap-2">
                    <i class="fas fa-clock"></i> Pending Review (${pendingReports.length})
                </h3>
                
                ${pendingReports.length === 0 ? 
                    '<div class="text-center py-8 text-slate-500 bg-slate-50 dark:bg-slate-700/50 rounded-xl">No pending reports</div>' : 
                    `<div class="space-y-4">
                        ${pendingReports.map(report => `
                            <div class="bg-white dark:bg-slate-700 rounded-xl p-6 border-l-4 border-amber-500 shadow-sm hover:shadow-md transition-shadow">
                                <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-3 mb-2">
                                            <div class="w-10 h-10 rounded-full bg-ridge-600 flex items-center justify-center text-white font-bold">
                                                ${report.teacher_name ? report.teacher_name.charAt(0) : 'T'}
                                            </div>
                                            <div>
                                                <h4 class="font-bold text-slate-800 dark:text-white text-lg">${escapeHtml(report.teacher_name || 'Unknown Teacher')}</h4>
                                                <p class="text-sm text-slate-500">${report.class} • ${report.term} • ${report.academic_year}</p>
                                            </div>
                                        </div>
                                        
                                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                                            <div class="bg-slate-50 dark:bg-slate-600 rounded-lg p-3">
                                                <span class="text-slate-500 dark:text-slate-400 block text-xs">Students</span>
                                                <span class="font-bold text-slate-800 dark:text-white text-lg">${report.student_count}</span>
                                            </div>
                                            <div class="bg-slate-50 dark:bg-slate-600 rounded-lg p-3">
                                                <span class="text-slate-500 dark:text-slate-400 block text-xs">Class Level</span>
                                                <span class="font-bold text-slate-800 dark:text-white">${report.class_level || 'N/A'}</span>
                                            </div>
                                            <div class="bg-slate-50 dark:bg-slate-600 rounded-lg p-3">
                                                <span class="text-slate-500 dark:text-slate-400 block text-xs">Template</span>
                                                <span class="font-bold text-slate-800 dark:text-white text-xs">${report.template_used || 'Standard'}</span>
                                            </div>
                                            <div class="bg-slate-50 dark:bg-slate-600 rounded-lg p-3">
                                                <span class="text-slate-500 dark:text-slate-400 block text-xs">Submitted</span>
                                                <span class="font-bold text-slate-800 dark:text-white text-xs">${new Date(report.submitted_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="flex flex-col gap-2 min-w-[200px]">
                                        <button onclick="actions.viewReceivedReportDetail('${report.id}')" class="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2">
                                            <i class="fas fa-eye"></i> View Details
                                        </button>
                                        <button onclick="actions.downloadReportBundle('${report.id}')" class="w-full px-4 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2">
                                            <i class="fas fa-download"></i> Download All
                                        </button>
                                        <div class="flex gap-2">
                                            <button onclick="actions.approveReportBundle('${report.id}')" class="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all">
                                                <i class="fas fa-check"></i> Approve
                                            </button>
                                            <button onclick="actions.rejectReportBundle('${report.id}')" class="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all">
                                                <i class="fas fa-times"></i> Reject
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>`
                }
            </div>

            <!-- Reviewed Reports History -->
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 class="text-lg font-bold mb-4 text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <i class="fas fa-history"></i> Review History (${reviewedReports.length})
                </h3>
                
                ${reviewedReports.length === 0 ? 
                    '<div class="text-center py-8 text-slate-500">No reviewed reports yet</div>' :
                    `<div class="overflow-x-auto">
                        <table class="w-full text-left">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Teacher</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Class</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Term</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Students</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Status</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${reviewedReports.map(report => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(report.teacher_name || 'Unknown')}</td>
                                        <td class="px-6 py-4 text-slate-600 dark:text-slate-400">${report.class}</td>
                                        <td class="px-6 py-4 text-slate-600 dark:text-slate-400">${report.term}</td>
                                        <td class="px-6 py-4 text-center font-bold text-slate-800 dark:text-slate-200">${report.student_count}</td>
                                        <td class="px-6 py-4 text-center">
                                            <span class="px-3 py-1 rounded-full text-xs font-bold ${report.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">
                                                ${report.status === 'reviewed' ? 'Approved' : 'Archived'}
                                            </span>
                                        </td>
                                        <td class="px-6 py-4 text-right">
                                            <button onclick="actions.downloadReportBundle('${report.id}')" class="text-emerald-600 hover:text-emerald-800 font-bold text-sm">
                                                <i class="fas fa-download mr-1"></i> Download
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>`
                }
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderAdminUploadReports() {
        const selectedClass = state.selectedUploadClass || '';
        // selectedUploadClass is a canonical class name string (set from the select's value).
        // FIX: match students by class_id (UUID) when available, fall back to normalized string.
        let classStudents = [];
        if (selectedClass) {
            // FIX: use buildClassName() for class lookup so BASIC prefix matches correctly
            const classObj = state.classes.find(c => normalizeClassName(buildClassName(c)) === normalizeClassName(selectedClass));
            classStudents = state.students.filter(s => {
                if (classObj && s.class_id) return s.class_id === classObj.id;
                return normalizeClassName(s.class) === normalizeClassName(selectedClass);
            });
        }

        // Reports already uploaded by admin — filter by uploaded_by only,
        // fall back gracefully if no active year/term is set
        const uploadedReports = state.reports.filter(r => {
            if (r.uploaded_by !== state.currentUser?.id) return false;
            // If we have year/term IDs, filter by them; otherwise show all admin uploads
            if (state.currentAY?.id && r.year_id) return r.year_id === state.currentAY.id;
            return true;
        });

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Upload Student Reports</h2>
                <span class="text-sm text-slate-500 dark:text-slate-400">Reports go directly to parents upon upload</span>
            </div>

            <!-- Class selector -->
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Select Class</label>
                <div class="flex gap-3">
                    <select id="admin-class-filter"
                        onchange="state.selectedUploadClass = this.value; views.renderAdminUploadReports();"
                        class="flex-1 input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="">-- Choose a class --</option>
                        ${state.classes.map(c => {
                            const val = buildClassName(c);   // FIX: canonical name with BASIC prefix
                            return `<option value="${val}" ${val === selectedClass ? 'selected' : ''}>${val}</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>

            <!-- Student list for chosen class -->
            ${selectedClass ? `
                <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                        <i class="fas fa-users mr-2 text-ridge-500"></i>
                        Students in ${selectedClass}
                        <span class="ml-2 text-sm font-normal text-slate-500">(${classStudents.length} students)</span>
                    </h3>
                    ${classStudents.length === 0
                        ? `<p class="text-slate-500 text-center py-8">No students found in this class.</p>`
                        : `<div class="space-y-3">
                            ${classStudents.map(student => {
                                const existing = uploadedReports.find(r => r.student_id === student.id);
                                return `
                                    <div class="flex items-center justify-between p-4 rounded-xl border
                                        ${existing
                                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                                            : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600'}">
                                        <div class="flex items-center gap-3">
                                            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow ${existing ? 'bg-emerald-500' : 'bg-ridge-600'}">
                                                ${existing ? '<i class="fas fa-check text-xs"></i>' : escapeHtml(student.name.charAt(0).toUpperCase())}
                                            </div>
                                            <div>
                                                <p class="font-bold ${existing ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-slate-200'}">${escapeHtml(student.name)}</p>
                                                <p class="text-xs ${existing ? 'text-emerald-500 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}">${existing ? 'Report uploaded <i class="fas fa-check" aria-hidden="true"></i>' : (student.student_id || student.id)}</p>
                                            </div>
                                        </div>
                                        <div class="flex items-center gap-3">
                                            ${existing ? `
                                                <span class="px-3 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-full text-xs font-bold">
                                                    <i class="fas fa-check mr-1"></i>Uploaded
                                                </span>
                                                <a href="${existing.file_url}" target="_blank"
                                                    class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors">
                                                    <i class="fas fa-eye mr-1"></i>View
                                                </a>
                                                <button onclick="actions.undoStudentReport('${existing.id}', ${jsArg(student.name)})"
                                                    class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors flex items-center gap-1">
                                                    <i class="fas fa-undo"></i> Undo
                                                </button>
                                            ` : `
                                                <label class="cursor-pointer flex items-center gap-2 px-4 py-2 bg-ridge-600 text-white rounded-xl text-sm font-bold hover:shadow-lg transition-all">
                                                    <i class="fas fa-cloud-upload-alt"></i>
                                                    Upload Report
                                                    <input type="file" accept=".pdf,.doc,.docx" class="hidden"
                                                        onchange="actions.uploadStudentReport('${student.id}', ${jsArg(student.name)}, this)">
                                                </label>
                                            `}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>`
                    }
                </div>
            ` : ''}

            <!-- Summary of all uploaded reports this term -->
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                    <i class="fas fa-history mr-2 text-slate-400"></i>
                    All Uploaded Reports This Term
                    <span class="ml-2 text-sm font-normal text-slate-500">(${uploadedReports.length} reports)</span>
                </h3>
                ${uploadedReports.length === 0
                    ? `<p class="text-slate-500 text-center py-4">No reports uploaded yet this term.</p>`
                    : `<div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[500px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">Student</th>
                                    <th class="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">Class</th>
                                    <th class="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">Status</th>
                                    <th class="px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${uploadedReports.map(report => {
                                    const student = state.students.find(s => s.id === report.student_id);
                                    return `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td class="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(student?.name || 'Unknown')}</td>
                                            <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-sm">${student?.class || '—'}</td>
                                            <td class="px-4 py-3">
                                                <span class="px-2 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded-full text-xs font-bold">
                                                    Published to Parents
                                                </span>
                                            </td>
                                            <td class="px-4 py-3 text-right">
                                                <div class="flex items-center justify-end gap-2">
                                                    <a href="${report.file_url}" target="_blank"
                                                        class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors">
                                                        <i class="fas fa-eye"></i>
                                                    </a>
                                                    <button onclick="actions.undoStudentReport('${report.id}', ${jsArg((student?.name || 'this student'))})"
                                                        class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors">
                                                        <i class="fas fa-undo mr-1"></i>Undo
                                                    </button>
                                                    <button onclick="actions.deleteReport('${report.id}')"
                                                        class="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition-colors">
                                                        <i class="fas fa-trash"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>`
                }
            </div>
        `;

        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    // REMOVED: renderAdminTeacherReports() — teachers don't upload or review reports

    renderScreenshots() {
        const pendingPayments = state.transactions.filter(t => t.status === 'pending' && t.proof);
        
        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Payment Screenshots</h2>
                <span class="text-sm text-slate-500">Payment proofs uploaded by parents</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${pendingPayments.length === 0 ? `
                    <div class="col-span-full text-center py-12 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">
                        <i class="fas fa-image text-4xl mb-3 text-slate-300"></i>
                        <p>No pending payment screenshots</p>
                    </div>
                ` : pendingPayments.map(t => {
                    const student = state.students.find(s => s.id === t.student_id);
                    const parent = state.parents.find(p => p.id === t.parent_id);
                    
                    return `
                        <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                            <div class="relative h-48 bg-slate-100 dark:bg-slate-700 overflow-hidden cursor-pointer" onclick="privateStorage.open(${jsArg(t.proof)})">
                                <img src="${t.proof}" alt="Payment Proof" class="w-full h-full object-cover hover:scale-105 transition-transform">
                                <div class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                    <span class="text-white font-bold"><i class="fas fa-search-plus mr-2"></i>View Full Image</span>
                                </div>
                            </div>
                            <div class="p-4">
                                <div class="flex justify-between items-start mb-2">
                                    <div>
                                        <p class="font-bold text-slate-800 dark:text-white">${escapeHtml(student?.name || 'Unknown Student')}</p>
                                        <p class="text-sm text-slate-500">${student?.class || ''}</p>
                                    </div>
                                    <span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">Pending</span>
                                </div>
                                <div class="space-y-1 text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    <p><i class="fas fa-user mr-2"></i>Parent: ${escapeHtml(parent?.full_name || 'Unknown')}</p>
                                    <p><i class="fas fa-money-bill mr-2"></i>Amount: ₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span></p>
                                    <p><i class="fas fa-calendar mr-2"></i>Date: ${new Date(t.created_at).toLocaleDateString()}</p>
                                    <p><i class="fas fa-hashtag mr-2"></i>Ref: ${t.id.substring(0, 8).toUpperCase()}</p>
                                </div>
                                <div class="flex gap-2">
                                    <button onclick="actions.approveTransaction('${t.id}')" class="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-sm font-bold hover:bg-emerald-600 transition-colors">
                                        <i class="fas fa-check mr-1"></i> Approve
                                    </button>
                                    <button onclick="actions.rejectTransaction('${t.id}')" class="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600 transition-colors">
                                        <i class="fas fa-times mr-1"></i> Reject
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    // Accountant: approve or reject new accountant sign-ups.
    renderAccountantApprovals() {
        const pendingAccountants = state.pendingAccountants || [];
        const html = `
            <h2 class="text-2xl font-bold mb-2 text-slate-800 dark:text-white">Accountant Approvals</h2>
            <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">New accountants who signed up on the accounts-office screen. Approve only people you know work in the accounts office.</p>
            <div class="space-y-4">
                ${pendingAccountants.length === 0 ? '<div class="text-center py-12 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg"><img src="assets/3d/all-clear.png" alt="" width="72" height="72" loading="lazy" style="width:72px;height:72px;margin:0 auto 12px;display:block;">No pending accountant requests</div>' : ''}
                ${pendingAccountants.map(a => `
                    <div class="glass-panel rounded-2xl p-6 flex flex-wrap gap-4 items-center justify-between bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div class="min-w-0">
                            <h3 class="font-bold text-lg text-slate-800 dark:text-white">${escapeHtml(a.full_name)}</h3>
                            <p class="text-sm text-slate-500 break-all">${escapeHtml(a.email)}</p>
                            <span class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">Accountant · Pending Approval</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="actions.approveAccountant('${a.profile_id}')" class="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-check mr-2"></i> Approve
                            </button>
                            <button onclick="actions.rejectAccountant('${a.profile_id}')" class="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-times mr-2"></i> Reject
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderApprovals() {
        // Pending admins/teachers are profiles with approved=false
        const pendingAdmins = state.pendingAdmins || [];
        const pendingTeachers = state.pendingTeachers || [];
        const pendingLinks = (state.parents || []).flatMap(p =>
            (p.pending_children_ids || []).map(studentId => ({
                parent: p,
                studentId,
                student: state.students.find(s => s.id === studentId)
            }))
        );
        const nothingPending = !pendingAdmins.length && !pendingTeachers.length && !pendingLinks.length;
        
        const html = `
            <h2 class="text-2xl font-bold mb-6 text-slate-800 dark:text-white">Pending Approvals</h2>
            
            <div class="space-y-4">
                ${nothingPending ? '<div class="text-center py-12 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg"><img src="assets/3d/all-clear.png" alt="" width="72" height="72" loading="lazy" style="width:72px;height:72px;margin:0 auto 12px;display:block;">No pending approvals</div>' : ''}
                ${pendingTeachers.map(t => `
                    <div class="glass-panel rounded-2xl p-6 flex items-center justify-between bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <h3 class="font-bold text-lg text-slate-800 dark:text-white">${escapeHtml(t.full_name)}</h3>
                            <p class="text-sm text-slate-500">${escapeHtml(t.email)}</p>
                            <span class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">Teacher · Pending Approval</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="actions.approveTeacher('${t.profile_id}')" class="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-check mr-2"></i> Approve
                            </button>
                            <button onclick="actions.rejectTeacher('${t.profile_id}')" class="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-times mr-2"></i> Reject
                            </button>
                        </div>
                    </div>
                `).join('')}
                ${pendingLinks.map(l => `
                    <div class="glass-panel rounded-2xl p-6 flex items-center justify-between bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <h3 class="font-bold text-lg text-slate-800 dark:text-white">${escapeHtml(l.parent.full_name)} → ${escapeHtml(l.student?.name || 'Unknown student')}</h3>
                            <p class="text-sm text-slate-500">${escapeHtml(l.parent.email)}${l.parent.phone ? ' · ' + escapeHtml(l.parent.phone) : ''}${l.student?.class ? ' · ' + escapeHtml(l.student.class) : ''}</p>
                            <span class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">Child Link Request</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="actions.reviewChildLink('${l.parent.id}', '${l.studentId}', true)" class="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-check mr-2"></i> Approve
                            </button>
                            <button onclick="actions.reviewChildLink('${l.parent.id}', '${l.studentId}', false)" class="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-times mr-2"></i> Reject
                            </button>
                        </div>
                    </div>
                `).join('')}
                ${pendingAdmins.map(admin => `
                    <div class="glass-panel rounded-2xl p-6 flex items-center justify-between bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <h3 class="font-bold text-lg text-slate-800 dark:text-white">${escapeHtml(admin.full_name)}</h3>
                            <p class="text-sm text-slate-500">${escapeHtml(admin.email)}</p>
                            <span class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">Pending Approval</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="actions.approveAdmin('${admin.profile_id}')" class="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-check mr-2"></i> Approve
                            </button>
                            <button onclick="actions.rejectAdmin('${admin.profile_id}')" class="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-times mr-2"></i> Reject
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderAnnouncements() {
        // ── ADMIN: compose panel + list of sent announcements ──────────────────
        if (state.role === 'admin') {
            // FIX 2: Use sentAnnouncements (admin's own sent items), not state.notifications
            const sent = state.sentAnnouncements || state.notifications.filter(n => n.type === 'announcement');
            const targetLabel = { all: 'All Users', teachers: 'Teachers', parents: 'Parents', accountants: 'Accountants' };

            const html = `
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Announcements</h2>
                </div>

                <!-- Compose -->
                <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                        <i class="fas fa-bullhorn mr-2 text-ridge-500"></i>Compose Announcement
                    </h3>
                    <div class="space-y-4">
                        <input type="text" id="announcement-title"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                            placeholder="Announcement Title">
                        <textarea id="announcement-message" rows="4"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                            placeholder="Write your announcement here..."></textarea>
                        <div class="flex gap-6 flex-wrap">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="announcement-target" value="all" checked class="text-ridge-500 focus:ring-ridge-500">
                                <span class="text-slate-700 dark:text-slate-300 font-medium">All Users</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="announcement-target" value="teachers" class="text-ridge-500 focus:ring-ridge-500">
                                <span class="text-slate-700 dark:text-slate-300 font-medium">Teachers Only</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="announcement-target" value="parents" class="text-ridge-500 focus:ring-ridge-500">
                                <span class="text-slate-700 dark:text-slate-300 font-medium">Parents Only</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="announcement-target" value="accountants" class="text-ridge-500 focus:ring-ridge-500">
                                <span class="text-slate-700 dark:text-slate-300 font-medium">Accountants Only</span>
                            </label>
                        </div>
                        <button onclick="actions.sendAnnouncement()"
                            class="px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                            <i class="fas fa-paper-plane mr-2"></i> Send Announcement
                        </button>
                    </div>
                </div>

                <!-- Sent announcements -->
                <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                        <i class="fas fa-history mr-2 text-slate-400"></i>Sent Announcements
                    </h3>
                    ${sent.length === 0
                        ? `<p class="text-slate-500 text-center py-8">No announcements sent yet.</p>`
                        : `<div class="space-y-3">
                            ${sent.map(n => `
                                <div class="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                                    <div class="flex items-start justify-between gap-4">
                                        <div class="flex-1 min-w-0">
                                            <p class="font-bold text-slate-800 dark:text-white">${escapeHtml(n.title)}</p>
                                            <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">${escapeHtml(n.message)}</p>
                                        </div>
                                        <div class="text-right shrink-0">
                                            <span class="inline-block px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                ${targetLabel[n.target] || 'All Users'}
                                            </span>
                                            <p class="text-xs text-slate-400 mt-1">${new Date(n.created_at).toLocaleString()}</p>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
            `;
            const container = document.getElementById('view-content');
            if (container) container.innerHTML = html;
            return;
        }

        // ── TEACHER / PARENT: read-only inbox of admin announcements ──────────
        const inbox = state.notifications.filter(n => n.type === 'announcement');
        const roleLabel = { teacher: 'Teacher', parent: 'Parent', accountant: 'Accountant' }[state.role] || 'Parent';

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">
                    <i class="fas fa-inbox mr-2 text-ridge-500"></i>Announcements
                </h2>
                <span class="text-sm text-slate-500 dark:text-slate-400">${inbox.length} message${inbox.length !== 1 ? 's' : ''}</span>
            </div>

            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                ${inbox.length === 0
                    ? `<div class="text-center py-16">
                            <div class="w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i class="fas fa-inbox text-3xl text-slate-300"></i>
                            </div>
                            <p class="text-slate-500 dark:text-slate-400 font-medium">No announcements yet</p>
                            <p class="text-sm text-slate-400 dark:text-slate-500 mt-1">Messages from the admin will appear here.</p>
                        </div>`
                    : `<div class="space-y-4">
                            ${inbox.map(n => `
                                <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 dark:to-slate-800 hover:shadow-md transition-shadow">
                                    <div class="flex items-start gap-4">
                                        <div class="w-10 h-10 rounded-full bg-ridge-600 flex items-center justify-center shrink-0 shadow">
                                            <i class="fas fa-bullhorn text-white text-sm"></i>
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center justify-between gap-2 mb-1">
                                                <p class="font-bold text-slate-800 dark:text-white">${escapeHtml(n.title)}</p>
                                                <p class="text-xs text-slate-400 shrink-0">${new Date(n.created_at).toLocaleString()}</p>
                                            </div>
                                            <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">${escapeHtml(n.message)}</p>
                                            <p class="text-xs text-slate-400 dark:text-slate-500 mt-2">
                                                <i class="fas fa-user-shield mr-1"></i>School Administration
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>`
                }
            </div>
        `;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    // Accountant: the term/year financial report generator on its own page.
    renderFinancialReport() {
        const container = document.getElementById('view-content');
        if (!container) return;
        if (typeof financialReportGenerator === 'undefined') {
            container.innerHTML = '<p class="p-8 text-center text-slate-500">The financial report tool could not be loaded. Please refresh the page.</p>';
            return;
        }
        container.innerHTML = financialReportGenerator.renderFinancialReportSection()
            .replace('id="frg-section" style="margin-top:32px;"', 'id="frg-section"');
        financialReportGenerator._onYearChange();
        financialReportGenerator._setMode('term');
    },

    renderDataAnalysis() {
        // Delegated to the Academic Report Generator module (academic-report-generator.js)
        try {
            if (typeof renderDataAnalysis !== 'function') {
                throw new Error('Academic Report Generator module not loaded.');
            }
            renderDataAnalysis();
        } catch (err) {
            console.error('renderDataAnalysis error:', err);
            const container = document.getElementById('view-content');
            if (container) {
                container.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:16px;text-align:center;padding:24px;">
                        <div style="width:56px;height:56px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:22px;"></i>
                        </div>
                        <div>
                            <p style="font-weight:700;font-size:16px;color:var(--rv-navy,#0f2044);margin:0 0 6px;">Failed to load Data Analysis</p>
                            <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">${escapeHtml(err.message || 'An unexpected error occurred.')}</p>
                        </div>
                        <button onclick="ui.route('data_analysis')" style="padding:10px 24px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">
                            <i class="fas fa-redo" style="margin-right:6px;"></i>Retry
                        </button>
                    </div>
                `;
            }
        }
    },

    async renderTeacherDashboard() {
        // Refresh assignment FIRST so state.teachers has the latest UUID,
        // THEN reload classes + students so the UUID→string lookup and
        // UUID-based student filter both work on fresh data.
        try {
            await dataManager.refreshCurrentTeacherAssignment();
            // FIX 7/8: Load classes before students so active-class filter works
            await dataManager.loadClasses();
            await dataManager.loadStudents();
        } catch (e) { /* non-fatal – render with cached data */ }

        const myStudents = dataManager.getTeacherStudents();

        // Report progress: saved reports for this term's students
        const myIds = new Set(myStudents.map(s => s.id));
        const savedReportCount = new Set(state.reports
            .filter(r => myIds.has(r.student_id) && r.completed
                && (!state.currentTerm?.name || r.term === state.currentTerm.name)
                && (!state.currentAY?.year || String(r.academic_year) === String(state.currentAY.year)))
            .map(r => r.student_id)).size;

        const html = `
            <div class="mb-6">
                <h2 style="font-family:inherit;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0 0 4px;">My Dashboard</h2>
                <p style="font-size:13px;color:var(--rv-muted,#64748b);">Welcome, ${escapeHtml(state.currentUser?.full_name || 'Teacher')}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg">
                    <img src="assets/3d/student.png" alt="" width="56" height="56" loading="lazy" decoding="async" style="width:56px;height:56px;object-fit:contain;flex:none;display:block;margin:-4px 0 12px -4px;">
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${myStudents.length}</h3>
                    <p class="text-sm text-slate-500">My Students</p>
                </div>
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg">
                    <img src="assets/3d/reports.png" alt="" width="56" height="56" loading="lazy" decoding="async" style="width:56px;height:56px;object-fit:contain;flex:none;display:block;margin:-4px 0 12px -4px;">
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${state.reports.filter(r => r.teacher_id === state.currentUser?.id && r.status === 'published').length}</h3>
                    <p class="text-sm text-slate-500">Reports Published</p>
                </div>
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg">
                    <img src="assets/3d/backpack.png" alt="" width="56" height="56" loading="lazy" decoding="async" style="width:56px;height:56px;object-fit:contain;flex:none;display:block;margin:-4px 0 12px -4px;">
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${myStudents.length}</h3>
                    <p class="text-sm text-slate-500">Students in Class</p>
                </div>
            </div>

            <!-- Report Progress (this term) -->
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                <div class="flex flex-col sm:flex-row sm:items-center gap-4">
                    <img src="assets/3d/outbox.png" alt="" width="44" height="44" loading="lazy" decoding="async" style="width:44px;height:44px;object-fit:contain;flex:none;">
                    <div class="flex-1 min-w-0">
                        <h3 class="font-bold text-lg text-slate-800 dark:text-white">Report Progress</h3>
                        <p class="text-sm text-slate-500">${savedReportCount} of ${myStudents.length} reports saved for ${escapeHtml(state.currentTerm?.name || 'this term')}. The admin reviews them and adds the head teacher's remark.</p>
                        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mt-3">
                            <div class="bg-ridge-600 h-2 rounded-full" style="width:${myStudents.length ? Math.round(savedReportCount / myStudents.length * 100) : 0}%"></div>
                        </div>
                    </div>
                    <button onclick="ui.route('teacher_create_report')" class="px-5 py-3 bg-ridge-600 hover:bg-ridge-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2">
                        <i class="fas fa-pen"></i> Open Reports
                    </button>
                </div>
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    async renderTeacherStudents() {
        try {
            await dataManager.refreshCurrentTeacherAssignment();
            // FIX 7/8: Load classes before students so active-class filter works
            await dataManager.loadClasses();
            await dataManager.loadStudents();
        } catch (e) { /* non-fatal */ }
        const myStudents = dataManager.getTeacherStudents();

        // Helper: resolve a readable class label — never expose raw UUIDs in UI
        const resolveClassLabel = (s) => {
            if (s.class_id) {
                const classObj = state.classes.find(c => c.id === s.class_id);
                if (classObj) return buildClassName(classObj);
            }
            return s.class || '—';
        };

        const html = `
            <h2 class="text-2xl font-bold mb-6 text-slate-800 dark:text-white">My Students</h2>
            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                ${myStudents.length === 0 ? '<p class="p-8 text-center text-slate-500">No students assigned to your class</p>' : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left min-w-[600px]">
                            <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <tr>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Name</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Class</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Age</th>
                                    <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${myStudents.map(s => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(s.name)}</td>
                                        <td class="px-6 py-4 text-slate-800 dark:text-slate-200">${resolveClassLabel(s)}</td>
                                        <td class="px-6 py-4 text-slate-800 dark:text-slate-200">${escapeHtml(s.age || 'N/A')}</td>
                                        <td class="px-6 py-4 text-right">
                                            <button onclick="actions.teacherEditStudent('${s.id}')" class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ridge-700 dark:text-ridge-400 hover:bg-ridge-50 dark:hover:bg-white/5">
                                                <i class="fas fa-pen text-xs"></i> Edit
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },


    async renderTeacherCreateReport() {
    // Refresh assignment FIRST so state.teachers has the latest UUID,
    // then reload classes (and students) so the UUID→classString lookup
    // and active-class student filter are always current.
    try {
        await dataManager.refreshCurrentTeacherAssignment();
        await dataManager.loadClasses();
        await dataManager.loadStudents();
    } catch (e) { /* non-fatal */ }
    try {
        // Get teacher data
        const teacher = dataManager.getCurrentTeacher();
        const assignedClass = teacher?.assigned_class ? 
            state.classes.find(c => c.id === teacher.assigned_class) : null;
        const classString = assignedClass ? buildClassName(assignedClass) : '';

        // Guard: teacher must have an assigned class
        if (!classString) {
            modal.alert(
                'No Class Assigned',
                'You do not have a class assigned yet. Please contact the administrator to assign you a class before creating reports.',
                'warning'
            );
            return;
        }

        const teacherId   = state.currentUser?.id || '';
        const teacherName = state.currentUser?.full_name || 'Teacher';
        const year        = state.currentAY?.year || new Date().getFullYear();
        const term        = state.currentTerm?.name || 'Term 1';
        const classId     = assignedClass?.id || '';

        // Persist to localStorage (fallback for report.js)
        localStorage.setItem('rv_report_teacher_id',   teacherId);
        localStorage.setItem('rv_report_teacher_name', teacherName);
        localStorage.setItem('rv_report_class',        classString);
        localStorage.setItem('rv_report_class_id',     classId);
        localStorage.setItem('rv_report_year',         year);
        localStorage.setItem('rv_report_term',         term);

        // Build URL with query params so report.js always receives correct data
        // even if localStorage is delayed or blocked
        const params = new URLSearchParams({
            teacherId,
            teacherName,
            class: classString,
            classId,
            year,
            term
        });
        const reportUrl = `report.html?${params.toString()}`;

        window.open(reportUrl, '_blank');

        // Show confirmation UI
        const html = `
            <div class="glass-panel rounded-2xl p-8 bg-white dark:bg-slate-800 shadow-lg text-center">
                <div class="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <i class="fas fa-external-link-alt text-3xl text-white"></i>
                </div>
                <h2 class="text-2xl font-bold mb-4 text-slate-800 dark:text-white">Report Generator Opened</h2>
                <p class="text-slate-600 dark:text-slate-300 mb-6">
                    The report generator has been opened in a new tab with your class data pre-loaded.
                </p>
                <div class="text-left bg-slate-50 dark:bg-slate-700 p-4 rounded-xl text-sm text-slate-600 dark:text-slate-400 mb-4">
                    <p><strong>Teacher:</strong> ${escapeHtml(teacherName)}</p>
                    <p><strong>Class:</strong> ${classString}</p>
                    <p><strong>Year:</strong> ${year}</p>
                    <p><strong>Term:</strong> ${term}</p>
                </div>
                <button onclick="window.open('${reportUrl}', '_blank')" class="w-full px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                    <i class="fas fa-redo mr-2"></i> Open Again
                </button>
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
        
        ui.showToast('Report generator opened in new tab', 'success');
        
    } catch (err) {
        console.error('Error opening report generator:', err);
        modal.alert('Error', 'Failed to open report generator: ' + extractErrorMessage(err), 'error');
    }
},

    renderParentDashboard() {
        const parent = state.parents.find(p => p.profile_id === state.currentUser?.id);
        const myChildren = state.students.filter(s => parent?.children_ids?.includes(s.id));

        const html = `
            <div class="mb-6">
                <h2 style="font-family:inherit;font-size:24px;font-weight:800;letter-spacing:-0.02em;color:var(--rv-navy,#0f2044);margin:0 0 4px;">Dashboard</h2>
                <p style="font-size:13px;color:var(--rv-muted,#64748b);">Welcome, ${escapeHtml(state.currentUser?.full_name || 'Parent')}</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                ${myChildren.length === 0 ? '<div class="col-span-full text-center py-10 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg"><img src="assets/3d/child.png" alt="" width="72" height="72" loading="lazy" style="width:72px;height:72px;margin:0 auto 12px;display:block;">No children linked to your account</div>' : myChildren.map(child => {
                    const arrears = dataManager.calculateStudentArrears(child.id);
                    return `
                        <div class="glass-panel p-6 rounded-2xl card-hover bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                            <div class="flex items-center gap-4 mb-5">
                                <div class="w-12 h-12 flex-none bg-ridge-600 rounded-xl flex items-center justify-center text-white text-lg font-bold">
                                    ${escapeHtml(child.name.charAt(0))}
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-lg leading-snug text-slate-800 dark:text-white break-words">${escapeHtml(child.name)}</h3>
                                    <p class="text-sm text-slate-500">${escapeHtml(child.class)}</p>
                                </div>
                            </div>
                            
                            <div class="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700 rounded-xl">
                                <span class="text-sm font-medium text-slate-600 dark:text-slate-400">Outstanding:</span>
                                <span class="font-bold ${arrears > 0 ? 'text-red-600' : 'text-emerald-600'}" style="display:flex;align-items:center;gap:8px;">
                                    ₵<span class="rv-money-val" data-raw="${arrears.toFixed(2)}">${window._rvMoneyHidden ? '•••' : arrears.toFixed(2)}</span>
                                    <button class="rv-eye-toggle" onclick="views.toggleMoneyVisibility()" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.6;padding:0;line-height:1;" title="${window._rvMoneyHidden ? 'Show amount' : 'Hide amount'}"><i class="fas ${window._rvMoneyHidden ? 'fa-eye-slash' : 'fa-eye'}" style="font-size:12px;"></i></button>
                                </span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderParentChildren() {
        const parent = state.parents.find(p => p.profile_id === state.currentUser?.id);
        const myChildren = state.students.filter(s => parent?.children_ids?.includes(s.id));
        const pendingCount = parent?.pending_children_ids?.length || 0;

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">My Children</h2>
                <button onclick="actions.searchAndLinkChild()" class="px-4 py-2 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                    <i class="fas fa-plus mr-2"></i> Link Child
                </button>
            </div>
            ${pendingCount ? `
                <div class="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm font-semibold">
                    <i class="fas fa-clock mr-2"></i>${pendingCount} link request${pendingCount === 1 ? '' : 's'} waiting for administrator approval.
                </div>` : ''}

            <div class="grid gap-6">
                ${myChildren.length === 0 ? '<div class="text-center py-10 px-6 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg"><img src="assets/3d/child.png" alt="" width="72" height="72" loading="lazy" style="width:72px;height:72px;margin:0 auto 12px;display:block;">No children linked yet. Click "Link Child" to search for your child and request a link.</div>' : myChildren.map(child => `
                    <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-16 h-16 bg-ridge-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                                ${child.name.charAt(0)}
                            </div>
                            <div class="flex-1">
                                <h3 class="font-bold text-xl text-slate-800 dark:text-white">${escapeHtml(child.name)}</h3>
                                <p class="text-slate-500">${child.class}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4 text-center">
                            <div class="p-3 bg-slate-50 dark:bg-slate-700 rounded-xl">
                                <p class="text-sm text-slate-500">Age</p>
                                <p class="font-bold text-slate-800 dark:text-white">${child.age || 'N/A'}</p>
                            </div>
                            <div class="p-3 bg-slate-50 dark:bg-slate-700 rounded-xl">
                                <p class="text-sm text-slate-500">Outstanding</p>
                                <p class="font-bold text-red-600" style="display:flex;align-items:center;justify-content:center;gap:6px;">
                                    ₵<span class="rv-money-val" data-raw="${dataManager.calculateStudentArrears(child.id).toFixed(2)}">${window._rvMoneyHidden ? '•••' : dataManager.calculateStudentArrears(child.id).toFixed(2)}</span>
                                    <button class="rv-eye-toggle" onclick="views.toggleMoneyVisibility()" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.6;padding:0;line-height:1;" title="${window._rvMoneyHidden ? 'Show amount' : 'Hide amount'}"><i class="fas ${window._rvMoneyHidden ? 'fa-eye-slash' : 'fa-eye'}" style="font-size:11px;"></i></button>
                                </p>
                            </div>
                            <div class="p-3 bg-slate-50 dark:bg-slate-700 rounded-xl">
                                <p class="text-sm text-slate-500">Status</p>
                                <p class="font-bold text-emerald-600">Active</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderParentFinance() {
        const parent = state.parents.find(p => p.profile_id === state.currentUser?.id);
        const myChildren = state.students.filter(s => parent?.children_ids?.includes(s.id));

        let totalDue = 0;
        myChildren.forEach(child => {
            totalDue += dataManager.calculateStudentArrears(child.id);
        });

        const myChildrenIds = myChildren.map(c => c.id);
        const paymentHistory = state.transactions.filter(t =>
            myChildrenIds.includes(t.student_id) &&
            t.type === 'payment'
        ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Filter fees relevant to this parent's children (global or matching child's class level)
        const childLevels = [...new Set(myChildren.map(c => c.class?.split(' - ')[0]).filter(Boolean))];
        const relevantFees = state.fees.filter(fee =>
            fee.scope === 'global' || childLevels.includes(fee.scope)
        );

        const html = `
            <h2 class="text-2xl font-bold text-slate-800 dark:text-white mb-6">Payments</h2>

            <!-- Summary stats -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                    <p class="text-sm text-slate-500 mb-1" style="display:flex;align-items:center;justify-content:space-between;">
                        Total Outstanding
                        <button class="rv-eye-toggle" onclick="views.toggleMoneyVisibility()" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px;line-height:1;" title="${window._rvMoneyHidden ? 'Show amounts' : 'Hide amounts'}"><i class="fas ${window._rvMoneyHidden ? 'fa-eye-slash' : 'fa-eye'}" style="font-size:13px;"></i></button>
                    </p>
                    <h3 class="text-3xl font-black text-red-600">₵<span class="rv-money-val" data-raw="${totalDue.toFixed(2)}">${window._rvMoneyHidden ? '•••' : totalDue.toFixed(2)}</span></h3>
                </div>
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                    <p class="text-sm text-slate-500 mb-1">Published Fee Items</p>
                    <h3 class="text-3xl font-black text-blue-600">${relevantFees.length}</h3>
                </div>
                <div class="glass-panel p-6 rounded-2xl bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                    <p class="text-sm text-slate-500 mb-1">Payments Made</p>
                    <h3 class="text-3xl font-black text-emerald-600">${paymentHistory.filter(t => t.status === 'confirmed').length}</h3>
                </div>
            </div>

            <!-- Fee structure published by admin -->
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                    <i class="fas fa-list mr-2 text-blue-500"></i>School Fee Structure
                </h3>
                ${relevantFees.length === 0
                    ? '<p class="text-slate-500 text-center py-4">No fees published by admin yet.</p>'
                    : `<div class="space-y-3">
                        ${relevantFees.map(fee => `
                            <div class="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                                <div>
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(fee.description)}</p>
                                    <p class="text-xs text-slate-500">${fee.scope === 'global' ? 'All Students' : fee.scope} • Posted ${new Date(fee.created_at).toLocaleDateString()}</p>
                                </div>
                                <span class="text-lg font-black text-blue-600 dark:text-blue-400">₵<span class="rv-money-val" data-raw="${fee.amount}">${window._rvMoneyHidden ? '•••' : fee.amount}</span></span>
                            </div>
                        `).join('')}
                    </div>`
                }
            </div>

            <!-- Payment form + history -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                        <i class="fas fa-credit-card mr-2 text-ridge-500"></i>Make Payment
                    </h3>
                    ${myChildren.length === 0
                        ? '<p class="text-slate-500 text-center py-4">No children linked to your account yet.</p>'
                        : `<div class="space-y-4">
                            <select id="payment-child" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-blue-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                                ${myChildren.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                            </select>
                            <input type="number" id="payment-amount" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Amount (₵)">
                            <select id="payment-method" onchange="actions.toggleProofUpload()" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                                <option value="cash">Cash (Pay at School)</option>
                                <option value="momo">Mobile Money</option>
                            </select>
                            <div id="proof-upload-container" class="hidden">
                                <label class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Upload Payment Proof (Screenshot)</label>
                                <input type="file" id="payment-proof" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" accept="image/*">
                            </div>
                            <button onclick="actions.makePayment()" class="w-full py-4 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-credit-card mr-2"></i> Submit Payment
                            </button>
                        </div>`
                    }
                </div>

                <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                        <i class="fas fa-history mr-2 text-ridge-500"></i>Payment History
                    </h3>
                    <div class="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                        ${paymentHistory.length === 0
                            ? '<p class="text-slate-500 text-center py-4">No payment history found</p>'
                            : paymentHistory.map(t => {
                                const student = state.students.find(s => s.id === t.student_id);
                                const statusColors = {
                                    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                                    confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                                    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                };
                                return `
                                    <div class="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600">
                                        <div class="flex items-start justify-between mb-2">
                                            <div>
                                                <p class="font-bold text-slate-800 dark:text-white">${escapeHtml(student?.name || 'Unknown')}</p>
                                                <p class="text-sm text-slate-500">₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span> • ${t.method === 'momo' ? 'Mobile Money' : 'Cash'}</p>
                                                <p class="text-xs text-slate-400">${new Date(t.created_at).toLocaleDateString()}</p>
                                            </div>
                                            <span class="px-2 py-1 rounded-full text-xs font-bold ${statusColors[t.status] || 'bg-slate-100 text-slate-700'}">
                                                ${t.status === 'confirmed' ? 'Approved' : t.status === 'pending' ? 'Pending' : 'Rejected'}
                                            </span>
                                        </div>
                                        ${t.status === 'confirmed' ? `
                                            <button onclick="actions.downloadReceipt('${t.id}')" class="w-full mt-2 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all flex items-center justify-center gap-2">
                                                <i class="fas fa-download"></i> Download Receipt
                                            </button>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    renderParentReports() {
        const parent = state.parents.find(p => p.profile_id === state.currentUser?.id);
        const myChildrenIds = parent?.children_ids || [];
        
        const myChildrenReports = state.reports.filter(r => 
            myChildrenIds.includes(r.student_id) && 
            r.status === 'published'
        );

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Academic Reports</h2>
                <span class="px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 rounded-full text-sm font-bold">
                    ${myChildrenReports.length} Reports Available
                </span>
            </div>
            
            <div class="grid gap-4">
                ${myChildrenReports.length === 0 ? '<p class="text-center py-8 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">No published reports available yet</p>' : myChildrenReports.map(report => {
                    const student = state.students.find(s => s.id === report.student_id);
                    const teacher = state.teachers.find(t => t.profile_id === report.teacher_id);
                    
                    return `
                        <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border-l-4 border-emerald-500 hover:shadow-xl transition-shadow">
                            <div class="flex items-start justify-between mb-4">
                                <div>
                                    <h3 class="font-bold text-lg text-slate-800 dark:text-white">${escapeHtml(student?.name || 'Unknown Student')}</h3>
                                    <p class="text-sm text-slate-500 mb-2">${student?.class || ''} • ${escapeHtml(report.title || 'Academic Report')}</p>
                                    <p class="text-xs text-slate-400">
                                        <i class="fas fa-chalkboard-teacher mr-1"></i> Teacher: ${escapeHtml(teacher?.full_name || 'Unknown')}<br>
                                        <i class="fas fa-calendar mr-1"></i> Published: ${new Date(report.published_at || report.updated_at).toLocaleDateString()}
                                    </p>
                                </div>
                                <div class="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                                    <i class="fas fa-file-alt text-xl text-emerald-600"></i>
                                </div>
                            </div>
                            
                            <a href="${report.file_url}" target="_blank" class="w-full block text-center px-4 py-3 bg-ridge-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-eye mr-2"></i> View Report
                            </a>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    },

    // ── Money visibility toggle ────────────────────────────────────────────────────
    // Flips window._rvMoneyHidden and updates all .rv-money-val spans on the page.
    // Eye icon buttons (.rv-eye-toggle i) are also updated to match state.
    toggleMoneyVisibility() {
        window._rvMoneyHidden = !window._rvMoneyHidden;
        const hidden = window._rvMoneyHidden;

        // Update all displayed money spans
        document.querySelectorAll('.rv-money-val').forEach(el => {
            el.textContent = hidden ? '•••' : (el.dataset.raw || el.textContent);
        });

        // Update all eye icon buttons
        document.querySelectorAll('.rv-eye-toggle').forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) icon.className = `fas ${hidden ? 'fa-eye-slash' : 'fa-eye'}`;
            btn.title = hidden ? 'Show amounts' : 'Hide amounts';
        });
    }
};

// ==================== ACTIONS ====================
const actions = {
    async refreshData() {
        app.showLoading('Refreshing data...');
        try {
            await app.loadInitialData();
            ui.route(state.currentView);
            ui.showToast('Data refreshed successfully', 'success');
        } catch (err) {
            ui.showToast('Failed to refresh: ' + extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async addAcademicYear() {
        const year = document.getElementById('year-input')?.value;
        if (!year) return modal.alert('Validation Error', 'Please enter a year', 'warning');

        try {
            app.showLoading('Adding academic year...');
            const { error } = await supabaseClient.from('academic_years').insert([{
                year,
                active: false,
                terms: []
            }]);

            if (error) throw error;
            
            ui.showToast('Academic year added', 'success');
            await dataManager.loadAcademicYears();
            ui.route('academic');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async addTermPrompt(yearId) {
        const year = state.academicYears.find(y => y.id === yearId);
        if (!year) return;

        modal.selectTerm('Select Term to Add', [
            { id: 'Term 1', name: 'Term 1' },
            { id: 'Term 2', name: 'Term 2' },
            { id: 'Term 3', name: 'Term 3' },
            { id: 'First Term', name: 'First Term' },
            { id: 'Second Term', name: 'Second Term' },
            { id: 'Third Term', name: 'Third Term' }
        ], async (termName) => {
            if (!termName) return;
            try {
                app.showLoading('Adding term...');
                const terms = [...(year.terms || []), { id: Date.now().toString(), name: termName, active: false }];

                const { error } = await supabaseClient
                    .from('academic_years')
                    .update({ terms })
                    .eq('id', yearId);

                if (error) throw error;
                
                ui.showToast('Term added', 'success');
                await dataManager.loadAcademicYears();
                ui.route('academic');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async activateYear(yearId) {
        try {
            app.showLoading('Activating year...');
            
            await supabaseClient.from('academic_years').update({ active: false }).neq('id', 0);
            await supabaseClient.from('academic_years').update({ active: true }).eq('id', yearId);
            
            await dataManager.loadAcademicYears();
            ui.route('academic');
            ui.updatePeriodDisplay();
            ui.showToast('Academic year activated - System ready for new entries', 'success');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async activateTerm(yearId, termId) {
        try {
            app.showLoading('Activating term...');
            const year = state.academicYears.find(y => y.id === yearId);
            const terms = year.terms.map(t => ({ ...t, active: t.id === termId }));
            
            await supabaseClient.from('academic_years').update({ terms }).eq('id', yearId);
            await dataManager.loadAcademicYears();
            ui.route('academic');
            ui.updatePeriodDisplay();
            ui.showToast('Term activated - System ready for new entries', 'success');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    updateTermOptions() {
        // Delegated to Academic Report Generator module
        academicReportGenerator.onYearChange();
    },

    async addClass() {
        const level = document.getElementById('class-level')?.value;
        const grade = document.getElementById('class-grade')?.value;
        
        if (!level || !grade) return modal.alert('Validation Error', 'Please fill all fields', 'warning');

        // Normalise a class string the same way migrateStudentClassIds does —
        // trim outer whitespace, collapse runs of spaces, normalise " - " separators,
        // and lowercase.  This ensures "primary - Grade 4", "Primary-Grade 4", and
        // "PRIMARY  -  grade 4" all resolve to the same key, preventing duplicates
        // and ensuring the UUID of the original deleted row is always reused.
        const inputKey = normalizeClassName(`${level} - ${grade}`);

        try {
            app.showLoading('Creating class...');

            // Fetch ALL soft-deleted classes and match client-side using the
            // same normalised key.  A server-side .eq() on level+grade is
            // case-sensitive and would miss capitalisation or spacing differences,
            // which is the root cause of the duplicate-UUID bug this patch fixes.
            const { data: deletedClasses, error: lookupError } = await supabaseClient
                .from('classes')
                .select('*')
                .eq('is_deleted', true);

            if (lookupError) throw lookupError;

            // Find any deleted class whose normalised level+grade matches the input
            const match = (deletedClasses || []).find(
                c => normalizeClassName(`${c.level} - ${c.grade}`) === inputKey
            );

            if (match) {
                // ── RESTORE PATH ──────────────────────────────────────────────
                // A previously deleted class with the same name exists.
                // Undelete it in-place so its UUID is preserved.  Every student,
                // teacher assignment, attendance record, and report that holds a
                // foreign-key reference to match.id will automatically reconnect
                // without any data migration — the UUID never changed.
                const { error: restoreError } = await supabaseClient
                    .from('classes')
                    .update({ is_deleted: false })
                    .eq('id', match.id);

                if (restoreError) throw restoreError;

                // Reload classes first so the restored UUID is in state.classes
                // before loadStudents() builds its activeClassIds filter set.
                // This is the critical ordering that makes students reappear.
                await dataManager.loadClasses();
                await Promise.all([
                    dataManager.loadStudents(),
                    dataManager.loadTeachers(),
                    dataManager.loadReports(),
                    dataManager.loadReceivedReports(),
                ]);

                // Run the legacy backfill in case any restored students still
                // have only a class string and no class_id — this reconnects them.
                dataManager.migrateStudentClassIds().catch(() => {});

                ui.route('classes');
                ui.showToast('Class restored — all previous students and records are back!', 'success');
            } else {
                // ── CREATE PATH ───────────────────────────────────────────────
                // No matching deleted class found — insert a genuinely new row.
                // Store level and grade with their original casing so the display
                // matches what the admin typed, but the normalised key is what
                // drives all future match lookups.
                const { error } = await supabaseClient
                    .from('classes')
                    .insert([{ level: level.trim(), grade: grade.trim(), is_deleted: false }]);
                if (error) throw error;

                await dataManager.loadClasses();
                // Re-filter students so any legacy students whose class string
                // matches the new class become visible immediately.
                await dataManager.loadStudents();
                dataManager.migrateStudentClassIds().catch(() => {});

                ui.route('classes');
                ui.showToast('Class created successfully', 'success');
            }
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async editClass(id, currentLevel, currentGrade) {
        modal.prompt('Edit Class Level:', currentLevel, (level) => {
            if (!level) return;
            modal.prompt('Edit Class Grade:', currentGrade, async (grade) => {
                if (!grade) return;
                try {
                    app.showLoading('Updating class...');
                    const { error } = await supabaseClient.from('classes').update({ level, grade }).eq('id', id);
                    if (error) throw error;
                    await dataManager.loadClasses();
                    ui.route('classes');
                    ui.showToast('Class updated', 'success');
                } catch (err) {
                    modal.alert('Error', extractErrorMessage(err), 'error');
                } finally {
                    app.hideLoading();
                }
            });
        });
    },

    async deleteClass(id) {
        modal.createModal(
            'Delete Class',
            `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Are you sure you want to delete this class?</p>
            <div style="margin-top:12px;padding:12px 14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;display:flex;gap:10px;align-items:flex-start;">
                <i class="fas fa-info-circle" style="color:#f59e0b;margin-top:2px;flex-shrink:0;"></i>
                <p style="color:#fbbf24;font-size:13px;line-height:1.5;margin:0;">The class will be hidden from all dashboards. All students and their records are preserved. If you recreate this class later, all students will automatically be restored.</p>
            </div>`,
            async () => {
                try {
                    app.showLoading('Deleting...');
                    // Soft-delete only: mark as deleted, never physically remove from database.
                    // This preserves all foreign key relationships (students, attendance,
                    // reports, teacher assignments) so no constraint errors can occur.
                    const { error } = await supabaseClient
                        .from('classes')
                        .update({ is_deleted: true })
                        .eq('id', id);
                    if (error) throw error;
                    // Reload ALL data so every view (teacher dashboard, attendance,
                    // reports, student registry) reflects the deletion immediately.
                    await app.loadInitialData();
                    ui.route('classes');
                    ui.showToast('Class deleted — students and records are preserved', 'success');
                } catch (err) {
                    modal.alert('Error', extractErrorMessage(err), 'error');
                } finally {
                    app.hideLoading();
                }
            },
            () => {},
            'Delete',
            'Cancel',
            'warning'
        );
    },

    calculateAge() {
        const dob = document.getElementById('student-dob')?.value;
        if (dob) {
            const age = Math.floor((new Date() - new Date(dob)) / 31557600000);
            const ageInput = document.getElementById('student-age');
            if (ageInput) ageInput.value = age + ' years';
        }
    },

    async addStudent() {
        const admissionNumber = document.getElementById('student-admission')?.value?.trim();
        const name = document.getElementById('student-name')?.value?.trim();
        const gender = document.getElementById('student-gender')?.value;
        const dob = document.getElementById('student-dob')?.value;
        const age = document.getElementById('student-age')?.value;
        // The select now emits the class UUID as its value
        const classId = document.getElementById('student-class')?.value;
        const parentPhone = document.getElementById('student-parent-phone')?.value?.trim();

        if (!admissionNumber || !name || !dob || !classId) return modal.alert('Validation Error', 'Please fill in Admission Number, Name, Date of Birth, and Class', 'warning');

        // Resolve the class object so we can store both the UUID and the canonical string
        const classObj = state.classes.find(c => c.id === classId);
        if (!classObj) return modal.alert('Validation Error', 'Selected class not found. Please refresh and try again.', 'warning');

        // Build canonical "Level - Grade" string — never write a UUID into students.class
        const normalisedClass = buildClassName(classObj);
        assertNotUUID(normalisedClass, 'addStudent');

        try {
            app.showLoading('Registering student...');
            const { error } = await supabaseClient.from('students').insert([{
                admission_number: admissionNumber,
                name,
                gender: gender || null,
                dob,
                age,
                class: normalisedClass,
                class_id: classId,
                parent_phone: parentPhone || null
            }]);

            if (error) throw error;
            
            ui.showToast('Student registered', 'success');
            await dataManager.loadStudents();
            ui.route('students');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    // Class teacher: edit the basic details of a student in their own class.
    // The server (teacher_update_student) re-checks that the student is theirs.
    teacherEditStudent(id) {
        const student = state.students.find(s => s.id === id);
        if (!student) return;
        const modalId = 'teacher-edit-student-' + Date.now();
        const field = 'w-full px-4 py-3 rounded-xl input-field bg-white dark:bg-slate-900 text-slate-800 dark:text-white';
        const label = 'block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5';
        const sex = (student.gender || '').toLowerCase();
        const html = `
            <div id="${modalId}" class="fixed inset-0 z-[9999] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="${modalId}-title">
                <form id="${modalId}-form" class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl">
                    <div class="px-6 pt-6 pb-2">
                        <h3 id="${modalId}-title" class="text-lg font-bold text-slate-800 dark:text-white">Edit Student</h3>
                        <p class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(student.name || '')}</p>
                    </div>
                    <div class="px-6 py-4 space-y-4">
                        <div><label class="${label}" for="${modalId}-name">Full name</label>
                            <input id="${modalId}-name" class="${field}" value="${escapeHtml(student.name || '')}" required autocomplete="off"></div>
                        <div><label class="${label}" for="${modalId}-adm">Admission number</label>
                            <input id="${modalId}-adm" class="${field}" value="${escapeHtml(student.admission_number || '')}" autocomplete="off"></div>
                        <div class="grid grid-cols-2 gap-3">
                            <div><label class="${label}" for="${modalId}-sex">Sex</label>
                                <select id="${modalId}-sex" class="${field}">
                                    <option value="">Select</option>
                                    <option value="Male" ${sex === 'male' ? 'selected' : ''}>Male</option>
                                    <option value="Female" ${sex === 'female' ? 'selected' : ''}>Female</option>
                                </select></div>
                            <div><label class="${label}" for="${modalId}-age">Age</label>
                                <input id="${modalId}-age" class="${field}" value="${escapeHtml(student.age || '')}" autocomplete="off"></div>
                        </div>
                        <div><label class="${label}" for="${modalId}-dob">Date of birth</label>
                            <input id="${modalId}-dob" type="date" class="${field}" value="${escapeHtml(student.dob || '')}"></div>
                    </div>
                    <div class="px-6 pb-6 flex gap-3">
                        <button type="button" id="${modalId}-cancel" class="flex-1 py-3 rounded-xl border border-slate-300 dark:border-neutral-700 font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
                        <button type="submit" class="flex-[2] py-3 rounded-xl bg-ridge-600 hover:bg-ridge-700 text-white font-semibold"><i class="fas fa-save mr-2"></i>Save Changes</button>
                    </div>
                </form>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);
        const $ = suffix => document.getElementById(`${modalId}-${suffix}`);
        const close = () => modalEl.remove();
        $('cancel').onclick = close;
        modalEl.addEventListener('click', e => { if (e.target === modalEl) close(); });
        $('dob').addEventListener('change', () => {
            const d = $('dob').value;
            if (d) $('age').value = Math.floor((Date.now() - new Date(d)) / 31557600000) + ' years';
        });
        $('name').focus();
        $('form').onsubmit = async (e) => {
            e.preventDefault();
            const name = $('name').value.trim();
            if (!name) { ui.showToast('Name is required', 'warning'); return; }
            try {
                app.showLoading('Saving student...');
                const { error } = await supabaseClient.rpc('teacher_update_student', {
                    p_student_id: id,
                    p_name: name,
                    p_admission_number: $('adm').value.trim(),
                    p_gender: $('sex').value,
                    p_age: $('age').value.trim(),
                    p_dob: $('dob').value
                });
                if (error) throw error;
                close();
                await dataManager.loadStudents();
                ui.route('teacher_students');
                ui.showToast('Student updated', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        };
    },

    async editStudent(id) {
        const student = state.students.find(s => s.id === id);
        if (!student) return;

        const modalId = 'edit-student-modal-' + Date.now();
        // Use class UUID as the option value; pre-select by matching student.class_id first,
        // then fall back to matching the class string for legacy records
        const classOptions = state.classes.map(c => {
            const classString = buildClassName(c);
            const isSelected = student.class_id
                ? student.class_id === c.id
                : normalizeClassName(student.class) === normalizeClassName(classString);
            return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${classString}</option>`;
        }).join('');

        const html = `
            <div id="${modalId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:16px;overflow-y:auto;">
                <div style="width:100%;max-width:480px;background:#1e293b;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);margin:auto;flex-shrink:0;">
                    <div style="background:#16295a;padding:20px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:1;">
                        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-user-edit" style="color:#fff;font-size:18px;"></i>
                        </div>
                        <div style="color:#fff;font-size:16px;font-weight:700;">Edit Student</div>
                    </div>
                    <div style="padding:24px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;max-height:calc(85vh - 90px);">
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Admission Number</label>
                            <input type="text" id="${modalId}-admission" value="${escapeHtml(student.admission_number || '')}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Admission Number">
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Full Name</label>
                            <input type="text" id="${modalId}-name" value="${escapeHtml(student.name || '')}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Full Name">
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Gender</label>
                            <select id="${modalId}-gender" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;">
                                <option value="">Select Gender</option>
                                <option value="Male" ${student.gender === 'Male' ? 'selected' : ''}>Male</option>
                                <option value="Female" ${student.gender === 'Female' ? 'selected' : ''}>Female</option>
                                <option value="Other" ${student.gender === 'Other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Date of Birth</label>
                            <input type="date" id="${modalId}-dob" value="${student.dob || ''}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" onchange="(function(){const d=document.getElementById('${modalId}-dob').value;if(d){const age=Math.floor((new Date()-new Date(d))/31557600000);document.getElementById('${modalId}-age').value=age+' years';}})()">
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Age (auto-calculated)</label>
                            <input type="text" id="${modalId}-age" value="${student.age || ''}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #1e293b;background:#0f172a;color:#64748b;font-size:14px;outline:none;" readonly>
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Class</label>
                            <select id="${modalId}-class" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;">
                                <option value="">Select Class</option>
                                ${classOptions}
                            </select>
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Parent Phone Number</label>
                            <input type="tel" id="${modalId}-phone" value="${escapeHtml(student.parent_phone || '')}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Parent Phone Number">
                        </div>
                        <div style="display:flex;gap:10px;margin-top:6px;">
                            <button id="${modalId}-cancel" style="flex:1;padding:11px 20px;border-radius:10px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;font-size:14px;cursor:pointer;">Cancel</button>
                            <button id="${modalId}-save" style="flex:2;padding:11px 20px;border-radius:10px;background:#16295a;color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none;"><i class="fas fa-save" style="margin-right:8px;"></i>Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);

        document.getElementById(`${modalId}-cancel`).onclick = () => modalEl.remove();
        document.getElementById(`${modalId}-save`).onclick = async () => {
            const admissionNumber = document.getElementById(`${modalId}-admission`)?.value?.trim();
            const name = document.getElementById(`${modalId}-name`)?.value?.trim();
            const gender = document.getElementById(`${modalId}-gender`)?.value;
            const dob = document.getElementById(`${modalId}-dob`)?.value;
            const age = document.getElementById(`${modalId}-age`)?.value;
            // Select emits UUID
            const classId = document.getElementById(`${modalId}-class`)?.value;
            const parentPhone = document.getElementById(`${modalId}-phone`)?.value?.trim();

            if (!name || !classId) {
                ui.showToast('Name and class are required', 'warning');
                return;
            }

            // Resolve class object to get canonical string — never write UUID into students.class
            const classObj = state.classes.find(c => c.id === classId);
            if (!classObj) {
                ui.showToast('Selected class could not be resolved. Please refresh and try again.', 'warning');
                return;
            }
            const normalisedClass = buildClassName(classObj);
            assertNotUUID(normalisedClass, 'editStudent');

            try {
                modalEl.remove();
                app.showLoading('Updating student...');
                const { error } = await supabaseClient.from('students').update({
                    admission_number: admissionNumber || null,
                    name,
                    gender: gender || null,
                    dob: dob || null,
                    age: age || null,
                    class: normalisedClass,
                    class_id: classId,
                    parent_phone: parentPhone || null
                }).eq('id', id);
                if (error) throw error;
                await dataManager.loadStudents();
                ui.route('students');
                ui.showToast('Student updated', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        };
        modalEl.addEventListener('click', e => { if (e.target === modalEl) modalEl.remove(); });
    },

    async deleteStudent(id) {
        modal.confirmDelete('this student', async () => {
            try {
                app.showLoading('Deleting...');
                const { error } = await supabaseClient.from('students').delete().eq('id', id);
                if (error) throw error;
                await dataManager.loadStudents();
                ui.route('students');
                ui.showToast('Student deleted', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async handleBulkUpload(input) {
        const file = input.files[0];
        if (!file) return;

        if (typeof XLSX === 'undefined') {
            modal.alert('Error', 'Excel processing library not loaded', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                app.showLoading('Processing file...');
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                let added = 0;
                for (const row of json) {
                    if (row.Name && row.Class && row.DOB) {
                        const age = Math.floor((new Date() - new Date(row.DOB)) / 31557600000);
                        // Normalise the spreadsheet class string using the global helper
                        const normalisedClass = normalizeClassName(row.Class || '');
                        // Try to match to a known class to get the UUID
                        const classObj = state.classes.find(c => {
                            const canonical = buildClassName(c);
                            return normalizeClassName(canonical) === normalizeClassName(normalisedClass);
                        });
                        // Always write the canonical class name — never a UUID
                        const finalClassName = classObj ? buildClassName(classObj) : normalisedClass;
                        assertNotUUID(finalClassName, 'handleBulkUpload');
                        await supabaseClient.from('students').insert([{
                            name: row.Name,
                            class: finalClassName,
                            class_id: classObj ? classObj.id : null,
                            dob: row.DOB,
                            age: age + ' years'
                        }]);
                        added++;
                    }
                }

                ui.showToast(`Imported ${added} students`, 'success');
                await dataManager.loadStudents();
                ui.route('students');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        };
        reader.readAsArrayBuffer(file);
    },

    async assignTeacher(profileId, classId) {
        try {
            if (!profileId || profileId === 'null') {
                modal.alert('Error', 'Invalid teacher record. Please refresh the page and try again.', 'error');
                return;
            }

            // Find the teacher's row in the teachers table via profile_id
            const teacher = state.teachers.find(t => t.profile_id === profileId);

            // If no teachers row exists yet, create one first
            if (!teacher?.id) {
                const { data: inserted, error: insertErr } = await supabaseClient
                    .from('teachers')
                    .insert([{ profile_id: profileId, email: teacher?.email || '', full_name: teacher?.full_name || '', assigned_class: null }])
                    .select()
                    .single();
                if (insertErr) throw insertErr;
                teacher.id = inserted.id;
            }

            const teachersRowId = teacher.id;

            if (classId) {
                // Unassign any other teacher currently holding this class UUID
                // so no two teacher rows ever share the same assigned_class.
                const { data: existing } = await supabaseClient
                    .from('teachers')
                    .select('id')
                    .eq('assigned_class', classId)
                    .neq('id', teachersRowId);

                if (existing && existing.length > 0) {
                    const { error: clearErr } = await supabaseClient
                        .from('teachers')
                        .update({ assigned_class: null })
                        .in('id', existing.map(r => r.id));
                    if (clearErr) throw clearErr;
                }
            }

            app.showLoading('Updating assignment...');
            const { error } = await supabaseClient
                .from('teachers')
                .update({ assigned_class: classId || null })
                .eq('id', teachersRowId);

            if (error) throw error;

            ui.showToast('Assignment updated', 'success');
            // FIX 7: Load classes first, then teachers and students so the
            // active-class filter in loadStudents has fresh data.
            await dataManager.loadClasses();
            await Promise.all([
                dataManager.loadTeachers(),
                dataManager.loadStudents()
            ]);
            ui.route('teachers');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async deleteTeacher(profileId, name) {
        const teacher = state.teachers.find(t => t.profile_id === profileId);
        modal.confirmDelete(name || 'this teacher', async () => {
            try {
                app.showLoading('Deleting...');
                // Delete from teachers table if a row exists
                if (teacher?.id) {
                    const { error } = await supabaseClient.from('teachers').delete().eq('id', teacher.id);
                    if (error) throw error;
                }
                // Always delete from profiles table to fully remove the account
                if (profileId) {
                    await supabaseClient.from('profiles').delete().eq('id', profileId);
                }
                await dataManager.loadTeachers();
                ui.route('teachers');
                ui.showToast('Teacher removed', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async editParentChildren(parentId) {
        const parent = state.parents.find(p => p.id === parentId);
        const currentChildren = parent?.children_ids?.join(',') || '';
        
        modal.prompt('Enter student IDs (comma-separated):', currentChildren, async (input) => {
            if (input === null) return;
            try {
                app.showLoading('Updating...');
                const childrenIds = input.split(',').map(s => s.trim()).filter(Boolean);
                
                for (const childId of childrenIds) {
                    const { data: existing } = await supabaseClient
                        .from('parents')
                        .select('*')
                        .contains('children_ids', [childId])
                        .neq('id', parentId);
                    
                    if (existing && existing.length > 0) {
                        modal.alert('Link Error', `Student ${childId} is already linked to another parent`, 'warning');
                        return;
                    }
                }

                const { error } = await supabaseClient
                    .from('parents')
                    .update({ children_ids: childrenIds })
                    .eq('id', parentId);

                if (error) throw error;
                
                // Notify parent their linked children changed
                const pForNotif = state.parents.find(p => p.id === parentId);
                if (pForNotif?.profile_id) {
                    await supabaseClient.from('notifications').insert([{
                        user_id: pForNotif.profile_id,
                        title: 'Linked Children Updated',
                        message: 'Your linked student(s) have been updated by the administrator. Please review your account.',
                        type: 'system',
                        read: false,
                        created_by: state.currentUser?.id,
                        created_at: new Date().toISOString()
                    }]);
                }
                ui.showToast('Children updated', 'success');
                await dataManager.loadParents();
                ui.route('parents');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async deleteParent(id, name) {
        const parent = state.parents.find(p => p.id === id);
        modal.confirmDelete(name || 'this parent', async () => {
            try {
                app.showLoading('Deleting...');
                // Delete from parents table
                const { error } = await supabaseClient.from('parents').delete().eq('id', id);
                if (error) throw error;
                // Also delete from profiles table
                if (parent?.profile_id) {
                    await supabaseClient.from('profiles').delete().eq('id', parent.profile_id);
                }
                await dataManager.loadParents();
                ui.route('parents');
                ui.showToast('Parent removed', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async searchAndLinkChild() {
        // Parents can only read their approved children, so the search runs
        // server-side and the link waits for an administrator's approval.
        modal.prompt("Enter at least 3 letters of your child's name:", '', async (query) => {
            if (query === null) return;
            try {
                app.showLoading('Searching...');
                const { data: matches, error } = await supabaseClient
                    .rpc('search_students_for_link', { p_query: query });
                if (error) throw error;
                app.hideLoading();
                if (!matches || matches.length === 0) {
                    modal.alert('No Match', 'No student found with that name. Check the spelling or contact the school.', 'info');
                    return;
                }
                const currentParent = state.parents.find(p => p.profile_id === state.currentUser?.id);
                const taken = new Set([...(currentParent?.children_ids || []), ...(currentParent?.pending_children_ids || [])]);
                const options = matches.map(m => ({ ...m, disabled: taken.has(m.id) }));

                modal.selectStudent('Select your child', options, async (studentId, studentName) => {
                    try {
                        app.showLoading('Sending request...');
                        const { error: linkError } = await supabaseClient
                            .rpc('request_child_link', { p_student_id: studentId });
                        if (linkError) throw linkError;
                        modal.alert('Request Sent', `Your request to link ${studentName} has been sent. An administrator will review it shortly.`, 'success');
                        await dataManager.loadParents();
                        ui.route('parent_children');
                    } catch (err) {
                        modal.alert('Error', extractErrorMessage(err), 'error');
                    } finally {
                        app.hideLoading();
                    }
                });
            } catch (err) {
                app.hideLoading();
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    },

    async unlinkChild(studentId) {
        if (state.role !== 'admin') {
            modal.alert('Permission Denied', 'Only administrators can remove child links. Please contact admin.', 'warning');
            return;
        }
        
        modal.confirmDelete('this child link', async () => {
            try {
                app.showLoading('Removing link...');
                const currentParent = state.parents.find(p => p.profile_id === state.currentUser?.id);
                const newIds = (currentParent?.children_ids || []).filter(id => id !== studentId);
                
                const { error } = await supabaseClient
                    .from('parents')
                    .update({ children_ids: newIds })
                    .eq('id', currentParent.id);
                
                if (error) throw error;
                
                ui.showToast('Child unlinked successfully', 'success');
                await dataManager.loadParents();
                ui.route('parent_children');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async addFee() {
        const scope = document.getElementById('fee-scope')?.value;
        const amount = document.getElementById('fee-amount')?.value;
        const desc = document.getElementById('fee-desc')?.value;

        if (!amount || !desc) return modal.alert('Validation Error', 'Please fill all fields', 'warning');
        if (parseMoneyAmount(amount) === null) return modal.alert('Validation Error', 'Please enter an amount greater than zero', 'warning');

        try {
            app.showLoading('Adding fee...');
            const { error } = await supabaseClient.from('fees').insert([{
                scope,
                amount: parseMoneyAmount(amount),
                description: desc,
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id,
                created_by: state.currentUser?.id,
                created_at: new Date().toISOString()
            }]);

            if (error) throw error;
            
            // Notify all parents about new fee
            await notificationManager.notifyParents('New Fee Published', `A new fee item has been published: ${desc} — ₵${amount}. Please review the payments section.`, 'fee_added');
            ui.showToast('Fee structure added', 'success');
            await dataManager.loadFees();
            ui.route('finance');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async deleteFee(id) {
        modal.confirmDelete('this fee', async () => {
            try {
                app.showLoading('Deleting...');
                const { error } = await supabaseClient.from('fees').delete().eq('id', id);
                if (error) throw error;
                await dataManager.loadFees();
                ui.route('finance');
                ui.showToast('Fee deleted', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async approveTransaction(id) {
        try {
            app.showLoading('Approving...');
            
            const { error } = await supabaseClient
                .from('transactions')
                .update({ status: 'confirmed', verified_by: state.currentUser?.id })
                .eq('id', id);

            if (error) throw error;
            
            // Notify the parent whose payment was approved
            const txn = state.transactions.find(t => t.id === id);
            if (txn?.student_id) {
                const student = state.students.find(s => s.id === txn.student_id);
                await notificationManager.notifyParentsOfStudent(txn.student_id, 'Payment Approved', `Your payment of ₵${txn?.amount || ''} for ${student?.name || 'your child'} has been approved and confirmed.`, 'payment');
            }
            ui.showToast('Payment approved', 'success');
            await dataManager.loadTransactions();
            ui.route('finance');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async rejectTransaction(id) {
        try {
            app.showLoading('Rejecting...');
            
            const { error } = await supabaseClient
                .from('transactions')
                .update({ status: 'rejected' })
                .eq('id', id);

            if (error) throw error;
            
            // Notify parent of rejection
            const txnR = state.transactions.find(t => t.id === id);
            if (txnR?.student_id) {
                const studentR = state.students.find(s => s.id === txnR.student_id);
                await notificationManager.notifyParentsOfStudent(txnR.student_id, 'Payment Rejected', `Your payment of ₵${txnR?.amount || ''} for ${studentR?.name || 'your child'} was not approved. Please contact the school for details.`, 'payment');
            }
            ui.showToast('Payment rejected', 'success');
            await dataManager.loadTransactions();
            ui.route('finance');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async deleteTransaction(id) {
        modal.confirmDelete('this transaction', async () => {
            try {
                app.showLoading('Deleting...');
                const { error } = await supabaseClient.from('transactions').delete().eq('id', id);
                if (error) throw error;
                await dataManager.loadTransactions();
                ui.route('finance');
                ui.showToast('Transaction deleted', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },


    async uploadStudentReport(studentId, studentName, fileInput) {
        const file = fileInput?.files[0];
        if (!file) return;

        // Reset the file input immediately so the same button can be used
        // again on a retry without needing to re-render the section first.
        try { fileInput.value = ''; } catch(e) {}

        // Validate file type
        const allowed = ['pdf', 'doc', 'docx'];
        const ext = file.name.split('.').pop().toLowerCase();
        if (!allowed.includes(ext)) {
            return modal.alert('Invalid File', 'Please upload a PDF or Word document (.pdf, .doc, .docx)', 'warning');
        }

        try {
            app.showLoading(`Uploading report for ${studentName}...`);

            const fileName = `admin_${state.currentAY?.id || 'ay'}_${state.currentTerm?.id || 't'}_${studentId}_${Date.now()}.${ext}`;
            const filePath = `admin_reports/${fileName}`;

            // Upload file to Supabase storage
            const { error: uploadError } = await supabaseClient.storage
                .from('reports')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabaseClient.storage
                .from('reports')
                .getPublicUrl(filePath);

            // Resolve the student record for class info
            const student = state.students.find(s => s.id === studentId);

            // Insert report record — published immediately, visible to parents
            const { error: insertError } = await supabaseClient.from('reports').insert([{
                student_id: studentId,
                student_name: studentName,
                uploaded_by: state.currentUser?.id,
                title: `${state.currentTerm?.name || 'Term'} Report — ${studentName}`,
                file_url: publicUrl,
                file_name: file.name,
                class: student?.class || '',
                status: 'published',
                published_at: new Date().toISOString(),
                published_by: state.currentUser?.id,
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id,
                created_at: new Date().toISOString()
            }]);

            if (insertError) throw insertError;

            // Notify parent that the report is now available
            await notificationManager.notifyParentsOfStudent(
                studentId,
                'Report Available',
                `The ${state.currentTerm?.name || 'term'} report for ${studentName} has been uploaded and is now available for viewing.`,
                'report_uploaded'
            );

            ui.showToast(`Report uploaded and published for ${studentName}`, 'success');

        } catch (err) {
            modal.alert('Upload Failed', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
            // Always reload reports and re-render so the button is live again
            // whether the upload succeeded or failed — fixes the "broken after
            // first failure" bug without needing to navigate away.
            await dataManager.loadReports();
            views.renderAdminUploadReports();
        }
    },

    async viewReportForPublishing(reportId) {
        const report = state.reports.find(r => r.id === reportId);
        if (!report) return;

        modal.previewReport(
            `Review Report: ${report.title || 'Student Report'}`,
            report.file_url,
            () => actions.publishReport(reportId),
            () => actions.notifyAdminAboutReport(reportId)
        );
    },

    async publishReport(reportId) {
        try {
            app.showLoading('Publishing report...');
            const { error } = await supabaseClient
                .from('reports')
                .update({ 
                    status: 'published',
                    published_at: new Date().toISOString(),
                    published_by: state.currentUser?.id
                })
                .eq('id', reportId);

            if (error) throw error;
            
            ui.showToast('Report published successfully! Parents can now view it.', 'success');
            await dataManager.loadReports();
            ui.route('teacher_publish_reports');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async notifyAdminAboutReport(reportId) {
        const report = state.reports.find(r => r.id === reportId);
        
        try {
            app.showLoading('Sending notification...');
            
            const { error: notifError } = await supabaseClient.from('notifications').insert([{
                user_id: report.uploaded_by,
                title: 'Report Correction Needed',
                message: `Teacher ${state.currentUser?.full_name} has indicated that the report uploaded for student requires correction. Please review and re-upload.`,
                type: 'report_correction',
                report_id: reportId,
                read: false,
                created_at: new Date().toISOString()
            }]);

            if (notifError) throw notifError;
            
            await supabaseClient
                .from('reports')
                .update({ status: 'rejected', rejected_at: new Date().toISOString() })
                .eq('id', reportId);
            
            ui.showToast('Admin notified successfully', 'success');
            await dataManager.loadReports();
            ui.route('teacher_publish_reports');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async deleteReport(reportId) {
        modal.confirmDelete('this report', async () => {
            try {
                app.showLoading('Deleting...');
                const { error } = await supabaseClient.from('reports').delete().eq('id', reportId);
                if (error) throw error;
                // Notify parent report was removed
                const delRep = state.reports.find(r => r.id === reportId);
                if (delRep?.student_id) {
                    await notificationManager.notifyParentsOfStudent(delRep.student_id, 'Report Removed', `The report for ${delRep.student_name || 'your child'} has been removed by the administrator.`, 'report_uploaded');
                }
                await dataManager.loadReports();
                ui.route('admin_upload_reports');
                ui.showToast('Report deleted', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async undoStudentReport(reportId, studentName) {
        modal.confirmAction(
            'Undo Report Upload',
            `This will remove the report for <strong>${escapeHtml(studentName)}</strong> from their parent's dashboard. The file will be deleted and you can re-upload a new one. Continue?`,
            async () => {
                try {
                    app.showLoading('Undoing report...');

                    // Capture report record BEFORE deleting so we have file_url and student_id
                    const report = state.reports.find(r => r.id === reportId);

                    // Delete the DB record
                    const { error } = await supabaseClient
                        .from('reports')
                        .delete()
                        .eq('id', reportId);

                    if (error) throw error;

                    // Delete the file from storage (non-critical if it fails)
                    if (report?.file_url) {
                        try {
                            const url = new URL(report.file_url);
                            const pathParts = url.pathname.split('/object/public/reports/');
                            if (pathParts.length > 1) {
                                await supabaseClient.storage
                                    .from('reports')
                                    .remove([decodeURIComponent(pathParts[1])]);
                            }
                        } catch (storageErr) {
                            console.warn('Storage file delete failed (non-critical):', storageErr);
                        }
                    }

                    // Notify parent — use the record captured before deletion
                    if (report?.student_id) {
                        await notificationManager.notifyParentsOfStudent(
                            report.student_id,
                            'Report Removed',
                            `The report for ${studentName} has been removed by the administrator and is no longer available.`,
                            'report_uploaded'
                        );
                    }

                    ui.showToast(`Report for ${studentName} has been removed from parent's dashboard`, 'success');
                    await dataManager.loadReports();
                    views.renderAdminUploadReports();
                } catch (err) {
                    modal.alert('Error', extractErrorMessage(err), 'error');
                } finally {
                    app.hideLoading();
                }
            },
            'warning'
        );
    },

    async approveAdmin(profileId) {
        try {
            app.showLoading('Approving...');
            const { error } = await supabaseClient
                .from('profiles')
                .update({ approved: true })
                .eq('id', profileId);

            if (error) throw error;
            
            ui.showToast('Admin approved successfully', 'success');
            await dataManager.loadPendingAdmins();
            ui.route('approvals');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async rejectAdmin(profileId) {
        try {
            app.showLoading('Rejecting...');
            // profiles has no "rejected" column — remove the pending profile instead
            // (same as deleteTeacher). Without a profile the account cannot log in.
            const { data: removed, error } = await supabaseClient
                .from('profiles')
                .delete()
                .eq('id', profileId)
                .eq('role', 'admin')
                .eq('approved', false)
                .select('id');

            if (error) throw error;
            if (!removed || removed.length === 0) {
                throw new Error('The request could not be removed. Check that your account has permission to delete profiles.');
            }
            
            ui.showToast('Admin request rejected', 'success');
            await dataManager.loadPendingAdmins();
            ui.route('approvals');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async approveTeacher(profileId) {
        try {
            app.showLoading('Approving...');
            const { error } = await supabaseClient
                .from('profiles')
                .update({ approved: true })
                .eq('id', profileId)
                .eq('role', 'teacher');
            if (error) throw error;
            await supabaseClient.from('notifications').insert([{
                user_id: profileId,
                title: 'Account Approved',
                message: 'Your teacher account has been approved. You can now sign in.',
                type: 'system',
                read: false,
                created_by: state.currentUser?.id
            }]);
            ui.showToast('Teacher approved', 'success');
            await Promise.all([dataManager.loadPendingAdmins(), dataManager.loadTeachers()]);
            ui.route('approvals');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async rejectTeacher(profileId) {
        modal.confirmDelete('this teacher request', async () => {
            try {
                app.showLoading('Rejecting...');
                // Deleting the profile cascades to the teachers row; without a
                // profile the account cannot sign in.
                const { data: removed, error } = await supabaseClient
                    .from('profiles')
                    .delete()
                    .eq('id', profileId)
                    .eq('role', 'teacher')
                    .eq('approved', false)
                    .select('id');
                if (error) throw error;
                if (!removed || removed.length === 0) throw new Error('The request could not be removed.');
                ui.showToast('Teacher request rejected', 'success');
                await Promise.all([dataManager.loadPendingAdmins(), dataManager.loadTeachers()]);
                ui.route('approvals');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async approveAccountant(profileId) {
        try {
            app.showLoading('Approving...');
            const { error } = await supabaseClient
                .from('profiles')
                .update({ approved: true })
                .eq('id', profileId)
                .eq('role', 'accountant');
            if (error) throw error;
            await supabaseClient.from('notifications').insert([{
                user_id: profileId,
                title: 'Account Approved',
                message: 'Your accountant account has been approved. You can now sign in.',
                type: 'system',
                read: false,
                created_by: state.currentUser?.id
            }]);
            ui.showToast('Accountant approved', 'success');
            ui.route(state.role === 'accountant' ? 'accountant_approvals' : 'approvals');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async rejectAccountant(profileId) {
        modal.confirmDelete('this accountant request', async () => {
            try {
                app.showLoading('Rejecting...');
                const { data: removed, error } = await supabaseClient
                    .from('profiles')
                    .delete()
                    .eq('id', profileId)
                    .eq('role', 'accountant')
                    .eq('approved', false)
                    .select('id');
                if (error) throw error;
                if (!removed || removed.length === 0) throw new Error('The request could not be removed.');
                ui.showToast('Accountant request rejected', 'success');
                ui.route(state.role === 'accountant' ? 'accountant_approvals' : 'approvals');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
            }
        });
    },

    async reviewChildLink(parentId, studentId, approve) {
        try {
            app.showLoading(approve ? 'Approving link...' : 'Rejecting link...');
            const { error } = await supabaseClient.rpc('review_child_link', {
                p_parent_id: parentId,
                p_student_id: studentId,
                p_approve: approve
            });
            if (error) throw error;
            ui.showToast(approve ? 'Child link approved' : 'Child link rejected', 'success');
            await dataManager.loadParents();
            ui.route('approvals');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    toggleProofUpload() {
        const method = document.getElementById('payment-method')?.value;
        const container = document.getElementById('proof-upload-container');
        if (container) {
            if (method === 'momo') {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }
    },

    async makePayment() {
        const studentId = document.getElementById('payment-child')?.value;
        const amount = document.getElementById('payment-amount')?.value;
        const method = document.getElementById('payment-method')?.value;
        const proofInput = document.getElementById('payment-proof');
        
        if (!studentId) return modal.alert('Validation Error', 'Please select a child', 'warning');
        if (!amount) return modal.alert('Validation Error', 'Please enter amount', 'warning');
        if (parseMoneyAmount(amount) === null) return modal.alert('Validation Error', 'Please enter an amount greater than zero', 'warning');

        try {
            app.showLoading('Processing payment...');
            let proofUrl = null;
            
            if (method === 'momo' && proofInput?.files[0]) {
                const file = proofInput.files[0];
                const fileName = `${Date.now()}_${studentId}_payment.${file.name.split('.').pop()}`;
                
                const { error } = await supabaseClient.storage
                    .from('payments')
                    .upload(fileName, file);
                
                if (error) throw error;
                
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('payments')
                    .getPublicUrl(fileName);
                proofUrl = publicUrl;
            }

            const { error } = await supabaseClient.from('transactions').insert([{
                student_id: studentId,
                parent_id: state.currentUser?.id,
                type: 'payment',
                amount: parseMoneyAmount(amount),
                method,
                proof: proofUrl,
                status: 'pending',
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id
            }]);

            if (error) throw error;
            
            // Notify admins about the new payment pending review
            const paymentStudent = state.students.find(s => s.id === studentId);
            await supabaseClient.rpc('notify_admins', {
                p_title: 'New Payment Pending Approval',
                p_message: `${state.currentUser?.full_name || 'A parent'} submitted a payment of ₵${amount} for ${paymentStudent?.name || 'a student'}. Please review.`,
                p_type: 'payment'
            });
            ui.showToast('Payment submitted for approval', 'success');
            ui.route('parent_dashboard');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async sendAnnouncement() {
        const title = document.getElementById('announcement-title')?.value;
        const message = document.getElementById('announcement-message')?.value;
        const target = document.querySelector('input[name="announcement-target"]:checked')?.value;
        
        if (!title || !message) {
            modal.alert('Validation Error', 'Please fill in all fields', 'warning');
            return;
        }

        try {
            app.showLoading('Sending announcement...');
            
            // Announcements now go to notifications table instead of notices
            const { error } = await supabaseClient.from('notifications').insert([{
                user_id: null, // Broadcast
                title,
                message,
                type: 'announcement',
                target: target,
                created_by: state.currentUser?.id,
                created_at: new Date().toISOString(),
                read: false
            }]);

            if (error) throw error;
            
            ui.showToast('Announcement sent successfully', 'success');
            document.getElementById('announcement-title').value = '';
            document.getElementById('announcement-message').value = '';
            await dataManager.loadNotifications();
            notificationManager.updateBell();
            ui.route('announcements');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async loadAnalysisData() {
        // Delegated to Academic Report Generator module (academic-report-generator.js)
        await academicReportGenerator.generate();
    },

    async downloadReceipt(transactionId) {
        const transaction = state.transactions.find(t => t.id === transactionId);
        if (!transaction) return;

        const student = state.students.find(s => s.id === transaction.student_id);
        const date = new Date(transaction.created_at).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
        const receiptNo = 'RV-' + transactionId.substring(0, 8).toUpperCase();

        const receiptWindow = window.open('', '_blank');
        receiptWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Receipt - ${escapeHtml(student?.name || 'Student')}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600&display=swap');
                    @page { size: A5; margin: 0; }

                    * { box-sizing: border-box; margin: 0; padding: 0; }

                    body {
                        font-family: 'DM Sans', sans-serif;
                        background: #f0f4f8;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        padding: 20px;
                    }

                    .receipt {
                        position: relative;
                        width: 148mm;
                        min-height: 210mm;
                        background: #ffffff;
                        padding: 36px 32px 28px;
                        box-shadow: 0 8px 40px rgba(0,0,0,0.15);
                        overflow: hidden;
                    }

                    /* ── Watermark ── */
                    .watermark {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) rotate(-30deg);
                        width: 260px;
                        height: 260px;
                        background-image: url('1.png');
                        background-size: contain;
                        background-repeat: no-repeat;
                        background-position: center;
                        opacity: 0.06;
                        pointer-events: none;
                        z-index: 0;
                    }

                    /* Content sits above watermark */
                    .receipt > *:not(.watermark) { position: relative; z-index: 1; }

                    /* ── Header ── */
                    .header {
                        display: flex;
                        align-items: center;
                        gap: 14px;
                        padding-bottom: 18px;
                        border-bottom: 2.5px solid #1e3a5f;
                        margin-bottom: 22px;
                    }

                    .logo-img {
                        width: 64px;
                        height: 64px;
                        object-fit: contain;
                        border-radius: 8px;
                        flex-shrink: 0;
                    }

                    .school-info { flex: 1; }

                    .school-name {
                        font-family: 'Playfair Display', serif;
                        font-size: 20px;
                        color: #1e3a5f;
                        line-height: 1.2;
                        letter-spacing: -0.3px;
                    }

                    .school-tagline {
                        font-size: 10px;
                        color: #64748b;
                        letter-spacing: 1.5px;
                        text-transform: uppercase;
                        margin-top: 3px;
                        font-weight: 500;
                    }

                    .receipt-badge {
                        background: #1e3a5f;
                        color: white;
                        font-size: 9px;
                        font-weight: 700;
                        letter-spacing: 2px;
                        text-transform: uppercase;
                        padding: 4px 10px;
                        border-radius: 4px;
                        align-self: flex-start;
                    }

                    /* ── Receipt meta ── */
                    .meta-row {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 20px;
                        font-size: 11px;
                        color: #64748b;
                    }

                    .meta-row strong { color: #1e293b; }

                    /* ── Amount block ── */
                    .amount-block {
                        background: #16295a;
                        border-radius: 12px;
                        padding: 20px;
                        text-align: center;
                        margin: 20px 0;
                        color: white;
                    }

                    .amount-label {
                        font-size: 10px;
                        letter-spacing: 2px;
                        text-transform: uppercase;
                        opacity: 0.8;
                        margin-bottom: 6px;
                    }

                    .amount-value {
                        font-family: 'Playfair Display', serif;
                        font-size: 38px;
                        font-weight: 700;
                        letter-spacing: -1px;
                    }

                    /* ── Detail rows ── */
                    .details { margin: 20px 0; }

                    .detail-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 0;
                        border-bottom: 1px solid #f1f5f9;
                        font-size: 12.5px;
                    }

                    .detail-row:last-child { border-bottom: none; }

                    .detail-label {
                        color: #94a3b8;
                        font-weight: 500;
                    }

                    .detail-value {
                        color: #1e293b;
                        font-weight: 600;
                        text-align: right;
                    }

                    /* ── Paid stamp ── */
                    .stamp-row {
                        display: flex;
                        justify-content: flex-end;
                        margin: 12px 0 0;
                    }

                    .stamp {
                        width: 80px;
                        height: 80px;
                        border: 3px solid #059669;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #059669;
                        font-weight: 800;
                        font-size: 16px;
                        letter-spacing: 2px;
                        transform: rotate(-18deg);
                        opacity: 0.75;
                    }

                    /* ── Footer ── */
                    .footer {
                        margin-top: 20px;
                        padding-top: 14px;
                        border-top: 1px dashed #cbd5e1;
                        text-align: center;
                        font-size: 10px;
                        color: #94a3b8;
                        line-height: 1.6;
                    }

                    /* ── Print button (no print) ── */
                    .print-btn-wrap {
                        text-align: center;
                        margin-top: 24px;
                    }

                    .print-btn {
                        padding: 12px 32px;
                        background: #16295a;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-weight: 700;
                        font-size: 14px;
                        cursor: pointer;
                        letter-spacing: 0.5px;
                    }

                    @media print {
                        body { background: white; padding: 0; }
                        .receipt { box-shadow: none; margin: 0; }
                        .print-btn-wrap { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="receipt">
                    <!-- Watermark -->
                    <div class="watermark"></div>

                    <!-- Header -->
                    <div class="header">
                        <img src="1.png" alt="School Logo" class="logo-img"
                             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                        <div style="display:none;width:64px;height:64px;background:#16295a;border-radius:8px;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:bold;flex-shrink:0;">R</div>
                        <div class="school-info">
                            <div class="school-name">Ridgevalley School</div>
                            <div class="school-tagline">Building Future Today</div>
                        </div>
                        <div class="receipt-badge">Official Receipt</div>
                    </div>

                    <!-- Meta -->
                    <div class="meta-row">
                        <span>Receipt: <strong>${receiptNo}</strong></span>
                        <span>Date: <strong>${date}</strong></span>
                    </div>

                    <!-- Amount -->
                    <div class="amount-block">
                        <div class="amount-label">Amount Paid</div>
                        <div class="amount-value">₵${parseFloat(transaction.amount).toFixed(2)}</div>
                    </div>

                    <!-- Details -->
                    <div class="details">
                        <div class="detail-row">
                            <span class="detail-label">Student Name</span>
                            <span class="detail-value">${escapeHtml(student?.name || 'N/A')}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Class</span>
                            <span class="detail-value">${student?.class || 'N/A'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Payment Method</span>
                            <span class="detail-value">${transaction.method === 'momo' ? 'Mobile Money' : 'Cash'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Status</span>
                            <span class="detail-value" style="color:#059669;">Confirmed</span>
                        </div>
                    </div>

                    <!-- Paid stamp -->
                    <div class="stamp-row">
                        <div class="stamp">PAID</div>
                    </div>

                    <!-- Footer -->
                    <div class="footer">
                        <p>This is an official receipt from Ridgevalley School Management System</p>
                        <p>Thank you for your payment · Generated ${new Date().toLocaleString()}</p>
                    </div>
                </div>

                <!-- Print button -->
                <div class="print-btn-wrap">
                    <button class="print-btn" onclick="window.print()">
                        Print / Save as PDF
                    </button>
                </div>
            </body>
            </html>
        `);
        receiptWindow.document.close();
    },

    // NEW: Received Reports Actions
    async viewReceivedReportDetail(bundleId) {
        const report = state.receivedReports.find(r => r.id === bundleId);
        if (!report) return;
        
        const studentReports = state.reports.filter(r => r.submission_bundle_id === bundleId);
        
        modal.createModal(
            `Report Bundle: ${report.class}`,
            `<div class="max-h-96 overflow-y-auto space-y-3">
                <div class="bg-slate-50 dark:bg-slate-700 p-4 rounded-lg mb-4">
                    <p class="font-bold text-slate-800 dark:text-white mb-1">Teacher: ${escapeHtml(report.teacher_name)}</p>
                    <p class="text-sm text-slate-500">Submitted: ${new Date(report.submitted_at).toLocaleString()}</p>
                    <p class="text-sm text-slate-500">Students: ${report.student_count} | Template: ${report.template_used || 'Standard'}</p>
                </div>
                ${studentReports.length > 0 ? `
                    <div class="space-y-2">
                        <p class="font-bold text-sm mb-2">Individual Student Reports:</p>
                        ${studentReports.map(r => {
                            const student = state.students.find(s => s.id === r.student_id);
                            return `
                                <div class="flex items-center justify-between p-3 bg-white dark:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-500">
                                    <span class="font-medium">${escapeHtml(student?.name || 'Unknown Student')}</span>
                                    <a href="${r.file_url}" target="_blank" class="text-blue-500 hover:text-blue-700 text-sm font-bold">
                                        <i class="fas fa-eye mr-1"></i> View
                                    </a>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : '<p class="text-sm text-slate-500">No individual reports found in this bundle.</p>'}
            </div>`,
            null,
            null,
            'Close',
            null,
            'info'
        );
    },

    async downloadReportBundle(bundleId) {
        try {
            app.showLoading('Preparing download...');
            const report = state.receivedReports.find(r => r.id === bundleId);
            if (!report) throw new Error('Report not found');
            
            // In a real implementation, you would generate a ZIP file or download multiple files
            // For now, we'll download the main bundle file if it exists, or show individual reports
            if (report.bundle_url) {
                privateStorage.open(report.bundle_url);
            } else {
                const studentReports = state.reports.filter(r => r.submission_bundle_id === bundleId);
                if (studentReports.length > 0) {
                    // Download first report as example, or implement batch download
                    privateStorage.open(studentReports[0].file_url);
                } else {
                    throw new Error('No files available for download');
                }
            }
            ui.showToast('Download started', 'success');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async approveReportBundle(bundleId) {
        try {
            app.showLoading('Approving report bundle...');
            
            const { error } = await supabaseClient
                .from('received_reports')
                .update({ 
                    status: 'reviewed',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: state.currentUser?.id
                })
                .eq('id', bundleId);

            if (error) throw error;
            
            // Also update individual reports status
            await supabaseClient
                .from('reports')
                .update({ status: 'reviewed' })
                .eq('submission_bundle_id', bundleId);
            
            // Notify parents of students in this bundle
            const approvedBundle = state.receivedReports.find(r => r.id === bundleId);
            if (approvedBundle?.class) {
                // Prefer UUID-based matching: find the class object first
                const classObj = state.classes.find(c => normalizeClassName(buildClassName(c)) === normalizeClassName(approvedBundle.class));
                const classStudents = state.students.filter(s => {
                    if (classObj && s.class_id) return s.class_id === classObj.id;
                    return normalizeClassName(s.class) === normalizeClassName(approvedBundle.class);
                });
                for (const st of classStudents) {
                    await notificationManager.notifyParentsOfStudent(st.id, 'Report Approved', `The ${approvedBundle.class} class report bundle submitted by the teacher has been approved by the administration.`, 'report_uploaded');
                }
            }
            ui.showToast('Report bundle approved successfully', 'success');
            await dataManager.loadReceivedReports();
            ui.route('received_reports');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    async rejectReportBundle(bundleId) {
        try {
            app.showLoading('Rejecting report bundle...');
            
            const { error } = await supabaseClient
                .from('received_reports')
                .update({ 
                    status: 'rejected',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: state.currentUser?.id
                })
                .eq('id', bundleId);

            if (error) throw error;
            
            // Also update individual reports status
            await supabaseClient
                .from('reports')
                .update({ status: 'rejected' })
                .eq('submission_bundle_id', bundleId);
            
            // Notify teacher their bundle was rejected (via notification to teacher's user_id)
            const rejBundle = state.receivedReports.find(r => r.id === bundleId);
            if (rejBundle?.teacher_id) {
                await supabaseClient.from('notifications').insert([{
                    user_id: rejBundle.teacher_id,
                    title: 'Report Bundle Rejected',
                    message: `Your report submission for ${rejBundle.class} has been rejected by the administration. Please review and resubmit.`,
                    type: 'report_correction',
                    read: false,
                    created_by: state.currentUser?.id,
                    created_at: new Date().toISOString()
                }]);
            }
            ui.showToast('Report bundle rejected', 'success');
            await dataManager.loadReceivedReports();
            ui.route('received_reports');
        } catch (err) {
            modal.alert('Error', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    // Download Bulk Reports — opens report.html pre-filtered for the given class
    downloadBulkReports(className, term, classId) {
        try {
            if (!className) {
                modal.alert('Error', 'No class specified for bulk report download.', 'error');
                return;
            }

            const teacher = dataManager.getCurrentTeacher();
            const teacherId   = state.currentUser?.id || '';
            const teacherName = state.currentUser?.full_name || 'Teacher';
            const year        = state.currentAY?.year || new Date().getFullYear();
            const useTerm     = term || state.currentTerm?.name || 'Term 1';
            const useClassId  = classId || (() => {
                // Try to resolve classId from className if not provided
                const matched = state.classes?.find(c =>
                    normalizeClassName(buildClassName(c)) === normalizeClassName(className) || c.id === className
                );
                return matched?.id || '';
            })();

            localStorage.setItem('rv_report_teacher_id',   teacherId);
            localStorage.setItem('rv_report_teacher_name', teacherName);
            localStorage.setItem('rv_report_class',        className);
            localStorage.setItem('rv_report_class_id',     useClassId);
            localStorage.setItem('rv_report_year',         year);
            localStorage.setItem('rv_report_term',         useTerm);

            const params = new URLSearchParams({
                teacherId,
                teacherName,
                class: className,
                classId: useClassId,
                year,
                term: useTerm
            });

            window.open(`report.html?${params.toString()}`, '_blank');

            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('Report generator opened for ' + className, 'success');
            }
        } catch (err) {
            console.error('Download bulk reports error:', err);
            if (typeof modal !== 'undefined' && modal.alert) {
                modal.alert('Error', 'Failed to open report generator: ' + extractErrorMessage(err), 'error');
            } else {
                alert('Failed to open report generator: ' + extractErrorMessage(err));
            }
        }
    },

    // ==================== CHANGE 2: BULK UPLOAD WIZARD ====================
    openBulkUploadWizard() {
        const modalId = 'bulk-wizard-' + Date.now();
        // Step state stored in modal dataset
        const html = `
            <div id="${modalId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;z-index:9999;padding:16px;overflow-y:auto;">
                <div style="width:100%;max-width:560px;background:#1e293b;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);margin:auto;flex-shrink:0;">
                    <!-- Header -->
                    <div style="background:#16295a;padding:20px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:1;">
                        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-file-excel" style="color:#fff;font-size:18px;"></i>
                        </div>
                        <div>
                            <div style="color:#fff;font-size:16px;font-weight:700;">Bulk Student Upload</div>
                            <div style="color:rgba(255,255,255,0.6);font-size:12px;" id="${modalId}-step-label">Step 1 of 3 — Select Class</div>
                        </div>
                    </div>

                    <!-- Steps progress -->
                    <div style="display:flex;gap:0;padding:0 24px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,0.06);">
                        ${['Select Class','Upload File','Map Columns'].map((s,i)=>`
                            <div id="${modalId}-step-tab-${i+1}" style="flex:1;padding:10px 0;text-align:center;font-size:11px;font-weight:700;color:${i===0?'#1a56db':'#64748b'};border-bottom:2px solid ${i===0?'#1a56db':'transparent'};cursor:default;transition:all 0.2s;">${i+1}. ${s}</div>
                        `).join('')}
                    </div>

                    <!-- Step 1: Class Selection -->
                    <div id="${modalId}-step1" style="padding:24px;">
                        <p style="color:#94a3b8;font-size:13px;margin-bottom:16px;">Choose the class to upload students into:</p>
                        <select id="${modalId}-class-sel" style="width:100%;padding:12px 16px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;margin-bottom:20px;">
                            <option value="">-- Select a class --</option>
                            ${state.classes.map(c=>`<option value="${c.id}">${c.level} - ${c.grade}</option>`).join('')}
                        </select>
                        <div style="display:flex;justify-content:flex-end;gap:10px;">
                            <button onclick="document.getElementById('${modalId}').remove()" style="padding:10px 20px;border-radius:8px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;cursor:pointer;">Cancel</button>
                            <button onclick="actions._bulkWizardStep2('${modalId}')" style="padding:10px 20px;border-radius:8px;background:#1a56db;color:#fff;font-weight:700;cursor:pointer;border:none;">Next <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 2: File Upload (hidden initially) -->
                    <div id="${modalId}-step2" style="padding:24px;display:none;">
                        <p style="color:#94a3b8;font-size:13px;margin-bottom:6px;">Upload an Excel file (.xlsx / .xls) containing student data.</p>
                        <p style="color:#64748b;font-size:12px;margin-bottom:16px;">Your file should have columns for student <strong style="color:#94a3b8;">Name</strong>, <strong style="color:#94a3b8;">Gender</strong>, and <strong style="color:#94a3b8;">Date of Birth</strong>.</p>
                        <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;border:2px dashed #334155;border-radius:14px;cursor:pointer;background:#0f172a;transition:border-color 0.2s;gap:10px;" 
                               onmouseover="this.style.borderColor='#1a56db'" onmouseout="this.style.borderColor='#334155'">
                            <i class="fas fa-cloud-upload-alt" style="font-size:32px;color:#1a56db;"></i>
                            <span style="color:#94a3b8;font-size:14px;font-weight:600;">Click to choose Excel file</span>
                            <span style="color:#64748b;font-size:12px;">.xlsx or .xls files only</span>
                            <input type="file" id="${modalId}-file" accept=".xlsx,.xls" style="display:none;" onchange="actions._bulkWizardPreviewFile('${modalId}')">
                        </label>
                        <div id="${modalId}-file-name" style="margin-top:10px;color:#64748b;font-size:12px;text-align:center;"></div>
                        <div style="display:flex;justify-content:space-between;margin-top:20px;">
                            <button onclick="actions._bulkWizardGoStep1('${modalId}')" style="padding:10px 20px;border-radius:8px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;cursor:pointer;"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button id="${modalId}-step2-next" onclick="actions._bulkWizardStep3('${modalId}')" style="padding:10px 20px;border-radius:8px;background:#1a56db;color:#fff;font-weight:700;cursor:pointer;border:none;opacity:0.4;" disabled>Next <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 3: Column Mapping (hidden initially) -->
                    <div id="${modalId}-step3" style="display:none;flex-direction:column;">
                        <div style="padding:24px;overflow-y:auto;overflow-x:hidden;max-height:calc(80vh - 160px);">
                            <p style="color:#94a3b8;font-size:13px;margin-bottom:16px;">Match your file's columns to the system fields:</p>
                            <div id="${modalId}-mapping-area"></div>
                            <div id="${modalId}-preview-area" style="margin-top:16px;overflow-x:auto;"></div>
                        </div>
                        <div style="padding:14px 24px;border-top:1px solid #334155;display:flex;justify-content:space-between;background:#1e293b;flex-shrink:0;">
                            <button onclick="actions._bulkWizardGoStep2('${modalId}')" style="padding:10px 20px;border-radius:8px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;cursor:pointer;"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button onclick="actions._bulkWizardFinish('${modalId}')" style="padding:10px 20px;border-radius:8px;background:#059669;color:#fff;font-weight:700;cursor:pointer;border:none;"><i class="fas fa-upload mr-2"></i>Upload Students</button>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        // Store wizard state on the modal element
        document.getElementById(modalId)._wizardState = { selectedClass: '', selectedClassId: '', fileData: null, headers: [] };
    },

    _bulkWizardUpdateTabs(modalId, activeStep) {
        for (let i = 1; i <= 3; i++) {
            const tab = document.getElementById(`${modalId}-step-tab-${i}`);
            if (tab) {
                tab.style.color = i === activeStep ? '#1a56db' : '#64748b';
                tab.style.borderBottom = `2px solid ${i === activeStep ? '#1a56db' : 'transparent'}`;
            }
        }
        const label = document.getElementById(`${modalId}-step-label`);
        const labels = ['Select Class', 'Upload File', 'Map Columns'];
        if (label) label.textContent = `Step ${activeStep} of 3 — ${labels[activeStep-1]}`;
    },

    _bulkWizardStep2(modalId) {
        const sel = document.getElementById(`${modalId}-class-sel`);
        if (!sel || !sel.value) { ui.showToast('Please select a class first', 'warning'); return; }
        const modalEl = document.getElementById(modalId);
        // sel.value is the class UUID; resolve the display name from state.classes
        const selectedClassId = sel.value;
        const classObj = state.classes.find(c => c.id === selectedClassId);
        modalEl._wizardState.selectedClassId = selectedClassId;
        modalEl._wizardState.selectedClass = classObj ? buildClassName(classObj) : '';
        document.getElementById(`${modalId}-step1`).style.display = 'none';
        document.getElementById(`${modalId}-step2`).style.display = 'block';
        this._bulkWizardUpdateTabs(modalId, 2);
    },

    _bulkWizardGoStep1(modalId) {
        document.getElementById(`${modalId}-step2`).style.display = 'none';
        document.getElementById(`${modalId}-step1`).style.display = 'block';
        this._bulkWizardUpdateTabs(modalId, 1);
    },

    _bulkWizardGoStep2(modalId) {
        document.getElementById(`${modalId}-step3`).style.display = 'none';
        document.getElementById(`${modalId}-step2`).style.display = 'block';
        this._bulkWizardUpdateTabs(modalId, 2);
    },

    _bulkWizardPreviewFile(modalId) {
        const fileInput = document.getElementById(`${modalId}-file`);
        const file = fileInput?.files[0];
        if (!file) return;
        document.getElementById(`${modalId}-file-name`).textContent = `Selected: ${file.name}`;
        const nextBtn = document.getElementById(`${modalId}-step2-next`);
        if (nextBtn) { nextBtn.disabled = false; nextBtn.style.opacity = '1'; }
    },

    async _bulkWizardStep3(modalId) {
        const fileInput = document.getElementById(`${modalId}-file`);
        const file = fileInput?.files[0];
        if (!file) { ui.showToast('Please select an Excel file', 'warning'); return; }

        // Use SheetJS (XLSX) which is loaded via CDN in the HTML
        if (typeof XLSX === 'undefined') {
            // Try to load SheetJS dynamically if not already present
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = resolve; s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (!rows || rows.length < 2) { ui.showToast('File appears to be empty or invalid', 'error'); return; }

            const headers = (rows[0] || []).map(h => String(h).trim()).filter(Boolean);
            const modalEl = document.getElementById(modalId);
            modalEl._wizardState.fileData = rows;
            modalEl._wizardState.headers = headers;

            // Build column mapping UI
            const mappingArea = document.getElementById(`${modalId}-mapping-area`);
            const optionHtml = `<option value="">-- Select column --</option>` +
                headers.map(h => `<option value="${h}">${h}</option>`).join('');

            mappingArea.innerHTML = `
                <div class="bulk-map-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                    <div>
                        <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">System Field</label>
                        <div style="padding:12px;background:#0f172a;border-radius:8px;border:1.5px solid #0891b2;color:#e2e8f0;font-size:13px;font-weight:600;"><i class="fas fa-hashtag mr-2 text-cyan-400"></i>Admission Number</div>
                    </div>
                    <div>
                        <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Your Column</label>
                        <select id="${modalId}-map-admission" style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;outline:none;" onchange="actions._bulkWizardUpdatePreview('${modalId}')">${optionHtml}</select>
                    </div>
                    <div>
                        <div style="padding:12px;background:#0f172a;border-radius:8px;border:1.5px solid #1a56db;color:#e2e8f0;font-size:13px;font-weight:600;"><i class="fas fa-user mr-2 text-blue-400"></i>Student Name</div>
                    </div>
                    <div>
                        <select id="${modalId}-map-name" style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;outline:none;" onchange="actions._bulkWizardUpdatePreview('${modalId}')">${optionHtml}</select>
                    </div>
                    <div>
                        <div style="padding:12px;background:#0f172a;border-radius:8px;border:1.5px solid #ec4899;color:#e2e8f0;font-size:13px;font-weight:600;"><i class="fas fa-venus-mars mr-2 text-pink-400"></i>Gender</div>
                    </div>
                    <div>
                        <select id="${modalId}-map-gender" style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;outline:none;" onchange="actions._bulkWizardUpdatePreview('${modalId}')">${optionHtml}</select>
                    </div>
                    <div>
                        <div style="padding:12px;background:#0f172a;border-radius:8px;border:1.5px solid #7c3aed;color:#e2e8f0;font-size:13px;font-weight:600;"><i class="fas fa-birthday-cake mr-2 text-purple-400"></i>Date of Birth</div>
                    </div>
                    <div>
                        <select id="${modalId}-map-dob" style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;outline:none;" onchange="actions._bulkWizardUpdatePreview('${modalId}')">${optionHtml}</select>
                    </div>
                    <div>
                        <div style="padding:12px;background:#0f172a;border-radius:8px;border:1.5px solid #059669;color:#e2e8f0;font-size:13px;font-weight:600;"><i class="fas fa-phone mr-2 text-emerald-400"></i>Parent Phone</div>
                    </div>
                    <div>
                        <select id="${modalId}-map-phone" style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;outline:none;" onchange="actions._bulkWizardUpdatePreview('${modalId}')">${optionHtml}</select>
                    </div>
                </div>
                <div style="padding:10px 14px;background:rgba(26,86,219,0.1);border:1px solid rgba(26,86,219,0.3);border-radius:8px;margin-bottom:4px;">
                    <p style="color:#93c5fd;font-size:12px;"><i class="fas fa-info-circle mr-2"></i>Date of Birth accepts formats: <strong>YYYY-MM-DD</strong>, <strong>MM/DD/YYYY</strong>, <strong>DD/MM/YYYY</strong>, or any standard date format.</p>
                </div>
            `;

            // Auto-detect common column names
            const admCandidates = ['admission', 'admission number', 'adm', 'adm no', 'adm number', 'admission no', 'student id', 'id'];
            const nameCandidates = ['name', 'student name', 'full name', 'student'];
            const genderCandidates = ['gender', 'sex', 'gender/sex'];
            const dobCandidates = ['dob', 'date of birth', 'birth date', 'birthday', 'dateofbirth'];
            const phoneCandidates = ['parent phone', 'phone', 'phone number', 'parent contact', 'contact', 'mobile', 'tel'];
            const admSel = document.getElementById(`${modalId}-map-admission`);
            const nameSel = document.getElementById(`${modalId}-map-name`);
            const genderSel = document.getElementById(`${modalId}-map-gender`);
            const dobSel = document.getElementById(`${modalId}-map-dob`);
            const phoneSel = document.getElementById(`${modalId}-map-phone`);
            headers.forEach(h => {
                const hl = h.toLowerCase();
                if (admCandidates.includes(hl) && admSel.value === '') admSel.value = h;
                if (nameCandidates.includes(hl) && nameSel.value === '') nameSel.value = h;
                if (genderCandidates.includes(hl) && genderSel.value === '') genderSel.value = h;
                if (dobCandidates.includes(hl) && dobSel.value === '') dobSel.value = h;
                if (phoneCandidates.includes(hl) && phoneSel.value === '') phoneSel.value = h;
            });

            this._bulkWizardUpdatePreview(modalId);

            document.getElementById(`${modalId}-step2`).style.display = 'none';
            document.getElementById(`${modalId}-step3`).style.display = 'flex';
            this._bulkWizardUpdateTabs(modalId, 3);
        } catch (err) {
            ui.showToast('Failed to read Excel file: ' + extractErrorMessage(err), 'error');
        }
    },

    _bulkWizardUpdatePreview(modalId) {
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;
        const { fileData, headers } = modalEl._wizardState;
        if (!fileData || fileData.length < 2) return;
        const admSel = document.getElementById(`${modalId}-map-admission`);
        const nameSel = document.getElementById(`${modalId}-map-name`);
        const genderSel = document.getElementById(`${modalId}-map-gender`);
        const dobSel = document.getElementById(`${modalId}-map-dob`);
        const phoneSel = document.getElementById(`${modalId}-map-phone`);
        const admCol = admSel?.value;
        const nameCol = nameSel?.value;
        const genderCol = genderSel?.value;
        const dobCol = dobSel?.value;
        const phoneCol = phoneSel?.value;
        const admIdx = headers.indexOf(admCol);
        const nameIdx = headers.indexOf(nameCol);
        const genderIdx = headers.indexOf(genderCol);
        const dobIdx = headers.indexOf(dobCol);
        const phoneIdx = headers.indexOf(phoneCol);
        const previewRows = fileData.slice(1, 6);
        const previewArea = document.getElementById(`${modalId}-preview-area`);
        if (!previewArea) return;
        previewArea.innerHTML = `
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Preview (first 5 rows)</div>
            <div style="background:#0f172a;border-radius:10px;overflow:hidden;border:1px solid #334155;overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:580px;">
                    <thead>
                        <tr style="background:#1e293b;">
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Adm. No.</th>
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Name</th>
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Gender</th>
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Date of Birth</th>
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Age</th>
                            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-weight:700;">Parent Phone</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${previewRows.map(row => {
                            const adm = admIdx >= 0 ? String(row[admIdx] || '') : '';
                            const name = nameIdx >= 0 ? String(row[nameIdx] || '') : '';
                            const gender = genderIdx >= 0 ? String(row[genderIdx] || '') : '';
                            const dob = dobIdx >= 0 ? row[dobIdx] : '';
                            const dobStr = dob instanceof Date ? dob.toISOString().split('T')[0] : this._parseDobString(String(dob || ''));
                            const age = dobStr ? this._calculateAgeFromDob(dobStr) : '—';
                            const phone = phoneIdx >= 0 ? String(row[phoneIdx] || '') : '';
                            return `<tr style="border-top:1px solid #1e293b;">
                                <td style="padding:8px 12px;color:#67e8f9;">${adm || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#e2e8f0;">${name ? escapeHtml(name) : '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#f9a8d4;">${gender || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#e2e8f0;">${dobStr || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#10b981;font-weight:600;">${age}</td>
                                <td style="padding:8px 12px;color:#a78bfa;">${phone ? escapeHtml(phone) : '<span style="color:#64748b;">—</span>'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    _calculateAgeFromDob(dobStr) {
        if (!dobStr) return '—';
        try {
            const dob = new Date(dobStr);
            if (isNaN(dob)) return '—';
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const m = today.getMonth() - dob.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
            return age >= 0 ? age : '—';
        } catch { return '—'; }
    },

    // Parse DOB strings — supports YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, and JS Date serial numbers
    _parseDobString(dobRaw) {
        if (!dobRaw) return '';
        const s = String(dobRaw).trim();
        if (!s || s === '0') return '';

        // Already ISO: YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        // MM/DD/YYYY (US format) — primary requested format
        const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mdyMatch) {
            const [, mm, dd, yyyy] = mdyMatch;
            const d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
            if (!isNaN(d)) return d.toISOString().split('T')[0];
        }

        // DD/MM/YYYY (British format)
        const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmyMatch) {
            const [, dd, mm, yyyy] = dmyMatch;
            const d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`);
            if (!isNaN(d)) return d.toISOString().split('T')[0];
        }

        // Excel serial date number
        if (/^\d+$/.test(s)) {
            const serial = parseInt(s, 10);
            if (serial > 25568 && serial < 60000) {
                const excelEpoch = new Date(1899, 11, 30);
                excelEpoch.setDate(excelEpoch.getDate() + serial);
                return excelEpoch.toISOString().split('T')[0];
            }
        }

        // Fallback: let JS try to parse it
        const d = new Date(s);
        return isNaN(d) ? '' : d.toISOString().split('T')[0];
    },

    async _bulkWizardFinish(modalId) {
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;
        const { selectedClass, selectedClassId, fileData, headers } = modalEl._wizardState;
        const admSel = document.getElementById(`${modalId}-map-admission`);
        const nameSel = document.getElementById(`${modalId}-map-name`);
        const genderSel = document.getElementById(`${modalId}-map-gender`);
        const dobSel = document.getElementById(`${modalId}-map-dob`);
        const phoneSel = document.getElementById(`${modalId}-map-phone`);
        const admCol = admSel?.value;
        const nameCol = nameSel?.value;
        const genderCol = genderSel?.value;
        const dobCol = dobSel?.value;
        const phoneCol = phoneSel?.value;

        if (!nameCol || !dobCol) { ui.showToast('Please map both Name and Date of Birth columns', 'warning'); return; }
        if (!selectedClassId) { ui.showToast('No class selected', 'warning'); return; }

        // Resolve class object from stored UUID so we always write the canonical name
        const resolvedClassObj = state.classes.find(c => c.id === selectedClassId);
        if (!resolvedClassObj) {
            ui.showToast('Selected class could not be resolved. Please go back and re-select.', 'warning');
            return;
        }
        const normalisedClass = buildClassName(resolvedClassObj);
        assertNotUUID(normalisedClass, '_bulkWizardFinish');

        const admIdx = headers.indexOf(admCol);
        const nameIdx = headers.indexOf(nameCol);
        const genderIdx = headers.indexOf(genderCol);
        const dobIdx = headers.indexOf(dobCol);
        const phoneIdx = headers.indexOf(phoneCol);
        const dataRows = (fileData || []).slice(1).filter(row => row[nameIdx]?.toString().trim());

        if (dataRows.length === 0) { ui.showToast('No valid student rows found in the file', 'warning'); return; }

        modalEl.remove();
        app.showLoading(`Uploading ${dataRows.length} students...`);

        try {
            const records = dataRows.map(row => {
                const admission_number = admIdx >= 0 ? String(row[admIdx] || '').trim() : '';
                const name = String(row[nameIdx] || '').trim();
                const genderRaw = genderIdx >= 0 ? String(row[genderIdx] || '').trim() : '';
                // Normalise gender value to Male/Female/Other
                const genderNorm = genderRaw.toLowerCase().startsWith('m') ? 'Male'
                    : genderRaw.toLowerCase().startsWith('f') ? 'Female'
                    : genderRaw ? 'Other' : null;
                const dobRaw = dobIdx >= 0 ? row[dobIdx] : '';
                let dobStr = '';
                if (dobRaw instanceof Date) {
                    dobStr = dobRaw.toISOString().split('T')[0];
                } else if (dobRaw) {
                    dobStr = this._parseDobString(String(dobRaw));
                }
                const age = this._calculateAgeFromDob(dobStr);
                const parent_phone = phoneIdx >= 0 ? String(row[phoneIdx] || '').trim() : '';
                return {
                    admission_number: admission_number || null,
                    name,
                    gender: genderNorm,
                    dob: dobStr || null,
                    age: typeof age === 'number' ? age : null,
                    class: normalisedClass,
                    class_id: selectedClassId,
                    parent_phone: parent_phone || null,
                    created_at: new Date().toISOString()
                };
            });

            const { error } = await supabaseClient.from('students').insert(records);
            if (error) throw error;

            // Notify all parents about new students
            await notificationManager.notifyParents('New Students Added', `${records.length} new student(s) have been added to ${normalisedClass}.`, 'student_added');

            ui.showToast(`Successfully uploaded ${records.length} students to ${selectedClass}`, 'success');
            await dataManager.loadStudents();
            ui.route('students');
        } catch (err) {
            modal.alert('Upload Failed', extractErrorMessage(err), 'error');
        } finally {
            app.hideLoading();
        }
    },

    // ==================== CHANGE 3: GRAY OUT STUDENT NAMES WITH UPLOADED REPORTS ====================
    // (Applied inside renderAdminUploadReports via the existing uploaded report detection — we just
    //  enhance the student name styling. This is patched in views.renderAdminUploadReports override.)

    // ==================== CHANGE 5: PARENT NOTIFICATION HELPERS ====================
    async _notifyParentsOfStudent(studentId, title, message, type) {
        try {
            // Find parents linked to this student
            const linkedParents = state.parents.filter(p => p.children_ids?.includes(studentId));
            for (const parent of linkedParents) {
                await supabaseClient.from('notifications').insert([{
                    user_id: parent.profile_id,
                    title,
                    message,
                    type: type || 'system',
                    read: false,
                    created_by: state.currentUser?.id,
                    created_at: new Date().toISOString()
                }]);
            }
        } catch (err) {
            console.warn('Parent notification error:', err);
        }
    }
};

// ==================== NOTIFICATION MANAGER ====================
const notificationManager = {
    _audioCtx: null,
    _lastNotifCount: 0,
    _pollingInterval: null,

    // Play a soft bell sound using Web Audio API
    playBell() {
        try {
            if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this._audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.8);
        } catch (e) { /* audio not supported */ }
    },

    // Count unread notifications for current user
    countUnread() {
        return state.notifications.filter(n => !n.read && (n.user_id === state.currentUser?.id || (n.type === 'announcement' && (!n.target || n.target === 'all' || n.target === state.role || n.target === state.role + 's')))).length;
    },

    // Update bell badge in the nav
    updateBell() {
        const badge = document.getElementById('notif-badge');
        const bell = document.getElementById('notif-bell');
        if (!badge || !bell) return;
        const count = this.countUnread();
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
            bell.style.color = '#f59e0b';
        } else {
            badge.style.display = 'none';
            bell.style.color = '';
        }
    },

    // Check for new notifications and alert user
    async checkForNew() {
        if (!state.currentUser) return;
        const prevCount = this._lastNotifCount;
        await dataManager.loadNotifications();
        const newCount = this.countUnread();
        this.updateBell();
        if (newCount > prevCount && prevCount !== 0) {
            // New notification arrived — play bell, show in-app prompt, send push
            this.playBell();
            this.showPrompt();
            // Fire browser push for the latest new notification
            const latest = state.notifications.filter(n => !n.read)[0];
            if (latest) {
                this.sendPush(latest.title, latest.message?.substring(0, 100) || '', 'info');
            }
        }
        this._lastNotifCount = newCount;
    },

    // Show a subtle banner prompt
    showPrompt() {
        const existing = document.getElementById('notif-prompt-banner');
        if (existing) existing.remove();
        const unread = state.notifications.filter(n => !n.read).slice(0, 3);
        if (unread.length === 0) return;
        const latest = unread[0];
        const banner = document.createElement('div');
        banner.id = 'notif-prompt-banner';
        banner.style.cssText = `
            position:fixed;top:72px;right:20px;z-index:9998;
            background:#111111;border:1px solid #262626;border-radius:14px;
            box-shadow:0 8px 32px rgba(0,0,0,0.4);padding:16px 20px;
            max-width:320px;cursor:pointer;
            animation:slideInRight 0.3s ease;
        `;
        banner.innerHTML = `
            <style>@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}</style>
            <div style="display:flex;align-items:start;gap:12px;">
                <div style="width:36px;height:36px;background:#d97706;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-bell" style="color:#fff;font-size:14px;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:2px;">New Notification</div>
                    <div style="color:#94a3b8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(latest.title)}</div>
                    <div style="color:#64748b;font-size:11px;margin-top:2px;">${escapeHtml(latest.message?.substring(0,60))}${escapeHtml(latest.message?.length>60?'...':'')}</div>
                </div>
                <button onclick="this.closest('#notif-prompt-banner').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;padding:2px;font-size:16px;">×</button>
            </div>
        `;
        banner.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                banner.remove();
                notificationManager.openPanel();
            }
        });
        document.body.appendChild(banner);
        setTimeout(() => { if (banner.parentNode) { banner.style.opacity = '0'; banner.style.transition = 'opacity 0.4s'; setTimeout(() => banner.remove(), 400); } }, 6000);
    },

    // Open notification panel
    openPanel() {
        const existing = document.getElementById('notif-panel');
        if (existing) { existing.remove(); return; }
        const myNotifs = state.notifications
            .filter(n => n.user_id === state.currentUser?.id || (n.type === 'announcement' && (!n.target || n.target === 'all' || n.target === state.role || n.target === state.role + 's')))
            .slice(0, 20);
        const panel = document.createElement('div');
        panel.id = 'notif-panel';
        panel.style.cssText = `
            position:fixed;top:64px;right:16px;z-index:9997;width:360px;max-height:480px;
            background:#1e293b;border:1px solid #334155;border-radius:16px;
            box-shadow:0 16px 48px rgba(0,0,0,0.5);overflow:hidden;display:flex;flex-direction:column;
            animation:slideInRight 0.25s ease;
        `;
        panel.innerHTML = `
            <div style="padding:16px 20px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between;">
                <div style="font-weight:700;color:#e2e8f0;font-size:15px;"><i class="fas fa-bell mr-2" style="color:#f59e0b;"></i>Notifications</div>
                <button onclick="document.getElementById('notif-panel').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;">×</button>
            </div>
            <div style="overflow-y:auto;flex:1;">
                ${myNotifs.length === 0 ? `<div style="text-align:center;padding:40px 20px;color:#64748b;"><i class="fas fa-inbox" style="font-size:32px;margin-bottom:10px;display:block;"></i>No notifications yet</div>` : myNotifs.map(n => {
                    const typeIcons = { announcement:'fa-bullhorn', report_uploaded:'fa-file-alt', payment:'fa-credit-card', report_correction:'fa-exclamation-triangle', student_added:'fa-user-plus', fee_added:'fa-money-bill', system:'fa-info-circle' };
                    const icon = typeIcons[n.type] || 'fa-bell';
                    return `
                        <div style="padding:14px 20px;border-bottom:1px solid #1e293b;background:${n.read?'transparent':'rgba(26,86,219,0.06)'};hover:background:#0f172a;cursor:default;">
                            <div style="display:flex;gap:10px;align-items:start;">
                                <div style="width:32px;height:32px;border-radius:8px;background:rgba(26,86,219,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                    <i class="fas ${icon}" style="color:#1a56db;font-size:13px;"></i>
                                </div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-weight:600;color:#e2e8f0;font-size:13px;">${escapeHtml(n.title)}</div>
                                    <div style="color:#94a3b8;font-size:12px;margin-top:2px;line-height:1.4;">${escapeHtml(n.message)}</div>
                                    <div style="color:#475569;font-size:11px;margin-top:4px;">${new Date(n.created_at).toLocaleString()}</div>
                                </div>
                                ${!n.read?`<span style="width:8px;height:8px;border-radius:50%;background:#1a56db;flex-shrink:0;margin-top:4px;"></span>`:''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        document.body.appendChild(panel);
        // Close when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function handler(e) {
                if (!panel.contains(e.target) && !document.getElementById('notif-bell')?.contains(e.target)) {
                    panel.remove();
                    document.removeEventListener('click', handler);
                }
            });
        }, 100);
    },

    // ── FIX 4: Request browser notification permission on login ──
    async requestPermission() {
        if (!('Notification' in window)) return; // Browser doesn't support it
        if (Notification.permission === 'granted') return; // Already granted
        if (Notification.permission === 'denied') return;  // User already blocked

        // Show a friendly in-app prompt first (better UX than raw browser dialog)
        const modalId = 'notif-permission-modal-' + Date.now();
        const html = `
            <div id="${modalId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;">
                <div style="width:100%;max-width:400px;background:#1e293b;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
                    <div style="background:#d97706;padding:20px 24px;text-align:center;">
                        <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                            <i class="fas fa-bell" style="color:#fff;font-size:24px;"></i>
                        </div>
                        <div style="color:#fff;font-size:17px;font-weight:700;">Stay Informed</div>
                        <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">Ridgevalley School Notifications</div>
                    </div>
                    <div style="padding:24px;">
                        <p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin-bottom:8px;">
                            Allow <strong style="color:#e2e8f0;">Ridgevalley SMS</strong> to send you browser notifications so you never miss important updates:
                        </p>
                        <div style="space-y:8px;margin:16px 0;">
                            ${[['fa-file-alt', 'Report uploads & approvals'], ['fa-wallet', 'Payment confirmations'], ['fa-bullhorn', 'School announcements'], ['fa-bell', 'Urgent admin alerts']].map(([icon, item]) => `
                                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #262626;font-size:13px;color:#a3a3a3;"><i class="fas ${icon}" aria-hidden="true" style="width:16px;text-align:center;color:#6ee7b7;"></i>${item}</div>
                            `).join('')}
                        </div>
                        <p style="color:#64748b;font-size:11px;margin-bottom:20px;">You can change this anytime in your browser settings.</p>
                        <div style="display:flex;gap:10px;">
                            <button id="${modalId}-deny" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;font-size:14px;cursor:pointer;">Not Now</button>
                            <button id="${modalId}-allow" style="flex:1;padding:12px;border-radius:10px;background:#d97706;color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none;">
                                <i class="fas fa-bell mr-2"></i>Allow Notifications
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        const modalEl = document.getElementById(modalId);

        document.getElementById(`${modalId}-deny`).onclick = () => modalEl.remove();
        document.getElementById(`${modalId}-allow`).onclick = async () => {
            modalEl.remove();
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    // Send a welcome test notification
                    this.sendPush('Notifications Enabled', 'You will now receive Ridgevalley SMS alerts on this device.', 'success');
                    ui.showToast('Browser notifications enabled!', 'success');
                }
            } catch (e) {
                console.warn('Notification permission error:', e);
            }
        };
    },

    // Send a native browser push notification
    sendPush(title, body, type) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            const notif = new Notification(title, {
                body,
                icon: '1.png',  // School logo — make sure this file exists
                badge: '1.png',
                tag: 'ridgevalley-sms',
                renotify: true,
                requireInteraction: false,
                silent: false
            });
            notif.onclick = () => {
                window.focus();
                notif.close();
                notificationManager.openPanel();
            };
            setTimeout(() => notif.close(), 8000);
        } catch (e) {
            console.warn('Push notification error:', e);
        }
    },

    // Start polling for new notifications
    startPolling(intervalMs = 30000) {
        if (this._pollingInterval) clearInterval(this._pollingInterval);
        this._lastNotifCount = this.countUnread();
        this._pollingInterval = setInterval(() => this.checkForNew(), intervalMs);
    },

    stopPolling() {
        if (this._pollingInterval) clearInterval(this._pollingInterval);
        this._pollingInterval = null;
    },

    // Inject bell into main nav
    injectBell() {
        const nav = document.getElementById('main-nav');
        if (!nav || document.getElementById('notif-bell')) return;
        const bellHtml = `
            <div style="margin-left:auto;display:flex;align-items:center;gap:10px;position:relative;">
                <button id="notif-bell" onclick="notificationManager.openPanel()" title="Notifications"
                    style="position:relative;background:none;border:none;cursor:pointer;padding:8px;color:var(--rv-muted);font-size:18px;border-radius:10px;transition:background 0.15s;"
                    onmouseover="this.style.background='rgba(26,86,219,0.1)'" onmouseout="this.style.background='none'">
                    <i class="fas fa-bell"></i>
                    <span id="notif-badge" style="display:none;position:absolute;top:2px;right:2px;min-width:16px;height:16px;background:#ef4444;border-radius:20px;font-size:9px;font-weight:800;color:#fff;align-items:center;justify-content:center;padding:0 3px;"></span>
                </button>
            </div>
        `;
        nav.insertAdjacentHTML('beforeend', bellHtml);
    },

    // Notify all parents (broadcast)
    async notifyParents(title, message, type) {
        try {
            for (const parent of state.parents) {
                if (!parent.profile_id) continue;
                await supabaseClient.from('notifications').insert([{
                    user_id: parent.profile_id,
                    title,
                    message,
                    type: type || 'system',
                    read: false,
                    created_by: state.currentUser?.id,
                    created_at: new Date().toISOString()
                }]);
            }
        } catch (err) {
            console.warn('Notify parents error:', err);
        }
    },

    // Notify parents of a specific student
    async notifyParentsOfStudent(studentId, title, message, type) {
        try {
            const linkedParents = state.parents.filter(p => p.children_ids?.includes(studentId));
            for (const parent of linkedParents) {
                if (!parent.profile_id) continue;
                await supabaseClient.from('notifications').insert([{
                    user_id: parent.profile_id,
                    title,
                    message,
                    type: type || 'system',
                    read: false,
                    created_by: state.currentUser?.id,
                    created_at: new Date().toISOString()
                }]);
            }
        } catch (err) {
            console.warn('Notify parents of student error:', err);
        }
    }
};
