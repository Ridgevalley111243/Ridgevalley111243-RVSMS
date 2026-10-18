// =============================================================================
// Staff phone numbers (teachers, accountant, admin)
//
// The school will text staff as well as parents, so every staff member is
// asked for the phone number they use every day:
//   • After signing in, staff without a valid number get a popup. "Later"
//     puts it off for a day on that device; it comes back until a number is saved.
//   • Menu → My Phone Number: see or change the number at any time.
// The number is saved on the person's own profile (profiles.phone) in the same
// 0XXXXXXXXX form parents use. Each person can change only their own number.
// =============================================================================
(function () {
    'use strict';
    if (typeof app === 'undefined' || typeof ui === 'undefined' || typeof ghanaPhone === 'undefined') return;

    const STAFF = ['admin', 'teacher', 'accountant'];
    const SNOOZE_MS = 24 * 60 * 60 * 1000;
    const MODAL_ID = 'staff-phone-modal';
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const errText = e => (typeof extractErrorMessage === 'function' ? extractErrorMessage(e) : (e?.message || String(e)));

    const isStaff = () => STAFF.includes(state.role);
    const hasValidPhone = () => ghanaPhone.validate(state.currentUser?.phone || '').valid;
    const pretty = n => String(n || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');

    // ── "Later" remembers the choice for a day, per person, on this device ──
    const snoozeKey = () => `rv-phone-later:${state.currentUser?.id || ''}`;
    function snoozed() {
        try { return Date.now() - Number(localStorage.getItem(snoozeKey()) || 0) < SNOOZE_MS; }
        catch (_) { return false; }
    }
    function snooze() { try { localStorage.setItem(snoozeKey(), String(Date.now())); } catch (_) { /* private mode */ } }
    function clearSnooze() { try { localStorage.removeItem(snoozeKey()); } catch (_) { /* private mode */ } }

    // ── The dialog (also used from the menu) ────────────────────────────────
    function open(mode = 'menu') {
        if (!isStaff() || !state.currentUser) return;
        document.getElementById(MODAL_ID)?.remove();
        const current = state.currentUser.phone || '';
        const prompt = mode === 'prompt';
        const el = document.createElement('div');
        el.id = MODAL_ID;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', `${MODAL_ID}-title`);
        el.setAttribute('aria-describedby', `${MODAL_ID}-desc`);
        el.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto';
        el.innerHTML = `
            <form id="${MODAL_ID}-form" novalidate class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl p-6">
                <div class="flex items-start gap-3">
                    <div class="shrink-0 w-11 h-11 rounded-xl bg-ridge-50 dark:bg-white/5 text-ridge-700 dark:text-ridge-400 flex items-center justify-center" aria-hidden="true">
                        <i class="fas fa-mobile-screen-button text-lg"></i>
                    </div>
                    <div class="min-w-0">
                        <h2 id="${MODAL_ID}-title" class="text-lg font-bold text-slate-800 dark:text-white">${prompt || !current ? 'Add your phone number' : 'Your phone number'}</h2>
                        <p id="${MODAL_ID}-desc" class="text-sm text-slate-600 dark:text-slate-300 mt-1">The school will soon send staff important messages by SMS. Enter the number you use every day so they reach you.</p>
                    </div>
                </div>
                <label for="${MODAL_ID}-input" class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mt-5 mb-1">Active phone number</label>
                <input id="${MODAL_ID}-input" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" value="${esc(current)}" placeholder="024 123 4567"
                    aria-describedby="${MODAL_ID}-hint ${MODAL_ID}-error"
                    class="input-field w-full rounded-xl px-4 py-3 font-mono text-base border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white">
                <p id="${MODAL_ID}-hint" class="text-xs text-slate-500 dark:text-slate-400 mt-1">A Ghana mobile number, e.g. 024 123 4567. Only you and the school office can see it.</p>
                <p id="${MODAL_ID}-error" class="hidden text-sm text-red-600 mt-2" role="alert"></p>
                <div class="flex justify-end gap-2 mt-6">
                    <button type="button" id="${MODAL_ID}-cancel" class="px-4 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-neutral-700">${prompt ? 'Later' : 'Cancel'}</button>
                    <button type="submit" id="${MODAL_ID}-save" class="px-4 py-2.5 rounded-xl font-semibold bg-ridge-600 hover:bg-ridge-700 text-white btn-primary"><i class="fas fa-save mr-2"></i>Save number</button>
                </div>
            </form>`;
        document.body.appendChild(el);

        const input = el.querySelector(`#${MODAL_ID}-input`);
        const err = el.querySelector(`#${MODAL_ID}-error`);
        const save = el.querySelector(`#${MODAL_ID}-save`);
        const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); input.setAttribute('aria-invalid', 'true'); input.focus(); };
        const close = () => el.remove();
        const later = () => { if (prompt) snooze(); close(); };

        el.addEventListener('click', e => { if (e.target === el) later(); });
        el.querySelector(`#${MODAL_ID}-cancel`).addEventListener('click', later);
        input.addEventListener('input', () => { err.classList.add('hidden'); input.removeAttribute('aria-invalid'); });

        el.querySelector(`#${MODAL_ID}-form`).addEventListener('submit', async e => {
            e.preventDefault();
            const check = ghanaPhone.validate(input.value.trim());
            if (!check.valid) return fail(check.error);
            if (check.normalised === current) { close(); ui.showToast('Phone number unchanged', 'info'); return; }
            save.disabled = true;
            try {
                const { data, error } = await supabaseClient.from('profiles')
                    .update({ phone: check.normalised })
                    .eq('id', state.currentUser.id)
                    .select('id, phone');
                if (error) throw error;
                if (!data || !data.length) throw new Error('Your number was not saved. Please sign out, sign in again and retry.');
                state.currentUser.phone = data[0].phone;
                clearSnooze();
                close();
                ui.showToast(`Phone number saved: ${pretty(data[0].phone)}`, 'success');
            } catch (e2) {
                save.disabled = false;
                fail(errText(e2));
            }
        });
        input.focus();
        if (current) input.select();
    }

    // ── Ask after sign-in, once the other sign-in popups are out of the way ─
    // The notifications prompt appears shortly after sign-in, and the Terms
    // gate before it; wait until no dialog is showing, then ask.
    // (offsetParent can't be used: it is always null for fixed-position overlays)
    const showing = n => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    function otherDialogOpen() {
        return [...document.querySelectorAll('[role="dialog"], [id^="notif-permission-modal-"], [id^="custom-modal-"], #loading-overlay')]
            .some(n => n.id !== MODAL_ID && !n.closest('#' + MODAL_ID) && showing(n));
    }

    let pending = null;
    function scheduleAsk() {
        clearTimeout(pending);
        let waited = 0;
        const tick = () => {
            pending = null;
            if (!isStaff() || !state.currentUser || hasValidPhone() || snoozed()) return;
            if (document.getElementById(MODAL_ID)) return;
            if (otherDialogOpen() && waited < 120000) { waited += 1000; pending = setTimeout(tick, 1000); return; }
            open('prompt');
        };
        // Give the notifications prompt (shown ~0.8s after sign-in) time to appear first
        pending = setTimeout(tick, 2500);
    }

    const _loadUserData = app.loadUserData.bind(app);
    app.loadUserData = async function () {
        const r = await _loadUserData.apply(this, arguments);
        if (state.currentUser && isStaff()) scheduleAsk();
        return r;
    };

    // Signing out cancels a pending ask
    if (typeof auth !== 'undefined' && typeof auth.logout === 'function') {
        const _logout = auth.logout.bind(auth);
        auth.logout = function () {
            clearTimeout(pending);
            pending = null;
            document.getElementById(MODAL_ID)?.remove();
            return _logout.apply(this, arguments);
        };
    }

    // ── Menu → My Phone Number (staff only) ─────────────────────────────────
    const _updateSidebar = ui.updateSidebar.bind(ui);
    ui.updateSidebar = function () {
        const r = _updateSidebar.apply(this, arguments);
        const nav = document.getElementById('sidebar-nav');
        const logout = nav?.querySelector('.rv-logout');
        if (!nav || !logout || !isStaff() || nav.querySelector('#staff-phone-menu-btn')) return r;
        const btn = document.createElement('button');
        btn.id = 'staff-phone-menu-btn';
        btn.className = 'sidebar-item';
        btn.setAttribute('onclick', "rvStaffPhone.open('menu'); if(window.innerWidth<=768){ui.closeSidebar();}");
        btn.style.cssText = 'touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,255,255,0.1);';
        btn.innerHTML = '<i class="fas fa-mobile-screen-button"></i><span>My Phone Number</span>';
        // Above Passkeys if shown, otherwise above the Terms · Privacy line over Sign Out
        const passkeysBtn = nav.querySelector('#passkeys-menu-btn');
        const anchor = passkeysBtn || (logout.previousElementSibling?.tagName === 'P' ? logout.previousElementSibling : logout);
        anchor.insertAdjacentElement('beforebegin', btn);
        return r;
    };

    window.rvStaffPhone = { open, scheduleAsk };
})();
