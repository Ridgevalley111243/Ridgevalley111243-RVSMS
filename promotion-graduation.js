// ==================================================================================
// promotion-graduation.js — Ridgevalley School Management System
// Student Promotion & Graduation Management Module
//
// OVERVIEW:
//   Adds full promotion + graduation lifecycle management to the admin dashboard.
//   Triggered when current term is "Term Three" / "Third Term" AND a new academic
//   year is being created.  Integrates with existing state, supabaseClient, modal,
//   ui, actions, dataManager — all existing systems untouched.
//
// DATABASE TABLES USED:
//   students              — update class_id, class, level, grade after promotion
//   graduated_students    — new table (see SQL below); archived graduation records
//   promotion_log         — new table; prevents double-promotion per AY transition
//
// LOAD ORDER: load AFTER app.js and features.js in index.html:
//   <script src="promotion-graduation.js"></script>
//   <script src="optimistic-ui.js"></script>   ← last
//
// SQL to run ONCE in Supabase SQL editor before using this module:
// ─────────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS graduated_students (
//   id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   student_id               TEXT NOT NULL,          -- TEXT: matches students.id (TEXT, not UUID)
//   admission_number         TEXT,
//   full_name                TEXT NOT NULL,
//   gender                   TEXT,
//   date_of_birth            TEXT,
//   age                      TEXT,
//   parent_phone             TEXT,
//   final_class_id           UUID,                   -- UUID FK to classes.id
//   final_class_name         TEXT NOT NULL,
//   graduation_year          TEXT NOT NULL,
//   graduation_term          TEXT NOT NULL,
//   admission_academic_year  TEXT,
//   graduation_academic_year TEXT NOT NULL,
//   academic_year_range      TEXT NOT NULL,
//   status                   TEXT DEFAULT 'graduated',
//   graduated_by             UUID,                   -- UUID FK to users/auth
//   graduated_at             TIMESTAMPTZ DEFAULT now(),
//   created_at               TIMESTAMPTZ DEFAULT now()
// );
//
// CREATE TABLE IF NOT EXISTS promotion_logs (
//   id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   student_id    TEXT NOT NULL,
//   action        TEXT NOT NULL,        -- 'promoted' | 'graduated'
//   from_class    TEXT,
//   to_class      TEXT,
//   from_year     TEXT NOT NULL,
//   to_year       TEXT NOT NULL,
//   performed_by  UUID,
//   performed_at  TIMESTAMPTZ DEFAULT now()
// );
//
// ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
// ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_year TEXT;
// ─────────────────────────────────────────────────────────────────
// ==================================================================================

'use strict';

// ── Global state extensions ───────────────────────────────────────────────────────
// Attach to the existing state object so all views can read it
if (typeof state !== 'undefined') {
    state.graduatedStudents = state.graduatedStudents || [];
    state.promotionLogs     = state.promotionLogs     || [];
}

// ── Render-lock flag ──────────────────────────────────────────────────────────────
// Set to true while a promotion/graduation action is running.
// _refreshPromotionIfOpen respects this flag so that dataManager.loadStudents()
// and dataManager.loadClasses() — which are called inside _runPromotion and
// graduateStudents — do NOT trigger a re-render mid-action and cause UI flicker.
let _promotionActionRunning = false;

// ── Class progression map ─────────────────────────────────────────────────────────
// Maps a student's current class grade to their NEXT class grade.
// Keys and values are the "grade" portion (e.g. "Class 1", "Grade 1").
// Extend or modify this map to match the actual school structure.
// ── Grade alias normaliser ───────────────────────────────────────────────────────
// Maps every known spelling/casing variant of a grade to a single canonical key
// that exists in PROMOTION_MAP.  Run a raw grade string through this before any
// map lookup so that 'KINDERGARTEN 2', 'Kindergarten 2', 'KG2', 'K.G. 2', etc.
// all resolve correctly.
function _canonicalGrade(raw) {
    if (!raw) return '';
    // Collapse whitespace, remove dots/hyphens internal to words, uppercase for matching
    const s = raw.trim().replace(/\s{2,}/g, ' ');
    const u = s.toUpperCase();
    // Kindergarten variants -> KG N
    const kgMatch = u.match(/^K\.?\s*G\.?\s*(\d+)$/) || u.match(/^KINDERGARTEN\s*(\d+)$/);
    if (kgMatch) return 'KG ' + kgMatch[1];
    // Nursery variants -> Nursery N
    const nurMatch = u.match(/^NURSERY\s*(\d+)$/);
    if (nurMatch) return 'Nursery ' + nurMatch[1];
    // Already in canonical form — return as-is (case preserved for map lookup)
    return s;
}

const PROMOTION_MAP = {
    // Numeric 'Class X' style
    'Class 1':  'Class 2',
    'Class 2':  'Class 3',
    'Class 3':  'Class 4',
    'Class 4':  'Class 5',
    'Class 5':  'Class 6',
    // 'Grade X' style
    'Grade 1':  'Grade 2',
    'Grade 2':  'Grade 3',
    'Grade 3':  'Grade 4',
    'Grade 4':  'Grade 5',
    'Grade 5':  'Grade 6',
    // 'Year X' style
    'Year 1':   'Year 2',
    'Year 2':   'Year 3',
    'Year 3':   'Year 4',
    'Year 4':   'Year 5',
    'Year 5':   'Year 6',
    // 'Form X' style
    'Form 1':   'Form 2',
    'Form 2':   'Form 3',
    'Form 3':   'Form 4',
    'Form 4':   'Form 5',
    'Form 5':   'Form 6',
    // 'Basic X' style
    'Basic 1':  'Basic 2',
    'Basic 2':  'Basic 3',
    'Basic 3':  'Basic 4',
    'Basic 4':  'Basic 5',
    'Basic 5':  'Basic 6',
    // Junior High styles
    'JHS 1':    'JHS 2',
    'JHS 2':    'JHS 3',
    // Pre-school progression
    // All KG/Nursery variants are normalised to these canonical keys via _canonicalGrade()
    // before lookup, so 'KINDERGARTEN 1', 'Kindergarten 1', 'KG1', etc. all match.
    'Nursery 1': 'Nursery 2',
    'Nursery 2': 'KG 1',
    'KG 1':      'KG 2',
    // KG 2 -> Basic 1: completes pre-school, NOT a graduation.
    'KG 2':      'Basic 1',
};

// These grades are the terminal graduation grades — students here get graduated.
// Covers every casing/label variant that the normalizer or UI may produce.
// Comparison is done lower-case via _isGraduationGradeStr(), so only add
// canonical lower-case strings here.
const GRADUATION_GRADES_LC = new Set([
    // Numeric "Class X"
    'class 6',
    // "Grade X"
    'grade 6',
    // "Year X"
    'year 6',
    // "Form X"
    'form 6',
    // Junior High
    'jhs 3',
    // Primary / legacy
    'primary 6', 'p6', 'basic 6', 'b6',
    // NOTE: 'kg 2' is intentionally excluded here.
    // KG 2 completes pre-school but students are NOT archived — they are
    // promoted to Basic 1 (the first primary class) as active students.
    // See PROMOTION_MAP: 'KG 2' → 'Basic 1'.
    // Nursery terminal if school ends there
    // (add 'nursery 2' here if needed)
]);

// Legacy Set kept for any direct GRADUATION_GRADES.has() calls inside the file
// — proxied through the lower-cased set so mixed-case keys still match.
const GRADUATION_GRADES = new Proxy(new Set(), {
    get(target, prop) {
        if (prop === 'has') return (v) => GRADUATION_GRADES_LC.has((v || '').trim().toLowerCase());
        if (prop === 'size') return GRADUATION_GRADES_LC.size;
        return typeof GRADUATION_GRADES_LC[prop] === 'function'
            ? GRADUATION_GRADES_LC[prop].bind(GRADUATION_GRADES_LC)
            : GRADUATION_GRADES_LC[prop];
    }
});

// ── Helper: detect if current term is a "Term Three" variant ─────────────────────
function isTermThree(termName) {
    if (!termName) return false;
    const n = termName.toLowerCase().trim();
    return n === 'term 3' || n === 'term three' || n === 'third term' || n === '3rd term';
}

// ── Helper: detect UUID strings ───────────────────────────────────────────────────
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helper: normalise class label for comparison ──────────────────────────────────
function _normClassLabel(s) {
    return (s || '').trim().replace(/\s{2,}/g, ' ').replace(/\s*-\s*/g, ' - ').toLowerCase();
}

