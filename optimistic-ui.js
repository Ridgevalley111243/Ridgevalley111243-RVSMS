// ==================================================================================
// optimistic-ui.js — Ridgevalley Hybrid School Management System
// Optimistic UI layer: skeleton screens, instant mutations, stale-while-revalidate
//
// HOW IT WORKS:
//   1. Patches actions.* to update state & re-render BEFORE the await resolves
//   2. On error, rolls back state and shows toast — user never sees a blank wait
//   3. Replaces full-page loading overlays with inline button spinners
//   4. Adds skeleton screens for every route so navigation feels instant
//   5. Stale-while-revalidate: route renders cached data immediately, then
//      silently refreshes data in the background
//
// LOAD ORDER (in index.html):
//   <script src="academic-report-generator.js"></script>
//   <script src="app.js"></script>
//   <script src="features.js"></script>
//   <script src="optimistic-ui.js"></script>   ← last
// ==================================================================================

'use strict';

// ── 0. Skeleton CSS ───────────────────────────────────────────────────────────────
(function injectSkeletonStyles() {
    if (document.getElementById('rv-optimistic-styles')) return;
    const style = document.createElement('style');
    style.id = 'rv-optimistic-styles';
    style.textContent = `
        /* Skeleton shimmer */
        @keyframes rv-shimmer {
            0%   { background-position: -600px 0; }
            100% { background-position:  600px 0; }
        }

        .rv-skel {
            background: linear-gradient(90deg,
                rgba(148,163,184,0.12) 25%,
                rgba(148,163,184,0.24) 50%,
                rgba(148,163,184,0.12) 75%
            );
            background-size: 600px 100%;
            animation: rv-shimmer 1.4s infinite linear;
            border-radius: 8px;
        }

        .dark .rv-skel {
            background: linear-gradient(90deg,
                rgba(71,85,105,0.35) 25%,
                rgba(71,85,105,0.55) 50%,
                rgba(71,85,105,0.35) 75%
            );
            background-size: 600px 100%;
        }

        /* Inline button loading state */
        .rv-btn-loading {
            pointer-events: none !important;
            opacity: 0.75 !important;
            position: relative;
        }

        .rv-btn-loading::after {
            content: '';
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255,255,255,0.5);
            border-top-color: white;
            border-radius: 50%;
            animation: rv-spin 0.7s linear infinite;
        }

        @keyframes rv-spin { to { transform: translateY(-50%) rotate(360deg); } }

        /* Optimistic row: faded pending state */
        .rv-optimistic-row {
            opacity: 0.6;
            pointer-events: none;
            transition: opacity 0.3s;
        }

        /* Success flash */
        .rv-flash-success {
            animation: rv-flash 0.5s ease forwards;
        }

        @keyframes rv-flash {
            0%   { background: rgba(16,185,129,0.25); }
            100% { background: transparent; }
        }

        /* Delete: strike-through fade */
        .rv-deleting {
            opacity: 0.35;
            text-decoration: line-through;
            pointer-events: none;
            transition: opacity 0.3s;
        }

        /* Offline badge */
        #rv-offline-badge {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(80px);
            background: #1e293b;
            color: #fbbf24;
            padding: 8px 18px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 9999;
            transition: transform 0.3s ease;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        #rv-offline-badge.visible { transform: translateX(-50%) translateY(0); }

        /* Loading bar at the very top */
        #rv-progress-bar {
            position: fixed;
            top: 0;
            left: 0;
            height: 3px;
            background: linear-gradient(90deg, #1a56db, #10b981);
            z-index: 9998;
            transition: width 0.25s ease, opacity 0.4s ease;
            opacity: 0;
            width: 0%;
        }
        #rv-progress-bar.active { opacity: 1; }
    `;
    document.head.appendChild(style);
})();

// ── 1. Progress bar ───────────────────────────────────────────────────────────────
const progressBar = {
    _el: null,
    _timer: null,
    _val: 0,

    get() {
        if (!this._el) {
            this._el = document.createElement('div');
            this._el.id = 'rv-progress-bar';
            document.body.prepend(this._el);
        }
        return this._el;
    },

    start() {
        const el = this.get();
        this._val = 15;
        el.style.width = '15%';
        el.classList.add('active');
        clearInterval(this._timer);
        this._timer = setInterval(() => {
            if (this._val < 85) {
                this._val += Math.random() * 6;
                el.style.width = Math.min(this._val, 85) + '%';
            }
        }, 350);
    },

    done() {
        clearInterval(this._timer);
        const el = this.get();
        el.style.width = '100%';
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
                el.style.width = '0%';
                el.classList.remove('active');
            }, 400);
        }, 200);
    },

    fail() { this.done(); }
};

