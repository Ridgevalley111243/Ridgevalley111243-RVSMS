// =============================================================================
// Paystack online payments (Settings → Finance → Paystack online payments)
//
// Accountant: switches Paystack on, then enters the school's Paystack PUBLIC
// key (pk_live_… or pk_test_…). Until a key is saved the gateway stays inactive.
// Parents:    Payments → Make Payment → "Pay online now (Paystack)". Paystack's
// own secure window takes the card or Mobile Money details; the portal never
// sees them.
//
// A successful payment is recorded straight away as PENDING with its Paystack
// reference, and the accounts office is notified. The accountant checks the
// reference in the Paystack dashboard and confirms it, as with Mobile Money.
// (Confirming automatically would need the SECRET key on a server; the public
// key alone can't prove a payment happened.)
// =============================================================================
(function () {
    'use strict';
    if (typeof actions === 'undefined' || typeof views === 'undefined' || !window.rvFeatures) return;

    const KEY_RE = /^pk_(live|test)_[A-Za-z0-9]{20,}$/;
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const publicKey = () => rvFeatures.value('paystack_public_key') || '';
    const ready = () => rvFeatures.isOn('paystack') && KEY_RE.test(publicKey());

    // ── Payment method names (shared by every list that shows payments) ─────
    window.paymentMethodLabel = function (m) {
        return { cash: 'Cash', momo: 'Mobile Money', paystack: 'Paystack (online)' }[m] || (m || '—');
    };

    // ── Accountant: public key ───────────────────────────────────────────────
    function maskKey(k) { return k ? `${k.slice(0, 8)}••••${k.slice(-4)}` : ''; }

    window.rvPaystack = {
        ready, maskKey, publicKey, KEY_RE,

        keyRowHtml() {
            const k = publicKey();
            const on = rvFeatures.isOn('paystack');
            if (!on) return '';
            return k
                ? `<p class="text-xs mt-2 text-emerald-700 dark:text-emerald-400"><i class="fas fa-circle-check mr-1"></i>Active · public key <span class="font-mono">${esc(maskKey(k))}</span>
                     <button type="button" onclick="rvPaystack.askKey()" class="ml-2 underline font-semibold">Change key</button></p>`
                : `<p class="text-xs mt-2 text-amber-700 dark:text-amber-400"><i class="fas fa-triangle-exclamation mr-1"></i>Not receiving payments yet: add your Paystack public key.
                     <button type="button" onclick="rvPaystack.askKey()" class="ml-2 underline font-semibold">Add public key</button></p>`;
        },

        askKey() {
            document.getElementById('paystack-key-modal')?.remove();
            const el = document.createElement('div');
            el.id = 'paystack-key-modal';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-labelledby', 'paystack-key-title');
            el.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4';
            el.innerHTML = `
                <div class="w-full max-w-md rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl p-6">
                    <h2 id="paystack-key-title" class="text-lg font-bold text-slate-800 dark:text-white">Paystack public key</h2>
                    <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">In your Paystack dashboard open <strong>Settings → API Keys &amp; Webhooks</strong> and copy the <strong>Public Key</strong>. It starts with <span class="font-mono">pk_live_</span> (or <span class="font-mono">pk_test_</span> for testing).</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Never paste the Secret Key here.</p>
                    <label for="paystack-key-input" class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mt-4 mb-1">Public key</label>
                    <input id="paystack-key-input" type="text" autocomplete="off" spellcheck="false" value="${esc(publicKey())}" placeholder="pk_live_…"
                        class="input-field w-full rounded-xl px-4 py-3 font-mono text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white">
                    <p id="paystack-key-error" class="hidden text-sm text-red-600 mt-2" role="alert"></p>
                    <div class="flex justify-end gap-2 mt-6">
                        <button type="button" id="paystack-key-cancel" class="px-4 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-neutral-700">Cancel</button>
                        <button type="button" id="paystack-key-save" class="px-4 py-2.5 rounded-xl font-semibold bg-ridge-600 text-white btn-primary">Save key</button>
                    </div>
                </div>`;
            document.body.appendChild(el);
            const input = el.querySelector('#paystack-key-input');
            const err = el.querySelector('#paystack-key-error');
            const close = () => el.remove();
            el.addEventListener('click', e => { if (e.target === el) close(); });
            el.querySelector('#paystack-key-cancel').addEventListener('click', close);
            el.querySelector('#paystack-key-save').addEventListener('click', async () => {
                const v = input.value.trim();
                const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); input.focus(); };
                if (/^sk_/.test(v)) return fail('That is a SECRET key. Keep it private and paste the PUBLIC key (pk_…) instead.');
                if (!KEY_RE.test(v)) return fail('That doesn’t look like a Paystack public key. It should start with pk_live_ or pk_test_.');
                const btn = el.querySelector('#paystack-key-save');
                btn.disabled = true;
                try {
                    await rvFeatures.setValue(supabaseClient, 'paystack_public_key', v);
                    close();
                    ui.showToast(v.startsWith('pk_test_') ? 'Test key saved: Paystack is in test mode' : 'Paystack is now active for parents', 'success');
                    if (state.currentView === 'settings') window.rvSettings?.render();
                } catch (e) {
                    btn.disabled = false;
                    fail(typeof extractErrorMessage === 'function' ? extractErrorMessage(e) : e.message);
                }
            });
            input.focus();
            input.select();
        },
    };

    // ── Parent: add Paystack to the Make Payment form ────────────────────────
    const _renderParentFinance = views.renderParentFinance?.bind(views);
    if (_renderParentFinance) {
        views.renderParentFinance = function () {
            const r = _renderParentFinance.apply(this, arguments);
            const sel = document.getElementById('payment-method');
            if (sel && ready() && !sel.querySelector('option[value="paystack"]')) {
                const o = document.createElement('option');
                o.value = 'paystack';
                o.textContent = 'Pay online now (card or Mobile Money, via Paystack)';
                sel.prepend(o);
                sel.value = 'paystack';
                actions.toggleProofUpload?.();
            }
            return r;
        };
    }

    const _toggleProof = actions.toggleProofUpload?.bind(actions);
    actions.toggleProofUpload = function () {
        const r = _toggleProof ? _toggleProof.apply(this, arguments) : undefined;
        const method = document.getElementById('payment-method')?.value;
        const btn = document.querySelector('[onclick="actions.makePayment()"]');
        if (btn) btn.innerHTML = method === 'paystack'
            ? '<i class="fas fa-lock mr-2"></i> Pay securely with Paystack'
            : '<i class="fas fa-credit-card mr-2"></i> Submit Payment';
        return r;
    };

    const _makePayment = actions.makePayment.bind(actions);
    actions.makePayment = function () {
        if (document.getElementById('payment-method')?.value !== 'paystack') return _makePayment.apply(this, arguments);
        return payWithPaystack();
    };

    let scriptPromise = null;
    function loadPaystack() {
        if (window.PaystackPop) return Promise.resolve();
        if (!scriptPromise) {
            scriptPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://js.paystack.co/v2/inline.js';
                s.onload = () => resolve();
                s.onerror = () => { scriptPromise = null; reject(new Error('Could not reach Paystack. Check your internet connection and try again.')); };
                document.head.appendChild(s);
            });
        }
        return scriptPromise;
    }

    async function payWithPaystack() {
        const studentId = document.getElementById('payment-child')?.value;
        const amountRaw = document.getElementById('payment-amount')?.value;
        const amount = typeof parseMoneyAmount === 'function' ? parseMoneyAmount(amountRaw) : parseFloat(amountRaw);
        const email = state.currentUser?.email;
        if (!ready()) return modal.alert('Unavailable', 'Online payments are not available right now. Please choose another method.', 'warning');
        if (!studentId) return modal.alert('Validation Error', 'Please select a child', 'warning');
        if (!amount || amount <= 0) return modal.alert('Validation Error', 'Please enter an amount greater than zero', 'warning');
        if (!email) return modal.alert('Email Needed', 'Your account has no email address, which Paystack needs for the receipt. Please contact the school office.', 'warning');

        const child = state.students.find(s => s.id === studentId);
        const reference = `RV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
        try {
            app.showLoading('Opening Paystack…');
            await loadPaystack();
        } catch (e) {
            return modal.alert('Paystack Unavailable', esc(e.message), 'error');
        } finally {
            app.hideLoading();
        }

        const popup = new window.PaystackPop();
        popup.newTransaction({
            key: publicKey(),
            email,
            amount: Math.round(amount * 100),   // pesewas
            currency: 'GHS',
            reference,
            metadata: {
                student_id: studentId,
                parent_id: state.currentUser?.id,
                custom_fields: [
                    { display_name: 'Student', variable_name: 'student', value: child?.name || studentId },
                    { display_name: 'School', variable_name: 'school', value: 'Ridge Valley Hybrid School' },
                ],
            },
            onSuccess: tx => recordPayment(studentId, child, amount, tx?.reference || reference),
            onCancel: () => ui.showToast('Payment cancelled. Nothing was charged.', 'info'),
            onError: e => modal.alert('Payment Failed', esc(e?.message || 'Paystack could not process the payment.'), 'error'),
        });
    }

    async function recordPayment(studentId, child, amount, reference) {
        try {
            app.showLoading('Recording your payment…');
            const { error } = await supabaseClient.from('transactions').insert([{
                student_id: studentId,
                parent_id: state.currentUser?.id,
                type: 'payment',
                amount,
                method: 'paystack',
                reference,
                proof: null,
                status: 'pending',
                year_id: state.currentAY?.id,
                term_id: state.currentTerm?.id,
            }]);
            if (error && error.code !== '23505') throw error; // 23505: already recorded
            try {
                await supabaseClient.rpc('notify_admins', {
                    p_title: 'New Paystack payment',
                    p_message: `${state.currentUser?.full_name || 'A parent'} paid ₵${amount.toFixed(2)} online for ${child?.name || 'a student'}. Paystack reference: ${reference}. Check it in the Paystack dashboard, then confirm it.`,
                    p_type: 'payment',
                });
            } catch (_) { /* the payment is recorded; the alert is a courtesy */ }
            app.hideLoading();
            modal.alert('Payment Received',
                `Paystack received your payment of <strong>₵${esc(amount.toFixed(2))}</strong>.<br>Reference: <strong class="font-mono">${esc(reference)}</strong><br><br>The accounts office will confirm it shortly; it shows as pending until then.`,
                'success');
            if (typeof actions.refreshData === 'function') await actions.refreshData();
            ui.route('parent_finance');
        } catch (err) {
            app.hideLoading();
            modal.alert('Payment Made, Please Tell the School',
                `Paystack took your payment, but the portal could not record it (${esc(typeof extractErrorMessage === 'function' ? extractErrorMessage(err) : err.message)}).<br><br>Please give the school office this reference: <strong class="font-mono">${esc(reference)}</strong>`,
                'warning');
        }
    }
})();