// ── Helper: resolve a class object for a student using all available signals ──────
// Tries (in order): class_id FK → readable class label → UUID-in-class field repair.
// Only considers non-soft-deleted classes.
// Returns null only when the class genuinely cannot be found.
function _resolveClassObj(student) {
    // Active (non-deleted) classes only — mirrors what the rest of the app uses
    const activeClasses = (state.classes || []).filter(c => !c.deleted_at && c.status !== 'deleted');

    // 1. Authoritative: class_id FK
    if (student.class_id) {
        const byId = activeClasses.find(c => c.id === student.class_id);
        if (byId) return byId;
        // class_id present but class was deleted — fall through to label match
    }

    // 2. class field contains a UUID that we can look up by id
    if (student.class && _UUID_RE.test(student.class.trim())) {
        const byUUID = activeClasses.find(c => c.id === student.class.trim());
        if (byUUID) return byUUID;
    }

    // 3. Fallback: match readable label (handles restored classes / missing class_id)
    if (student.class && !_UUID_RE.test(student.class.trim())) {
        const norm = _normClassLabel(student.class);

        // 3a. Exact "level - grade" match
        const byLabel = activeClasses.find(c =>
            _normClassLabel(`${c.level} - ${c.grade}`) === norm
        );
        if (byLabel) return byLabel;

        // 3b. Partial: just the grade portion matches
        const gradePart = norm.includes(' - ') ? norm.split(' - ').pop().trim() : norm;
        const byGrade = activeClasses.find(c =>
            _normClassLabel(c.grade) === gradePart
        );
        if (byGrade) return byGrade;
    }

    // 4. LAST RESORT: search ALL classes including soft-deleted ones.
    // Pre-school students whose class_id points to a class soft-deleted when
    // the new academic year was set up would otherwise return null here,
    // causing them to vanish entirely from the promotion panel.
    const allClasses = (state.classes || []);
    if (student.class_id) {
        const byIdAll = allClasses.find(c => c.id === student.class_id);
        if (byIdAll) return byIdAll;
    }
    if (student.class && !_UUID_RE.test(student.class.trim())) {
        const normAll = _normClassLabel(student.class);
        const byLabelAll = allClasses.find(c =>
            _normClassLabel(`${c.level} - ${c.grade}`) === normAll
        );
        if (byLabelAll) return byLabelAll;
        const gradePartAll = normAll.includes(' - ') ? normAll.split(' - ').pop().trim() : normAll;
        const byGradeAll   = allClasses.find(c => _normClassLabel(c.grade) === gradePartAll);
        if (byGradeAll) return byGradeAll;
    }

    return null;
}

// ── Helper: get the "next" class object for a given student ───────────────────────
function getNextClass(student) {
    const currentClass = _resolveClassObj(student);
    // NOTE: currentClass may be null when the student's class was soft-deleted
    // (e.g. pre-school classes archived on new-year creation). We do NOT bail
    // immediately — we extract the grade from the raw class label as a fallback.

    // Extract grade text: from resolved class object if available, else from
    // the last segment of the student.class label (e.g. 'PRE-SCHOOL - KG 1' -> 'KG 1')
    let rawGrade = currentClass ? (currentClass.grade || '').trim() : '';
    if (!rawGrade && student.class && !_UUID_RE.test(student.class.trim())) {
        const parts = student.class.trim().split(/\s*-\s*/);
        rawGrade = parts[parts.length - 1].trim();
    }
    if (!rawGrade) return null;

    // Canonicalise the raw grade (e.g. 'KINDERGARTEN 2' -> 'KG 2', 'NURSERY 1' -> 'Nursery 1')
    // before looking it up in PROMOTION_MAP so all spelling variants match correctly.
    const canonGrade  = _canonicalGrade(rawGrade);
    const canonGradeLc = canonGrade.toLowerCase().replace(/\s{2,}/g, ' ');

    // Map lookup: exact canonical key first, then case-insensitive scan
    let nextGrade = PROMOTION_MAP[canonGrade];
    if (!nextGrade) {
        const entry = Object.entries(PROMOTION_MAP).find(
            ([k]) => k.toLowerCase().replace(/\s{2,}/g, ' ') === canonGradeLc
        );
        nextGrade = entry ? entry[1] : null;
    }
    if (!nextGrade) return null;

    const nextGradeLc    = nextGrade.toLowerCase().replace(/\s{2,}/g, ' ');
    const currentLevelLc = currentClass ? (currentClass.level || '').trim().toLowerCase() : '';

    // Search active classes for the target grade.
    // We compare using _canonicalGrade() on BOTH sides so that a DB grade of
    // 'KINDERGARTEN 1' correctly matches a PROMOTION_MAP value of 'KG 1'.
    const activeClasses = (state.classes || []).filter(c => !c.deleted_at && c.status !== 'deleted');

    // Helper: does a class's grade (after canonicalisation) match nextGradeLc?
    const gradeMatches = c =>
        _canonicalGrade((c.grade || '').trim()).toLowerCase().replace(/\s{2,}/g, ' ') === nextGradeLc;

    // Primary: same level + matching grade
    const sameLevel = currentLevelLc
        ? activeClasses.find(c =>
            (c.level || '').trim().toLowerCase() === currentLevelLc && gradeMatches(c)
          )
        : null;
    if (sameLevel) return sameLevel;

    // Fallback: any level — covers cross-level promotions (KG 2 -> Basic 1)
    // and schools that split the same level across multiple level labels.
    const anyLevel = activeClasses.find(c => gradeMatches(c));
    return anyLevel || null;
}

// ── Helper: check if a student is in graduation grade ────────────────────────────
function isGraduationGrade(student) {
    // ── 1. Resolved class object (authoritative) ──────────────────────────────────
    const classObj = _resolveClassObj(student);
    if (classObj) {
        // Check grade field
        if (GRADUATION_GRADES.has(classObj.grade.trim())) return true;
        // Also check the readable label in case grade alone doesn't match
        const readableLabel = `${classObj.level} - ${classObj.grade}`.trim().toLowerCase();
        for (const g of GRADUATION_GRADES_LC) {
            if (readableLabel.includes(g)) return true;
        }
        return false;
    }

    // ── 2. Raw class field fallback (handles UUID-corruption / missing class_id) ──
    const raw = (student.class || '').trim();
    if (!raw || _UUID_RE.test(raw)) return false;

    const rawLc = raw.toLowerCase();

    // a) Last segment after " - " separator (e.g. "PRE-SCHOOL - KINDERGARTEN 2")
    const parts = raw.split(/\s*-\s*/);
    const gradePart = parts[parts.length - 1].trim();
    if (GRADUATION_GRADES.has(gradePart)) return true;

    // b) Whole label (e.g. "Primary 6" with no separator)
    if (GRADUATION_GRADES.has(raw)) return true;

    // c) Substring match for safety (catches "Class 6A", "JHS 3 - Science" etc.)
    for (const g of GRADUATION_GRADES_LC) {
        if (rawLc.includes(g)) return true;
    }

    return false;
}

// ── Helper: normalise grade for promotion map lookup ─────────────────────────────
function resolvePromotionTarget(student) {
    const classObj = _resolveClassObj(student);
    // NOTE: classObj may be null if the student's class was soft-deleted when the
    // new year started. We do NOT bail here — we fall through to raw-text lookup.
    if (classObj) {
        if (GRADUATION_GRADES.has(classObj.grade.trim())) return 'GRADUATE';
        const nextClass = getNextClass(student);
        if (nextClass) return nextClass;
    }

    // FIX: cross-level promotion fallback (e.g. KG 2 → Basic 1).
    // getNextClass() returns null when the PROMOTION_MAP has a valid next grade
    // but no matching class object exists in state.classes under ANY level
    // (e.g. the Basic 1 class hasn't been created yet for the new year).
    // Without this, KG 2 students silently fall out of BOTH lists — they're not
    // graduation candidates AND resolvePromotionTarget returns null, so they are
    // excluded from promoCandidates too and simply vanish from the UI.
    //
    // Return 'CROSS_LEVEL_PENDING' so callers know there IS a mapped next grade
    // but the target class isn't set up yet. The promotion panel will show these
    // students under their current class with a "target class not found" warning.
    // Extract grade text, canonicalise it, then check PROMOTION_MAP.
    // Uses _canonicalGrade() so 'KINDERGARTEN 2' -> 'KG 2' etc. all match.
    let rawGrade = classObj ? (classObj.grade || '').trim() : '';
    if (!rawGrade && student.class && !_UUID_RE.test(student.class.trim())) {
        const parts = student.class.trim().split(/\s*-\s*/);
        rawGrade = parts[parts.length - 1].trim();
    }
    const canonGrade   = _canonicalGrade(rawGrade);
    const canonGradeLc = canonGrade.toLowerCase().replace(/\s{2,}/g, ' ');
    const entry = canonGrade
        ? (PROMOTION_MAP[canonGrade]
            || (Object.entries(PROMOTION_MAP).find(([k]) =>
                k.toLowerCase().replace(/\s{2,}/g, ' ') === canonGradeLc
            ) || [])[1])
        : null;
    return entry ? 'CROSS_LEVEL_PENDING' : null;
}

// ── Helper: load graduated students ──────────────────────────────────────────────
async function loadGraduatedStudents() {
    try {
        const { data, error } = await supabaseClient
            .from('graduated_students')
            .select('*')
            .order('graduated_at', { ascending: false });
        if (error) throw error;
        state.graduatedStudents = data || [];
    } catch (err) {
        console.warn('loadGraduatedStudents error:', err);
        state.graduatedStudents = [];
    }
}

// ── Helper: load promotion logs ───────────────────────────────────────────────────
async function loadPromotionLogs() {
    try {
        const { data, error } = await supabaseClient
            .from('promotion_log')
            .select('*')
            .order('promoted_at', { ascending: false });
        if (error) throw error;
        state.promotionLogs = data || [];
    } catch (err) {
        console.warn('loadPromotionLogs error:', err);
        state.promotionLogs = [];
    }
}