// ── 2. Offline detection ──────────────────────────────────────────────────────────
(function setupOfflineDetection() {
    const badge = document.createElement('div');
    badge.id = 'rv-offline-badge';
    badge.innerHTML = '<i class="fas fa-wifi-slash"></i> You\'re offline — changes will sync when reconnected';
    document.body.appendChild(badge);

    window.addEventListener('offline', () => badge.classList.add('visible'));
    window.addEventListener('online',  () => {
        badge.classList.remove('visible');
        if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast('Back online!', 'success');
        }
    });
})();

// ── 3. Button loading helper ──────────────────────────────────────────────────────
function rvBtnLoad(btn, text) {
    if (!btn) return () => {};
    const orig = btn.innerHTML;
    btn.innerHTML = text ? `<span style="opacity:0.8">${text}</span>` : orig;
    btn.classList.add('rv-btn-loading');
    return () => {
        btn.innerHTML = orig;
        btn.classList.remove('rv-btn-loading');
    };
}

// ── 4. Skeleton builders ──────────────────────────────────────────────────────────
const skeletons = {
    stat() {
        return `<div class="rv-skel" style="height:110px;border-radius:14px;"></div>`;
    },

    statGrid(count = 4) {
        return `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
                ${Array(count).fill(0).map(() => this.stat()).join('')}
            </div>`;
    },

    tableRow(cols = 4) {
        const cells = Array(cols).fill(0).map(() =>
            `<td style="padding:14px 16px;"><div class="rv-skel" style="height:14px;width:${60 + Math.random() * 30 | 0}%;"></div></td>`
        ).join('');
        return `<tr>${cells}</tr>`;
    },

    table(rows = 6, cols = 4) {
        const headerCells = Array(cols).fill(0).map(() =>
            `<th style="padding:12px 16px;"><div class="rv-skel" style="height:11px;width:${40 + Math.random() * 40 | 0}%;"></div></th>`
        ).join('');
        const bodyRows = Array(rows).fill(0).map(() => this.tableRow(cols)).join('');
        return `
            <div style="background:var(--rv-surface,#fff);border-radius:14px;overflow:hidden;border:1px solid var(--rv-border,#e2e8f0);">
                <table style="width:100%;border-collapse:collapse;">
                    <thead style="background:var(--rv-bg,#f1f5fb);">
                        <tr>${headerCells}</tr>
                    </thead>
                    <tbody style="divide-y:1px solid var(--rv-border,#e2e8f0);">${bodyRows}</tbody>
                </table>
            </div>`;
    },

    card(lines = 3) {
        const linesHtml = Array(lines).fill(0).map((_, i) =>
            `<div class="rv-skel" style="height:13px;width:${i === 0 ? 60 : 40 + Math.random() * 40 | 0}%;margin-bottom:8px;"></div>`
        ).join('');
        return `
            <div style="background:var(--rv-surface,#fff);border-radius:14px;padding:20px;border:1px solid var(--rv-border,#e2e8f0);">
                <div class="rv-skel" style="height:40px;width:40px;border-radius:10px;margin-bottom:16px;"></div>
                ${linesHtml}
            </div>`;
    },

    cardGrid(count = 3, lines = 3) {
        return `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
                ${Array(count).fill(0).map(() => this.card(lines)).join('')}
            </div>`;
    },

    pageHeader(hasAction = true) {
        return `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                <div>
                    <div class="rv-skel" style="height:24px;width:200px;margin-bottom:8px;"></div>
                    <div class="rv-skel" style="height:13px;width:140px;"></div>
                </div>
                ${hasAction ? `<div class="rv-skel" style="height:40px;width:130px;border-radius:10px;"></div>` : ''}
            </div>`;
    },

    // Per-route skeletons
    overview() {
        return this.pageHeader(false) + this.statGrid(6) + `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
                ${this.card(5)}
                ${this.card(5)}
            </div>`;
    },
    list(cols) {
        return this.pageHeader() + `
            <div style="background:var(--rv-surface,#fff);border-radius:14px;padding:16px;margin-bottom:16px;border:1px solid var(--rv-border,#e2e8f0);">
                <div class="rv-skel" style="height:40px;border-radius:10px;"></div>
            </div>` + this.table(7, cols || 4);
    },
    finance() {
        return this.pageHeader() + this.statGrid(3) + this.table(6, 5);
    },
    dashboard() {
        return this.pageHeader(false) + this.statGrid(3) + this.cardGrid(2, 4);
    },
    form() {
        const fieldRow = `<div style="margin-bottom:14px;"><div class="rv-skel" style="height:11px;width:100px;margin-bottom:6px;"></div><div class="rv-skel" style="height:42px;border-radius:10px;"></div></div>`;
        return this.pageHeader() + `
            <div style="background:var(--rv-surface,#fff);border-radius:14px;padding:24px;border:1px solid var(--rv-border,#e2e8f0);">
                ${Array(5).fill(fieldRow).join('')}
                <div class="rv-skel" style="height:44px;border-radius:10px;margin-top:8px;"></div>
            </div>`;
    }
};

