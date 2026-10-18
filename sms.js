// =============================================================================
// SMS to parents through httpSMS (Settings → Academic → SMS to parents)
//
// httpSMS (https://httpsms.com) turns an Android phone into the SMS gateway:
// the portal asks httpSMS to send, and the phone sends a normal text from its
// SIM. The phone must stay switched on and online.
//
// Admin: switches SMS on, then enters the httpSMS API key and the sending
// phone's number, and sends a test message. The key is stored where no
// browser can read it; texts are sent by the send-sms Edge Function.
// =============================================================================
(function () {
    'use strict';
    if (typeof ui === 'undefined' || !window.rvFeatures) return;

    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const errText = e => (typeof extractErrorMessage === 'function' ? extractErrorMessage(e) : (e?.message || String(e)));
    let status = null;   // { configured, from_number, key_hint } once loaded

    async function loadStatus() {
        const { data, error } = await supabaseClient.rpc('admin_sms_status');
        if (error) throw error;
        status = data || { configured: false };
        return status;
    }

    function rowHtml() {
        if (!rvFeatures.isOn('sms')) return '';
        if (!status) return `<p class="text-xs mt-2 text-slate-500 dark:text-slate-400"><i class="fas fa-circle-notch fa-spin mr-1"></i>Checking SMS setup…</p>`;
        if (!status.configured) {
            return `<p class="text-xs mt-2 text-amber-700 dark:text-amber-400"><i class="fas fa-triangle-exclamation mr-1"></i>Not sending yet: add your httpSMS API key and the sending phone's number.
                <button type="button" onclick="rvSms.setup()" class="ml-2 underline font-semibold">Set up SMS</button></p>`;
        }
        return `<p class="text-xs mt-2 text-emerald-700 dark:text-emerald-400"><i class="fas fa-circle-check mr-1"></i>Ready · sending from <span class="font-mono">${esc(status.from_number)}</span> · key ••••${esc(status.key_hint)}
            <button type="button" onclick="rvSms.test()" class="ml-2 underline font-semibold">Send test SMS</button>
            <button type="button" onclick="rvSms.setup()" class="ml-2 underline font-semibold">Change setup</button></p>`;
    }

    function paintRow() {
        const row = document.getElementById('sms-row');
        if (row) row.innerHTML = rowHtml();
    }

    async function refresh() {
        try { await loadStatus(); }
        catch (e) { status = { configured: false }; console.warn('[sms] status:', errText(e)); }
        paintRow();
        return status;
    }

    async function afterToggle(on) {
        paintRow();
        if (!on) return;
        const s = await refresh();
        if (!s.configured) setup();
    }

    // A small dialog shell matching the other Settings dialogs
    function dialog(id, title, bodyHtml, saveLabel) {
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', `${id}-title`);
        el.className = 'fixed inset-0 z-[9999] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto';
        el.innerHTML = `
            <div class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl p-6">
                <h2 id="${id}-title" class="text-lg font-bold text-slate-800 dark:text-white">${title}</h2>
                ${bodyHtml}
                <p id="${id}-error" class="hidden text-sm text-red-600 mt-3" role="alert"></p>
                <div class="flex justify-end gap-2 mt-6">
                    <button type="button" id="${id}-cancel" class="px-4 py-2.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-neutral-700">Cancel</button>
                    <button type="button" id="${id}-save" class="px-4 py-2.5 rounded-xl font-semibold bg-ridge-600 text-white btn-primary">${saveLabel}</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        const close = () => el.remove();
        el.addEventListener('click', e => { if (e.target === el) close(); });
        el.querySelector(`#${id}-cancel`).addEventListener('click', close);
        const err = el.querySelector(`#${id}-error`);
        const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };
        const clear = () => err.classList.add('hidden');
        return { el, close, fail, clear, save: el.querySelector(`#${id}-save`) };
    }

    const field = 'input-field w-full rounded-xl px-4 py-3 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white';
    const label = 'block text-sm font-semibold text-slate-700 dark:text-slate-300 mt-4 mb-1';

    function setup() {
        const has = !!status?.configured;
        const d = dialog('sms-setup-modal', 'Set up SMS (httpSMS)', `
            <ol class="text-sm text-slate-600 dark:text-slate-300 mt-2 space-y-1 list-decimal pl-5">
                <li>On the Android phone that will send the texts, install the <strong>httpSMS</strong> app from <span class="font-mono">httpsms.com</span>.</li>
                <li>Sign in at <span class="font-mono">httpsms.com</span>, open <strong>Settings</strong> and copy your <strong>API key</strong>.</li>
                <li>Sign in to the app on the phone with the same API key and allow it to send SMS.</li>
            </ol>
            <label for="sms-from" class="${label}">Sending phone's number</label>
            <input id="sms-from" type="tel" autocomplete="off" value="${esc(status?.from_number || '')}" placeholder="+233241234567" class="${field} font-mono">
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">The number of the SIM in that phone, starting with +233.</p>
            <label for="sms-key" class="${label}">httpSMS API key</label>
            <input id="sms-key" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? 'Leave empty to keep the saved key' : 'Paste the API key'}" class="${field} font-mono">
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Stored securely on the server. Nobody can read it back from the portal.</p>`,
            'Save');
        const from = d.el.querySelector('#sms-from');
        const key = d.el.querySelector('#sms-key');
        d.save.addEventListener('click', async () => {
            d.clear();
            let num = from.value.replace(/[^\d+]/g, '');
            if (/^0\d{9}$/.test(num)) num = '+233' + num.slice(1);
            if (!/^\+[1-9]\d{7,14}$/.test(num)) { from.focus(); return d.fail('Enter the phone number with its country code, e.g. +233241234567.'); }
            if (!has && !key.value.trim()) { key.focus(); return d.fail('Paste the httpSMS API key.'); }
            d.save.disabled = true;
            try {
                const { error } = await supabaseClient.rpc('admin_set_sms_config', { p_api_key: key.value.trim(), p_from_number: num });
                if (error) throw error;
                d.close();
                await refresh();
                ui.showToast('SMS setup saved', 'success');
                test();
            } catch (e) {
                d.save.disabled = false;
                d.fail(errText(e));
            }
        });
        (has ? key : from).focus();
    }

    function test() {
        const d = dialog('sms-test-modal', 'Send a test SMS', `
            <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">Make sure the phone running httpSMS is switched on and online, then send a text to your own number.</p>
            <label for="sms-test-to" class="${label}">Send to</label>
            <input id="sms-test-to" type="tel" autocomplete="tel" value="${esc(state.currentUser?.phone || '')}" placeholder="024 123 4567" class="${field} font-mono">
            <label for="sms-test-msg" class="${label}">Message</label>
            <textarea id="sms-test-msg" rows="3" class="${field}">Test message from the Ridge Valley school portal. If you received this, SMS is working.</textarea>
            <div id="sms-test-result" class="mt-3 text-sm" aria-live="polite"></div>`,
            '<i class="fas fa-paper-plane mr-2"></i>Send');
        const to = d.el.querySelector('#sms-test-to');
        const msg = d.el.querySelector('#sms-test-msg');
        const out = d.el.querySelector('#sms-test-result');
        d.save.addEventListener('click', async () => {
            d.clear();
            out.innerHTML = '';
            if (!to.value.trim()) { to.focus(); return d.fail('Enter the number to send to.'); }
            d.save.disabled = true;
            try {
                const r = await send(to.value.trim(), msg.value);
                const first = r.results?.[0] || {};
                if (!r.sent) throw new Error(first.error || 'httpSMS did not accept the message.');
                out.innerHTML = `<p class="text-emerald-700 dark:text-emerald-400"><i class="fas fa-circle-check mr-1"></i>httpSMS accepted the message for <span class="font-mono">${esc(first.to)}</span>. Your phone should send it within a minute; you can follow it on httpsms.com.</p>`;
                d.save.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Send again';
            } catch (e) {
                d.fail(errText(e));
            } finally {
                d.save.disabled = false;
            }
        });
        to.focus();
    }

    // Sends through the send-sms Edge Function; resolves to { sent, failed, results }
    async function send(to, message) {
        const { data, error } = await supabaseClient.functions.invoke('send-sms', { body: { to, message } });
        if (error) {
            let msg = error.message;
            try { msg = (await error.context.json()).error || msg; } catch (_) { /* keep the generic message */ }
            throw new Error(msg);
        }
        return data;
    }

    window.rvSms = { rowHtml, refresh, afterToggle, setup, test, send };
})();
