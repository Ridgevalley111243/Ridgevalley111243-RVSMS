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
                        <span style="color:#fff;font-size:17px;font-weight:700;line-height:1.3;">${title}</span>
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
                <p class="text-slate-700 dark:text-slate-300">Are you sure you want to delete <strong class="text-slate-900 dark:text-white">${itemName}</strong>?</p>
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
                    <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-pen text-white text-xl"></i>
                    </div>
                    <h3 class="text-xl font-bold mb-4 text-slate-800 dark:text-white text-center">${title}</h3>
                    <input type="text" id="${modalId}-input" class="w-full rounded-xl px-4 py-3 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 mb-6 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-800 dark:text-white" value="${defaultValue}" placeholder="Enter value...">
                    <div class="flex gap-3">
                        <button id="${modalId}-cancel" class="flex-1 py-3 px-4 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">Cancel</button>
                        <button id="${modalId}-confirm" class="flex-1 py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg">OK</button>
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
                        <div class="w-10 h-10 bg-gradient-to-br from-ridge-500 to-blue-500 rounded-xl flex items-center justify-center">
                            <i class="fas fa-user-graduate text-white"></i>
                        </div>
                        <h3 class="text-xl font-bold text-slate-800 dark:text-white">${title}</h3>
                    </div>
                    <div class="relative mb-4">
                        <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400"></i>
                        <input type="text" id="${modalId}-search" class="w-full rounded-xl pl-10 pr-4 py-3 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-ridge-500 focus:border-transparent outline-none transition-all text-slate-800 dark:text-white" placeholder="Search by name...">
                    </div>
                    <div id="${modalId}-results" class="overflow-y-auto flex-1 max-h-96 space-y-2 pr-2">
                        ${students.length === 0 ? '<p class="text-center text-slate-500 py-4">No students available</p>' : students.map(s => `
                            <div class="p-4 bg-slate-50 dark:bg-slate-700 rounded-xl cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-600 transition-all border-2 border-transparent hover:border-blue-200 dark:hover:border-blue-800 student-result ${s.disabled ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${s.id}" data-name="${s.name}">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-ridge-500 to-blue-500 flex items-center justify-center text-white font-bold">
                                        ${s.name.charAt(0)}
                                    </div>
                                    <div class="flex-1">
                                        <div class="font-semibold text-slate-800 dark:text-white">${s.name}</div>
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
                        <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center">
                            <i class="fas fa-calendar-alt text-white"></i>
                        </div>
                        <h3 class="text-xl font-bold text-slate-800 dark:text-white">${title}</h3>
                    </div>
                    <div class="space-y-3 max-h-96 overflow-y-auto">
                        ${terms.length === 0 ? '<p class="text-center text-slate-500 py-4">No terms available</p>' : terms.map(t => `
                            <button onclick="document.getElementById('${modalId}').dataset.selected='${t.id}'; document.getElementById('${modalId}-confirm').click();" 
                                class="w-full p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border-2 border-transparent hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-slate-600 transition-all text-left group">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <div class="font-bold text-slate-800 dark:text-white group-hover:text-blue-600 transition-colors">${t.name}</div>
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
                            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                                <i class="fas fa-file-pdf text-white"></i>
                            </div>
                            <h3 class="text-xl font-bold text-slate-800 dark:text-white">${title}</h3>
                        </div>
                        <button id="${modalId}-close" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900 rounded-xl mb-4 min-h-[400px] border border-slate-200 dark:border-slate-700">
                        <iframe src="${fileUrl}" class="w-full h-full min-h-[400px] rounded-lg" frameborder="0"></iframe>
                    </div>
                    <div class="flex gap-3">
                        <button id="${modalId}-notify" class="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl font-bold hover:from-amber-600 hover:to-amber-700 transition-all shadow-lg">
                            <i class="fas fa-exclamation-triangle mr-2"></i> Notify Admin (Issue)
                        </button>
                        <button id="${modalId}-publish" class="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-bold hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-lg">
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
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
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

function setupRealtimeSubscriptions() {
    const channels = [
        supabaseClient.channel('public:academic_years').on('postgres_changes', { event: '*', schema: 'public', table: 'academic_years' }, () => actions.refreshData()),
        supabaseClient.channel('public:classes').on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, () => actions.refreshData()),
        supabaseClient.channel('public:students').on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => actions.refreshData()),
        supabaseClient.channel('public:teachers').on('postgres_changes', { event: '*', schema: 'public', table: 'teachers' }, () => actions.refreshData()),
        supabaseClient.channel('public:parents').on('postgres_changes', { event: '*', schema: 'public', table: 'parents' }, () => actions.refreshData()),
        supabaseClient.channel('public:transactions').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => actions.refreshData()),
        supabaseClient.channel('public:fees').on('postgres_changes', { event: '*', schema: 'public', table: 'fees' }, () => actions.refreshData()),
        supabaseClient.channel('public:reports').on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => actions.refreshData()),
        supabaseClient.channel('public:received_reports').on('postgres_changes', { event: '*', schema: 'public', table: 'received_reports' }, () => actions.refreshData())
    ];
    
    channels.forEach(channel => channel.subscribe());
}