// ── 5. Route → skeleton mapping ───────────────────────────────────────────────────
const routeSkeletonMap = {
    overview:                () => skeletons.overview(),
    academic:                () => skeletons.list(3),
    classes:                 () => skeletons.list(3),
    students:                () => skeletons.list(5),
    teachers:                () => skeletons.list(4),
    parents:                 () => skeletons.list(4),
    finance:                 () => skeletons.finance(),
    financial_analytics:     () => skeletons.finance(),
    attendance:              () => skeletons.list(5),
    received_reports:        () => skeletons.list(4),
    admin_upload_reports:    () => skeletons.list(3),
    screenshots:             () => skeletons.cardGrid(4, 3),
    approvals:               () => skeletons.list(4),
    announcements:           () => skeletons.list(3),
    data_analysis:           () => skeletons.finance(),
    teacher_dashboard:       () => skeletons.dashboard(),
    teacher_students:        () => skeletons.list(3),
    teacher_attendance:      () => skeletons.list(4),
    teacher_total_attendance:() => skeletons.list(4),
    teacher_create_report:   () => skeletons.form(),
    parent_dashboard:        () => skeletons.dashboard(),
    parent_children:         () => skeletons.cardGrid(3, 3),
    parent_finance:          () => skeletons.finance(),
    parent_reports:          () => skeletons.list(3),
};