// ── Core promotion engine ─────────────────────────────────────────────────────────
const promotionEngine = {

    // Check if promotion has already been done for this AY transition
    hasAlreadyPromoted(fromYear, toYear) {
        return (state.promotionLogs || []).some(
            log => log.from_year === fromYear && log.to_year === toYear
        );
    },

    // Graduate a list of students (Class Six students)
    async graduateStudents(students, fromAY, toAY) {
        const results = { success: [], failed: [] };

        // ── Step 1: Validate graduation eligibility prerequisites ─────────────────
        if (!fromAY || !fromAY.year) {
            console.error('[graduation] ABORT: fromAY or fromAY.year is missing', { fromAY, toAY });
            throw new Error('Cannot graduate students: current academic year is missing.');
        }
        if (!toAY || !toAY.year) {
            console.error('[graduation] ABORT: toAY or toAY.year is missing', { fromAY, toAY });
            throw new Error('Cannot graduate students: target academic year is missing.');
        }

        const graduationYear = toAY.year;
        const finalTerm      = (fromAY.terms || []).find(t => isTermThree(t.name))?.name || 'Term 3';
        const graduatedAt    = new Date().toISOString();
        const graduatedBy    = state.currentUser?.id || null;   // UUID or null — real UUID column

        for (const student of students) {
            try {
                // ── Step 1 (per-student): Validate graduation eligibility ──────────
                if (!student || !student.id) {
                    console.error('[graduation] Skipping student with missing id:', student);
                    results.failed.push({ student, error: 'Student record has no id' });
                    continue;
                }

                // ── Step 2: Validate required database fields ─────────────────────
                // student.id is TEXT in the students table — do NOT coerce to UUID
                const studentIdText = String(student.id).trim();
                if (!studentIdText) {
                    throw new Error(`student_id is empty for student: ${student.name}`);
                }

                // Resolve class using robust resolver (handles restored / soft-deleted classes)
                const classObj = _resolveClassObj(student);

                // final_class_name: readable label — required
                const finalClassName = classObj
                    ? `${classObj.level} - ${classObj.grade}`
                    : (student.class && !_UUID_RE.test(student.class.trim())
                        ? student.class.trim()
                        : null);

                if (!finalClassName) {
                    throw new Error(`Cannot resolve final class for student "${student.name}" (id: ${studentIdText}). class_id=${student.class_id}, class="${student.class}".`);
                }

                // final_class_id: UUID reference column — use class object id if available
                const finalClassId = classObj?.id
                    || (_UUID_RE.test((student.class_id || '').trim()) ? student.class_id.trim() : null);

                // Admission year for range calculation (nullable — handled safely)
                const admissionAcademicYear = student.admission_year
                    || student.admission_academic_year
                    || null;

                const graduationAcademicYear = fromAY.year;
                const academicYearRange      = admissionAcademicYear
                    ? `${admissionAcademicYear} - ${graduationYear}`
                    : `${fromAY.year} - ${graduationYear}`;

                // full_name — required
                const fullName = (student.name || student.full_name || '').trim();
                if (!fullName) {
                    throw new Error(`Student has no name (id: ${studentIdText})`);
                }

                // ── Step 2 validation summary ─────────────────────────────────────
                console.log('[graduation] Pre-insert validation passed for', fullName, {
                    studentIdText,
                    finalClassName,
                    finalClassId,
                    graduationYear,
                    finalTerm,
                    graduationAcademicYear,
                    admissionAcademicYear,
                    academicYearRange,
                });

                // ── Step 3: Insert into graduated_students ────────────────────────
                // Column names MUST match the actual graduated_students table schema.
                // Nullable fields are explicitly set to null rather than undefined
                // so Supabase/PostgREST does not omit them and hit NOT NULL defaults.
                const gradRecord = {
                    // TEXT — matches students.id which is TEXT, NOT UUID
                    student_id:               studentIdText,

                    // Core identity fields
                    admission_number:         student.admission_number   || null,
                    full_name:                fullName,
                    gender:                   student.gender             || null,
                    date_of_birth:            student.dob
                                              || student.date_of_birth   || null,
                    age:                      student.age != null
                                              ? String(student.age)
                                              : null,
                    parent_phone:             student.parent_phone
                                              || student.phone           || null,

                    // Class / academic reference fields
                    final_class_id:           finalClassId,              // UUID or null
                    final_class_name:         finalClassName,

                    // Graduation metadata
                    graduation_year:          graduationYear,
                    graduation_term:          finalTerm,
                    admission_academic_year:  admissionAcademicYear,
                    graduation_academic_year: graduationAcademicYear,
                    academic_year_range:      academicYearRange,

                    // Status & audit
                    status:                   'graduated',
                    graduated_by:             graduatedBy,               // UUID or null
                    graduated_at:             graduatedAt,
                };

                console.log('[graduation] Attempting graduated_students insert:', gradRecord);

                const { data: insertData, error: gradError } = await supabaseClient
                    .from('graduated_students')
                    .insert([gradRecord])
                    .select();

                if (gradError) {
                    // Surface the full Supabase error for diagnosis
                    console.error(
                        '[graduation] graduated_students INSERT FAILED for', fullName,
                        '\n  code:   ', gradError.code,
                        '\n  message:', gradError.message,
                        '\n  details:', gradError.details,
                        '\n  hint:   ', gradError.hint,
                        '\n  record: ', JSON.stringify(gradRecord, null, 2)
                    );
                    throw new Error(`DB insert failed for "${fullName}": ${gradError.message}${gradError.details ? ' — ' + gradError.details : ''}`);
                }

                console.log('[graduation] graduated_students insert OK:', insertData);

                // ── Step 4: Insert into promotion_logs ────────────────────────────
                try {
                    const { error: logError } = await supabaseClient
                        .from('promotion_logs')
                        .insert([{
                            student_id:   studentIdText,
                            action:       'graduated',
                            from_class:   finalClassName,
                            to_class:     null,
                            from_year:    fromAY.year,
                            to_year:      graduationYear,
                            performed_by: graduatedBy,
                            performed_at: graduatedAt,
                        }]);

                    if (logError) {
                        console.warn(
                            '[graduation] promotion_logs insert failed (non-fatal) for', fullName,
                            logError.code, logError.message
                        );
                        // Non-fatal: log the warning but continue so graduation still completes
                    }
                } catch (logErr) {
                    console.warn('[graduation] promotion_logs exception (non-fatal):', logErr);
                }

                // ── Step 5: Update student status in students table ───────────────
                const { error: statusError } = await supabaseClient
                    .from('students')
                    .update({ status: 'graduated' })
                    .eq('id', studentIdText);

                if (statusError) {
                    console.warn(
                        '[graduation] students status update failed for', fullName,
                        statusError.code, statusError.message
                    );
                    // Non-fatal: graduation record is already inserted — just warn
                }

                // ── Step 6: Patch in-memory state (optimistic normalisation) ──────
                const idx = state.students.findIndex(s => s.id === student.id);
                if (idx !== -1) {
                    state.students[idx].status = 'graduated';
                }

                // ── Step 7: Track success (student is removed from active flow
                //    in renderPromotion which re-derives from state.students) ───────
                results.success.push(student.id);
                console.log('[graduation] Successfully graduated:', fullName);

            } catch (err) {
                console.error('[graduation] Graduate student FAILED:', student?.name, '\n  Error:', err.message, '\n  Full error:', err);
                results.failed.push({ student, error: err.message });
                // Optimistic rollback: ensure student is NOT marked graduated in memory
                const idx = state.students.findIndex(s => s.id === student?.id);
                if (idx !== -1 && state.students[idx].status === 'graduated') {
                    state.students[idx].status = 'active';
                }
            }
        }

        // ── Step 8: Success message is shown by the caller (confirmGraduateAll)
        //    only after this promise resolves — enforced by await in the caller ────
        return results;
    },

    // Promote a list of students to their next class
    async promoteStudents(students, fromAY, toAY) {
        const results = { success: [], failed: [], skipped: [] };

        for (const student of students) {
            try {
                const nextClass = getNextClass(student);
                if (!nextClass) {
                    // PROMOTION_MAP may have a valid next grade (e.g. KG 2 -> Basic 1) but
                    // the target class doesn't exist in state.classes yet. Surface a clear
                    // skip reason so the admin knows to create the class first.
                    const _cls = _resolveClassObj(student);
                    const _rawG = (_cls && _cls.grade || '').trim();
                    const _rawGlc = _rawG.toLowerCase().replace(/\s{2,}/g, ' ');
                    const _mapped = PROMOTION_MAP[_rawG]
                        || (Object.entries(PROMOTION_MAP).find(([k]) =>
                            k.toLowerCase().replace(/\s{2,}/g, ' ') === _rawGlc
                        ) || [])[1];
                    const reason = _mapped
                        ? 'Target class "' + _mapped + '" not found \u2014 please create it first'
                        : 'No next class mapping found';
                    results.skipped.push({ student, reason });
                    continue;
                }

                const nextClassLabel = `${nextClass.level} - ${nextClass.grade}`;

                const { error } = await supabaseClient
                    .from('students')
                    .update({
                        class_id: nextClass.id,
                        class:    nextClassLabel,
                        status:   'active'
                    })
                    .eq('id', student.id);

                if (error) throw error;

                // Patch in-memory state immediately for optimistic UI
                const idx = state.students.findIndex(s => s.id === student.id);
                if (idx !== -1) {
                    state.students[idx].class_id = nextClass.id;
                    state.students[idx].class    = nextClassLabel;
                    state.students[idx].status   = 'active';
                }

                results.success.push(student.id);
            } catch (err) {
                console.error('Promote student error:', student.name, err);
                results.failed.push({ student, error: err.message });
            }
        }
        return results;
    },

    // Log the promotion event for duplicate-prevention
    async logPromotion(fromYear, toYear, promotedStudentIds) {
        try {
            await supabaseClient.from('promotion_log').insert([{
                from_year:    fromYear,
                to_year:      toYear,
                promoted_by:  state.currentUser?.id || null,
                student_ids:  promotedStudentIds,
                promoted_at:  new Date().toISOString()
            }]);
        } catch (err) {
            console.warn('logPromotion error (non-fatal):', err);
        }
    }
};

