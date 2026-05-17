// ============================================================
//  academic-report-generator.js
//  Ridgevalley Hybrid School Management System
//  Generates school-wide Academic Reports (Term & Year) as DOCX
// ============================================================

// ── Entry point called by app.js views.renderDataAnalysis() ──
function renderDataAnalysis() {
    const container = document.getElementById('view-content');
    if (!container) return;

    const years  = (typeof state !== 'undefined' && state.academicYears) || [];
    const ayOpts = years.map(y => `<option value="${y.id}">${y.year}</option>`).join('');

    container.innerHTML = `
        <div style="max-width:860px;margin:0 auto;padding:4px 0 40px;">

            <!-- Page header -->
            <div style="margin-bottom:28px;">
                <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;
                            color:var(--rv-navy,#0f2044);margin:0 0 4px;">
                    Data Analysis
                </h2>
                <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">
                    Generate professional school-wide academic reports for leadership review.
                </p>
            </div>

            <!-- Report mode cards -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;">
                ${_modeCard('term','fa-calendar-alt','Term Report',
                    'Analyse one term — enrollment, performance, attendance & recommendations.')}
                ${_modeCard('year','fa-chart-line','Yearly Report',
                    'Aggregate all three terms into a full-year strategic overview.')}
            </div>

            <!-- Configuration panel -->
            <div id="arg-config-panel"
                 style="background:var(--rv-surface,#ffffff);border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;margin-bottom:20px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">

                <h3 style="font-size:15px;font-weight:700;color:var(--rv-navy,#0f2044);
                            margin:0 0 18px;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-sliders-h" style="color:#1a56db;font-size:13px;"></i>
                    Report Configuration
                </h3>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
                    <!-- Academic year -->
                    <div>
                        <label style="display:block;font-size:12px;font-weight:600;
                                      color:var(--rv-muted,#64748b);margin-bottom:6px;
                                      text-transform:uppercase;letter-spacing:.5px;">
                            Academic Year
                        </label>
                        <select id="arg-year-sel"
                                onchange="argOnYearChange(this.value)"
                                style="width:100%;padding:10px 14px;border-radius:10px;
                                       border:1.5px solid var(--rv-border,#e2e8f0);
                                       background:var(--rv-bg,#f8fafc);
                                       color:var(--rv-text,#1e293b);font-size:14px;
                                       font-weight:500;outline:none;cursor:pointer;">
                            <option value="">— Select year —</option>
                            ${ayOpts}
                        </select>
                    </div>

                    <!-- Term (hidden in year mode) -->
                    <div id="arg-term-wrapper">
                        <label style="display:block;font-size:12px;font-weight:600;
                                      color:var(--rv-muted,#64748b);margin-bottom:6px;
                                      text-transform:uppercase;letter-spacing:.5px;">
                            Term
                        </label>
                        <select id="arg-term-sel"
                                style="width:100%;padding:10px 14px;border-radius:10px;
                                       border:1.5px solid var(--rv-border,#e2e8f0);
                                       background:var(--rv-bg,#f8fafc);
                                       color:var(--rv-text,#1e293b);font-size:14px;
                                       font-weight:500;outline:none;cursor:pointer;">
                            <option value="">— Select term —</option>
                        </select>
                    </div>
                </div>

                <!-- Generate button -->
                <button id="arg-generate-btn"
                        onclick="argGenerate()"
                        style="display:inline-flex;align-items:center;gap:10px;
                               padding:12px 28px;border-radius:12px;border:none;
                               background:linear-gradient(135deg,#1a56db,#1e40af);
                               color:#fff;font-size:14px;font-weight:700;
                               cursor:pointer;box-shadow:0 4px 12px rgba(26,86,219,.35);
                               transition:opacity .15s;">
                    <i class="fas fa-file-word"></i>
                    Generate Report
                </button>
            </div>

            <!-- Progress / status bar -->
            <div id="arg-progress"
                 style="display:none;background:var(--rv-surface,#fff);
                        border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;margin-bottom:20px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">
                <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
                    <div style="width:36px;height:36px;border:3px solid #1a56db;
                                border-top-color:transparent;border-radius:50%;
                                animation:spin .7s linear infinite;flex-shrink:0;"></div>
                    <div>
                        <p id="arg-progress-label"
                           style="font-weight:700;font-size:14px;
                                  color:var(--rv-navy,#0f2044);margin:0 0 2px;">
                            Analysing data…
                        </p>
                        <p id="arg-progress-sub"
                           style="font-size:12px;color:var(--rv-muted,#64748b);margin:0;">
                            Please wait
                        </p>
                    </div>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
                    <div id="arg-progress-bar"
                         style="height:100%;background:linear-gradient(90deg,#1a56db,#60a5fa);
                                border-radius:99px;width:0%;transition:width .4s ease;"></div>
                </div>
            </div>

            <!-- Preview panel -->
            <div id="arg-preview"
                 style="display:none;background:var(--rv-surface,#fff);
                        border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">
                <div style="display:flex;align-items:center;justify-content:space-between;
                             margin-bottom:20px;flex-wrap:wrap;gap:12px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:40px;height:40px;background:linear-gradient(135deg,#1a56db,#1e40af);
                                    border-radius:10px;display:flex;align-items:center;
                                    justify-content:center;">
                            <i class="fas fa-file-word" style="color:#fff;font-size:16px;"></i>
                        </div>
                        <div>
                            <p id="arg-preview-title"
                               style="font-weight:700;font-size:15px;
                                      color:var(--rv-navy,#0f2044);margin:0;"></p>
                            <p id="arg-preview-subtitle"
                               style="font-size:12px;color:var(--rv-muted,#64748b);margin:0;"></p>
                        </div>
                    </div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;">
                        <button id="arg-download-btn"
                                onclick="argDownload()"
                                style="display:inline-flex;align-items:center;gap:8px;
                                       padding:10px 22px;border-radius:10px;border:none;
                                       background:linear-gradient(135deg,#059669,#047857);
                                       color:#fff;font-size:13px;font-weight:700;
                                       cursor:pointer;box-shadow:0 4px 10px rgba(5,150,105,.3);">
                            <i class="fas fa-file-word"></i>
                            Download DOCX
                        </button>
                        <button id="arg-download-pdf-btn"
                                onclick="argDownloadPdf()"
                                style="display:inline-flex;align-items:center;gap:8px;
                                       padding:10px 22px;border-radius:10px;border:none;
                                       background:linear-gradient(135deg,#dc2626,#b91c1c);
                                       color:#fff;font-size:13px;font-weight:700;
                                       cursor:pointer;box-shadow:0 4px 10px rgba(220,38,38,.3);">
                            <i class="fas fa-file-pdf"></i>
                            Download PDF
                        </button>
                    </div>
                </div>
                <div id="arg-preview-body"
                     style="font-family:Georgia,serif;font-size:13.5px;
                            line-height:1.75;color:var(--rv-text,#1e293b);
                            max-height:520px;overflow-y:auto;padding-right:4px;"></div>
            </div>

        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;

    // Set active mode from stored selection (or default to term)
    const savedMode = window._argMode || 'term';
    argSetMode(savedMode);

    // Pre-select active academic year
    const activeYear = years.find(y => y.active);
    if (activeYear) {
        const sel = document.getElementById('arg-year-sel');
        if (sel) { sel.value = activeYear.id; argOnYearChange(activeYear.id); }
    }
}

// ── Mode card HTML ────────────────────────────────────────────
function _modeCard(mode, icon, title, desc) {
    return `
        <div id="arg-card-${mode}"
             onclick="argSetMode('${mode}')"
             style="border:2px solid var(--rv-border,#e2e8f0);border-radius:14px;
                    padding:20px;cursor:pointer;transition:all .15s;
                    background:var(--rv-surface,#fff);">
            <div style="width:40px;height:40px;border-radius:10px;
                        background:linear-gradient(135deg,#1a56db,#1e40af);
                        display:flex;align-items:center;justify-content:center;
                        margin-bottom:12px;">
                <i class="fas ${icon}" style="color:#fff;font-size:16px;"></i>
            </div>
            <p style="font-weight:700;font-size:14px;color:var(--rv-navy,#0f2044);
                       margin:0 0 4px;">${title}</p>
            <p style="font-size:12px;color:var(--rv-muted,#64748b);margin:0;
                       line-height:1.5;">${desc}</p>
        </div>`;
}

// ── Mode toggle ───────────────────────────────────────────────
function argSetMode(mode) {
    window._argMode = mode;

    ['term','year'].forEach(m => {
        const card = document.getElementById(`arg-card-${m}`);
        if (!card) return;
        if (m === mode) {
            card.style.borderColor = '#1a56db';
            card.style.background  = 'rgba(26,86,219,.06)';
        } else {
            card.style.borderColor = 'var(--rv-border,#e2e8f0)';
            card.style.background  = 'var(--rv-surface,#fff)';
        }
    });

    const termWrapper = document.getElementById('arg-term-wrapper');
    if (termWrapper) termWrapper.style.display = mode === 'term' ? 'block' : 'none';
}

// ── Year change → populate terms ─────────────────────────────
function argOnYearChange(yearId) {
    const termSel = document.getElementById('arg-term-sel');
    if (!termSel) return;
    const year = (state.academicYears || []).find(y => y.id === yearId);
    const terms = year?.terms || [];
    termSel.innerHTML = '<option value="">— Select term —</option>' +
        terms.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    // Auto-select active term
    const active = terms.find(t => t.active);
    if (active) termSel.value = active.id;
}

// ── Fetch school logo from Supabase ───────────────────────────
async function _argFetchSchoolLogo() {
    try {
        const { data, error } = await supabaseClient
            .from('school_settings')
            .select('logo_url')
            .limit(1)
            .single();
        if (error || !data?.logo_url) return null;
        return data.logo_url; // URL string
    } catch (e) {
        console.warn('Could not fetch school logo:', e);
        return null;
    }
}

// Convert a remote image URL → base64 data URI (for DOCX embedding)
async function _argLogoToBase64(url) {
    try {
        const res  = await fetch(url);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result); // "data:image/png;base64,..."
            reader.onerror   = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Could not load logo image:', e);
        return null;
    }
}

// ── Generate ──────────────────────────────────────────────────
async function argGenerate() {
    const yearId  = document.getElementById('arg-year-sel')?.value;
    const termId  = document.getElementById('arg-term-sel')?.value;
    const mode    = window._argMode || 'term';

    if (!yearId) { ui.showToast('Please select an academic year', 'error'); return; }
    if (mode === 'term' && !termId) { ui.showToast('Please select a term', 'error'); return; }

    const year = state.academicYears.find(y => y.id === yearId);
    if (!year) { ui.showToast('Academic year not found', 'error'); return; }

    _argShowProgress(true);
    _argSetProgress(5, 'Reading enrollment data…');

    try {
        let docx, fileName, previewHtml;

        // ── Fetch school logo once for both preview and DOCX ──
        const logoUrl    = await _argFetchSchoolLogo();
        const logoBase64 = logoUrl ? await _argLogoToBase64(logoUrl) : null;

        if (mode === 'term') {
            const term = year.terms?.find(t => t.id === termId);
            if (!term) throw new Error('Term not found');
            _argSetProgress(15, 'Analysing student records…');
            const data = _argCollectTermData(year, term);
            _argSetProgress(40, 'Computing class performance…');
            const analysis = _argAnalyseTerm(data);
            _argSetProgress(65, 'Writing executive narrative…');
            previewHtml = _argTermPreviewHtml(year, term, analysis, logoUrl);
            _argSetProgress(80, 'Building DOCX document…');
            docx       = await _argBuildTermDocx(year, term, analysis, logoBase64);
            fileName   = `Ridgevalley_Term_Report_${year.year}_${term.name.replace(/\s+/g,'_')}.docx`;
            window._argCurrentDocx = { blob: docx, name: fileName };

            document.getElementById('arg-preview-title').textContent =
                `${term.name} Academic Report — ${year.year}`;
            document.getElementById('arg-preview-subtitle').textContent =
                `Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`;

        } else {
            _argSetProgress(15, 'Loading all terms…');
            const allTerms = year.terms || [];
            _argSetProgress(30, 'Cross-term analysis…');
            const termDataArr = allTerms.map(t => ({ term: t, data: _argCollectTermData(year, t), analysis: _argAnalyseTerm(_argCollectTermData(year, t)) }));
            _argSetProgress(55, 'Computing yearly trends…');
            const yearlyAnalysis = _argAnalyseYear(year, termDataArr);
            _argSetProgress(75, 'Writing yearly narrative…');
            previewHtml = _argYearPreviewHtml(year, yearlyAnalysis, termDataArr, logoUrl);
            _argSetProgress(85, 'Building DOCX document…');
            docx       = await _argBuildYearDocx(year, yearlyAnalysis, termDataArr, logoBase64);
            fileName   = `Ridgevalley_Yearly_Report_${year.year}.docx`;
            window._argCurrentDocx = { blob: docx, name: fileName };

            document.getElementById('arg-preview-title').textContent =
                `Yearly Academic Report — ${year.year}`;
            document.getElementById('arg-preview-subtitle').textContent =
                `Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`;
        }

        _argSetProgress(100, 'Done!');
        await new Promise(r => setTimeout(r, 300));
        _argShowProgress(false);
        _argShowPreview(true, previewHtml);
        ui.showToast('Report generated successfully', 'success');

    } catch (err) {
        console.error('argGenerate error:', err);
        _argShowProgress(false);
        ui.showToast('Generation failed: ' + (err.message || err), 'error');
    }
}

function argDownload() {
    const d = window._argCurrentDocx;
    if (!d) return;
    saveAs(d.blob, d.name);
}

async function argDownloadPdf() {
    const previewBody = document.getElementById('arg-preview-body');
    if (!previewBody) { ui.showToast('No report to export', 'error'); return; }

    const btn = document.getElementById('arg-download-pdf-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating PDF…'; }

    try {
        // Build a self-contained print window
        const d = window._argCurrentDocx;
        const fileName = d ? d.name.replace('.docx', '.pdf') : 'Academic_Report.pdf';

        const printWin = window.open('', '_blank',
            'width=900,height=700,scrollbars=yes,resizable=yes');

        const style = `
            @page { size: A4; margin: 18mm 16mm; }
            body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt;
                   color: #1e293b; margin: 0; padding: 0; background: #fff; }
            h1 { font-size: 15pt; color: #0f2044; border-bottom: 2px solid #1a56db;
                 padding-bottom: 5px; margin-top: 22pt; margin-bottom: 8pt; }
            h3 { font-size: 13pt; color: #0f2044; border-bottom: 1.5px solid #1a56db;
                 padding-bottom: 4px; margin-top: 18pt; margin-bottom: 6pt; }
            p  { line-height: 1.7; margin: 0 0 8pt; }
            table { width: 100%; border-collapse: collapse; font-size: 10pt;
                    margin: 8pt 0 12pt; page-break-inside: avoid; }
            th { background: #1a56db; color: #fff; padding: 6pt 8pt;
                 font-weight: bold; text-align: left; }
            td { padding: 5pt 8pt; border: 1px solid #cbd5e1; }
            tr:nth-child(even) td { background: #f8fafc; }
            .kpi-row { display: flex; gap: 10pt; margin: 8pt 0; }
            .kpi-box { flex: 1; background: #f1f5f9; border-radius: 6pt;
                       padding: 8pt; text-align: center; min-width: 70pt; }
            .kpi-label { font-size: 9pt; color: #64748b; margin: 0 0 2pt; }
            .kpi-val   { font-size: 16pt; font-weight: 800; color: #0f2044; margin: 0; }
            .sig-block { page-break-inside: avoid; }
            @media print { .no-print { display: none !important; } }
        `;

        printWin.document.write(`<!DOCTYPE html><html><head>
            <meta charset="UTF-8">
            <title>${fileName.replace('.pdf','')}</title>
            <style>${style}</style>
        </head><body>
            <div class="no-print" style="background:#1a56db;color:#fff;padding:12px 20px;
                 display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <span style="font-weight:700;">🖨 Use your browser's Print dialog → Save as PDF</span>
                <button onclick="window.print()"
                    style="background:#fff;color:#1a56db;border:none;padding:8px 20px;
                           border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                    Print / Save as PDF
                </button>
            </div>
            ${previewBody.innerHTML}
        </body></html>`);
        printWin.document.close();

        // Trigger print after content loads
        printWin.onload = () => {
            setTimeout(() => { printWin.focus(); printWin.print(); }, 400);
        };

        ui.showToast('PDF window opened — use Print → Save as PDF', 'success');
    } catch (err) {
        console.error('PDF export error:', err);
        ui.showToast('PDF export failed: ' + (err.message || err), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-pdf"></i> Download PDF'; }
    }
}

// ── UI helpers ────────────────────────────────────────────────
function _argShowProgress(show) {
    const p = document.getElementById('arg-progress');
    const b = document.getElementById('arg-generate-btn');
    const v = document.getElementById('arg-preview');
    if (p) p.style.display = show ? 'block' : 'none';
    if (b) b.disabled = show;
    if (show && v) v.style.display = 'none';
}
function _argSetProgress(pct, label, sub) {
    const bar = document.getElementById('arg-progress-bar');
    const lbl = document.getElementById('arg-progress-label');
    const sl  = document.getElementById('arg-progress-sub');
    if (bar) bar.style.width = pct + '%';
    if (lbl && label) lbl.textContent = label;
    if (sl  && sub)   sl.textContent  = sub;
}
function _argShowPreview(show, html) {
    const panel = document.getElementById('arg-preview');
    if (!panel) return;
    panel.style.display = show ? 'block' : 'none';
    if (html) {
        const body = document.getElementById('arg-preview-body');
        if (body) body.innerHTML = html;
    }
}

// ══════════════════════════════════════════════════════════════
//  DATA COLLECTION
// ══════════════════════════════════════════════════════════════

function _argCollectTermData(year, term) {
    const students   = state.students   || [];
    const teachers   = state.teachers   || [];
    const classes    = state.classes    || [];
    const attendance = state.attendance || [];
    const reports    = state.reports    || [];
    const receivedReports = state.receivedReports || [];
    const transactions = state.transactions || [];
    const fees       = state.fees       || [];

    // Filter reports for this term
    const termReports = reports.filter(r =>
        (!r.year_id || r.year_id === year.id) &&
        (!r.term_id || r.term_id === term.id));

    // Filter attendance for this term
    const termAttendance = attendance.filter(a =>
        (!a.year_id || a.year_id === year.id) &&
        (!a.term_id || a.term_id === term.id));

    // Received bundles for this term
    const termBundles = receivedReports.filter(b =>
        (!b.year_id || b.year_id === year.id) &&
        (!b.term_id || b.term_id === term.id));

    // Confirmed payments this term
    const termPayments = transactions.filter(t =>
        t.status === 'confirmed' &&
        (!t.year_id || t.year_id === year.id) &&
        (!t.term_id || t.term_id === term.id));

    // Fees defined for this term
    const termFees = fees.filter(f =>
        (!f.year_id || f.year_id === year.id) &&
        (!f.term_id || f.term_id === term.id));

    return {
        year, term,
        students, teachers, classes,
        termReports, termAttendance, termBundles,
        termPayments, termFees, transactions
    };
}

// ══════════════════════════════════════════════════════════════
//  ANALYSIS ENGINE
// ══════════════════════════════════════════════════════════════

function _argAnalyseTerm(d) {
    const { term, students, teachers, classes, termReports,
            termAttendance, termBundles, termPayments, termFees, transactions } = d;

    // ── Enrollment ──
    const totalStudents = students.length;
    const genderM = students.filter(s => (s.gender || '').toLowerCase().startsWith('m')).length;
    const genderF = students.filter(s => (s.gender || '').toLowerCase().startsWith('f')).length;

    // Group by class
    const byClass = {};
    students.forEach(s => {
        const cls = s.class || 'Unknown';
        byClass[cls] = (byClass[cls] || []);
        byClass[cls].push(s);
    });

    // ── Enrollment by school level ──
    const levelMap = {
        'Creche': [], 'Nursery': [], 'KG': [],
        'Lower Primary': [], 'Upper Primary': [], 'Other': []
    };
    students.forEach(s => {
        const cls = (s.class || s.class_name || '').toLowerCase();
        if (cls.includes('creche') || cls.includes('crèche')) levelMap['Creche'].push(s);
        else if (cls.includes('nursery') || cls.includes('nurse')) levelMap['Nursery'].push(s);
        else if (cls.includes('kg') || cls.includes('kindergarten') || cls.includes('kinder')) levelMap['KG'].push(s);
        else if (cls.includes('primary 1') || cls.includes('p1') ||
                 cls.includes('primary 2') || cls.includes('p2') ||
                 cls.includes('primary 3') || cls.includes('p3')) levelMap['Lower Primary'].push(s);
        else if (cls.includes('primary 4') || cls.includes('p4') ||
                 cls.includes('primary 5') || cls.includes('p5') ||
                 cls.includes('primary 6') || cls.includes('p6')) levelMap['Upper Primary'].push(s);
        else levelMap['Other'].push(s);
    });

    // New admissions (students admitted this term)
    const termStart = term.start_date ? new Date(term.start_date) : null;
    const termEnd   = term.end_date   ? new Date(term.end_date)   : null;
    const newAdmissions = students.filter(s => {
        if (!s.admission_date && !s.created_at) return false;
        const d = new Date(s.admission_date || s.created_at);
        if (termStart && termEnd) return d >= termStart && d <= termEnd;
        return false;
    });
    const transfers = students.filter(s =>
        (s.status || '').toLowerCase().includes('transfer') ||
        (s.exit_reason || '').toLowerCase().includes('transfer'));

    // Gender not recorded
    const genderUnknown = students.filter(s => {
        const g = (s.gender || '').toLowerCase();
        return !g.startsWith('m') && !g.startsWith('f');
    }).length;


    const attByStudent = {};
    termAttendance.forEach(a => {
        if (!attByStudent[a.student_id]) attByStudent[a.student_id] = { present: 0, absent: 0 };
        if (a.status === 'present') attByStudent[a.student_id].present++;
        else attByStudent[a.student_id].absent++;
    });
    const attRates = Object.values(attByStudent).map(r => {
        const total = r.present + r.absent;
        return total > 0 ? (r.present / total) * 100 : null;
    }).filter(v => v !== null);
    const avgAttendance = attRates.length > 0 ?
        Math.round(attRates.reduce((a, b) => a + b, 0) / attRates.length) : 0;
    const chronicAbsentee = attRates.filter(r => r < 75).length;

    // Per-class attendance
    const classAttendance = {};
    termAttendance.forEach(a => {
        const cls = a.class || 'Unknown';
        if (!classAttendance[cls]) classAttendance[cls] = { present: 0, absent: 0 };
        if (a.status === 'present') classAttendance[cls].present++;
        else classAttendance[cls].absent++;
    });
    const classAttendanceRates = Object.entries(classAttendance).map(([cls, r]) => {
        const total = r.present + r.absent;
        return { class: cls, rate: total > 0 ? Math.round((r.present / total) * 100) : 0, total };
    }).sort((a, b) => b.rate - a.rate);

    // ── Report coverage / teacher compliance ──
    const totalTeachers = teachers.length;
    const submittedTeachers = [...new Set(termBundles.map(b => b.teacher_id))].length;
    const reviewedBundles   = termBundles.filter(b => b.status === 'reviewed').length;
    const complianceRate    = totalTeachers > 0
        ? Math.round((submittedTeachers / totalTeachers) * 100) : 0;

    // ── Report counts per class ──
    const reportsPerClass = {};
    termReports.forEach(r => {
        const cls = r.class || 'Unknown';
        reportsPerClass[cls] = (reportsPerClass[cls] || 0) + 1;
    });

    // ── Fee collection ──
    const totalExpected = students.reduce((sum, s) => {
        const applicableFees = termFees.filter(f => {
            if (!f.class_level) return true;
            return (s.class || '').startsWith(f.class_level);
        });
        return sum + applicableFees.reduce((fs, f) => fs + (parseFloat(f.amount) || 0), 0);
    }, 0);
    const totalCollected = termPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const collectionRate = totalExpected > 0
        ? Math.round((totalCollected / totalExpected) * 100) : 0;

    // Students with arrears (at least one pending txn)
    const studentsWithArrears = [...new Set(
        transactions.filter(t => t.status === 'pending').map(t => t.student_id)
    )].length;

    // ── Class-teacher map ──
    const classTeacherMap = {};
    teachers.forEach(t => {
        if (t.assigned_class) {
            const cls = classes.find(c => c.id === t.assigned_class);
            if (cls) classTeacherMap[`${cls.level} - ${cls.grade}`] = t.full_name || t.email;
        }
    });

    // ── Build class performance summary ──
    // We infer "performance" from report coverage since we don't store scores centrally
    const classPerformance = Object.keys(byClass).map(cls => {
        const clsStudents = byClass[cls].length;
        const clsReports  = reportsPerClass[cls] || 0;
        const clsAtt      = classAttendanceRates.find(a => a.class === cls);
        const attRate     = clsAtt ? clsAtt.rate : 'N/A';
        const teacher     = classTeacherMap[cls] || 'Not Assigned';
        const bundleStatus = termBundles.find(b => b.class === cls)?.status || 'not submitted';
        return { cls, clsStudents, clsReports, attRate, teacher, bundleStatus };
    }).sort((a, b) => (typeof b.attRate === 'number' ? b.attRate : 0) -
                      (typeof a.attRate === 'number' ? a.attRate : 0));

    // ── Automatic narrative flags ──
    const flags = [];
    if (avgAttendance < 80) flags.push({ type: 'warning', msg: 'School-wide attendance is below the 80% benchmark.' });
    if (chronicAbsentee > totalStudents * 0.1) flags.push({ type: 'warning', msg: `${chronicAbsentee} students have chronic absenteeism (below 75% attendance).` });
    if (complianceRate < 80) flags.push({ type: 'warning', msg: `Teacher report submission compliance is low at ${complianceRate}%.` });

    if (totalStudents === 0) flags.push({ type: 'info', msg: 'No student records found for this period.' });

    const strengths = [];
    if (avgAttendance >= 90) strengths.push('Excellent school-wide attendance rate.');
    if (complianceRate === 100) strengths.push('Full teacher report submission compliance achieved.');


    // ── Academic Performance from exam reports ──
    // termReports may contain score fields: subject, score/mark/percentage, student_id, class
    const subjectScores = {}; // { subjectName: [scores] }
    const classScores   = {}; // { className: [scores] }
    let totalScoreSum = 0, totalScoreCount = 0;
    let studentsAbove80 = new Set(), studentsBelow50 = new Set();

    const termReportsFull = d.termReports || [];
    termReportsFull.forEach(r => {
        const rawScore = parseFloat(r.score ?? r.mark ?? r.percentage ?? r.average ?? NaN);
        if (isNaN(rawScore)) return;
        const score = rawScore > 1 && rawScore <= 100 ? rawScore
            : rawScore > 0 && rawScore <= 1 ? rawScore * 100 : null;
        if (score === null) return;

        const subj = r.subject || r.subject_name || 'General';
        const cls  = r.class   || r.class_name  || 'Unknown';
        const sid  = r.student_id;

        if (!subjectScores[subj]) subjectScores[subj] = [];
        subjectScores[subj].push(score);
        if (!classScores[cls]) classScores[cls] = [];
        classScores[cls].push(score);

        totalScoreSum += score; totalScoreCount++;
        if (sid) {
            if (score >= 80) studentsAbove80.add(sid);
            if (score < 50)  studentsBelow50.add(sid);
        }
    });

    const schoolAvg = totalScoreCount > 0
        ? Math.round(totalScoreSum / totalScoreCount) : null;
    const overallPassCount = totalScoreCount > 0
        ? termReportsFull.filter(r => {
              const s = parseFloat(r.score ?? r.mark ?? r.percentage ?? r.average ?? NaN);
              return !isNaN(s) && (s > 1 ? s : s*100) >= 50;
          }).length : 0;
    const overallPassRate = totalScoreCount > 0
        ? Math.round((overallPassCount / totalScoreCount) * 100) : null;

    // Subject summary
    const subjectPerformance = Object.entries(subjectScores).map(([subj, scores]) => {
        const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
        const passRate = Math.round((scores.filter(s=>s>=50).length / scores.length)*100);
        const status = avg >= 75 ? 'Strong' : avg >= 60 ? 'Good' : avg >= 50 ? 'Fair' : 'Needs Attention';
        return { subj, avg, passRate, count: scores.length, status };
    }).sort((a,b) => b.avg - a.avg);

    // Class performance summary
    const classScoreSummary = Object.entries(classScores).map(([cls, scores]) => {
        const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
        const passRate = Math.round((scores.filter(s=>s>=50).length / scores.length)*100);
        return { cls, avg, passRate, count: scores.length };
    }).sort((a,b) => b.avg - a.avg);

    const bestClass  = classScoreSummary[0] || null;
    const worstClass = classScoreSummary[classScoreSummary.length-1] || null;
    const bestSubj   = subjectPerformance[0] || null;
    const worstSubj  = subjectPerformance[subjectPerformance.length-1] || null;

    // Promotion readiness: flag classes with passRate < 60% as needing review
    const promotionFlags = classScoreSummary.filter(c => c.passRate < 60).map(c => c.cls);

    if (schoolAvg !== null && schoolAvg < 60)
        flags.push({ type: 'warning', msg: `School-wide academic average is ${schoolAvg}% — below the 60% performance benchmark.` });
    if (worstSubj && worstSubj.avg < 50)
        flags.push({ type: 'warning', msg: `${worstSubj.subj} recorded a school-wide average of ${worstSubj.avg}% — the weakest-performing subject this term.` });
    if (promotionFlags.length)
        flags.push({ type: 'warning', msg: `Classes with low pass rates requiring promotion review: ${promotionFlags.join(', ')}.` });

    if (schoolAvg !== null && schoolAvg >= 70) strengths.push(`Strong overall academic average of ${schoolAvg}% school-wide.`);
    if (bestSubj && bestSubj.avg >= 75) strengths.push(`${bestSubj.subj} achieved the highest school-wide average at ${bestSubj.avg}%.`);

    return {
        totalStudents, genderM, genderF,
        byClass, totalClasses: Object.keys(byClass).length,
        avgAttendance, chronicAbsentee,
        classAttendanceRates,
        totalTeachers, submittedTeachers, reviewedBundles, complianceRate,
        reportsPerClass, termReports: termReports.length,
        totalCollected, totalExpected, collectionRate, studentsWithArrears,
        classTeacherMap, classPerformance,
        // academic performance
        schoolAvg, overallPassRate,
        studentsAbove80: studentsAbove80.size, studentsBelow50: studentsBelow50.size,
        subjectPerformance, classScoreSummary, bestClass, worstClass, bestSubj, worstSubj,
        promotionFlags,
        // enrollment detail
        levelMap, newAdmissions: newAdmissions.length, transfers: transfers.length,
        genderUnknown,
        flags, strengths
    };
}

function _argAnalyseYear(year, termDataArr) {
    const terms = termDataArr.map(td => ({
        name: td.term.name,
        analysis: td.analysis
    }));

    // Yearly averages
    const avgAttendances = terms.map(t => t.analysis.avgAttendance).filter(v => v > 0);
    const yearAvgAttendance = avgAttendances.length
        ? Math.round(avgAttendances.reduce((a,b)=>a+b,0) / avgAttendances.length) : 0;

    const complianceRates = terms.map(t => t.analysis.complianceRate);
    const yearAvgCompliance = complianceRates.length
        ? Math.round(complianceRates.reduce((a,b)=>a+b,0) / complianceRates.length) : 0;

    const totalCollected = terms.reduce((s,t) => s + t.analysis.totalCollected, 0);
    const totalExpected  = terms.reduce((s,t) => s + t.analysis.totalExpected,  0);
    const yearCollectionRate = totalExpected > 0
        ? Math.round((totalCollected / totalExpected) * 100) : 0;

    // Attendance trend
    const attTrend = avgAttendances.length >= 2
        ? (avgAttendances[avgAttendances.length-1] > avgAttendances[0] ? 'Improving'
         : avgAttendances[avgAttendances.length-1] < avgAttendances[0] ? 'Declining' : 'Stable')
        : 'Stable';

    // Enrollment stability (use last term)
    const lastAnalysis = terms.length ? terms[terms.length-1].analysis : null;

    return { terms, yearAvgAttendance, yearAvgCompliance, attTrend,
             totalCollected, totalExpected, yearCollectionRate, lastAnalysis };
}

// ══════════════════════════════════════════════════════════════
//  HTML PREVIEW BUILDERS
// ══════════════════════════════════════════════════════════════

function _argTermPreviewHtml(year, term, a, logoUrl) {
    const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const school = 'Ridgevalley Hybrid School';
    const logoHtml = logoUrl
        ? `<img src="${logoUrl}" alt="School Logo"
               style="width:72px;height:72px;object-fit:contain;border-radius:8px;
                      margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
        : `<div style="width:60px;height:60px;background:linear-gradient(135deg,#1a56db,#1e40af);
                        border-radius:50%;display:inline-flex;align-items:center;
                        justify-content:center;margin-bottom:12px;">
               <i class="fas fa-graduation-cap" style="color:#fff;font-size:24px;"></i>
           </div>`;

    return `
        ${_pvSection('Cover', `
            <div style="text-align:center;padding:20px 0 10px;">
                ${logoHtml}
                <h1 style="font-size:20px;font-weight:800;margin:0 0 4px;color:#0f2044;">${school}</h1>
                <p style="font-size:14px;color:#64748b;margin:0 0 8px;">General Academic Report</p>
                <p style="font-size:13px;font-weight:700;color:#1a56db;margin:0;">
                    ${term.name} · Academic Year ${year.year}
                </p>
                <p style="font-size:11px;color:#94a3b8;margin-top:6px;">Generated: ${date}</p>
            </div>`)}

        ${_pvSection('1. Executive Summary', _termExecutiveSummary(year, term, a))}
        ${_pvSection('2. Enrollment & Student Population', _termEnrollmentHtml(a))}
        ${_pvSection('3. Academic Performance Analysis', _termAcademicPerformanceHtml(a))}
        ${_pvSection('4. Student Development & Behaviour', _termStudentDevelopmentHtml(a))}
        ${_pvSection('5. Attendance Analysis', _termAttendanceHtml(a))}
        ${_pvSection('6. Teacher & Class Performance', _termTeacherHtml(a))}
        ${_pvSection('7. Challenges Identified', _challengesHtml(a.flags))}
        ${_pvSection('8. Strengths & Commendations', _strengthsHtml(a.strengths))}
        ${_pvSection('9. Recommendations', _termRecommendationsHtml(a))}
        ${_pvSection('10. Conclusion', _termConclusionHtml(year, term, a))}
        ${_pvSignatureBlock()}
    `;
}

function _argYearPreviewHtml(year, ya, termDataArr, logoUrl) {
    const date = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const school = 'Ridgevalley Hybrid School';
    const logoHtml = logoUrl
        ? `<img src="${logoUrl}" alt="School Logo"
               style="width:72px;height:72px;object-fit:contain;border-radius:8px;
                      margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
        : `<div style="width:60px;height:60px;background:linear-gradient(135deg,#1a56db,#1e40af);
                        border-radius:50%;display:inline-flex;align-items:center;
                        justify-content:center;margin-bottom:12px;">
               <i class="fas fa-graduation-cap" style="color:#fff;font-size:24px;"></i>
           </div>`;

    return `
        ${_pvSection('Cover', `
            <div style="text-align:center;padding:20px 0 10px;">
                ${logoHtml}
                <h1 style="font-size:20px;font-weight:800;margin:0 0 4px;color:#0f2044;">${school}</h1>
                <p style="font-size:14px;color:#64748b;margin:0 0 8px;">Annual Academic Report</p>
                <p style="font-size:13px;font-weight:700;color:#1a56db;margin:0;">
                    Academic Year ${year.year}
                </p>
                <p style="font-size:11px;color:#94a3b8;margin-top:6px;">Generated: ${date}</p>
            </div>`)}

        ${_pvSection('1. Executive Summary', _yearExecutiveSummary(year, ya, termDataArr))}
        ${_pvSection('2. Enrollment & Population Trends', _yearEnrollmentTrendHtml(termDataArr))}
        ${_pvSection('3. Yearly Academic Performance Trends', _yearAcademicPerformanceTrendHtml(termDataArr))}
        ${_pvSection('4. Yearly Attendance Trends', _yearAttendanceTrendHtml(ya))}
        ${_pvSection('5. Term-by-Term Overview', _yearTermOverviewHtml(termDataArr))}
        ${_pvSection('6. Promotion & Transition Analysis', _yearPromotionHtml(termDataArr))}
        ${_pvSection('7. Yearly Achievements', _yearAchievementsHtml(ya, termDataArr))}
        ${_pvSection('8. Yearly Challenges', _yearChallengesHtml(ya, termDataArr))}
        ${_pvSection('9. Strategic Recommendations for Next Year', _yearRecommendationsHtml(ya, termDataArr))}
        ${_pvSection('10. Conclusion', _yearConclusionHtml(year, ya))}
        ${_pvSignatureBlock()}
    `;
}

// ── Preview section wrapper ───────────────────────────────────
function _pvSection(title, body) {
    return `
        <div style="margin-bottom:24px;border-bottom:1px solid #e2e8f0;padding-bottom:20px;">
            <h3 style="font-family:Georgia,serif;font-size:15px;font-weight:700;
                        color:#0f2044;margin:0 0 12px;padding-bottom:6px;
                        border-bottom:2px solid #1a56db;">
                ${title}
            </h3>
            <div style="font-size:13px;line-height:1.75;color:#334155;">${body}</div>
        </div>`;
}

// ── Narrative fragments ───────────────────────────────────────
function _termExecutiveSummary(year, term, a) {
    const attNote = a.avgAttendance >= 90 ? `an excellent average attendance rate of ${a.avgAttendance}%`
        : a.avgAttendance >= 80 ? `an acceptable average attendance rate of ${a.avgAttendance}%`
        : `a below-benchmark average attendance rate of ${a.avgAttendance}%`;

    const compNote = a.complianceRate === 100 ? 'All teaching staff submitted their class reports in full.'
        : a.complianceRate >= 80 ? `The majority of teaching staff (${a.complianceRate}%) submitted their class reports.`
        : `Teacher report submission compliance requires urgent attention, currently standing at ${a.complianceRate}%.`;

    return `
        <p>This report presents a comprehensive academic intelligence overview for <strong>${term.name}</strong> of the <strong>${year.year}</strong> academic year at Ridgevalley Hybrid School. It is intended to support leadership decision-making, strategic planning, and operational improvement.</p>
        <p>During this term, the school enrolled a total of <strong>${a.totalStudents} students</strong> across <strong>${a.totalClasses} classes</strong>, supported by <strong>${a.totalTeachers} members of teaching staff</strong>. The school recorded ${attNote}.</p>
        <p>${compNote}</p>
        ${a.flags.length > 0 ? `<p>The analysis identified <strong>${a.flags.length} area(s) of concern</strong> requiring leadership attention, as detailed in subsequent sections.</p>` : '<p>No critical operational concerns were identified for this period.</p>'}
    `;
}

function _termEnrollmentHtml(a) {
    const rows = Object.entries(a.byClass).map(([cls, students]) =>
        `<tr><td style="${_tdS}">${cls}</td><td style="${_tdS}">${students.length}</td>
         <td style="${_tdS}">${students.filter(s=>(s.gender||'').toLowerCase().startsWith('m')).length}</td>
         <td style="${_tdS}">${students.filter(s=>(s.gender||'').toLowerCase().startsWith('f')).length}</td></tr>`
    ).join('');

    // Level breakdown
    const levelRows = Object.entries(a.levelMap || {})
        .filter(([,arr]) => arr.length > 0)
        .map(([lvl, arr]) =>
            `<tr><td style="${_tdS}">${lvl}</td><td style="${_tdS}">${arr.length}</td></tr>`
        ).join('');

    const adm = a.newAdmissions || 0;
    const trf = a.transfers || 0;

    return `
        <p>Total enrollment: <strong>${a.totalStudents} students</strong> 
           (Male: <strong>${a.genderM}</strong> / Female: <strong>${a.genderF}</strong>
           ${a.genderUnknown > 0 ? ` / Gender not recorded: ${a.genderUnknown}` : ''}).
        </p>
        ${levelRows ? `<p><strong>Distribution by School Level:</strong></p>
        ${_table(['Level', 'Students'], levelRows)}` : ''}
        ${_table(['Class', 'Total Students', 'Male', 'Female'], rows)}
        ${adm > 0 ? `<p><strong>${adm} new student(s)</strong> were admitted during the term.</p>` : ''}
        ${trf > 0 ? `<p><strong>${trf} student(s)</strong> transferred out or were withdrawn during the term.</p>` : ''}
    `;
}

// ── 3. Academic Performance Analysis ─────────────────────────
function _termAcademicPerformanceHtml(a) {
    if (a.schoolAvg === null) {
        return `<p>No exam score data has been recorded in the system for this term. 
        Academic performance analysis will appear here once scores are entered.</p>`;
    }

    // 3.1 Overall performance indicators
    const kpis = _kpiRow([
        { label: 'School Average', val: a.schoolAvg + '%' },
        { label: 'Overall Pass Rate', val: (a.overallPassRate ?? 'N/A') + (a.overallPassRate != null ? '%' : '') },
        { label: 'Students Above 80%', val: a.studentsAbove80 },
        { label: 'Students Below 50%', val: a.studentsBelow50 }
    ]);

    const avgNote = a.schoolAvg >= 70 ? 'satisfactory' : a.schoolAvg >= 60 ? 'fair' : 'below expectation';
    const bestCls  = a.bestClass  ? `<strong>${a.bestClass.cls}</strong> (avg: ${a.bestClass.avg}%)` : '—';
    const worstCls = a.worstClass ? `<strong>${a.worstClass.cls}</strong> (avg: ${a.worstClass.avg}%)` : '—';

    // 3.2 Subject performance
    const subjRows = a.subjectPerformance.map(s =>
        `<tr><td style="${_tdS}">${s.subj}</td>
         <td style="${_tdS}">${s.avg}%</td>
         <td style="${_tdS}">${s.passRate}%</td>
         <td style="${_tdS}">${s.status}</td></tr>`
    ).join('');

    // 3.3 Class performance
    const clsRows = a.classScoreSummary.map(c =>
        `<tr><td style="${_tdS}">${c.cls}</td>
         <td style="${_tdS}">${c.avg}%</td>
         <td style="${_tdS}">${c.passRate}%</td>
         <td style="${_tdS}">${c.avg >= 75 ? '✓ Strong' : c.avg >= 60 ? 'Satisfactory' : '⚠ Below Target'}</td></tr>`
    ).join('');

    return `
        <h4 style="margin:8px 0 4px;color:#0f2044;">3.1 Overall School Performance</h4>
        ${kpis}
        <p>Overall academic performance for the term was <em>${avgNote}</em>, with a school-wide average 
        of <strong>${a.schoolAvg}%</strong>. 
        ${a.bestClass ? `${bestCls} emerged as the strongest-performing class, while ${worstCls} recorded the lowest average scores.` : ''}
        ${a.overallPassRate !== null ? ` Approximately <strong>${a.overallPassRate}%</strong> of students achieved pass-level performance (50% and above).` : ''}
        </p>
        ${a.subjectPerformance.length > 0 ? `
        <h4 style="margin:14px 0 4px;color:#0f2044;">3.2 Subject Performance</h4>
        ${_table(['Subject', 'Average Score', 'Pass Rate', 'Status'], subjRows)}
        <p>${a.bestSubj ? `<strong>${a.bestSubj.subj}</strong> was the strongest-performing subject with an average of ${a.bestSubj.avg}%.` : ''}
        ${a.worstSubj && a.worstSubj.avg < 60 ? ` <strong>${a.worstSubj.subj}</strong> recorded the lowest average at ${a.worstSubj.avg}% and may require targeted intervention.` : ''}</p>
        ` : ''}
        ${a.classScoreSummary.length > 0 ? `
        <h4 style="margin:14px 0 4px;color:#0f2044;">3.3 Performance by Class</h4>
        ${_table(['Class', 'Average Score', 'Pass Rate', 'Status'], clsRows)}
        ` : ''}
    `;
}

// ── 4. Student Development & Behaviour ───────────────────────
function _termStudentDevelopmentHtml(a) {
    // Preschool levels detection
    const hasPreschool = a.levelMap &&
        (a.levelMap['Creche'].length + a.levelMap['Nursery'].length + a.levelMap['KG'].length) > 0;
    const hasUpperPrimary = a.levelMap &&
        a.levelMap['Upper Primary'].length > 0;

    const attendanceNote = a.avgAttendance >= 85
        ? 'Class participation improved across most classes, reflecting positive student engagement.'
        : 'Class participation requires monitoring in some classes, as evidenced by attendance patterns.';

    return `
        <p><strong>Conduct:</strong> The majority of students demonstrated good classroom behaviour, 
        respect for teachers, and positive peer interaction throughout the term. 
        ${hasUpperPrimary ? 'A small number of behavioural incidents were reported in Upper Primary and have been addressed by class teachers.' : ''}</p>

        <p><strong>Participation:</strong> ${attendanceNote}</p>

        ${hasPreschool ? `<p><strong>Preschool Development (Creche, Nursery & KG):</strong> 
        Early childhood learners showed continued development in communication skills, 
        motor coordination, social interaction, and classroom routines. Teachers report 
        progressive growth in attention span and cooperative play.</p>` : ''}

        ${hasUpperPrimary ? `<p><strong>Leadership & Social Maturity:</strong> 
        Several students in Upper Primary demonstrated leadership potential, academic responsibility, 
        and mature peer-support behaviour, which is commendable at this stage of development.</p>` : ''}

        <p><strong>Homework & Academic Habits:</strong> Homework completion was 
        ${a.overallPassRate !== null && a.overallPassRate >= 75 ? 'generally consistent across most classes.' 
          : 'inconsistent in some classes, which may have contributed to performance gaps. Teachers are encouraged to monitor submission rates and communicate expectations clearly to parents.'}</p>
    `;
}

function _termAttendanceHtml(a) {
    const best    = a.classAttendanceRates[0];
    const worst   = a.classAttendanceRates[a.classAttendanceRates.length - 1];
    const attNote = a.avgAttendance >= 90 ? 'commendable' : a.avgAttendance >= 80 ? 'adequate' : 'below expectation';

    const rows = a.classAttendanceRates.map(r =>
        `<tr><td style="${_tdS}">${r.class}</td>
         <td style="${_tdS}">${r.rate}%</td>
         <td style="${_tdS}">${r.rate>=90?'✓ Excellent':r.rate>=80?'Acceptable':'⚠ Below Benchmark'}</td></tr>`
    ).join('');

    return `
        <p>The school-wide average attendance for this term was <strong>${a.avgAttendance}%</strong> — considered <em>${attNote}</em> relative to the 80% operational benchmark.</p>
        ${best ? `<p>The class with the highest attendance was <strong>${best.class}</strong> (${best.rate}%)${worst && worst.class !== best.class ? `, while <strong>${worst.class}</strong> recorded the lowest at ${worst.rate}%` : ''}.` : ''}
        ${a.chronicAbsentee > 0 ? `<p><strong>${a.chronicAbsentee} student(s)</strong> recorded chronic absenteeism (attendance below 75%), warranting follow-up from class teachers and school counsellors.</p>` : '<p>No students were flagged for chronic absenteeism during this period.</p>'}
        ${rows ? _table(['Class', 'Attendance Rate', 'Status'], rows) : ''}
    `;
}

function _termTeacherHtml(a) {
    const rows = a.classPerformance.map(cp =>
        `<tr>
            <td style="${_tdS}">${cp.cls}</td>
            <td style="${_tdS}">${cp.teacher}</td>
            <td style="${_tdS}">${cp.clsStudents}</td>
            <td style="${_tdS}">${cp.clsReports}</td>
            <td style="${_tdS}">${typeof cp.attRate === 'number' ? cp.attRate+'%' : 'N/A'}</td>
            <td style="${_tdS}">${_bundleStatusLabel(cp.bundleStatus)}</td>
         </tr>`
    ).join('');

    return `
        <p>Of <strong>${a.totalTeachers}</strong> teaching staff, <strong>${a.submittedTeachers}</strong> submitted class report bundles — a compliance rate of <strong>${a.complianceRate}%</strong>. 
        <strong>${a.reviewedBundles}</strong> bundle(s) have been reviewed and approved by administration.</p>
        ${rows ? _table(['Class', 'Class Teacher', 'Students', 'Reports Uploaded', 'Attendance', 'Submission Status'], rows) : ''}
    `;
}

function _challengesHtml(flags) {
    if (!flags.length) return '<p>No critical challenges were identified during this review period.</p>';
    return flags.map((f,i) =>
        `<p><strong>${i+1}.</strong> ${f.msg}</p>`
    ).join('');
}

function _strengthsHtml(strengths) {
    if (!strengths.length) return '<p>Performance data will be elaborated as more records are entered into the system.</p>';
    return strengths.map((s,i) => `<p><strong>${i+1}.</strong> ${s}</p>`).join('');
}

function _termRecommendationsHtml(a) {
    const recs = [];
    if (a.avgAttendance < 80) recs.push('Implement targeted attendance improvement strategies including parent engagement letters, home visits for chronically absent students, and class-level attendance awards.');
    if (a.complianceRate < 100) recs.push(`Follow up with ${a.totalTeachers - a.submittedTeachers} teacher(s) who have not submitted class report bundles. Consider establishing clear submission deadlines with consequences for non-compliance.`);

    if (a.chronicAbsentee > a.totalStudents * 0.1) recs.push('Refer chronically absent students to the school counsellor and establish a structured re-engagement programme.');
    recs.push('Conduct a mid-term academic review to track progress against targets set at the beginning of the term.');
    recs.push('Ensure all class data is fully recorded in the system to enable richer analysis in future report cycles.');
    return recs.map((r,i) => `<p><strong>${i+1}.</strong> ${r}</p>`).join('');
}

function _termConclusionHtml(year, term, a) {
    return `
        <p>${term.name} of the ${year.year} academic year reflects ${a.totalStudents > 0 ? 'an active and engaged student body' : 'early-stage records entry'}. The school's leadership is encouraged to use this report as a foundation for evidence-based planning and resource allocation in subsequent terms.</p>
        <p>Continued commitment to data accuracy within the school management system will significantly enhance the quality of future academic intelligence reports.</p>
        <p style="margin-top:16px;font-style:italic;color:#64748b;">
            — Generated by Ridgevalley Hybrid School Management System &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-GB')}
        </p>
    `;
}

// ── Signature & Date block ────────────────────────────────────
function _pvSignatureBlock() {
    return `
        <div style="margin-top:48px;padding-top:24px;border-top:1px solid #e2e8f0;">
            <p style="font-size:12px;color:#64748b;margin-bottom:32px;">
                This report has been reviewed and approved by school leadership.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;max-width:560px;">
                <div>
                    <div style="border-bottom:2px solid #0f2044;height:50px;margin-bottom:8px;"></div>
                    <p style="font-size:12px;font-weight:700;color:#0f2044;margin:0;">Head Teacher / Principal</p>
                    <p style="font-size:11px;color:#64748b;margin:2px 0 0;">Signature &amp; Stamp</p>
                </div>
                <div>
                    <div style="border-bottom:2px solid #0f2044;height:50px;margin-bottom:8px;"></div>
                    <p style="font-size:12px;font-weight:700;color:#0f2044;margin:0;">Date</p>
                    <p style="font-size:11px;color:#64748b;margin:2px 0 0;">DD / MM / YYYY</p>
                </div>
            </div>
        </div>`;
}

// ── Year: Enrollment trend ────────────────────────────────────
function _yearEnrollmentTrendHtml(termDataArr) {
    const rows = termDataArr.map(td =>
        `<tr><td style="${_tdS}">${td.term.name}</td>
         <td style="${_tdS}">${td.analysis.totalStudents}</td>
         <td style="${_tdS}">${td.analysis.genderM}</td>
         <td style="${_tdS}">${td.analysis.genderF}</td>
         <td style="${_tdS}">${td.analysis.newAdmissions || 0}</td>
         <td style="${_tdS}">${td.analysis.transfers || 0}</td></tr>`
    ).join('');
    const lastA = termDataArr.length ? termDataArr[termDataArr.length-1].analysis : null;
    const firstA = termDataArr.length ? termDataArr[0].analysis : null;
    const growth = lastA && firstA ? lastA.totalStudents - firstA.totalStudents : 0;
    return `
        <p>Enrollment ${growth > 0 ? `grew by <strong>${growth} student(s)</strong>` : growth < 0 ? `declined by <strong>${Math.abs(growth)} student(s)</strong>` : 'remained stable'} over the course of the academic year.</p>
        ${_table(['Term', 'Total Students', 'Male', 'Female', 'New Admissions', 'Transfers/Withdrawals'], rows)}
    `;
}

// ── Year: Academic Performance Trends ────────────────────────
function _yearAcademicPerformanceTrendHtml(termDataArr) {
    // Build subject × term matrix
    const allSubjects = [...new Set(termDataArr.flatMap(td =>
        td.analysis.subjectPerformance.map(s => s.subj)))];

    if (allSubjects.length === 0) {
        return `<p>No subject-level score data is recorded in the system. 
        This section will populate automatically as exam scores are entered.</p>`;
    }

    // Build trend table: subject | T1 avg | T2 avg | T3 avg | Year avg | Trend
    const termNames = termDataArr.map(td => td.term.name);
    const headers = ['Subject', ...termNames, 'Year Avg', 'Trend'];
    const subjectRows = allSubjects.map(subj => {
        const termAvgs = termDataArr.map(td => {
            const sp = td.analysis.subjectPerformance.find(s => s.subj === subj);
            return sp ? sp.avg : null;
        });
        const validAvgs = termAvgs.filter(v => v !== null);
        const yearAvg = validAvgs.length
            ? Math.round(validAvgs.reduce((a,b)=>a+b,0) / validAvgs.length) : null;
        const trend = validAvgs.length >= 2
            ? (validAvgs[validAvgs.length-1] > validAvgs[0] ? '↑ Improving'
             : validAvgs[validAvgs.length-1] < validAvgs[0] ? '↓ Declining' : '→ Stable')
            : '—';
        const cells = [subj, ...termAvgs.map(v => v !== null ? v+'%' : '—'),
                       yearAvg !== null ? yearAvg+'%' : '—', trend];
        return `<tr>${cells.map(c=>`<td style="${_tdS}">${c}</td>`).join('')}</tr>`;
    }).join('');

    // Overall school avg per term
    const overallRow = (() => {
        const termAvgs = termDataArr.map(td => td.analysis.schoolAvg);
        const validAvgs = termAvgs.filter(v => v !== null);
        const yearAvg = validAvgs.length
            ? Math.round(validAvgs.reduce((a,b)=>a+b,0) / validAvgs.length) : null;
        const trend = validAvgs.length >= 2
            ? (validAvgs[validAvgs.length-1] > validAvgs[0] ? '↑ Improving'
             : validAvgs[validAvgs.length-1] < validAvgs[0] ? '↓ Declining' : '→ Stable')
            : '—';
        const cells = ['<strong>Overall School</strong>',
            ...termAvgs.map(v => v !== null ? `<strong>${v}%</strong>` : '—'),
            yearAvg !== null ? `<strong>${yearAvg}%</strong>` : '—', trend];
        return `<tr style="background:#f1f5f9;">${cells.map(c=>`<td style="${_tdS}">${c}</td>`).join('')}</tr>`;
    })();

    const improvingSubjects = allSubjects.filter(subj => {
        const avgs = termDataArr.map(td => {
            const sp = td.analysis.subjectPerformance.find(s => s.subj === subj);
            return sp ? sp.avg : null;
        }).filter(v=>v!==null);
        return avgs.length >= 2 && avgs[avgs.length-1] > avgs[0];
    });

    return `
        <p>The table below tracks subject-level academic performance across all terms of the academic year.</p>
        <div style="overflow-x:auto;margin:10px 0;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr>${headers.map(h=>`<th style="${_thS}">${h}</th>`).join('')}</tr></thead>
                <tbody>${subjectRows}${overallRow}</tbody>
            </table>
        </div>
        ${improvingSubjects.length > 0 ? `<p>Subjects showing consistent improvement across the year: <strong>${improvingSubjects.join(', ')}</strong>.</p>` : ''}
    `;
}

// ── Year: Promotion & Transition Analysis ─────────────────────
function _yearPromotionHtml(termDataArr) {
    // Use last term's class score summary for promotion readiness
    const lastA = termDataArr.length ? termDataArr[termDataArr.length-1].analysis : null;
    if (!lastA || !lastA.classScoreSummary.length) {
        return `<p>Promotion analysis will be available once end-of-year exam scores are recorded in the system.</p>`;
    }

    const rows = lastA.classScoreSummary.map(c => {
        const status = c.passRate >= 80 ? '✓ Ready for Promotion'
            : c.passRate >= 60 ? 'Review Required'
            : '⚠ Intervention Needed';
        const repeating = c.passRate < 60
            ? `Est. ${Math.round(c.count * (1 - c.passRate/100))} student(s)`
            : '—';
        return `<tr>
            <td style="${_tdS}">${c.cls}</td>
            <td style="${_tdS}">${c.passRate}%</td>
            <td style="${_tdS}">${repeating}</td>
            <td style="${_tdS}">${status}</td>
        </tr>`;
    }).join('');

    const readyCount  = lastA.classScoreSummary.filter(c=>c.passRate>=80).length;
    const reviewCount = lastA.classScoreSummary.filter(c=>c.passRate>=60 && c.passRate<80).length;
    const atRiskCount = lastA.classScoreSummary.filter(c=>c.passRate<60).length;

    return `
        <p>Promotion readiness is assessed based on end-of-year pass rates. 
        <strong>${readyCount} class(es)</strong> are ready for promotion, 
        <strong>${reviewCount}</strong> require individual review, and 
        <strong>${atRiskCount}</strong> have been flagged for academic intervention before progression.</p>
        ${_table(['Class', 'Pass Rate', 'Est. Repeating', 'Promotion Status'], rows)}
        <p>The Head Teacher should review individual student records for classes flagged as "Intervention Needed" 
        before issuing end-of-year promotion decisions.</p>
    `;
}

// ── Year: Achievements ────────────────────────────────────────
function _yearAchievementsHtml(ya, termDataArr) {
    const achievements = [];

    if (ya.yearAvgAttendance >= 90) achievements.push(`Outstanding school-wide attendance averaging ${ya.yearAvgAttendance}% for the full academic year.`);
    else if (ya.yearAvgAttendance >= 80) achievements.push(`Maintained an acceptable attendance average of ${ya.yearAvgAttendance}% throughout the academic year.`);

    if (ya.yearAvgCompliance === 100) achievements.push('Full teacher report submission compliance achieved across all three terms — a significant operational milestone.');
    else if (ya.yearAvgCompliance >= 85) achievements.push(`Strong teacher report submission compliance averaging ${ya.yearAvgCompliance}% across all terms.`);

    // Enrollment growth
    const firstA = termDataArr.length ? termDataArr[0].analysis : null;
    const lastA  = termDataArr.length ? termDataArr[termDataArr.length-1].analysis : null;
    if (firstA && lastA && lastA.totalStudents > firstA.totalStudents) {
        achievements.push(`Student enrollment grew from ${firstA.totalStudents} to ${lastA.totalStudents} students over the course of the year.`);
    }

    // Subject improvements
    const improvingSubjects = [];
    const allSubjects = [...new Set(termDataArr.flatMap(td =>
        td.analysis.subjectPerformance.map(s => s.subj)))];
    allSubjects.forEach(subj => {
        const avgs = termDataArr.map(td => {
            const sp = td.analysis.subjectPerformance.find(s => s.subj === subj);
            return sp ? sp.avg : null;
        }).filter(v=>v!==null);
        if (avgs.length >= 2 && avgs[avgs.length-1] - avgs[0] >= 5) improvingSubjects.push(subj);
    });
    if (improvingSubjects.length > 0) {
        achievements.push(`Significant academic improvement recorded in: ${improvingSubjects.join(', ')}.`);
    }



    if (!achievements.length) achievements.push('Data for yearly achievements will be more detailed as more records are completed in the system.');

    return achievements.map((a,i) => `<p><strong>${i+1}.</strong> ${a}</p>`).join('');
}
function _yearExecutiveSummary(year, ya, termDataArr) {
    const termCount = termDataArr.length;
    const lastA = ya.lastAnalysis;
    return `
        <p>This Annual Academic Report provides a consolidated strategic overview of the <strong>${year.year}</strong> academic year at Ridgevalley Hybrid School. The report aggregates data across <strong>${termCount} term(s)</strong> to present a comprehensive picture of academic performance, enrollment trends, attendance, and operational compliance.</p>
        <p>The school maintained a yearly average attendance rate of <strong>${ya.yearAvgAttendance}%</strong> — a <strong>${ya.attTrend}</strong> trend compared to the start of the year. Teacher report submission compliance averaged <strong>${ya.yearAvgCompliance}%</strong> across all terms.</p>
        ${lastA ? `<p>At year-end, the school was serving <strong>${lastA.totalStudents} students</strong> across <strong>${lastA.totalClasses} classes</strong>, supported by <strong>${lastA.totalTeachers} teaching staff</strong>.</p>` : ''}
    `;
}

function _yearAttendanceTrendHtml(ya) {
    const rows = ya.terms.map(t =>
        `<tr><td style="${_tdS}">${t.name}</td>
         <td style="${_tdS}">${t.analysis.avgAttendance}%</td>
         <td style="${_tdS}">${t.analysis.chronicAbsentee}</td>
         <td style="${_tdS}">${t.analysis.avgAttendance>=90?'Excellent':t.analysis.avgAttendance>=80?'Acceptable':'Below Benchmark'}</td></tr>`
    ).join('');
    return `
        <p>Attendance trend direction: <strong>${ya.attTrend}</strong>.</p>
        ${_table(['Term', 'Avg Attendance', 'Chronic Absentees', 'Status'], rows)}
    `;
}

function _yearTermOverviewHtml(termDataArr) {
    const rows = termDataArr.map(td =>
        `<tr>
            <td style="${_tdS}">${td.term.name}</td>
            <td style="${_tdS}">${td.analysis.totalStudents}</td>
            <td style="${_tdS}">${td.analysis.avgAttendance}%</td>
            <td style="${_tdS}">${td.analysis.complianceRate}%</td>
            <td style="${_tdS}">${td.analysis.termReports}</td>
         </tr>`
    ).join('');
    return `
        <p>The table below summarises key metrics across all terms for the academic year.</p>
        ${_table(['Term','Enrollment','Attendance','Report Compliance','Reports Uploaded'], rows)}
    `;
}



function _yearChallengesHtml(ya, termDataArr) {
    const challenges = [];
    if (ya.yearAvgAttendance < 80) challenges.push(`Attendance averaged below the 80% benchmark throughout the year (${ya.yearAvgAttendance}%), indicating a systemic challenge requiring a school-wide intervention strategy.`);
    if (ya.yearAvgCompliance < 80) challenges.push(`Teacher report submission compliance averaged ${ya.yearAvgCompliance}% for the year. This requires policy enforcement and accountability measures.`);

    if (!challenges.length) challenges.push('No persistent systemic challenges were identified across the full academic year. This reflects sound operational management.');
    return challenges.map((c,i) => `<p><strong>${i+1}.</strong> ${c}</p>`).join('');
}

function _yearRecommendationsHtml(ya, termDataArr) {
    const recs = [
        'Conduct a comprehensive end-of-year staff performance review, using attendance compliance and report submission data as key indicators.',
        'Develop a strategic enrollment plan to maintain or grow student numbers in the coming academic year, informed by termly demographic data.',
        'Invest in professional development programmes for teaching staff, with emphasis on data-driven classroom management and differentiated instruction.',
        'Establish a formal student welfare committee to monitor chronic absenteeism and academic risk factors proactively.',
        'Improve system data entry discipline to ensure future reports capture richer analytics including subject-level performance trends.'
    ];
    return recs.map((r,i) => `<p><strong>${i+1}.</strong> ${r}</p>`).join('');
}

function _yearConclusionHtml(year, ya) {
    return `
        <p>The ${year.year} academic year represents a period of continued development for Ridgevalley Hybrid School. This Annual Report captures the key dimensions of school performance and operations to guide leadership planning for the year ahead.</p>
        <p>The school is encouraged to build on its strengths — particularly in areas where targets were met — while pursuing purposeful improvement strategies in areas of identified weakness. Data-informed leadership remains central to the school's mission of excellence.</p>
        <p style="margin-top:16px;font-style:italic;color:#64748b;">
            — Generated by Ridgevalley Hybrid School Management System &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-GB')}
        </p>
    `;
}

// ── Shared HTML helpers ───────────────────────────────────────
const _tdS = 'padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;';
const _thS = 'padding:8px 10px;background:#1a56db;color:#fff;font-size:12px;font-weight:700;text-align:left;';

function _table(headers, rows) {
    if (!rows) return '';
    return `
        <div style="overflow-x:auto;margin:10px 0;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                    <tr>${headers.map(h=>`<th style="${_thS}">${h}</th>`).join('')}</tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function _kpiRow(items) {
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;">
        ${items.map(k=>`
            <div style="flex:1;min-width:120px;background:#f1f5f9;border-radius:10px;
                        padding:12px 14px;text-align:center;">
                <p style="font-size:11px;color:#64748b;margin:0 0 4px;">${k.label}</p>
                <p style="font-size:18px;font-weight:800;color:#0f2044;margin:0;">${k.val}</p>
            </div>`).join('')}
    </div>`;
}

function _bundleStatusLabel(status) {
    const map = {
        'reviewed':       '✓ Approved',
        'pending_review': '⏳ Pending',
        'rejected':       '✗ Rejected',
        'not submitted':  '— Not Submitted'
    };
    return map[status] || status;
}

function _fmt(n) {
    return Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ══════════════════════════════════════════════════════════════
//  DOCX BUILDER  (via JSZip — no external lib needed)
// ══════════════════════════════════════════════════════════════

async function _argBuildTermDocx(year, term, a, logoBase64 = null) {
    const title  = `${term.name} Academic Report — ${year.year}`;
    const school = 'Ridgevalley Hybrid School';
    const date   = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

    const sections = [
        _docxCover(school, `General Academic Report — ${term.name}`, year.year, date),
        _docxH1('1. Executive Summary'),
        _docxNarrative(_stripTags(_termExecutiveSummary(year, term, a))),
        _docxH1('2. Enrollment & Student Population'),
        _docxNarrative(`Total enrollment: ${a.totalStudents} students (Male: ${a.genderM} / Female: ${a.genderF}${a.genderUnknown > 0 ? ` / Gender not recorded: ${a.genderUnknown}` : ''}).`),
        _docxLevelTable(a.levelMap || {}),
        _docxClassEnrollTable(a.byClass),
        ...(a.newAdmissions > 0 ? [_docxNarrative(`${a.newAdmissions} new student(s) were admitted during the term.`)] : []),
        ...(a.transfers > 0 ? [_docxNarrative(`${a.transfers} student(s) transferred out or were withdrawn during the term.`)] : []),
        _docxH1('3. Academic Performance Analysis'),
        ..._docxAcademicPerformanceSections(a),
        _docxH1('4. Student Development & Behaviour'),
        _docxNarrative(_stripTags(_termStudentDevelopmentHtml(a))),
        _docxH1('5. Attendance Analysis'),
        _docxNarrative(`School-wide average attendance: ${a.avgAttendance}%. Chronic absentees: ${a.chronicAbsentee}.`),
        _docxAttTable(a.classAttendanceRates),
        _docxH1('6. Teacher & Class Performance'),
        _docxNarrative(`${a.submittedTeachers} of ${a.totalTeachers} teachers submitted reports (${a.complianceRate}% compliance). ${a.reviewedBundles} bundle(s) reviewed.`),
        _docxTeacherTable(a.classPerformance),
        _docxH1('7. Challenges Identified'),
        ...(a.flags.length ? a.flags.map((f,i) => _docxBullet(`${i+1}. ${f.msg}`)) : [_docxNarrative('No critical challenges identified.')]),
        _docxH1('8. Strengths & Commendations'),
        ...(a.strengths.length ? a.strengths.map((s,i)=>_docxBullet(`${i+1}. ${s}`)) : [_docxNarrative('Performance data will be elaborated as more records are entered.')]),
        _docxH1('9. Recommendations'),
        ..._termRecsArr(a).map((r,i) => _docxBullet(`${i+1}. ${r}`)),
        _docxH1('10. Conclusion'),
        _docxNarrative(_stripTags(_termConclusionHtml(year, term, a))),
        _docxSignatureBlock(),
    ];

    return _buildDocx(school, title, sections, logoBase64);
}

async function _argBuildYearDocx(year, ya, termDataArr, logoBase64 = null) {
    const school = 'Ridgevalley Hybrid School';
    const date   = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});

    const sections = [
        _docxCover(school, `Annual Academic Report`, year.year, date),
        _docxH1('1. Executive Summary'),
        _docxNarrative(_stripTags(_yearExecutiveSummary(year, ya, termDataArr))),
        _docxH1('2. Enrollment & Population Trends'),
        _docxNarrative(_stripTags(_yearEnrollmentTrendHtml(termDataArr))),
        _docxYearEnrollTable(termDataArr),
        _docxH1('3. Yearly Academic Performance Trends'),
        _docxYearSubjectTrendTable(termDataArr),
        _docxH1('4. Yearly Attendance Trends'),
        _docxAttTrendTable(ya.terms),
        _docxH1('5. Term-by-Term Overview'),
        _docxTermOverviewTable(termDataArr),
        _docxH1('6. Promotion & Transition Analysis'),
        _docxNarrative(_stripTags(_yearPromotionHtml(termDataArr))),
        _docxPromotionTable(termDataArr),
        _docxH1('7. Yearly Achievements'),
        ..._yearAchievementsArr(ya, termDataArr).map((a,i)=>_docxBullet(`${i+1}. ${a}`)),
        _docxH1('8. Yearly Challenges'),
        ..._yearChallengesArr(ya, termDataArr).map((c,i)=>_docxBullet(`${i+1}. ${c}`)),
        _docxH1('9. Strategic Recommendations for Next Year'),
        ..._yearRecsArr().map((r,i)=>_docxBullet(`${i+1}. ${r}`)),
        _docxH1('10. Conclusion'),
        _docxNarrative(_stripTags(_yearConclusionHtml(year, ya))),
        _docxSignatureBlock(),
    ];

    return _buildDocx(school, `Annual Report — ${year.year}`, sections, logoBase64);
}

// ── DOCX element constructors ─────────────────────────────────
function _docxCover(school, subtitle, yearStr, date) {
    // Logo image paragraph — rendered by _buildDocx when logoBase64 is available;
    // the placeholder is replaced with actual DrawingML by _buildDocx.
    const logoPlaceholder = `
        <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="360" w:after="160"/></w:pPr>
            <w:r><w:rPr><w:noProof/></w:rPr>
            <w:drawing>
                <wp:inline distT="0" distB="0" distL="0" distR="0">
                    <wp:extent cx="914400" cy="914400"/>
                    <wp:docPr id="1" name="SchoolLogo"/>
                    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                                <pic:nvPicPr>
                                    <pic:cNvPr id="1" name="SchoolLogo"/>
                                    <pic:cNvPicPr/>
                                </pic:nvPicPr>
                                <pic:blipFill>
                                    <a:blip r:embed="rIdLogo"/>
                                    <a:stretch><a:fillRect/></a:stretch>
                                </pic:blipFill>
                                <pic:spPr>
                                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                                </pic:spPr>
                            </pic:pic>
                        </a:graphicData>
                    </a:graphic>
                </wp:inline>
            </w:drawing></w:r></w:p>`;

    return `
        ${logoPlaceholder}
        <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120"/></w:pPr>
            <w:r><w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="0F2044"/></w:rPr>
            <w:t>${_xe(school)}</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="32"/><w:color w:val="1A56DB"/></w:rPr>
            <w:t>${_xe(subtitle)}</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="28"/><w:color w:val="334155"/></w:rPr>
            <w:t>Academic Year ${_xe(String(yearStr))}</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="64748B"/></w:rPr>
            <w:t>Generated: ${_xe(date)}</w:t></w:r></w:p>
        <w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>`;
}

function _docxH1(text) {
    return `
        <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="360" w:after="120"/></w:pPr>
            <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="0F2044"/></w:rPr>
            <w:t>${_xe(text)}</w:t></w:r></w:p>`;
}

function _docxNarrative(text) {
    // Split by double newline into paragraphs
    return text.split(/\n\n+/).map(para => para.trim()).filter(Boolean).map(para =>
        `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr>
            <w:t xml:space="preserve">${_xe(para.replace(/\n/g,' '))}</w:t></w:r></w:p>`
    ).join('');
}

function _docxBullet(text) {
    return `<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr>
        <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr>
        <w:t xml:space="preserve">${_xe(text)}</w:t></w:r></w:p>`;
}

// ── Signature block (DOCX) ────────────────────────────────────
function _docxSignatureBlock() {
    return `
        <w:p><w:pPr><w:spacing w:before="480"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="20"/><w:color w:val="64748B"/><w:i/></w:rPr>
            <w:t>This report has been reviewed and approved by school leadership.</w:t></w:r></w:p>
        <w:tbl>
            <w:tblPr>
                <w:tblW w:w="8800" w:type="dxa"/>
                <w:tblBorders>
                    <w:top w:val="none"/><w:left w:val="none"/>
                    <w:bottom w:val="none"/><w:right w:val="none"/>
                    <w:insideH w:val="none"/><w:insideV w:val="none"/>
                </w:tblBorders>
            </w:tblPr>
            <w:tr>
                <w:tc>
                    <w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:spacing w:before="800"/></w:pPr>
                        <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="0F2044"/></w:rPr>
                        <w:t>Head Teacher / Principal</w:t></w:r></w:p>
                    <w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="12" w:space="1" w:color="0F2044"/></w:pBdr></w:pPr>
                        <w:r><w:rPr><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr>
                        <w:t>Signature &amp; Stamp</w:t></w:r></w:p>
                </w:tc>
                <w:tc>
                    <w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr>
                    <w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>
                </w:tc>
                <w:tc>
                    <w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>
                    <w:p><w:pPr><w:spacing w:before="800"/></w:pPr>
                        <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="0F2044"/></w:rPr>
                        <w:t>Date</w:t></w:r></w:p>
                    <w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="12" w:space="1" w:color="0F2044"/></w:pBdr></w:pPr>
                        <w:r><w:rPr><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr>
                        <w:t>DD / MM / YYYY</w:t></w:r></w:p>
                </w:tc>
            </w:tr>
        </w:tbl>
        <w:p/>`;
}

// ── Level breakdown table (DOCX) ──────────────────────────────
function _docxLevelTable(levelMap) {
    const entries = Object.entries(levelMap).filter(([,arr]) => arr.length > 0);
    if (!entries.length) return '';
    const rows = entries.map(([lvl, arr]) => _docxTR([lvl, String(arr.length)]));
    return _docxTable(['Level', 'Students'], rows);
}

// ── Academic performance DOCX sections ────────────────────────
function _docxAcademicPerformanceSections(a) {
    if (a.schoolAvg === null) {
        return [_docxNarrative('No exam score data recorded for this term. Scores must be entered in the system to generate this section.')];
    }
    const parts = [];
    parts.push(_docxNarrative(`3.1 Overall School Performance\nSchool average: ${a.schoolAvg}%. Pass rate: ${a.overallPassRate ?? 'N/A'}%. Students above 80%: ${a.studentsAbove80}. Students below 50%: ${a.studentsBelow50}.${a.bestClass ? ` Strongest class: ${a.bestClass.cls} (${a.bestClass.avg}%).` : ''}${a.worstClass ? ` Lowest class: ${a.worstClass.cls} (${a.worstClass.avg}%).` : ''}`));
    if (a.subjectPerformance.length > 0) {
        parts.push(_docxNarrative('3.2 Subject Performance'));
        const rows = a.subjectPerformance.map(s => _docxTR([s.subj, s.avg+'%', s.passRate+'%', s.status]));
        parts.push(_docxTable(['Subject', 'Average', 'Pass Rate', 'Status'], rows));
    }
    if (a.classScoreSummary.length > 0) {
        parts.push(_docxNarrative('3.3 Performance by Class'));
        const rows = a.classScoreSummary.map(c =>
            _docxTR([c.cls, c.avg+'%', c.passRate+'%',
                     c.avg >= 75 ? 'Strong' : c.avg >= 60 ? 'Satisfactory' : 'Below Target']));
        parts.push(_docxTable(['Class', 'Average', 'Pass Rate', 'Status'], rows));
    }
    return parts;
}

// ── Year enrollment table (DOCX) ─────────────────────────────
function _docxYearEnrollTable(termDataArr) {
    const rows = termDataArr.map(td =>
        _docxTR([td.term.name, String(td.analysis.totalStudents),
                 String(td.analysis.genderM), String(td.analysis.genderF),
                 String(td.analysis.newAdmissions || 0), String(td.analysis.transfers || 0)]));
    return _docxTable(['Term', 'Students', 'Male', 'Female', 'New', 'Transfers'], rows);
}

// ── Year subject trend table (DOCX) ──────────────────────────
function _docxYearSubjectTrendTable(termDataArr) {
    const allSubjects = [...new Set(termDataArr.flatMap(td =>
        td.analysis.subjectPerformance.map(s => s.subj)))];
    if (!allSubjects.length) return _docxNarrative('No subject score data recorded.');

    const termNames = termDataArr.map(td => td.term.name);
    const headers = ['Subject', ...termNames, 'Year Avg', 'Trend'];
    const rows = allSubjects.map(subj => {
        const termAvgs = termDataArr.map(td => {
            const sp = td.analysis.subjectPerformance.find(s => s.subj === subj);
            return sp ? sp.avg : null;
        });
        const valid = termAvgs.filter(v => v !== null);
        const yearAvg = valid.length ? Math.round(valid.reduce((a,b)=>a+b,0)/valid.length) : null;
        const trend = valid.length >= 2
            ? (valid[valid.length-1] > valid[0] ? '↑ Improving'
             : valid[valid.length-1] < valid[0] ? '↓ Declining' : '→ Stable') : '—';
        return _docxTR([subj, ...termAvgs.map(v=>v!==null?v+'%':'—'),
                        yearAvg!==null?yearAvg+'%':'—', trend]);
    });
    return _docxTable(headers, rows);
}

// ── Promotion table (DOCX) ────────────────────────────────────
function _docxPromotionTable(termDataArr) {
    const lastA = termDataArr.length ? termDataArr[termDataArr.length-1].analysis : null;
    if (!lastA || !lastA.classScoreSummary.length) return '';
    const rows = lastA.classScoreSummary.map(c => {
        const status = c.passRate >= 80 ? 'Ready for Promotion'
            : c.passRate >= 60 ? 'Review Required' : 'Intervention Needed';
        const repeating = c.passRate < 60
            ? `Est. ${Math.round(c.count*(1-c.passRate/100))}` : '—';
        return _docxTR([c.cls, c.passRate+'%', repeating, status]);
    });
    return _docxTable(['Class', 'Pass Rate', 'Est. Repeating', 'Promotion Status'], rows);
}

// ── Achievements array helper ─────────────────────────────────
function _yearAchievementsArr(ya, termDataArr) {
    const achievements = [];
    if (ya.yearAvgAttendance >= 90) achievements.push(`Outstanding attendance averaging ${ya.yearAvgAttendance}% for the academic year.`);
    else if (ya.yearAvgAttendance >= 80) achievements.push(`Maintained acceptable attendance average of ${ya.yearAvgAttendance}%.`);
    if (ya.yearAvgCompliance === 100) achievements.push('Full teacher report submission compliance achieved across all terms.');
    else if (ya.yearAvgCompliance >= 85) achievements.push(`Strong teacher compliance averaging ${ya.yearAvgCompliance}%.`);
    const firstA = termDataArr.length ? termDataArr[0].analysis : null;
    const lastA  = termDataArr.length ? termDataArr[termDataArr.length-1].analysis : null;
    if (firstA && lastA && lastA.totalStudents > firstA.totalStudents)
        achievements.push(`Enrollment grew from ${firstA.totalStudents} to ${lastA.totalStudents} students.`);

    if (!achievements.length) achievements.push('Continued operation and service to the school community throughout the academic year.');
    return achievements;
}

// ── DOCX table helpers ────────────────────────────────────────
function _docxClassEnrollTable(byClass) {
    const rows = Object.entries(byClass).map(([cls, students]) => {
        const m = students.filter(s=>(s.gender||'').toLowerCase().startsWith('m')).length;
        const f = students.filter(s=>(s.gender||'').toLowerCase().startsWith('f')).length;
        return _docxTR([cls, String(students.length), String(m), String(f)]);
    });
    return _docxTable(['Class','Total','Male','Female'], rows);
}

function _docxAttTable(rates) {
    const rows = rates.map(r =>
        _docxTR([r.class, r.rate+'%', r.rate>=90?'Excellent':r.rate>=80?'Acceptable':'Below Benchmark']));
    return _docxTable(['Class','Attendance Rate','Status'], rows);
}

function _docxTeacherTable(cp) {
    const rows = cp.map(c =>
        _docxTR([c.cls, c.teacher, String(c.clsStudents), String(c.clsReports),
                 typeof c.attRate === 'number' ? c.attRate+'%' : 'N/A',
                 _bundleStatusLabel(c.bundleStatus)]));
    return _docxTable(['Class','Teacher','Students','Reports','Attendance','Status'], rows);
}

function _docxAttTrendTable(terms) {
    const rows = terms.map(t =>
        _docxTR([t.name, t.analysis.avgAttendance+'%', String(t.analysis.chronicAbsentee),
                 t.analysis.avgAttendance>=90?'Excellent':t.analysis.avgAttendance>=80?'Acceptable':'Below Benchmark']));
    return _docxTable(['Term','Avg Attendance','Chronic Absentees','Status'], rows);
}

function _docxTermOverviewTable(termDataArr) {
    const rows = termDataArr.map(td =>
        _docxTR([td.term.name, String(td.analysis.totalStudents),
                 td.analysis.avgAttendance+'%', td.analysis.complianceRate+'%',
                 String(td.analysis.termReports)]));
    return _docxTable(['Term','Enrollment','Attendance','Compliance','Reports'], rows);
}

function _docxTable(headers, rows) {
    const COLS = headers.length;
    const colW = Math.floor(8800 / COLS);
    const headerRow = `<w:tr>
        ${headers.map(h=>`<w:tc>
            <w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1A56DB"/>
            </w:tcPr>
            <w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="FFFFFF"/></w:rPr>
            <w:t>${_xe(h)}</w:t></w:r></w:p></w:tc>`).join('')}
    </w:tr>`;
    return `<w:tbl>
        <w:tblPr>
            <w:tblStyle w:val="TableGrid"/>
            <w:tblW w:w="8800" w:type="dxa"/>
            <w:tblBorders>
                <w:top w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:left w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:bottom w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:right w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/>
            </w:tblBorders>
        </w:tblPr>
        ${headerRow}${rows.join('')}
    </w:tbl><w:p/>`;
}

function _docxTR(cells, bold = false) {
    const colW = Math.floor(8800 / cells.length);
    return `<w:tr>${cells.map((c,i)=>`<w:tc>
        <w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>
        ${i%2===1?'<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>':''}</w:tcPr>
        <w:p><w:r><w:rPr>${bold?'<w:b/>':''}<w:sz w:val="18"/><w:color w:val="334155"/></w:rPr>
        <w:t xml:space="preserve">${_xe(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
}

// ── Array helpers for recommendations ────────────────────────
function _termRecsArr(a) {
    const recs = [];
    if (a.avgAttendance < 80) recs.push('Implement targeted attendance improvement strategies including parent engagement letters and class-level attendance awards.');
    if (a.complianceRate < 100) recs.push(`Follow up with ${a.totalTeachers - a.submittedTeachers} teacher(s) who have not submitted class report bundles.`);

    if (a.chronicAbsentee > a.totalStudents * 0.1) recs.push('Refer chronically absent students to the school counsellor and establish a re-engagement programme.');
    if (a.worstSubj && a.worstSubj.avg < 55) recs.push(`Introduce remedial/intervention sessions for ${a.worstSubj.subj}, which recorded the lowest school-wide average of ${a.worstSubj.avg}%.`);
    if (a.promotionFlags && a.promotionFlags.length > 0) recs.push(`Conduct focused academic support for students in: ${a.promotionFlags.join(', ')}, where pass rates fall below the promotion threshold.`);
    if (a.schoolAvg !== null && a.schoolAvg < 60) recs.push('Establish a school-wide academic recovery programme and periodic performance benchmarking to improve overall results.');
    recs.push('Conduct a mid-term academic review to track progress against targets.');
    recs.push('Increase parent engagement and communication regarding student performance, attendance, and homework completion.');
    recs.push('Ensure all class data including exam scores is fully recorded in the system to enable richer analysis.');
    return recs;
}

function _yearChallengesArr(ya, termDataArr) {
    const c = [];
    if (ya.yearAvgAttendance < 80) c.push(`Attendance averaged below benchmark throughout the year (${ya.yearAvgAttendance}%).`);
    if (ya.yearAvgCompliance < 80) c.push(`Teacher report submission compliance averaged ${ya.yearAvgCompliance}% — requires policy enforcement.`);

    if (!c.length) c.push('No persistent systemic challenges were identified across the full academic year.');
    return c;
}

function _yearRecsArr() {
    return [
        'Conduct a comprehensive end-of-year staff performance review, using attendance compliance and report submission data as key indicators.',
        'Develop a strategic enrollment plan to maintain or grow student numbers in the coming academic year, informed by termly demographic data.',
        'Strengthen foundational numeracy and literacy programmes, particularly for Lower Primary learners, to close identified learning gaps.',
        'Introduce subject-specific intervention classes for underperforming areas identified in this report.',
        'Invest in professional development programmes for teaching staff, with emphasis on data-driven classroom management and differentiated instruction.',
        'Expand parent-school communication through regular newsletters, parent-teacher meetings, and progress updates each term.',
        'Establish a formal student welfare committee to monitor chronic absenteeism and academic risk factors proactively.',
        'Enhance the use of practical learning materials and interactive teaching methods in all subject areas.',
        'Improve system data entry discipline to ensure future reports capture richer analytics including subject-level performance trends.'
    ];
}

// ── Core DOCX file assembler ──────────────────────────────────
async function _buildDocx(school, title, sections, logoBase64 = null) {
    const bodyXml = sections.join('\n');

    // ── Determine logo extension / content-type ───────────────
    let logoExt = 'png';
    let logoContentType = 'image/png';
    let logoBytes = null;
    if (logoBase64) {
        const match = logoBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
            const mime = match[1].toLowerCase();
            logoBytes  = match[2]; // raw base64 string
            if (mime.includes('jpeg') || mime.includes('jpg')) { logoExt = 'jpeg'; logoContentType = 'image/jpeg'; }
            else if (mime.includes('gif'))  { logoExt = 'gif';  logoContentType = 'image/gif'; }
            else if (mime.includes('webp')) { logoExt = 'webp'; logoContentType = 'image/webp'; }
            // else default png
        }
    }

    // ── If no logo, strip the drawing element from bodyXml ────
    const finalBodyXml = logoBase64
        ? bodyXml
        : bodyXml.replace(/<w:p><w:pPr><w:jc w:val="center"\/><w:spacing w:before="360" w:after="160"\/>[\s\S]*?<\/w:p>\s*/m, '');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 wp14">
<w:body>
${finalBodyXml}
<w:sectPr>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"
             w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:style w:type="paragraph" w:styleId="Normal">
        <w:name w:val="Normal"/>
        <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading1">
        <w:name w:val="heading 1"/>
        <w:basedOn w:val="Normal"/>
        <w:pPr><w:keepNext/></w:pPr>
        <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1A56DB"/></w:rPr>
    </w:style>
    <w:style w:type="table" w:styleId="TableGrid">
        <w:name w:val="Table Grid"/>
    </w:style>
</w:styles>`;

    const relsXml = logoBase64 ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
        Target="styles.xml"/>
    <Relationship Id="rIdLogo"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        Target="media/school_logo.${logoExt}"/>
</Relationships>` : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
        Target="styles.xml"/>
</Relationships>`;

    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
    <Application>Ridgevalley SMS</Application>
    <Company>${school}</Company>
</Properties>`;

    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${_xe(title)}</dc:title>
    <dc:creator>${school}</dc:creator>
    <cp:lastModifiedBy>${school}</cp:lastModifiedBy>
</cp:coreProperties>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml"  ContentType="application/xml"/>
    ${logoBase64 ? `<Default Extension="${logoExt}" ContentType="${logoContentType}"/>` : ''}
    <Override PartName="/word/document.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/docProps/app.xml"
        ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
    <Override PartName="/docProps/core.xml"
        ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

    const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
        Target="word/document.xml"/>
    <Relationship Id="rId2"
        Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
        Target="docProps/core.xml"/>
    <Relationship Id="rId3"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties"
        Target="docProps/app.xml"/>
</Relationships>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', packageRelsXml);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    zip.file('word/_rels/document.xml.rels', relsXml);
    zip.file('docProps/app.xml', appXml);
    zip.file('docProps/core.xml', coreXml);
    if (logoBase64 && logoBytes) {
        zip.file(`word/media/school_logo.${logoExt}`, logoBytes, { base64: true });
    }

    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ── Utility ───────────────────────────────────────────────────
function _xe(s) {
    return String(s || '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&apos;');
}

function _stripTags(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g,'&')
        .replace(/&lt;/g,'<')
        .replace(/&gt;/g,'>')
        .replace(/&nbsp;/g,' ')
        .replace(/\n{3,}/g,'\n\n')
        .trim();
}
