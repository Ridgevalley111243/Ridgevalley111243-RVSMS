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
                                ${f.id === 'sms' && window.rvSms ? `<div id="sms-row">${rvSms.rowHtml()}</div>` : ''}
                            </div>
                            <button type="button" role="switch" aria-checked="${on}" aria-labelledby="feat-${f.id}-label" aria-describedby="feat-${f.id}-desc"
                                data-feature="${f.id}" onclick="rvSettings.toggle('${groupId}','${f.id}', this)"
                                class="rv-switch shrink-0 mt-1"><span class="sr-only">${on ? 'On' : 'Off'}</span></button>
                        </li>`;
                    }).join('')}
                </ul>
            </section>`;
        if (groupId === 'academic' && window.rvSms && rvFeatures.isOn('sms')) rvSms.refresh();
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
            if (id === 'sms' && window.rvSms) await rvSms.afterToggle(next);
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

    // ── Teacher: arrange a student's name (My Students → Arrange name) ───────
    // The teacher marks each word as surname, first name or middle name, and
    // the name is saved in register order: SURNAME FIRST MIDDLE.
    const PARTS = [
        { id: 'surname', label: 'Surname' },
        { id: 'first', label: 'First name' },
        { id: 'middle', label: 'Middle name' },
    ];
    function arrangedName(words, roles) {
        const of = part => words.filter((_, i) => roles[i] === part);
        return [...of('surname'), ...of('first'), ...of('middle')].join(' ');
    }
    function normalGender(g) {
        const v = String(g || '').trim().toLowerCase();
        return { male: 'Male', female: 'Female', other: 'Other' }[v] || '';
    }

    if (typeof actions !== 'undefined') {
        actions.teacherArrangeName = function (id) {
            const student = (state.students || []).find(s => s.id === id);
            if (!student) return;
            const words = String(student.name || '').trim().split(/\s+/).filter(Boolean);
            if (words.length < 2) {
                modal.alert('Nothing to Arrange', 'This name has only one word. Use <strong>Edit</strong> to add the rest of the name.', 'info');
                return;
            }
            // Start from how the name is written now: first word surname, second first name, the rest middle
            const roles = words.map((_, i) => (i === 0 ? 'surname' : i === 1 ? 'first' : 'middle'));
            const mid = 'arrange-name-' + Date.now();
            const rows = words.map((w, i) => `
                <fieldset class="rounded-xl border border-slate-200 dark:border-neutral-800 p-3">
                    <legend class="px-1 text-base font-bold text-slate-800 dark:text-white">${esc(w)}</legend>
                    <div class="rv-part-row mt-1">
                        ${PARTS.map(p => `
                        <label class="rv-part-opt">
                            <input type="radio" name="${mid}-w${i}" value="${p.id}" data-word="${i}" ${roles[i] === p.id ? 'checked' : ''} class="sr-only">
                            <span>${p.label}</span>
                        </label>`).join('')}
                    </div>
                </fieldset>`).join('');
            document.body.insertAdjacentHTML('beforeend', `
                <div id="${mid}" class="fixed inset-0 z-[9999] bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="${mid}-title">
                    <form id="${mid}-form" class="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-neutral-800 shadow-2xl">
                        <div class="px-6 pt-6 pb-2">
                            <h3 id="${mid}-title" class="text-lg font-bold text-slate-800 dark:text-white">Arrange Name</h3>
                            <p class="text-sm text-slate-500 dark:text-slate-400">For each word, choose whether it is the surname, first name or middle name.</p>
                        </div>
                        <div class="px-6 py-4 space-y-3">
                            ${rows}
                            <div class="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                                <p class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Will be saved as</p>
                                <p id="${mid}-preview" class="mt-1 font-semibold text-slate-800 dark:text-white break-words" aria-live="polite"></p>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Surname, then first name, then middle name.</p>
                            </div>
                            <p id="${mid}-error" class="hidden text-sm text-red-600" role="alert"></p>
                        </div>
                        <div class="px-6 pb-6 flex gap-3">
                            <button type="button" id="${mid}-cancel" class="flex-1 py-3 rounded-xl border border-slate-300 dark:border-neutral-700 font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
                            <button type="submit" id="${mid}-save" class="flex-[2] py-3 rounded-xl bg-ridge-600 hover:bg-ridge-700 text-white font-semibold"><i class="fas fa-save mr-2"></i>Save Name</button>
                        </div>
                    </form>
                </div>`);
            const el = document.getElementById(mid);
            const $ = suffix => document.getElementById(`${mid}-${suffix}`);
            const close = () => el.remove();
            const problem = () => {
                if (!roles.includes('surname')) return 'Choose which word is the surname.';
                if (!roles.includes('first')) return 'Choose which word is the first name.';
                return '';
            };
            const refresh = () => {
                $('preview').textContent = arrangedName(words, roles);
                const msg = problem();
                $('error').textContent = msg;
                $('error').classList.toggle('hidden', !msg);
                $('save').disabled = !!msg;
                $('save').classList.toggle('opacity-50', !!msg);
            };
            el.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
                roles[+r.dataset.word] = r.value;
                refresh();
            }));
            $('cancel').onclick = close;
            el.addEventListener('click', e => { if (e.target === el) close(); });
            refresh();
            el.querySelector('input[type=radio]:checked')?.focus();

            $('form').onsubmit = async e => {
                e.preventDefault();
                if (problem()) return refresh();
                const name = arrangedName(words, roles);
                if (name === words.join(' ')) { close(); ui.showToast('Name already in this order', 'info'); return; }
                try {
                    app.showLoading('Saving name...');
                    const { error } = await supabaseClient.rpc('teacher_update_student', {
                        p_student_id: id,
                        p_name: name,
                        p_admission_number: student.admission_number || '',
                        p_gender: normalGender(student.gender),
                        p_age: student.age || '',
                        p_dob: student.dob || '',
                    });
                    if (error) throw error;
                    close();
                    await dataManager.loadStudents();
                    ui.route('teacher_students');
                    ui.showToast('Name arranged', 'success');
                } catch (err) {
                    modal.alert('Could Not Save', esc(typeof extractErrorMessage === 'function' ? extractErrorMessage(err) : err.message), 'error');
                } finally {
                    app.hideLoading();
                }
            };
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
        @media (prefers-reduced-motion: reduce) { .rv-switch, .rv-switch::after { transition: none; } }
        .rv-part-row { display: flex; gap: .375rem; }
        .rv-part-opt { flex: 1 1 0; min-width: 0; cursor: pointer; }
        .rv-part-opt span { display: block; text-align: center; padding: .55rem .25rem; border-radius: .6rem;
            border: 1px solid #cbd5e1; font-size: .8rem; font-weight: 600; color: #475569; }
        .rv-part-opt input:checked + span { background: #047857; border-color: #047857; color: #fff; }
        .rv-part-opt input:focus-visible + span { outline: 3px solid #34d399; outline-offset: 2px; }
        .dark .rv-part-opt span { border-color: #404040; color: #cbd5e1; }
        .dark .rv-part-opt input:checked + span { background: #059669; border-color: #059669; color: #fff; }`;
    document.head.appendChild(style);

    window.rvSettings = { toggle, render: renderSettings };
})();