function showNetworkErrorUI() {
    const landing = document.getElementById('landing-page');
    if (landing) {
        landing.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
                <div class="text-center max-w-md w-full bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-slate-700">
                    <div class="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                        <i class="fas fa-wifi text-3xl text-red-500"></i>
                    </div>
                    <h2 class="text-2xl font-bold mb-2 text-slate-800 dark:text-white">Connection Error</h2>
                    <p class="text-slate-500 mb-6">Unable to connect to server. Please check your internet connection.</p>
                    <button onclick="location.reload()" class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
            
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('id, role, approved, is_super_admin')
                .eq('role', 'admin')
                .limit(1);

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

            if (!data || data.length === 0) {
                this.showSetupModal();
                return;
            }

            const landing = document.getElementById('landing-page');
            if (landing) {
                landing.innerHTML = `
                    <div class="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
                        <div class="mb-8 animate-fade-in">
                            <div class="w-24 h-24 bg-gradient-to-br from-ridge-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl transform hover:scale-105 transition-transform">
                                <i class="fas fa-school text-4xl text-white"></i>
                            </div>
                            <h1 class="text-5xl font-black text-slate-800 dark:text-white mb-3 bg-clip-text text-transparent bg-gradient-to-r from-ridge-600 to-blue-600">Ridgevalley SMS</h1>
                            <p class="text-slate-500 text-lg">School Management System</p>
                        </div>
                        <button onclick="app.enterPortal()" class="px-8 py-4 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-2xl font-bold text-lg hover:shadow-xl transition-all hover:scale-105 shadow-lg">
                            Enter Portal <i class="fas fa-arrow-right ml-2"></i>
                        </button>
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
                    <div class="w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <i class="fas fa-cog text-3xl text-white animate-spin-slow"></i>
                    </div>
                    <h2 class="text-2xl font-bold mb-2 text-slate-800 dark:text-white">System Setup Required</h2>
                    <p class="text-slate-500 mb-6">No administrator found. Create the first admin account to get started.</p>
                    <button onclick="document.getElementById('system-inactive-modal').classList.add('hidden'); app.enterPortal();" 
                            class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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

            state.currentUser = { ...user, ...profile };
            state.role = profile.role;

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
            
            if (state.role === 'admin') ui.route('overview');
            else if (state.role === 'teacher') ui.route('teacher_dashboard');
            else if (state.role === 'parent') ui.route('parent_dashboard');
            
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
            if (role === 'admin') {
                forgotSection.classList.add('hidden');
                adminNote.classList.remove('hidden');
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
            panel.className = 'min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800';
            panel.innerHTML = `
                <div class="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8">
                    <div class="text-center mb-8">
                        <div class="w-16 h-16 bg-gradient-to-br from-ridge-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
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
                            class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                    matchMsg.textContent = '✓ Passwords match';
                    matchMsg.className   = 'text-xs mt-1 text-emerald-600 dark:text-emerald-400 font-semibold';
                } else {
                    matchMsg.textContent = '✗ Passwords do not match';
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
            err.textContent = '⚠ ' + message;
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
                    const { data: profileRows } = await supabaseClient
                        .from('profiles')
                        .select('email')
                        .eq('phone', normalisedPhone)
                        .limit(1);
                    if (profileRows && profileRows.length > 0) {
                        loginEmail = profileRows[0].email;
                    } else {
                        const { data: parentRows } = await supabaseClient
                            .from('parents')
                            .select('email')
                            .eq('phone', normalisedPhone)
                            .limit(1);
                        if (parentRows && parentRows.length > 0) {
                            loginEmail = parentRows[0].email;
                        } else {
                            app.hideLoading();
                            modal.alert('Login Failed', 'No account found with that phone number. Please use your email address.', 'error');
                            return;
                        }
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
            await app.loadUserData(data.user);
        } catch (error) {
            app.hideLoading();
            modal.alert('Login Failed', extractErrorMessage(error), 'error');
        }
    },

    async register(name, email, password) {
        app.showLoading('Creating account...');
        try {
            const { data: existing } = await supabaseClient
                .from('profiles')
                .select('email')
                .eq('email', email)
                .maybeSingle();

            if (existing) {
                app.hideLoading();
                modal.alert('Registration Failed', 'Email already exists', 'error');
                return;
            }

            // Get phone number if parent role — already validated & normalised by handleAction
            const rawPhone = document.getElementById('auth-phone')?.value?.trim() || null;
            const phoneInput = rawPhone ? (ghanaPhone.validate(rawPhone).normalised || rawPhone) : null;

            const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: name, role: state.role }
                }
            });

            if (authError) throw authError;

            const profileData = {
                id: authData.user.id,
                email: email,
                full_name: name,
                role: state.role,
                phone: phoneInput || null,
                approved: state.role !== 'admin',
                created_at: new Date().toISOString()
            };

            const { error: profileError } = await supabaseClient
                .from('profiles')
                .insert([profileData]);

            if (profileError) throw profileError;

            if (state.role === 'teacher') {
                const { error: teacherError } = await supabaseClient.from('teachers').insert([{
                    profile_id: authData.user.id,
                    email: email,
                    full_name: name,
                    assigned_class: null
                }]);
                if (teacherError) throw new Error('Profile created but failed to register teacher record: ' + teacherError.message);
            } else if (state.role === 'parent') {
                const { error: parentError } = await supabaseClient.from('parents').insert([{
                    profile_id: authData.user.id,
                    email: email,
                    full_name: name,
                    phone: phoneInput || null,
                    children_ids: []
                }]);
                if (parentError) throw new Error('Profile created but failed to register parent record: ' + parentError.message);
            }

            app.hideLoading();
            modal.alert(
                state.role === 'admin' ? 'Registration Successful' : 'Account Created', 
                state.role === 'admin' ? 'Your account is pending approval from a super admin.' : 'Please verify your email address.', 
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
        location.reload();
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
                .select('id, profile_id, children_ids, email, full_name, phone');

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
                    .select('id, profile_id, children_ids, email, full_name, phone');
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
                    .in('type', ['payment', 'report_submitted', 'child_linked', 'system', 'report_correction'])
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
        try {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('id, full_name, email, role, approved, created_at')
                .eq('role', 'admin')
                .eq('approved', false);
            if (error) throw error;
            state.pendingAdmins = (data || []).map(p => ({ ...p, profile_id: p.id }));
        } catch (err) {
            console.error('loadPendingAdmins error:', err);
            state.pendingAdmins = [];
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
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&display=swap');

                :root {
                    --rv-navy:      #0f2044;
                    --rv-blue:      #1a56db;
                    --rv-blue-light:#3b82f6;
                    --rv-gold:      #f59e0b;
                    --rv-emerald:   #059669;
                    --rv-red:       #dc2626;
                    --rv-surface:   #ffffff;
                    --rv-bg:        #f1f5fb;
                    --rv-border:    #e2e8f0;
                    --rv-text:      #0f172a;
                    --rv-muted:     #64748b;
                    --rv-sidebar-w: 260px;
                    --rv-radius:    14px;
                    --rv-shadow:    0 2px 16px rgba(15,32,68,0.08);
                    --rv-shadow-md: 0 4px 32px rgba(15,32,68,0.12);
                }

                .dark {
                    --rv-surface: #1e293b;
                    --rv-bg:      #0f172a;
                    --rv-border:  #334155;
                    --rv-text:    #f1f5f9;
                    --rv-muted:   #94a3b8;
                }

                *, *::before, *::after { box-sizing: border-box; }

                body {
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    background: var(--rv-bg);
                    color: var(--rv-text);
                }

                /* ── Sidebar ── */
                #admin-sidebar {
                    background: var(--rv-navy) !important;
                    border-right: none !important;
                    width: var(--rv-sidebar-w) !important;
                }

                .rv-sidebar-logo {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 20px 20px 14px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                    margin-bottom: 8px;
                }

                .rv-sidebar-logo img {
                    width: 36px;
                    height: 36px;
                    object-fit: contain;
                    border-radius: 8px;
                }

                .rv-sidebar-logo-fallback {
                    width: 36px;
                    height: 36px;
                    background: var(--rv-blue);
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 800;
                    font-size: 16px;
                }

                .rv-sidebar-school { font-weight: 700; font-size: 14px; color: white; line-height: 1.2; }
                .rv-sidebar-tagline { font-size: 9px; color: rgba(255,255,255,0.45); letter-spacing: 1px; text-transform: uppercase; }

                .sidebar-item {
                    font-family: 'Plus Jakarta Sans', sans-serif !important;
                    font-size: 13px !important;
                    font-weight: 500 !important;
                    color: rgba(255,255,255,0.6) !important;
                    padding: 10px 16px !important;
                    border-radius: 10px !important;
                    margin: 1px 8px !important;
                    width: calc(100% - 16px) !important;
                    border-left: none !important;
                    transition: all 0.18s ease !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 10px !important;
                    background: transparent !important;
                }

                .sidebar-item:hover {
                    background: rgba(255,255,255,0.08) !important;
                    color: white !important;
                }

                .sidebar-item.active {
                    background: var(--rv-blue) !important;
                    color: white !important;
                    font-weight: 700 !important;
                    box-shadow: 0 4px 12px rgba(26,86,219,0.35) !important;
                }

                .sidebar-item i { width: 18px; text-align: center; font-size: 13px; opacity: 0.85; }
                .sidebar-item.active i { opacity: 1; }

                /* Sidebar user card */
                .rv-user-card {
                    margin: 8px;
                    padding: 12px 14px;
                    background: rgba(255,255,255,0.06);
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
                    background: var(--rv-blue);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 800;
                    font-size: 15px;
                    flex-shrink: 0;
                }

                /* ── Top nav bar ── */
                #main-nav {
                    background: var(--rv-surface) !important;
                    border-bottom: 1px solid var(--rv-border) !important;
                    box-shadow: 0 1px 8px rgba(15,32,68,0.06) !important;
                    height: 60px;
                    display: flex;
                    align-items: center;
                    padding: 0 20px;
                    position: sticky;
                    top: 0;
                    z-index: 40;
                }

                /* ── Cards / panels ── */
                .glass-panel, .rv-card {
                    background: var(--rv-surface) !important;
                    border: 1px solid var(--rv-border) !important;
                    box-shadow: var(--rv-shadow) !important;
                    border-radius: var(--rv-radius) !important;
                    transition: box-shadow 0.2s, transform 0.2s;
                }

                .card-hover:hover {
                    box-shadow: var(--rv-shadow-md) !important;
                    transform: translateY(-2px);
                }

                /* ── Stat cards ── */
                .rv-stat {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .rv-stat-icon {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    margin-bottom: 12px;
                }

                .rv-stat-value {
                    font-family: 'Outfit', sans-serif;
                    font-size: 32px;
                    font-weight: 700;
                    color: var(--rv-text);
                    line-height: 1;
                }

                .rv-stat-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--rv-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.8px;
                }

                /* ── Inputs ── */
                .input-field {
                    font-family: 'Plus Jakarta Sans', sans-serif !important;
                    font-size: 13.5px !important;
                    border: 1.5px solid var(--rv-border) !important;
                    border-radius: 10px !important;
                    padding: 10px 14px !important;
                    background: var(--rv-surface) !important;
                    color: var(--rv-text) !important;
                    transition: border-color 0.15s, box-shadow 0.15s !important;
                    outline: none !important;
                }

                .input-field:focus {
                    border-color: var(--rv-blue) !important;
                    box-shadow: 0 0 0 3px rgba(26,86,219,0.12) !important;
                }

                /* ── Buttons ── */
                button[onclick], .rv-btn {
                    font-family: 'Plus Jakarta Sans', sans-serif !important;
                    font-weight: 600 !important;
                    letter-spacing: 0.2px;
                }

                /* ── Tables ── */
                table { border-collapse: collapse; }
                thead th {
                    font-size: 11px !important;
                    letter-spacing: 0.8px !important;
                    text-transform: uppercase !important;
                    font-weight: 700 !important;
                    color: var(--rv-muted) !important;
                    background: var(--rv-bg) !important;
                }

                /* ── Section headings ── */
                h2.rv-page-title, h2[class*="text-2xl font-bold"] {
                    font-family: 'Outfit', sans-serif !important;
                    font-weight: 700 !important;
                    color: var(--rv-navy) !important;
                    font-size: 22px !important;
                }

                .dark h2.rv-page-title, .dark h2[class*="text-2xl font-bold"] {
                    color: white !important;
                }

                /* ── Badges ── */
                .rv-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 10px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.3px;
                }

                /* ── Loading spinner ── */
                #loading-overlay {
                    backdrop-filter: blur(4px) !important;
                }

                /* ── Dashboard content area ── */
                #view-content {
                    padding: 24px !important;
                    max-width: 1200px;
                }

                /* ── Sidebar section labels ── */
                .rv-nav-section {
                    font-size: 9px;
                    font-weight: 800;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                    color: rgba(255,255,255,0.3);
                    padding: 12px 24px 4px;
                    margin-top: 4px;
                }

                /* ── Logout button at sidebar bottom ── */
                .rv-logout {
                    margin: 8px;
                    padding: 10px 16px;
                    border-radius: 10px;
                    background: rgba(220,38,38,0.12);
                    color: #fca5a5 !important;
                    font-size: 13px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    width: calc(100% - 16px);
                    border: none;
                    cursor: pointer;
                    transition: background 0.18s;
                    text-align: left;
                }
                .rv-logout:hover { background: rgba(220,38,38,0.22) !important; }

                /* ── Period pill in top nav ── */
                .rv-period-pill {
                    background: rgba(26,86,219,0.08);
                    color: var(--rv-blue);
                    border: 1px solid rgba(26,86,219,0.2);
                    border-radius: 20px;
                    padding: 4px 12px;
                    font-size: 12px;
                    font-weight: 600;
                }

                /* ── Announcement inbox cards ── */
                .rv-msg-card {
                    border-left: 3px solid var(--rv-blue);
                    transition: transform 0.15s;
                }
                .rv-msg-card:hover { transform: translateX(3px); }

                /* Smooth fade-in for view content */
                @keyframes rv-fade {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                #view-content > * { animation: rv-fade 0.22s ease; }

                /* ── Mobile Responsive ── */
                @media (max-width: 768px) {
                    /* Sidebar: z-index is handled by mobile-fix.css.
                     * Only set transform/transition here; do NOT set z-index
                     * as it would override mobile-fix.css (z-index: 9500). */
                    #admin-sidebar {
                        position: fixed !important;
                        left: 0 !important;
                        top: 0 !important;
                        bottom: 0 !important;
                        /* z-index intentionally omitted — see mobile-fix.css */
                        transform: translateX(-100%) !important;
                        transition: transform 0.3s ease !important;
                        width: 260px !important;
                    }
                    #admin-sidebar.mobile-open {
                        transform: translateX(0) !important;
                    }

                    /* Always show hamburger on mobile */
                    #drawer-btn { display: flex !important; }

                    /* Main content takes full width on mobile */
                    #main-content {
                        margin-left: 0 !important;
                        width: 100% !important;
                    }

                    /* Top nav adjustments */
                    #main-nav {
                        padding: 0 12px !important;
                        gap: 8px !important;
                    }

                    /* View content padding reduced */
                    #view-content {
                        padding: 14px !important;
                    }

                    /* Tables scroll horizontally */
                    .overflow-x-auto, table {
                        display: block;
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                    }

                    /* Stat cards: 2-col grid on mobile */
                    .grid-cols-4 { grid-template-columns: repeat(2, 1fr) !important; }
                    .grid-cols-3 { grid-template-columns: repeat(2, 1fr) !important; }
                    .grid-cols-2 { grid-template-columns: repeat(1, 1fr) !important; }

                    /* Column mapping: stack on mobile */
                    .bulk-map-grid {
                        grid-template-columns: 1fr !important;
                    }

                    /* Reduce font sizes on very small screens */
                    .rv-stat-value { font-size: 24px !important; }

                    /* Full-width buttons in modals */
                    .modal-btn-row {
                        flex-direction: column !important;
                    }

                    /* Cards: reduce padding */
                    .rv-card, .glass-panel {
                        padding: 14px !important;
                    }

                    /* Period pill: hide on very small */
                    .rv-period-pill {
                        display: none !important;
                    }
                }

                @media (max-width: 480px) {
                    #main-nav { padding: 0 10px !important; }
                    #view-content { padding: 10px !important; }
                    .grid-cols-4, .grid-cols-3 { grid-template-columns: repeat(1, 1fr) !important; }
                    .rv-stat-value { font-size: 20px !important; }
                    .sidebar-item { font-size: 14px !important; padding: 12px 16px !important; }
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
            { id: 'finance',             label: 'Finance',            icon: 'fa-wallet' },
            { id: 'received_reports',    label: 'Received Reports',   icon: 'fa-file-import' },
            { id: 'admin_upload_reports',label: 'Upload Reports',     icon: 'fa-cloud-upload-alt' },
            { id: 'screenshots',         label: 'Payment Proofs',     icon: 'fa-image' },
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

        const roleMap = { admin: adminItems, teacher: teacherItems, parent: parentItems };
        const roleLabel = { admin: 'Administrator', teacher: 'Teacher', parent: 'Parent' };
        if (roleEl) roleEl.textContent = roleLabel[state.role] || '';

        const items = roleMap[state.role] || adminItems;

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
                    case 'academic':               views.renderAcademic(); break;
                    case 'classes':                views.renderClasses(); break;
                    case 'students':               views.renderStudents(); break;
                    case 'teachers':               views.renderTeachers(); break;
                    case 'parents':                views.renderParents(); break;
                    case 'finance':                views.renderFinance(); break;
                    case 'attendance':             /* attendance removed */ break;
                    case 'received_reports':       views.renderReceivedReports(); break;
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
                    default: views.renderOverview();
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
                                <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">${err.message || 'An unexpected error occurred loading this section.'}</p>
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
                className: "rounded-lg shadow-lg font-medium",
                stopOnFocus: true
            }).showToast();
        } else {
            modal.alert(type.toUpperCase(), msg, type);
        }
    }
};