// ══════════════════════════════════════════════════════════════════════════════════
// VIEWS
// ══════════════════════════════════════════════════════════════════════════════════
const promotionViews = {

    // ── Main Promotion & Graduation view ─────────────────────────────────────────
    async renderPromotion({ silent = false } = {}) {
        const container = document.getElementById('view-content');
        if (!container) return;

        // Only show skeleton on explicit navigation, not on background auto-refresh.
        // Showing the skeleton on every auto-refresh is the primary cause of the
        // visible flicker when the user is interacting with checkboxes / buttons.
        if (!silent) {
            container.innerHTML = promotionViews._skeleton();
        }

        // ── Ensure classes are loaded first ──────────────────────────────────────
        // If state.classes is empty (page opened before initial load completed),
        // trigger a fresh load now. This covers cold-start and restored-class edge cases.
        if (!state.classes || state.classes.length === 0) {
            try {
                if (typeof dataManager !== 'undefined' && dataManager.loadClasses) {
                    await dataManager.loadClasses();
                }
            } catch (e) {
                console.warn('[promotion] loadClasses fallback error (non-fatal):', e);
            }
        }

        // ── Ensure students are loaded and normalized ─────────────────────────────
        if (!state.students || state.students.length === 0) {
            try {
                if (typeof dataManager !== 'undefined' && dataManager.loadStudents) {
                    await dataManager.loadStudents();
                }
            } catch (e) {
                console.warn('[promotion] loadStudents fallback error (non-fatal):', e);
            }
        }

        // ── Load promotion/graduation meta ────────────────────────────────────────
        // Skip on silent (auto-refresh) calls — these meta loads indirectly trigger
        // patched loadStudents/loadClasses which would fire _refreshPromotionIfOpen
        // again and create a re-render loop.
        if (!silent) {
            await loadPromotionLogs();
            await loadGraduatedStudents();
        }

        const currentTerm = state.currentTerm;
        const currentAY   = state.currentAY;
        const isT3        = isTermThree(currentTerm?.name);
        const otherYears  = state.academicYears.filter(y => !y.active);

        if (!isT3) {
            container.innerHTML = promotionViews._notAvailableView();
            return;
        }

        // ── Rebuild active class list from normalized source ──────────────────────
        // Always re-derive from state.classes (which includes restored classes) and
        // exclude only soft-deleted ones. This is the single source of truth.
        const activeClasses = (state.classes || []).filter(c => !c.deleted_at && c.status !== 'deleted');

        // ── Re-normalize students against the current (post-restore) class list ───
        // Ensures any student whose class_id temporarily resolved to nothing
        // (restored class, recently added class) gets correctly re-linked.
        const freshNormalized = (typeof dataManager !== 'undefined' && dataManager.normalizeStudentRecords)
            ? dataManager.normalizeStudentRecords(state.students)
            : state.students;

        // Keep normalized state in sync for other modules
        if (freshNormalized !== state.students) {
            state.students = freshNormalized;
        }

        // ── Partition students ─────────────────────────────────────────────────────
        const activeStudents  = freshNormalized.filter(s => s.status !== 'graduated');
        const gradCandidates  = activeStudents.filter(s => isGraduationGrade(s));
        // resolvePromotionTarget returns a class object, 'GRADUATE', or 'CROSS_LEVEL_PENDING'
        // (KG 2 -> Basic 1 when the target class does not exist yet). All non-null values mean
        // the student belongs in the promotion panel and must never be silently dropped.
        const promoCandidates = activeStudents.filter(s => !isGraduationGrade(s) && resolvePromotionTarget(s) !== null);

        // Build class groups for selective promotion using normalized labels
        const classGroups = {};
        promoCandidates.forEach(s => {
            const classObj = _resolveClassObj(s);
            // When classObj is null (soft-deleted class), use the readable text
            // stored on the student itself so the group still has a proper label.
            let label;
            if (classObj) {
                label = `${classObj.level} - ${classObj.grade}`;
            } else if (s.class && !_UUID_RE.test(s.class.trim())) {
                label = s.class.trim();
            } else {
                label = 'Unassigned';
            }
            if (!classGroups[label]) classGroups[label] = [];
            classGroups[label].push(s);
        });

        // Active Classes counter: use the full active class list (same source as
        // classes view), NOT just classes that happen to have promo students.
        const activeClassCount = activeClasses.length;

        container.innerHTML = `
            <div style="animation: rv-fade 0.22s ease;">

                <!-- Page header -->
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
                    <div>
                        <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0;">
                            <i class="fas fa-graduation-cap" style="margin-right:10px;color:#1a56db;"></i>Promotion & Graduation
                        </h2>
                        <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:4px 0 0;">
                            Academic Year: <strong>${currentAY?.year || '—'}</strong> &nbsp;·&nbsp; Active Term: <strong>${currentTerm?.name || '—'}</strong>
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <span style="padding:5px 14px;background:#dcfce7;color:#166534;border-radius:20px;font-size:12px;font-weight:700;border:1px solid #bbf7d0;">
                            <i class="fas fa-check-circle" style="margin-right:5px;"></i>Term 3 Active — Promotion Available
                        </span>
                    </div>
                </div>

                <!-- Summary cards -->
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;">
                    ${promotionViews._statCard('fa-users','Eligible for Promotion', promoCandidates.length,'#1a56db','rgba(26,86,219,0.1)')}
                    ${promotionViews._statCard('fa-graduation-cap','Eligible for Graduation', gradCandidates.length,'#059669','rgba(5,150,105,0.1)')}
                    ${promotionViews._statCard('fa-history','Already Graduated', state.graduatedStudents.length,'#7c3aed','rgba(124,58,237,0.1)')}
                    ${promotionViews._statCard('fa-school','Active Classes', activeClassCount,'#0891b2','rgba(8,145,178,0.1)')}
                </div>

                <!-- Graduation panel (Class 6 students) -->
                ${gradCandidates.length > 0 ? promotionViews._graduationPanel(gradCandidates, currentAY) : ''}

                <!-- Promotion section -->
                ${promoCandidates.length > 0 ? promotionViews._promotionPanel(promoCandidates, classGroups, currentAY, otherYears) : promotionViews._noPromoEligible()}

            </div>
        `;
    },

    _skeleton() {
        return `
            <div style="animation:rv-fade 0.22s ease;">
                <div style="height:32px;width:280px;margin-bottom:8px;" class="rv-skel"></div>
                <div style="height:16px;width:200px;margin-bottom:28px;" class="rv-skel"></div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px;">
                    ${[1,2,3,4].map(() => `<div style="height:100px;border-radius:14px;" class="rv-skel"></div>`).join('')}
                </div>
                <div style="height:280px;border-radius:14px;margin-bottom:16px;" class="rv-skel"></div>
                <div style="height:400px;border-radius:14px;" class="rv-skel"></div>
            </div>
        `;
    },

    _statCard(icon, label, value, color, bg) {
        return `
            <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:20px;box-shadow:var(--rv-shadow);">
                <div style="width:44px;height:44px;border-radius:12px;background:${bg};display:flex;align-items:center;justify-content:center;margin-bottom:14px;">
                    <i class="fas ${icon}" style="color:${color};font-size:18px;"></i>
                </div>
                <div style="font-family:'Outfit',sans-serif;font-size:28px;font-weight:700;color:var(--rv-text);line-height:1;">${value}</div>
                <div style="font-size:11px;font-weight:700;color:var(--rv-muted);text-transform:uppercase;letter-spacing:0.8px;margin-top:4px;">${label}</div>
            </div>
        `;
    },

    _notAvailableView() {
        return `
            <div style="animation:rv-fade 0.22s ease;">
                <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0 0 24px;">
                    <i class="fas fa-graduation-cap" style="margin-right:10px;color:#1a56db;"></i>Promotion & Graduation
                </h2>
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:16px;padding:56px 24px;text-align:center;box-shadow:var(--rv-shadow);">
                    <div style="width:72px;height:72px;background:#fef9c3;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
                        <i class="fas fa-lock" style="font-size:28px;color:#ca8a04;"></i>
                    </div>
                    <h3 style="font-size:18px;font-weight:700;color:var(--rv-text);margin:0 0 8px;">Not Available Yet</h3>
                    <p style="font-size:14px;color:var(--rv-muted);max-width:420px;margin:0 auto 24px;line-height:1.6;">
                        The Promotion & Graduation panel is only accessible during <strong>Term Three</strong>.
                        Currently active term: <strong>${state.currentTerm?.name || 'None'}</strong>.
                    </p>
                    <button onclick="ui.route('academic')" style="padding:10px 24px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-calendar-alt" style="margin-right:6px;"></i>Go to Academic Setup
                    </button>
                </div>
            </div>
        `;
    },

    _noPromoEligible() {
        return `
            <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:16px;padding:40px;text-align:center;box-shadow:var(--rv-shadow);">
                <i class="fas fa-check-circle" style="font-size:40px;color:#10b981;margin-bottom:16px;display:block;"></i>
                <h3 style="font-size:16px;font-weight:700;color:var(--rv-text);margin:0 0 8px;">No Students Pending Promotion</h3>
                <p style="font-size:13px;color:var(--rv-muted);">All eligible students have been promoted or there are no active students to promote.</p>
            </div>
        `;
    },

    _graduationPanel(graduates, currentAY) {
        return `
            <div style="background:var(--rv-surface);border:2px solid #059669;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:var(--rv-shadow);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:44px;height:44px;background:#dcfce7;border-radius:12px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-graduation-cap" style="color:#059669;font-size:20px;"></i>
                        </div>
                        <div>
                            <h3 style="font-size:16px;font-weight:700;color:var(--rv-text);margin:0;">Graduation Candidates</h3>
                            <p style="font-size:12px;color:var(--rv-muted);margin:2px 0 0;">${graduates.length} student(s) completing their final year — will be permanently archived as graduates</p>
                        </div>
                    </div>
                    <button onclick="promotionActions.confirmGraduateAll()"
                        style="padding:10px 22px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;"
                        id="btn-graduate-all">
                        <i class="fas fa-graduation-cap"></i> Graduate All (${graduates.length})
                    </button>
                </div>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#166534;">
                    <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                    These students are in the <strong>final class</strong>. They will be permanently archived with their full academic history. They will not appear in active attendance or promotion flows.
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
                    ${graduates.map(s => {
                        const classObj = s.class_id ? state.classes.find(c => c.id === s.class_id) : null;
                        const classLabel = classObj ? `${classObj.level} - ${classObj.grade}` : (s.class || '—');
                        return `
                            <div style="background:#fff;border:1px solid #bbf7d0;border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;">
                                <div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#059669,#10b981);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0;">
                                    ${(s.name || 'S').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div style="font-weight:600;font-size:13px;color:#0f172a;">${s.name}</div>
                                    <div style="font-size:11px;color:#64748b;">${classLabel}</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    },

    _promotionPanel(promoCandidates, classGroups, currentAY, otherYears) {
        return `
            <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:16px;padding:24px;box-shadow:var(--rv-shadow);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:44px;height:44px;background:rgba(26,86,219,0.1);border-radius:12px;display:flex;align-items:center;justify-content:center;">
                            <i class="fas fa-level-up-alt" style="color:#1a56db;font-size:20px;"></i>
                        </div>
                        <div>
                            <h3 style="font-size:16px;font-weight:700;color:var(--rv-text);margin:0;">Student Promotion</h3>
                            <p style="font-size:12px;color:var(--rv-muted);margin:2px 0 0;">${promoCandidates.length} student(s) eligible — select individually, by class, or promote all</p>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button onclick="promotionActions.confirmPromoteAll()"
                            style="padding:10px 20px;background:linear-gradient(135deg,#1a56db,#3b82f6);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;"
                            id="btn-promote-all">
                            <i class="fas fa-arrow-up" style="margin-right:6px;"></i>Promote All (${promoCandidates.length})
                        </button>
                    </div>
                </div>

                <!-- Class-by-class selection -->
                <div id="promotion-class-list" style="display:flex;flex-direction:column;gap:16px;">
                    ${Object.entries(classGroups).map(([classLabel, students]) => {
                        const nextStudents = students.map(s => {
                            const nextClass = getNextClass(s);
                            return { ...s, _nextClass: nextClass };
                        });
                        const nextLabel = nextStudents[0]?._nextClass
                            ? `${nextStudents[0]._nextClass.level} - ${nextStudents[0]._nextClass.grade}`
                            : '—';
                        const groupId = classLabel.replace(/[^a-zA-Z0-9]/g, '_');
                        return `
                            <div style="border:1px solid var(--rv-border);border-radius:12px;overflow:hidden;">
                                <!-- Class header row -->
                                <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:var(--rv-bg);cursor:pointer;"
                                    onclick="document.getElementById('class-group-${groupId}').style.display = document.getElementById('class-group-${groupId}').style.display === 'none' ? 'block' : 'none'">
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <input type="checkbox" id="check-class-${groupId}"
                                            onchange="promotionActions.toggleClassSelection('${groupId}', this.checked)"
                                            onclick="event.stopPropagation()"
                                            style="width:16px;height:16px;cursor:pointer;accent-color:#1a56db;">
                                        <div>
                                            <span style="font-weight:700;font-size:14px;color:var(--rv-text);">${classLabel}</span>
                                            <span style="font-size:12px;color:var(--rv-muted);margin-left:8px;">${students.length} student(s)</span>
                                        </div>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:10px;">
                                        <span style="font-size:12px;color:#1a56db;font-weight:600;">→ ${nextLabel}</span>
                                        <button onclick="event.stopPropagation();promotionActions.promoteClass('${classLabel}')"
                                            style="padding:6px 14px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
                                            Promote Class
                                        </button>
                                        <i class="fas fa-chevron-down" style="color:var(--rv-muted);font-size:12px;"></i>
                                    </div>
                                </div>

                                <!-- Student rows (collapsible) -->
                                <div id="class-group-${groupId}" style="display:none;">
                                    ${students.map(s => {
                                        const nextC = getNextClass(s);
                                        const nextLbl = nextC ? `${nextC.level} - ${nextC.grade}` : '⚠️ Create target class first';
                                        return `
                                            <div style="display:flex;align-items:center;padding:12px 18px;border-top:1px solid var(--rv-border);gap:12px;"
                                                id="promo-row-${s.id}">
                                                <input type="checkbox" class="promo-student-check" data-id="${s.id}" data-group="${groupId}"
                                                    style="width:15px;height:15px;cursor:pointer;accent-color:#1a56db;">
                                                <div style="width:34px;height:34px;border-radius:9px;background:rgba(26,86,219,0.15);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#1a56db;flex-shrink:0;">
                                                    ${(s.name || 'S').charAt(0).toUpperCase()}
                                                </div>
                                                <div style="flex:1;">
                                                    <div style="font-weight:600;font-size:13px;color:var(--rv-text);">${s.name}</div>
                                                    <div style="font-size:11px;color:var(--rv-muted);">${classLabel} → <span style="color:#1a56db;">${nextLbl}</span></div>
                                                </div>
                                                <button onclick="promotionActions.promoteSelected(['${s.id}'])"
                                                    style="padding:5px 12px;background:rgba(26,86,219,0.1);color:#1a56db;border:1px solid rgba(26,86,219,0.2);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;">
                                                    Promote
                                                </button>
                                            </div>
                                        `;
                                    }).join('')}
                                    <!-- Promote selected from this class -->
                                    <div style="padding:10px 18px;background:var(--rv-bg);display:flex;align-items:center;justify-content:flex-end;gap:10px;">
                                        <span style="font-size:12px;color:var(--rv-muted);">Promote selected from this class:</span>
                                        <button onclick="promotionActions.promoteCheckedInGroup('${groupId}')"
                                            style="padding:6px 14px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
                                            <i class="fas fa-check" style="margin-right:4px;"></i>Promote Checked
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Promote selected across all classes -->
                <div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:var(--rv-bg);border-radius:10px;border:1px solid var(--rv-border);">
                    <span style="font-size:13px;color:var(--rv-muted);">Promote all checked students across all classes:</span>
                    <button onclick="promotionActions.promoteAllChecked()"
                        style="padding:8px 20px;background:#1a56db;color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;">
                        <i class="fas fa-check-double" style="margin-right:6px;"></i>Promote All Checked
                    </button>
                </div>
            </div>
        `;
    },

    // ── Graduated Students section ────────────────────────────────────────────────
    async renderGraduatedStudents() {
        const container = document.getElementById('view-content');
        if (!container) return;
        container.innerHTML = promotionViews._skeleton();

        await loadGraduatedStudents();

        const grads = state.graduatedStudents || [];

        // Collect unique filter values — use exact column names from graduated_students table
        const uniqueYears   = [...new Set(grads.map(g => g.graduation_year).filter(Boolean))].sort().reverse();
        const uniqueAYs     = [...new Set(grads.map(g => g.graduation_academic_year).filter(Boolean))].sort().reverse();
        const uniqueClasses = [...new Set(grads.map(g => g.final_class_name).filter(Boolean))].sort();

        container.innerHTML = `
            <div style="animation:rv-fade 0.22s ease;">

                <!-- Header -->
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
                    <div>
                        <h2 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0;">
                            <i class="fas fa-user-graduate" style="margin-right:10px;color:#7c3aed;"></i>Graduated Students
                        </h2>
                        <p style="font-size:13px;color:var(--rv-muted);margin:4px 0 0;">${grads.length} graduate(s) permanently archived</p>
                    </div>
                    <button onclick="actions.refreshData()" style="display:flex;align-items:center;gap:6px;padding:8px 16px;background:var(--rv-surface);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>

                <!-- Filters -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;padding:18px;margin-bottom:20px;box-shadow:var(--rv-shadow);">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end;">
                        <div>
                            <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);margin-bottom:6px;">Search by Name</label>
                            <input type="text" id="grad-search" placeholder="Student name..."
                                oninput="promotionViews._filterGraduates()"
                                style="width:100%;padding:9px 14px;border:1.5px solid var(--rv-border);border-radius:10px;background:var(--rv-surface);color:var(--rv-text);font-size:13px;outline:none;">
                        </div>
                        <div>
                            <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);margin-bottom:6px;">Academic Year</label>
                            <select id="grad-filter-ay" onchange="promotionViews._filterGraduates()"
                                style="width:100%;padding:9px 14px;border:1.5px solid var(--rv-border);border-radius:10px;background:var(--rv-surface);color:var(--rv-text);font-size:13px;outline:none;">
                                <option value="">All Years</option>
                                ${uniqueAYs.map(y => `<option value="${y}">${y}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);margin-bottom:6px;">Graduation Year</label>
                            <select id="grad-filter-year" onchange="promotionViews._filterGraduates()"
                                style="width:100%;padding:9px 14px;border:1.5px solid var(--rv-border);border-radius:10px;background:var(--rv-surface);color:var(--rv-text);font-size:13px;outline:none;">
                                <option value="">All</option>
                                ${uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);margin-bottom:6px;">Final Class</label>
                            <select id="grad-filter-class" onchange="promotionViews._filterGraduates()"
                                style="width:100%;padding:9px 14px;border:1.5px solid var(--rv-border);border-radius:10px;background:var(--rv-surface);color:var(--rv-text);font-size:13px;outline:none;">
                                <option value="">All Classes</option>
                                ${uniqueClasses.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <button onclick="promotionViews._clearFilters()"
                                style="width:100%;padding:9px 14px;background:var(--rv-bg);border:1.5px solid var(--rv-border);border-radius:10px;font-size:13px;font-weight:600;color:var(--rv-muted);cursor:pointer;">
                                <i class="fas fa-times" style="margin-right:6px;"></i>Clear Filters
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Table -->
                <div style="background:var(--rv-surface);border:1px solid var(--rv-border);border-radius:14px;overflow:hidden;box-shadow:var(--rv-shadow);">
                    ${grads.length === 0
                        ? `<div style="padding:64px;text-align:center;">
                               <i class="fas fa-user-graduate" style="font-size:40px;color:var(--rv-border);margin-bottom:16px;display:block;"></i>
                               <p style="font-size:14px;color:var(--rv-muted);">No graduated students yet.</p>
                           </div>`
                        : `<div style="overflow-x:auto;">
                               <table id="grad-table" style="width:100%;border-collapse:collapse;min-width:700px;">
                                   <thead>
                                       <tr style="background:var(--rv-bg);">
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Student</th>
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Final Class</th>
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Graduation Year</th>
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Academic Range</th>
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Final Term</th>
                                           <th style="padding:12px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--rv-muted);">Graduated On</th>
                                       </tr>
                                   </thead>
                                   <tbody id="grad-tbody">
                                       ${grads.map(g => promotionViews._gradRow(g)).join('')}
                                   </tbody>
                               </table>
                           </div>`
                    }
                </div>

            </div>
        `;
    },

    _gradRow(g) {
        // ── Normalise all fields against the actual graduated_students schema ──────
        // The table stores: full_name, final_class_name, graduation_term,
        // academic_year_range, graduation_academic_year, graduation_year, graduated_at
        // Never reference g.name / g.final_class / g.final_term / g.graduation_range
        // — those are old field names from a prior schema version and will be undefined.

        const fullName    = g.full_name        || '—';
        const finalClass  = g.final_class_name || '—';
        const gradTerm    = g.graduation_term  || '—';
        const ayRange     = g.academic_year_range || '—';
        const gradYear    = g.graduation_year  || '—';
        const admNum      = g.admission_number || null;

        // Initial: first char of full_name, fall back to '?'
        const initial = fullName !== '—' ? fullName.charAt(0).toUpperCase() : '?';

        // Date: parse graduated_at safely
        let dateStr = '—';
        if (g.graduated_at) {
            try { dateStr = new Date(g.graduated_at).toLocaleDateString('en-GB'); } catch (_) {}
        }

        // data-* attributes used by _filterGraduates() — must match filter logic
        return `
            <tr data-name="${fullName.toLowerCase()}"
                data-ay="${g.graduation_academic_year || ''}"
                data-year="${gradYear}"
                data-class="${finalClass}"
                style="border-top:1px solid var(--rv-border);transition:background 0.15s;"
                onmouseover="this.style.background='var(--rv-bg)'" onmouseout="this.style.background=''">
                <td style="padding:12px 16px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0;">
                            ${initial}
                        </div>
                        <div>
                            <div style="font-weight:600;font-size:13px;color:var(--rv-text);">${fullName}</div>
                            ${admNum ? `<div style="font-size:11px;color:var(--rv-muted);">Adm: ${admNum}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td style="padding:12px 16px;font-size:13px;color:var(--rv-text);">${finalClass}</td>
                <td style="padding:12px 16px;">
                    <span style="padding:3px 10px;background:#f3e8ff;color:#7c3aed;border-radius:20px;font-size:12px;font-weight:700;">${gradYear}</span>
                </td>
                <td style="padding:12px 16px;font-size:12px;color:var(--rv-muted);">${ayRange}</td>
                <td style="padding:12px 16px;font-size:12px;color:var(--rv-muted);">${gradTerm}</td>
                <td style="padding:12px 16px;font-size:12px;color:var(--rv-muted);">${dateStr}</td>
            </tr>
        `;
    },

    _filterGraduates() {
        const search      = (document.getElementById('grad-search')?.value    || '').toLowerCase();
        const filterAY    = document.getElementById('grad-filter-ay')?.value  || '';
        const filterYear  = document.getElementById('grad-filter-year')?.value || '';
        const filterClass = document.getElementById('grad-filter-class')?.value || '';

        document.querySelectorAll('#grad-tbody tr').forEach(row => {
            // data-name  → full_name lowercased
            // data-ay    → graduation_academic_year
            // data-year  → graduation_year
            // data-class → final_class_name
            const name = row.dataset.name  || '';
            const ay   = row.dataset.ay    || '';
            const year = row.dataset.year  || '';
            const cls  = row.dataset.class || '';

            const match = (!search      || name.includes(search))
                       && (!filterAY    || ay   === filterAY)
                       && (!filterYear  || year === filterYear)
                       && (!filterClass || cls  === filterClass);

            row.style.display = match ? '' : 'none';
        });
    },

    _clearFilters() {
        ['grad-search','grad-filter-ay','grad-filter-year','grad-filter-class'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        promotionViews._filterGraduates();
    }
};

// ══════════════════════════════════════════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════════════════════════════════════════
const promotionActions = {

    // Toggle all checkboxes within a class group
    toggleClassSelection(groupId, checked) {
        document.querySelectorAll(`.promo-student-check[data-group="${groupId}"]`).forEach(cb => {
            cb.checked = checked;
        });
    },

    // Confirm & run: promote ALL eligible (non-graduating) students
    async confirmPromoteAll() {
        const currentAY  = state.currentAY;
        const allActive  = state.students.filter(s => s.status !== 'graduated');
        const candidates = allActive.filter(s => !isGraduationGrade(s) && getNextClass(s) !== null);

        if (candidates.length === 0) {
            modal.alert('No Students', 'No eligible students to promote.', 'info');
            return;
        }

        // Require a target AY selection for the promotion log
        const otherYears = state.academicYears.filter(y => !y.active);
        const toAYPrompt = otherYears.length > 0
            ? `Promoting to next class within <strong>${currentAY.year}</strong> records.`
            : `Promoting <strong>${candidates.length}</strong> students to their next class.`;

        modal.createModal(
            'Promote All Students',
            `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">
                ${toAYPrompt}
                <br><br><strong style="color:#fff;">${candidates.length} student(s)</strong> will be moved to their next class immediately.
             </p>
             <div style="margin-top:12px;padding:12px 14px;background:rgba(26,86,219,0.12);border:1px solid rgba(26,86,219,0.3);border-radius:10px;font-size:13px;color:#93c5fd;">
                 <i class="fas fa-shield-alt" style="margin-right:6px;"></i>
                 All attendance, billing, reports, and academic history are preserved.
             </div>`,
            async () => {
                await promotionActions._runPromotion(candidates, currentAY, currentAY, 'promote-all');
            },
            () => {},
            'Promote All',
            'Cancel',
            'info'
        );
    },

    // Promote an entire class by class label
    async promoteClass(classLabel) {
        const classStudents = state.students.filter(s => {
            if (s.status === 'graduated') return false;
            const classObj = s.class_id ? state.classes.find(c => c.id === s.class_id) : null;
            const label = classObj ? `${classObj.level} - ${classObj.grade}` : (s.class || '');
            return label === classLabel && !isGraduationGrade(s) && getNextClass(s) !== null;
        });

        if (classStudents.length === 0) {
            modal.alert('No Students', 'No eligible students in this class.', 'info');
            return;
        }

        const sampleNext = getNextClass(classStudents[0]);
        const nextLabel  = sampleNext ? `${sampleNext.level} - ${sampleNext.grade}` : '?';

        modal.createModal(
            `Promote ${classLabel}`,
            `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">
                Move all <strong style="color:#fff;">${classStudents.length}</strong> student(s) from
                <strong style="color:#60a5fa;">${classLabel}</strong> →
                <strong style="color:#34d399;">${nextLabel}</strong>?
             </p>`,
            async () => {
                await promotionActions._runPromotion(classStudents, state.currentAY, state.currentAY, `class-${classLabel}`);
            },
            () => {},
            'Promote Class',
            'Cancel',
            'info'
        );
    },

    // Promote specifically selected student IDs
    async promoteSelected(studentIds) {
        const students = studentIds
            .map(id => state.students.find(s => s.id === id))
            .filter(s => s && s.status !== 'graduated' && !isGraduationGrade(s));

        if (students.length === 0) {
            modal.alert('Cannot Promote', 'Selected student(s) are not eligible for promotion.', 'warning');
            return;
        }

        await promotionActions._runPromotion(students, state.currentAY, state.currentAY, 'selected');
    },

    // Promote all checked students within a specific class group
    async promoteCheckedInGroup(groupId) {
        const checkedIds = [...document.querySelectorAll(`.promo-student-check[data-group="${groupId}"]:checked`)]
            .map(cb => cb.dataset.id);

        if (checkedIds.length === 0) {
            modal.alert('Nothing Selected', 'Please check at least one student in this class.', 'info');
            return;
        }
        await promotionActions.promoteSelected(checkedIds);
    },

    // Promote all checked students across all class groups
    async promoteAllChecked() {
        const checkedIds = [...document.querySelectorAll('.promo-student-check:checked')]
            .map(cb => cb.dataset.id);

        if (checkedIds.length === 0) {
            modal.alert('Nothing Selected', 'Please check at least one student to promote.', 'info');
            return;
        }
        await promotionActions.promoteSelected(checkedIds);
    },

    // ── Core promotion runner ──────────────────────────────────────────────────────
    async _runPromotion(students, fromAY, toAY, logKey) {
        const btn = document.getElementById('btn-promote-all');
        if (btn) { btn.disabled = true; btn.classList.add('rv-btn-loading'); }

        // Lock: prevent _refreshPromotionIfOpen from firing while loadStudents /
        // loadClasses are called inside this action — those patched methods would
        // otherwise trigger a full re-render that wipes the loading state mid-flight.
        _promotionActionRunning = true;

        try {
            app.showLoading('Promoting students...');
            const results = await promotionEngine.promoteStudents(students, fromAY, toAY);

            // Log promotion
            if (results.success.length > 0) {
                await promotionEngine.logPromotion(fromAY.year, toAY.year, results.success);
            }

            // Reload data so all views are in sync
            await dataManager.loadClasses();
            await Promise.all([
                dataManager.loadStudents(),
                dataManager.loadTeachers(),
                dataManager.loadAttendance(),
                dataManager.loadReports(),
            ]);

            app.hideLoading();

            const msg = results.failed.length > 0
                ? `${results.success.length} promoted, ${results.failed.length} failed.`
                : `${results.success.length} student(s) successfully promoted!`;
            const type = results.failed.length > 0 ? 'warning' : 'success';
            ui.showToast(msg, type);

            // Unlock before the intentional re-render so it goes through normally
            _promotionActionRunning = false;
            // Re-render the promotion view with fresh data (explicit, not via refresh hook)
            await promotionViews.renderPromotion();
        } catch (err) {
            app.hideLoading();
            _promotionActionRunning = false;
            modal.alert('Promotion Error', extractErrorMessage(err), 'error');
        } finally {
            _promotionActionRunning = false; // safety: always clear
            if (btn) { btn.disabled = false; btn.classList.remove('rv-btn-loading'); }
        }
    },

    // ── Confirm & run graduation ───────────────────────────────────────────────────
    async confirmGraduateAll() {
        const currentAY  = state.currentAY;
        const toAY       = state.academicYears.filter(y => !y.active)[0] || currentAY;
        const candidates = state.students.filter(s =>
            s.status !== 'graduated' && isGraduationGrade(s)
        );

        if (candidates.length === 0) {
            modal.alert('No Graduates', 'No students are currently in the final graduation class.', 'info');
            return;
        }

        modal.createModal(
            'Graduate Final-Year Students',
            `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;">
                <strong style="color:#fff;">${candidates.length}</strong> student(s) in the final class will be permanently archived as graduates.
            </p>
            <div style="margin-top:12px;padding:12px 14px;background:rgba(5,150,105,0.12);border:1px solid rgba(5,150,105,0.3);border-radius:10px;font-size:13px;color:#6ee7b7;">
                <i class="fas fa-info-circle" style="margin-right:6px;"></i>
                Graduated students remain fully preserved in the database and accessible from the <strong>Graduated Students</strong> section. Their attendance, reports, and billing records are never deleted.
            </div>`,
            async () => {
                const btn = document.getElementById('btn-graduate-all');
                if (btn) { btn.disabled = true; btn.classList.add('rv-btn-loading'); }

                // Lock: same reason as _runPromotion — loadStudents inside
                // graduateStudents would otherwise trigger a flicker re-render.
                _promotionActionRunning = true;

                try {
                    app.showLoading('Graduating students...');
                    const nextAY = toAY;
                    const results = await promotionEngine.graduateStudents(candidates, currentAY, nextAY);

                    // Step 6 (global): refresh normalized frontend state
                    await loadGraduatedStudents();
                    await dataManager.loadStudents();

                    app.hideLoading();

                    // Step 8: show success message — only reached after DB insert completes
                    if (results.failed.length > 0) {
                        const failDetails = results.failed
                            .map(f => `• ${f.student?.name || 'Unknown'}: ${f.error}`)
                            .join('\n');
                        console.error('[graduation] Failures:\n' + failDetails);
                        const msg = `${results.success.length} graduated, ${results.failed.length} failed.\n\nFailed students:\n${failDetails}`;
                        modal.alert('Graduation Partially Failed', msg, 'warning');
                    } else {
                        ui.showToast(`${results.success.length} student(s) successfully graduated!`, 'success');
                    }

                    // Unlock before the intentional re-render
                    _promotionActionRunning = false;
                    await promotionViews.renderPromotion();
                } catch (err) {
                    app.hideLoading();
                    _promotionActionRunning = false;
                    console.error('[graduation] confirmGraduateAll caught top-level error:', err);
                    modal.alert('Graduation Error', extractErrorMessage(err), 'error');
                } finally {
                    _promotionActionRunning = false; // safety: always clear
                    if (btn) { btn.disabled = false; btn.classList.remove('rv-btn-loading'); }
                }
            },
            () => {},
            'Graduate All',
            'Cancel',
            'success'
        );
    }
};

// ══════════════════════════════════════════════════════════════════════════════════
// INTEGRATION PATCHES — wire into existing app.js objects without modifying them
// ══════════════════════════════════════════════════════════════════════════════════
(function patchApp() {
    // ── Helper: defer renderPromotion until state.classes & state.students are
    //    populated, then render. Retries up to ~3 s before rendering anyway.
    function _waitForReadyThenRender() {
        const MAX_POLLS = 30;   // 30 × 100 ms = 3 s max wait
        let polls = 0;
        function attempt() {
            const classesReady   = state.classes  && state.classes.length  > 0;
            const studentsReady  = state.students && state.students.length >= 0; // 0 students is valid
            const dataLoaded     = classesReady && studentsReady;
            if (dataLoaded || polls >= MAX_POLLS) {
                // Explicit navigation — show skeleton (silent: false, the default)
                promotionViews.renderPromotion().catch(e =>
                    console.warn('[promotion] renderPromotion error:', e)
                );
                return;
            }
            polls++;
            setTimeout(attempt, 100);
        }
        attempt();
    }

    // ── 1. Add routes to ui.route() ───────────────────────────────────────────────
    const _origRoute = ui.route.bind(ui);
    ui.route = function(view) {
        if (view === 'promotion') {
            state.currentView = view;
            const container = document.getElementById('view-content');
            if (container) {
                container.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:center;height:200px;">
                        <div style="width:36px;height:36px;border:3px solid var(--rv-blue,#1a56db);border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div>
                    </div>
                    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
                `;
                window.scrollTo(0, 0);
            }
            document.querySelectorAll('.sidebar-item').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('onclick')?.includes("'promotion'")) btn.classList.add('active');
            });
            // Wait until the app has at minimum attempted a class load before
            // rendering — avoids the "0 active classes" flash on cold open.
            _waitForReadyThenRender();
            return;
        }
        if (view === 'graduated_students') {
            state.currentView = view;
            const container = document.getElementById('view-content');
            if (container) {
                container.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:center;height:200px;">
                        <div style="width:36px;height:36px;border:3px solid #7c3aed;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></div>
                    </div>
                `;
                window.scrollTo(0, 0);
            }
            document.querySelectorAll('.sidebar-item').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('onclick')?.includes("'graduated_students'")) btn.classList.add('active');
            });
            setTimeout(() => promotionViews.renderGraduatedStudents(), 80);
            return;
        }
        return _origRoute(view);
    };

    // ── 2. Patch updateSidebar to inject new nav items ────────────────────────────
    const _origUpdateSidebar = ui.updateSidebar.bind(ui);
    ui.updateSidebar = function() {
        _origUpdateSidebar();
        // Inject new items into the existing sidebar ONLY for admins
        if (state.role !== 'admin') return;
        _injectPromotionNavItems();
    };

    function _injectPromotionNavItems() {
        const nav = document.getElementById('sidebar-nav');
        if (!nav) return;
        if (nav.querySelector('[data-promo-injected]')) return; // already injected

        // Find existing "Admin" section label
        const labels = nav.querySelectorAll('.rv-nav-section');
        let academicLabel = null;
        labels.forEach(l => {
            if (l.textContent.trim() === 'Main') academicLabel = l;
        });

        // Build new section HTML
        const sectionHtml = `
            <div data-promo-injected="1">
                <div class="rv-nav-section">Academic</div>
                <button class="sidebar-item" onclick="ui.route('promotion')" title="Promotion & Graduation">
                    <i class="fas fa-graduation-cap"></i> Promotion &amp; Graduation
                </button>
                <button class="sidebar-item" onclick="ui.route('graduated_students')" title="Graduated Students">
                    <i class="fas fa-user-graduate"></i> Graduated Students
                </button>
            </div>
        `;

        // Insert after the last "main" section item or append
        const firstSection = academicLabel;
        if (firstSection && firstSection.parentNode === nav) {
            // Find the next section label after 'Main' to insert before it
            let nextSection = firstSection.nextElementSibling;
            while (nextSection && !nextSection.classList.contains('rv-nav-section')) {
                nextSection = nextSection.nextElementSibling;
            }
            if (nextSection) {
                nextSection.insertAdjacentHTML('beforebegin', sectionHtml);
            } else {
                nav.insertAdjacentHTML('beforeend', sectionHtml);
            }
        } else {
            nav.insertAdjacentHTML('beforeend', sectionHtml);
        }

        // Re-apply active state to the new buttons
        document.querySelectorAll('[data-promo-injected] .sidebar-item').forEach(btn => {
            if (btn.getAttribute('onclick')?.includes(`'${state.currentView}'`)) {
                btn.classList.add('active');
            }
        });
    }

    // ── 3. Patch loadInitialData to also load graduated students & promotion logs ─
    const _origLoadInitialData = app.loadInitialData.bind(app);
    app.loadInitialData = async function() {
        await _origLoadInitialData();
        // Load new tables silently — non-fatal
        await Promise.all([
            loadGraduatedStudents().catch(() => {}),
            loadPromotionLogs().catch(() => {})
        ]);
    };

    // ── 4. Patch loadStudents to exclude graduated students from active lists ──────
    const _origLoadStudents = dataManager.loadStudents.bind(dataManager);
    dataManager.loadStudents = async function() {
        await _origLoadStudents();
        // Filter out graduated students from the active students list.
        // _origLoadStudents already ran normalizeStudentRecords; re-running after
        // the status filter ensures normalized state is always consistent.
        const beforeFilter = state.students;
        const afterFilter  = beforeFilter.filter(s => s.status !== 'graduated');
        // Only re-normalize if any graduated students were removed (avoids
        // redundant work in the common case where nobody was filtered out).
        state.students = afterFilter.length !== beforeFilter.length
            ? dataManager.normalizeStudentRecords(afterFilter)
            : afterFilter;

        // If the Promotion page is currently open, refresh it now so counters
        // reflect the newly loaded students without a manual page reload.
        _refreshPromotionIfOpen();
    };

    // ── 5. Patch loadClasses to trigger a promotion refresh when page is open ──────
    if (typeof dataManager.loadClasses === 'function') {
        const _origLoadClasses = dataManager.loadClasses.bind(dataManager);
        dataManager.loadClasses = async function(...args) {
            await _origLoadClasses(...args);
            _refreshPromotionIfOpen();
        };
    }

    // ── 6. Helper: silently re-render the promotion page if it is currently open ───
    function _refreshPromotionIfOpen() {
        // Never re-render while a promotion/graduation action is in progress.
        // The action itself calls renderPromotion() explicitly when it finishes.
        if (_promotionActionRunning) return;

        if (state.currentView === 'promotion') {
            // Debounce so rapid back-to-back triggers coalesce into a single render.
            // 600 ms is intentionally longer than the previous 150 ms — it must
            // outlast any burst of loadStudents + loadClasses callbacks that fire
            // in quick succession after a data change.
            clearTimeout(_refreshPromotionIfOpen._timer);
            _refreshPromotionIfOpen._timer = setTimeout(() => {
                // Double-check the lock hasn't been set in the interim
                if (_promotionActionRunning) return;
                promotionViews.renderPromotion({ silent: true }).catch(e =>
                    console.warn('[promotion] auto-refresh error:', e)
                );
            }, 600);
        }
    }
    _refreshPromotionIfOpen._timer = null;

    // ── 7. Subscribe to app-level events that should trigger a promo refresh ────────
    // The existing app may emit custom DOM events or call known action hooks.
    // We patch the known entry points for each relevant workflow.

    // (a) Academic year creation / term change — patch actions.createAcademicYear /
    //     actions.setActiveTerm if they exist
    function _patchActionForRefresh(host, fnName) {
        if (!host || typeof host[fnName] !== 'function') return;
        const _orig = host[fnName].bind(host);
        host[fnName] = async function(...args) {
            const result = await _orig(...args);
            // After the action settles, refresh promotion if it's open
            setTimeout(_refreshPromotionIfOpen, 300);
            return result;
        };
    }

    // Patch as soon as actions object is available (it is, since we load after app.js)
    if (typeof actions !== 'undefined') {
        _patchActionForRefresh(actions, 'createAcademicYear');
        _patchActionForRefresh(actions, 'setActiveTerm');
        _patchActionForRefresh(actions, 'createClass');
        _patchActionForRefresh(actions, 'restoreClass');
        _patchActionForRefresh(actions, 'registerStudent');
        _patchActionForRefresh(actions, 'addStudent');
        _patchActionForRefresh(actions, 'createStudent');
    }

    // (b) Generic DOM event — in case the app fires a custom 'rv:datachanged' event
    document.addEventListener('rv:datachanged', () => {
        setTimeout(_refreshPromotionIfOpen, 200);
    });

    // ── 8. Patch renderAcademic to add promotion section link (if Term 3 active) ──
    const _origRenderAcademic = views.renderAcademic.bind(views);
    views.renderAcademic = function() {
        _origRenderAcademic();
        // After rendering, inject the promotion banner if Term 3 is active
        const isT3 = isTermThree(state.currentTerm?.name);
        if (!isT3) return;

        const container = document.getElementById('view-content');
        if (!container) return;

        // Append a promotion notice after the existing content
        const bannerHtml = `
            <div id="promotion-ay-banner" style="margin-top:24px;background:linear-gradient(135deg,rgba(26,86,219,0.08),rgba(59,130,246,0.08));border:1.5px solid rgba(26,86,219,0.25);border-radius:16px;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:14px;">
                    <div style="width:48px;height:48px;background:rgba(26,86,219,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-graduation-cap" style="color:#1a56db;font-size:22px;"></i>
                    </div>
                    <div>
                        <h4 style="font-size:15px;font-weight:700;color:var(--rv-navy,#0f2044);margin:0 0 4px;">Term 3 Detected — Promotion Available</h4>
                        <p style="font-size:13px;color:var(--rv-muted,#64748b);margin:0;">
                            Manage student promotions and graduate final-year students before the new academic year.
                        </p>
                    </div>
                </div>
                <button onclick="ui.route('promotion')" style="padding:10px 22px;background:linear-gradient(135deg,#1a56db,#3b82f6);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">
                    <i class="fas fa-arrow-right" style="margin-right:6px;"></i>Open Promotion Panel
                </button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', bannerHtml);
    };

    console.log('[promotion-graduation.js] Integration patches applied ✓');
})();

