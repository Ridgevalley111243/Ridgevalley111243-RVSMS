// =============================================================================
// Passkeys: sign in with Face ID, fingerprint, Windows Hello or a phone/security
// key instead of a password (Supabase Auth, WebAuthn).
//
//   • Sign-in screen: "Sign in with a passkey" button under the password form.
//     Same rule as passwords: accountants sign in only on the accounts-office
//     screen, and that screen lets only accountants in.
//   • Menu → Passkeys: add a passkey for this device, rename or remove one.
//
// Everything stays hidden until passkeys are switched on for the Supabase
// project (Authentication → Passkeys) and the browser supports them, so the
// portal looks and works exactly as before until then.
// =============================================================================
const passkeys = {
    available: false,
    _ready: null,

    // ── Availability ────────────────────────────────────────────────────────
    check() {
        if (this._ready) return this._ready;
        this._ready = (async () => {
            if (!window.PublicKeyCredential || !window.isSecureContext || typeof supabaseClient === 'undefined') return false;
            try {
                const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
                const settings = await res.json();
                return settings?.passkeys_enabled === true;
            } catch (_) { return false; }
        })().then(ok => {
            this.available = ok;
            this.refreshLoginButton();
            if (ok && typeof state !== 'undefined' && state.currentUser) this._injectMenuItem();
            return ok;
        });
        return this._ready;
    },

    // ── Friendly error messages ─────────────────────────────────────────────
    _cancelled(err) {
        const s = `${err?.code || ''} ${err?.name || ''} ${err?.message || ''}`;
        return /CEREMONY_ABORTED|NotAllowedError|AbortError|not allowed|cancel|timed out/i.test(s);
    },
    _message(err) {
        const code = err?.code || err?.error_code || '';
        const map = {
            passkey_disabled: 'Passkeys are not switched on for this portal yet.',
            too_many_passkeys: 'You already have the maximum number of passkeys. Remove one you no longer use, then try again.',
            webauthn_credential_exists: 'This device already has a passkey for your account.',
            webauthn_credential_not_found: 'That passkey is no longer linked to an account here. Sign in with your password, then add a new passkey.',
            webauthn_challenge_expired: 'That took too long. Please try again.',
            webauthn_challenge_not_found: 'That took too long. Please try again.',
            webauthn_verification_failed: 'The passkey could not be verified. Please try again.',
            email_not_confirmed: 'Please confirm your email address before signing in.',
            user_banned: 'This account has been suspended. Contact the school office.',
        };
        return map[code] || (typeof extractErrorMessage === 'function' ? extractErrorMessage(err) : (err?.message || 'Something went wrong.'));
    },

    // ── Sign-in screen ──────────────────────────────────────────────────────
    refreshLoginButton() {
        const submit = document.getElementById('auth-submit-btn');
        if (!submit) return;
        let wrap = document.getElementById('passkey-signin');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'passkey-signin';
            wrap.className = 'hidden space-y-3';
            wrap.innerHTML = `
                <div class="flex items-center gap-3 text-xs text-slate-400" aria-hidden="true">
                    <span class="h-px flex-1 bg-slate-200 dark:bg-slate-700"></span>or<span class="h-px flex-1 bg-slate-200 dark:bg-slate-700"></span>
                </div>
                <button type="button" id="passkey-signin-btn" onclick="passkeys.signIn()"
                    class="w-full py-3.5 rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <i class="fas fa-fingerprint"></i> <span>Sign in with a passkey</span>
                </button>`;
            submit.insertAdjacentElement('afterend', wrap);
        }
        const loginMode = typeof state === 'undefined' || state.authMode !== 'register';
        wrap.classList.toggle('hidden', !(this.available && loginMode));
    },

    async signIn() {
        if (typeof state !== 'undefined' && state.isLoading) return;
        const btn = document.getElementById('passkey-signin-btn');
        if (btn) btn.disabled = true;
        try {
            const { data, error } = await supabaseClient.auth.signInWithPasskey();
            if (error) throw error;
            app.showLoading('Signing you in...');
            // Same rule as password sign-in: accountants only on the accounts-office screen.
            const { data: prof } = await supabaseClient
                .from('profiles').select('role').eq('id', data.user.id).maybeSingle();
            const isAccountant = prof?.role === 'accountant';
            if (isAccountant !== !!state.accountantLogin) {
                await supabaseClient.auth.signOut();
                app.hideLoading();
                modal.alert('Sign-in Failed',
                    state.accountantLogin ? 'This sign-in is for the accounts office only.' : 'This passkey cannot be used on this sign-in screen.',
                    'error');
                return;
            }
            await app.loadUserData(data.user);
        } catch (err) {
            app.hideLoading?.();
            if (this._cancelled(err)) return;
            modal.alert('Passkey Sign-in Failed', escapeHtml(this._message(err)), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    // ── Menu item ───────────────────────────────────────────────────────────
    _injectMenuItem() {
        if (!this.available) return;
        const nav = document.getElementById('sidebar-nav');
        const logout = nav?.querySelector('.rv-logout');
        if (!logout || nav.querySelector('#passkeys-menu-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'passkeys-menu-btn';
        btn.className = 'sidebar-item';
        btn.setAttribute('onclick', "passkeys.openManager(); if(window.innerWidth<=768){ui.closeSidebar();}");
        btn.innerHTML = '<i class="fas fa-fingerprint"></i><span>Passkeys</span>';
        // Above the Terms · Privacy line that sits just over Sign Out
        const anchor = logout.previousElementSibling?.tagName === 'P' ? logout.previousElementSibling : logout;
        anchor.insertAdjacentElement('beforebegin', btn);
    },

    // ── Manage passkeys dialog ──────────────────────────────────────────────
    async openManager() {
        document.getElementById('passkeys-modal')?.remove();
        const el = document.createElement('div');
        el.id = 'passkeys-modal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'passkeys-title');
        el.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4';
        el.innerHTML = `
            <div class="w-full max-w-lg rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl max-h-[90vh] flex flex-col">
                <div class="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
                    <div>
                        <h2 id="passkeys-title" class="text-lg font-bold text-slate-800 dark:text-white">Passkeys</h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in with your fingerprint, face, screen lock or a security key instead of typing your password. Your password still works.</p>
                    </div>
                    <button type="button" id="passkeys-close" aria-label="Close" class="w-9 h-9 shrink-0 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5">×</button>
                </div>
                <div id="passkeys-list" class="px-6 pb-2 overflow-y-auto" aria-live="polite">
                    <div class="space-y-2"><div class="rv-skel rounded-xl" style="height:64px"></div><div class="rv-skel rounded-xl" style="height:64px"></div></div>
                </div>
                <div class="px-6 pt-3 pb-6">
                    <button type="button" id="passkeys-add" class="w-full py-3 bg-ridge-600 text-white rounded-xl font-semibold text-sm btn-primary flex items-center justify-center gap-2">
                        <i class="fas fa-plus"></i> Add a passkey for this device
                    </button>
                </div>
            </div>`;
        el.addEventListener('click', e => { if (e.target === el) el.remove(); });
        document.body.appendChild(el);
        el.querySelector('#passkeys-close').addEventListener('click', () => el.remove());
        el.querySelector('#passkeys-add').addEventListener('click', () => this.add());
        el.querySelector('#passkeys-close').focus();
        await this._renderList();
    },

    _date(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
        catch (_) { return ''; }
    },

    async _renderList() {
        const box = document.getElementById('passkeys-list');
        if (!box) return;
        const { data, error } = await supabaseClient.auth.passkey.list();
        if (!document.getElementById('passkeys-list')) return;
        if (error) {
            box.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400 py-3">${escapeHtml(this._message(error))}</p>`;
            return;
        }
        const list = Array.isArray(data) ? data : (data?.passkeys || []);
        if (!list.length) {
            box.innerHTML = `
                <div class="text-center py-6 px-4 rounded-xl border border-dashed border-slate-300 dark:border-neutral-700">
                    <i class="fas fa-fingerprint text-3xl text-slate-300 dark:text-neutral-600"></i>
                    <p class="text-sm text-slate-600 dark:text-slate-300 mt-3 font-medium">No passkeys yet</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Add one on each phone or computer you use to sign in.</p>
                </div>`;
            return;
        }
        box.innerHTML = `<ul class="space-y-2">${list.map(p => {
            const name = p.friendly_name || 'Passkey';
            const used = p.last_used_at ? `Last used ${this._date(p.last_used_at)}` : 'Not used yet';
            return `
                <li class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-neutral-800" data-id="${escapeHtml(p.id)}">
                    <div class="w-10 h-10 rounded-lg bg-slate-100 dark:bg-neutral-900 flex items-center justify-center text-slate-500 shrink-0"><i class="fas fa-key"></i></div>
                    <div class="min-w-0 flex-1">
                        <p class="pk-name text-sm font-semibold text-slate-800 dark:text-white truncate">${escapeHtml(name)}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">Added ${this._date(p.created_at)} · ${used}</p>
                    </div>
                    <button type="button" class="pk-rename w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Rename ${escapeHtml(name)}" title="Rename"><i class="fas fa-pen text-xs"></i></button>
                    <button type="button" class="pk-delete w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Remove ${escapeHtml(name)}" title="Remove"><i class="fas fa-trash text-xs"></i></button>
                </li>`;
        }).join('')}</ul>`;
        box.querySelectorAll('li[data-id]').forEach(li => {
            const id = li.dataset.id;
            const name = li.querySelector('.pk-name').textContent;
            li.querySelector('.pk-rename').addEventListener('click', () => this._startRename(li, id, name));
            li.querySelector('.pk-delete').addEventListener('click', () => this.remove(id, name));
        });
    },

    async add() {
        const btn = document.getElementById('passkeys-add');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Follow the prompt on your device…'; }
        try {
            const { error } = await supabaseClient.auth.registerPasskey();
            if (error) throw error;
            ui.showToast('Passkey added. You can now sign in with it.', 'success');
            await this._renderList();
        } catch (err) {
            if (!this._cancelled(err)) modal.alert('Could Not Add Passkey', escapeHtml(this._message(err)), 'error');
        } finally {
            const b = document.getElementById('passkeys-add');
            if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-plus"></i> Add a passkey for this device'; }
        }
    },

    _startRename(li, id, current) {
        const nameEl = li.querySelector('.pk-name');
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 120;
        input.value = current;
        input.setAttribute('aria-label', 'Passkey name');
        input.className = 'w-full text-sm font-semibold rounded-lg px-2 py-1 border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-slate-800 dark:text-white';
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            if (save && name && name !== current) {
                const { error } = await supabaseClient.auth.passkey.update({ passkeyId: id, friendlyName: name });
                if (error) modal.alert('Could Not Rename', escapeHtml(this._message(error)), 'error');
            }
            await this._renderList();
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    },

    remove(id, name) {
        modal.createModal(
            'Remove Passkey',
            `<p>Remove <strong>${escapeHtml(name)}</strong>? You won't be able to sign in with it any more. Your password and other passkeys still work.</p>`,
            async () => {
                const { error } = await supabaseClient.auth.passkey.delete({ passkeyId: id });
                if (error) { modal.alert('Could Not Remove', escapeHtml(this._message(error)), 'error'); return; }
                ui.showToast('Passkey removed', 'success');
                await this._renderList();
            },
            () => {},
            'Remove', 'Cancel', 'danger'
        );
    },
};

// Keep the sign-in button in step with Sign In / Create Account, and the menu
// item present whenever the sidebar is rebuilt.
(function () {
    const _toggle = app.toggleAuthMode;
    app.toggleAuthMode = function () {
        const r = _toggle.apply(this, arguments);
        passkeys.refreshLoginButton();
        return r;
    };
    const _sidebar = ui.updateSidebar;
    ui.updateSidebar = function () {
        const r = _sidebar.apply(this, arguments);
        passkeys._injectMenuItem();
        return r;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => passkeys.check());
    else passkeys.check();
})();
