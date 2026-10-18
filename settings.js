// =============================================================================
// Settings: switch features on and off (portal side)
//
//   Admin      → Settings → Academic features
//   Accountant → Settings → Finance features
//
// A switched-off feature disappears everywhere: its menu items, links on other
// screens, and its screens (opening one goes back to the dashboard). Switching
// it back on brings everything back; no data is deleted either way.
// =============================================================================
(function () {
    'use strict';
    if (typeof ui === 'undefined' || typeof app === 'undefined' || !window.rvFeatures) return;

    const HOME = { admin: 'overview', teacher: 'teacher_dashboard', parent: 'parent_dashboard', accountant: 'accountant_dashboard' };
    const GROUP_FOR_ROLE = { admin: 'academic', accountant: 'finance' };
    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const viewOn = view => { const f = rvFeatures.featureForView(view); return !f || rvFeatures.isOn(f); };

    // ── Load switches (and the teacher's name order) before the dashboard is built
    const _loadUserData = app.loadUserData.bind(app);
    app.loadUserData = async function (user) {
        // Show the dashboard skeleton straight away while the switches load
        document.getElementById('loading-overlay')?.classList.add('hidden');
        app.showPageSkeleton?.('app');
        await rvFeatures.load(supabaseClient);
        state._nameOrder = window.rvNameOrder ? await rvNameOrder.load(supabaseClient) : null;
        return _loadUserData(user);
    };

    // ── Screens ──────────────────────────────────────────────────────────────
    const _allowed = ui.allowedView.bind(ui);
    ui.allowedView = function (view) {
        if (view === 'settings') return GROUP_FOR_ROLE[state.role] ? 'settings' : (HOME[state.role] || view);
        if (!viewOn(view)) return HOME[state.role] || 'overview';
        return _allowed(view);
    };

    const _route = ui.route.bind(ui);
    ui.route = function (view) {
        if (view !== 'settings' && !viewOn(view)) {
            ui.showToast('That feature is switched off', 'info');
            return _route(HOME[state.role] || 'overview');
        }
        if (view !== 'settings' || !GROUP_FOR_ROLE[state.role]) return _route(view);
        state.currentView = 'settings';
        document.querySelectorAll('.sidebar-item').forEach(b =>
            b.classList.toggle('active', !!b.getAttribute('onclick')?.includes("'settings'")));
        if (!ui._keepPlace) window.scrollTo(0, 0);
        renderSettings();
    };

    function renderSettings() {
        const groupId = GROUP_FOR_ROLE[state.role];
        const g = rvFeatures.GROUPS[groupId];
        const container = document.getElementById('view-content');
        if (!container) return;
        container.innerHTML = `
            <div class="mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Settings</h2>
                <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Switch off features the school isn't using, and switch them back on whenever you need them. Switching a feature off hides it; nothing is deleted.</p>
            </div>
            <section aria-labelledby="settings-group-title" class="glass-panel rounded-2xl bg-white dark:bg-slate-800 shadow-lg overflow-hidden">
                <h3 id="settings-group-title" class="px-6 pt-5 pb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">${esc(g.title)}</h3>
                <ul class="divide-y divide-slate-200 dark:divide-slate-700">
                    ${g.features.map(f => {
                        const on = rvFeatures.isOn(f.id);
                        return `
                        <li class="flex items-start gap-4 px-6 py-4">
                            <div class="min-w-0 flex-1">
                                <p id="feat-${f.id}-label" class="font-semibold text-slate-800 dark:text-white">${esc(f.label)}</p>
                                <p id="feat-${f.id}-desc" class="text-sm text-slate-600 dark:text-slate-300 mt-0.5">${esc(f.desc)}</p>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Used by: ${esc(f.who)}</p>
                                ${f.id === 'paystack' && window.rvPaystack ? `<div id="paystack-key-row">${rvPaystack.keyRowHtml()}</div>` : ''}
                            </div>
                            <button type="button" role="switch" aria-checked="${on}" aria-labelledby="feat-${f.id}-label" aria-describedby="feat-${f.id}-desc"
                                data-feature="${f.id}" onclick="rvSettings.toggle('${groupId}','${f.id}', this)"
                                class="rv-switch shrink-0 mt-1"><span class="sr-only">${on ? 'On' : 'Off'}</span></button>
                        </li>`;
                    }).join('')}
                </ul>
            </section>`;
    }

    async function toggle(groupId, id, btn) {
        const next = !rvFeatures.isOn(id);
        btn.setAttribute('aria-checked', String(next));
        btn.disabled = true;
        try {
            await rvFeatures.set(supabaseClient, groupId, id, next);
            const f = rvFeatures.GROUPS[groupId].features.find(x => x.id === id);
            ui.showToast(`${f.label} switched ${next ? 'on' : 'off'}`, 'success');
            ui.updateSidebar();
            if (id === 'weeks') ui.updatePeriodDisplay?.();
            if (id === 'paystack' && window.rvPaystack) {
                const row = document.getElementById('paystack-key-row');
                if (row) row.innerHTML = rvPaystack.keyRowHtml();
                // Switched on with no key yet: ask for it straight away
                if (next && !rvPaystack.publicKey()) rvPaystack.askKey();
            }
        } catch (err) {
            btn.setAttribute('aria-checked', String(!next));
            modal.alert('Could Not Save', esc(typeof extractErrorMessage === 'function' ? extractErrorMessage(err) : err.message), 'error');
        } finally {
            btn.disabled = false;
            const sr = btn.querySelector('.sr-only');
            if (sr) sr.textContent = btn.getAttribute('aria-checked') === 'true' ? 'On' : 'Off';
        }
    }

    // ── Menu ─────────────────────────────────────────────────────────────────
    function menuButton(view, label, icon) {
        const b = document.createElement('button');
        b.className = 'sidebar-item' + (state.currentView === view ? ' active' : '');
        b.setAttribute('onclick', `ui.route('${view}'); if(window.innerWidth<=768){ui.closeSidebar();}`);
        b.style.cssText = 'touch-action:manipulation;-webkit-tap-highlight-color:rgba(255,255,255,0.1);';
        b.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>`;
        return b;
    }
    const itemFor = (nav, view) => nav.querySelector(`.sidebar-item[onclick*="'${view}'"]`);

    const _updateSidebar = ui.updateSidebar.bind(ui);
    ui.updateSidebar = function () {
        const r = _updateSidebar.apply(this, arguments);
        const nav = document.getElementById('sidebar-nav');
        if (!nav) return r;

        // Attendance items (only while the feature is on)
        if (rvFeatures.isOn('attendance')) {
            if (state.role === 'teacher' && !itemFor(nav, 'teacher_attendance')) {
                const after = itemFor(nav, 'teacher_students');
                const a = menuButton('teacher_attendance', 'Attendance', 'fa-clipboard-check');
                const t = menuButton('teacher_total_attendance', 'Attendance Summary', 'fa-calendar-check');
                if (after) { after.after(a); a.after(t); }
            }
            if (state.role === 'admin' && !itemFor(nav, 'attendance')) {
                const after = itemFor(nav, 'admin_upload_reports') || itemFor(nav, 'received_reports');
                if (after) after.after(menuButton('attendance', 'Attendance', 'fa-clipboard-check'));
            }
        }

        // Settings for the admin and the accountant, as the last menu item
        if (GROUP_FOR_ROLE[state.role] && !itemFor(nav, 'settings')) {
            const items = nav.querySelectorAll('.sidebar-item');
            const last = items[items.length - 1];
            if (last) last.after(menuButton('settings', 'Settings', 'fa-sliders-h'));
        }

        // Remove items for switched-off features, then any section left empty
        nav.querySelectorAll('.sidebar-item').forEach(b => {
            const m = (b.getAttribute('onclick') || '').match(/route\('([^']+)'\)/);
            if (m && !viewOn(m[1])) b.remove();
        });
        nav.querySelectorAll('.rv-nav-section').forEach(sec => {
            let n = sec.nextElementSibling;
            while (n && !n.classList.contains('rv-nav-section') && !n.classList.contains('sidebar-item')) n = n.nextElementSibling;
            if (!n || n.classList.contains('rv-nav-section')) sec.remove();
        });
        return r;
    };

    // ── Week badge in the top bar follows the Academic weeks switch ──────────
    if (typeof ui.updatePeriodDisplay === 'function') {
        const _period = ui.updatePeriodDisplay.bind(ui);
        ui.updatePeriodDisplay = function () {
            const r = _period.apply(this, arguments);
            if (!rvFeatures.isOn('weeks')) { const wb = document.getElementById('week-badge'); if (wb) wb.style.display = 'none'; }
            return r;
        };
    }

    // ── Hide links to switched-off screens inside any screen ─────────────────
    function hideDeadLinks(root) {
        root.querySelectorAll('[onclick*="ui.route("]').forEach(el => {
            const m = (el.getAttribute('onclick') || '').match(/ui\.route\('([^']+)'\)/);
            if (!m) return;
            const target = m[1] === 'weeks' ? (el.closest('.mt-8') || el) : el;
            const hide = !viewOn(m[1]);
            if (hide) { target.dataset.rvFeatureHidden = '1'; target.style.display = 'none'; }
            else if (target.dataset.rvFeatureHidden) { delete target.dataset.rvFeatureHidden; target.style.display = ''; }
        });
    }
    const content = document.getElementById('view-content');
    if (content) {
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; hideDeadLinks(content); });
        }).observe(content, { childList: true, subtree: true });
    }

    // ── Teacher: student name order (saved on their account) ─────────────────
    if (typeof actions !== 'undefined' && window.rvNameOrder) {
        actions.setNameOrder = async function (order) {
            const prev = state._nameOrder;
            state._nameOrder = order;
            ui.route(state.currentView);
            const { error } = await rvNameOrder.save(supabaseClient, order);
            if (error) {
                state._nameOrder = prev;
                ui.route(state.currentView);
                modal.alert('Could Not Save', esc(error.message || 'Please try again.'), 'error');
                return;
            }
            ui.showToast('Name order saved', 'success');
        };
    }

    const style = document.createElement('style');
    style.textContent = `
        .rv-switch { position: relative; width: 48px; height: 28px; border-radius: 999px; border: none;
            background: #cbd5e1; cursor: pointer; transition: background-color .2s ease; }
        .rv-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px;
            border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s ease; }
        .rv-switch[aria-checked="true"] { background: #047857; }
        .rv-switch[aria-checked="true"]::after { transform: translateX(20px); }
        .rv-switch:focus-visible { outline: 3px solid #34d399; outline-offset: 2px; }
        .rv-switch:disabled { opacity: .6; cursor: progress; }
        .dark .rv-switch { background: #404040; }
        .dark .rv-switch[aria-checked="true"] { background: #059669; }
        @media (prefers-reduced-motion: reduce) { .rv-switch, .rv-switch::after { transition: none; } }`;
    document.head.appendChild(style);

    window.rvSettings = { toggle, render: renderSettings };
})();
