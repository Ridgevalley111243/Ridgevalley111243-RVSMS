// =============================================================================
// Staff phone numbers (teachers, accountant, admin)
//
// The school will text staff as well as parents, so every staff member must
// give the phone number they use every day:
//   • Sign-in: staff without a valid number see a full screen asking for it
//     (after the Terms screen, before the dashboard). The portal opens only
//     once a number is saved; the only other choice is to sign out.
//   • Menu → My Phone Number: see or change the number at any time.
// The number is saved on the person's own profile (profiles.phone) in the same
// 0XXXXXXXXX form parents use. Each person can change only their own number.
// =============================================================================
(function () {
    'use strict';
    if (typeof app === 'undefined' || typeof ui === 'undefined' || typeof ghanaPhone === 'undefined') return;

    const STAFF = ['admin', 'teacher', 'accountant'];
    const GATE_ID = 'staff-phone-gate';
    const MODAL_ID = 'staff-phone-modal';
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const errText = e => (typeof extractErrorMessage === 'function' ? extractErrorMessage(e) : (e?.message || String(e)));
    const pretty = n => String(n || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
    const isStaff = role => STAFF.includes(role);

    // ── Shared pieces of the gate screen and the menu dialog ────────────────
    const inputClass = 'input-field w-full rounded-xl px-4 py-3 font-mono text-base border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white';
    const fieldHtml = (id, value) => `
        <label for="${id}-input" class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mt-5 mb-1">Active phone number</label>
        <input id="${id}-input" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" value="${esc(value)}" placeholder="024 123 4567"
            aria-describedby="${id}-hint ${id}-error" class="${inputClass}">
        <p id="${id}-hint" class="text-xs text-slate-500 dark:text-slate-400 mt-1">A Ghana mobile number, e.g. 024 123 4567. Only you and the school office can see it.</p>
        <p id="${id}-error" class="hidden text-sm text-red-600 dark:text-red-400 mt-2" role="alert"></p>`;
    const saveButtonHtml = (id, extra = '') =>
        `<button type="submit" id="${id}-save" class="px-4 py-3 rounded-xl font-semibold bg-ridge-600 hover:bg-ridge-700 text-white btn-primary disabled:opacity-60 ${extra}"><i class="fas fa-save mr-2"></i>Save number</button>`;

    // Keep Tab inside a dialog
    function trapTab(el) {
        el.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            const items = [...el.querySelectorAll('input, button, a[href]')].filter(n => !n.disabled && n.getClientRects().length);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    }

    // Wires the number box and form; onSaved(phone, changed) runs after a successful save
    function bindForm(el, id, profileId, current, onSaved) {
        const input = el.querySelector(`#${id}-input`);
        const err = el.querySelector(`#${id}-error`);
        const save = el.querySelector(`#${id}-save`);
        const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); input.setAttribute('aria-invalid', 'true'); input.focus(); };
        input.addEventListener('input', () => { err.textContent = ''; err.classList.add('hidden'); input.removeAttribute('aria-invalid'); });
        el.querySelector(`#${id}-form`).addEventListener('submit', async e => {
            e.preventDefault();
            if (save.disabled) return;
            const check = ghanaPhone.validate(input.value.trim());
            if (!check.valid) return fail(check.error);
            if (check.normalised === current) return onSaved(current, false);
            save.disabled = true;
            try {
                const { data, error } = await supabaseClient.from('profiles')
                    .update({ phone: check.normalised })
                    .eq('id', profileId)
                    .select('id, phone');
                if (error) throw error;
                if (!data || !data.length) throw new Error('Your number was not saved. Please sign out, sign in again and retry.');
                onSaved(data[0].phone, true);
            } catch (e2) {
                save.disabled = false;
                fail(errText(e2));
            }
        });
        return input;
    }

    // ── Sign-in gate ─────────────────────────────────────────────────────────
    // Called by app.loadUserData after the Terms screen. Resolves true once a
    // valid number is on the profile, false if the person chooses to sign out.
    let gate = null;   // { id, promise } while the screen is showing
    function ensure(profile) {
        if (!profile || !isStaff(profile.role) || ghanaPhone.validate(profile.phone || '').valid) return Promise.resolve(true);
        // Signing in again while the screen is up (e.g. a session refresh) reuses
        // it; every waiting sign-in gets the saved number on its own profile copy
        const settle = r => { if (r.ok) profile.phone = r.phone; return r.ok; };
        if (gate && gate.id === profile.id && document.getElementById(GATE_ID)) return gate.promise.then(settle);
        app.hideLoading?.();
        const promise = new Promise(resolve => {
            document.getElementById(GATE_ID)?.remove();
            // First name for the greeting, skipping a title ("Mrs. Gifty Owusu" → Gifty)
            const TITLE = /^(mr|mrs|ms|miss|mdm|madam|dr|rev|prof|sir|hon|pastor|fr|sr)\.?$/i;
            const first = String(profile.full_name || '').trim().split(/\s+/).find(w => w && !TITLE.test(w)) || '';
            const el = document.createElement('div');
            el.id = GATE_ID;
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-labelledby', `${GATE_ID}-title`);
            el.setAttribute('aria-describedby', `${GATE_ID}-desc`);
            el.className = 'fixed inset-0 z-[10001] bg-slate-50 dark:bg-[#0a0a0a] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto';
            el.innerHTML = `
                <form id="${GATE_ID}-form" novalidate class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-xl p-6 sm:p-8">
                    <img src="1.png" alt="" width="48" height="48" class="w-12 h-12 object-contain mb-4">
                    <h1 id="${GATE_ID}-title" class="text-xl font-bold text-slate-800 dark:text-white">${first ? `${esc(first)}, add` : 'Add'} your phone number</h1>
                    <p id="${GATE_ID}-desc" class="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">The school will send staff important messages by SMS. Enter the number you use every day to continue to the portal.</p>
                    ${fieldHtml(GATE_ID, profile.phone || '')}
                    ${saveButtonHtml(GATE_ID, 'w-full mt-6')}
                    <button type="button" id="${GATE_ID}-signout" class="w-full mt-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5">Sign out</button>
                </form>`;
            document.body.appendChild(el);
            trapTab(el);
            const done = (ok, phone = null) => { el.remove(); gate = null; resolve({ ok, phone }); };
            const input = bindForm(el, GATE_ID, profile.id, null, phone => {
                if (state.currentUser?.id === profile.id) state.currentUser.phone = phone;
                app.showPageSkeleton?.('app');
                done(true, phone);
                setTimeout(() => ui.showToast(`Phone number saved: ${pretty(phone)}`, 'success'), 0);
            });
            el.querySelector(`#${GATE_ID}-signout`).addEventListener('click', () => done(false));
            input.focus();
        });
        gate = { id: profile.id, promise };
        return promise.then(settle);
    }

    // ── Menu → My Phone Number ───────────────────────────────────────────────
    function open() {
        if (!state.currentUser || !isStaff(state.role)) return;
        document.getElementById(MODAL_ID)?.remove();
        const current = state.currentUser.phone || '';
        const el = document.createElement('div');
        el.id = MODAL_ID;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', `${MODAL_ID}-title`);
        el.setAttribute('aria-describedby', `${MODAL_ID}-desc`);
        el.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto';
        el.innerHTML = `
            <form id="${MODAL_ID}-form" novalidate class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl p-6">
                <h2 id="${MODAL_ID}-title" class="text-lg font-bold text-slate-800 dark:text-white">${current ? 'Your phone number' : 'Add your phone number'}</h2>
                <p id="${MODAL_ID}-desc" class="text-sm text-slate-600 dark:text-slate-300 mt-1">The school uses this number to send you important messages by SMS.</p>
                ${fieldHtml(MODAL_ID, current)}
                <div class="flex justify-end gap-2 mt-6">
                    <button type="button" id="${MODAL_ID}-cancel" class="px-4 py-3 rounded-xl font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-neutral-700">Cancel</button>
                    ${saveButtonHtml(MODAL_ID)}
                </div>
            </form>`;
        document.body.appendChild(el);
        trapTab(el);
        const returnTo = document.activeElement;
        const close = () => { el.remove(); if (returnTo?.isConnected) returnTo.focus?.(); };
        el.addEventListener('click', e => { if (e.target === el) close(); });
        el.querySelector(`#${MODAL_ID}-cancel`).addEventListener('click', close);
        const input = bindForm(el, MODAL_ID, state.currentUser.id, current, (phone, changed) => {
            state.currentUser.phone = phone;
            close();
            ui.showToast(changed ? `Phone number saved: ${pretty(phone)}` : 'Phone number unchanged', changed ? 'success' : 'info');
        });
        input.focus();
        if (current) input.select();
    }

    // ── Menu item (staff only) ───────────────────────────────────────────────
    const _updateSidebar = ui.updateSidebar.bind(ui);
    ui.updateSidebar = function () {
        const r = _updateSidebar.apply(this, arguments);
        const nav = document.getElementById('sidebar-nav');
        const logout = nav?.querySelector('.rv-logout');
        if (!nav || !logout || !isStaff(state.role) || nav.querySelector('#staff-phone-menu-btn')) return r;
        const btn = document.createElement('button');
        btn.id = 'staff-phone-menu-btn';
        btn.className = 'sidebar-item';
        btn.setAttribute('onclick', "rvStaffPhone.open(); if(window.innerWidth<=768){ui.closeSidebar();}");
        btn.style.cssText = 'touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,255,255,0.1);';
        btn.innerHTML = '<i class="fas fa-mobile-screen-button"></i><span>My Phone Number</span>';
        // Above Passkeys if shown, otherwise above the Terms · Privacy line over Sign Out
        const passkeysBtn = nav.querySelector('#passkeys-menu-btn');
        const anchor = passkeysBtn || (logout.previousElementSibling?.tagName === 'P' ? logout.previousElementSibling : logout);
        anchor.insertAdjacentElement('beforebegin', btn);
        return r;
    };

    window.rvStaffPhone = { ensure, open };
})();
