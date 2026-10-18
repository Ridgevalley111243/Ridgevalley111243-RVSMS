// =============================================================================
// Keyboard support for the portal (index.html)
//
//   Enter            sign in / create account; confirm or save the open dialog
//   Ctrl/⌘ + Enter   send or save from a multi-line box (announcements, remarks)
//   Shift + Enter    new line in a multi-line box (Enter alone also does this)
//   Esc              close the open dialog, notifications panel or phone menu
//   /                jump to the search box on the current screen
//   N                open or close notifications
//   D                switch between light and dark mode
//   Alt + 1 … 9      open the 1st … 9th item in the menu
//   ?                show this list of shortcuts
// =============================================================================
(function () {
    'use strict';

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const MOD = isMac ? '⌘' : 'Ctrl';

    // Overlays that are not dialogs, or that must not be dismissed with Esc
    const NOT_DIALOGS = new Set(['loading-overlay', 'rv-page-skeleton', 'landing-page', 'sidebar-overlay',
        'notif-prompt-banner', 'toast-container', 'rv-offline-badge', 'terms-gate', 'staff-phone-gate']);

    const isTyping = el => !!el && (el.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

    const visible = el => {
        if (!el || el.classList?.contains('hidden')) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
    };

    // The dialog on top: the last full-screen fixed layer that is showing.
    function topDialog() {
        const layers = Array.from(document.body.children).filter(el => {
            if (NOT_DIALOGS.has(el.id) || el.tagName === 'SCRIPT') return false;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' || !visible(el)) return false;
            const r = el.getBoundingClientRect();
            return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
        });
        const forgot = document.getElementById('forgot-password-modal');
        if (forgot && visible(forgot) && !layers.includes(forgot)) layers.push(forgot);
        return layers.length ? layers[layers.length - 1] : null;
    }

    const buttonText = b => (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
    const CANCEL_WORDS = /^(cancel|close|not now|no|back|dismiss|×|x|decline.*)$/;

    function cancelButton(dialog) {
        const buttons = Array.from(dialog.querySelectorAll('button')).filter(visible);
        return dialog.querySelector('[id$="-cancel"],[id$="-close"],[id$="-deny"]')
            || buttons.find(b => CANCEL_WORDS.test(buttonText(b)))
            || buttons.find(b => /remove\(\)|close/i.test(b.getAttribute('onclick') || ''));
    }

    function primaryButton(dialog) {
        const buttons = Array.from(dialog.querySelectorAll('button')).filter(b => visible(b) && !b.disabled);
        const byId = dialog.querySelector('[id$="-save"]:not([disabled]),[id$="-confirm"]:not([disabled]),[id$="-submit"]:not([disabled]),[id$="-allow"]:not([disabled]),[id$="-verify"]:not([disabled]),[id$="-agree"]:not([disabled])');
        if (byId && visible(byId)) return byId;
        const cancel = cancelButton(dialog);
        const candidates = buttons.filter(b => b !== cancel && !CANCEL_WORDS.test(buttonText(b))
            && !b.closest('[id$="-results"]') && buttonText(b).length > 1);
        return candidates[candidates.length - 1] || null;
    }

    // Nearest "send/save" button for a multi-line box on a normal screen.
    function primaryNear(el) {
        let scope = el.closest('form, [id$="-modal"], .glass-panel, [role="dialog"]') || el.parentElement;
        for (let i = 0; scope && i < 4; i++, scope = scope.parentElement) {
            const btn = Array.from(scope.querySelectorAll('button')).find(b => visible(b) && !b.disabled &&
                (/bg-ridge-6|btn-primary|bg-emerald-6/.test(b.className) || /-save$|-submit$|-confirm$/.test(b.id || '')));
            if (btn) return btn;
        }
        return null;
    }

    // ── Shortcut help ───────────────────────────────────────────────────────
    function showHelp() {
        if (document.getElementById('rv-shortcuts')) return closeHelp();
        const rows = [
            ['Enter', 'Sign in, or confirm / save the open box'],
            [`${MOD} + Enter`, 'Send or save from a multi-line box'],
            ['Shift + Enter', 'New line in a multi-line box'],
            ['Esc', 'Close the open box, notifications or menu'],
            ['/', 'Jump to the search box'],
            ['N', 'Open or close notifications'],
            ['D', 'Switch light / dark mode'],
            ['Alt + 1 … 9', 'Open a menu item by its position'],
            ['?', 'Show these shortcuts'],
        ];
        const el = document.createElement('div');
        el.id = 'rv-shortcuts';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'rv-shortcuts-title');
        el.className = 'fixed inset-0 z-[10002] bg-black/60 flex items-center justify-center p-4';
        el.innerHTML = `
            <div class="w-full max-w-md rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl">
                <div class="flex items-center justify-between px-6 pt-5 pb-3">
                    <h2 id="rv-shortcuts-title" class="text-lg font-bold text-slate-800 dark:text-white">Keyboard shortcuts</h2>
                    <button type="button" id="rv-shortcuts-close" aria-label="Close" class="w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5">×</button>
                </div>
                <dl class="px-6 pb-6 space-y-2.5">
                    ${rows.map(([k, d]) => `
                        <div class="flex items-center justify-between gap-4 text-sm">
                            <dt class="text-slate-600 dark:text-slate-300">${d}</dt>
                            <dd><kbd class="inline-block min-w-[2rem] text-center px-2 py-1 rounded-md border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 font-semibold text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap">${k}</kbd></dd>
                        </div>`).join('')}
                </dl>
            </div>`;
        el.addEventListener('click', e => { if (e.target === el) closeHelp(); });
        document.body.appendChild(el);
        const close = el.querySelector('#rv-shortcuts-close');
        close.addEventListener('click', closeHelp);
        close.focus();
    }
    function closeHelp() { document.getElementById('rv-shortcuts')?.remove(); }

    const signedIn = () => typeof state !== 'undefined' && !!state.currentUser;

    // ── Enter ───────────────────────────────────────────────────────────────
    function onEnter(e) {
        const t = e.target;
        const mod = e.ctrlKey || e.metaKey;

        if (t.tagName === 'TEXTAREA') {
            if (!mod) return;                       // Enter / Shift+Enter: new line
            const btn = (topDialog() && primaryButton(topDialog())) || primaryNear(t);
            if (btn) { e.preventDefault(); btn.click(); }
            return;
        }
        if (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SELECT') return; // native behaviour
        if (t.type === 'checkbox' || t.type === 'radio') return;
        if (t.closest('form')) return;              // real forms submit themselves

        // Sign-in / create-account screen
        if (t.closest('#auth-container') && !topDialog()) {
            e.preventDefault();
            if (typeof auth !== 'undefined') auth.handleAction();
            return;
        }
        if (t.id === 'reset-email') {
            e.preventDefault();
            if (typeof auth !== 'undefined') auth.sendResetLink();
            return;
        }
        const dialog = topDialog();
        if (dialog && dialog.contains(t)) {
            const btn = primaryButton(dialog);
            if (btn) { e.preventDefault(); btn.click(); }
        }
    }

    // ── Esc ─────────────────────────────────────────────────────────────────
    function onEscape(e) {
        if (document.getElementById('rv-shortcuts')) { closeHelp(); e.preventDefault(); return; }
        const panel = document.getElementById('notif-panel');
        if (panel) { panel.remove(); e.preventDefault(); return; }
        document.getElementById('notif-prompt-banner')?.remove();

        const dialog = topDialog();
        if (dialog) {
            if (dialog.id === 'forgot-password-modal' && typeof app !== 'undefined') {
                app.closeForgotPassword(); e.preventDefault(); return;
            }
            const btn = cancelButton(dialog);
            if (btn) { btn.click(); e.preventDefault(); }
            return;
        }
        if (typeof ui !== 'undefined' && ui.isSidebarOpen && innerWidth < 1024) {
            (ui.closeSidebar || ui.toggleSidebar).call(ui);
            e.preventDefault();
            return;
        }
        if (isTyping(e.target)) e.target.blur();
    }

    document.addEventListener('keydown', e => {
        if (e.isComposing || e.defaultPrevented) return;

        if (e.key === 'Enter') return onEnter(e);
        if (e.key === 'Escape') return onEscape(e);

        // The rest are single-key shortcuts: never while typing or inside a dialog
        if (isTyping(e.target)) return;
        if (topDialog() || document.getElementById('terms-gate')) return;

        if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
            if (!signedIn()) return;
            const items = Array.from(document.querySelectorAll('#sidebar-nav .sidebar-item'));
            const item = items[Number(e.code.slice(5)) - 1];
            if (item) { e.preventDefault(); item.click(); }
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (e.key === '?') { e.preventDefault(); showHelp(); return; }
        if (e.key === '/') {
            const box = document.querySelector('#view-content input[type="search"], #view-content input[placeholder*="Search" i], #view-content input[placeholder*="search" i]');
            if (box) { e.preventDefault(); box.focus(); box.select?.(); }
            return;
        }
        if ((e.key === 'n' || e.key === 'N') && signedIn() && typeof notificationManager !== 'undefined') {
            e.preventDefault(); notificationManager.openPanel(); return;
        }
        if ((e.key === 'd' || e.key === 'D') && typeof app !== 'undefined') {
            e.preventDefault(); app.toggleDarkMode(); return;
        }
    });

    window.rvShowShortcuts = showHelp;
})();
