// ==================================================================================
// features.js — Ridgevalley Hybrid School Management System
// New Features Module (Load AFTER app.js)
//
// FEATURES IMPLEMENTED:
//   1. Weeks Management System
//   2. Billing Management System
//   3. Automatic Arrears Calculation (extended from existing)
//   4. Financial Summary in Terminal Reports
//   5. Financial Security with Email Verification
//   6. Protected Financial Report Exports
//   7. Term & Year Financial Analytics Integration
//
// HOW TO LOAD:
//   In index.html, after <script src="app.js"></script> add:
//     <script src="features.js"></script>
// ==================================================================================

'use strict';

// ==================================================================================
// SECTION 0 — GLOBAL FEATURE STATE
// ==================================================================================
const featureState = {
    weeks: [],
    bills: [],
    billAssignments: [],   // { bill_id, student_id }
    financialAccess: false,
    financialAccessExpiry: null,
    emailVerificationPending: false,  // true while waiting for user to click email link
};

// ==================================================================================
// SECTION 1 — SUPABASE HELPERS (reuse existing supabaseClient from app.js)
// ==================================================================================
const featureDB = {
    // ── Weeks ──────────────────────────────────────────────────────────────────────
    async loadWeeks() {
        const { data, error } = await supabaseClient
            .from('weeks')
            .select('*')
            .order('start_date', { ascending: true });
        if (!error) {
            featureState.weeks = data || [];
            // Auto-activate the week whose date range covers today
            await this._autoActivateCurrentWeek();
        }
        // Refresh the period display in the top nav to show active week
        if (typeof ui !== 'undefined' && ui.updatePeriodDisplay) {
            ui.updatePeriodDisplay();
        }
        return featureState.weeks;
    },

    // Automatically sets a week as active when its date range covers today,
    // but ONLY if no week is currently manually active for that AY/term.
    // Manual toggles via the UI are respected and never overridden here.
    async _autoActivateCurrentWeek() {
        const today = new Date().toISOString().split('T')[0];
        if (!state.currentAY || !state.currentTerm) return;

        const ayId   = state.currentAY.id;
        const termId = state.currentTerm.id;

        const termWeeks = featureState.weeks.filter(w =>
            w.academic_year_id === ayId && w.term_id === termId
        );

        // If any week in this term is already marked active, respect that — don't override
        const alreadyActive = termWeeks.find(w => w.status === 'active');
        if (alreadyActive) return;

        // No active week — find the one that covers today and activate it
        const todayWeek = termWeeks.find(w =>
            w.start_date <= today && w.end_date >= today
        );
        if (!todayWeek) return;

        try {
            await supabaseClient.from('weeks').update({ status: 'active' }).eq('id', todayWeek.id);
            featureState.weeks = featureState.weeks.map(w => ({
                ...w,
                status: w.id === todayWeek.id ? 'active' : w.status
            }));
        } catch (err) {
            console.warn('[autoActivateWeek] Non-critical error:', err);
        }
    },

    async saveWeek(week) {
        if (week.id) {
            const { id, created_at, ...fields } = week;
            const { error } = await supabaseClient.from('weeks').update(fields).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient.from('weeks').insert([week]);
            if (error) throw error;
        }
        await this.loadWeeks();
    },

    async deleteWeek(id) {
        const { error } = await supabaseClient.from('weeks').delete().eq('id', id);
        if (error) throw error;
        await this.loadWeeks();
    },

    // ── Bills ──────────────────────────────────────────────────────────────────────
    async loadBills() {
        const { data, error } = await supabaseClient
            .from('bills')
            .select('*')
            .order('created_at', { ascending: false });
        if (!error) featureState.bills = data || [];
        return featureState.bills;
    },

    async loadBillAssignments() {
        const { data, error } = await supabaseClient
            .from('bill_assignments')
            .select('*');
        if (!error) featureState.billAssignments = data || [];
        return featureState.billAssignments;
    },

    async saveBill(bill) {
        if (bill.id) {
            const { id, created_at, ...fields } = bill;
            const { data, error } = await supabaseClient.from('bills').update(fields).eq('id', id).select().single();
            if (error) throw error;
            await this.loadBills();
            return data;
        } else {
            const { data, error } = await supabaseClient.from('bills').insert([bill]).select().single();
            if (error) throw error;
            await this.loadBills();
            return data;
        }
    },

    async assignBillToStudents(billId, studentIds) {
        // Remove existing assignments for this bill first
        await supabaseClient.from('bill_assignments').delete().eq('bill_id', billId);
        if (studentIds.length === 0) return;

        const rows = studentIds.map(sid => ({ bill_id: billId, student_id: sid }));
        const { error } = await supabaseClient.from('bill_assignments').insert(rows);
        if (error) throw error;
        await this.loadBillAssignments();
    },

    async deleteBill(id) {
        await supabaseClient.from('bill_assignments').delete().eq('bill_id', id);
        const { error } = await supabaseClient.from('bills').delete().eq('id', id);
        if (error) throw error;
        await this.loadBills();
        await this.loadBillAssignments();
    },

    // ── Email Verification — uses Supabase Auth magic link ────────────────────────
    async sendVerificationEmail() {
        // The verification email address is stored in Supabase app_settings under key 'verification_email'
        // This keeps it out of source code and configurable without deploys
        try {
            const { data, error } = await supabaseClient
                .from('app_settings')
                .select('value')
                .eq('key', 'verification_email')
                .single();
            if (error || !data?.value) {
                throw new Error('Verification email address not configured. Please add verification_email to the app_settings table in Supabase.');
            }
            const verificationEmail = data.value;

            // Send a magic link / OTP email via Supabase Auth
            const { error: sendError } = await supabaseClient.auth.signInWithOtp({
                email: verificationEmail,
                options: {
                    shouldCreateUser: false,  // only works for existing users
                    emailRedirectTo: window.location.href,
                }
            });
            if (sendError) throw sendError;
            return { success: true, email: verificationEmail };
        } catch (e) {
            console.warn('[EmailVerify] Could not send verification email:', e?.message || e);
            throw e;
        }
    },

    async verifyEmailToken(token) {
        // Verify the 6-digit token the user received by email (Supabase email OTP)
        try {
            const { data, error } = await supabaseClient.auth.verifyOtp({
                email: await this._getVerificationEmail(),
                token: token,
                type: 'email',
            });
            if (error) return { success: false, reason: error.message || 'Invalid or expired code.' };
            return { success: true };
        } catch (e) {
            return { success: false, reason: e?.message || 'Verification failed.' };
        }
    },

    async _getVerificationEmail() {
        const { data } = await supabaseClient
            .from('app_settings')
            .select('value')
            .eq('key', 'verification_email')
            .single();
        return data?.value || '';
    },
};

// ==================================================================================
// SECTION 2 — FINANCIAL CALCULATIONS (extends existing dataManager)
// ==================================================================================
const billingCalc = {
    // Get bills assigned to a student (for current AY + term if provided, else all)
    getStudentBills(studentId, ayId, termId) {
        const student = (state.students || []).find(s => s.id === studentId);
        if (!student) return [];

        const assignments = featureState.billAssignments
            .filter(a => a.student_id === studentId)
            .map(a => a.bill_id);

        return featureState.bills.filter(bill => {
            if (!assignments.includes(bill.id)) return false;
            if (bill.status !== 'active') return false;
            if (ayId && bill.academic_year_id && bill.academic_year_id !== ayId) return false;
            if (termId && bill.term_id && bill.term_id !== termId) return false;
            return true;
        });
    },

    getTotalBilled(studentId, ayId, termId) {
        return this.getStudentBills(studentId, ayId, termId)
            .reduce((sum, b) => sum + (parseFloat(b.amount) || 0), 0);
    },

    // Confirmed payments from existing transactions
    getTotalPaid(studentId, ayId, termId) {
        return (state.transactions || [])
            .filter(t =>
                t.student_id === studentId &&
                t.type === 'payment' &&
                t.status === 'confirmed' &&
                (!ayId || t.year_id === ayId) &&
                (!termId || t.term_id === termId)
            )
            .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    },

    // Full financial snapshot for a student
    getStudentFinancials(studentId, ayId, termId) {
        const totalBilled  = this.getTotalBilled(studentId, ayId, termId);
        const totalPaid    = this.getTotalPaid(studentId, ayId, termId);
        const outstanding  = Math.max(0, totalBilled - totalPaid);
        const pct          = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
        let paymentStatus  = 'NO PAYMENT';
        if (totalPaid >= totalBilled && totalBilled > 0) paymentStatus = 'FULLY PAID';
        else if (totalPaid > 0) paymentStatus = 'PARTIAL PAYMENT';

        return { totalBilled, totalPaid, outstanding, paymentStatus, pct };
    },

    // All students with billing data
    getAllStudentFinancials(ayId, termId) {
        return (state.students || []).map(student => {
            const fin = this.getStudentFinancials(student.id, ayId, termId);
            const parent = (state.parents || []).find(p => p.children_ids?.includes(student.id));
            return {
                studentId: student.id,
                studentName: student.name,
                studentClass: student.class || '—',
                parentName: parent?.full_name || 'No Parent',
                ...fin,
            };
        });
    },

    // Resolve which student IDs a bill applies to based on applies_to field
    resolveBillTargets(bill) {
        const students = state.students || [];
        switch (bill.applies_to) {
            case 'all':   return students.map(s => s.id);
            case 'level': return students.filter(s => s.class?.startsWith(bill.target_value + ' -')).map(s => s.id);
            case 'class': return students.filter(s => s.class === bill.target_value).map(s => s.id);
            case 'student': return [bill.target_value].filter(Boolean);
            default:      return students.map(s => s.id);
        }
    },
};