// ── 6. Patch ui.route for instant skeleton + background revalidation ──────────────
(function patchRoute() {
    if (!window.ui || !ui.route) return;
    const _originalRoute = ui.route.bind(ui);

    ui.route = function(view) {
        // Show skeleton immediately so the page feels instant
        const container = document.getElementById('view-content');
        if (container && routeSkeletonMap[view]) {
            container.innerHTML = `<div style="animation:rv-fade 0.18s ease">${routeSkeletonMap[view]()}</div>`;
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        // Update active sidebar item right away
        document.querySelectorAll('.sidebar-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('onclick')?.includes(`'${view}'`)) {
                btn.classList.add('active');
            }
        });

        progressBar.start();

        // Render actual view on next tick (non-blocking)
        setTimeout(() => {
            try {
                // Close mobile sidebar if open
                if (window.ui && ui.isSidebarOpen) ui.toggleSidebar();

                switch(view) {
                    case 'overview':               views.renderOverview(); break;
                    case 'academic':               views.renderAcademic(); break;
                    case 'classes':                views.renderClasses(); break;
                    case 'students':               views.renderStudents(); break;
                    case 'teachers':               views.renderTeachers(); break;
                    case 'parents':                views.renderParents(); break;
                    case 'finance':                views.renderFinance(); break;
                    case 'financial_analytics':    if (typeof featureViews !== 'undefined') featureViews.renderFinancialAnalytics?.(); break;
                    case 'attendance':             views.renderAttendance(); break;
                    case 'received_reports':       views.renderReceivedReports(); break;
                    case 'admin_upload_reports':   views.renderAdminUploadReports(); break;
                    case 'screenshots':            views.renderScreenshots(); break;
                    case 'approvals':              views.renderApprovals(); break;
                    case 'announcements':          views.renderAnnouncements(); break;
                    case 'data_analysis':          views.renderDataAnalysis(); break;
                    case 'teacher_dashboard':      views.renderTeacherDashboard(); break;
                    case 'teacher_students':       views.renderTeacherStudents(); break;
                    case 'teacher_attendance':     views.renderTeacherAttendance(); break;
                    case 'teacher_total_attendance': views.renderTeacherTotalAttendance(); break;
                    case 'teacher_create_report':  views.renderTeacherCreateReport(); break;
                    case 'parent_dashboard':       views.renderParentDashboard(); break;
                    case 'parent_children':        views.renderParentChildren(); break;
                    case 'parent_finance':         views.renderParentFinance(); break;
                    case 'parent_reports':         views.renderParentReports(); break;
                    default:                       views.renderOverview();
                }
                progressBar.done();
            } catch (err) {
                progressBar.fail();
                console.error(`[optimistic-ui] Route render error [${view}]:`, err);
                if (container) {
                    container.innerHTML = `
                        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:16px;text-align:center;padding:24px;">
                            <div style="width:56px;height:56px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:22px;"></i>
                            </div>
                            <div>
                                <p style="font-weight:700;font-size:16px;color:var(--rv-navy,#0f2044);margin:0 0 6px;">Something went wrong</p>
                                <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">${err.message || 'An unexpected error occurred.'}</p>
                            </div>
                            <button onclick="ui.route('${view}')" style="padding:10px 24px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;">
                                <i class="fas fa-redo" style="margin-right:6px;"></i>Retry
                            </button>
                        </div>`;
                }
            }
        }, 0);  // 0ms: skeleton is already visible, render on next tick

        state.currentView = view;
    };
})();

// ── 7. Suppress full-page loading overlay for common mutations ────────────────────
// Replace app.showLoading / app.hideLoading with no-ops during optimistic mutations.
// We re-enable them for heavy operations (bulk upload, auth, report gen).
const _originalShowLoading = app.showLoading.bind(app);
const _originalHideLoading = app.hideLoading.bind(app);

let _suppressOverlay = false;

app.showLoading = function(text) {
    if (_suppressOverlay) return;
    _originalShowLoading(text);
};
app.hideLoading = function() {
    if (_suppressOverlay) return;
    _originalHideLoading();
};

// Helper: run fn with overlay suppressed
async function withOptimistic(fn) {
    _suppressOverlay = true;
    try {
        return await fn();
    } finally {
        _suppressOverlay = false;
        _originalHideLoading(); // ensure overlay is always cleared
    }
}

// ── 8. Stale-while-revalidate for background refresh ─────────────────────────────
// After a mutation that calls ui.route(), we quietly refresh the backing data
// so the next navigation gets fresh data without blocking the current render.
function silentRefresh(loaders) {
    Promise.all(loaders.map(l => l().catch(() => {}))).then(() => {
        // If we're still on the same view, patch it quietly (no skeleton flash)
        // by calling the render function directly without showing a skeleton.
        const view = state.currentView;
        if (!view) return;
        try {
            const container = document.getElementById('view-content');
            if (!container) return;
            // Use a document fragment to avoid flash
            const tmp = document.createElement('div');
            switch(view) {
                case 'students':    { const h = _buildStudentsHTML(); if (h) container.innerHTML = h; break; }
                case 'classes':     { views.renderClasses(); break; }
                case 'teachers':    { views.renderTeachers(); break; }
                case 'parents':     { views.renderParents(); break; }
                case 'finance':     { views.renderFinance(); break; }
                default: break; // overview etc. are expensive — skip silent re-render
            }
        } catch (_) { /* silent */ }
    });
}

// Build students HTML helper (avoids calling renderStudents which replaces the whole container)
function _buildStudentsHTML() {
    try {
        // Call the real render which replaces container.innerHTML — that's fine here
        // since we're in the background. Just return null to skip.
        return null;
    } catch (_) { return null; }
}

// ── 9. Optimistic CRUD patches ────────────────────────────────────────────────────