// ==================== VIEWS ====================
const views = {
    renderOverview() {
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
        const pendingReports = state.receivedReports.filter(r => r.status === 'pending_review').length;

        const stats = [
            { label: 'Students',       value: totalStudents,          icon: 'fa-user-graduate',      color: '#1a56db', bg: 'rgba(26,86,219,0.1)',  action: "views.showDetailModal('students')" },
            { label: 'Teaching Staff', value: totalTeachers,          icon: 'fa-chalkboard-teacher', color: '#059669', bg: 'rgba(5,150,105,0.1)',   action: "views.showDetailModal('teachers')" },
            { label: 'Classes',        value: totalClasses,           icon: 'fa-school',             color: '#7c3aed', bg: 'rgba(124,58,237,0.1)',  action: "views.showDetailModal('classes')" },
            { label: 'Parents',        value: totalParents,           icon: 'fa-users',              color: '#0891b2', bg: 'rgba(8,145,178,0.1)',   action: '' },
            { label: 'Revenue (₵)',    value: totalRevenue.toLocaleString(), icon: 'fa-wallet',      color: '#059669', bg: 'rgba(5,150,105,0.1)',   action: "views.showDetailModal('revenue')" },
            { label: 'Arrears (₵)',    value: totalArrears.toLocaleString(), icon: 'fa-exclamation-triangle', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', action: "views.showDetailModal('arrears')" },
        ];

        const html = `
            <!-- Page header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                <div>
                    <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0;">Dashboard Overview</h2>
                    <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:2px 0 0;">${state.currentAY?.year || ''} ${state.currentTerm ? '· ' + state.currentTerm.name : ''}</p>
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
                        <div style="width:44px;height:44px;border-radius:12px;background:${s.bg};display:flex;align-items:center;justify-content:center;margin-bottom:14px;">
                            <i class="fas ${s.icon}" style="color:${s.color};font-size:18px;"></i>
                        </div>
                        <div style="font-family:'Outfit',sans-serif;font-size:28px;font-weight:700;color:${_vc};line-height:1;">${_valHtml}</div>
                        <div style="font-size:11px;font-weight:700;color:var(--rv-muted);text-transform:uppercase;letter-spacing:0.8px;margin-top:4px;">${s.label}</div>
                    </div>
                `;}).join('')}
            </div>

            <!-- Alert row -->
            ${(pendingPayments > 0 || pendingReports > 0) ? `
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
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

                <!-- Arrears table -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                        <h3 style="font-size:14px;font-weight:700;color:var(--rv-text);margin:0;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-exclamation-circle" style="color:#dc2626;"></i> Students with Arrears
                        </h3>
                        ${allArrears.length > 5 ? `<button onclick="ui.route('finance')" style="font-size:11px;font-weight:700;color:#1a56db;background:none;border:none;cursor:pointer;">View all →</button>` : ''}
                    </div>
                    ${allArrears.length === 0
                        ? `<p style="text-align:center;color:var(--rv-muted);padding:24px 0;font-size:13px;">No outstanding arrears 🎉</p>`
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
                                            <td style="padding:10px 12px;font-weight:600;color:var(--rv-text);">${a.studentName}</td>
                                            <td style="padding:10px 12px;color:var(--rv-muted);">${a.studentClass}</td>
                                            <td style="padding:10px 12px;text-align:right;font-weight:700;color:#dc2626;">₵<span class="rv-money-val" data-raw="${a.amount.toFixed(2)}">${window._rvMoneyHidden ? '•••' : a.amount.toFixed(2)}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>`
                    }
                </div>

                <!-- Recent notifications -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow);">
                    <h3 style="font-size:14px;font-weight:700;color:var(--rv-text);margin:0 0 14px;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-bell" style="color:#1a56db;"></i> Recent Notifications
                    </h3>
                    <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">
                        ${state.notifications.length > 0
                            ? state.notifications.slice(0, 6).map(n => `
                                <div style="padding:10px 14px;border-radius:10px;background:var(--rv-bg);border-left:3px solid ${n.read ? 'var(--rv-border)' : '#1a56db'};">
                                    <p style="font-weight:700;font-size:12.5px;color:var(--rv-text);margin:0;">${n.title}</p>
                                    <p style="font-size:11.5px;color:var(--rv-muted);margin:2px 0 0;">${n.message?.substring(0, 80)}${n.message?.length > 80 ? '...' : ''}</p>
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
                                        <td class="px-4 py-2 font-semibold">${s.name}</td>
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
                                <p class="font-semibold">${t.full_name}</p>
                                <p class="text-sm text-slate-500">${t.email}</p>
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
                                        <td class="px-4 py-2 font-semibold">${a.studentName}</td>
                                        <td class="px-4 py-2 text-slate-500">${a.parentName}</td>
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
                            <button onclick="actions.addAcademicYear()" class="px-6 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                                <button onclick="actions.addTermPrompt('${activeYear.id}')" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all">
                                    <i class="fas fa-plus"></i> Add Term
                                </button>
                            </div>
                        </div>
                        
                        <div class="flex flex-wrap gap-2">
                            ${(activeYear.terms || []).length === 0 ? '<span class="text-sm text-slate-400">No terms added yet</span>' : ''}
                            ${(activeYear.terms || []).map(term => `
                                <button onclick="actions.activateTerm('${activeYear.id}', '${term.id}')" 
                                        class="px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all ${term.active ? 'border-ridge-500 text-ridge-600 bg-ridge-50 dark:bg-ridge-900/20 shadow-md' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-ridge-300 hover:bg-slate-50'}">
                                    ${term.name} ${term.active ? '✓' : ''}
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
                                        <button onclick="actions.activateYear('${year.id}')" class="px-4 py-2 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all">
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
                        <div class="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <i class="fas fa-calendar-week text-blue-600 dark:text-blue-400 text-sm"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-bold text-slate-800 dark:text-white">Academic Weeks</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400">Manage weekly periods for attendance, finance &amp; planning</p>
                        </div>
                    </div>
                    <button onclick="ui.route('weeks')"
                        class="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
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
                    <button onclick="actions.addClass()" class="px-6 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                    <button onclick="actions.openBulkUploadWizard()" class="px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg font-bold text-sm hover:shadow-lg transition-all">
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
                    <button onclick="actions.addStudent()" class="md:col-span-3 px-6 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                        <div style="padding:14px 24px;background:linear-gradient(135deg,#1a56db,#7c3aed);display:flex;align-items:center;justify-content:space-between;">
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
                                            <td class="px-5 py-3 font-mono text-xs text-ridge-600 dark:text-ridge-400 font-bold">${s.admission_number || '—'}</td>
                                            <td class="px-5 py-3 font-semibold text-slate-800 dark:text-slate-200">${s.name}</td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">
                                                ${s.gender ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${s.gender.toLowerCase().startsWith('m') ? 'rgba(59,130,246,0.15)' : s.gender.toLowerCase().startsWith('f') ? 'rgba(236,72,153,0.15)' : 'rgba(100,116,139,0.15)'};color:${s.gender.toLowerCase().startsWith('m') ? '#3b82f6' : s.gender.toLowerCase().startsWith('f') ? '#ec4899' : '#64748b'};">
                                                    <i class="fas fa-${s.gender.toLowerCase().startsWith('m') ? 'mars' : s.gender.toLowerCase().startsWith('f') ? 'venus' : 'genderless'}"></i>
                                                    ${s.gender}
                                                </span>` : '<span style="color:#64748b;">—</span>'}
                                            </td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">${s.dob ? new Date(s.dob).toLocaleDateString('en-GB') : '—'}</td>
                                            <td class="px-5 py-3 text-slate-800 dark:text-slate-200">${s.age || '—'}</td>
                                            <td class="px-5 py-3 text-slate-600 dark:text-slate-400">${s.parent_phone || '—'}</td>
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
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${t.full_name}</td>
                                        <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${t.email}</td>
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
                                            <button onclick="actions.deleteTeacher('${t.profile_id}', '${t.full_name}')" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
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
                                            <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${p.full_name}</td>
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${p.email}</td>
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${p.phone || '—'}</td>
                                            <td class="px-6 py-4 text-sm max-w-xs truncate text-slate-600 dark:text-slate-400" title="${children}">${children}</td>
                                            <td class="px-6 py-4 text-right">
                                                <button onclick="actions.editParentChildren('${p.id}')" class="text-blue-500 hover:text-blue-700 mr-3 transition-colors p-2" title="Edit Children">
                                                    <i class="fas fa-edit"></i>
                                                </button>
                                                <button onclick="actions.deleteParent('${p.id}', '${p.full_name}')" class="text-red-500 hover:text-red-700 transition-colors p-2" title="Delete">
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
                    <select id="fee-scope" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="global">Global (All Students)</option>
                        ${[...new Set(state.classes.map(c => c.level))].map(l => `<option value="${l}">Level: ${l}</option>`).join('')}
                    </select>
                    <input type="number" id="fee-amount" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Amount (₵)">
                    <input type="text" id="fee-desc" class="input-field w-full rounded-xl px-4 py-3 mb-4 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Description">
                    <button onclick="actions.addFee()" class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${fee.description}</p>
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
                                        <td class="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">${a.studentName}</td>
                                        <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${a.studentClass}</td>
                                        <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${a.parentName}</td>
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
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${student?.name || 'Unknown'}</p>
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
                                            <td class="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">${student?.name || 'Unknown'}</td>
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
                                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-ridge-500 to-blue-500 flex items-center justify-center text-white font-bold">
                                                ${report.teacher_name ? report.teacher_name.charAt(0) : 'T'}
                                            </div>
                                            <div>
                                                <h4 class="font-bold text-slate-800 dark:text-white text-lg">${report.teacher_name || 'Unknown Teacher'}</h4>
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
                                        <button onclick="actions.viewReceivedReportDetail('${report.id}')" class="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2">
                                            <i class="fas fa-eye"></i> View Details
                                        </button>
                                        <button onclick="actions.downloadReportBundle('${report.id}')" class="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2">
                                            <i class="fas fa-download"></i> Download All
                                        </button>
                                        <div class="flex gap-2">
                                            <button onclick="actions.approveReportBundle('${report.id}')" class="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all">
                                                <i class="fas fa-check"></i> Approve
                                            </button>
                                            <button onclick="actions.rejectReportBundle('${report.id}')" class="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all">
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
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${report.teacher_name || 'Unknown'}</td>
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
                                            <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow ${existing ? 'bg-emerald-500' : 'bg-gradient-to-br from-ridge-500 to-blue-600'}">
                                                ${existing ? '<i class="fas fa-check text-xs"></i>' : student.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <p class="font-bold ${existing ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-800 dark:text-slate-200'}">${student.name}</p>
                                                <p class="text-xs ${existing ? 'text-emerald-500 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}">${existing ? 'Report uploaded ✓' : (student.student_id || student.id)}</p>
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
                                                <button onclick="actions.undoStudentReport('${existing.id}', '${student.name.replace(/'/g, "\\'")}')"
                                                    class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors flex items-center gap-1">
                                                    <i class="fas fa-undo"></i> Undo
                                                </button>
                                            ` : `
                                                <label class="cursor-pointer flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl text-sm font-bold hover:shadow-lg transition-all">
                                                    <i class="fas fa-cloud-upload-alt"></i>
                                                    Upload Report
                                                    <input type="file" accept=".pdf,.doc,.docx" class="hidden"
                                                        onchange="actions.uploadStudentReport('${student.id}', '${student.name.replace(/'/g, "\\'")}', this)">
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
                                            <td class="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">${student?.name || 'Unknown'}</td>
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
                                                    <button onclick="actions.undoStudentReport('${report.id}', '${(student?.name || 'this student').replace(/'/g, "\\'")}')"
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
                            <div class="relative h-48 bg-slate-100 dark:bg-slate-700 overflow-hidden cursor-pointer" onclick="window.open('${t.proof}', '_blank')">
                                <img src="${t.proof}" alt="Payment Proof" class="w-full h-full object-cover hover:scale-105 transition-transform">
                                <div class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                    <span class="text-white font-bold"><i class="fas fa-search-plus mr-2"></i>View Full Image</span>
                                </div>
                            </div>
                            <div class="p-4">
                                <div class="flex justify-between items-start mb-2">
                                    <div>
                                        <p class="font-bold text-slate-800 dark:text-white">${student?.name || 'Unknown Student'}</p>
                                        <p class="text-sm text-slate-500">${student?.class || ''}</p>
                                    </div>
                                    <span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">Pending</span>
                                </div>
                                <div class="space-y-1 text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    <p><i class="fas fa-user mr-2"></i>Parent: ${parent?.full_name || 'Unknown'}</p>
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

    renderApprovals() {
        // Pending admins are in profiles with role='admin', not in teachers table
        const pendingAdmins = state.pendingAdmins || [];
        
        const html = `
            <h2 class="text-2xl font-bold mb-6 text-slate-800 dark:text-white">Pending Approvals</h2>
            
            <div class="space-y-4">
                ${pendingAdmins.length === 0 ? '<div class="text-center py-12 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">No pending approvals</div>' : pendingAdmins.map(admin => `
                    <div class="glass-panel rounded-2xl p-6 flex items-center justify-between bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <h3 class="font-bold text-lg text-slate-800 dark:text-white">${admin.full_name}</h3>
                            <p class="text-sm text-slate-500">${admin.email}</p>
                            <span class="inline-block mt-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">Pending Approval</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="actions.approveAdmin('${admin.profile_id}')" class="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                                <i class="fas fa-check mr-2"></i> Approve
                            </button>
                            <button onclick="actions.rejectAdmin('${admin.profile_id}')" class="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
            const targetLabel = { all: 'All Users', teachers: 'Teachers', parents: 'Parents' };

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
                        </div>
                        <button onclick="actions.sendAnnouncement()"
                            class="px-6 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                                            <p class="font-bold text-slate-800 dark:text-white">${n.title}</p>
                                            <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">${n.message}</p>
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
        const roleLabel = state.role === 'teacher' ? 'Teacher' : 'Parent';

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
                                <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-700/50 dark:to-slate-800 hover:shadow-md transition-shadow">
                                    <div class="flex items-start gap-4">
                                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-ridge-500 to-blue-600 flex items-center justify-center shrink-0 shadow">
                                            <i class="fas fa-bullhorn text-white text-sm"></i>
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center justify-between gap-2 mb-1">
                                                <p class="font-bold text-slate-800 dark:text-white">${n.title}</p>
                                                <p class="text-xs text-slate-400 shrink-0">${new Date(n.created_at).toLocaleString()}</p>
                                            </div>
                                            <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">${n.message}</p>
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
                            <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">${err.message || 'An unexpected error occurred.'}</p>
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

        // Report status: look up received_reports submitted by this teacher
        const teacherBundles = state.receivedReports.filter(r => r.teacher_id === state.currentUser?.id);
        const pendingBundles = teacherBundles.filter(r => r.status === 'pending_review');
        const approvedBundles = teacherBundles.filter(r => r.status === 'reviewed');
        const rejectedBundles = teacherBundles.filter(r => r.status === 'rejected');

        const html = `
            <div class="mb-6">
                <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0 0 4px;">My Dashboard</h2>
                <p style="font-size:13px;color:var(--rv-muted,#64748b);">Welcome, ${state.currentUser?.full_name || 'Teacher'}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div class="glass-panel p-6 rounded-2xl border-l-4 border-ridge-500 bg-white dark:bg-slate-800 shadow-lg">
                    <div class="w-12 h-12 bg-gradient-to-br from-ridge-500 to-ridge-600 rounded-xl flex items-center justify-center text-white shadow-lg mb-4">
                        <i class="fas fa-users text-xl"></i>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${myStudents.length}</h3>
                    <p class="text-sm text-slate-500">My Students</p>
                </div>
                <div class="glass-panel p-6 rounded-2xl border-l-4 border-blue-500 bg-white dark:bg-slate-800 shadow-lg">
                    <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg mb-4">
                        <i class="fas fa-file-alt text-xl"></i>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${state.reports.filter(r => r.teacher_id === state.currentUser?.id && r.status === 'published').length}</h3>
                    <p class="text-sm text-slate-500">Reports Published</p>
                </div>
                <div class="glass-panel p-6 rounded-2xl border-l-4 border-emerald-500 bg-white dark:bg-slate-800 shadow-lg">
                    <div class="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg mb-4">
                        <i class="fas fa-users text-xl"></i>
                    </div>
                    <h3 class="text-3xl font-black text-slate-800 dark:text-white">${myStudents.length}</h3>
                    <p class="text-sm text-slate-500">Students in Class</p>
                </div>
            </div>

            <!-- Report Status Section -->
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                <div class="flex items-center gap-3 mb-5">
                    <div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow">
                        <i class="fas fa-paper-plane text-white text-sm"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg text-slate-800 dark:text-white">Report Submission Status</h3>
                        <p class="text-xs text-slate-500">Status of reports you have submitted to the admin</p>
                    </div>
                </div>

                ${teacherBundles.length === 0 ? `
                    <div class="text-center py-10">
                        <div class="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                            <i class="fas fa-inbox text-2xl text-slate-300"></i>
                        </div>
                        <p class="text-slate-500 font-medium">No report bundles submitted yet</p>
                        <p class="text-sm text-slate-400 mt-1">Reports you submit will appear here with their admin review status.</p>
                    </div>
                ` : `
                    <!-- Summary pills -->
                    <div class="flex flex-wrap gap-3 mb-5">
                        <div class="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full">
                            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                            <span class="text-sm font-bold text-amber-700 dark:text-amber-400">${pendingBundles.length} Pending Review</span>
                        </div>
                        <div class="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span class="text-sm font-bold text-emerald-700 dark:text-emerald-400">${approvedBundles.length} Approved</span>
                        </div>
                        <div class="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full">
                            <span class="w-2 h-2 rounded-full bg-red-500"></span>
                            <span class="text-sm font-bold text-red-700 dark:text-red-400">${rejectedBundles.length} Rejected</span>
                        </div>
                    </div>

                    <!-- Bundle list -->
                    <div class="space-y-3">
                        ${teacherBundles.map(bundle => {
                            const statusConfig = {
                                'pending_review': { color: 'amber', label: 'Pending Review', icon: 'fa-clock', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
                                'reviewed':       { color: 'emerald', label: 'Approved', icon: 'fa-check-circle', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400' },
                                'rejected':       { color: 'red', label: 'Rejected', icon: 'fa-times-circle', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' }
                            };
                            const cfg = statusConfig[bundle.status] || statusConfig['pending_review'];
                            return `
                                <div class="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                                    <div class="flex items-center gap-3">
                                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-ridge-500 to-blue-500 flex items-center justify-center text-white font-bold text-xs shadow">
                                            ${(bundle.class || 'R').charAt(0)}
                                        </div>
                                        <div>
                                            <p class="font-bold text-slate-800 dark:text-slate-200">${bundle.class || 'Report Bundle'}</p>
                                            <p class="text-xs text-slate-500">${bundle.student_count || 0} students · Submitted ${new Date(bundle.submitted_at).toLocaleDateString()}</p>
                                            ${bundle.reviewed_at ? `<p class="text-xs text-slate-400">Reviewed: ${new Date(bundle.reviewed_at).toLocaleDateString()}</p>` : ''}
                                        </div>
                                    </div>
                                    <span class="flex items-center gap-1.5 px-3 py-1.5 ${cfg.bg} ${cfg.text} rounded-full text-xs font-bold">
                                        <i class="fas ${cfg.icon}"></i> ${cfg.label}
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
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
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                ${myStudents.map(s => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${s.name}</td>
                                        <td class="px-6 py-4 text-slate-800 dark:text-slate-200">${resolveClassLabel(s)}</td>
                                        <td class="px-6 py-4 text-slate-800 dark:text-slate-200">${s.age || 'N/A'}</td>
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
                <div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <i class="fas fa-external-link-alt text-3xl text-white"></i>
                </div>
                <h2 class="text-2xl font-bold mb-4 text-slate-800 dark:text-white">Report Generator Opened</h2>
                <p class="text-slate-600 dark:text-slate-300 mb-6">
                    The report generator has been opened in a new tab with your class data pre-loaded.
                </p>
                <div class="text-left bg-slate-50 dark:bg-slate-700 p-4 rounded-xl text-sm text-slate-600 dark:text-slate-400 mb-4">
                    <p><strong>Teacher:</strong> ${teacherName}</p>
                    <p><strong>Class:</strong> ${classString}</p>
                    <p><strong>Year:</strong> ${year}</p>
                    <p><strong>Term:</strong> ${term}</p>
                </div>
                <button onclick="window.open('${reportUrl}', '_blank')" class="w-full px-6 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                ${myChildren.length === 0 ? '<p class="col-span-full text-center py-8 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">No children linked to your account</p>' : myChildren.map(child => {
                    const arrears = dataManager.calculateStudentArrears(child.id);
                    return `
                        <div class="glass-panel p-6 rounded-2xl card-hover bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                            <div class="w-16 h-16 bg-gradient-to-br from-ridge-500 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold mb-4 shadow-lg">
                                ${child.name.charAt(0)}
                            </div>
                            <h3 class="font-bold text-xl mb-1 text-slate-800 dark:text-white">${child.name}</h3>
                            <p class="text-sm text-slate-500 mb-4">${child.class}</p>
                            
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

        const html = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">My Children</h2>
                <button onclick="actions.searchAndLinkChild()" class="px-4 py-2 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                    <i class="fas fa-plus mr-2"></i> Link Child
                </button>
            </div>

            <div class="grid gap-6">
                ${myChildren.length === 0 ? '<p class="text-center py-8 text-slate-500 bg-white dark:bg-slate-800 rounded-2xl shadow-lg">No children linked yet. Click "Link Child" to search and add your children.</p>' : myChildren.map(child => `
                    <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg border border-slate-200 dark:border-slate-700">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-16 h-16 bg-gradient-to-br from-ridge-500 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                                ${child.name.charAt(0)}
                            </div>
                            <div class="flex-1">
                                <h3 class="font-bold text-xl text-slate-800 dark:text-white">${child.name}</h3>
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
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${fee.description}</p>
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
                            <select id="payment-child" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                                ${myChildren.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                            </select>
                            <input type="number" id="payment-amount" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Amount (₵)">
                            <select id="payment-method" onchange="actions.toggleProofUpload()" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-slate-700 dark:to-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                                <option value="cash">Cash (Pay at School)</option>
                                <option value="momo">Mobile Money</option>
                            </select>
                            <div id="proof-upload-container" class="hidden">
                                <label class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Upload Payment Proof (Screenshot)</label>
                                <input type="file" id="payment-proof" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" accept="image/*">
                            </div>
                            <button onclick="actions.makePayment()" class="w-full py-4 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                                                <p class="font-bold text-slate-800 dark:text-white">${student?.name || 'Unknown'}</p>
                                                <p class="text-sm text-slate-500">₵<span class="rv-money-val" data-raw="${t.amount}">${window._rvMoneyHidden ? '•••' : t.amount}</span> • ${t.method === 'momo' ? 'Mobile Money' : 'Cash'}</p>
                                                <p class="text-xs text-slate-400">${new Date(t.created_at).toLocaleDateString()}</p>
                                            </div>
                                            <span class="px-2 py-1 rounded-full text-xs font-bold ${statusColors[t.status] || 'bg-slate-100 text-slate-700'}">
                                                ${t.status === 'confirmed' ? 'Approved' : t.status === 'pending' ? 'Pending' : 'Rejected'}
                                            </span>
                                        </div>
                                        ${t.status === 'confirmed' ? `
                                            <button onclick="actions.downloadReceipt('${t.id}')" class="w-full mt-2 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg text-sm font-bold hover:shadow-md transition-all flex items-center justify-center gap-2">
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
                                    <h3 class="font-bold text-lg text-slate-800 dark:text-white">${student?.name || 'Unknown Student'}</h3>
                                    <p class="text-sm text-slate-500 mb-2">${student?.class || ''} • ${report.title || 'Academic Report'}</p>
                                    <p class="text-xs text-slate-400">
                                        <i class="fas fa-chalkboard-teacher mr-1"></i> Teacher: ${teacher?.full_name || 'Unknown'}<br>
                                        <i class="fas fa-calendar mr-1"></i> Published: ${new Date(report.published_at || report.updated_at).toLocaleDateString()}
                                    </p>
                                </div>
                                <div class="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                                    <i class="fas fa-file-alt text-xl text-emerald-600"></i>
                                </div>
                            </div>
                            
                            <a href="${report.file_url}" target="_blank" class="w-full block text-center px-4 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
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
                    <div style="background:linear-gradient(135deg,#1a56db,#7c3aed);padding:20px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:1;">
                        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-user-edit" style="color:#fff;font-size:18px;"></i>
                        </div>
                        <div style="color:#fff;font-size:16px;font-weight:700;">Edit Student</div>
                    </div>
                    <div style="padding:24px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;max-height:calc(85vh - 90px);">
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Admission Number</label>
                            <input type="text" id="${modalId}-admission" value="${student.admission_number || ''}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Admission Number">
                        </div>
                        <div>
                            <label style="display:block;color:#94a3b8;font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Full Name</label>
                            <input type="text" id="${modalId}-name" value="${student.name || ''}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Full Name">
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
                            <input type="tel" id="${modalId}-phone" value="${student.parent_phone || ''}" style="width:100%;padding:11px 14px;border-radius:10px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;outline:none;" placeholder="Parent Phone Number">
                        </div>
                        <div style="display:flex;gap:10px;margin-top:6px;">
                            <button id="${modalId}-cancel" style="flex:1;padding:11px 20px;border-radius:10px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;font-size:14px;cursor:pointer;">Cancel</button>
                            <button id="${modalId}-save" style="flex:2;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#1a56db,#7c3aed);color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none;"><i class="fas fa-save" style="margin-right:8px;"></i>Save Changes</button>
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
        const currentParent = state.parents.find(p => p.profile_id === state.currentUser?.id);
        const linkedIds = new Set(state.parents.flatMap(p => p.children_ids || []));
        
        const availableStudents = state.students.map(s => ({
            ...s,
            disabled: linkedIds.has(s.id) && !currentParent?.children_ids?.includes(s.id)
        }));

        modal.selectStudent('Search for your child', availableStudents, async (studentId, studentName) => {
            if (currentParent?.children_ids?.includes(studentId)) {
                modal.alert('Info', 'This child is already linked to your account', 'info');
                return;
            }

            const linkedToOther = state.parents.some(p => 
                p.id !== currentParent?.id && p.children_ids?.includes(studentId)
            );
            
            if (linkedToOther) {
                modal.alert('Link Error', 'This child is already linked to another parent account', 'error');
                return;
            }

            try {
                app.showLoading('Linking child...');
                const currentIds = currentParent?.children_ids || [];
                const newIds = [...currentIds, studentId];
                
                const { error } = await supabaseClient
                    .from('parents')
                    .update({ children_ids: newIds })
                    .eq('id', currentParent.id);
                
                if (error) throw error;
                
                // Notify admin about the new child link
                const { data: adminProfiles } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .eq('role', 'admin')
                    .eq('approved', true)
                    .limit(5);
                for (const adm of (adminProfiles || [])) {
                    await supabaseClient.from('notifications').insert([{
                        user_id: adm.id,
                        title: 'Child Linked by Parent',
                        message: `${state.currentUser?.full_name || 'A parent'} has linked ${studentName} to their account.`,
                        type: 'child_linked',
                        read: false,
                        created_by: state.currentUser?.id,
                        created_at: new Date().toISOString()
                    }]);
                }
                ui.showToast(`Successfully linked ${studentName}`, 'success');
                await dataManager.loadParents();
                ui.route('parent_children');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                app.hideLoading();
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

        try {
            app.showLoading('Adding fee...');
            const { error } = await supabaseClient.from('fees').insert([{
                scope,
                amount: parseFloat(amount),
                description: desc,
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id,
                created_by: state.currentUser?.id,
                created_at: new Date().toISOString()
            }]);

            if (error) throw error;
            
            // Notify all parents about new fee
            await notificationManager.notifyParents('New Fee Published 💰', `A new fee item has been published: ${desc} — ₵${amount}. Please review the payments section.`, 'fee_added');
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
                await notificationManager.notifyParentsOfStudent(txn.student_id, 'Payment Approved ✓', `Your payment of ₵${txn?.amount || ''} for ${student?.name || 'your child'} has been approved and confirmed.`, 'payment');
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
                'Report Available 📄',
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
            `This will remove the report for <strong>${studentName}</strong> from their parent's dashboard. The file will be deleted and you can re-upload a new one. Continue?`,
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
            const { error } = await supabaseClient
                .from('profiles')
                .update({ approved: false, rejected: true })
                .eq('id', profileId);

            if (error) throw error;
            
            ui.showToast('Admin request rejected', 'success');
            await dataManager.loadPendingAdmins();
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
        
        if (!amount) return modal.alert('Validation Error', 'Please enter amount', 'warning');

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
                amount: parseFloat(amount),
                method,
                proof: proofUrl,
                status: 'pending',
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id
            }]);

            if (error) throw error;
            
            // Notify admin about the new payment pending review
            const { data: adminList } = await supabaseClient
                .from('profiles')
                .select('id')
                .eq('role', 'admin')
                .eq('approved', true)
                .limit(5);
            const paymentStudent = state.students.find(s => s.id === studentId);
            for (const adm of (adminList || [])) {
                await supabaseClient.from('notifications').insert([{
                    user_id: adm.id,
                    title: 'New Payment Pending Approval',
                    message: `${state.currentUser?.full_name || 'A parent'} submitted a payment of ₵${amount} for ${paymentStudent?.name || 'a student'}. Please review.`,
                    type: 'payment',
                    read: false,
                    created_by: state.currentUser?.id,
                    created_at: new Date().toISOString()
                }]);
            }
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
                <title>Payment Receipt - ${student?.name || 'Student'}</title>
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
                        background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
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
                        background: linear-gradient(135deg, #1e3a5f, #2563eb);
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
                        <div style="display:none;width:64px;height:64px;background:linear-gradient(135deg,#1e3a5f,#2563eb);border-radius:8px;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:bold;flex-shrink:0;">R</div>
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
                            <span class="detail-value">${student?.name || 'N/A'}</span>
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
                            <span class="detail-value" style="color:#059669;">✓ Confirmed</span>
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
                        🖨 Print / Save as PDF
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
                    <p class="font-bold text-slate-800 dark:text-white mb-1">Teacher: ${report.teacher_name}</p>
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
                                    <span class="font-medium">${student?.name || 'Unknown Student'}</span>
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
                window.open(report.bundle_url, '_blank');
            } else {
                const studentReports = state.reports.filter(r => r.submission_bundle_id === bundleId);
                if (studentReports.length > 0) {
                    // Download first report as example, or implement batch download
                    window.open(studentReports[0].file_url, '_blank');
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
                    await notificationManager.notifyParentsOfStudent(st.id, 'Report Approved ✓', `The ${approvedBundle.class} class report bundle submitted by the teacher has been approved by the administration.`, 'report_uploaded');
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
                    <div style="background:linear-gradient(135deg,#1a56db,#7c3aed);padding:20px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:1;">
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
                            <button onclick="actions._bulkWizardFinish('${modalId}')" style="padding:10px 20px;border-radius:8px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-weight:700;cursor:pointer;border:none;"><i class="fas fa-upload mr-2"></i>Upload Students</button>
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
                                <td style="padding:8px 12px;color:#e2e8f0;">${name || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#f9a8d4;">${gender || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#e2e8f0;">${dobStr || '<span style="color:#64748b;">—</span>'}</td>
                                <td style="padding:8px 12px;color:#10b981;font-weight:600;">${age}</td>
                                <td style="padding:8px 12px;color:#a78bfa;">${phone || '<span style="color:#64748b;">—</span>'}</td>
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
            background:#1e293b;border:1px solid #334155;border-radius:14px;
            box-shadow:0 8px 32px rgba(0,0,0,0.4);padding:16px 20px;
            max-width:320px;cursor:pointer;
            animation:slideInRight 0.3s ease;
        `;
        banner.innerHTML = `
            <style>@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}</style>
            <div style="display:flex;align-items:start;gap:12px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#f59e0b,#ef4444);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-bell" style="color:#fff;font-size:14px;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:2px;">New Notification</div>
                    <div style="color:#94a3b8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${latest.title}</div>
                    <div style="color:#64748b;font-size:11px;margin-top:2px;">${latest.message?.substring(0,60)}${latest.message?.length>60?'...':''}</div>
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
                                    <div style="font-weight:600;color:#e2e8f0;font-size:13px;">${n.title}</div>
                                    <div style="color:#94a3b8;font-size:12px;margin-top:2px;line-height:1.4;">${n.message}</div>
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
                    <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:20px 24px;text-align:center;">
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
                            ${['📄 Report uploads & approvals', '💰 Payment confirmations', '📢 School announcements', '🔔 Urgent admin alerts'].map(item => `
                                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #334155;font-size:13px;color:#94a3b8;">${item}</div>
                            `).join('')}
                        </div>
                        <p style="color:#64748b;font-size:11px;margin-bottom:20px;">You can change this anytime in your browser settings.</p>
                        <div style="display:flex;gap:10px;">
                            <button id="${modalId}-deny" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid #475569;background:transparent;color:#94a3b8;font-weight:600;font-size:14px;cursor:pointer;">Not Now</button>
                            <button id="${modalId}-allow" style="flex:1;padding:12px;border-radius:10px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none;">
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
                    this.sendPush('Notifications Enabled ✓', 'You will now receive Ridgevalley SMS alerts on this device.', 'success');
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
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        try {
            const notif = new Notification(`${icons[type] || '🔔'} ${title}`, {
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
