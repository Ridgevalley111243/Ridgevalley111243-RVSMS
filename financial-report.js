// ==================================================================================
// financial-report.js — Ridgevalley School Management System
// General Financial Report Generator (Term & Year)
// Integrates into Admin Dashboard → Data Analysis section
// Generates downloadable DOCX + PDF financial intelligence reports
// ==================================================================================

'use strict';

const financialReportGenerator = (() => {

    // ── Constants ────────────────────────────────────────────────────────────────
    const SCHOOL_NAME = 'Ridgevalley School';
    const SCHOOL_TAGLINE = 'Building Future Today';
    const CURRENCY = '₵';

    // Level groupings (matches app.js class structure: "Level - Grade")
    const LEVEL_GROUPS = ['Creche', 'Nursery', 'KG', 'Lower Primary', 'Upper Primary'];

    // ── Colour palette (hex, no #) for DOCX ─────────────────────────────────────
    const COLORS = {
        navy:    '0f2044',
        blue:    '1a56db',
        teal:    '0891b2',
        emerald: '059669',
        amber:   'd97706',
        red:     'dc2626',
        slate:   '475569',
        light:   'f1f5f9',
        white:   'ffffff',
        border:  'cbd5e1',
        header:  'e0e7ef',
    };

    // ── State ─────────────────────────────────────────────────────────────────────
    let _reportMode   = 'term';   // 'term' | 'year'
    let _selectedYear = null;     // academic year object
    let _selectedTerm = null;     // term object (null for year mode)
    let _generating   = false;

    // ═════════════════════════════════════════════════════════════════════════════
    // PUBLIC — UI RENDERING
    // Called by renderDataAnalysis() in academic-report-generator.js (appended section)
    // ═════════════════════════════════════════════════════════════════════════════
    function renderFinancialReportSection() {
        const years = (typeof state !== 'undefined' ? state.academicYears : []) || [];
        const activeYear = years.find(y => y.active) || years[0] || null;

        const yearOptions = years.map(y =>
            `<option value="${y.id}" ${activeYear && y.id === activeYear.id ? 'selected' : ''}>${y.year}</option>`
        ).join('');

        const sectionHtml = `
        <div id="frg-section" style="margin-top:32px;">

            <!-- Section heading -->
            <div style="margin-bottom:28px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                    <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;
                                color:var(--rv-navy,#0f2044);margin:0;">
                        Financial Report Generator
                    </h2>
                    <span style="font-size:11px;font-weight:700;color:#059669;background:#d1fae5;
                                 padding:3px 10px;border-radius:20px;border:1px solid #6ee7b7;">
                        <i class="fas fa-shield-alt" style="margin-right:4px;"></i>Admin Only
                    </span>
                </div>
                <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">
                    Generate leadership-level school financial intelligence reports.
                </p>
            </div>

            <!-- Report mode cards -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;">
                ${_frgModeCard('term','fa-calendar-week','Term Report',
                    'Analyse one term — fee collection, arrears, payment methods & financial risks.')}
                ${_frgModeCard('year','fa-chart-line','Year Report',
                    'Aggregate all three terms into a full-year financial intelligence overview.')}
            </div>

            <!-- Configuration panel -->
            <div id="frg-config-panel"
                 style="background:var(--rv-surface,#ffffff);border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;margin-bottom:20px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">

                <h3 style="font-size:15px;font-weight:700;color:var(--rv-navy,#0f2044);
                            margin:0 0 18px;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-sliders-h" style="color:#1a56db;font-size:13px;"></i>
                    Report Configuration
                </h3>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
                    <div>
                        <label style="display:block;font-size:12px;font-weight:600;
                                      color:var(--rv-muted,#64748b);margin-bottom:6px;
                                      text-transform:uppercase;letter-spacing:.5px;">Academic Year</label>
                        <select id="frg-year-sel" onchange="financialReportGenerator._onYearChange()"
                                style="width:100%;padding:10px 14px;border-radius:10px;
                                       border:1.5px solid var(--rv-border,#e2e8f0);
                                       background:var(--rv-bg,#f8fafc);
                                       color:var(--rv-text,#1e293b);font-size:14px;
                                       font-weight:500;outline:none;cursor:pointer;">
                            <option value="">— Select year —</option>
                            ${yearOptions}
                        </select>
                    </div>
                    <div id="frg-term-col">
                        <label style="display:block;font-size:12px;font-weight:600;
                                      color:var(--rv-muted,#64748b);margin-bottom:6px;
                                      text-transform:uppercase;letter-spacing:.5px;">Term</label>
                        <select id="frg-term-sel"
                                style="width:100%;padding:10px 14px;border-radius:10px;
                                       border:1.5px solid var(--rv-border,#e2e8f0);
                                       background:var(--rv-bg,#f8fafc);
                                       color:var(--rv-text,#1e293b);font-size:14px;
                                       font-weight:500;outline:none;cursor:pointer;">
                            <option value="">— Select term —</option>
                        </select>
                    </div>
                </div>

                <!-- Generate button row -->
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button id="frg-btn-generate" onclick="financialReportGenerator._generate()"
                            style="display:inline-flex;align-items:center;gap:10px;
                                   padding:12px 28px;border-radius:12px;border:none;
                                   background:linear-gradient(135deg,#1a56db,#1e40af);
                                   color:#fff;font-size:14px;font-weight:700;
                                   cursor:pointer;box-shadow:0 4px 12px rgba(26,86,219,.35);
                                   transition:opacity .15s;">
                        <i class="fas fa-file-invoice-dollar"></i>
                        Generate Report
                    </button>
                </div>
            </div>

            <!-- Progress bar -->
            <div id="frg-progress"
                 style="display:none;background:var(--rv-surface,#fff);
                        border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;margin-bottom:20px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">
                <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
                    <div style="width:36px;height:36px;border:3px solid #1a56db;
                                border-top-color:transparent;border-radius:50%;
                                animation:spin .7s linear infinite;flex-shrink:0;"></div>
                    <div>
                        <p id="frg-progress-label"
                           style="font-weight:700;font-size:14px;
                                  color:var(--rv-navy,#0f2044);margin:0 0 2px;">
                            Computing financial data…
                        </p>
                        <p id="frg-progress-sub"
                           style="font-size:12px;color:var(--rv-muted,#64748b);margin:0;">
                            Please wait
                        </p>
                    </div>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
                    <div id="frg-progress-bar"
                         style="height:100%;background:linear-gradient(90deg,#1a56db,#60a5fa);
                                border-radius:99px;width:0%;transition:width .4s ease;"></div>
                </div>
            </div>

            <!-- Preview panel -->
            <div id="frg-preview-panel"
                 style="display:none;background:var(--rv-surface,#fff);
                        border:1px solid var(--rv-border,#e2e8f0);
                        border-radius:16px;padding:24px;
                        box-shadow:0 1px 4px rgba(0,0,0,.06);">
                <div style="display:flex;align-items:center;justify-content:space-between;
                             margin-bottom:20px;flex-wrap:wrap;gap:12px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:40px;height:40px;background:linear-gradient(135deg,#1a56db,#1e40af);
                                    border-radius:10px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-file-invoice-dollar" style="color:#fff;font-size:16px;"></i>
                        </div>
                        <div>
                            <p id="frg-preview-title"
                               style="font-weight:700;font-size:15px;
                                      color:var(--rv-navy,#0f2044);margin:0;"></p>
                            <p id="frg-preview-subtitle"
                               style="font-size:12px;color:var(--rv-muted,#64748b);margin:0;"></p>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button id="frg-btn-docx" onclick="financialReportGenerator.generateDOCX()"
                                style="display:inline-flex;align-items:center;gap:8px;
                                       padding:10px 22px;border-radius:10px;border:none;
                                       background:linear-gradient(135deg,#1a56db,#0891b2);
                                       color:#fff;font-size:13px;font-weight:700;
                                       cursor:pointer;box-shadow:0 4px 10px rgba(26,86,219,.3);">
                            <i class="fas fa-file-word"></i>
                            Download DOCX
                        </button>
                        <button id="frg-btn-pdf" onclick="financialReportGenerator.generatePDF()"
                                style="display:inline-flex;align-items:center;gap:8px;
                                       padding:10px 22px;border-radius:10px;border:none;
                                       background:linear-gradient(135deg,#dc2626,#f97316);
                                       color:#fff;font-size:13px;font-weight:700;
                                       cursor:pointer;box-shadow:0 4px 10px rgba(220,38,38,.3);">
                            <i class="fas fa-file-pdf"></i>
                            Download PDF
                        </button>
                    </div>
                </div>
                <div id="frg-preview-body"
                     style="font-family:Georgia,serif;font-size:13.5px;
                            line-height:1.75;color:var(--rv-text,#1e293b);
                            max-height:520px;overflow-y:auto;padding-right:4px;"></div>
            </div>

            <!-- Status bar -->
            <div id="frg-status" style="display:none;margin-top:14px;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:600;"></div>

        </div>`;

        return sectionHtml;
    }

    // ── Mode card HTML (matches academic report style) ───────────────────────────
    function _frgModeCard(mode, icon, title, desc) {
        return `
            <div id="frg-card-${mode}"
                 onclick="financialReportGenerator._setMode('${mode}')"
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

    // ── Mode toggle ──────────────────────────────────────────────────────────────
    function _setMode(mode) {
        _reportMode = mode;

        ['term', 'year'].forEach(m => {
            const card = document.getElementById(`frg-card-${m}`);
            if (!card) return;
            if (m === mode) {
                card.style.borderColor = '#1a56db';
                card.style.background  = 'rgba(26,86,219,.06)';
            } else {
                card.style.borderColor = 'var(--rv-border,#e2e8f0)';
                card.style.background  = 'var(--rv-surface,#fff)';
            }
        });

        const termCol  = document.getElementById('frg-term-col');

        if (termCol) {
            termCol.style.display = mode === 'term' ? 'block' : 'none';
        }

        // Hide preview when switching modes
        const prev = document.getElementById('frg-preview-panel');
        if (prev) prev.style.display = 'none';
    }

    // ── Year change handler ──────────────────────────────────────────────────────
    function _onYearChange() {
        const yearSel = document.getElementById('frg-year-sel');
        const termSel = document.getElementById('frg-term-sel');
        if (!yearSel || !termSel) return;

        const yearId = yearSel.value;
        const years  = (typeof state !== 'undefined' ? state.academicYears : []) || [];
        _selectedYear = years.find(y => y.id === yearId) || null;

        termSel.innerHTML = '<option value="">— Select Term —</option>';
        if (_selectedYear && _selectedYear.terms) {
            _selectedYear.terms.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                if (t.active) opt.selected = true;
                termSel.appendChild(opt);
            });
        }
        _selectedTerm = _selectedYear?.terms?.find(t => t.active) || null;
    }

    // ── Resolve current selections ────────────────────────────────────────────────
    function _resolveSelections() {
        const years   = (typeof state !== 'undefined' ? state.academicYears : []) || [];
        const yearSel = document.getElementById('frg-year-sel');
        const termSel = document.getElementById('frg-term-sel');

        if (yearSel?.value) {
            _selectedYear = years.find(y => y.id === yearSel.value) || null;
        }
        if (termSel?.value && _selectedYear) {
            _selectedTerm = (_selectedYear.terms || []).find(t => t.id === termSel.value) || null;
        }

        if (!_selectedYear) {
            _setStatus('Please select an Academic Year.', 'warning');
            return false;
        }
        if (_reportMode === 'term' && !_selectedTerm) {
            _setStatus('Please select a Term.', 'warning');
            return false;
        }
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // DATA ENGINE — computes all financial metrics from app state
    // ═════════════════════════════════════════════════════════════════════════════
    function _computeTermData(year, term) {
        const students     = (typeof state !== 'undefined' ? state.students      : []) || [];
        const fees         = (typeof state !== 'undefined' ? state.fees          : []) || [];
        const transactions = (typeof state !== 'undefined' ? state.transactions  : []) || [];
        const parents      = (typeof state !== 'undefined' ? state.parents       : []) || [];

        // ── Fees applicable to this term ─────────────────────────────────────────
        const termFees = fees.filter(f => f.year_id === year.id && f.term_id === term.id);

        // ── Transactions for this term ────────────────────────────────────────────
        const termTxns = transactions.filter(t =>
            t.year_id === year.id && t.term_id === term.id && t.type === 'payment'
        );
        const confirmedTxns = termTxns.filter(t => t.status === 'confirmed');
        const pendingTxns   = termTxns.filter(t => t.status === 'pending');
        const failedTxns    = termTxns.filter(t => t.status === 'rejected');

        // ── Per-student billing ───────────────────────────────────────────────────
        const studentData = students.map(student => {
            const level = (student.class || '').split(' - ')[0] || 'Unknown';

            const applicable = termFees.filter(f =>
                f.scope === 'global' || f.scope === level
            );
            const expected = applicable.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);

            const paid = confirmedTxns
                .filter(t => t.student_id === student.id)
                .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

            const outstanding = Math.max(0, expected - paid);
            const parent = parents.find(p => p.children_ids?.includes(student.id));

            let status = 'No Payment';
            if (paid >= expected && expected > 0) status = 'Fully Paid';
            else if (paid > 0) status = 'Partial Payment';

            return {
                id: student.id,
                name: student.name,
                class: student.class || 'Unknown',
                level,
                parentName: parent?.full_name || '—',
                parentPhone: parent?.phone || '—',
                expected,
                paid,
                outstanding,
                status,
            };
        });

        // ── Summary totals ────────────────────────────────────────────────────────
        const totalExpected    = studentData.reduce((s, d) => s + d.expected, 0);
        const totalCollected   = studentData.reduce((s, d) => s + d.paid, 0);
        const totalOutstanding = studentData.reduce((s, d) => s + d.outstanding, 0);
        const collectionRate   = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

        // ── Compliance counts ─────────────────────────────────────────────────────
        const fullyPaid  = studentData.filter(d => d.status === 'Fully Paid').length;
        const partial    = studentData.filter(d => d.status === 'Partial Payment').length;
        const noPay      = studentData.filter(d => d.status === 'No Payment' && d.expected > 0).length;

        // ── Level breakdown ───────────────────────────────────────────────────────
        const levelBreakdown = LEVEL_GROUPS.map(lvl => {
            const lvlStudents = studentData.filter(d => d.level === lvl);
            if (lvlStudents.length === 0) return null;
            const exp  = lvlStudents.reduce((s, d) => s + d.expected, 0);
            const coll = lvlStudents.reduce((s, d) => s + d.paid, 0);
            const out  = lvlStudents.reduce((s, d) => s + d.outstanding, 0);
            const rate = exp > 0 ? (coll / exp) * 100 : 0;
            return { level: lvl, expected: exp, collected: coll, outstanding: out, rate, count: lvlStudents.length };
        }).filter(Boolean);

        // Append any levels not in LEVEL_GROUPS
        const extraLevels = [...new Set(studentData.map(d => d.level))].filter(
            l => !LEVEL_GROUPS.includes(l) && l !== 'Unknown'
        );
        extraLevels.forEach(lvl => {
            const lvlStudents = studentData.filter(d => d.level === lvl);
            const exp  = lvlStudents.reduce((s, d) => s + d.expected, 0);
            const coll = lvlStudents.reduce((s, d) => s + d.paid, 0);
            const out  = lvlStudents.reduce((s, d) => s + d.outstanding, 0);
            const rate = exp > 0 ? (coll / exp) * 100 : 0;
            levelBreakdown.push({ level: lvl, expected: exp, collected: coll, outstanding: out, rate, count: lvlStudents.length });
        });

        // Sort: best collection rate last → worst first for risk flagging
        const sorted = [...levelBreakdown].sort((a, b) => b.rate - a.rate);
        const strongestLevel = sorted[0] || null;
        const weakestLevel   = sorted[sorted.length - 1] || null;

        // ── Payment method breakdown ──────────────────────────────────────────────
        const methodMap = {};
        confirmedTxns.forEach(t => {
            const m = t.method || 'Unknown';
            if (!methodMap[m]) methodMap[m] = { count: 0, total: 0 };
            methodMap[m].count++;
            methodMap[m].total += parseFloat(t.amount) || 0;
        });
        const paymentMethods = Object.entries(methodMap).map(([method, v]) => ({ method, ...v }));

        // ── Monthly collection trend ──────────────────────────────────────────────
        const monthlyMap = {};
        confirmedTxns.forEach(t => {
            const d = new Date(t.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
            if (!monthlyMap[key]) monthlyMap[key] = { month: label, amount: 0 };
            monthlyMap[key].amount += parseFloat(t.amount) || 0;
        });
        const monthlyTrend = Object.entries(monthlyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, v]) => v);

        const bestMonth   = monthlyTrend.reduce((b, m) => (!b || m.amount > b.amount) ? m : b, null);
        const worstMonth  = monthlyTrend.reduce((b, m) => (!b || m.amount < b.amount) ? m : b, null);

        // ── Arrears list ──────────────────────────────────────────────────────────
        const arrearsList = studentData
            .filter(d => d.outstanding > 0)
            .sort((a, b) => b.outstanding - a.outstanding);

        const avgArrears  = arrearsList.length > 0
            ? arrearsList.reduce((s, d) => s + d.outstanding, 0) / arrearsList.length
            : 0;

        // Top debtor class
        const classArrears = {};
        arrearsList.forEach(d => {
            if (!classArrears[d.class]) classArrears[d.class] = 0;
            classArrears[d.class] += d.outstanding;
        });
        const topDebtorClass = Object.entries(classArrears)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || '—';

        return {
            year, term,
            students: studentData,
            totalExpected, totalCollected, totalOutstanding, collectionRate,
            fullyPaid, partial, noPay,
            levelBreakdown, strongestLevel, weakestLevel,
            paymentMethods,
            monthlyTrend, bestMonth, worstMonth,
            arrearsList, avgArrears, topDebtorClass,
            confirmedTxns, pendingTxns, failedTxns,
            totalTxns: termTxns.length,
        };
    }

    function _computeYearData(year) {
        const terms = (year.terms || []);
        const termDataArr = terms.map(t => _computeTermData(year, t));

        const yearSummary = {
            year,
            terms: termDataArr,
            totalExpected:    termDataArr.reduce((s, t) => s + t.totalExpected, 0),
            totalCollected:   termDataArr.reduce((s, t) => s + t.totalCollected, 0),
            totalOutstanding: termDataArr.reduce((s, t) => s + t.totalOutstanding, 0),
        };
        yearSummary.collectionRate = yearSummary.totalExpected > 0
            ? (yearSummary.totalCollected / yearSummary.totalExpected) * 100
            : 0;

        // Best / worst term
        yearSummary.bestTerm  = [...termDataArr].sort((a, b) => b.collectionRate - a.collectionRate)[0] || null;
        yearSummary.worstTerm = [...termDataArr].sort((a, b) => a.collectionRate - b.collectionRate)[0] || null;

        return yearSummary;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // NARRATIVE GENERATOR — dynamic text based on real data
    // ═════════════════════════════════════════════════════════════════════════════
    function _narrativeExecutiveSummary(d) {
        const rate = d.collectionRate.toFixed(1);
        const termLabel = `${d.term?.name || ''} of the ${d.year?.year || ''} academic year`;
        let perf = d.collectionRate >= 90 ? 'exceptional' : d.collectionRate >= 75 ? 'stable' : d.collectionRate >= 60 ? 'moderate' : 'below-target';
        let outlook = d.collectionRate >= 80 ? 'Financial sustainability indicators are positive.' : 'Immediate attention is required to improve collection performance.';
        let arrearNote = d.totalOutstanding > 0
            ? `Outstanding balances of ${CURRENCY}${_fmt(d.totalOutstanding)} remain concentrated primarily in ${d.weakestLevel?.level || 'certain levels'}, warranting structured follow-up.`
            : 'All outstanding balances have been cleared, reflecting excellent payment discipline.';

        return `The school recorded ${perf} financial performance during ${termLabel}. Overall fee collection reached ${rate}%, with ${CURRENCY}${_fmt(d.totalCollected)} collected against a total billing of ${CURRENCY}${_fmt(d.totalExpected)}. ${arrearNote} ${d.strongestLevel ? `The ${d.strongestLevel.level} level demonstrated the strongest payment compliance at ${d.strongestLevel.rate.toFixed(1)}%.` : ''} ${outlook}`;
    }

    function _narrativeBillingOverview(d) {
        const rate = d.collectionRate.toFixed(1);
        const billed = d.students.filter(s => s.expected > 0).length;
        if (d.collectionRate >= 85) {
            return `A total of ${billed} students were billed during this period. Fee collection performance was strong at ${rate}%, reflecting good parent compliance and effective fee management. A balance of ${CURRENCY}${_fmt(d.totalOutstanding)} remains outstanding and should be followed up accordingly.`;
        }
        return `A total of ${billed} students were billed during this period. The overall collection rate of ${rate}% indicates room for improvement. With ${CURRENCY}${_fmt(d.totalOutstanding)} still outstanding, the school should intensify payment reminder communications and consider structured payment plans for families in arrears.`;
    }

    function _narrativePaymentPerformance(d) {
        if (!d.strongestLevel || !d.weakestLevel) return 'Insufficient data to generate level-based performance analysis.';
        const gap = (d.strongestLevel.rate - d.weakestLevel.rate).toFixed(1);
        return `Payment performance varies across levels. ${d.strongestLevel.level} leads with a collection rate of ${d.strongestLevel.rate.toFixed(1)}%, while ${d.weakestLevel.level} records the lowest at ${d.weakestLevel.rate.toFixed(1)}%. The ${gap}% gap between best and worst-performing levels suggests targeted intervention strategies are needed for lower-performing groups.`;
    }

    function _narrativeArrears(d) {
        if (d.arrearsList.length === 0) return 'No outstanding arrears recorded for this period. All billed students have fully settled their fees.';
        const pct = d.students.length > 0 ? ((d.arrearsList.length / d.students.length) * 100).toFixed(1) : 0;
        return `${d.arrearsList.length} students (${pct}% of enrolled students) carry outstanding balances totalling ${CURRENCY}${_fmt(d.totalOutstanding)}, with an average arrears of ${CURRENCY}${_fmt(d.avgArrears)} per student. The ${d.topDebtorClass} class records the highest concentration of unpaid fees. Prompt follow-up with parents and guardians is strongly advised.`;
    }

    function _narrativePaymentMethods(methods) {
        if (!methods || methods.length === 0) return 'No payment method data available for this period.';
        const sorted = [...methods].sort((a, b) => b.total - a.total);
        const top = sorted[0];
        return `${top.method} is the dominant payment channel, accounting for ${CURRENCY}${_fmt(top.total)} across ${top.count} transaction(s). ${sorted.length > 1 ? `Other channels include ${sorted.slice(1).map(m => m.method).join(', ')}.` : ''} The school should continue promoting digital payment options to improve collection convenience and tracking.`;
    }

    function _narrativeTransactions(d) {
        const pct = d.totalTxns > 0 ? ((d.confirmedTxns.length / d.totalTxns) * 100).toFixed(1) : 0;
        let msg = `A total of ${d.totalTxns} payment transaction(s) were recorded this period, of which ${d.confirmedTxns.length} (${pct}%) were confirmed.`;
        if (d.pendingTxns.length > 0) msg += ` ${d.pendingTxns.length} transaction(s) remain pending review.`;
        if (d.failedTxns.length > 0) msg += ` ${d.failedTxns.length} transaction(s) were rejected.`;
        return msg;
    }

    function _narrativeMonthlyTrend(d) {
        if (!d.monthlyTrend || d.monthlyTrend.length === 0) return 'Insufficient monthly data to generate trend analysis for this period.';
        if (d.monthlyTrend.length === 1) return `All collections occurred in ${d.monthlyTrend[0].month}, totalling ${CURRENCY}${_fmt(d.monthlyTrend[0].amount)}.`;
        return `Monthly collection trends show the highest inflow in ${d.bestMonth?.month || '—'} (${CURRENCY}${_fmt(d.bestMonth?.amount || 0)}) and the lowest in ${d.worstMonth?.month || '—'} (${CURRENCY}${_fmt(d.worstMonth?.amount || 0)}). ${d.collectionRate < 80 ? 'The school should implement early-term payment drives to smooth collection across the term.' : 'Collection timing is relatively balanced across the term period.'}`;
    }

    function _narrativeRisks(d) {
        const risks = [];
        if (d.collectionRate < 70) risks.push(`Critical collection rate of ${d.collectionRate.toFixed(1)}% — immediate remediation required.`);
        else if (d.collectionRate < 85) risks.push(`Collection rate of ${d.collectionRate.toFixed(1)}% is below the recommended 85% threshold.`);
        if (d.noPay > 0) risks.push(`${d.noPay} enrolled student(s) have made no payment whatsoever.`);
        if (d.weakestLevel && d.weakestLevel.rate < 60) risks.push(`${d.weakestLevel.level} shows a critically low collection rate of ${d.weakestLevel.rate.toFixed(1)}%.`);
        if (d.pendingTxns.length > 5) risks.push(`${d.pendingTxns.length} transactions remain pending — delayed approvals may impact financial reporting.`);
        if (d.totalOutstanding > d.totalCollected * 0.3) risks.push('Outstanding balances represent more than 30% of total collections — a significant financial risk.');
        if (risks.length === 0) risks.push('No critical financial risks identified for this period. Maintain current collection practices.');
        return risks;
    }

    function _narrativeRecommendations(d) {
        const recs = [];
        if (d.collectionRate < 85) recs.push('Implement a structured fee reminder system — SMS and written notices — at least 2 weeks before term deadlines.');
        if (d.noPay > 0) recs.push(`Engage directly with the ${d.noPay} families who have made no payment to understand barriers and negotiate payment arrangements.`);
        if (d.weakestLevel) recs.push(`Prioritise arrears recovery efforts in the ${d.weakestLevel.level} level through dedicated parent-administration meetings.`);
        const hasMomo = d.paymentMethods?.some(m => m.method?.toLowerCase().includes('momo') || m.method?.toLowerCase().includes('mobile'));
        if (!hasMomo) recs.push('Introduce or promote Mobile Money payment channels to improve payment convenience and uptake.');
        if (d.pendingTxns.length > 0) recs.push('Establish a daily transaction review process to ensure all submitted payments are confirmed promptly.');
        recs.push('Publish a detailed fee schedule at the beginning of each term and distribute to all parents/guardians.');
        recs.push('Consider introducing an early-payment incentive scheme to encourage full fee settlement in the first weeks of term.');
        return recs;
    }

    function _narrativeConclusion(d) {
        const rate = d.collectionRate.toFixed(1);
        const health = d.collectionRate >= 85 ? 'healthy' : d.collectionRate >= 70 ? 'moderately healthy' : 'financially stressed';
        return `Overall, the school is in a ${health} financial position for ${d.term?.name || ''} of the ${d.year?.year || ''} academic year, with a collection rate of ${rate}%. Total revenue collected stands at ${CURRENCY}${_fmt(d.totalCollected)}, against an outstanding balance of ${CURRENCY}${_fmt(d.totalOutstanding)}. The administration is encouraged to act on the recommendations outlined in this report to safeguard the school's financial sustainability and ensure equitable access for all enrolled students.`;
    }

    function _narrativeYearlyConclusion(yd) {
        const rate = yd.collectionRate.toFixed(1);
        return `Across the ${yd.year?.year || ''} academic year, the school collected ${CURRENCY}${_fmt(yd.totalCollected)} in fees — a collection rate of ${rate}% against total billings of ${CURRENCY}${_fmt(yd.totalExpected)}. ${yd.bestTerm ? `${yd.bestTerm.term?.name} was the strongest collection period.` : ''} ${yd.worstTerm ? `${yd.worstTerm.term?.name} recorded the weakest performance and should inform planning for the upcoming academic year.` : ''} The school is advised to leverage these insights to design proactive fee collection strategies, engage persistently with families in arrears, and invest in digital payment infrastructure to improve year-on-year financial performance.`;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // GENERATE ENTRY POINT (called by Generate Report button)
    // ═════════════════════════════════════════════════════════════════════════════
    async function _generate() {
        if (!_resolveSelections()) return;
        _generating = true;
        _showProgress(true);
        _setProgress(5, 'Reading financial records…');
        _clearStatus();

        try {
            // Fetch school logo (same pattern as academic report)
            _setProgress(15, 'Fetching school logo…');
            const logoUrl    = await _frgFetchSchoolLogo();

            let previewHtml;
            if (_reportMode === 'term') {
                _setProgress(35, 'Computing term financial data…');
                const d = _computeTermData(_selectedYear, _selectedTerm);
                _setProgress(65, 'Building preview…');
                const logoBase64 = logoUrl ? await _frgLogoToBase64(logoUrl) : null;
                previewHtml = _buildPreviewHTML_Term(d, logoUrl);
                window._frgCurrentData = { mode: 'term', d, logoBase64, logoUrl };

                document.getElementById('frg-preview-title').textContent =
                    `${_selectedTerm.name} Financial Report — ${_selectedYear.year}`;
                document.getElementById('frg-preview-subtitle').textContent =
                    `Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`;
            } else {
                _setProgress(35, 'Aggregating all terms…');
                const yd = _computeYearData(_selectedYear);
                _setProgress(65, 'Building yearly preview…');
                const logoBase64 = logoUrl ? await _frgLogoToBase64(logoUrl) : null;
                previewHtml = _buildPreviewHTML_Year(yd, logoUrl);
                window._frgCurrentData = { mode: 'year', yd, logoBase64, logoUrl };

                document.getElementById('frg-preview-title').textContent =
                    `Annual Financial Report — ${_selectedYear.year}`;
                document.getElementById('frg-preview-subtitle').textContent =
                    `Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`;
            }

            _setProgress(100, 'Done!');
            await new Promise(r => setTimeout(r, 300));
            _showProgress(false);

            const body = document.getElementById('frg-preview-body');
            if (body) body.innerHTML = previewHtml;
            const panel = document.getElementById('frg-preview-panel');
            if (panel) {
                panel.style.display = 'block';
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

        } catch (err) {
            _showProgress(false);
            _setStatus('Generation failed: ' + (err.message || err), 'error');
            console.error('Financial report error:', err);
        } finally {
            _generating = false;
        }
    }

    // ── Logo fetch helpers (mirrors academic report) ─────────────────────────────
    async function _frgFetchSchoolLogo() {
        try {
            const { data, error } = await supabaseClient
                .from('school_settings')
                .select('logo_url')
                .limit(1)
                .single();
            if (error || !data?.logo_url) return null;
            return data.logo_url;
        } catch (e) {
            console.warn('Could not fetch school logo:', e);
            return null;
        }
    }

    async function _frgLogoToBase64(url) {
        try {
            const res  = await fetch(url);
            const blob = await res.blob();
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror   = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('Could not load logo image:', e);
            return null;
        }
    }

    // ── Progress helpers ─────────────────────────────────────────────────────────
    function _showProgress(show) {
        const p = document.getElementById('frg-progress');
        const b = document.getElementById('frg-btn-generate');
        const v = document.getElementById('frg-preview-panel');
        if (p) p.style.display = show ? 'block' : 'none';
        if (b) b.disabled = show;
        if (show && v) v.style.display = 'none';
    }

    function _setProgress(pct, label, sub) {
        const bar = document.getElementById('frg-progress-bar');
        const lbl = document.getElementById('frg-progress-label');
        const sl  = document.getElementById('frg-progress-sub');
        if (bar) bar.style.width = pct + '%';
        if (lbl && label) lbl.textContent = label;
        if (sl  && sub)   sl.textContent  = sub;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // PREVIEW RENDERER — HTML-based in-app preview
    // ═════════════════════════════════════════════════════════════════════════════
    function previewReport() {
        // Public alias — triggers the full generate flow
        _generate();
    }

    function _previewSection(title, content) {
        return `
        <div style="margin-bottom:24px;">
            <h3 style="font-size:13px;font-weight:800;color:#0f2044;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;padding-bottom:8px;border-bottom:2px solid #1a56db;">${title}</h3>
            ${content}
        </div>`;
    }

    function _previewTable(headers, rows, highlightLast = false) {
        return `
        <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="background:#e0e7ef;">
                    ${headers.map(h => `<th style="padding:8px 10px;text-align:left;font-weight:700;color:#0f2044;font-size:11px;">${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows.map((r, i) => `
                <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#fff'};${highlightLast && i === rows.length - 1 ? 'font-weight:700;background:#f0f9ff;' : ''}">
                    ${r.map(c => `<td style="padding:8px 10px;color:#374151;border-bottom:1px solid #e2e8f0;">${c}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
        </table>
        </div>`;
    }

    function _previewNarrative(text) {
        return `<p style="font-size:12.5px;color:#374151;line-height:1.7;margin:0 0 10px;">${text}</p>`;
    }

    function _statusBadge(status) {
        const map = {
            'Fully Paid':      'background:#d1fae5;color:#065f46;',
            'Partial Payment': 'background:#fef3c7;color:#92400e;',
            'No Payment':      'background:#fee2e2;color:#991b1b;',
        };
        return `<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;${map[status] || ''}">${status}</span>`;
    }

    function _buildPreviewHTML_Term(d, logoUrl) {
        const risks = _narrativeRisks(d);
        const recs  = _narrativeRecommendations(d);
        const logoHtml = logoUrl
            ? `<img src="${logoUrl}" alt="School Logo"
                   style="width:72px;height:72px;object-fit:contain;border-radius:8px;
                          margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
            : `<div style="width:60px;height:60px;background:linear-gradient(135deg,#1a56db,#1e40af);
                            border-radius:50%;display:inline-flex;align-items:center;
                            justify-content:center;margin-bottom:12px;">
                   <i class="fas fa-file-invoice-dollar" style="color:#fff;font-size:24px;"></i>
               </div>`;

        return `
        <div style="font-family:'Segoe UI',Arial,sans-serif;padding:28px;background:#fff;max-height:600px;overflow-y:auto;">
            <!-- Cover -->
            <div style="text-align:center;padding:20px 0 24px;border-bottom:3px solid #1a56db;margin-bottom:24px;">
                ${logoHtml}
                <div style="font-size:22px;font-weight:900;color:#0f2044;margin-bottom:4px;">${SCHOOL_NAME}</div>
                <div style="font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">${SCHOOL_TAGLINE}</div>
                <div style="font-size:16px;font-weight:700;color:#1a56db;margin-bottom:4px;">GENERAL FINANCIAL REPORT</div>
                <div style="font-size:13px;color:#374151;">${d.term?.name} &nbsp;|&nbsp; Academic Year ${d.year?.year}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Generated: ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}</div>
            </div>

            <!-- KPI Pills -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;">
                ${[
                    { label: 'Total Billed',    value: `${CURRENCY}${_fmt(d.totalExpected)}`,   color: '#1a56db' },
                    { label: 'Total Collected', value: `${CURRENCY}${_fmt(d.totalCollected)}`, color: '#059669' },
                    { label: 'Outstanding',     value: `${CURRENCY}${_fmt(d.totalOutstanding)}`, color: '#dc2626' },
                    { label: 'Collection Rate', value: `${d.collectionRate.toFixed(1)}%`,       color: d.collectionRate >= 80 ? '#059669' : '#d97706' },
                ].map(k => `
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:17px;font-weight:800;color:${k.color};">${k.value}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px;">${k.label}</div>
                    </div>`).join('')}
            </div>

            ${_previewSection('1. Executive Summary', _previewNarrative(_narrativeExecutiveSummary(d)))}
            ${_previewSection('2. Student Billing Overview', _previewNarrative(_narrativeBillingOverview(d)))}

            ${_previewSection('3. Payment Performance by Level',
                _previewTable(
                    ['Level', 'Expected', 'Collected', 'Outstanding', 'Rate'],
                    d.levelBreakdown.map(l => [l.level, `${CURRENCY}${_fmt(l.expected)}`, `${CURRENCY}${_fmt(l.collected)}`, `${CURRENCY}${_fmt(l.outstanding)}`, `${l.rate.toFixed(1)}%`])
                ) + _previewNarrative(_narrativePaymentPerformance(d))
            )}

            ${_previewSection('4. Arrears Analysis', _previewNarrative(_narrativeArrears(d)))}

            ${_previewSection('5. Students with Outstanding Arrears',
                d.arrearsList.length === 0
                    ? _previewNarrative('No students with outstanding arrears.')
                    : _previewTable(
                        ['Student', 'Class', 'Parent', 'Contact', 'Expected', 'Paid', 'Outstanding', 'Status'],
                        d.arrearsList.slice(0, 30).map(s => [
                            s.name, s.class, s.parentName, s.parentPhone,
                            `${CURRENCY}${_fmt(s.expected)}`, `${CURRENCY}${_fmt(s.paid)}`,
                            `${CURRENCY}${_fmt(s.outstanding)}`, _statusBadge(s.status)
                        ])
                    ) + (d.arrearsList.length > 30 ? _previewNarrative(`...and ${d.arrearsList.length - 30} more. Full list included in downloaded report.`) : '')
            )}

            ${d.paymentMethods.length > 0 ? _previewSection('6. Payment Method Analysis',
                _previewTable(
                    ['Payment Method', 'Transactions', 'Total Collected'],
                    d.paymentMethods.map(m => [m.method, m.count, `${CURRENCY}${_fmt(m.total)}`])
                ) + _previewNarrative(_narrativePaymentMethods(d.paymentMethods))
            ) : ''}

            ${_previewSection('7. Transaction Analysis', _previewNarrative(_narrativeTransactions(d)))}

            ${d.monthlyTrend.length > 0 ? _previewSection('8. Monthly Collection Trend',
                _previewTable(['Month', 'Amount Collected'], d.monthlyTrend.map(m => [m.month, `${CURRENCY}${_fmt(m.amount)}`])) +
                _previewNarrative(_narrativeMonthlyTrend(d))
            ) : ''}

            ${_previewSection('9. Student Payment Compliance',
                _previewTable(
                    ['Status', 'Count', 'Percentage'],
                    [
                        ['Fully Paid',      d.fullyPaid, `${d.students.length > 0 ? ((d.fullyPaid / d.students.length)*100).toFixed(1) : 0}%`],
                        ['Partial Payment', d.partial,   `${d.students.length > 0 ? ((d.partial   / d.students.length)*100).toFixed(1) : 0}%`],
                        ['No Payment',      d.noPay,     `${d.students.length > 0 ? ((d.noPay     / d.students.length)*100).toFixed(1) : 0}%`],
                    ]
                )
            )}

            ${_previewSection('10. Financial Risks & Concerns',
                `<ul style="margin:0;padding-left:18px;">${risks.map(r => `<li style="font-size:12.5px;color:#374151;margin-bottom:6px;line-height:1.6;">${r}</li>`).join('')}</ul>`
            )}

            ${_previewSection('11. Recommendations',
                `<ol style="margin:0;padding-left:18px;">${recs.map(r => `<li style="font-size:12.5px;color:#374151;margin-bottom:6px;line-height:1.6;">${r}</li>`).join('')}</ol>`
            )}

            ${_previewSection('12. Conclusion', _previewNarrative(_narrativeConclusion(d)))}
        </div>`;
    }

    function _buildPreviewHTML_Year(yd, logoUrl) {
        const termRows = yd.terms.map(t => [
            t.term?.name || '—',
            `${CURRENCY}${_fmt(t.totalExpected)}`,
            `${CURRENCY}${_fmt(t.totalCollected)}`,
            `${t.collectionRate.toFixed(1)}%`,
            `${CURRENCY}${_fmt(t.totalOutstanding)}`,
        ]);
        const logoHtml = logoUrl
            ? `<img src="${logoUrl}" alt="School Logo"
                   style="width:72px;height:72px;object-fit:contain;border-radius:8px;
                          margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
            : `<div style="width:60px;height:60px;background:linear-gradient(135deg,#1a56db,#1e40af);
                            border-radius:50%;display:inline-flex;align-items:center;
                            justify-content:center;margin-bottom:12px;">
                   <i class="fas fa-file-invoice-dollar" style="color:#fff;font-size:24px;"></i>
               </div>`;

        return `
        <div style="font-family:'Segoe UI',Arial,sans-serif;padding:28px;background:#fff;max-height:600px;overflow-y:auto;">
            <div style="text-align:center;padding:20px 0 24px;border-bottom:3px solid #1a56db;margin-bottom:24px;">
                ${logoHtml}
                <div style="font-size:22px;font-weight:900;color:#0f2044;margin-bottom:4px;">${SCHOOL_NAME}</div>
                <div style="font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">${SCHOOL_TAGLINE}</div>
                <div style="font-size:16px;font-weight:700;color:#1a56db;margin-bottom:4px;">GENERAL ANNUAL FINANCIAL REPORT</div>
                <div style="font-size:13px;color:#374151;">Academic Year ${yd.year?.year}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Generated: ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}</div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;">
                ${[
                    { label: 'Year Total Billed',    value: `${CURRENCY}${_fmt(yd.totalExpected)}`,    color: '#1a56db' },
                    { label: 'Year Total Collected', value: `${CURRENCY}${_fmt(yd.totalCollected)}`,  color: '#059669' },
                    { label: 'Year Outstanding',     value: `${CURRENCY}${_fmt(yd.totalOutstanding)}`, color: '#dc2626' },
                    { label: 'Year Collection Rate', value: `${yd.collectionRate.toFixed(1)}%`,        color: yd.collectionRate >= 80 ? '#059669' : '#d97706' },
                ].map(k => `
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:17px;font-weight:800;color:${k.color};">${k.value}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px;">${k.label}</div>
                    </div>`).join('')}
            </div>

            ${_previewSection('Yearly Collection Trend',
                _previewTable(['Term', 'Expected', 'Collected', 'Rate', 'Outstanding'], termRows)
            )}

            ${yd.terms.map(t => `
                <div style="margin-bottom:28px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                    <div style="background:#1a56db;padding:10px 16px;">
                        <span style="color:#fff;font-weight:700;font-size:13px;">${t.term?.name || '—'}</span>
                        <span style="color:rgba(255,255,255,0.7);font-size:11px;margin-left:12px;">Collection: ${t.collectionRate.toFixed(1)}%</span>
                    </div>
                    <div style="padding:16px;">
                        ${_buildPreviewHTML_Term(t).replace(/^[\s\S]*?<\/div>\s*<!-- KPI/m, '<!-- KPI').split('</div>').slice(0, -1).join('</div>') + '</div>'}
                    </div>
                </div>`
            ).join('')}

            ${_previewSection('Year-End Financial Observations', `
                <ul style="margin:0;padding-left:18px;">
                    ${yd.bestTerm  ? `<li style="font-size:12.5px;color:#374151;margin-bottom:6px;">${yd.bestTerm.term?.name} recorded the best collection rate at ${yd.bestTerm.collectionRate.toFixed(1)}%.</li>` : ''}
                    ${yd.worstTerm ? `<li style="font-size:12.5px;color:#374151;margin-bottom:6px;">${yd.worstTerm.term?.name} recorded the weakest collection rate at ${yd.worstTerm.collectionRate.toFixed(1)}%.</li>` : ''}
                    <li style="font-size:12.5px;color:#374151;margin-bottom:6px;">Cumulative outstanding balance for the year: ${CURRENCY}${_fmt(yd.totalOutstanding)}.</li>
                </ul>
            `)}

            ${_previewSection('Year-End Conclusion', _previewNarrative(_narrativeYearlyConclusion(yd)))}
        </div>`;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // DOCX GENERATOR — JSZip raw XML (same approach as academic-report-generator.js)
    // ═════════════════════════════════════════════════════════════════════════════
    async function generateDOCX() {
        if (_generating) return;
        if (!_resolveSelections()) return;
        _generating = true;
        _setStatus('Generating DOCX report...', 'info');

        const docxBtn = document.getElementById('frg-btn-docx');
        if (docxBtn) docxBtn.disabled = true;

        try {
            const cached     = window._frgCurrentData;
            const logoBase64 = cached?.logoBase64 || null;

            let blob, label;
            if (_reportMode === 'term') {
                const d = (cached?.mode === 'term' && cached.d) ? cached.d : _computeTermData(_selectedYear, _selectedTerm);
                blob  = await _buildDocxTermZip(d, logoBase64);
                label = `Financial_Report_${_selectedYear.year}_${_selectedTerm.name.replace(/\s+/g, '_')}`;
            } else {
                const yd = (cached?.mode === 'year' && cached.yd) ? cached.yd : _computeYearData(_selectedYear);
                blob  = await _buildDocxYearZip(yd, logoBase64);
                label = `Annual_Financial_Report_${_selectedYear.year}`;
            }

            saveAs(blob, `${label}.docx`);
            _setStatus('DOCX report downloaded successfully.', 'success');
        } catch (err) {
            _setStatus('DOCX generation failed: ' + err.message, 'error');
            console.error('Financial DOCX error:', err);
        } finally {
            _generating = false;
            if (docxBtn) docxBtn.disabled = false;
        }
    }

    // ── XML helpers ───────────────────────────────────────────────────────────────
    function _xe(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function _frgH1(text) {
        return `<w:p>
            <w:pPr><w:pStyle w:val="Heading1"/>
                <w:spacing w:before="280" w:after="120"/>
                <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="1A56DB"/></w:pBdr>
            </w:pPr>
            <w:r><w:rPr><w:b/><w:color w:val="0F2044"/><w:sz w:val="32"/></w:rPr>
                <w:t>${_xe(text)}</w:t></w:r></w:p>`;
    }

    function _frgPara(text, opts = {}) {
        const color = opts.color || '374151';
        const bold  = opts.bold  ? '<w:b/>' : '';
        const sz    = opts.sz    || '22';
        const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
        return `<w:p>
            <w:pPr><w:spacing w:before="60" w:after="80"/>${align}</w:pPr>
            <w:r><w:rPr>${bold}<w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr>
                <w:t xml:space="preserve">${_xe(text)}</w:t></w:r></w:p>`;
    }

    function _frgBullet(text) {
        return `<w:p>
            <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
                <w:spacing w:before="40" w:after="40"/></w:pPr>
            <w:r><w:rPr><w:color w:val="374151"/><w:sz w:val="22"/></w:rPr>
                <w:t xml:space="preserve">${_xe(text)}</w:t></w:r></w:p>`;
    }

    function _frgSpacer() {
        return `<w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>`;
    }

    function _frgPageBreak() {
        return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }

    function _frgTable(headers, rows) {
        const thCells = headers.map(h =>
            `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1A56DB"/>
                <w:tcBorders><w:top w:val="single" w:sz="4" w:color="1A56DB"/>
                    <w:bottom w:val="single" w:sz="4" w:color="1A56DB"/>
                    <w:left w:val="single" w:sz="4" w:color="1A56DB"/>
                    <w:right w:val="single" w:sz="4" w:color="1A56DB"/></w:tcBorders></w:tcPr>
                <w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
                    <w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr>
                        <w:t xml:space="preserve">${_xe(h)}</w:t></w:r></w:p></w:tc>`
        ).join('');

        const dataRows = rows.map((row, ri) => {
            const fill = ri % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
            const cells = row.map(cell =>
                `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>
                    <w:tcBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>
                        <w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>
                        <w:left w:val="single" w:sz="4" w:color="CBD5E1"/>
                        <w:right w:val="single" w:sz="4" w:color="CBD5E1"/></w:tcBorders></w:tcPr>
                    <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>
                        <w:r><w:rPr><w:color w:val="374151"/><w:sz w:val="18"/></w:rPr>
                            <w:t xml:space="preserve">${_xe(String(cell ?? ''))}</w:t></w:r></w:p></w:tc>`
            ).join('');
            return `<w:tr>${cells}</w:tr>`;
        }).join('');

        return `<w:tbl>
            <w:tblPr><w:tblStyle w:val="TableGrid"/>
                <w:tblW w:w="9360" w:type="dxa"/>
                <w:tblBorders>
                    <w:top w:val="single" w:sz="4" w:color="CBD5E1"/>
                    <w:left w:val="single" w:sz="4" w:color="CBD5E1"/>
                    <w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>
                    <w:right w:val="single" w:sz="4" w:color="CBD5E1"/>
                    <w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>
                    <w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>
                </w:tblBorders>
                <w:tblLook w:val="04A0"/>
            </w:tblPr>
            <w:tr>${thCells}</w:tr>
            ${dataRows}
        </w:tbl>`;
    }

    function _frgCover(yearStr, termStr, reportTitle, genDate) {
        // Logo placeholder (replaced by _buildFinDocx if logo available)
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

        const periodLine = termStr
            ? `${_xe(termStr)}  |  Academic Year ${_xe(yearStr)}`
            : `Academic Year ${_xe(yearStr)}`;

        return [
            logoPlaceholder,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120"/></w:pPr>
                <w:r><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="0F2044"/></w:rPr>
                    <w:t>${_xe('Ridgevalley School')}</w:t></w:r></w:p>`,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="480"/></w:pPr>
                <w:r><w:rPr><w:sz w:val="22"/><w:color w:val="64748B"/></w:rPr>
                    <w:t>${_xe('BUILDING FUTURE TODAY')}</w:t></w:r></w:p>`,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="160"/>
                <w:pBdr><w:top w:val="single" w:sz="8" w:space="6" w:color="1A56DB"/>
                    <w:bottom w:val="single" w:sz="8" w:space="6" w:color="1A56DB"/></w:pBdr></w:pPr>
                <w:r><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1A56DB"/></w:rPr>
                    <w:t>${_xe(reportTitle)}</w:t></w:r></w:p>`,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="160" w:after="80"/></w:pPr>
                <w:r><w:rPr><w:sz w:val="28"/><w:color w:val="0F2044"/></w:rPr>
                    <w:t>${periodLine}</w:t></w:r></w:p>`,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="80"/></w:pPr>
                <w:r><w:rPr><w:i/><w:sz w:val="22"/><w:color w:val="94A3B8"/></w:rPr>
                    <w:t>Generated: ${_xe(genDate)}</w:t></w:r></w:p>`,
            `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="0"/></w:pPr>
                <w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="EF4444"/></w:rPr>
                    <w:t>CONFIDENTIAL — FOR LEADERSHIP USE ONLY</w:t></w:r></w:p>`,
        ].join('\n');
    }

    // ── Term DOCX builder ─────────────────────────────────────────────────────────
    async function _buildDocxTermZip(d, logoBase64 = null) {
        const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        const risks   = _narrativeRisks(d);
        const recs    = _narrativeRecommendations(d);
        const pct     = n => d.students.length > 0 ? ((n / d.students.length) * 100).toFixed(1) + '%' : '0%';

        const sections = [
            _frgCover(d.year?.year, d.term?.name, 'GENERAL FINANCIAL REPORT', genDate),
            _frgPageBreak(),
            _frgH1('1. Executive Summary'),
            _frgPara(_narrativeExecutiveSummary(d)),
            _frgSpacer(),
            _frgH1('2. Student Billing Overview'),
            _frgTable(
                ['Metric', 'Value'],
                [
                    ['Students Billed', String(d.students.filter(s => s.expected > 0).length)],
                    ['Total Expected',  `${CURRENCY}${_fmt(d.totalExpected)}`],
                    ['Total Collected', `${CURRENCY}${_fmt(d.totalCollected)}`],
                    ['Outstanding',     `${CURRENCY}${_fmt(d.totalOutstanding)}`],
                    ['Collection Rate', `${d.collectionRate.toFixed(1)}%`],
                ]
            ),
            _frgPara(_narrativeBillingOverview(d)),
            _frgSpacer(),
            _frgH1('3. Payment Performance by Level'),
            _frgTable(
                ['Level / Group', 'Expected', 'Collected', 'Outstanding', 'Rate'],
                d.levelBreakdown.map(l => [l.level, `${CURRENCY}${_fmt(l.expected)}`, `${CURRENCY}${_fmt(l.collected)}`, `${CURRENCY}${_fmt(l.outstanding)}`, `${l.rate.toFixed(1)}%`])
            ),
            _frgPara(_narrativePaymentPerformance(d)),
            _frgSpacer(),
            _frgH1('4. Arrears Analysis'),
            _frgTable(
                ['Metric', 'Value'],
                [
                    ['Students with Arrears',       String(d.arrearsList.length)],
                    ['Total Arrears Amount',         `${CURRENCY}${_fmt(d.totalOutstanding)}`],
                    ['Average Arrears per Student',  `${CURRENCY}${_fmt(d.avgArrears)}`],
                    ['Highest Debtor Class',         d.topDebtorClass || '—'],
                ]
            ),
            _frgPara(_narrativeArrears(d)),
            _frgSpacer(),
            _frgH1('5. Students with Outstanding Arrears'),
            d.arrearsList.length === 0
                ? _frgPara('No students with outstanding arrears recorded for this period.')
                : _frgTable(
                    ['Student Name', 'Class', 'Parent / Guardian', 'Contact', 'Expected', 'Paid', 'Outstanding', 'Status'],
                    d.arrearsList.map(s => [s.name, s.class, s.parentName, s.parentPhone, `${CURRENCY}${_fmt(s.expected)}`, `${CURRENCY}${_fmt(s.paid)}`, `${CURRENCY}${_fmt(s.outstanding)}`, s.status])
                ),
            _frgSpacer(),
            ...(d.paymentMethods.length > 0 ? [
                _frgH1('6. Payment Method Analysis'),
                _frgTable(
                    ['Payment Method', 'Transactions', 'Total Collected'],
                    d.paymentMethods.map(m => [m.method, String(m.count), `${CURRENCY}${_fmt(m.total)}`])
                ),
                _frgPara(_narrativePaymentMethods(d.paymentMethods)),
                _frgSpacer(),
            ] : []),
            _frgH1('7. Transaction Analysis'),
            _frgTable(
                ['Transaction Type', 'Count'],
                [
                    ['Total Transactions',  String(d.totalTxns)],
                    ['Confirmed',           String(d.confirmedTxns.length)],
                    ['Pending Review',      String(d.pendingTxns.length)],
                    ['Rejected / Failed',   String(d.failedTxns.length)],
                ]
            ),
            _frgPara(_narrativeTransactions(d)),
            _frgSpacer(),
            ...(d.monthlyTrend.length > 0 ? [
                _frgH1('8. Monthly Collection Trend'),
                _frgTable(
                    ['Month', 'Amount Collected'],
                    d.monthlyTrend.map(m => [m.month, `${CURRENCY}${_fmt(m.amount)}`])
                ),
                _frgPara(_narrativeMonthlyTrend(d)),
                _frgSpacer(),
            ] : []),
            _frgH1('9. Student Payment Compliance'),
            _frgTable(
                ['Status', 'Count', 'Percentage'],
                [
                    ['Fully Paid',      String(d.fullyPaid), pct(d.fullyPaid)],
                    ['Partial Payment', String(d.partial),   pct(d.partial)],
                    ['No Payment',      String(d.noPay),     pct(d.noPay)],
                ]
            ),
            _frgSpacer(),
            _frgPageBreak(),
            _frgH1('10. Financial Risks & Concerns'),
            ...risks.map(r => _frgBullet(r)),
            _frgSpacer(),
            _frgH1('11. Strategic Recommendations'),
            ...recs.map((r, i) => _frgBullet(`${i + 1}. ${r}`)),
            _frgSpacer(),
            _frgH1('12. Conclusion'),
            _frgPara(_narrativeConclusion(d)),
            _frgSpacer(),
            _frgPara(`— Report generated on ${genDate} by Ridgevalley SMS. Confidential — For Leadership Use Only. —`, { color: '94A3B8', sz: '18' }),
        ];

        return _buildFinDocx('Ridgevalley School', `Financial Report — ${d.term?.name} ${d.year?.year}`, sections, logoBase64);
    }

    // ── Year DOCX builder ─────────────────────────────────────────────────────────
    async function _buildDocxYearZip(yd, logoBase64 = null) {
        const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

        const termSections = yd.terms.map((t, i) => [
            i > 0 ? _frgPageBreak() : '',
            _frgH1(`${t.term?.name || `Term ${i + 1}`} — Detail`),
            _frgTable(
                ['Metric', 'Value'],
                [
                    ['Total Billed',    `${CURRENCY}${_fmt(t.totalExpected)}`],
                    ['Total Collected', `${CURRENCY}${_fmt(t.totalCollected)}`],
                    ['Outstanding',     `${CURRENCY}${_fmt(t.totalOutstanding)}`],
                    ['Collection Rate', `${t.collectionRate.toFixed(1)}%`],
                ]
            ),
            _frgH1('Payment by Level'),
            _frgTable(
                ['Level', 'Expected', 'Collected', 'Outstanding', 'Rate'],
                t.levelBreakdown.map(l => [l.level, `${CURRENCY}${_fmt(l.expected)}`, `${CURRENCY}${_fmt(l.collected)}`, `${CURRENCY}${_fmt(l.outstanding)}`, `${l.rate.toFixed(1)}%`])
            ),
            _frgH1('Students with Arrears'),
            t.arrearsList.length === 0
                ? _frgPara('No outstanding arrears.')
                : _frgTable(
                    ['Student', 'Class', 'Parent', 'Contact', 'Outstanding', 'Status'],
                    t.arrearsList.map(s => [s.name, s.class, s.parentName, s.parentPhone, `${CURRENCY}${_fmt(s.outstanding)}`, s.status])
                ),
            _frgPara(_narrativeArrears(t)),
            _frgSpacer(),
        ].join('\n')).join('\n');

        const sections = [
            _frgCover(yd.year?.year, null, 'GENERAL ANNUAL FINANCIAL REPORT', genDate),
            _frgPageBreak(),
            _frgH1('1. Year-at-a-Glance'),
            _frgTable(
                ['Metric', 'Value'],
                [
                    ['Total Billed',    `${CURRENCY}${_fmt(yd.totalExpected)}`],
                    ['Total Collected', `${CURRENCY}${_fmt(yd.totalCollected)}`],
                    ['Outstanding',     `${CURRENCY}${_fmt(yd.totalOutstanding)}`],
                    ['Collection Rate', `${yd.collectionRate.toFixed(1)}%`],
                    ...(yd.bestTerm  ? [['Best Collection Term',    `${yd.bestTerm.term?.name} (${yd.bestTerm.collectionRate.toFixed(1)}%)`]] : []),
                    ...(yd.worstTerm ? [['Weakest Collection Term', `${yd.worstTerm.term?.name} (${yd.worstTerm.collectionRate.toFixed(1)}%)`]] : []),
                ]
            ),
            _frgSpacer(),
            _frgH1('2. Yearly Collection by Term'),
            _frgTable(
                ['Term', 'Expected', 'Collected', 'Rate', 'Outstanding'],
                yd.terms.map(t => [t.term?.name || '—', `${CURRENCY}${_fmt(t.totalExpected)}`, `${CURRENCY}${_fmt(t.totalCollected)}`, `${t.collectionRate.toFixed(1)}%`, `${CURRENCY}${_fmt(t.totalOutstanding)}`])
            ),
            _frgSpacer(),
            _frgPageBreak(),
            termSections,
            _frgPageBreak(),
            _frgH1('Year-End Conclusion'),
            _frgPara(_narrativeYearlyConclusion(yd)),
            _frgSpacer(),
            _frgPara(`— Annual report generated on ${genDate} by Ridgevalley SMS. Confidential. —`, { color: '94A3B8', sz: '18' }),
        ];

        return _buildFinDocx('Ridgevalley School', `Annual Financial Report — ${yd.year?.year}`, sections, logoBase64);
    }

    // ── Core JSZip packager (mirrors _buildDocx in academic-report-generator.js) ──
    async function _buildFinDocx(school, title, sections, logoBase64 = null) {
        const bodyXml = sections.join('\n');

        let logoExt = 'png', logoContentType = 'image/png', logoBytes = null;
        if (logoBase64) {
            const match = logoBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
                const mime = match[1].toLowerCase();
                logoBytes  = match[2];
                if (mime.includes('jpeg') || mime.includes('jpg')) { logoExt = 'jpeg'; logoContentType = 'image/jpeg'; }
                else if (mime.includes('gif'))  { logoExt = 'gif';  logoContentType = 'image/gif'; }
                else if (mime.includes('webp')) { logoExt = 'webp'; logoContentType = 'image/webp'; }
            }
        }

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

        const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="bullet"/>
            <w:lvlText w:val="&#x2022;"/>
            <w:lvlJc w:val="left"/>
            <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1">
        <w:abstractNumId w:val="0"/>
    </w:num>
</w:numbering>`;

        const relsXml = logoBase64 ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
        Target="styles.xml"/>
    <Relationship Id="rId2"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering"
        Target="numbering.xml"/>
    <Relationship Id="rIdLogo"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        Target="media/school_logo.${logoExt}"/>
</Relationships>` : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
        Target="styles.xml"/>
    <Relationship Id="rId2"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering"
        Target="numbering.xml"/>
</Relationships>`;

        const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
    <Application>Ridgevalley SMS</Application>
    <Company>${_xe(school)}</Company>
</Properties>`;

        const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${_xe(title)}</dc:title>
    <dc:creator>${_xe(school)}</dc:creator>
    <cp:lastModifiedBy>${_xe(school)}</cp:lastModifiedBy>
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
    <Override PartName="/word/numbering.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
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
        zip.file('word/numbering.xml', numberingXml);
        zip.file('word/_rels/document.xml.rels', relsXml);
        zip.file('docProps/app.xml', appXml);
        zip.file('docProps/core.xml', coreXml);
        if (logoBase64 && logoBytes) {
            zip.file(`word/media/school_logo.${logoExt}`, logoBytes, { base64: true });
        }

        return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // PDF GENERATOR — uses print-quality HTML → window.print()
    // No server-side dependency; works entirely in the browser.
    // ═════════════════════════════════════════════════════════════════════════════
    async function generatePDF() {
        if (_generating) return;
        if (!_resolveSelections()) return;
        _generating = true;
        _setStatus('Preparing PDF...', 'info');

        const pdfBtn = document.getElementById('frg-btn-pdf');
        if (pdfBtn) pdfBtn.disabled = true;

        try {
            const cached  = window._frgCurrentData;
            const logoUrl = cached?.logoUrl || null;

            let htmlBody, title;
            if (_reportMode === 'term') {
                const d = (cached?.mode === 'term' && cached.d) ? cached.d : _computeTermData(_selectedYear, _selectedTerm);
                htmlBody = _buildPdfHTML_Term(d, logoUrl);
                title = `Financial Report — ${d.term?.name} ${d.year?.year}`;
            } else {
                const yd = (cached?.mode === 'year' && cached.yd) ? cached.yd : _computeYearData(_selectedYear);
                htmlBody = _buildPdfHTML_Year(yd, logoUrl);
                title = `Annual Financial Report — ${yd.year?.year}`;
            }

            const win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes,resizable=yes');
            if (!win) {
                _setStatus('Popup blocked. Please allow popups and try again.', 'error');
                return;
            }

            win.document.write(_wrapPdfDoc(title, htmlBody));
            win.document.close();

            win.onload = () => {
                setTimeout(() => { win.focus(); win.print(); }, 400);
            };

            _setStatus('PDF window opened — use Print → Save as PDF', 'success');
        } catch (err) {
            _setStatus('PDF generation failed: ' + err.message, 'error');
            console.error('Financial PDF error:', err);
        } finally {
            _generating = false;
            if (pdfBtn) pdfBtn.disabled = false;
        }
    }

    function _wrapPdfDoc(title, bodyHtml) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10pt; color: #374151; background: #fff; }
  h1 { font-size: 22pt; font-weight: 800; color: #0f2044; }
  h2 { font-size: 13pt; font-weight: 700; color: #0f2044; margin: 16pt 0 6pt; padding-bottom: 4pt; border-bottom: 2pt solid #1a56db; page-break-after: avoid; }
  h3 { font-size: 11pt; font-weight: 700; color: #1a56db; margin: 12pt 0 4pt; page-break-after: avoid; }
  p  { font-size: 10pt; line-height: 1.65; margin: 6pt 0; }
  ul, ol { margin: 6pt 0 6pt 18pt; }
  li { font-size: 10pt; line-height: 1.6; margin-bottom: 4pt; }
  .cover { text-align: center; padding: 60pt 0 40pt; page-break-after: always; }
  .cover .school-name { font-size: 28pt; font-weight: 800; color: #0f2044; margin-bottom: 6pt; }
  .cover .tagline     { font-size: 9pt; letter-spacing: 2pt; text-transform: uppercase; color: #64748b; margin-bottom: 28pt; }
  .cover .report-title{ font-size: 18pt; font-weight: 700; color: #1a56db; border-top: 2pt solid #1a56db; border-bottom: 2pt solid #1a56db; padding: 10pt 0; margin: 0 40pt 12pt; }
  .cover .period      { font-size: 13pt; color: #374151; margin-bottom: 6pt; }
  .cover .gen-date    { font-size: 9pt; color: #94a3b8; font-style: italic; }
  .cover .confidential{ font-size: 9pt; font-weight: 700; color: #dc2626; margin-top: 10pt; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin: 12pt 0; }
  .kpi-box { border: 1pt solid #cbd5e1; border-radius: 6pt; padding: 10pt 8pt; text-align: center; background: #f0f4ff; }
  .kpi-val { font-size: 14pt; font-weight: 800; }
  .kpi-lbl { font-size: 8pt; color: #64748b; margin-top: 2pt; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9pt; page-break-inside: auto; }
  thead { background: #e0e7ef; }
  th { padding: 6pt 7pt; text-align: left; font-weight: 700; color: #0f2044; font-size: 8.5pt; border: 0.5pt solid #cbd5e1; }
  td { padding: 5pt 7pt; border: 0.5pt solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  .badge-full    { background: #d1fae5; color: #065f46; padding: 1pt 6pt; border-radius: 10pt; font-size: 8pt; font-weight: 700; }
  .badge-partial { background: #fef3c7; color: #92400e; padding: 1pt 6pt; border-radius: 10pt; font-size: 8pt; font-weight: 700; }
  .badge-none    { background: #fee2e2; color: #991b1b; padding: 1pt 6pt; border-radius: 10pt; font-size: 8pt; font-weight: 700; }
  .page-break { page-break-before: always; }
  .section { margin-bottom: 20pt; }
  .footer-note { font-size: 8pt; color: #94a3b8; font-style: italic; margin-top: 20pt; text-align: center; }
  @media print {
    .no-print { display: none !important; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
    }

    function _pdfStatusBadge(status) {
        const cls = status === 'Fully Paid' ? 'badge-full' : status === 'Partial Payment' ? 'badge-partial' : 'badge-none';
        return `<span class="${cls}">${status}</span>`;
    }

    function _buildPdfHTML_Term(d, logoUrl) {
        const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        const risks = _narrativeRisks(d);
        const recs  = _narrativeRecommendations(d);
        const pct   = n => d.students.length > 0 ? ((n / d.students.length) * 100).toFixed(1) : 0;

        return `
<!-- COVER -->
<div class="cover">
  ${logoUrl ? `<img src="${logoUrl}" alt="School Logo" style="width:80px;height:80px;object-fit:contain;border-radius:8px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;">` : ''}
  <div class="school-name">${SCHOOL_NAME}</div>
  <div class="tagline">${SCHOOL_TAGLINE}</div>
  <div class="report-title">GENERAL FINANCIAL REPORT</div>
  <div class="period">${d.term?.name} &nbsp;|&nbsp; Academic Year ${d.year?.year}</div>
  <div class="gen-date">Generated: ${genDate}</div>
  <div class="confidential">&#x1F512; CONFIDENTIAL — FOR LEADERSHIP USE ONLY</div>
</div>

<!-- KPIs -->
<div class="kpi-row">
  <div class="kpi-box"><div class="kpi-val" style="color:#1a56db">${CURRENCY}${_fmt(d.totalExpected)}</div><div class="kpi-lbl">Total Billed</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#059669">${CURRENCY}${_fmt(d.totalCollected)}</div><div class="kpi-lbl">Total Collected</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#dc2626">${CURRENCY}${_fmt(d.totalOutstanding)}</div><div class="kpi-lbl">Outstanding</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:${d.collectionRate>=80?'#059669':'#d97706'}">${d.collectionRate.toFixed(1)}%</div><div class="kpi-lbl">Collection Rate</div></div>
</div>

<div class="section"><h2>1. Executive Summary</h2><p>${_narrativeExecutiveSummary(d)}</p></div>
<div class="section"><h2>2. Student Billing Overview</h2><p>${_narrativeBillingOverview(d)}</p></div>

<div class="section">
<h2>3. Payment Performance by Level</h2>
<table><thead><tr><th>Level</th><th>Expected</th><th>Collected</th><th>Outstanding</th><th>Rate</th></tr></thead>
<tbody>${d.levelBreakdown.map(l => `<tr><td>${l.level}</td><td>${CURRENCY}${_fmt(l.expected)}</td><td>${CURRENCY}${_fmt(l.collected)}</td><td>${CURRENCY}${_fmt(l.outstanding)}</td><td>${l.rate.toFixed(1)}%</td></tr>`).join('')}</tbody>
</table>
<p>${_narrativePaymentPerformance(d)}</p>
</div>

<div class="section"><h2>4. Arrears Analysis</h2>
<table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Students with Arrears</td><td>${d.arrearsList.length}</td></tr>
<tr><td>Total Arrears</td><td>${CURRENCY}${_fmt(d.totalOutstanding)}</td></tr>
<tr><td>Average Arrears / Student</td><td>${CURRENCY}${_fmt(d.avgArrears)}</td></tr>
<tr><td>Highest Debtor Class</td><td>${d.topDebtorClass}</td></tr>
</tbody></table>
<p>${_narrativeArrears(d)}</p>
</div>

<div class="section page-break">
<h2>5. Students with Outstanding Arrears</h2>
${d.arrearsList.length === 0 ? '<p>No outstanding arrears recorded for this period.</p>' : `
<table><thead><tr><th>Student</th><th>Class</th><th>Parent</th><th>Contact</th><th>Expected</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
<tbody>${d.arrearsList.map(s => `<tr>
  <td>${s.name}</td><td>${s.class}</td><td>${s.parentName}</td><td>${s.parentPhone}</td>
  <td>${CURRENCY}${_fmt(s.expected)}</td><td>${CURRENCY}${_fmt(s.paid)}</td><td><strong>${CURRENCY}${_fmt(s.outstanding)}</strong></td>
  <td>${_pdfStatusBadge(s.status)}</td>
</tr>`).join('')}
</tbody></table>`}
</div>

${d.paymentMethods.length > 0 ? `
<div class="section"><h2>6. Payment Method Analysis</h2>
<table><thead><tr><th>Method</th><th>Transactions</th><th>Total Collected</th></tr></thead>
<tbody>${d.paymentMethods.map(m => `<tr><td>${m.method}</td><td>${m.count}</td><td>${CURRENCY}${_fmt(m.total)}</td></tr>`).join('')}
</tbody></table>
<p>${_narrativePaymentMethods(d.paymentMethods)}</p>
</div>` : ''}

<div class="section"><h2>7. Transaction Analysis</h2>
<table><thead><tr><th>Type</th><th>Count</th></tr></thead>
<tbody>
<tr><td>Total Transactions</td><td>${d.totalTxns}</td></tr>
<tr><td>Confirmed</td><td>${d.confirmedTxns.length}</td></tr>
<tr><td>Pending</td><td>${d.pendingTxns.length}</td></tr>
<tr><td>Rejected</td><td>${d.failedTxns.length}</td></tr>
</tbody></table>
<p>${_narrativeTransactions(d)}</p>
</div>

${d.monthlyTrend.length > 0 ? `
<div class="section"><h2>8. Monthly Collection Trend</h2>
<table><thead><tr><th>Month</th><th>Collected</th></tr></thead>
<tbody>${d.monthlyTrend.map(m => `<tr><td>${m.month}</td><td>${CURRENCY}${_fmt(m.amount)}</td></tr>`).join('')}
</tbody></table>
<p>${_narrativeMonthlyTrend(d)}</p>
</div>` : ''}

<div class="section"><h2>9. Student Payment Compliance</h2>
<table><thead><tr><th>Status</th><th>Count</th><th>Percentage</th></tr></thead>
<tbody>
<tr><td>Fully Paid</td><td>${d.fullyPaid}</td><td>${pct(d.fullyPaid)}%</td></tr>
<tr><td>Partial Payment</td><td>${d.partial}</td><td>${pct(d.partial)}%</td></tr>
<tr><td>No Payment</td><td>${d.noPay}</td><td>${pct(d.noPay)}%</td></tr>
</tbody></table>
</div>

<div class="section page-break"><h2>10. Financial Risks &amp; Concerns</h2>
<ul>${risks.map(r => `<li>${r}</li>`).join('')}</ul>
</div>

<div class="section"><h2>11. Strategic Recommendations</h2>
<ol>${recs.map(r => `<li>${r}</li>`).join('')}</ol>
</div>

<div class="section"><h2>12. Conclusion</h2><p>${_narrativeConclusion(d)}</p></div>

<p class="footer-note">— Report generated on ${genDate} by Ridgevalley SMS. Confidential — For Leadership Use Only. —</p>`;
    }

    function _buildPdfHTML_Year(yd, logoUrl) {
        const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

        const termRows = yd.terms.map(t => `<tr>
            <td>${t.term?.name || '—'}</td>
            <td>${CURRENCY}${_fmt(t.totalExpected)}</td>
            <td>${CURRENCY}${_fmt(t.totalCollected)}</td>
            <td>${t.collectionRate.toFixed(1)}%</td>
            <td>${CURRENCY}${_fmt(t.totalOutstanding)}</td>
        </tr>`).join('');

        const termDetails = yd.terms.map((t, i) => `
<div class="section ${i > 0 ? 'page-break' : ''}">
<h2>${t.term?.name || `Term ${i + 1}`} — Detail</h2>
<div class="kpi-row">
  <div class="kpi-box"><div class="kpi-val" style="color:#1a56db">${CURRENCY}${_fmt(t.totalExpected)}</div><div class="kpi-lbl">Billed</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#059669">${CURRENCY}${_fmt(t.totalCollected)}</div><div class="kpi-lbl">Collected</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#dc2626">${CURRENCY}${_fmt(t.totalOutstanding)}</div><div class="kpi-lbl">Outstanding</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:${t.collectionRate>=80?'#059669':'#d97706'}">${t.collectionRate.toFixed(1)}%</div><div class="kpi-lbl">Rate</div></div>
</div>
<h3>Payment by Level</h3>
<table><thead><tr><th>Level</th><th>Expected</th><th>Collected</th><th>Outstanding</th><th>Rate</th></tr></thead>
<tbody>${t.levelBreakdown.map(l => `<tr><td>${l.level}</td><td>${CURRENCY}${_fmt(l.expected)}</td><td>${CURRENCY}${_fmt(l.collected)}</td><td>${CURRENCY}${_fmt(l.outstanding)}</td><td>${l.rate.toFixed(1)}%</td></tr>`).join('')}
</tbody></table>
<h3>Students with Arrears</h3>
${t.arrearsList.length === 0 ? '<p>No outstanding arrears.</p>' : `
<table><thead><tr><th>Student</th><th>Class</th><th>Parent</th><th>Contact</th><th>Outstanding</th><th>Status</th></tr></thead>
<tbody>${t.arrearsList.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.parentName}</td><td>${s.parentPhone}</td><td>${CURRENCY}${_fmt(s.outstanding)}</td><td>${_pdfStatusBadge(s.status)}</td></tr>`).join('')}
</tbody></table>`}
<p>${_narrativeArrears(t)}</p>
</div>`).join('');

        return `
<!-- COVER -->
<div class="cover">
  ${logoUrl ? `<img src="${logoUrl}" alt="School Logo" style="width:80px;height:80px;object-fit:contain;border-radius:8px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;">` : ''}
  <div class="school-name">${SCHOOL_NAME}</div>
  <div class="tagline">${SCHOOL_TAGLINE}</div>
  <div class="report-title">GENERAL ANNUAL FINANCIAL REPORT</div>
  <div class="period">Academic Year ${yd.year?.year}</div>
  <div class="gen-date">Generated: ${genDate}</div>
  <div class="confidential">&#x1F512; CONFIDENTIAL — FOR LEADERSHIP USE ONLY</div>
</div>

<div class="kpi-row">
  <div class="kpi-box"><div class="kpi-val" style="color:#1a56db">${CURRENCY}${_fmt(yd.totalExpected)}</div><div class="kpi-lbl">Year Total Billed</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#059669">${CURRENCY}${_fmt(yd.totalCollected)}</div><div class="kpi-lbl">Year Collected</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:#dc2626">${CURRENCY}${_fmt(yd.totalOutstanding)}</div><div class="kpi-lbl">Year Outstanding</div></div>
  <div class="kpi-box"><div class="kpi-val" style="color:${yd.collectionRate>=80?'#059669':'#d97706'}">${yd.collectionRate.toFixed(1)}%</div><div class="kpi-lbl">Year Rate</div></div>
</div>

<div class="section"><h2>1. Yearly Collection Trend</h2>
<table><thead><tr><th>Term</th><th>Expected</th><th>Collected</th><th>Rate</th><th>Outstanding</th></tr></thead>
<tbody>${termRows}</tbody></table>
</div>

${termDetails}

<div class="section page-break"><h2>Best &amp; Worst Periods</h2>
<table><thead><tr><th>Metric</th><th>Detail</th></tr></thead>
<tbody>
${yd.bestTerm  ? `<tr><td>Best Collection Term</td><td>${yd.bestTerm.term?.name} (${yd.bestTerm.collectionRate.toFixed(1)}%)</td></tr>` : ''}
${yd.worstTerm ? `<tr><td>Weakest Collection Term</td><td>${yd.worstTerm.term?.name} (${yd.worstTerm.collectionRate.toFixed(1)}%)</td></tr>` : ''}
</tbody></table>
</div>

<div class="section"><h2>Year-End Conclusion</h2><p>${_narrativeYearlyConclusion(yd)}</p></div>
<p class="footer-note">— Annual report generated on ${genDate} by Ridgevalley SMS. Confidential. —</p>`;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═════════════════════════════════════════════════════════════════════════════
    function _fmt(num) {
        const n = parseFloat(num) || 0;
        return n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _downloadBlob(buffer, filename, mimeType) {
        const blob = new Blob([buffer], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    }

    function _setStatus(msg, type) {
        const el = document.getElementById('frg-status');
        if (!el) return;
        const styles = {
            info:    'background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;',
            success: 'background:#f0fdf4;border:1px solid #86efac;color:#15803d;',
            warning: 'background:#fffbeb;border:1px solid #fde68a;color:#92400e;',
            error:   'background:#fef2f2;border:1px solid #fecaca;color:#991b1b;',
        };
        const icons = { info: 'fa-info-circle', success: 'fa-check-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle' };
        el.style.cssText = styles[type] || styles.info;
        el.innerHTML = `<i class="fas ${icons[type] || icons.info}" style="margin-right:6px;"></i>${msg}`;
        el.style.display = 'block';
    }

    function _clearStatus() {
        const el = document.getElementById('frg-status');
        if (el) el.style.display = 'none';
    }

    function _setBtnsLoading(loading) {
        ['frg-btn-docx', 'frg-btn-pdf', 'frg-btn-preview'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = loading;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═════════════════════════════════════════════════════════════════════════════
    return {
        renderFinancialReportSection,
        previewReport,
        generateDOCX,
        generatePDF,
        _generate,
        _setMode,
        _onYearChange,
    };

})();

// ── Integration hook ─────────────────────────────────────────────────────────────
// This file extends renderDataAnalysis() (from academic-report-generator.js).
// It appends the Financial Report section after the academic report section renders.
//
// USAGE in academic-report-generator.js (or wherever renderDataAnalysis is defined):
//
//   After injecting the existing analysis HTML into the container, append:
//
//     const frgSection = financialReportGenerator.renderFinancialReportSection();
//     container.insertAdjacentHTML('beforeend', frgSection);
//     // Then prime the year selector:
//     financialReportGenerator._onYearChange();
//
// ── Standalone self-injection (safe fallback) ────────────────────────────────────
// If the module is loaded AFTER renderDataAnalysis has already rendered,
// we watch for the data_analysis view to open and inject automatically.
(function _autoInject() {
    let _lastView = '';

    function _tryInject() {
        if (typeof state === 'undefined') return;
        if (state.currentView !== 'data_analysis') { _lastView = state.currentView; return; }
        if (_lastView === 'data_analysis') return; // already injected for this view load
        _lastView = 'data_analysis';

        const container = document.getElementById('view-content');
        if (!container) return;

        // Wait for the academic report section to render (it uses setTimeout 80ms)
        setTimeout(() => {
            if (!document.getElementById('frg-section')) {
                const frgHtml = financialReportGenerator.renderFinancialReportSection();
                container.insertAdjacentHTML('beforeend', frgHtml);
                financialReportGenerator._onYearChange();
                // Highlight default mode card
                financialReportGenerator._setMode('term');
            }
        }, 200);
    }

    // Poll for view changes (lightweight — stops when element removed)
    const _interval = setInterval(() => {
        if (typeof state === 'undefined') return;
        _tryInject();
    }, 300);

    // Clean up after 10 min to avoid indefinite polling
    setTimeout(() => clearInterval(_interval), 600000);
})();