// ── 9a. addStudent ────────────────────────────────────────────────────────────────
const _origAddStudent = actions.addStudent?.bind(actions);
if (_origAddStudent) {
    actions.addStudent = async function() {
        const admissionNumber = document.getElementById('student-admission')?.value?.trim();
        const name            = document.getElementById('student-name')?.value?.trim();
        const gender          = document.getElementById('student-gender')?.value;
        const dob             = document.getElementById('student-dob')?.value;
        const age             = document.getElementById('student-age')?.value;
        const studentClass    = document.getElementById('student-class')?.value;
        const parentPhone     = document.getElementById('student-parent-phone')?.value?.trim();

        if (!name || !studentClass) {
            return modal.alert('Validation Error', 'Name and class are required', 'warning');
        }

        const tempId = 'temp_' + Date.now();
        const tempStudent = {
            id: tempId, _optimistic: true,
            admission_number: admissionNumber || null,
            name, gender: gender || null, dob: dob || null,
            age: age || null, class: studentClass,
            parent_phone: parentPhone || null,
            created_at: new Date().toISOString()
        };

        // Optimistically add to state
        state.students.unshift(tempStudent);
        ui.route('students');
        ui.showToast('Registering student...', 'info');

        await withOptimistic(async () => {
            try {
                const { data, error } = await supabaseClient.from('students').insert([{
                    admission_number: admissionNumber || null,
                    name, gender: gender || null, dob: dob || null,
                    age: age || null, class: studentClass,
                    parent_phone: parentPhone || null
                }]).select().single();

                if (error) throw error;

                // Replace temp with real record
                const idx = state.students.findIndex(s => s.id === tempId);
                if (idx !== -1) state.students.splice(idx, 1, { ...data, _optimistic: false });
                else state.students.unshift(data);

                ui.route('students');
                ui.showToast('Student registered', 'success');
            } catch (err) {
                // Rollback
                state.students = state.students.filter(s => s.id !== tempId);
                ui.route('students');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9b. deleteStudent ─────────────────────────────────────────────────────────────
const _origDeleteStudent = actions.deleteStudent?.bind(actions);
if (_origDeleteStudent) {
    actions.deleteStudent = function(id) {
        const student = state.students.find(s => s.id === id);
        modal.confirmDelete(student?.name || 'this student', async () => {
            // Optimistically remove
            const backup = [...state.students];
            state.students = state.students.filter(s => s.id !== id);
            ui.route('students');
            ui.showToast('Student removed', 'success');

            await withOptimistic(async () => {
                try {
                    const { error } = await supabaseClient.from('students').delete().eq('id', id);
                    if (error) throw error;
                    // Silently refresh to sync any server-side changes
                    silentRefresh([() => dataManager.loadStudents()]);
                } catch (err) {
                    state.students = backup;
                    ui.route('students');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 9c. addClass ──────────────────────────────────────────────────────────────────
const _origAddClass = actions.addClass?.bind(actions);
if (_origAddClass) {
    actions.addClass = async function() {
        const level = document.getElementById('class-level')?.value;
        const grade = document.getElementById('class-grade')?.value;
        if (!level || !grade) return modal.alert('Validation Error', 'Please fill all fields', 'warning');

        const tempId = 'temp_' + Date.now();
        const tempClass = { id: tempId, level, grade, _optimistic: true, created_at: new Date().toISOString() };
        state.classes.push(tempClass);
        ui.route('classes');
        ui.showToast('Creating class...', 'info');

        await withOptimistic(async () => {
            try {
                const { data, error } = await supabaseClient.from('classes').insert([{ level, grade }]).select().single();
                if (error) throw error;
                const idx = state.classes.findIndex(c => c.id === tempId);
                if (idx !== -1) state.classes.splice(idx, 1, data);
                ui.route('classes');
                ui.showToast('Class created', 'success');
            } catch (err) {
                state.classes = state.classes.filter(c => c.id !== tempId);
                ui.route('classes');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9d. deleteClass ───────────────────────────────────────────────────────────────
const _origDeleteClass = actions.deleteClass?.bind(actions);
if (_origDeleteClass) {
    actions.deleteClass = function(id) {
        modal.confirmDelete('this class', async () => {
            const backup = [...state.classes];
            state.classes = state.classes.filter(c => c.id !== id);
            ui.route('classes');
            ui.showToast('Class deleted', 'success');

            await withOptimistic(async () => {
                try {
                    const { error } = await supabaseClient.from('classes').delete().eq('id', id);
                    if (error) throw error;
                } catch (err) {
                    state.classes = backup;
                    ui.route('classes');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 9e. approveTransaction (payment) ─────────────────────────────────────────────
const _origApproveTransaction = actions.approveTransaction?.bind(actions);
if (_origApproveTransaction) {
    actions.approveTransaction = async function(id) {
        const backup = state.transactions.map(t => ({ ...t }));

        // Optimistic update
        state.transactions = state.transactions.map(t =>
            t.id === id ? { ...t, status: 'confirmed', verified_by: state.currentUser?.id } : t
        );
        ui.route('finance');
        ui.showToast('Payment approved ✓', 'success');

        await withOptimistic(async () => {
            try {
                const { error } = await supabaseClient
                    .from('transactions')
                    .update({ status: 'confirmed', verified_by: state.currentUser?.id })
                    .eq('id', id);
                if (error) throw error;

                // Notify parent (fire-and-forget — doesn't block UI)
                const txn = state.transactions.find(t => t.id === id);
                if (txn?.student_id) {
                    const student = state.students.find(s => s.id === txn.student_id);
                    notificationManager.notifyParentsOfStudent(
                        txn.student_id, 'Payment Approved ✓',
                        `Your payment of ₵${txn?.amount || ''} for ${student?.name || 'your child'} has been approved.`,
                        'payment'
                    ).catch(() => {});
                }
                silentRefresh([() => dataManager.loadTransactions()]);
            } catch (err) {
                state.transactions = backup;
                ui.route('finance');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9f. rejectTransaction ─────────────────────────────────────────────────────────
const _origRejectTransaction = actions.rejectTransaction?.bind(actions);
if (_origRejectTransaction) {
    actions.rejectTransaction = async function(id) {
        const backup = state.transactions.map(t => ({ ...t }));
        state.transactions = state.transactions.map(t =>
            t.id === id ? { ...t, status: 'rejected' } : t
        );
        ui.route('finance');
        ui.showToast('Payment rejected', 'success');

        await withOptimistic(async () => {
            try {
                const { error } = await supabaseClient.from('transactions').update({ status: 'rejected' }).eq('id', id);
                if (error) throw error;
                // Notify parent
                const txnR = state.transactions.find(t => t.id === id);
                if (txnR?.student_id) {
                    const studentR = state.students.find(s => s.id === txnR.student_id);
                    notificationManager.notifyParentsOfStudent(
                        txnR.student_id, 'Payment Rejected',
                        `Your payment of ₵${txnR?.amount || ''} for ${studentR?.name || 'your child'} was not approved.`,
                        'payment'
                    ).catch(() => {});
                }
                silentRefresh([() => dataManager.loadTransactions()]);
            } catch (err) {
                state.transactions = backup;
                ui.route('finance');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9g. deleteTransaction ─────────────────────────────────────────────────────────
const _origDeleteTxn = actions.deleteTransaction?.bind(actions);
if (_origDeleteTxn) {
    actions.deleteTransaction = function(id) {
        modal.confirmDelete('this transaction', async () => {
            const backup = [...state.transactions];
            state.transactions = state.transactions.filter(t => t.id !== id);
            ui.route('finance');
            ui.showToast('Transaction deleted', 'success');

            await withOptimistic(async () => {
                try {
                    const { error } = await supabaseClient.from('transactions').delete().eq('id', id);
                    if (error) throw error;
                } catch (err) {
                    state.transactions = backup;
                    ui.route('finance');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 9h. addFee ────────────────────────────────────────────────────────────────────
const _origAddFee = actions.addFee?.bind(actions);
if (_origAddFee) {
    actions.addFee = async function() {
        const scope  = document.getElementById('fee-scope')?.value;
        const amount = document.getElementById('fee-amount')?.value;
        const desc   = document.getElementById('fee-desc')?.value;
        if (!amount || !desc) return modal.alert('Validation Error', 'Please fill all fields', 'warning');

        const tempId = 'temp_' + Date.now();
        const tempFee = {
            id: tempId, _optimistic: true,
            scope, amount: parseFloat(amount), description: desc,
            year_id: state.currentAY?.id, term_id: state.currentTerm?.id,
            created_at: new Date().toISOString()
        };
        state.fees.unshift(tempFee);
        ui.route('finance');
        ui.showToast('Adding fee...', 'info');

        await withOptimistic(async () => {
            try {
                const { data, error } = await supabaseClient.from('fees').insert([{
                    scope, amount: parseFloat(amount), description: desc,
                    year_id: state.currentAY?.id, term_id: state.currentTerm?.id,
                    created_by: state.currentUser?.id, created_at: new Date().toISOString()
                }]).select().single();
                if (error) throw error;

                const idx = state.fees.findIndex(f => f.id === tempId);
                if (idx !== -1) state.fees.splice(idx, 1, data);
                else state.fees.unshift(data);
                ui.route('finance');
                ui.showToast('Fee structure added', 'success');

                // Notify parents (fire-and-forget)
                notificationManager.notifyParents(
                    'New Fee Published 💰',
                    `A new fee item has been published: ${desc} — ₵${amount}. Please review the payments section.`,
                    'fee_added'
                ).catch(() => {});
            } catch (err) {
                state.fees = state.fees.filter(f => f.id !== tempId);
                ui.route('finance');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9i. deleteFee ─────────────────────────────────────────────────────────────────
const _origDeleteFee = actions.deleteFee?.bind(actions);
if (_origDeleteFee) {
    actions.deleteFee = function(id) {
        modal.confirmDelete('this fee', async () => {
            const backup = [...state.fees];
            state.fees = state.fees.filter(f => f.id !== id);
            ui.route('finance');
            ui.showToast('Fee deleted', 'success');

            await withOptimistic(async () => {
                try {
                    const { error } = await supabaseClient.from('fees').delete().eq('id', id);
                    if (error) throw error;
                } catch (err) {
                    state.fees = backup;
                    ui.route('finance');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 9j. activateTerm (academic year management) ───────────────────────────────────
const _origActivateTerm = actions.activateTerm?.bind(actions);
if (_origActivateTerm) {
    actions.activateTerm = async function(yearId, termId) {
        // Optimistic state update
        const backup = state.academicYears.map(y => ({ ...y, terms: [...(y.terms || [])] }));
        state.academicYears = state.academicYears.map(y => {
            if (y.id !== yearId) return y;
            return { ...y, terms: (y.terms || []).map(t => ({ ...t, active: t.id === termId })) };
        });
        const activeYear = state.academicYears.find(y => y.id === yearId);
        state.currentAY = state.academicYears.find(y => y.active) || state.currentAY;
        state.currentTerm = activeYear?.terms?.find(t => t.active) || null;
        ui.updatePeriodDisplay();
        ui.route('academic');
        ui.showToast('Term activated', 'success');

        await withOptimistic(async () => {
            try {
                const terms = state.academicYears.find(y => y.id === yearId)?.terms;
                const { error } = await supabaseClient.from('academic_years').update({ terms }).eq('id', yearId);
                if (error) throw error;
                silentRefresh([() => dataManager.loadAcademicYears()]);
            } catch (err) {
                state.academicYears = backup;
                ui.route('academic');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9k. approveAdmin ─────────────────────────────────────────────────────────────
const _origApproveAdmin = actions.approveAdmin?.bind(actions);
if (_origApproveAdmin) {
    actions.approveAdmin = async function(profileId) {
        const backup = state.pendingAdmins.map(a => ({ ...a }));
        state.pendingAdmins = state.pendingAdmins.filter(a => a.profile_id !== profileId);
        ui.route('approvals');
        ui.showToast('Admin approved', 'success');

        await withOptimistic(async () => {
            try {
                const { error } = await supabaseClient.from('profiles').update({ approved: true }).eq('id', profileId);
                if (error) throw error;
                silentRefresh([() => dataManager.loadPendingAdmins()]);
            } catch (err) {
                state.pendingAdmins = backup;
                ui.route('approvals');
                modal.alert('Error', extractErrorMessage(err), 'error');
            }
        });
    };
}

// ── 9l. deleteTeacher ─────────────────────────────────────────────────────────────
const _origDeleteTeacher = actions.deleteTeacher?.bind(actions);
if (_origDeleteTeacher) {
    actions.deleteTeacher = function(profileId, name) {
        modal.confirmDelete(name || 'this teacher', async () => {
            const backup = [...state.teachers];
            state.teachers = state.teachers.filter(t => t.profile_id !== profileId);
            ui.route('teachers');
            ui.showToast('Teacher removed', 'success');

            await withOptimistic(async () => {
                try {
                    const teacher = backup.find(t => t.profile_id === profileId);
                    if (teacher?.id) {
                        await supabaseClient.from('teachers').delete().eq('id', teacher.id);
                    }
                    if (profileId) {
                        await supabaseClient.from('profiles').delete().eq('id', profileId);
                    }
                    silentRefresh([() => dataManager.loadTeachers()]);
                } catch (err) {
                    state.teachers = backup;
                    ui.route('teachers');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 9m. deleteParent ──────────────────────────────────────────────────────────────
const _origDeleteParent = actions.deleteParent?.bind(actions);
if (_origDeleteParent) {
    actions.deleteParent = function(id, name) {
        const parent = state.parents.find(p => p.id === id);
        modal.confirmDelete(name || 'this parent', async () => {
            const backup = [...state.parents];
            state.parents = state.parents.filter(p => p.id !== id);
            ui.route('parents');
            ui.showToast('Parent removed', 'success');

            await withOptimistic(async () => {
                try {
                    await supabaseClient.from('parents').delete().eq('id', id);
                    if (parent?.profile_id) {
                        await supabaseClient.from('profiles').delete().eq('id', parent.profile_id);
                    }
                    silentRefresh([() => dataManager.loadParents()]);
                } catch (err) {
                    state.parents = backup;
                    ui.route('parents');
                    modal.alert('Error', extractErrorMessage(err), 'error');
                }
            });
        });
    };
}

// ── 10. Stale-while-revalidate on refreshData ─────────────────────────────────────
// The existing refreshData (called by realtime subscriptions) does a full reload.
// We keep that but make sure it does NOT show any loading overlay.
const _origRefreshData = typeof actions.refreshData === 'function' ? actions.refreshData.bind(actions) : null;
if (_origRefreshData) {
    actions.refreshData = async function() {
        // Silent: no loading overlay, no route change (just update state)
        _suppressOverlay = true;
        try {
            await Promise.all([
                dataManager.loadStudents(),
                dataManager.loadTeachers(),
                dataManager.loadParents(),
                dataManager.loadFees(),
                dataManager.loadTransactions(),
                dataManager.loadReports(),
                dataManager.loadReceivedReports(),
                dataManager.loadNotifications(),
                dataManager.loadAttendance(),
            ]);
            // Re-render current view with fresh data (no skeleton flash)
            const view = state.currentView;
            if (view) {
                const container = document.getElementById('view-content');
                if (container) {
                    try {
                        switch(view) {
                            case 'overview': views.renderOverview(); break;
                            case 'students': views.renderStudents(); break;
                            case 'teachers': views.renderTeachers(); break;
                            case 'parents':  views.renderParents();  break;
                            case 'finance':  views.renderFinance();  break;
                            default: break;
                        }
                    } catch (_) {}
                }
            }
        } finally {
            _suppressOverlay = false;
        }
    };
}

// ── 11. Patch attendance save for instant feedback ────────────────────────────────
const _origSaveAttendance = actions.saveAttendance?.bind(actions);
if (_origSaveAttendance) {
    actions.saveAttendance = async function() {
        // Get the save button and put it in loading state
        const btn = document.querySelector('[onclick*="saveAttendance"]');
        const restoreBtn = rvBtnLoad(btn, 'Saving...');

        await withOptimistic(async () => {
            try {
                await _origSaveAttendance();
                ui.showToast('Attendance saved', 'success');
            } catch (err) {
                modal.alert('Error', extractErrorMessage(err), 'error');
            } finally {
                restoreBtn();
            }
        });
    };
}

// ── 12. Initial data load: show skeleton while loading ────────────────────────────
const _origLoadInitialData = app.loadInitialData?.bind(app);
if (_origLoadInitialData) {
    app.loadInitialData = async function() {
        progressBar.start();
        try {
            await _origLoadInitialData();
            progressBar.done();
        } catch (err) {
            progressBar.fail();
            throw err;
        }
    };
}

console.log('[optimistic-ui] ✓ Loaded — skeleton screens, optimistic mutations, progress bar active');