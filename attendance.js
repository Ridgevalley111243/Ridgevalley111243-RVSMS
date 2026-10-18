// =============================================================================
// Teacher attendance marking (switchable in Settings → Academic features)
//
//   Teacher → Attendance          mark each student Present / Absent for a day
//   Teacher → Attendance Summary  days present / absent / rate for the term
//   Admin   → Attendance          view records by date and class
//
// Restored from the version removed in June, with these fixes:
//   • saving showed "Failed to save attendance" even when it had saved
//     (it called a loader that no longer existed);
//   • records were matched by class NAME, so renaming a class or legacy
//     spellings hid saved attendance — now matched by student;
//   • school days were worked out in UTC, which can shift a day; now uses
//     the calendar date as written;
//   • the term summary relied on data that was never loaded (always 0%);
//   • student names were inserted into the page without escaping;
//   • dates in the future could be marked.
// =============================================================================
(function () {
    'use strict';
    if (typeof ui === 'undefined' || typeof views === 'undefined' || typeof actions === 'undefined') return;

    const todayISO = () => (typeof localDateISO === 'function') ? localDateISO()
        : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    // 'YYYY-MM-DD' → Date at local midnight (never shifted by time zone)
    const parseDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayLabel = iso => parseDay(iso).toLocaleDateString('en-GH', { weekday: 'short', day: '2-digit', month: 'short' });

    const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));
    const nameOf = s => (window.rvNameOrder && window.rvFeatures?.isOn('name_order') && state._nameOrder)
        ? rvNameOrder.format(s.name, state._nameOrder) : s.name;
    const ordered = list => (window.rvNameOrder && window.rvFeatures?.isOn('name_order'))
        ? rvNameOrder.sort(list, state._nameOrder || rvNameOrder.DEFAULT) : list;

    function activeWeekFor(date) {
        if (!window.rvFeatures?.isOn('weeks')) return null;
        if (typeof featureState === 'undefined' || !featureState.weeks || !state.currentAY || !state.currentTerm) return null;
        const inTerm = featureState.weeks.filter(w => w.academic_year_id === state.currentAY.id && w.term_id === state.currentTerm.id);
        return inTerm.find(w => w.status === 'active' && w.start_date <= date && w.end_date >= date)
            || inTerm.find(w => w.status === 'active') || null;
    }

    const badge = {
        none:    ['bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', 'Not marked'],
        present: ['bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', 'Present'],
        absent:  ['bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', 'Absent'],
    };
    function setBadge(id, status) {
        const el = document.getElementById(`attendance-status-${id}`);
        if (!el) return;
        const [cls, text] = badge[status] || badge.none;
        el.className = `px-3 py-1 rounded-full text-xs font-bold ${cls}`;
        el.textContent = text;
        el.dataset.status = status || '';
    }

    async function freshTeacherData() {
        try {
            await dataManager.refreshCurrentTeacherAssignment();
            await dataManager.loadClasses();
            await dataManager.loadStudents();
        } catch (_) { /* render with what we have */ }
    }

    // ── Teacher: mark attendance ─────────────────────────────────────────────
    views.renderTeacherAttendance = async function () {
        await freshTeacherData();
        const students = ordered(dataManager.getTeacherStudents());
        const today = todayISO();
        const week = activeWeekFor(today);

        let dateControl;
        if (week) {
            const days = [];
            for (let d = parseDay(week.start_date); d <= parseDay(week.end_date); d.setDate(d.getDate() + 1)) {
                const iso = isoOf(d);
                if (d.getDay() >= 1 && d.getDay() <= 5 && iso <= today) days.push(iso);
            }
            const pick = days.includes(today) ? today : days[days.length - 1];
            dateControl = days.length ? `
                <label for="attendance-date" class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">School day <span class="text-xs text-slate-500">(${esc(week.week_name)})</span></label>
                <select id="attendance-date" onchange="views._loadAttendanceForSelectedDate()" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white w-full md:w-auto">
                    ${days.map(iso => `<option value="${iso}" ${iso === pick ? 'selected' : ''}>${dayLabel(iso)}</option>`).join('')}
                </select>` : `<p class="text-sm text-slate-500">${esc(week.week_name)} hasn't started yet.</p>`;
        } else {
            dateControl = `
                <label for="attendance-date" class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Date</label>
                <input type="date" id="attendance-date" value="${today}" max="${today}" onchange="views._loadAttendanceForSelectedDate()" class="input-field rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white w-full md:w-auto">`;
        }

        const html = `
            <div class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                <h2 class="text-2xl font-bold mb-1 text-slate-800 dark:text-white">Attendance</h2>
                <p class="text-sm text-slate-500 mb-6">Mark each student present or absent, then save.</p>
                <div class="flex flex-wrap items-end gap-4 mb-6">
                    <div>${dateControl}</div>
                    ${students.length ? `<button type="button" onclick="actions.markAllAttendance('present')" class="px-4 py-3 rounded-xl text-sm font-semibold border border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">Mark everyone present</button>` : ''}
                </div>
                ${students.length === 0 ? `<p class="text-slate-500 text-center py-8">No students assigned to your class</p>` : `
                <div id="attendance-table-wrapper" class="overflow-x-auto transition-opacity">
                    <table class="w-full text-left min-w-[520px]">
                        <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                            <tr>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Student</th>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Status</th>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-right"><span class="sr-only">Mark</span></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                            ${students.map(s => `
                            <tr>
                                <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${esc(nameOf(s))}</td>
                                <td class="px-6 py-4"><span id="attendance-status-${esc(s.id)}" data-status="" class="px-3 py-1 rounded-full text-xs font-bold ${badge.none[0]}">${badge.none[1]}</span></td>
                                <td class="px-6 py-4 text-right whitespace-nowrap">
                                    <button type="button" onclick="actions.markAttendance('${esc(s.id)}','present')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold mr-2 hover:bg-emerald-700">Present</button>
                                    <button type="button" onclick="actions.markAttendance('${esc(s.id)}','absent')" class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700">Absent</button>
                                </td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <button type="button" id="attendance-save" onclick="actions.saveAttendance()" class="mt-6 px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold btn-primary w-full md:w-auto">
                    <i class="fas fa-save mr-2"></i> Save attendance
                </button>`}
            </div>`;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
        if (students.length) await views._loadAttendanceForSelectedDate();
    };

    views._loadAttendanceForSelectedDate = async function () {
        const date = document.getElementById('attendance-date')?.value;
        const students = dataManager.getTeacherStudents();
        if (!date || !students.length) return;
        const wrap = document.getElementById('attendance-table-wrapper');
        if (wrap) wrap.style.opacity = '0.45';
        students.forEach(s => setBadge(s.id, ''));
        try {
            const { data, error } = await supabaseClient.from('attendance')
                .select('student_id, status').eq('date', date).in('student_id', students.map(s => s.id));
            if (error) throw error;
            (data || []).forEach(r => setBadge(r.student_id, r.status));
        } catch (err) {
            console.warn('[attendance] load failed:', err);
            ui.showToast('Could not load saved attendance for this day', 'warning');
        } finally {
            if (wrap) wrap.style.opacity = '1';
        }
    };

    actions.markAttendance = function (studentId, status) { setBadge(studentId, status); };
    actions.markAllAttendance = function (status) {
        dataManager.getTeacherStudents().forEach(s => setBadge(s.id, status));
    };

    actions.saveAttendance = async function () {
        const date = document.getElementById('attendance-date')?.value;
        const teacher = dataManager.getCurrentTeacher();
        if (!teacher?.assigned_class) return modal.alert('No Class', 'You are not assigned to a class.', 'error');
        if (!date) return modal.alert('Choose a Day', 'Please choose the day you are marking.', 'warning');
        if (date > todayISO()) return modal.alert('Future Date', 'Attendance cannot be marked for a day that has not happened yet.', 'warning');

        const assigned = state.classes.find(c => c.id === teacher.assigned_class);
        const week = activeWeekFor(date);
        const rows = dataManager.getTeacherStudents().map(s => {
            const status = document.getElementById(`attendance-status-${s.id}`)?.dataset.status;
            return status ? {
                student_id: s.id, date, status,
                class: assigned ? buildClassName(assigned) : (s.class || ''),
                marked_by: state.currentUser?.full_name || 'Teacher',
                teacher_id: state.currentUser?.id,
                year_id: state.currentAY?.id || null,
                term_id: state.currentTerm?.id || null,
                week_id: week?.id || null,
            } : null;
        }).filter(Boolean);
        if (!rows.length) return modal.alert('Nothing to Save', 'Mark at least one student present or absent first.', 'warning');

        const btn = document.getElementById('attendance-save');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving…'; }
        try {
            const { data, error } = await supabaseClient.from('attendance')
                .upsert(rows, { onConflict: 'student_id,date' }).select('id');
            if (error) throw error;
            if (!data || data.length < rows.length) throw new Error('Some records were not saved. Please refresh and try again.');
            const unmarked = dataManager.getTeacherStudents().length - rows.length;
            ui.showToast(unmarked > 0 ? `Attendance saved (${unmarked} not marked)` : 'Attendance saved', 'success');
        } catch (err) {
            modal.alert('Error', 'Failed to save attendance: ' + extractErrorMessage(err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i> Save attendance'; }
        }
    };

    // ── Teacher: term summary ────────────────────────────────────────────────
    views.renderTeacherTotalAttendance = async function () {
        await freshTeacherData();
        const students = ordered(dataManager.getTeacherStudents());
        let records = [];
        if (students.length) {
            try {
                let q = supabaseClient.from('attendance').select('student_id, status, date')
                    .in('student_id', students.map(s => s.id));
                if (state.currentAY?.id) q = q.eq('year_id', state.currentAY.id);
                if (state.currentTerm?.id) q = q.eq('term_id', state.currentTerm.id);
                const { data, error } = await q;
                if (error) throw error;
                records = data || [];
            } catch (err) {
                console.warn('[attendance] summary load failed:', err);
            }
        }
        const rows = students.map(s => {
            const mine = records.filter(r => r.student_id === s.id);
            const present = mine.filter(r => r.status === 'present').length;
            const absent = mine.filter(r => r.status === 'absent').length;
            const total = present + absent;
            return { s, present, absent, rate: total ? Math.round(present / total * 100) : null };
        });
        const termName = state.currentTerm?.name ? `${esc(state.currentTerm.name)}, ${esc(state.currentAY?.year || '')}` : 'this term';
        const html = `
            <div class="mb-6">
                <h2 class="text-2xl font-bold text-slate-800 dark:text-white">Attendance Summary</h2>
                <p class="text-sm text-slate-500">${termName}</p>
            </div>
            <div class="glass-panel rounded-2xl overflow-hidden bg-white dark:bg-slate-800 shadow-lg">
                ${rows.length === 0 ? '<p class="p-8 text-center text-slate-500">No students assigned to your class</p>' : `
                <div class="overflow-x-auto">
                    <table class="w-full text-left min-w-[560px]">
                        <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                            <tr>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200">Student</th>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Present</th>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Absent</th>
                                <th class="px-6 py-4 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Rate</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                            ${rows.map(r => `
                            <tr>
                                <td class="px-6 py-4 font-semibold text-slate-800 dark:text-slate-200">${esc(nameOf(r.s))}</td>
                                <td class="px-6 py-4 text-center font-bold text-emerald-700 dark:text-emerald-400">${r.present}</td>
                                <td class="px-6 py-4 text-center font-bold text-red-600 dark:text-red-400">${r.absent}</td>
                                <td class="px-6 py-4 text-center font-bold ${r.rate === null ? 'text-slate-400' : r.rate >= 90 ? 'text-emerald-700 dark:text-emerald-400' : r.rate >= 75 ? 'text-amber-600' : 'text-red-600'}">${r.rate === null ? '—' : r.rate + '%'}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`}
            </div>`;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    };

    // ── Admin: view records ──────────────────────────────────────────────────
    views.renderAttendance = function () {
        const today = todayISO();
        const html = `
            <h2 class="text-2xl font-bold mb-6 text-slate-800 dark:text-white">Attendance Records</h2>
            <div class="glass-panel rounded-2xl p-6 mb-6 bg-white dark:bg-slate-800 shadow-lg">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label for="admin-attendance-date" class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Date</label>
                        <input type="date" id="admin-attendance-date" value="${today}" max="${today}" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
                    </div>
                    <div>
                        <label for="admin-attendance-class" class="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Class</label>
                        <select id="admin-attendance-class" class="input-field w-full rounded-xl px-4 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
                            <option value="">All classes</option>
                            ${state.classes.map(c => `<option value="${esc(c.id)}">${esc(buildClassName(c))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="flex items-end">
                        <button type="button" onclick="actions.loadAdminAttendance()" class="w-full px-6 py-3 bg-ridge-600 text-white rounded-xl font-bold btn-primary"><i class="fas fa-search mr-2"></i> View records</button>
                    </div>
                </div>
            </div>
            <div id="admin-attendance-results" class="glass-panel rounded-2xl p-6 bg-white dark:bg-slate-800 shadow-lg">
                <p class="text-center py-10 text-slate-500">Choose a date and class, then select View records.</p>
            </div>`;
        const container = document.getElementById('view-content');
        if (container) container.innerHTML = html;
    };

    actions.loadAdminAttendance = async function () {
        const date = document.getElementById('admin-attendance-date')?.value;
        const classId = document.getElementById('admin-attendance-class')?.value;
        const box = document.getElementById('admin-attendance-results');
        if (!date) return modal.alert('Choose a Date', 'Please choose a date.', 'warning');
        if (box) box.innerHTML = '<div class="space-y-2"><div class="rv-skel rounded-lg" style="height:40px"></div><div class="rv-skel rounded-lg" style="height:40px"></div><div class="rv-skel rounded-lg" style="height:40px"></div></div>';
        try {
            let q = supabaseClient.from('attendance').select('student_id, class, status, marked_by').eq('date', date);
            if (classId) {
                const ids = state.students.filter(s => s.class_id === classId).map(s => s.id);
                if (!ids.length) { if (box) box.innerHTML = '<p class="text-center py-10 text-slate-500">That class has no students.</p>'; return; }
                q = q.in('student_id', ids);
            }
            const { data, error } = await q;
            if (error) throw error;
            const rows = (data || []).map(a => {
                const st = state.students.find(s => s.id === a.student_id);
                const clsObj = st?.class_id ? state.classes.find(c => c.id === st.class_id) : null;
                return { ...a, name: st?.name || 'Unknown student', cls: clsObj ? buildClassName(clsObj) : a.class };
            }).sort((a, b) => (a.cls || '').localeCompare(b.cls || '') || a.name.localeCompare(b.name));
            if (!box) return;
            if (!rows.length) { box.innerHTML = '<p class="text-center py-10 text-slate-500">No attendance was marked for that day.</p>'; return; }
            const present = rows.filter(r => r.status === 'present').length;
            box.innerHTML = `
                <div class="overflow-x-auto">
                    <table class="w-full text-left min-w-[560px]">
                        <thead class="bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
                            <tr>
                                <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200">Student</th>
                                <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200">Class</th>
                                <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200 text-center">Status</th>
                                <th class="px-6 py-3 font-bold text-sm text-slate-700 dark:text-slate-200 text-right">Marked by</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                            ${rows.map(r => `
                            <tr>
                                <td class="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">${esc(r.name)}</td>
                                <td class="px-6 py-3 text-slate-700 dark:text-slate-300">${esc(r.cls || '')}</td>
                                <td class="px-6 py-3 text-center"><span class="px-3 py-1 rounded-full text-xs font-bold ${(badge[r.status] || badge.none)[0]}">${(badge[r.status] || badge.none)[1]}</span></td>
                                <td class="px-6 py-3 text-right text-sm text-slate-500">${esc(r.marked_by || '')}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <p class="mt-4 text-sm text-slate-600 dark:text-slate-400">Present: <strong>${present}</strong> · Absent: <strong>${rows.length - present}</strong> · Total: <strong>${rows.length}</strong></p>`;
        } catch (err) {
            if (box) box.innerHTML = '';
            modal.alert('Error', 'Failed to load attendance: ' + extractErrorMessage(err), 'error');
        }
    };

    // ── Routes ───────────────────────────────────────────────────────────────
    const RENDER = {
        attendance: () => views.renderAttendance(),
        teacher_attendance: () => views.renderTeacherAttendance(),
        teacher_total_attendance: () => views.renderTeacherTotalAttendance(),
    };
    const _route = ui.route.bind(ui);
    ui.route = function (view) {
        if (!RENDER[view]) return _route(view);
        if ((view === 'attendance') !== (state.role === 'admin') || !['admin', 'teacher'].includes(state.role)) {
            return _route(state.role === 'admin' ? 'overview' : 'teacher_dashboard');
        }
        state.currentView = view;
        const container = document.getElementById('view-content');
        if (container && !ui._keepPlace) {
            container.innerHTML = typeof window.rvSkeletonFor === 'function' ? window.rvSkeletonFor(view) : '';
            window.scrollTo(0, 0);
        }
        document.querySelectorAll('.sidebar-item').forEach(b =>
            b.classList.toggle('active', !!b.getAttribute('onclick')?.includes(`'${view}'`)));
        return Promise.resolve(RENDER[view]()).catch(err => console.error('[attendance] render failed:', err));
    };
})();