// ==================================================================================
// SECTION 3 — EMAIL VERIFICATION / FINANCIAL SECURITY
// ==================================================================================
const financialSecurity = {
    AUTHORIZED_ROLES: ['admin', 'accountant', 'proprietor'],

    isAuthorized() {
        return this.AUTHORIZED_ROLES.includes(state.role);
    },

    isFinancialAccessActive() {
        if (!featureState.financialAccess) return false;
        if (featureState.financialAccessExpiry && new Date() > featureState.financialAccessExpiry) {
            featureState.financialAccess = false;
            return false;
        }
        return true;
    },

    maskValue(val) {
        return `<span class="fin-masked" style="filter:blur(5px);user-select:none;letter-spacing:2px;color:#94a3b8;">████████</span>`;
    },

    displayValue(val, prefix = '₵') {
        if (this.isFinancialAccessActive()) {
            return `${prefix}${typeof val === 'number' ? val.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val}`;
        }
        return this.maskValue(val);
    },

    async requestEmailVerification() {
        if (!this.isAuthorized()) {
            return modal.alert('Access Denied', 'Your role is not authorized to view financial data.', 'error');
        }

        try {
            app.showLoading('Sending verification email...');
            const result = await featureDB.sendVerificationEmail();
            app.hideLoading();
            // Show token entry modal
            this._showEmailVerifyModal(result.email);
        } catch (err) {
            app.hideLoading();
            modal.alert('Email Error', err.message || 'Could not send verification email. Please check the verification_email setting in Supabase app_settings.', 'error');
        }
    },

    _showEmailVerifyModal(emailAddress) {
        const modalId = 'email-verify-modal-' + Date.now();
        // Mask the email for display: show first 2 chars + *** + domain
        const parts = (emailAddress || '').split('@');
        const maskedEmail = parts.length === 2
            ? parts[0].slice(0, 2) + '***@' + parts[1]
            : '***@***.com';

        const html = `
            <div id="${modalId}" style="
                position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);
                display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;
                opacity:0;transition:opacity .25s ease;">
                <div style="
                    width:100%;max-width:420px;border-radius:20px;overflow:hidden;
                    box-shadow:0 24px 64px rgba(0,0,0,0.4);
                    transform:translateY(20px);transition:transform .25s ease;background:#0f172a;">
                    <!-- Header -->
                    <div style="background:linear-gradient(135deg,#1a56db,#0891b2);padding:24px;text-align:center;">
                        <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:50%;
                                    display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
                            <i class="fas fa-envelope-open-text" style="color:#fff;font-size:24px;"></i>
                        </div>
                        <h3 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 4px;">Email Verification</h3>
                        <p style="color:rgba(255,255,255,0.75);font-size:13px;margin:0;">
                            A 6-digit code has been sent to<br>
                            <strong style="color:#fff;">${maskedEmail}</strong>
                        </p>
                    </div>
                    <!-- Body -->
                    <div style="padding:24px;">
                        <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0 0 16px;">
                            Check your email inbox and enter the 6-digit code below.
                        </p>
                        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;" id="${modalId}-inputs">
                            ${[0,1,2,3,4,5].map(i => `
                                <input id="${modalId}-d${i}" type="text" maxlength="1" inputmode="numeric" pattern="[0-9]"
                                    style="width:44px;height:52px;border-radius:10px;border:2px solid #334155;
                                           background:#1e293b;color:#f8fafc;font-size:22px;font-weight:700;
                                           text-align:center;outline:none;transition:border-color .2s;"
                                    oninput="financialSecurity._digitInput(event,'${modalId}',${i})"
                                    onkeydown="financialSecurity._digitKey(event,'${modalId}',${i})">
                            `).join('')}
                        </div>
                        <p id="${modalId}-error" style="color:#f87171;font-size:12px;text-align:center;min-height:18px;margin:0 0 16px;"></p>
                        <button id="${modalId}-verify" onclick="financialSecurity._verifyEmailCode('${modalId}')"
                            style="width:100%;padding:12px;background:linear-gradient(135deg,#1a56db,#0891b2);
                                   color:#fff;border:none;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;">
                            <i class="fas fa-unlock" style="margin-right:8px;"></i>Verify & Unlock
                        </button>
                        <button onclick="financialSecurity.requestEmailVerification(); document.getElementById('${modalId}')?.remove();"
                            style="width:100%;padding:10px;margin-top:8px;background:transparent;border:1px solid #334155;
                                   color:#64748b;font-size:13px;cursor:pointer;border-radius:10px;">
                            <i class="fas fa-redo" style="margin-right:6px;"></i>Resend Code
                        </button>
                        <button onclick="document.getElementById('${modalId}').remove()"
                            style="width:100%;padding:10px;margin-top:6px;background:transparent;border:none;
                                   color:#475569;font-size:13px;cursor:pointer;">Cancel</button>
                        <p style="text-align:center;color:#475569;font-size:11px;margin-top:12px;">
                            <i class="fas fa-clock" style="margin-right:4px;"></i>Code expires in 10 minutes
                        </p>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
        const el = document.getElementById(modalId);
        const inner = el.querySelector('div');
        requestAnimationFrame(() => { el.style.opacity = '1'; inner.style.transform = 'translateY(0)'; });
        document.getElementById(`${modalId}-d0`)?.focus();
    },

    _digitInput(e, modalId, idx) {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(0, 1);
        if (val && idx < 5) {
            document.getElementById(`${modalId}-d${idx + 1}`)?.focus();
        }
    },

    _digitKey(e, modalId, idx) {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
            document.getElementById(`${modalId}-d${idx - 1}`)?.focus();
        }
        if (e.key === 'Enter') this._verifyEmailCode(modalId);
    },

    async _verifyEmailCode(modalId) {
        const digits = [0,1,2,3,4,5].map(i => document.getElementById(`${modalId}-d${i}`)?.value || '').join('');
        const errEl = document.getElementById(`${modalId}-error`);

        if (digits.length < 6) {
            if (errEl) errEl.textContent = 'Please enter all 6 digits.';
            return;
        }

        const btn = document.getElementById(`${modalId}-verify`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...'; }

        try {
            const result = await featureDB.verifyEmailToken(digits);
            if (result.success) {
                featureState.financialAccess = true;
                featureState.financialAccessExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min session
                document.getElementById(modalId)?.remove();
                ui.showToast('Access verified. Data Analysis unlocked for this session.', 'success');
                // Re-render current view to show unlocked content
                ui.route(state.currentView);
            } else {
                if (errEl) errEl.textContent = result.reason || 'Invalid or expired code.';
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-unlock" style="margin-right:8px;"></i>Verify & Unlock'; }
                const inputs = document.getElementById(`${modalId}-inputs`);
                if (inputs) { inputs.style.animation = 'emailShake 0.4s ease'; setTimeout(() => { inputs.style.animation = ''; }, 400); }
            }
        } catch (err) {
            if (errEl) errEl.textContent = 'Verification failed. Try again.';
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-unlock" style="margin-right:8px;"></i>Verify & Unlock'; }
        }
    },

    // Call this before any financial export
    requireAccess(onGranted) {
        if (!this.isAuthorized()) {
            return modal.alert('Access Denied', 'Your role is not authorized for financial exports.', 'error');
        }
        if (this.isFinancialAccessActive()) {
            onGranted();
        } else {
            modal.createModal(
                'Verification Required',
                '<p style="color:#cbd5e1;font-size:14px;">This action requires email verification. A code will be sent to the registered admin email to unlock access.</p>',
                () => this.requestEmailVerification(),
                null,
                'Send Verification Email',
                'Cancel',
                'info'
            );
        }
    },

    revokeAccess() {
        featureState.financialAccess = false;
        featureState.financialAccessExpiry = null;
    },
};

// Inject shake keyframes for verification modal
(function injectVerifyKeyframes() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes emailShake {
            0%,100% { transform: translateX(0); }
            20%      { transform: translateX(-8px); }
            40%      { transform: translateX(8px); }
            60%      { transform: translateX(-5px); }
            80%      { transform: translateX(5px); }
        }
    `;
    document.head.appendChild(style);
})();