// ── Expose globally for onclick handlers ──────────────────────────────────────────
window.promotionViews   = promotionViews;
window.promotionActions = promotionActions;
window.promotionEngine  = promotionEngine;
window.loadGraduatedStudents = loadGraduatedStudents;

// ── Debug helper: call promotionDebug() in the browser console to diagnose ────────
// promotion issues without touching the UI.  Prints a structured report showing
// exactly why each student is or isn't appearing as a promotion candidate.
window.promotionDebug = function() {
    const activeClasses  = (state.classes || []).filter(c => !c.deleted_at && c.status !== 'deleted');
    const activeStudents = (state.students || []).filter(s => s.status !== 'graduated');

    console.group('[promotionDebug] Active classes (' + activeClasses.length + ')');
    activeClasses.forEach(c => console.log(`  id=${c.id} | level="${c.level}" | grade="${c.grade}"`));
    console.groupEnd();

    console.group('[promotionDebug] Student eligibility (' + activeStudents.length + ' active students)');
    activeStudents.forEach(s => {
        const classObj  = _resolveClassObj(s);
        const isGrad    = isGraduationGrade(s);
        const nextClass = getNextClass(s);
        const target    = resolvePromotionTarget(s);
        console.log(
            `%c${s.name}`,
            isGrad ? 'color:green' : nextClass ? 'color:blue' : 'color:red',
            {
                class_id    : s.class_id,
                class_field : s.class,
                resolved    : classObj ? `${classObj.level} - ${classObj.grade}` : null,
                isGraduation: isGrad,
                nextClass   : nextClass ? `${nextClass.level} - ${nextClass.grade}` : null,
                target,
            }
        );
    });
    console.groupEnd();

    const promoCandidates = activeStudents.filter(s => !isGraduationGrade(s) && resolvePromotionTarget(s) !== null);
    const gradCandidates  = activeStudents.filter(s => isGraduationGrade(s));
    console.log(`[promotionDebug] Summary → Promotion candidates: ${promoCandidates.length} | Graduation candidates: ${gradCandidates.length}`);
};