// ==================================================================================
// SECTION 4 — VIEW RENDERERS (weeks, billing, extended finance)
// ==================================================================================
const featureViews = {

    // ── 4A. WEEKS MANAGEMENT ────────────────────────────────────────────────────
    async renderWeeks() {
        await featureDB.loadWeeks();
        const activeYear  = (state.academicYears || []).find(y => y.active);
        const allYears    = state.academicYears || [];
        const container   = document.getElementById('view-content');
        if (!container) return;

        // Group weeks by academic_year_id → term_id
        const grouped = {};
        featureState.weeks.forEach(w => {
            const ayKey = w.academic_year_id || 'unknown';
            if (!grouped[ayKey]) grouped[ayKey] = {};
            const termKey = w.term_id || 'general';
            if (!grouped[ayKey][termKey]) grouped[ayKey][termKey] = [];
            grouped[ayKey][termKey].push(w);
        });

        const ayOptions = allYears.map(y =>
            `<option value="${y.id}" ${activeYear && y.id === activeYear.id ? 'selected' : ''}>${y.year}</option>`
        ).join('');

        const termOptions = (activeYear?.terms || []).map(t =>
            `<option value="${t.id}">${t.name}</option>`
        ).join('');

        // Render grouped weeks table
        let weeksTableHtml = '';
        if (featureState.weeks.length === 0) {
            weeksTableHtml = `<p class="text-slate-500 text-center py-8">No weeks created yet. Use the form above to add weeks.</p>`;
        } else {
            Object.entries(grouped).forEach(([ayId, termMap]) => {
                const ay = allYears.find(y => y.id === ayId);
                Object.entries(termMap).forEach(([termId, weeks]) => {
                    const term = (ay?.terms || []).find(t => t.id === termId);
                    weeksTableHtml += `
                        <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg mb-4">
                            <div class="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-700 border-b border-slate-200 dark:border-slate-600">
                                <h4 class="font-bold text-slate-800 dark:text-slate-100">
                                    <i class="fas fa-calendar-alt text-blue-500 mr-2"></i>
                                    ${ay?.year || ayId} — ${term?.name || 'General'}
                                </h4>
                            </div>
                            <table class="w-full text-left">
                                <thead class="bg-slate-50 dark:bg-slate-700/50">
                                    <tr>
                                        <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Week</th>
                                        <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Start Date</th>
                                        <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">End Date</th>
                                        <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
                                        <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                                    ${weeks.map(w => `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                                            <td class="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">${w.week_name}</td>
                                            <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${this._formatDate(w.start_date)}</td>
                                            <td class="px-6 py-3 text-slate-600 dark:text-slate-400">${this._formatDate(w.end_date)}</td>
                                            <td class="px-6 py-3">
                                                <span class="px-3 py-1 rounded-full text-xs font-bold ${w.status === 'active'
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}">
                                                    ${w.status === 'active' ? '● Active' : '○ Inactive'}
                                                </span>
                                            </td>
                                            <td class="px-6 py-3 text-right">
                                                <div class="flex justify-end gap-2">
                                                    <button onclick="featureActions.toggleWeekStatus('${w.id}','${w.status}')"
                                                        class="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all
                                                               ${w.status === 'active'
                                                                ? 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400'
                                                                : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400'}">
                                                        ${w.status === 'active' ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                    <button onclick="featureActions.editWeek('${w.id}')"
                                                        class="px-3 py-1.5 text-xs font-bold rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 transition-all">
                                                        <i class="fas fa-pen"></i>
                                                    </button>
                                                    <button onclick="featureActions.deleteWeek('${w.id}','${w.week_name}')"
                                                        class="px-3 py-1.5 text-xs font-bold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 transition-all">
                                                        <i class="fas fa-trash"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                });
            });
        }

        container.innerHTML = `
            <div class="flex justify-between items-center mb-6">
                <div class="flex items-center gap-3">
                    <button onclick="ui.route('academic')" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--rv-surface);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                    <div>
                        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Weeks Management</h2>
                        <p class="text-sm text-slate-500 mt-1">Manage academic weeks for attendance, finance, and lesson planning.</p>
                    </div>
                </div>
            </div>

            <!-- Create Week Form -->
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                    <i class="fas fa-plus-circle text-ridge-500 mr-2"></i>Add New Week
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Academic Year</label>
                        <select id="wk-ay" onchange="featureActions.refreshTermOptions()"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">— Select Year —</option>
                            ${ayOptions}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Term</label>
                        <select id="wk-term"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">— Select Term —</option>
                            ${termOptions}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Week Name</label>
                        <input type="text" id="wk-name"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                            placeholder="Week 1">
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Start Date</label>
                        <input type="date" id="wk-start"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">End Date</label>
                        <input type="date" id="wk-end"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                    </div>
                    <div class="flex items-end">
                        <button onclick="featureActions.saveWeek()"
                            class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all btn-primary">
                            <i class="fas fa-plus mr-2"></i>Create Week
                        </button>
                    </div>
                </div>
            </div>

            <!-- Weeks Table -->
            ${weeksTableHtml}
        `;
    },

    // ── 4B. BILLING MANAGEMENT ──────────────────────────────────────────────────
    async renderBilling() {
        await featureDB.loadBills();
        await featureDB.loadBillAssignments();
        const container = document.getElementById('view-content');
        if (!container) return;

        const activeYear = (state.academicYears || []).find(y => y.active);
        const ayTermOpts = (activeYear?.terms || []).map(t =>
            `<option value="${t.id}">${t.name}</option>`
        ).join('');
        const ayId = activeYear?.id || '';

        const CATEGORIES = ['Tuition', 'Feeding', 'PTA', 'Uniform', 'Examination Fee', 'Transport', 'Graduation Fee', 'Other'];
        const APPLIES_TO = [
            { val: 'all',     label: 'All Students' },
            { val: 'level',   label: 'By Level' },
            { val: 'class',   label: 'By Class' },
            { val: 'student', label: 'Specific Student' },
        ];

        const levels   = [...new Set((state.classes || []).map(c => c.level))];
        const classes  = (state.classes || []).map(c => `${c.level} - ${c.grade}`);
        const students = (state.students || []).map(s => ({ id: s.id, name: s.name, cls: s.class }));

        const bills = featureState.bills;

        container.innerHTML = `
            <div class="flex justify-between items-center mb-6">
                <div class="flex items-center gap-3">
                    <button onclick="ui.route('finance')" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--rv-surface);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                    <div>
                        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Billing Management</h2>
                        <p class="text-sm text-slate-500 mt-1">Create and manage official financial obligations for students.</p>
                    </div>
                </div>
            </div>

            <!-- Create Bill Form -->
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">
                    <i class="fas fa-file-invoice-dollar text-ridge-500 mr-2"></i>Create New Bill
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Bill Name</label>
                        <input type="text" id="bl-name"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                            placeholder="e.g. Tuition Fee Term 1">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Amount (₵)</label>
                        <input type="number" id="bl-amount" min="0" step="0.01"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                            placeholder="0.00">
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Term</label>
                        <select id="bl-term"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">All Terms</option>
                            ${ayTermOpts}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Due Date</label>
                        <input type="date" id="bl-due"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Applies To</label>
                        <select id="bl-applies" onchange="featureViews._onAppliesChange()"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            ${APPLIES_TO.map(a => `<option value="${a.val}">${a.label}</option>`).join('')}
                        </select>
                    </div>
                    <div id="bl-target-wrap">
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Target</label>
                        <select id="bl-target" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">—</option>
                        </select>
                    </div>
                </div>
                <button onclick="featureActions.saveBill()"
                    class="px-8 py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all btn-primary">
                    <i class="fas fa-plus mr-2"></i>Publish Bill
                </button>
            </div>

            <!-- Bills List -->
            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 class="font-bold text-slate-800 dark:text-white">
                        <i class="fas fa-list text-blue-500 mr-2"></i>Published Bills (${bills.length})
                    </h3>
                    <input type="text" id="bl-search" oninput="featureViews._filterBills()"
                        class="input-field rounded-xl px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none"
                        placeholder="Search bills...">
                </div>
                <div id="bl-table-body">
                    ${this._renderBillsTable(bills)}
                </div>
            </div>
        `;

        // Populate hidden target field data
        featureViews._billTargetData = { levels, classes, students };
        featureViews._onAppliesChange();
    },

    _billTargetData: { levels: [], classes: [], students: [] },

    _onAppliesChange() {
        const applies   = document.getElementById('bl-applies')?.value;
        const targetWrap = document.getElementById('bl-target-wrap');
        const targetSel  = document.getElementById('bl-target');
        if (!targetSel || !targetWrap) return;

        const { levels, classes, students } = this._billTargetData;
        targetSel.innerHTML = '<option value="">—</option>';

        if (applies === 'all') {
            targetWrap.style.display = 'none';
        } else {
            targetWrap.style.display = '';
            if (applies === 'level') {
                levels.forEach(l => targetSel.insertAdjacentHTML('beforeend', `<option value="${l}">${l}</option>`));
            } else if (applies === 'class') {
                classes.forEach(c => targetSel.insertAdjacentHTML('beforeend', `<option value="${c}">${c}</option>`));
            } else if (applies === 'student') {
                students.forEach(s => targetSel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.name} (${s.cls || '—'})</option>`));
            }
        }
    },

    _renderBillsTable(bills) {
        if (bills.length === 0) {
            return `<p class="text-slate-500 text-center py-8">No bills created yet.</p>`;
        }

        const activeYear = (state.academicYears || []).find(y => y.active);
        const getTermName = (termId) => {
            const t = (activeYear?.terms || []).find(t => t.id === termId);
            return t?.name || (termId ? 'Unknown Term' : 'All Terms');
        };

        const appliesLabel = (bill) => {
            switch (bill.applies_to) {
                case 'all': return 'All Students';
                case 'level': return `Level: ${bill.target_value}`;
                case 'class': return `Class: ${bill.target_value}`;
                case 'student': {
                    const s = (state.students || []).find(s => s.id === bill.target_value);
                    return `Student: ${s?.name || bill.target_value}`;
                }
                default: return bill.applies_to || 'All';
            }
        };

        return `
            <div class="overflow-x-auto">
                <table class="w-full text-left min-w-[700px]" id="bl-table">
                    <thead class="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-600">
                        <tr>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Bill</th>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Amount</th>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Term</th>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Applies To</th>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
                            <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                        ${bills.map(b => `
                            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors" data-bill-name="${(b.bill_name || '').toLowerCase()}">
                                <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${b.bill_name}</td>
                                <td class="px-6 py-4 font-bold text-emerald-600">₵${parseFloat(b.amount || 0).toLocaleString('en-GH', {minimumFractionDigits:2})}</td>
                                <td class="px-6 py-4 text-slate-600 dark:text-slate-400">${getTermName(b.term_id)}</td>
                                <td class="px-6 py-4 text-slate-600 dark:text-slate-400">${appliesLabel(b)}</td>
                                <td class="px-6 py-4">
                                    <span class="px-3 py-1 rounded-full text-xs font-bold ${b.status === 'active'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}">
                                        ${b.status === 'active' ? '● Active' : '○ Archived'}
                                    </span>
                                </td>
                                <td class="px-6 py-4 text-right">
                                    <div class="flex justify-end gap-2">
                                        <button onclick="featureActions.viewBillStudents('${b.id}')"
                                            class="px-3 py-1.5 text-xs font-bold rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 transition-all"
                                            title="View assigned students">
                                            <i class="fas fa-users"></i>
                                        </button>
                                        <button onclick="featureActions.archiveBill('${b.id}','${b.status}')"
                                            class="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 transition-all"
                                            title="${b.status === 'active' ? 'Archive' : 'Restore'}">
                                            <i class="fas fa-${b.status === 'active' ? 'archive' : 'redo'}"></i>
                                        </button>
                                        <button onclick="featureActions.deleteBill('${b.id}','${b.bill_name}')"
                                            class="px-3 py-1.5 text-xs font-bold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 transition-all">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    _filterBills() {
        const q = (document.getElementById('bl-search')?.value || '').toLowerCase();
        document.querySelectorAll('#bl-table tbody tr').forEach(row => {
            const text = row.getAttribute('data-bill-name') || '';
            row.style.display = text.includes(q) ? '' : 'none';
        });
    },

    // ── 4C. EXTENDED FINANCE VIEW — email-verified original fees + Bills sub-feature ───
    renderFinanceExtended() {
        const baseContainer = document.getElementById('view-content');
        if (!baseContainer) return;

        const isLocked     = !financialSecurity.isFinancialAccessActive();
        const isAuthorized = financialSecurity.isAuthorized();

        // If access is locked, show email verification gate — nothing else renders until verified
        if (isLocked && isAuthorized) {
            baseContainer.innerHTML = `
                <div class="flex justify-between items-center mb-6">
                    <div>
                        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Finance</h2>
                        <p class="text-sm text-slate-500 mt-1">Fee structure, payments &amp; bills</p>
                    </div>
                </div>
                <div class="glass-panel rounded-2xl p-10 bg-white dark:bg-slate-800 shadow-lg text-center max-w-md mx-auto">
                    <div class="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-5">
                        <i class="fas fa-lock text-amber-500 text-3xl"></i>
                    </div>
                    <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">Financial Data Protected</h3>
                    <p class="text-sm text-slate-500 mb-6">
                        This section requires email verification.<br>
                        A verification code will be sent to the registered admin email to unlock.
                    </p>
                    <button onclick="financialSecurity.requestEmailVerification()"
                        class="px-8 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-base hover:shadow-lg transition-all w-full btn-primary">
                        <i class="fas fa-envelope mr-2"></i>Send Verification Email
                    </button>
                    <p class="text-xs text-slate-400 mt-3">A 6-digit code will be sent to the registered admin email • Expires in 10 minutes</p>
                </div>
            `;
            return;
        }

        // ── UNLOCKED: render original fee structure + Bills sub-feature as tabs ──
        const activeYear = (state.academicYears || []).find(y => y.active);
        const activeTerm = activeYear?.terms?.find(t => t.active);

        // Original fee section data (from app.js state)
        const pendingPayments        = (state.transactions || []).filter(t => t.status === 'pending' && t.type === 'payment');
        const confirmedTransactions  = (state.transactions || []).filter(t => t.status === 'confirmed' || t.status === 'rejected');
        const allArrears             = typeof dataManager !== 'undefined' && dataManager.getAllArrears ? dataManager.getAllArrears() : [];

        // Bills tab data — arrears only
        const allFinancials   = billingCalc.getAllStudentFinancials(activeYear?.id, activeTerm?.id);
        const totalOwing      = allFinancials.reduce((s, f) => s + f.outstanding, 0);
        const arrearsStudents = allFinancials.filter(f => f.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);


        // ── ORIGINAL FEE STRUCTURE (fully preserved from app.js renderFinance) ──
        const originalFeeTabContent = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-slate-800 dark:text-white">Set Fee Structure</h3>
                    <select id="fee-scope" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                        <option value="global">Global (All Students)</option>
                        ${[...new Set((state.classes || []).map(c => c.level))].map(l => `<option value="${l}">Level: ${l}</option>`).join('')}
                    </select>
                    <input type="number" id="fee-amount" class="input-field w-full rounded-xl px-4 py-3 mb-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Amount (₵)">
                    <input type="text" id="fee-desc" class="input-field w-full rounded-xl px-4 py-3 mb-4 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none" placeholder="Description">
                    <button onclick="actions.addFee()" class="w-full py-3 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold hover:shadow-lg transition-all">
                        Publish Fee
                    </button>
                </div>
                <div class="lg:col-span-2 glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold mb-4 text-blue-600">
                        <i class="fas fa-list mr-2"></i>Published Fee Structure (${(state.fees || []).length})
                    </h3>
                    <div class="space-y-3 max-h-96 overflow-y-auto">
                        ${(state.fees || []).length === 0 ? '<p class="text-slate-500 text-center py-4">No fees published yet</p>' : (state.fees || []).map(fee => `
                            <div class="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                                <div>
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${fee.description}</p>
                                    <p class="text-sm text-blue-700 dark:text-blue-300">₵${fee.amount} • ${fee.scope === 'global' ? 'All Students' : fee.scope}</p>
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
                <h3 class="text-lg font-bold mb-4 text-red-600">
                    <i class="fas fa-exclamation-triangle mr-2"></i>Student Arrears (${allArrears.length} students owing)
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
                                        <td class="px-6 py-3 text-right font-bold text-red-600">₵${a.amount.toFixed(2)}</td>
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
                        const student = (state.students || []).find(s => s.id === t.student_id);
                        return `
                            <div class="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                                <div>
                                    <p class="font-bold text-slate-800 dark:text-slate-200">${student?.name || 'Unknown'}</p>
                                    <p class="text-sm text-amber-700 dark:text-amber-300">₵${t.amount} • ${t.method}</p>
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
                                    const student = (state.students || []).find(s => s.id === t.student_id);
                                    const statusColor = t.status === 'confirmed' ? 'text-emerald-600' : 'text-red-600';
                                    const statusBg    = t.status === 'confirmed' ? 'bg-emerald-100' : 'bg-red-100';
                                    return `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">${new Date(t.created_at).toLocaleDateString()}</td>
                                            <td class="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">${student?.name || 'Unknown'}</td>
                                            <td class="px-6 py-4 font-bold text-emerald-600">₵${t.amount}</td>
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

        // ── BILLS SUB-FEATURE TAB (goes to report cards) ──

        const billsArrearsTable = `
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="font-bold text-red-600 mb-4">
                    <i class="fas fa-exclamation-triangle mr-2"></i>Student Arrears — Outstanding Balances (${arrearsStudents.length})
                </h3>
                <p class="text-xs text-slate-500 mb-4">Students who have unpaid bill amounts from assigned bills. These arrear amounts are visible on their report cards.</p>
                ${arrearsStudents.length === 0
                    ? '<p class="text-emerald-600 text-center py-4 font-semibold">🎉 No outstanding arrears!</p>'
                    : `<div class="overflow-x-auto">
                           <table class="w-full text-left min-w-[500px]">
                               <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                                   <tr>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Student</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Class</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Amount Owed</th>
                                   </tr>
                               </thead>
                               <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                                   ${arrearsStudents.map(f => `
                                       <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                                           <td class="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">${f.studentName}</td>
                                           <td class="px-6 py-3 text-slate-500">${f.studentClass}</td>
                                           <td class="px-6 py-3 font-bold text-red-600 text-right">₵${f.outstanding.toLocaleString('en-GH',{minimumFractionDigits:2})}</td>
                                       </tr>
                                   `).join('')}
                               </tbody>
                           </table>
                       </div>`
                }
            </div>
        `;

        const billsPublishedPanel = `
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="font-bold text-slate-800 dark:text-white">
                        <i class="fas fa-file-invoice-dollar text-blue-500 mr-2"></i>Published Bills (${featureState.bills.length})
                        <span class="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full font-bold">→ Appear on Report Cards</span>
                    </h3>
                    <button onclick="featureActions.navigateToRoute('billing')"
                        class="px-4 py-2 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                        <i class="fas fa-plus mr-2"></i>Manage Bills
                    </button>
                </div>
                ${featureState.bills.length === 0
                    ? `<div class="text-center py-10 text-slate-400">
                           <i class="fas fa-file-invoice-dollar text-4xl mb-3"></i>
                           <p class="font-semibold">No bills published yet.</p>
                           <p class="text-sm mt-1">Bills you create will automatically appear on students' report cards.</p>
                           <button onclick="featureActions.navigateToRoute('billing')"
                               class="mt-4 px-6 py-2.5 bg-gradient-to-r from-ridge-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                               Create First Bill
                           </button>
                       </div>`
                    : `<div class="overflow-x-auto">
                           <table class="w-full text-left min-w-[700px]">
                               <thead class="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-600">
                                   <tr>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Bill</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Amount</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Applies To</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
                                       <th class="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                                   </tr>
                               </thead>
                               <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                                   ${featureState.bills.slice(0, 10).map(b => {
                                       const appliesLabel = b.applies_to === 'all' ? 'All Students'
                                           : b.applies_to === 'level'   ? `Level: ${b.target_value}`
                                           : b.applies_to === 'class'   ? `Class: ${b.target_value}`
                                           : `Student: ${(state.students||[]).find(s=>s.id===b.target_value)?.name || b.target_value}`;
                                       return `
                                           <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                                               <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${b.bill_name}</td>
                                               <td class="px-6 py-4 font-bold text-emerald-600">₵${parseFloat(b.amount||0).toLocaleString('en-GH',{minimumFractionDigits:2})}</td>
                                               <td class="px-6 py-4 text-slate-600 dark:text-slate-400">${appliesLabel}</td>
                                               <td class="px-6 py-4">
                                                   <span class="px-3 py-1 rounded-full text-xs font-bold ${b.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}">
                                                       ${b.status === 'active' ? '● Active' : '○ Archived'}
                                                   </span>
                                               </td>
                                               <td class="px-6 py-4 text-right">
                                                   <button onclick="featureActions.navigateToRoute('billing')"
                                                       class="px-3 py-1.5 text-xs font-bold rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 transition-all">
                                                       <i class="fas fa-pen"></i>
                                                   </button>
                                               </td>
                                           </tr>
                                       `;
                                   }).join('')}
                               </tbody>
                           </table>
                           ${featureState.bills.length > 10 ? `<p class="text-xs text-slate-400 text-center py-3">Showing 10 of ${featureState.bills.length} bills. <button onclick="featureActions.navigateToRoute('billing')" class="text-blue-500 underline">View all</button></p>` : ''}
                       </div>`
                }
            </div>
        `;

        // ── SESSION LOCK CONTROL (shown once unlocked) ──
        const lockControl = isAuthorized ? `
            <div class="flex justify-end mb-2">
                <button onclick="financialSecurity.revokeAccess(); ui.route('finance')"
                    class="px-4 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs hover:bg-slate-200 transition-all">
                    <i class="fas fa-lock mr-1"></i>Lock Financial Data
                </button>
            </div>
        ` : '';

        // ── RENDER TABS ──
        baseContainer.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div>
                    <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Finance</h2>
                    <p class="text-sm text-slate-500 mt-1">
                        ${activeYear ? `${activeYear.year}${activeTerm ? ' — ' + activeTerm.name : ''}` : 'No active period'}
                    </p>
                </div>
            </div>
            ${lockControl}

            <!-- Tab Bar -->
            <div class="flex gap-1 mb-6 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1.5 w-full max-w-md" id="finance-tab-bar">
                <button id="fin-tab-fees" onclick="featureViews._switchFinanceTab('fees')"
                    class="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm">
                    <i class="fas fa-wallet mr-1.5"></i>Fee Structure
                </button>
                <button id="fin-tab-bills" onclick="featureViews._switchFinanceTab('bills')"
                    class="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    <i class="fas fa-file-invoice-dollar mr-1.5"></i>Bills
                </button>
            </div>

            <!-- Fee Structure Tab -->
            <div id="fin-panel-fees">
                ${originalFeeTabContent}
            </div>

            <!-- Bills Sub-Feature Tab -->
            <div id="fin-panel-bills" style="display:none;">
                <div class="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl flex items-start gap-3">
                    <i class="fas fa-info-circle text-blue-500 mt-0.5"></i>
                    <div class="flex-1">
                        <p class="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1">Bills for Next Term</p>
                        <p class="text-sm text-blue-700 dark:text-blue-300">
                            Bills are upcoming payment obligations for the next academic term. Each published bill is automatically attached to the assigned student's report card. Arrears below show students who still owe from previously assigned bills.
                        </p>
                    </div>
                    <button onclick="ui.route('billing')" class="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all">
                        <i class="fas fa-file-invoice-dollar mr-1.5"></i>Manage Bills
                    </button>
                </div>
                ${billsArrearsTable}
                ${billsPublishedPanel}
            </div>
        `;

        featureViews._switchFinanceTab('fees');
    },

    // Tab switcher for the finance view
    _switchFinanceTab(tab) {
        const fees  = document.getElementById('fin-panel-fees');
        const bills = document.getElementById('fin-panel-bills');
        const tabFees  = document.getElementById('fin-tab-fees');
        const tabBills = document.getElementById('fin-tab-bills');
        if (!fees || !bills || !tabFees || !tabBills) return;

        const activeClass   = ['bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-white', 'shadow-sm'];
        const inactiveClass = ['text-slate-500'];

        if (tab === 'fees') {
            fees.style.display  = '';
            bills.style.display = 'none';
            tabFees.classList.add(...activeClass);
            tabFees.classList.remove(...inactiveClass);
            tabBills.classList.remove(...activeClass);
            tabBills.classList.add(...inactiveClass);
        } else {
            fees.style.display  = 'none';
            bills.style.display = '';
            tabBills.classList.add(...activeClass);
            tabBills.classList.remove(...inactiveClass);
            tabFees.classList.remove(...activeClass);
            tabFees.classList.add(...inactiveClass);
        }
    },

    // ── 4D. FINANCIAL ANALYTICS (Term & Year) ────────────────────────────────────
    renderFinancialAnalytics() {
        const container = document.getElementById('view-content');
        if (!container) return;

        const isLocked     = !financialSecurity.isFinancialAccessActive();
        const isAuthorized = financialSecurity.isAuthorized();
        const years        = state.academicYears || [];
        const activeYear   = years.find(y => y.active);

        const lockBanner = isAuthorized && isLocked ? `
            <div class="p-4 mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-2xl flex items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <i class="fas fa-lock text-amber-500 text-xl"></i>
                    <p class="font-semibold text-amber-800 dark:text-amber-200 text-sm">Financial analytics are protected. Verify your identity to access.</p>
                </div>
                <button onclick="financialSecurity.requestEmailVerification()" class="px-5 py-2 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-600 transition-all">
                    <i class="fas fa-envelope mr-2"></i>Verify Email
                </button>
            </div>
        ` : '';

        const termOptions = (activeYear?.terms || []).map(t =>
            `<option value="${t.id}">${t.name}</option>`
        ).join('');

        container.innerHTML = `
            <div class="flex justify-between items-center mb-6">
                <div class="flex items-center gap-3">
                    <button onclick="ui.route('finance')" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--rv-surface);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                    <div>
                        <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Financial Analytics</h2>
                        <p class="text-sm text-slate-500 mt-1">Term and year-level financial intelligence reports.</p>
                    </div>
                </div>
                ${isAuthorized && !isLocked ? `
                    <button onclick="financialSecurity.requireAccess(() => featureActions.exportFinancialReport())"
                        class="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                        <i class="fas fa-download mr-2"></i>Export Report
                    </button>
                ` : ''}
            </div>

            ${lockBanner}

            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <h3 class="font-bold text-slate-800 dark:text-white mb-4">
                    <i class="fas fa-sliders-h text-blue-500 mr-2"></i>Analytics Configuration
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Academic Year</label>
                        <select id="fan-year" onchange="featureViews._loadAnalytics()"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">— Select Year —</option>
                            ${years.map(y => `<option value="${y.id}" ${activeYear && y.id === activeYear.id ? 'selected' : ''}>${y.year}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Mode</label>
                        <select id="fan-mode" onchange="featureViews._loadAnalytics()"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="term">Term</option>
                            <option value="year">Full Year</option>
                        </select>
                    </div>
                    <div id="fan-term-wrap">
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Term</label>
                        <select id="fan-term" onchange="featureViews._loadAnalytics()"
                            class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-ridge-500 outline-none">
                            <option value="">All Terms</option>
                            ${termOptions}
                        </select>
                    </div>
                </div>
            </div>

            <div id="fan-results">
                <div class="text-center py-12 text-slate-400">
                    <i class="fas fa-chart-bar text-4xl mb-3"></i>
                    <p>Select a year and mode to view analytics.</p>
                </div>
            </div>
        `;

        // Auto-load if year is pre-selected
        if (activeYear) featureViews._loadAnalytics();
    },

    _loadAnalytics() {
        const yearId = document.getElementById('fan-year')?.value;
        const mode   = document.getElementById('fan-mode')?.value || 'term';
        const termId = document.getElementById('fan-term')?.value;
        const wrap   = document.getElementById('fan-term-wrap');
        if (wrap) wrap.style.display = mode === 'year' ? 'none' : '';

        const results = document.getElementById('fan-results');
        if (!results || !yearId) return;

        const isLocked = !financialSecurity.isFinancialAccessActive();
        const ay = (state.academicYears || []).find(y => y.id === yearId);
        const terms = mode === 'year' ? (ay?.terms || []) : (termId ? (ay?.terms || []).filter(t => t.id === termId) : [null]);

        let html = '';

        terms.forEach(term => {
            const tId   = term?.id || null;
            const tName = term?.name || 'All Terms';
            const fin   = billingCalc.getAllStudentFinancials(yearId, tId);

            const totalBilled = fin.reduce((s, f) => s + f.totalBilled, 0);
            const totalPaid   = fin.reduce((s, f) => s + f.totalPaid, 0);
            const totalOwing  = fin.reduce((s, f) => s + f.outstanding, 0);
            const collectPct  = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
            const arrearsStudents = fin.filter(f => f.outstanding > 0);

            // Bill category breakdown
            const activeBills = featureState.bills.filter(b =>
                b.status === 'active' &&
                (!yearId || b.academic_year_id === yearId) &&
                (!tId || b.term_id === tId)
            );
            const categoryMap = {};
            activeBills.forEach(b => {
                categoryMap[b.bill_category] = (categoryMap[b.bill_category] || 0) + parseFloat(b.amount || 0);
            });

            const dV = (v) => isLocked ? '<span style="filter:blur(4px);color:#94a3b8">████</span>' : `₵${v.toLocaleString('en-GH',{minimumFractionDigits:2})}`;

            html += `
                <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                    <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-5 flex items-center gap-2">
                        <i class="fas fa-chart-line text-blue-500"></i>
                        ${ay?.year || 'Unknown'} — ${tName}
                    </h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        ${[
                            { label: 'Total Billed',  val: dV(totalBilled), sub: `${fin.length} students`, color: '#1a56db' },
                            { label: 'Collected',     val: dV(totalPaid),   sub: `${collectPct}% rate`,    color: '#059669' },
                            { label: 'Outstanding',   val: dV(totalOwing),  sub: `${arrearsStudents.length} owing`, color: '#dc2626' },
                            { label: 'Collection %',  val: isLocked ? '<span style="filter:blur(4px)">██%</span>' : `${collectPct}%`, sub: 'of total billed', color: collectPct >= 80 ? '#059669' : '#d97706' },
                        ].map(c => `
                            <div style="background:var(--rv-bg,#f8fafc);border-radius:12px;padding:16px;border:1px solid var(--rv-border,#e2e8f0);">
                                <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${c.label}</div>
                                <div style="font-size:20px;font-weight:800;color:${c.color};line-height:1;">${c.val}</div>
                                <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${c.sub}</div>
                            </div>
                        `).join('')}
                    </div>

                    ${Object.keys(categoryMap).length > 0 ? `
                        <h4 style="font-size:14px;font-weight:700;color:var(--rv-navy,#0f2044);margin-bottom:10px;">
                            <i class="fas fa-tags" style="color:#1a56db;margin-right:6px;"></i>Bill Category Breakdown
                        </h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px;">
                            ${Object.entries(categoryMap).map(([cat, amt]) => `
                                <div style="background:rgba(26,86,219,0.05);border:1px solid rgba(26,86,219,0.15);border-radius:10px;padding:12px;">
                                    <div style="font-size:11px;font-weight:700;color:#1a56db;text-transform:uppercase;margin-bottom:4px;">${cat}</div>
                                    <div style="font-size:16px;font-weight:800;color:var(--rv-navy,#0f2044);">${dV(amt)}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    ${!isLocked && arrearsStudents.length > 0 ? `
                        <h4 style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:10px;">
                            <i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>
                            Students with Arrears (${arrearsStudents.length})
                        </h4>
                        <div style="overflow-x:auto;">
                            <table style="width:100%;border-collapse:collapse;min-width:500px;">
                                <thead>
                                    <tr style="background:var(--rv-bg,#f8fafc);border-bottom:2px solid var(--rv-border,#e2e8f0);">
                                        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Student</th>
                                        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Class</th>
                                        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Amount Owing</th>
                                        <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${arrearsStudents.slice(0, 15).map(f => `
                                        <tr style="border-bottom:1px solid var(--rv-border,#e2e8f0);">
                                            <td style="padding:10px 14px;font-weight:600;color:var(--rv-navy,#0f2044);">${f.studentName}</td>
                                            <td style="padding:10px 14px;color:#64748b;">${f.studentClass}</td>
                                            <td style="padding:10px 14px;text-align:right;font-weight:700;color:#dc2626;">₵${f.outstanding.toLocaleString('en-GH',{minimumFractionDigits:2})}</td>
                                            <td style="padding:10px 14px;text-align:center;">
                                                <span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;
                                                    background:${f.paymentStatus === 'PARTIAL PAYMENT' ? '#fef3c7' : '#fee2e2'};
                                                    color:${f.paymentStatus === 'PARTIAL PAYMENT' ? '#92400e' : '#991b1b'};">
                                                    ${f.paymentStatus}
                                                </span>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            ${arrearsStudents.length > 15 ? `<p style="font-size:12px;color:#64748b;text-align:center;margin-top:8px;">Showing 15 of ${arrearsStudents.length}. Export report for full list.</p>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        results.innerHTML = html || '<p class="text-center text-slate-400 py-8">No financial data available for this selection.</p>';
    },

    // ── Helpers ──────────────────────────────────────────────────────────────────
    _formatDate(d) {
        if (!d) return '—';
        try { return new Date(d).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch { return d; }
    },
};

// ==================================================================================
// SECTION 5 — FEATURE ACTIONS
// ==================================================================================
const featureActions = {

    // ── Weeks ────────────────────────────────────────────────────────────────────
    async saveWeek(overrideData) {
        const data = overrideData || {
            week_name:        document.getElementById('wk-name')?.value?.trim(),
            start_date:       document.getElementById('wk-start')?.value,
            end_date:         document.getElementById('wk-end')?.value,
            academic_year_id: document.getElementById('wk-ay')?.value,
            term_id:          document.getElementById('wk-term')?.value || null,
            status:           'active',
        };

        if (!data.week_name) return modal.alert('Validation', 'Please enter a week name.', 'warning');
        if (!data.start_date || !data.end_date) return modal.alert('Validation', 'Please select start and end dates.', 'warning');
        if (data.start_date >= data.end_date) return modal.alert('Validation', 'End date must be after start date.', 'warning');
        if (!data.academic_year_id) return modal.alert('Validation', 'Please select an academic year.', 'warning');

        // Overlap check
        const overlaps = featureState.weeks.filter(w =>
            (!data.id || w.id !== data.id) &&
            w.academic_year_id === data.academic_year_id &&
            w.term_id === data.term_id &&
            w.start_date < data.end_date &&
            w.end_date > data.start_date
        );
        if (overlaps.length > 0) {
            return modal.alert('Overlap Detected', `This week overlaps with: ${overlaps.map(w => w.week_name).join(', ')}.`, 'error');
        }

        try {
            app.showLoading('Saving week...');
            await featureDB.saveWeek(data); // also calls loadWeeks() which auto-activates + updates period display
            app.hideLoading();
            ui.showToast('Week saved successfully.', 'success');
            featureViews.renderWeeks();
        } catch (err) {
            app.hideLoading();
            modal.alert('Error', err.message || String(err), 'error');
        }
    },

    editWeek(id) {
        const w = featureState.weeks.find(w => w.id === id);
        if (!w) return;

        const years = state.academicYears || [];
        const ay    = years.find(y => y.id === w.academic_year_id);

        const modalId = 'edit-week-' + Date.now();
        const ayOpts  = years.map(y => `<option value="${y.id}" ${y.id === w.academic_year_id ? 'selected' : ''}>${y.year}</option>`).join('');
        const termOpts = (ay?.terms || []).map(t => `<option value="${t.id}" ${t.id === w.term_id ? 'selected' : ''}>${t.name}</option>`).join('');

        const html = `
            <div id="${modalId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;opacity:0;transition:opacity .25s;">
                <div style="background:#1e293b;border-radius:20px;padding:28px;max-width:480px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.4);transform:translateY(16px);transition:transform .25s;">
                    <div style="display:flex;align-items:center;justify-content:between;margin-bottom:20px;">
                        <h3 style="font-size:17px;font-weight:700;color:#f8fafc;margin:0;flex:1;">Edit Week: ${w.week_name}</h3>
                        <button onclick="document.getElementById('${modalId}').remove()" style="background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:4px;">✕</button>
                    </div>
                    <div style="display:grid;gap:12px;">
                        <div>
                            <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Week Name</label>
                            <input id="${modalId}-name" type="text" value="${w.week_name}"
                                style="width:100%;padding:10px 14px;background:#0f172a;border:1.5px solid #334155;border-radius:10px;color:#f8fafc;font-size:14px;outline:none;box-sizing:border-box;">
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div>
                                <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">Start Date</label>
                                <input id="${modalId}-start" type="date" value="${w.start_date}"
                                    style="width:100%;padding:10px 14px;background:#0f172a;border:1.5px solid #334155;border-radius:10px;color:#f8fafc;font-size:14px;outline:none;box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;display:block;margin-bottom:4px;">End Date</label>
                                <input id="${modalId}-end" type="date" value="${w.end_date}"
                                    style="width:100%;padding:10px 14px;background:#0f172a;border:1.5px solid #334155;border-radius:10px;color:#f8fafc;font-size:14px;outline:none;box-sizing:border-box;">
                            </div>
                        </div>
                        <div style="display:flex;gap:12px;margin-top:8px;">
                            <button onclick="document.getElementById('${modalId}').remove()"
                                style="flex:1;padding:11px;background:transparent;border:1.5px solid #334155;border-radius:12px;color:#94a3b8;font-weight:700;cursor:pointer;font-size:14px;">Cancel</button>
                            <button onclick="featureActions._commitEditWeek('${modalId}','${w.id}')"
                                style="flex:1;padding:11px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:12px;color:#fff;font-weight:700;cursor:pointer;font-size:14px;">
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', html);
        const el = document.getElementById(modalId);
        const inner = el.querySelector('div');
        requestAnimationFrame(() => { el.style.opacity = '1'; inner.style.transform = 'translateY(0)'; });
        el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    },

    async _commitEditWeek(modalId, id) {
        const data = {
            id,
            week_name:  document.getElementById(`${modalId}-name`)?.value?.trim(),
            start_date: document.getElementById(`${modalId}-start`)?.value,
            end_date:   document.getElementById(`${modalId}-end`)?.value,
        };
        document.getElementById(modalId)?.remove();
        await this.saveWeek({ ...featureState.weeks.find(w => w.id === id), ...data });
    },

    async toggleWeekStatus(id, currentStatus) {
        try {
            app.showLoading('Updating...');
            const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
            // saveWeek internally calls loadWeeks() which updates period display
            await featureDB.saveWeek({ id, status: newStatus });
            app.hideLoading();
            ui.showToast(`Week ${newStatus === 'active' ? 'activated' : 'deactivated'}.`, 'success');
            featureViews.renderWeeks();
        } catch (err) {
            app.hideLoading();
            modal.alert('Error', err.message || String(err), 'error');
        }
    },

    deleteWeek(id, name) {
        modal.confirmDelete(name, async () => {
            try {
                app.showLoading('Deleting...');
                await featureDB.deleteWeek(id);
                app.hideLoading();
                ui.showToast('Week deleted.', 'success');
                featureViews.renderWeeks();
            } catch (err) {
                app.hideLoading();
                modal.alert('Error', err.message || String(err), 'error');
            }
        });
    },

    refreshTermOptions() {
        const ayId    = document.getElementById('wk-ay')?.value;
        const termSel = document.getElementById('wk-term');
        if (!termSel) return;
        const ay = (state.academicYears || []).find(y => y.id === ayId);
        termSel.innerHTML = '<option value="">— Select Term —</option>' +
            (ay?.terms || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    },

    // ── Bills ─────────────────────────────────────────────────────────────────────
    async saveBill() {
        const name     = document.getElementById('bl-name')?.value?.trim();
        const amount   = parseFloat(document.getElementById('bl-amount')?.value);
        const termId   = document.getElementById('bl-term')?.value || null;
        const dueDate  = document.getElementById('bl-due')?.value || null;
        const appliesTo= document.getElementById('bl-applies')?.value || 'all';
        const target   = document.getElementById('bl-target')?.value || null;

        const activeYear = (state.academicYears || []).find(y => y.active);

        if (!name)                  return modal.alert('Validation', 'Please enter a bill name.', 'warning');
        if (!amount || amount <= 0) return modal.alert('Validation', 'Please enter a valid amount.', 'warning');

        const bill = {
            bill_name:        name,
            bill_category:    'General',
            amount,
            term_id:          termId,
            academic_year_id: activeYear?.id || null,
            due_date:         dueDate,
            applies_to:       appliesTo,
            target_value:     appliesTo !== 'all' ? target : null,
            status:           'active',
        };

        try {
            app.showLoading('Publishing bill...');
            const saved = await featureDB.saveBill(bill);

            // Auto-assign to students
            const targetStudentIds = billingCalc.resolveBillTargets({ ...bill, id: saved.id });
            await featureDB.assignBillToStudents(saved.id, targetStudentIds);

            app.hideLoading();
            ui.showToast(`Bill published and assigned to ${targetStudentIds.length} student(s).`, 'success');
            featureViews.renderBilling();
        } catch (err) {
            app.hideLoading();
            modal.alert('Error', err.message || String(err), 'error');
        }
    },

    viewBillStudents(billId) {
        const bill   = featureState.bills.find(b => b.id === billId);
        if (!bill) return;

        const assignments = featureState.billAssignments.filter(a => a.bill_id === billId);
        const students    = assignments.map(a => state.students.find(s => s.id === a.student_id)).filter(Boolean);

        const activeYear = (state.academicYears || []).find(y => y.active);
        const getTermName = (tid) => (activeYear?.terms || []).find(t => t.id === tid)?.name || '—';

        const rows = students.map(s => {
            const fin = billingCalc.getStudentFinancials(s.id, bill.academic_year_id, bill.term_id);
            const statusColor = fin.paymentStatus === 'FULLY PAID'
                ? '#059669' : fin.paymentStatus === 'PARTIAL PAYMENT' ? '#d97706' : '#dc2626';
            return `
                <tr style="border-bottom:1px solid #1e293b;">
                    <td style="padding:10px 14px;color:#f8fafc;font-weight:600;">${s.name}</td>
                    <td style="padding:10px 14px;color:#94a3b8;">${s.class || '—'}</td>
                    <td style="padding:10px 14px;color:#94a3b8;text-align:right;">₵${fin.totalPaid.toLocaleString('en-GH',{minimumFractionDigits:2})}</td>
                    <td style="padding:10px 14px;color:${statusColor};font-weight:700;font-size:11px;text-align:center;">${fin.paymentStatus}</td>
                </tr>`;
        }).join('');

        const modalId = 'bill-students-' + Date.now();
        document.body.insertAdjacentHTML('beforeend', `
            <div id="${modalId}" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;opacity:0;transition:opacity .25s;">
                <div style="background:#0f172a;border-radius:20px;max-width:620px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.5);transform:translateY(16px);transition:transform .25s;">
                    <div style="background:linear-gradient(135deg,#1a56db,#0891b2);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;">
                        <div>
                            <h3 style="color:#fff;font-size:17px;font-weight:700;margin:0;">${bill.bill_name}</h3>
                            <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:2px 0 0;">${bill.bill_category} • ₵${parseFloat(bill.amount).toLocaleString('en-GH',{minimumFractionDigits:2})} • ${students.length} students</p>
                        </div>
                        <button onclick="document.getElementById('${modalId}').remove()" style="background:rgba(255,255,255,0.15);border:none;border-radius:8px;color:#fff;width:32px;height:32px;cursor:pointer;font-size:16px;">✕</button>
                    </div>
                    <div style="overflow-y:auto;flex:1;">
                        ${students.length === 0
                            ? '<p style="color:#64748b;text-align:center;padding:32px;">No students assigned.</p>'
                            : `<table style="width:100%;border-collapse:collapse;">
                                   <thead style="position:sticky;top:0;background:#1e293b;">
                                       <tr>
                                           <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Student</th>
                                           <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Class</th>
                                           <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Paid</th>
                                           <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;">Status</th>
                                       </tr>
                                   </thead>
                                   <tbody>${rows}</tbody>
                               </table>`
                        }
                    </div>
                    <div style="padding:16px;border-top:1px solid #1e293b;text-align:right;">
                        <button onclick="document.getElementById('${modalId}').remove()" style="padding:9px 24px;background:#334155;border:none;border-radius:10px;color:#f8fafc;font-weight:700;cursor:pointer;">Close</button>
                    </div>
                </div>
            </div>
        `);
        const el = document.getElementById(modalId);
        const inner = el.querySelector('div');
        requestAnimationFrame(() => { el.style.opacity = '1'; inner.style.transform = 'translateY(0)'; });
    },

    async archiveBill(id, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'archived' : 'active';
        try {
            app.showLoading('Updating bill...');
            await featureDB.saveBill({ id, status: newStatus });
            app.hideLoading();
            ui.showToast(`Bill ${newStatus === 'active' ? 'restored' : 'archived'}.`, 'success');
            featureViews.renderBilling();
        } catch (err) {
            app.hideLoading();
            modal.alert('Error', err.message || String(err), 'error');
        }
    },

    deleteBill(id, name) {
        modal.confirmDelete(name, async () => {
            try {
                app.showLoading('Deleting...');
                await featureDB.deleteBill(id);
                app.hideLoading();
                ui.showToast('Bill deleted.', 'success');
                featureViews.renderBilling();
            } catch (err) {
                app.hideLoading();
                modal.alert('Error', err.message || String(err), 'error');
            }
        });
    },

    // ── Navigation helper ────────────────────────────────────────────────────────
    navigateToRoute(route) {
        ui.route(route);
    },

    // ── Financial Report Export (Protected) ──────────────────────────────────────
    exportFinancialReport() {
        financialSecurity.requireAccess(() => {
            const yearId = document.getElementById('fan-year')?.value;
            const mode   = document.getElementById('fan-mode')?.value || 'term';
            const termId = document.getElementById('fan-term')?.value;

            if (!yearId) return modal.alert('Select Year', 'Please select an academic year first.', 'warning');

            // Delegate to financial-report.js generator if available
            if (typeof financialReportGenerator !== 'undefined' && financialReportGenerator._generate) {
                financialReportGenerator._generate(mode, yearId, termId);
            } else {
                modal.alert('Export', 'Financial Report Generator is ready. Configure financial-report.js to enable DOCX export.', 'info');
            }
        });
    },
};

// ==================================================================================
// SECTION 6 — PATCH EXISTING SYSTEMS
// ==================================================================================

// 6A. Patch ui.route() to handle new views
(function patchRoute() {
    const origRoute = ui.route.bind(ui);
    ui.route = function(view) {
        switch(view) {
            case 'weeks':
                state.currentView = view;
                document.getElementById('view-content').innerHTML =
                    '<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div style="width:36px;height:36px;border:3px solid #1a56db;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div></div>';
                window.scrollTo(0, 0);
                document.querySelectorAll('.sidebar-item').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.getAttribute('onclick')?.includes(`'${view}'`)) btn.classList.add('active');
                });
                setTimeout(() => featureViews.renderWeeks(), 80);
                break;

            case 'billing':
                state.currentView = view;
                document.getElementById('view-content').innerHTML =
                    '<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div style="width:36px;height:36px;border:3px solid #1a56db;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div></div>';
                window.scrollTo(0, 0);
                document.querySelectorAll('.sidebar-item').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.getAttribute('onclick')?.includes(`'${view}'`)) btn.classList.add('active');
                });
                setTimeout(() => featureViews.renderBilling(), 80);
                break;

            case 'financial_analytics':
                // Financial Analytics section removed — redirect to data_analysis
                origRoute('data_analysis');
                break;

            case 'finance':
                // Override base finance view to include billing summary
                state.currentView = view;
                document.getElementById('view-content').innerHTML =
                    '<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div style="width:36px;height:36px;border:3px solid #1a56db;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div></div>';
                window.scrollTo(0, 0);
                document.querySelectorAll('.sidebar-item').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.getAttribute('onclick')?.includes(`'${view}'`)) btn.classList.add('active');
                });
                setTimeout(async () => {
                    await featureDB.loadBills().catch(() => {});
                    await featureDB.loadBillAssignments().catch(() => {});
                    featureViews.renderFinanceExtended();
                }, 80);
                break;

            default:
                origRoute(view);
        }
    };
})();

// 6B. Sidebar items for weeks/billing/financial_analytics are now native in app.js adminItems array.

// 6C. Revoke financial access on logout (patch auth.logout)
(function patchLogout() {
    const origLogout = typeof auth !== 'undefined' ? auth.logout?.bind(auth) : null;
    if (!origLogout) return;
    auth.logout = async function() {
        financialSecurity.revokeAccess();
        await origLogout();
    };
})();

// 6D. Persist bills + assignments to localStorage before report.html opens.
//     report.html runs in a separate tab where features.js is NOT loaded, so
//     supabaseClient is unavailable there. buildReportUpcomingBills() reads
//     these localStorage keys as a fallback so bills always appear in reports.
(function patchReportOpeners() {
    // Helper: write current bills + assignments snapshot to localStorage
    function cacheBillsForReport() {
        try {
            localStorage.setItem('rv_bills_cache',
                JSON.stringify(featureState.bills || []));
            localStorage.setItem('rv_bill_assignments_cache',
                JSON.stringify(featureState.billAssignments || []));
        } catch (e) {
            console.warn('[patchReportOpeners] Could not cache bills:', e);
        }
    }

    // Patch actions.downloadBulkReports (used by admin bulk-download button)
    const waitForActions = () => {
        if (typeof actions === 'undefined' || typeof actions.downloadBulkReports !== 'function') {
            setTimeout(waitForActions, 300);
            return;
        }
        const origBulk = actions.downloadBulkReports.bind(actions);
        actions.downloadBulkReports = function(className, term) {
            cacheBillsForReport();
            origBulk(className, term);
        };

        // Patch actions.openReportGenerator (used by the teacher "Create Reports" button)
        if (typeof actions.openReportGenerator === 'function') {
            const origOpen = actions.openReportGenerator.bind(actions);
            actions.openReportGenerator = function(...args) {
                cacheBillsForReport();
                origOpen(...args);
            };
        }
    };
    setTimeout(waitForActions, 600);
})();

// ==================================================================================
// SECTION 7 — UPCOMING BILLS IN TERMINAL REPORTS (report.js integration)
// ==================================================================================
//
// Bills are a forward-looking list of financial obligations due next term — NOT
// a payment ledger. Payment tracking (who paid, who owes, outstanding balances)
// is handled exclusively by the Fee Structure in the Financial section.
//
// This function appends a "Bills for Next Term" table to the student's report
// card showing each bill's name, category, amount, and due date only.
//
// CALLING FROM report.js (add before JSZip assembly):
//   const billsXml = await buildReportUpcomingBills(studentId, ayId, termId);
//   if (billsXml) bodyXml += billsXml;
//
// ==================================================================================

async function buildReportUpcomingBills(studentId, ayId, termId) {
    try {
        const sc = (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

        let assignments, bills;

        if (sc) {
            // ── Live path: running inside the main app tab ──────────────────────
            const { data: aData, error: aErr } = await sc
                .from('bill_assignments')
                .select('bill_id')
                .eq('student_id', studentId);
            if (aErr || !aData || aData.length === 0) return '';
            assignments = aData;

            const billIds = assignments.map(a => a.bill_id);
            const { data: bData, error: bErr } = await sc
                .from('bills')
                .select('*')
                .eq('status', 'active')
                .in('id', billIds);
            if (bErr || !bData || bData.length === 0) return '';
            bills = bData;

        } else {
            // ── Cache path: running inside report.html (separate tab, no supabase) ─
            // Data was serialised into localStorage by patchReportOpeners() below.
            let cachedBills = [], cachedAssignments = [];
            try {
                cachedBills       = JSON.parse(localStorage.getItem('rv_bills_cache')       || '[]');
                cachedAssignments = JSON.parse(localStorage.getItem('rv_bill_assignments_cache') || '[]');
            } catch (_) {}

            if (!cachedBills.length || !cachedAssignments.length) return '';

            const assignedBillIds = cachedAssignments
                .filter(a => a.student_id === studentId)
                .map(a => a.bill_id);
            if (!assignedBillIds.length) return '';

            assignments = cachedAssignments.filter(a => a.student_id === studentId);
            bills = cachedBills.filter(b =>
                b.status === 'active' && assignedBillIds.includes(b.id)
            );
            if (!bills.length) return '';
        }

        // Filter by AY / term when provided
        const myBills = bills.filter(b => {
            if (ayId   && b.academic_year_id && b.academic_year_id !== ayId)   return false;
            if (termId && b.term_id          && b.term_id          !== termId) return false;
            return true;
        });

        if (myBills.length === 0) return '';

        const fmtCur  = (v) => `GH\u20B5 ${parseFloat(v || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }) : 'TBA';
        const esc     = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        const bodyW = 9360;
        const cW    = [3600, 1800, 1980, 1980];

        const tcPr = (w) =>
            `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
            `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="e2e8f0"/>` +
            `<w:left w:val="none"/><w:right w:val="none"/>` +
            `<w:bottom w:val="single" w:sz="4" w:color="e2e8f0"/></w:tcBorders>` +
            `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>` +
            `<w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;

        const cell = (text, w, { bold=false, color='0f172a', align='left', size=18 }={}) =>
            `<w:tc>${tcPr(w)}<w:p><w:pPr><w:jc w:val="${align}"/></w:pPr>` +
            `<w:r><w:rPr>${bold?'<w:b/><w:bCs/>':''}<w:color w:val="${color}"/>` +
            `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
            `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;

        const headerRow =
            `<w:tr><w:trPr><w:trHeight w:val="400"/>` +
            `<w:shd w:val="clear" w:color="auto" w:fill="1a56db"/></w:trPr>` +
            cell('Description',  cW[0], {bold:true,color:'FFFFFF',size:18}) +
            cell('Category',     cW[1], {bold:true,color:'FFFFFF',size:18}) +
            cell('Amount (GH₵)', cW[2], {bold:true,color:'FFFFFF',align:'right',size:18}) +
            cell('Due Date',     cW[3], {bold:true,color:'FFFFFF',align:'center',size:18}) +
            `</w:tr>`;

        const dataRows = myBills.map((b, i) => {
            const shade = i % 2 === 0 ? 'f8fafc' : 'ffffff';
            return `<w:tr><w:trPr><w:shd w:val="clear" w:color="auto" w:fill="${shade}"/></w:trPr>` +
                cell(b.bill_name || b.name || 'Unnamed Bill', cW[0], {size:18}) +
                cell(b.bill_category || b.category || '—',   cW[1], {color:'64748b',size:18}) +
                cell(fmtCur(b.amount),                        cW[2], {align:'right',size:18}) +
                cell(fmtDate(b.due_date),                     cW[3], {align:'center',color:'64748b',size:18}) +
                `</w:tr>`;
        }).join('');

        const grandTotal = myBills.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
        const totalRow =
            `<w:tr><w:trPr><w:shd w:val="clear" w:color="auto" w:fill="eff6ff"/></w:trPr>` +
            cell('Total Obligations', cW[0], {bold:true,color:'1a56db',size:18}) +
            cell('',                  cW[1]) +
            cell(fmtCur(grandTotal),  cW[2], {bold:true,color:'1a56db',align:'right',size:18}) +
            cell('',                  cW[3]) +
            `</w:tr>`;

        let xml = `<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr></w:p>`;

        // Section heading
        xml +=
            `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="120" w:after="80"/>` +
            `<w:pBdr><w:top w:val="single" w:sz="12" w:space="1" w:color="1a56db"/>` +
            `<w:bottom w:val="single" w:sz="4" w:space="1" w:color="e2e8f0"/></w:pBdr></w:pPr>` +
            `<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="1a56db"/>` +
            `<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
            `<w:t>BILLS FOR NEXT TERM</w:t></w:r></w:p>`;

        // Subtitle
        xml +=
            `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr>` +
            `<w:r><w:rPr><w:i/><w:iCs/><w:color w:val="64748b"/>` +
            `<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
            `<w:t>The following payments will be due at the commencement of next term. ` +
            `Payment history and outstanding balances are managed through the school\u2019s fee portal.</w:t></w:r></w:p>`;

        // Table
        xml +=
            `<w:tbl><w:tblPr><w:tblW w:w="${bodyW}" w:type="dxa"/>` +
            `<w:tblBorders>` +
            `<w:top    w:val="single" w:sz="6" w:color="1a56db"/>` +
            `<w:bottom w:val="single" w:sz="6" w:color="1a56db"/>` +
            `<w:insideH w:val="single" w:sz="4" w:color="e2e8f0"/>` +
            `<w:insideV w:val="none"/></w:tblBorders></w:tblPr>` +
            `<w:tblGrid>${cW.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
            headerRow + dataRows + totalRow +
            `</w:tbl>`;

        return xml;

    } catch (err) {
        console.warn('[buildReportUpcomingBills] Non-critical error:', err);
        return '';
    }
}

// Backward-compatible alias — any existing call to buildReportFinancialSummary
// now correctly renders the bills list instead of the wrong payment calculator.
async function buildReportFinancialSummary(studentId, ayId, termId) {
    return buildReportUpcomingBills(studentId, ayId, termId);
}

// Expose on window so report.html (opened in a new tab) can call these directly.
window.buildReportUpcomingBills    = buildReportUpcomingBills;
window.buildReportFinancialSummary = buildReportFinancialSummary;

// ==================================================================================
// SECTION 8 — BOOTSTRAP: Load feature data on app init
// ==================================================================================
(function bootstrapFeatures() {
    // Wait until supabaseClient and state exist (script tags have executed).
    const tryInit = () => {
        if (typeof supabaseClient === 'undefined' || typeof state === 'undefined') {
            setTimeout(tryInit, 300);
            return;
        }

        // Load bills silently — these don't depend on login state.
        featureDB.loadBills().catch(() => {});
        featureDB.loadBillAssignments().catch(() => {});

        // NOTE: featureDB.loadWeeks() is intentionally NOT called here.
        // At this point no user is logged in yet, so state.currentAY and
        // state.currentTerm are null. _autoActivateCurrentWeek() would exit
        // immediately and the week pill would never appear for teachers/parents.
        //
        // Instead, loadWeeks() is called at the end of app.loadInitialData()
        // (in app.js) — after the Promise.all — so AY/term are always set first.

        // Realtime subscription: any change to the weeks table immediately
        // refreshes the week pill for every logged-in user without a page reload.
        try {
            supabaseClient
                .channel('public:weeks-live')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'weeks' }, async () => {
                    await featureDB.loadWeeks().catch(() => {});
                })
                .subscribe();
        } catch (e) {
            console.warn('[features] weeks realtime subscription failed:', e);
        }

        // Periodic refresh every 30 minutes — handles sessions that span a
        // week boundary without the teacher/parent reloading the page.
        setInterval(() => {
            featureDB.loadWeeks().catch(() => {});
        }, 30 * 60 * 1000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 500));
    } else {
        setTimeout(tryInit, 500);
    }
})();