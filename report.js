// ==================== CONFIGURATION ====================
const SUPABASE_URL = 'https://dcdqmxsdazwattnrbjyb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZHFteHNkYXp3YXR0bnJianliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMDAwNTYsImV4cCI6MjA4NDY3NjA1Nn0.bKLAfK2RefFNCMUe4LHeggQisuEOb3o4DR8zjZVfamw';

// ==================== STATE MANAGEMENT ====================
const state = {
    supabaseClient: null,
    teacherId: null,
    teacherName: '',
    assignedClass: '',
    assignedClassId: '',   // UUID — primary key for student/report queries
    assignedClassLevel: '', // raw 'level' field from classes table (extra search token)
    assignedClassGrade: '', // raw 'grade' field from classes table (extra search token)
    classLevel: '',
    academicYear: '',
    term: '',
    students: [],
    currentStudentIndex: -1,
    reportsData: {},
    attendanceData: {},
    template: { file: null, arrayBuffer: null, xmlContent: null, found: false, filename: null },
    isSubmitting: false,
    isLoading: false,
    calculateClassPosition: false,
    isTerm3: false,
    hasUnsavedChanges: false,
    lastSavedHash: null,
    retryCount: 0,
    maxRetries: 3,
    autoSaveTimer: null,
    autoSaveInterval: null,
    pendingBundle: null,
    schoolName: '',
    schoolLogoBase64: '',
    positionManuallySet: false   // true once teacher has explicitly toggled the button
};

// ==================== TEMPLATE CONFIGURATION ====================
// Template files are stored in Supabase Storage bucket 'report-templates'
// at the root level. See README section at end of file for setup instructions.
const TEMPLATE_FILES = {
    'creche':  'CRECHE_AND_NURSERY_REPORT_TEMPLATE.docx',
    'nursery': 'CRECHE_AND_NURSERY_REPORT_TEMPLATE.docx',
    'kg':      'K_G_REPORT_TEMPLATE.docx',
    'lower':   'LOWER_PRIMARY_REPORT_TEMPLATE.docx',
    'upper':   'UPPER_PRIMARY_REPORT_TEMPLATE.docx'
};

// Supabase Storage bucket where templates are stored (public bucket)
const TEMPLATE_BUCKET = 'report-templates';

const TEMPLATE_CONFIG = {

    // ── CRÈCHE ──────────────────────────────────────────────────────────────
    'creche': {
        sections: [
            {
                title: 'Demographic Characteristics',
                type: 'demographic',
                fields: [
                    { name: 'date',            label: 'Date',            type: 'date'   },
                    { name: 'age_months',      label: 'Age (Months)',    type: 'number' },
                    { name: 'previous_height', label: 'Previous Height', type: 'text'   },
                    { name: 'current_height',  label: 'Current Height',  type: 'text'   },
                    { name: 'previous_weight', label: 'Previous Weight', type: 'text'   },
                    { name: 'current_weight',  label: 'Current Weight',  type: 'text'   }
                ]
            },
            {
                title: 'Play Therapy Activities (Yes / No)',
                type: 'play_therapy_yes_no',
                fields: [
                    { name: 'identify_caregiver',  label: 'Can identify his/her caregiver from other caregiver?' },
                    { name: 'recognize_parents',   label: 'Can identify and recognized the presence of his/her parents when with caregivers?' },
                    { name: 'can_crawl',           label: 'Can craw?' },
                    { name: 'stand_with_help',     label: 'Can stand with help?' },
                    { name: 'stand_without_help',  label: 'Can stand without help?' },
                    { name: 'take_steps',          label: 'Can stand and take steps not more than...', type: 'text_with_remark' },
                    { name: 'walk_independently',  label: 'Can walk independently?' },
                    { name: 'play_with_colleagues',label: 'Do join and play with colleagues?' },
                    { name: 'show_signs_tasty',    label: 'Do show specific/unique signs/gestures when tasty or hungry?' },
                    { name: 'show_signs_hungry',   label: 'Shows specific/unique signs/gestures when tasty or hungry?' }
                ]
            },
            {
                title: 'Signs / Gestures Details',
                type: 'textarea',
                fields: [{ name: 'signs_gestures_details', label: 'If yes, what signs/gestures?', placeholder: 'Describe the signs or gestures...' }]
            },
            {
                title: 'Attendance & Promotion',
                type: 'basic_info',
                fields: [
                    { name: 'attendance',  label: 'Days Present', type: 'number', },
                    { name: 'total_days',  label: 'Total Days',   type: 'number', },
                    { name: 'promoted_to', label: 'Promoted to',  type: 'text' }
                ]
            },
            {
                title: 'Remarks',
                type: 'remarks',
                fields: [
                    { name: 'class_caregiver_remarks', label: "Class Caregiver's Remarks", rows: 3 },
                    { name: 'head_teacher_remarks',    label: "Head Teacher's Remarks",    rows: 3 }
                ]
            }
        ]
    },

    // ── NURSERY ────────────────────────────────────────
    // Uses CRECHE_AND_NURSERY_REPORT_TEMPLATE.docx
    'nursery': {
        sections: [
            {
                title: 'Basic Information',
                type: 'basic_info',
                fields: [
                    { name: 'student_name',    label: 'Student Name',     type: 'text',   readonly: true, auto: 'name'  },
                    { name: 'term',            label: 'Term',             type: 'text',   readonly: true, auto: 'term'  },
                    { name: 'year',            label: 'Academic Year',    type: 'text',   readonly: true, auto: 'year'  },
                    { name: 'class',           label: 'Level',            type: 'text',   readonly: true, auto: 'class' },
                    { name: 'no_on_roll',      label: 'NO. On Roll',      type: 'number', readonly: true, auto: 'count' },
                    { name: 'date',            label: 'Date',             type: 'date' },
                    { name: 'next_term_begins',label: 'Next Term Begins', type: 'date' }
                ]
            },
            {
                title: 'Play Therapy Activities',
                type: 'rating_abcd',
                subtitle: 'A = Excellent  B = Very Good  C = Good  D = Weak',
                fields: [
                    { name: 'language_orals',    label: 'LANGUAGE ACT/ ORALS'     },
                    { name: 'express_self',      label: 'CAN EXPRESS SELF CLEARLY' },
                    { name: 'say_alphabets',     label: 'CAN SAY THE ALPHABETS'   },
                    { name: 'picture_reading',   label: 'PICTURE READING'         },
                    { name: 'rhymes_recitation', label: 'RHYMES/ RECITATIONS'     }
                ]
            },
            {
                title: 'Senses: Can Differentiate Between',
                type: 'rating_abcd',
                fields: [
                    { name: 'smell',  label: 'SMELL'  },
                    { name: 'colour', label: 'COLOUR' },
                    { name: 'taste',  label: 'TASTE'  },
                    { name: 'shapes', label: 'SHAPES' }
                ]
            },
            {
                title: 'Pre-Number Work',
                type: 'rating_abcd',
                fields: [
                    { name: 'counting_writing',   label: 'COUNTING & WRITING'         },
                    { name: 'nature_environment', label: 'NATURE & ENVIRONMENT'        },
                    { name: 'art_creativity',     label: 'ART & CREATIVITY'           },
                    { name: 'religious_moral',    label: 'RELIGIOUS & MORAL EDUCATION' }
                ]
            },
            {
                title: 'Physical Development',
                type: 'rating_abcd',
                fields: [
                    { name: 'throw_catch_kick', label: 'CAN THROW, CATCH & KICK A BALL'         },
                    { name: 'outdoor_games',    label: 'ACTIVE & ENJOY OUTDOOR GAMES'            },
                    { name: 'muscle_control',   label: 'SHOW GOOD MUSCLE CONTROL'               },
                    { name: 'write_letters',    label: 'CAN WRITE LETTER OR THE ALPHABET UP TO', type: 'text_value' },
                    { name: 'write_numerals',   label: 'CAN WRITE THE NUMERAL UP TO',            type: 'text_value' }
                ]
            },
            {
                title: 'Attendance & Promotion',
                type: 'basic_info',
                fields: [
                    { name: 'total_days',  label: 'Total School Days', type: 'number', },
                    { name: 'attendance',  label: 'Days Present',      type: 'number', },
                    { name: 'days_absent', label: 'Days Absent',       type: 'number', readonly: true  },
                    { name: 'promoted_to', label: 'Promoted To',       type: 'text' }
                ]
            },
            {
                title: 'Identified Skills',
                type: 'basic_info',
                fields: [
                    { name: 'interest', label: 'Identified Interest', type: 'text' },
                    { name: 'talent',   label: 'Identified Talent',   type: 'text' }
                ]
            },
            {
                title: 'Remarks',
                type: 'remarks',
                fields: [
                    { name: 'class_teacher_remarks', label: "Class Teacher's Remark", rows: 3 },
                    { name: 'head_teacher_remarks',  label: "Head Teacher's Remark",  rows: 3 }
                ]
            }
        ]
    },


    // ── KG ────────────────────────────────────────────────────────────────────────────
    // Matches K_G_REPORT_TEMPLATE.docx exactly.
    // Table columns: Subject | Class Score (50%) | Exam Score (50%) | Total Score (100%) | Remarks
    // Row labels must match template text EXACTLY for placeholder filling to work.
    'kg': {
        sections: [
            {
                title: 'Student Information',
                type: 'kg_student_info',
                fields: [
                    { name: 'student_name',     label: 'Student Name',     type: 'text',   readonly: true, auto: 'name'  },
                    { name: 'term',             label: 'Term',             type: 'text',   readonly: true, auto: 'term'  },
                    { name: 'year',             label: 'Academic Year',    type: 'text',   readonly: true, auto: 'year'  },
                    { name: 'class',            label: 'Level',            type: 'text',   readonly: true, auto: 'class' },
                    { name: 'no_on_roll',       label: 'NO. On Roll',      type: 'number', readonly: true, auto: 'count' },
                    { name: 'date',             label: 'Date',             type: 'date'   },
                    { name: 'next_term_begins', label: 'Next Term Begins', type: 'date'   }
                ]
            },
            {
                title: 'Performance Table',
                type: 'kg_unified_table',
                scoredRows: [
                    { name: 'language_orals',                 label: 'LANGUAGE ORALS'                    },
                    { name: 'language_literacy',              label: 'LANGUAGE & LITERACY'                },
                    { name: 'numeracy',                       label: 'NUMERACY'                          },
                    { name: 'handwriting',                    label: 'HANDWRITING'                       },
                    { name: 'creative_arts',                  label: 'CREATIVE ARTS'                     },
                    { name: 'phonics',                        label: 'PHONICS'                           },
                    { name: 'our_world',                      label: 'OUR WORLD, OUR PEOPLE'             },
                    { name: 'picture_reading_identification', label: 'PICTURE READING & IDENTIFICATION'  },
                    { name: 'senses_colours',                 label: 'COLOURS',                           section: 'senses'   },
                    { name: 'senses_shapes',                  label: 'SHAPES',                            section: 'senses'   },
                    { name: 'phys_outdoor_games',             label: 'ACTIVE & ENJOY OUTDOOR GAMES',      section: 'physical' },
                    { name: 'phys_muscle_control',            label: 'SHOWS GOOD MUSCLE CONTROL',         section: 'physical' },
                    { name: 'phys_neatness',                  label: 'NEATNESS',                          section: 'physical' },
                    { name: 'phys_leadership',                label: 'LEADERSHIP SKILLS',                 section: 'physical' }
                ]
            },
            {
                title: 'Attendance & Additional Information',
                type: 'kg_footer_info',
                fields: [
                    { name: 'total_days',            label: 'Total School Days',   type: 'number', },
                    { name: 'attendance',            label: 'Days Present',        type: 'number', },
                    { name: 'days_absent',           label: 'Days Absent',         type: 'number', readonly: true  },
                    { name: 'subject_of_interest',   label: 'Subject of Interest', type: 'text'   },
                    { name: 'conduct',               label: 'Conduct',             type: 'text'   },
                    { name: 'promoted_to',           label: 'Promoted To',         type: 'text'   },
                    { name: 'class_teacher_remarks', label: "Class Teacher's Remark", type: 'textarea', rows: 3 },
                    { name: 'head_teacher_remarks',  label: "Head Teacher's Remark",  type: 'textarea', rows: 3 }
                ]
            }
        ]
    },

        // ── LOWER PRIMARY ───────────────────────────────────────────────────────
    'lower': {
        sections: [
            {
                title: 'Basic Information',
                type: 'basic_info',
                fields: [
                    { name: 'student_name',    label: 'Student Name',     type: 'text',   readonly: true, auto: 'name'  },
                    { name: 'term',            label: 'Term',             type: 'text',   readonly: true, auto: 'term'  },
                    { name: 'year',            label: 'Academic Year',    type: 'text',   readonly: true, auto: 'year'  },
                    { name: 'class',           label: 'Level',            type: 'text',   readonly: true, auto: 'class' },
                    { name: 'no_on_roll',      label: 'NO. On Roll',      type: 'number', readonly: true, auto: 'count' },
                    { name: 'date',            label: 'Date',             type: 'date' },
                    { name: 'next_term_begins',label: 'Next Term Begins', type: 'date' }
                ]
            },
            {
                title: 'Academic Performance',
                type: 'subjects_scored_full',
                headers: ['Subject', 'Class Score (50%)', 'Exam Score (50%)', 'Total Score (100%)', 'Position', 'Remarks'],
                fields: [
                    { name: 'english',      label: 'ENGLISH LANGUAGE'           },
                    { name: 'mathematics',  label: 'MATHEMATICS'                },
                    { name: 'science',      label: 'SCIENCE'                    },
                    { name: 'history',      label: 'HISTORY'                    },
                    { name: 'rel_moral',    label: 'RELIGIOUS & MORAL EDUCATION' },
                    { name: 'asante_twi',   label: 'ASANTE TWI'                 },
                    { name: 'phonics',      label: 'PHONICS'                    },
                    { name: 'french',       label: 'FRENCH'                     },
                    { name: 'creative_arts',label: 'CREATIVE ARTS'              }
                ]
            },
            {
                title: 'Attendance & Promotion',
                type: 'basic_info',
                fields: [
                    { name: 'total_days',  label: 'Total School Days', type: 'number', },
                    { name: 'attendance',  label: 'Days Present',      type: 'number', },
                    { name: 'days_absent', label: 'Days Absent',       type: 'number', readonly: true  },
                    { name: 'promoted_to', label: 'Promoted To',       type: 'text' }
                ]
            },
            {
                title: 'Additional Information',
                type: 'basic_info',
                fields: [
                    { name: 'interest', label: 'Interest', type: 'text' },
                    { name: 'conduct',  label: 'Conduct',  type: 'text' }
                ]
            },
            {
                title: 'Remarks',
                type: 'remarks',
                fields: [
                    { name: 'class_teacher_remarks', label: "Class Teacher's Remark", rows: 3 },
                    { name: 'head_teacher_remarks',  label: "Head Teacher's Remark",  rows: 3 }
                ]
            }
        ]
    },

    // ── UPPER PRIMARY ───────────────────────────────────────────────────────
    'upper': {
        sections: [
            {
                title: 'Basic Information',
                type: 'basic_info',
                fields: [
                    { name: 'student_name',    label: 'Student Name',     type: 'text',   readonly: true, auto: 'name'  },
                    { name: 'term',            label: 'Term',             type: 'text',   readonly: true, auto: 'term'  },
                    { name: 'year',            label: 'Academic Year',    type: 'text',   readonly: true, auto: 'year'  },
                    { name: 'class',           label: 'Level',            type: 'text',   readonly: true, auto: 'class' },
                    { name: 'no_on_roll',      label: 'NO. On Roll',      type: 'number', readonly: true, auto: 'count' },
                    { name: 'date',            label: 'Date',             type: 'date' },
                    { name: 'next_term_begins',label: 'Next Term Begins', type: 'date' }
                ]
            },
            {
                title: 'Academic Performance',
                type: 'subjects_scored_full',
                headers: ['Subject', 'Class Score (50%)', 'Exam Score (50%)', 'Total Score (100%)', 'Position', 'Remarks'],
                fields: [
                    { name: 'english',      label: 'ENGLISH LANGUAGE'           },
                    { name: 'mathematics',  label: 'MATHEMATICS'                },
                    { name: 'science',      label: 'SCIENCE'                    },
                    { name: 'history',      label: 'HISTORY'                    },
                    { name: 'computing',    label: 'COMPUTING'                  },
                    { name: 'rel_moral',    label: 'RELIGIOUS & MORAL EDUCATION' },
                    { name: 'asante_twi',   label: 'ASANTE TWI'                 },
                    { name: 'phonics',      label: 'PHONICS'                    },
                    { name: 'french',       label: 'FRENCH'                     },
                    { name: 'creative_arts',label: 'CREATIVE ARTS'              }
                ]
            },
            {
                title: 'Attendance & Promotion',
                type: 'basic_info',
                fields: [
                    { name: 'total_days',  label: 'Total School Days', type: 'number', },
                    { name: 'attendance',  label: 'Days Present',      type: 'number', },
                    { name: 'days_absent', label: 'Days Absent',       type: 'number', readonly: true  },
                    { name: 'promoted_to', label: 'Promoted To',       type: 'text' }
                ]
            },
            {
                title: 'Additional Information',
                type: 'basic_info',
                fields: [
                    { name: 'interest', label: 'Interest', type: 'text' },
                    { name: 'conduct',  label: 'Conduct',  type: 'text' }
                ]
            },
            {
                title: 'Remarks',
                type: 'remarks',
                fields: [
                    { name: 'class_teacher_remarks', label: "Class Teacher's Remark", rows: 3 },
                    { name: 'head_teacher_remarks',  label: "Head Teacher's Remark",  rows: 3 }
                ]
            }
        ]
    }
};

// ==================== GRADE INTERPRETATION ====================
// Used to auto-fill subject remarks and initials for primary levels (lower/upper)
const GRADE_INTERPRETATION = [
    { min: 80, max: 100, grade: 'A', label: 'EXCELLENT',  remark: 'EXCELLENT'  },
    { min: 70, max: 79,  grade: 'B', label: 'VERY GOOD',  remark: 'VERY GOOD'  },
    { min: 60, max: 69,  grade: 'C', label: 'GOOD',       remark: 'GOOD'       },
    { min: 50, max: 59,  grade: 'D', label: 'CREDIT',     remark: 'CREDIT'     },
    { min: 45, max: 49,  grade: 'E', label: 'PASS',       remark: 'PASS'       },
    { min: 35, max: 44,  grade: 'F', label: 'WEAK PASS',  remark: 'WEAK PASS'  },
    { min: 0,  max: 34,  grade: 'G', label: 'FAIL',       remark: 'FAIL'       }
];

function getGradeInfo(totalScore) {
    const score = parseFloat(totalScore);
    if (isNaN(score)) return null;
    return GRADE_INTERPRETATION.find(g => score >= g.min && score <= g.max) || null;
}

// ==================== HEADTEACHER REMARKS LIST ====================
const HEAD_TEACHER_REMARKS = [
    'Excellent performance',
    'Good progress',
    'Needs improvement',
    'Encouraging progress',
    'Needs to stay focus',
    'Excellent attitude',
    'Needs to take books seriously',
    'Well done, keep it up',
    'Good work done',
    'A promising child, keep going',
    'Improving student',
    'Leadership potential',
    'Can do better',
    'Positive influence',
    'Consistent improvement',
    'Room for Growth',
    'Excellent participation'
];

// ==================== ERROR HANDLING ====================
class AppError extends Error {
    constructor(message, type = 'error', recoverable = false) {
        super(message);
        this.type = type;
        this.recoverable = recoverable;
    }
}

function handleError(error, context = '') {
    console.error(`[${context}] Error:`, error);
    
    let message = 'An unexpected error occurred';
    let type = 'error';
    
    if (error instanceof AppError) {
        message = error.message;
        type = error.type;
    } else if (error.message) {
        // Handle specific Supabase/Network errors
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            message = 'Network connection failed. Please check your internet connection.';
            type = 'warning';
        } else if (error.message.includes('constraint') || error.code === '23505') {
            message = 'Data conflict detected. This record may already exist.';
            type = 'error';
        } else if (error.message.includes('permission') || error.code === '42501') {
            message = 'Permission denied. Please check your access rights.';
            type = 'error';
        } else if (error.message.includes('timeout')) {
            message = 'Request timed out. Please try again.';
            type = 'warning';
        } else {
            message = error.message;
        }
    }
    
    showToast(message, type);
    return { message, type, original: error };
}

// ==================== LIVE TEACHER ASSIGNMENT REFRESH ====================
// Always called on page open to resolve the teacher's CURRENT assigned_class
// UUID from Supabase, bypassing any stale localStorage or URL param class data.
// This is the single source of truth for which class belongs to this teacher,
// and it mirrors exactly the same lookup the teacher dashboard uses.
async function refreshTeacherAssignment() {
    console.log('[refreshTeacherAssignment] Fetching live teacher record for id:', state.teacherId);

    try {
        // 1. Fetch the teacher row
        // FIX: The dashboard passes the profile_id (auth UUID) as teacherId.
        // We must check both profile_id and the internal teachers.id for maximum compatibility.
        // We also check by email as a final fallback if we have it in localStorage.
        const cachedEmail = localStorage.getItem('rv_report_teacher_email');
        let query = state.supabaseClient
            .from('teachers')
            .select('id, profile_id, full_name, email, assigned_class');

        if (cachedEmail) {
            query = query.or(`profile_id.eq.${state.teacherId},id.eq.${state.teacherId},email.eq.${cachedEmail}`);
        } else {
            query = query.or(`profile_id.eq.${state.teacherId},id.eq.${state.teacherId}`);
        }

        const { data: teacher, error: teacherError } = await query.maybeSingle();

        if (teacherError) {
            console.error('[refreshTeacherAssignment] Supabase error fetching teacher:', {
                code: teacherError.code,
                message: teacherError.message,
                details: teacherError.details,
                hint: teacherError.hint
            });
            throw teacherError;
        }

        if (!teacher) {
            console.error('[refreshTeacherAssignment] Teacher record not found in DB for ID:', state.teacherId);
            throw new Error('Teacher record not found');
        }

        console.log('[refreshTeacherAssignment] teacher.assigned_class (UUID):', teacher.assigned_class);

        // Update teacher name from live record (in case it changed)
        if (teacher.full_name) {
            state.teacherName = teacher.full_name;
            localStorage.setItem('rv_report_teacher_name', teacher.full_name);
        }
        if (teacher.email) {
            localStorage.setItem('rv_report_teacher_email', teacher.email);
        }

        const assignedClassId = teacher.assigned_class || null;

        if (!assignedClassId) {
            // Teacher has no class assignment at all
            console.warn('[refreshTeacherAssignment] Teacher has no assigned_class in DB');
            state.assignedClassId    = '';
            state.assignedClass      = '';
            state.assignedClassLevel = '';
            state.assignedClassGrade = '';
            localStorage.removeItem('rv_report_class_id');
            localStorage.removeItem('rv_report_class');
            return;
        }

        // 2. Resolve the class label from the classes table using the UUID
        const { data: classRecord, error: classError } = await state.supabaseClient
            .from('classes')
            .select('id, level, grade')
            .eq('id', assignedClassId)
            .maybeSingle();

        if (classError) {
            console.error('[refreshTeacherAssignment] Supabase error resolving class:', {
                classId: assignedClassId,
                code: classError.code,
                message: classError.message
            });
            // Still set the UUID even if label resolution fails — student queries can use UUID
            state.assignedClassId = assignedClassId;
            state.assignedClass   = localStorage.getItem('rv_report_class') || '';
            console.warn('[refreshTeacherAssignment] Falling back to UUID-only mode due to class resolution failure.');
            return;
        }

        if (!classRecord) {
            console.warn('[refreshTeacherAssignment] No class record found for UUID:', assignedClassId);
            state.assignedClassId = assignedClassId;
            state.assignedClass   = localStorage.getItem('rv_report_class') || '';
            return;
        }

        // Build class label from level and grade using buildResolvedClassName().
        // BASIC is only prepended for plain-number grades; NURSERY/KINDERGARTEN
        // grades already carry their own label and must not get a spurious prefix.
        const rawLevel = (classRecord.level || '').trim();
        const rawGrade = (classRecord.grade || '').trim();
        const classLabel = buildResolvedClassName(rawLevel, rawGrade) || assignedClassId;

        // Commit authoritative values to state
        state.assignedClassId    = assignedClassId;
        state.assignedClass      = classLabel;
        state.assignedClassLevel = rawLevel;
        state.assignedClassGrade = rawGrade;

        // Sync cache
        localStorage.setItem('rv_report_class_id', assignedClassId);
        localStorage.setItem('rv_report_class',    classLabel);

        console.log('[Teacher Assignment]', {
            teacherId:         state.teacherId,
            assignedClassUUID: assignedClassId,
            resolvedClassName: classLabel,
            level:             rawLevel,
            grade:             rawGrade
        });

    } catch (err) {
        // Prevent silent failure: log exact error details
        console.error('[refreshTeacherAssignment] CRITICAL FAILURE:', err);
        
        // Fallback to URL params or localStorage
        const params = new URLSearchParams(window.location.search);
        const fallbackId = params.get('classId') || localStorage.getItem('rv_report_class_id') || '';
        const fallbackName = params.get('class') || localStorage.getItem('rv_report_class') || '';
        
        state.assignedClassId = fallbackId;
        state.assignedClass   = fallbackName;
        
        console.warn('[refreshTeacherAssignment] Using STALE FALLBACK state because live refresh failed:', {
            assignedClassId: state.assignedClassId,
            assignedClass:   state.assignedClass,
            reason: err.message || 'Unknown error'
        });
    }
}

// ==================== INITIALIZATION ====================
async function initializeSupabase() {
    showGlobalLoading('Connecting to database...', 'Initializing report system');
    
    try {
        // Initialize Supabase client with error handling
        try {
            state.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { persistSession: true, autoRefreshToken: true },
                db: { schema: 'public' }
            });
        } catch (err) {
            throw new AppError('Failed to initialize database connection', 'error', false);
        }
        
        // ── Step 1: Resolve teacher identity from URL params or localStorage ─────
        const params = new URLSearchParams(window.location.search);
        state.teacherId   = params.get('teacherId')   || localStorage.getItem('rv_report_teacher_id');
        state.teacherName = params.get('teacherName') || localStorage.getItem('rv_report_teacher_name') || 'Teacher';
        state.academicYear = params.get('year') || localStorage.getItem('rv_report_year') || '2024/2025';
        state.term         = params.get('term') || localStorage.getItem('rv_report_term') || 'Term 1';

        // Persist identity (but NOT class — that will be refreshed live below)
        if (state.teacherId)    localStorage.setItem('rv_report_teacher_id',   state.teacherId);
        if (state.teacherName)  localStorage.setItem('rv_report_teacher_name', state.teacherName);
        if (state.academicYear) localStorage.setItem('rv_report_year',         state.academicYear);
        if (state.term)         localStorage.setItem('rv_report_term',         state.term);

        if (!state.teacherId) {
            hideGlobalLoading();
            showToast('Authentication required. Please login again.', 'error');
            return;
        }

        // ── Step 2: Refresh teacher assignment live from Supabase ─────────────
        // This is the critical fix: always re-fetch the teacher's current
        // assigned_class UUID from the DB so reassignments take effect immediately
        // without requiring logout, hard refresh, or cache clearing.
        await refreshTeacherAssignment();

        // ── Step 3: Validate that a class is now resolved ─────────────────────
        if (!state.assignedClassId && !state.assignedClass) {
            hideGlobalLoading();
            showToast('No class assigned. Please return to the dashboard.', 'warning');
            renderEmptyState('No Class Selected', 'Please return to the dashboard and select a class to manage reports.');
            return;
        }

        // Update UI with the freshly resolved class
        document.getElementById('teacher-name').textContent = state.teacherName;
        document.getElementById('class-info').textContent = `${state.assignedClass} | ${state.academicYear} - ${state.term}`;

        // ── Step 4: Load all supporting data in parallel ───────────────────────
        // Note: loadSchoolInfo() is no longer called here — school name and logo
        // are already embedded in the DOCX templates stored in Supabase Storage.
        await Promise.all([
            fetchAcademicYearData(),
            detectClassLevel(),
            checkIfTerm3()
        ]);

        // ── Step 4b: Check template availability and update the UI status ─────
        // This runs after detectClassLevel() so state.classLevel is resolved.
        // It probes Supabase Storage to confirm the template exists and updates
        // the template status panel — preventing it from staying at "Checking...".
        checkTemplateAvailability().catch(e =>
            console.warn('[checkTemplateAvailability] Non-critical error:', e)
        );
        
        await loadStudents();
        
        if (state.students.length === 0) {
            console.warn('[initializeSupabase] No students found.', {
                assignedClassId: state.assignedClassId,
                assignedClass:   state.assignedClass
            });
            renderEmptyState(
                'No Students Found',
                `No students found in class "${state.assignedClass}" (ID: ${state.assignedClassId || 'none'}). ` +
                `If this class was recently reassigned, ensure students have been enrolled in the new class.`
            );
            hideGlobalLoading();
            return;
        }
        
        await Promise.all([
            loadSavedReports(),
            loadAttendanceData()
        ]);
        // No template file needed — reports are built programmatically
        
        renderStudentsGrid();
        updateProgress();

        // Auto-patch: silently update live-auto fields in all saved reports
        // (fixes stale no_on_roll, attendance, term etc. without user action)
        patchLiveFieldsInSavedReports().then(patched => {
            if (patched > 0) {
                console.log(`[startup] Auto-patched ${patched} saved reports with updated live fields`);
                renderStudentsGrid(); // re-render to reflect any changes
                updateProgress();
            }
        }).catch(e => console.warn('[startup] Auto-patch failed (non-critical):', e));
        
        // Enable fill reports button — always enabled (no template file needed)
        const fillBtn = document.getElementById('fill-reports-btn');
        if (fillBtn) fillBtn.disabled = false;
        
        // Setup auto-save interval (30 seconds)
        // Only fires if there are ACTUAL unsaved changes (user typed something)
        // and no pending debounce timer is already handling it
        state.autoSaveInterval = setInterval(() => {
            if (state.currentStudentIndex >= 0 &&
                state.hasUnsavedChanges &&
                !state.isSubmitting &&
                !state.autoSaveTimer) {
                saveCurrentReportData(true).catch(() => {});
            }
        }, 30000);
        
        // Setup beforeunload warning
        window.addEventListener('beforeunload', (e) => {
            if (state.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            }
        });
        
    } catch (error) {
        handleError(error, 'Initialization');
        renderEmptyState('Initialization Failed', 'Failed to load the report system. Please refresh the page or contact support.');
    } finally {
        hideGlobalLoading();
    }
}

// ==================== DATA LOADING WITH ERROR HANDLING ====================
async function fetchAcademicYearData() {
    try {
        const { data, error } = await state.supabaseClient
            .from('academic_years')
            .select('*')
            .eq('active', true)
            .single();
        
        if (error) throw error;
        
        if (data) {
            state.currentAcademicYear = data;
            const activeTerm = data.terms?.find(t => t.active) || { name: state.term, id: '1' };
            state.currentTerm = activeTerm;
            
            // Only override if not explicitly set in URL
            const params = new URLSearchParams(window.location.search);
            if (!params.get('year')) state.academicYear = data.year;
            if (!params.get('term')) state.term = activeTerm.name;
        }
    } catch (err) {
        console.warn('Could not fetch academic year data:', err);
        // Non-critical error, continue with defaults
    }
}

// ==================== CLASS NAME NORMALIZATION ====================
// Normalizes class name strings for comparison only — handles formatting
// differences in spacing, hyphens, and capitalization across all class types:
//
//   PRE-SCHOOL classes:   "PRE-SCHOOL - NURSERY 1"      <-> "PRE - SCHOOL - NURSERY 1"
//                         "PRE-SCHOOL - KINDERGARTEN 2" <-> "PRE - SCHOOL - KINDERGARTEN 2"
//   LOWER PRIMARY:        "LOWER PRIMARY - BASIC 1"     <-> "lower primary - basic 1"
//   UPPER PRIMARY:        "UPPER PRIMARY - BASIC 4"     <-> "Upper Primary - Basic 4"
//
// NOTE: This function normalizes formatting ONLY. The class name passed in
// must already be correctly constructed (no spurious "BASIC" prefix on
// NURSERY/KINDERGARTEN grades). See buildResolvedClassName() for construction.
function normalizeClassName(className) {
    if (!className) return "";
    return className
        .toLowerCase()
        .trim()
        // Collapse all hyphen variants: "pre - school", "pre-school", "pre  -  school"
        // all become "pre-school" (bare hyphen, no surrounding spaces)
        .replace(/\s*-\s*/g, "-")
        // Collapse any remaining repeated spaces
        .replace(/\s+/g, " ")
        .trim();
}

// Constructs the canonical class name from classes.level and classes.grade.
// The BASIC prefix is added only for plain-number grades (1–6).
// NURSERY, KINDERGARTEN, KG, CRECHE grades already carry their own label.
//
//   level="PRE-SCHOOL"   grade="NURSERY 1"      → "PRE-SCHOOL - NURSERY 1"
//   level="PRE-SCHOOL"   grade="KINDERGARTEN 2" → "PRE-SCHOOL - KINDERGARTEN 2"
//   level="LOWER PRIMARY" grade="1"             → "LOWER PRIMARY - BASIC 1"
//   level="UPPER PRIMARY" grade="4"             → "UPPER PRIMARY - BASIC 4"
function buildResolvedClassName(level, grade) {
    const l = (level || '').trim();
    const g = (grade || '').trim();
    if (!l && !g) return '';
    if (!g) return l;
    if (!l) return g;

    const gl = g.toLowerCase();
    // Grade already has its own descriptive prefix — use directly
    const gradeHasOwnLabel = (
        gl.startsWith('nursery')      ||
        gl.startsWith('kindergarten') ||
        gl.startsWith('kg')           ||
        gl.startsWith('creche')       ||
        gl.startsWith('basic')        // already prefixed, avoid "BASIC BASIC N"
    );

    return gradeHasOwnLabel
        ? `${l} - ${g}`          // e.g. "PRE-SCHOOL - NURSERY 1"
        : `${l} - BASIC ${g}`;   // e.g. "LOWER PRIMARY - BASIC 1"
}

async function loadStudents() {
    // ── STEP 1: Log teacher UUID ───────────────────────────────────────────────
    console.log('[loadStudents] Teacher UUID:', state.teacherId);

    if (!state.assignedClassId) {
        console.warn('[loadStudents] No assignedClassId available — cannot load students.');
        state.students = [];
        return;
    }

    try {
        // ── STEP 2: Resolve exact class name from classes table ────────────────
        // Build resolved class name as CONCAT(level, ' - ', grade), e.g. "UPPER PRIMARY - BASIC 5"
        const { data: classRecord, error: classError } = await state.supabaseClient
            .from('classes')
            .select('id, level, grade')
            .eq('id', state.assignedClassId)
            .maybeSingle();

        if (classError) {
            console.error('[loadStudents] Failed to resolve class record:', classError);
            throw classError;
        }

        if (!classRecord) {
            console.error('[loadStudents] No class record found for UUID:', state.assignedClassId);
            state.students = [];
            return;
        }

        // Build the canonical class name using the same function as refreshTeacherAssignment().
        // BASIC is only prepended for plain-number grades (1–6).
        // NURSERY / KINDERGARTEN grades carry their own label already.
        const rawLevel = (classRecord.level || '').trim();
        const rawGrade = (classRecord.grade || '').trim();
        const resolvedClassName = buildResolvedClassName(rawLevel, rawGrade) || state.assignedClassId;

        console.log('[loadStudents] Resolved class name:', resolvedClassName);

        // ── STEP 3: Fetch ALL students, filter by normalized class name ────────────
        // students.class stores actual class names only — no UUID comparisons.
        // normalizeClassName() handles spacing/hyphen/wording differences between
        // the name constructed from classes.level+grade and the value stored in
        // students.class (e.g. "PRE-SCHOOL - BASIC KINDERGARTEN 2" matches
        // "PRE - SCHOOL - KINDERGARTEN 2" after normalization).
        const FIELDS = 'id, name, class, grade, class_id, student_id, gender, date_of_birth';

        const { data: allStudents, error: fetchError } = await state.supabaseClient
            .from('students')
            .select(FIELDS)
            .order('name');

        if (fetchError) {
            console.error('[loadStudents] Error fetching students:', fetchError);
            throw fetchError;
        }

        const normalizedExpectedClass = normalizeClassName(resolvedClassName);
        console.log('[Student Loading] Expected class (normalized):', normalizedExpectedClass);

        let matched = 0;
        let rejected = 0;

        const filtered = (allStudents || []).filter(s => {
            const normalizedStudentClass = normalizeClassName(s.class);

            console.log(`[Student Loading] Comparing: "${normalizedStudentClass}" === "${normalizedExpectedClass}"`);

            const matches = normalizedStudentClass === normalizedExpectedClass;

            if (matches) {
                matched++;
                console.log(`[Student Loading] MATCHED: ${s.name}`);
            } else {
                rejected++;
                console.log(`[Student Loading] REJECTED: ${s.name} | raw="${s.class}" | normalized="${normalizedStudentClass}" | expected="${normalizedExpectedClass}"`);
            }

            return matches;
        });

        console.log(`[Student Loading] Final matched=${matched} | rejected=${rejected} | total fetched=${(allStudents || []).length}`);

        state.students = filtered;

        // ── STEP 4: Validate student data ─────────────────────────────────────
        state.students.forEach((student, index) => {
            if (!student.id) {
                console.warn(`Student at index ${index} missing ID:`, student);
                student.id = `temp-${index}`;
            }
            if (!student.name) {
                student.name = 'Unknown Student';
            }
        });

        console.log('[loadStudents] Final student count for report generation:', state.students.length);

    } catch (err) {
        throw new AppError(`Failed to load students: ${err.message}`, 'error', true);
    }
}

async function loadAttendanceData() {
    // Attendance is now entered manually by teachers — no auto-loading needed.
    // Initialize empty attendanceData structure so existing references don't break.
    state.students.forEach(student => {
        state.attendanceData[student.id] = { present: 0, absent: 0, total: 0, percentage: 0 };
    });
}

async function loadSavedReports() {
    if (!state.assignedClass && !state.assignedClassId) {
        state.reportsData = {};
        return;
    }
    
    try {
        // ── PRIMARY strategy: load by student_id set ──────────────────────────
        // This is completely teacher-agnostic. No matter which teacher is
        // assigned, reports always follow the students in the current class.
        // Teacher ownership (teacher_id) is NEVER used as a filter here.
        const currentStudentIds = state.students.map(s => s.id).filter(Boolean);

        console.log('[Saved Reports] Loading reports for student IDs:', currentStudentIds);

        let allReports = [];

        if (currentStudentIds.length > 0) {
            // Load by student_id — the source of truth
            const { data: studentReports, error: studentError } = await state.supabaseClient
                .from('reports')
                .select('*')
                .in('student_id', currentStudentIds)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear);

            if (studentError) {
                console.warn('[Saved Reports] student_id query failed, falling back:', studentError);
            } else {
                allReports = studentReports || [];
            }
        }

        // ── FALLBACK / SUPPLEMENT: also fetch by class_id or class name ───────
        // Catches any reports saved before student_id was indexed, or with
        // different term/year if data is slightly inconsistent.
        if (state.assignedClassId) {
            const { data: uuidData } = await state.supabaseClient
                .from('reports')
                .select('*')
                .eq('class_id', state.assignedClassId)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear);

            const { data: strData } = await state.supabaseClient
                .from('reports')
                .select('*')
                .eq('class', state.assignedClass)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear);

            // Merge all sources; later entries overwrite earlier for same student_id
            const merged = new Map();
            (strData    || []).forEach(r => merged.set(r.student_id, r));
            (uuidData   || []).forEach(r => merged.set(r.student_id, r));
            allReports.forEach(r => merged.set(r.student_id, r)); // student_id query wins
            allReports = Array.from(merged.values());
        } else if (allReports.length === 0) {
            // Legacy string-only fallback when no UUID is available
            const { data: legacyData, error: legacyError } = await state.supabaseClient
                .from('reports')
                .select('*')
                .eq('class', state.assignedClass)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear);

            if (!legacyError) allReports = legacyData || [];
        }

        // ── Filter to only reports belonging to current class students ─────────
        // Ensures a reassigned teacher never sees reports from a different class
        // even if the DB returned extras from the fallback queries.
        if (currentStudentIds.length > 0) {
            allReports = allReports.filter(r => currentStudentIds.includes(r.student_id));
        }

        // ── Build reportsData map ─────────────────────────────────────────────
        state.reportsData = {};
        allReports.forEach(report => {
            let parsedData = report.data;
            if (typeof parsedData === 'string') {
                try { parsedData = JSON.parse(parsedData); } catch(e) { parsedData = {}; }
            }
            if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
                parsedData = {};
            }
            state.reportsData[report.student_id] = {
                id:          report.id           || null,
                studentId:   report.student_id,
                studentName: report.student_name || (state.students.find(s => s.id === report.student_id) || {}).name || '',
                completed:   report.completed   || false,
                submitted:   report.submitted   || false,
                submittedAt: report.submitted_at || null,
                lastModified:report.last_modified || null,
                fileUrl:     report.file_url     || null,
                data:        parsedData
            };
        });

        console.log('[Saved Reports]', {
            loadedCount: Object.keys(state.reportsData).length,
            studentIdsUsed: currentStudentIds,
            classUUID: state.assignedClassId,
            className: state.assignedClass
        });

        // Seed empty placeholder for every student with no saved record yet,
        // so ensureStudentReportLoaded never needs to hit the DB for them.
        state.students.forEach(student => {
            if (state.reportsData[student.id] === undefined) {
                state.reportsData[student.id] = {
                    studentId: student.id,
                    studentName: student.name,
                    completed: false,
                    submitted: false,
                    submittedAt: null,
                    lastModified: null,
                    fileUrl: null,
                    data: {}
                };
            }
        });

        console.log('[Saved Reports] After seeding, total state entries:',
            Object.keys(state.reportsData).length);
        
    } catch (err) {
        throw new AppError(`Failed to load saved reports: ${err.message}`, 'error', true);
    }
}

async function loadTemplateFromBackend() {
    // Determine the primary filename for this class level
    const primaryFilename = TEMPLATE_FILES[state.classLevel];

    if (!primaryFilename) {
        // classLevel is not one of the five known keys — this should never happen
        // after detectClassLevel(), but guard it anyway
        const fallback = TEMPLATE_FILES['kg'];
        console.error('[Template] Unknown classLevel "' + state.classLevel + '". Falling back to KG template: ' + fallback);
        showToast(
            'Unknown class level "' + state.classLevel + '". Using KG template as fallback. ' +
            'Please verify the class name format.',
            'warning'
        );
        state.classLevel = 'kg'; // correct the level too
    }

    const resolvedFilename = TEMPLATE_FILES[state.classLevel]; // re-read after potential correction

    // Build candidate paths: try the file at root, then common subfolder names,
    // and lowercase/uppercase variants of the filename to cover server case-sensitivity
    const lowerName = resolvedFilename.toLowerCase();
    const upperName = resolvedFilename.toUpperCase();
    const candidates = [
        resolvedFilename,
        lowerName,
        upperName,
        `templates/${resolvedFilename}`,
        `templates/${lowerName}`,
        `Templates/${resolvedFilename}`,
        `TEMPLATES/${resolvedFilename}`,
        `docx/${resolvedFilename}`,
        `reports/${resolvedFilename}`,
    ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

    state.template.filename = resolvedFilename;
    document.getElementById('template-name').textContent = resolvedFilename;
    document.getElementById('template-status-text').textContent = 'Downloading...';

    console.log(`[Template] Class: "${state.assignedClass}" → Level: "${state.classLevel}" → File: "${resolvedFilename}"`);
    console.log(`[Template] Will try ${candidates.length} candidate paths:`, candidates);

    let lastError = null;
    for (const filename of candidates) {
        try {
            console.log(`[Template] Trying: ${filename}`);
            const response = await fetch(filename);
            if (!response.ok) {
                lastError = `HTTP ${response.status} for "${filename}"`;
                continue; // try next candidate
            }

            const arrayBuffer = await response.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);
            const docXml = zip.file('word/document.xml');
            if (!docXml) {
                lastError = `"${filename}" is not a valid DOCX file (missing word/document.xml)`;
                continue;
            }
            const xmlContent = await docXml.async('text');

            state.template = {
                file: filename,
                arrayBuffer: arrayBuffer.slice(0),
                xmlContent: xmlContent,
                found: true,
                filename: filename
            };

            console.log(`[Template] Loaded successfully: ${filename}`);
            document.getElementById('template-name').textContent = filename;
            document.getElementById('template-status-text').textContent =
                `Ready · ${state.classLevel.toUpperCase()} (${state.assignedClass})`;
            document.getElementById('template-status-icon').innerHTML = '<i class="fas fa-check text-emerald-600 text-sm"></i>';
            document.getElementById('template-status-icon').className = 'w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center';
            return; // success — stop trying

        } catch (err) {
            lastError = err.message;
            console.warn(`[Template] Failed for "${filename}":`, err.message);
        }
    }

    // All candidates failed
    state.template.found = false;
    document.getElementById('template-status-text').textContent = 'Not Found';
    document.getElementById('template-status-icon').innerHTML = '<i class="fas fa-exclamation text-red-600 text-sm"></i>';
    document.getElementById('template-status-icon').className = 'w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center';

    const expectedFile = TEMPLATE_FILES[state.classLevel] || '(unknown)';
    const msg = `Template not found for class level "${state.classLevel}". ` +
        `Expected file: "${expectedFile}" — tried ${candidates.length} paths. ` +
        `Last error: ${lastError}. ` +
        `Ensure the .docx file is in the same folder as report.html.`;
    console.error('[Template]', msg);
    showToast(msg, 'error');
}

// ── Check template availability from Supabase Storage and update the status UI ──
// Called after detectClassLevel() during initialization so the UI never gets
// permanently stuck on "Checking...". Updates template-name, template-status-text,
// and template-status-icon elements accordingly.
async function checkTemplateAvailability() {
    const nameEl   = document.getElementById('template-name');
    const statusEl = document.getElementById('template-status-text');
    const iconEl   = document.getElementById('template-status-icon');

    if (!nameEl || !statusEl || !iconEl) return; // elements not present in this HTML layout

    const fileName = TEMPLATE_FILES[state.classLevel];
    if (!fileName) {
        statusEl.textContent = 'Unknown level';
        iconEl.innerHTML = '<i class="fas fa-exclamation text-amber-500 text-sm"></i>';
        iconEl.className = 'w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center';
        return;
    }

    nameEl.textContent = fileName;
    statusEl.textContent = 'Checking...';
    iconEl.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500 text-sm"></i>';
    iconEl.className = 'w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center';

    try {
        const { data: urlData } = state.supabaseClient.storage
            .from(TEMPLATE_BUCKET)
            .getPublicUrl(fileName);

        const url = urlData?.publicUrl;
        if (!url) throw new Error('Could not get public URL');

        // Do a lightweight HEAD request to confirm the file exists
        const resp = await fetch(url, { method: 'HEAD' });

        if (resp.ok) {
            statusEl.textContent = `Ready \u00B7 ${state.classLevel.toUpperCase()} (${state.assignedClass})`;
            iconEl.innerHTML = '<i class="fas fa-check text-emerald-600 text-sm"></i>';
            iconEl.className = 'w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center';
            console.log(`[checkTemplateAvailability] Template available: ${fileName}`);
        } else {
            throw new Error(`HTTP ${resp.status}`);
        }
    } catch (err) {
        statusEl.textContent = 'Not Found';
        iconEl.innerHTML = '<i class="fas fa-exclamation text-red-600 text-sm"></i>';
        iconEl.className = 'w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center';
        console.warn(`[checkTemplateAvailability] Template not found: ${fileName} — ${err.message}`);
    }
}

// ==================== HTML ESCAPE UTILITY ====================
// Prevents XSS and broken HTML when student data contains quotes/special chars
function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== CALCULATION FUNCTIONS ====================
function getOrdinal(n) {
    if (!n || isNaN(n)) return '-';
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function detectClassLevel() {
    // Always trim and lowercase for consistent matching
    const raw       = (state.assignedClass || '').trim();
    const className = raw.toLowerCase();

    console.log('[detectClassLevel] Detecting level for class:', JSON.stringify(raw));

    // ── Crèche / Nursery / KG — keyword-first, most specific ─────────────────
    if (
        className.includes('creche')  ||
        className.includes('crèche')  ||
        className.includes('crèche')  ||   // both accent variants
        className.includes('baby')    ||
        className.includes('toddler') ||
        className.includes('pre-nursery') ||
        className.includes('prenursery')
    ) {
        state.classLevel = 'creche';

    } else if (
        className.includes('kindergarten') ||
        // Match 'kg' only as a whole word/abbreviation, not inside 'pkg' etc.
        /\bkg\b/.test(className)
    ) {
        // KG check must come BEFORE nursery/pre-school so that
        // 'PRE-SCHOOL - KINDERGARTEN 1' resolves to kg, not nursery.
        state.classLevel = 'kg';

    } else if (
        className.includes('nursery') ||
        className.includes('playgroup') ||
        className.includes('pre-school') ||
        className.includes('preschool')
    ) {
        state.classLevel = 'nursery';

    } else {
        // ── Number-based detection for Primary / Basic / Class / Form ─────────
        // Extract the FIRST standalone number in the class name.
        // Use \b word-boundary so "KG1" doesn't accidentally trigger this path
        // (KG was already caught above, but belt-and-suspenders).
        const numMatch = className.match(/\b(\d+)\b/);

        if (numMatch) {
            const num = parseInt(numMatch[1], 10);

            // JHS / JSS / SHS / SSS / Form — secondary school levels
            // These should NOT match any primary template
            const isSecondary =
                className.includes('jhs')  ||
                className.includes('jss')  ||
                className.includes('shs')  ||
                className.includes('sss')  ||
                (className.includes('form') && num >= 1);

            if (isSecondary) {
                // No matching template — warn clearly and fall back to upper
                console.warn('[detectClassLevel] Secondary school class detected (' +
                    JSON.stringify(raw) + '). No exact template available; defaulting to upper primary.');
                showToast(
                    'Warning: Class "' + raw + '" looks like a secondary level. ' +
                    'Using Upper Primary template as fallback. Check template assignment.',
                    'warning'
                );
                state.classLevel = 'upper';

            } else if (num >= 1 && num <= 3) {
                state.classLevel = 'lower';   // Primary 1–3 / Class 1–3 / Basic 1–3

            } else if (num >= 4 && num <= 6) {
                state.classLevel = 'upper';   // Primary 4–6 / Class 4–6 / Basic 4–6

            } else if (num === 0) {
                // Class 0 — treat as KG
                state.classLevel = 'kg';

            } else {
                // Number out of expected primary range (7+) — warn and default upper
                console.warn('[detectClassLevel] Number ' + num + ' out of primary range (1-6) for class: ' +
                    JSON.stringify(raw) + '. Defaulting to upper primary.');
                showToast(
                    'Warning: Class "' + raw + '" has number ' + num + ' which is outside the expected ' +
                    'primary range (1–6). Using Upper Primary template as fallback.',
                    'warning'
                );
                state.classLevel = 'upper';
            }

        } else {
            // No number found and no keyword matched
            // Check for known reception/transition words before giving up
            if (
                className.includes('reception') ||
                className.includes('transition') ||
                className.includes('prep')
            ) {
                state.classLevel = 'kg';
            } else {
                console.warn('[detectClassLevel] Cannot determine level for class: ' +
                    JSON.stringify(raw) + '. Defaulting to KG template.');
                showToast(
                    'Warning: Could not determine the class level for "' + raw + '". ' +
                    'Defaulting to KG template. If incorrect, check the class name format.',
                    'warning'
                );
                state.classLevel = 'kg';
            }
        }
    }

    console.log('[detectClassLevel] Resolved "' + raw + '" → classLevel: "' + state.classLevel + '"');
}

function checkIfTerm3() {
    const termLower = (state.term || '').toLowerCase().replace(/\s/g, '');
    state.isTerm3 = ['term3', 'term-3', '3rdterm', 'thirdterm'].includes(termLower);
    state.calculateClassPosition = state.isTerm3;
}

function calculateAllPositions() {
    if (!state.classLevel || ['creche', 'nursery'].includes(state.classLevel)) return;

    const config = TEMPLATE_CONFIG[state.classLevel];
    const subjectSection = config.sections.find(
        s => s.type === 'subjects_scored' || s.type === 'subjects_scored_full' || s.type === 'kg_unified_table'
    );
    if (!subjectSection) return;

    const subjects = (subjectSection.type === 'kg_unified_table'
        ? (subjectSection.scoredRows || [])
        : subjectSection.fields).map(f => f.name);

    // ── Subject-level positions ──────────────────────────────────────────────
    subjects.forEach(subjectName => {
        // Collect scores for students who have a saved report
        const scores = state.students
            .filter(s => state.reportsData[s.id])
            .map(student => {
                const d = state.reportsData[student.id]?.data?.[subjectName];
                const rawScore = d?.total_score;
                const cs = parseFloat(d?.class_score) || 0;
                const es = parseFloat(d?.exam_score)  || 0;
                const score = rawScore ? parseFloat(rawScore) : (cs + es > 0 ? cs + es : 0);
                return { studentId: student.id, score };
            })
            .sort((a, b) => b.score - a.score);

        let pos = 1, prevScore = null, tied = 0;
        scores.forEach(item => {
            if (prevScore !== null) {
                if (item.score < prevScore)  { pos += tied + 1; tied = 0; }
                else if (item.score === prevScore) { tied++; }
            }
            if (!state.reportsData[item.studentId])
                state.reportsData[item.studentId] = { data: {} };
            if (!state.reportsData[item.studentId].data[subjectName])
                state.reportsData[item.studentId].data[subjectName] = {};
            state.reportsData[item.studentId].data[subjectName].position = getOrdinal(pos);
            prevScore = item.score;
        });
    });

    // ── Class-level (overall) positions ─────────────────────────────────────
    if (state.calculateClassPosition) {
        calculateClassPositions(subjects);
    }
}

function calculateClassPositions(subjects) {
    // Include every student that has a report (even if scores are 0)
    // Only skip students with no report entry at all
    const totals = state.students
        .filter(s => state.reportsData[s.id] && state.reportsData[s.id].data)
        .map(student => {
            const d = state.reportsData[student.id].data;
            let total = 0;
            subjects.forEach(subj => {
                const sd = d[subj];
                if (sd) {
                    const ts = sd.total_score;
                    const cs = parseFloat(sd.class_score) || 0;
                    const es = parseFloat(sd.exam_score)  || 0;
                    total += ts ? (parseFloat(ts) || 0) : (cs + es);
                }
            });
            return { studentId: student.id, total };
        })
        .sort((a, b) => b.total - a.total);

    let pos = 1, prevTotal = null, tied = 0;
    totals.forEach(item => {
        if (prevTotal !== null) {
            if (item.total < prevTotal) { pos += tied + 1; tied = 0; }
            else if (item.total === prevTotal) { tied++; }
        }
        state.reportsData[item.studentId].data.class_position = getOrdinal(pos);
        state.reportsData[item.studentId].data.total_score    = item.total;
        prevTotal = item.total;
    });

    // Students with no report entry at all get no position (leave untouched)
    console.log('[calculateClassPositions] Positions assigned for', totals.length, 'students');
}

function calculateStudentTotal(studentId) {
    if (!state.classLevel || ['creche', 'nursery'].includes(state.classLevel)) return 0;
    
    const config = TEMPLATE_CONFIG[state.classLevel];
    const subjectSection = config.sections.find(s => s.type === 'subjects_scored' || s.type === 'subjects_scored_full' || s.type === 'kg_unified_table');
    if (!subjectSection) return 0;
    
    const report = state.reportsData[studentId];
    if (!report?.data) return 0;
    
    const sectionFields = subjectSection.type === 'kg_unified_table'
        ? (subjectSection.scoredRows || [])
        : subjectSection.fields;
    return sectionFields.reduce((sum, field) => {
        const score = report.data[field.name]?.total_score;
        return sum + (parseFloat(score) || 0);
    }, 0);
}

// ==================== SCORE VALIDATION ====================
// Clamps a score input to 0-50. If the entered value exceeds 50 it is
// immediately reset to 0 and a toast notifies the teacher.
// Returns true if valid, false if it was clamped.
function validateScoreInput(input) {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 50) {
        input.value = '0';
        input.classList.add('score-invalid-shake');
        setTimeout(() => input.classList.remove('score-invalid-shake'), 500);
        showToast('Score cannot exceed 50. Value reset to 0.', 'error');
        return false;
    }
    if (!isNaN(val) && val < 0) {
        input.value = '0';
        return false;
    }
    return true;
}

// Returns true only if ALL score inputs on the current form are valid.
function allScoresValid() {
    const container = document.getElementById('form-container');
    if (!container) return true;
    let valid = true;
    container.querySelectorAll('[data-field="class_score"], [data-field="exam_score"]').forEach(input => {
        const val = parseFloat(input.value);
        if (!isNaN(val) && (val > 50 || val < 0)) valid = false;
    });
    return valid;
}

// ==================== AUTO-FILL REMARKS & GRADE (PRIMARY) ====================
// Called when class_score or exam_score changes on a primary report row.
// Updates the remarks field with a grade-based remark and fills the grade badge.
function autoFillRemarkAndGrade(changedInput) {
    const container = document.getElementById('form-container');
    if (!container) return;
    const subjectName = changedInput.getAttribute('data-subject');
    if (!subjectName) return;

    const classEl  = container.querySelector(`[data-subject="${subjectName}"][data-field="class_score"]`);
    const examEl   = container.querySelector(`[data-subject="${subjectName}"][data-field="exam_score"]`);
    const totalEl  = container.querySelector(`[data-subject="${subjectName}"][data-field="total_score"]`);
    const remarkEl = container.querySelector(`[data-subject="${subjectName}"][data-field="remarks"]`);
    const gradeEl  = container.querySelector(`[data-subject="${subjectName}"][data-field="teacher_initials"]`);

    if (!classEl || !examEl || !totalEl) return;

    const c = parseFloat(classEl.value) || 0;
    const e = parseFloat(examEl.value)  || 0;
    const total = c + e;

    // Update total display
    totalEl.value = (c + e) > 0 ? String(total) : '';

    const gradeInfo = getGradeInfo(total);
    if (gradeInfo) {
        if (remarkEl) {
            // Remark is always auto-filled from grade interpretation (readonly field)
            const isRo = remarkEl.hasAttribute('readonly');
            if (isRo) remarkEl.removeAttribute('readonly');
            remarkEl.value = gradeInfo.remark;
            if (isRo) remarkEl.setAttribute('readonly', '');
            // Colour-code remark by grade
            remarkEl.className = remarkEl.className
                .replace(/\btext-emerald-\d+\b/g, '').replace(/\btext-blue-\d+\b/g, '')
                .replace(/\btext-amber-\d+\b/g, '').replace(/\btext-red-\d+\b/g, '')
                .replace(/\btext-slate-\d+\b/g, '').trim();
            if      (['A'].includes(gradeInfo.grade)) remarkEl.classList.add('text-emerald-600');
            else if (['B'].includes(gradeInfo.grade)) remarkEl.classList.add('text-blue-600');
            else if (['C', 'D'].includes(gradeInfo.grade)) remarkEl.classList.add('text-amber-600');
            else remarkEl.classList.add('text-red-600');
        }
        if (gradeEl) {
            const isRo = gradeEl.hasAttribute('readonly');
            if (isRo) gradeEl.removeAttribute('readonly');
            gradeEl.value = gradeInfo.grade;
            if (isRo) gradeEl.setAttribute('readonly', '');
            // Style by grade
            gradeEl.className = gradeEl.className
                .replace(/\btext-emerald-\d+\b/g, '').replace(/\btext-blue-\d+\b/g, '')
                .replace(/\btext-amber-\d+\b/g, '').replace(/\btext-red-\d+\b/g, '')
                .replace(/\btext-slate-\d+\b/g, '').trim();
            if      (['A'].includes(gradeInfo.grade)) gradeEl.classList.add('text-emerald-600');
            else if (['B'].includes(gradeInfo.grade)) gradeEl.classList.add('text-blue-600');
            else if (['C', 'D'].includes(gradeInfo.grade)) gradeEl.classList.add('text-amber-600');
            else gradeEl.classList.add('text-red-600');
        }
    }
}

// ==================== CLASS POSITION TOGGLE ====================

// Called by the Activate/Deactivate Position button in the editor header
function toggleClassPosition() {
    // Flip the flag
    state.calculateClassPosition = !state.calculateClassPosition;
    state.positionManuallySet = true;

    if (state.calculateClassPosition) {
        // ACTIVATING — recalculate and fill positions for all students
        calculateAllPositions();
    } else {
        // DEACTIVATING — clear class_position from every student's in-state data
        // so the field saves as blank and shows blank in the report
        state.students.forEach(student => {
            if (state.reportsData[student.id]?.data) {
                state.reportsData[student.id].data.class_position = '';
            }
        });
    }

    // Update the button label + header badge
    updateClassPositionButton();
    updatePositionDisplay();

    // Refresh the class_position input in the current form
    const student = state.students[state.currentStudentIndex];
    if (student) {
        const posInput = document.querySelector('[data-field="class_position"]');
        if (posInput) {
            const pos = state.reportsData[student.id]?.data?.class_position || '';
            const isReadonly = posInput.hasAttribute('readonly');
            if (isReadonly) posInput.removeAttribute('readonly');
            posInput.value = pos;
            if (isReadonly) posInput.setAttribute('readonly', '');
        }
    }

    const status = state.calculateClassPosition ? 'activated' : 'deactivated';
    showToast(`Class position ${status}.`, 'success');
}

// Refresh the toggle button's label to match current state
function updateClassPositionButton() {
    const btn = document.getElementById('toggle-position-btn');
    if (!btn) return;

    const isActive = state.calculateClassPosition;
    btn.textContent = isActive ? '🏅 Deactivate Position' : '🏅 Activate Position';
    btn.className = btn.className
        .replace(/bg-\S+/g, '')
        .replace(/text-\S+/g, '')
        .trim();
    if (isActive) {
        btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
    } else {
        btn.classList.add('bg-slate-500', 'hover:bg-slate-600', 'text-white');
    }
}

// Refresh the position badge in the editor header
function updatePositionDisplay() {
    const student = state.students[state.currentStudentIndex];
    const posWrapper = document.getElementById('class-position-wrapper');
    const posValue   = document.getElementById('editor-position');
    const isPrimary  = ['lower', 'upper'].includes(state.classLevel);

    if (!posWrapper) return;

    if (isPrimary && state.calculateClassPosition) {
        posWrapper.classList.remove('hidden');
        const position = (student && state.reportsData[student.id]?.data?.class_position) || '-';
        if (posValue) {
            posValue.textContent = position;
            const n = parseInt(position);
            posValue.className = n === 1 ? 'text-2xl font-bold text-yellow-400'
                               : n === 2 ? 'text-2xl font-bold text-slate-300'
                               : n === 3 ? 'text-2xl font-bold text-amber-400'
                               : 'text-2xl font-bold text-white';
        }
    } else {
        posWrapper.classList.add('hidden');
    }
}

// ==================== REFRESH SYSTEM DATA ====================

// Patches all saved reports in Supabase whose live auto-fields
// (no_on_roll, student_name, term, year, class, attendance)
// no longer match current state. Returns count of patched records.
async function patchLiveFieldsInSavedReports() {
    const newCount  = state.students.length;
    const patches   = [];

    for (const student of state.students) {
        const report = state.reportsData[student.id];
        // Only patch reports that have been saved (have lastModified)
        if (!report || !report.lastModified) continue;

        const d        = report.data || {};
        let   changed  = false;
        const newData  = { ...d };

        // no_on_roll — always the current student count
        if (String(d.no_on_roll) !== String(newCount)) {
            newData.no_on_roll = String(newCount);
            changed = true;
        }
        // student_name
        if (d.student_name !== undefined && d.student_name !== student.name) {
            newData.student_name = student.name;
            changed = true;
        }
        // term
        if (d.term !== undefined && d.term !== state.term) {
            newData.term = state.term;
            changed = true;
        }
        // year
        if (d.year !== undefined && d.year !== state.academicYear) {
            newData.year = state.academicYear;
            changed = true;
        }
        // class
        if (d.class !== undefined && d.class !== state.assignedClass) {
            newData.class = state.assignedClass;
            changed = true;
        }
        // Note: attendance and total_days are manually entered by teachers — not auto-patched

        if (changed) {
            patches.push({ studentId: student.id, newData });
        }
    }

    if (patches.length === 0) return 0;

    // Apply patches to Supabase in parallel (max 5 at a time)
    let patchedCount = 0;
    const BATCH = 5;
    for (let i = 0; i < patches.length; i += BATCH) {
        const batch = patches.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ studentId, newData }) => {
            try {
                // Build the update query — match on class_id if available, else class string
                let updateQuery = state.supabaseClient
                    .from('reports')
                    .update({ data: newData, last_modified: new Date().toISOString() })
                    .eq('student_id', studentId)
                    .eq('term', state.term)
                    .eq('academic_year', state.academicYear);

                if (state.assignedClassId) {
                    updateQuery = updateQuery.eq('class_id', state.assignedClassId);
                } else {
                    updateQuery = updateQuery.eq('class', state.assignedClass);
                }

                const { error } = await updateQuery;
                if (error) {
                    console.warn('[patchLiveFields] Error patching', studentId, error);
                } else {
                    // Update in-state too
                    state.reportsData[studentId].data = newData;
                    state.reportsData[studentId].lastModified = new Date().toISOString();
                    patchedCount++;
                }
            } catch (e) {
                console.warn('[patchLiveFields] Exception patching', studentId, e);
            }
        }));
    }

    return patchedCount;
}

// Full system refresh — re-fetches all live data then patches saved reports
async function refreshSystemData() {
    const btn = document.getElementById('refresh-data-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Refreshing...';
    }

    try {
        showGlobalLoading('Refreshing...', 'Re-fetching students, attendance & saved reports');

        // Re-fetch everything in the correct order
        await loadStudents();
        await Promise.all([
            loadSavedReports(),
            loadAttendanceData()
        ]);

        // Patch any stale live-auto fields in already-saved reports
        const patched = await patchLiveFieldsInSavedReports();

        hideGlobalLoading();

        // Re-render the landing page UI
        renderStudentsGrid();
        updateProgress();

        // If the editor is open, re-render the current student's form
        if (state.currentStudentIndex >= 0) {
            // Invalidate cache so renderEditorContent picks up fresh data
            const student = state.students[state.currentStudentIndex];
            if (student) {
                // Force re-fetch from DB on next render by deleting state entry
                delete state.reportsData[student.id];
            }
            await renderEditorContent();
        }

        const msg = patched > 0
            ? `Data refreshed. ${patched} saved report${patched > 1 ? 's' : ''} updated with new roll number.`
            : 'Data refreshed. All saved reports are up to date.';
        showToast(msg, 'success');

    } catch (err) {
        hideGlobalLoading();
        showToast('Refresh failed: ' + err.message, 'error');
        console.error('[refreshSystemData]', err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Refresh Data';
        }
    }
}

// ==================== UI RENDERING ====================
function renderEmptyState(title, message) {
    const grid = document.getElementById('students-grid');
    grid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
            <div class="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
                <i class="fas fa-folder-open text-4xl text-slate-400"></i>
            </div>
            <h3 class="text-xl font-bold text-slate-900 dark:text-white mb-2">${title}</h3>
            <p class="text-slate-600 dark:text-slate-400 max-w-md">${message}</p>
        </div>
    `;
}

function injectRefreshButton() {
    // Inject or update the Refresh Data button near the fill-reports button
    // Try several possible parent containers in the landing page
    const existingBtn = document.getElementById('refresh-data-btn');
    if (existingBtn) return; // Already injected

    // Try to find the fill-reports button and insert next to it
    const fillBtn = document.getElementById('fill-reports-btn');
    if (fillBtn && fillBtn.parentNode) {
        const btn = document.createElement('button');
        btn.id = 'refresh-data-btn';
        btn.onclick = refreshSystemData;
        btn.className = fillBtn.className
            .replace(/bg-emerald[^\s]*/g, 'bg-slate-600')
            .replace(/hover:bg-emerald[^\s]*/g, 'hover:bg-slate-700')
            .replace(/text-white/g, 'text-white')
            || 'px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold flex items-center gap-2 transition-all';
        btn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Refresh Data';
        btn.title = 'Re-fetch all data and update stale roll numbers and saved reports';
        return;
    }

    // Fallback: create a floating button in the top-right of landing-page
    const landing = document.getElementById('landing-page');
    if (!landing) return;
    const btn = document.createElement('button');
    btn.id = 'refresh-data-btn';
    btn.onclick = refreshSystemData;
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999;padding:12px 20px;border-radius:14px;background:#475569;color:#fff;font-size:14px;font-weight:600;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    btn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data';
    btn.title = 'Re-fetch all data and update stale roll numbers and saved reports';
    document.body.appendChild(btn);
}

function renderStudentsGrid() {
    const container = document.getElementById('students-grid');
    if (!container) return;

    // Ensure the refresh button exists in the UI
    injectRefreshButton();
    
    if (state.students.length === 0) {
        renderEmptyState('No Students Found', 'No students are enrolled in this class.');
        return;
    }
    
    container.innerHTML = state.students.map((student, index) => {
        const report = state.reportsData[student.id];
        const hasReport = report?.completed;
        const isSubmitted = report?.submitted;
        const savedAtt = report?.data?.attendance || '';
        const savedTotal = report?.data?.total_days || '';
        
        let statusClass = hasReport 
            ? (isSubmitted ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
        
        let statusIcon = hasReport ? (isSubmitted ? 'fa-check-circle' : 'fa-edit') : 'fa-clock';
        let statusText = hasReport ? (isSubmitted ? 'Submitted' : 'Completed') : 'Pending';
        
        return `
            <div onclick="openBulkEditor(${index})" class="student-card glass-panel rounded-2xl p-5 cursor-pointer border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 ${hasReport ? 'ring-1 ring-emerald-500/20' : ''}">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-md">
                            ${student.name.charAt(0).toUpperCase()}
                        </div>
                        <div class="min-w-0">
                            <h4 class="font-bold text-slate-900 dark:text-white truncate">${student.name}</h4>
                            <p class="text-xs text-slate-500 dark:text-slate-400 font-mono">${student.student_id || student.id}</p>
                        </div>
                    </div>
                    <span class="status-badge ${statusClass}">
                        <i class="fas ${statusIcon} text-xs"></i>
                        ${statusText}
                    </span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-600 dark:text-slate-400">
                        <i class="fas fa-calendar-check mr-1 text-emerald-500"></i>
                        ${savedAtt && savedTotal ? `${savedAtt}/${savedTotal} days` : 'Attendance not entered'}
                    </span>
                    ${isSubmitted ? `<span class="text-xs text-slate-400">${new Date(report.submittedAt).toLocaleDateString()}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function updateProgress() {
    const completed = Object.values(state.reportsData).filter(r => r.completed).length;
    const total = state.students.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    document.getElementById('progress-completed').textContent = completed;
    document.getElementById('progress-total').textContent = total;
    document.getElementById('progress-percent').textContent = `${percent}%`;
    document.getElementById('progress-bar').style.width = `${percent}%`;
    
    // Update sidebar progress
    const sidebarProgress = document.getElementById('sidebar-progress');
    if (sidebarProgress) sidebarProgress.textContent = `${completed}/${total}`;
    
    // Update submit button state
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
        if (completed === total && total > 0) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit';
        } else {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fas fa-lock mr-2"></i>${completed}/${total}`;
        }
    }
}

function renderStudentList() {
    const container = document.getElementById('student-list');
    if (!container) return;
    
    container.innerHTML = state.students.map((student, index) => {
        const report = state.reportsData[student.id];
        const isActive = index === state.currentStudentIndex;
        const isCompleted = report?.completed;
        const isSubmitted = report?.submitted;
        
        let indicator = '';
        if (isSubmitted) indicator = '<i class="fas fa-check-circle text-blue-500"></i>';
        else if (isCompleted) indicator = '<i class="fas fa-circle text-emerald-500"></i>';
        else indicator = '<i class="far fa-circle text-slate-300"></i>';
        
        return `
            <div onclick="switchStudent(${index})" class="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'}">
                ${indicator}
                <div class="flex-1 min-w-0">
                    <p class="font-semibold text-sm text-slate-900 dark:text-white truncate ${isActive ? 'text-emerald-700 dark:text-emerald-400' : ''}">${student.name}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${student.student_id || student.id}</p>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== EDITOR FUNCTIONS ====================

// Fetch the latest saved report for a single student from Supabase and update state
// Ensures state.reportsData[studentId] is populated.
// Uses already-loaded state if available (no network call needed).
// Falls back to a fresh Supabase fetch only if the student isn't in state yet.
async function ensureStudentReportLoaded(studentId) {
    // If we already have this student's data in state, use it — no network call
    if (state.reportsData[studentId] !== undefined) {
        console.log('[ensureStudentReportLoaded] Using cached state for:', studentId,
            '| data keys:', Object.keys(state.reportsData[studentId].data || {}).length);
        return;
    }

    // Not in state — fetch from Supabase
    console.log('[ensureStudentReportLoaded] Not in state, fetching from DB for:', studentId);
    try {
        // Build query — try UUID column first, fall back to class string
        let row = null;
        if (state.assignedClassId) {
            // Try class_id column (post-migration reports)
            const { data: uuidRows } = await state.supabaseClient
                .from('reports')
                .select('*')
                .eq('student_id', studentId)
                .eq('class_id', state.assignedClassId)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear)
                .limit(1);
            if (uuidRows && uuidRows.length > 0) row = uuidRows[0];
        }
        if (!row) {
            // Fallback to class string (legacy reports or reports without class_id column)
            const { data: rows, error } = await state.supabaseClient
                .from('reports')
                .select('*')
                .eq('student_id', studentId)
                .eq('class', state.assignedClass)
                .eq('term', state.term)
                .eq('academic_year', state.academicYear)
                .limit(1);
            if (error) { console.error('[ensureStudentReportLoaded] DB error:', error); }
            else if (rows && rows.length > 0) row = rows[0];
        }
        console.log('[ensureStudentReportLoaded] DB result:', row ? 'found' : 'not found');

        if (!row) {
            // No saved report yet — store empty placeholder so we don't re-fetch
            state.reportsData[studentId] = { studentId, data: {}, completed: false, submitted: false };
            return;
        }

        let parsedData = row.data;
        if (typeof parsedData === 'string') {
            try { parsedData = JSON.parse(parsedData); } catch(e) { parsedData = {}; }
        }
        if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) parsedData = {};

        state.reportsData[studentId] = {
            studentId:    row.student_id,
            studentName:  row.student_name || (state.students.find(s => s.id === row.student_id) || {}).name || '',
            completed:    row.completed    || false,
            submitted:    row.submitted    || false,
            submittedAt:  row.submitted_at || null,
            lastModified: row.last_modified || null,
            fileUrl:      row.file_url      || null,
            data:         parsedData
        };

        console.log('[ensureStudentReportLoaded] Loaded from DB, keys:', Object.keys(parsedData).length);
    } catch (err) {
        console.error('[ensureStudentReportLoaded] Exception:', err);
        // Don't throw — fall through with empty data
        if (!state.reportsData[studentId]) {
            state.reportsData[studentId] = { studentId, data: {}, completed: false, submitted: false };
        }
    }
}

// Populates all form inputs from state.reportsData[studentId].
// Called after container.innerHTML is set so DOM nodes exist.
function populateFormFromState(studentId) {
    const report = state.reportsData[studentId];
    const savedData = (report && report.data && typeof report.data === 'object' && !Array.isArray(report.data))
        ? report.data : {};

    const container = document.getElementById('form-container');
    if (!container) return;

    // Build a set of field names that are auto-derived from live state.
    // These were already correctly rendered by renderBasicInfo with live values,
    // so populateFormFromState must NOT overwrite them with stale savedData.
    const LIVE_AUTO_KEYS = new Set(['count', 'present', 'total', 'name', 'term', 'year', 'class']);
    const liveFieldNames = new Set();
    const config = TEMPLATE_CONFIG[state.classLevel];
    if (config) {
        config.sections.forEach(sec => {
            (sec.fields || []).forEach(f => {
                if (f.auto && LIVE_AUTO_KEYS.has(f.auto)) {
                    liveFieldNames.add(f.name);
                }
            });
        });
    }

    // ── Helper: set a value on any form element ───────────────────────────────
    function setVal(el, raw) {
        if (raw === undefined || raw === null || raw === '') return;
        const value = String(raw);
        if (el.tagName === 'SELECT') {
            let matched = false;
            Array.from(el.options).forEach(opt => {
                if (opt.value === value) { opt.selected = true; matched = true; }
                else opt.selected = false;
            });
            if (!matched) el.value = value;
        } else if (el.tagName === 'TEXTAREA') {
            el.value = value; // ONLY .value — never .textContent on a textarea
        } else {
            // Works for all input types including readonly ones
            const isReadonly = el.hasAttribute('readonly');
            if (isReadonly) el.removeAttribute('readonly');
            el.value = value;
            if (isReadonly) el.setAttribute('readonly', '');
        }
    }

    // ── Simple flat fields ────────────────────────────────────────────────────
    container.querySelectorAll('[data-field]:not([data-subject])').forEach(el => {
        const fieldName = el.getAttribute('data-field');
        // Skip live auto fields — renderBasicInfo already set these with current state values
        if (liveFieldNames.has(fieldName)) return;
        setVal(el, savedData[fieldName]);
    });

    // ── Subject nested fields ─────────────────────────────────────────────────
    container.querySelectorAll('[data-subject]').forEach(el => {
        const subjectData = savedData[el.getAttribute('data-subject')];
        if (subjectData && typeof subjectData === 'object') {
            setVal(el, subjectData[el.getAttribute('data-field')]);
        }
    });

    // ── Recalculate total if it wasn't stored ─────────────────────────────────
    // (reuse config already declared above)
    if (config) {
        config.sections.forEach(sec => {
            // Also handle KG unified table rows for total recalculation
            const sectionFields = sec.type === 'kg_unified_table'
                ? (sec.scoredRows || [])
                : (sec.fields || []);
            if (sec.type === 'subjects_scored' || sec.type === 'subjects_scored_full' || sec.type === 'kg_unified_table') {
                sectionFields.forEach(f => {
                    const classEl = container.querySelector(`[data-subject="${f.name}"][data-field="class_score"]`);
                    const examEl  = container.querySelector(`[data-subject="${f.name}"][data-field="exam_score"]`);
                    const totalEl = container.querySelector(`[data-subject="${f.name}"][data-field="total_score"]`);
                    if (classEl && examEl && totalEl && !totalEl.value) {
                        const sum = (parseFloat(classEl.value) || 0) + (parseFloat(examEl.value) || 0);
                        if (sum > 0) totalEl.value = String(sum);
                    }
                    // Restore grade badge from saved total (primary levels only)
                    if (sec.type === 'subjects_scored_full' && totalEl && totalEl.value) {
                        const gradeEl  = container.querySelector(`[data-subject="${f.name}"][data-field="teacher_initials"]`);
                        const remarkEl = container.querySelector(`[data-subject="${f.name}"][data-field="remarks"]`);
                        const gradeInfo = getGradeInfo(totalEl.value);
                        if (gradeInfo) {
                            if (gradeEl && !gradeEl.value) {
                                const isRo = gradeEl.hasAttribute('readonly');
                                if (isRo) gradeEl.removeAttribute('readonly');
                                gradeEl.value = gradeInfo.grade;
                                if (isRo) gradeEl.setAttribute('readonly', '');
                            }
                            // Remark is always auto-filled from grade interpretation (readonly field)
                            if (remarkEl) {
                                const isRo = remarkEl.hasAttribute('readonly');
                                if (isRo) remarkEl.removeAttribute('readonly');
                                remarkEl.value = gradeInfo.remark;
                                if (isRo) remarkEl.setAttribute('readonly', '');
                            }
                        }
                    }
                });
            }
        });
    }
}

async function openBulkEditor(startIndex = 0) {
    // Cancel any stale auto-save timer before entering the editor
    if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }
    
    state.currentStudentIndex = startIndex;
    state.hasUnsavedChanges = false;
    state.lastSavedHash = null;
    
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('report-editor').classList.add('active');
    
    renderStudentList();
    await renderEditorContent(); // calculateAllPositions is called inside renderEditorContent
    
    // Position wrapper is now managed inside renderEditorContent — nothing needed here
}

function closeReportEditor() {
    if (state.hasUnsavedChanges) {
        showConfirmModal(
            'Unsaved Changes',
            'You have unsaved changes. Do you want to save before closing?',
            () => {
                saveCurrentReportData(false);
                closeEditor();
            },
            () => closeEditor()
        );
    } else {
        closeEditor();
    }
}

function closeEditor() {
    // Cancel any pending auto-save timers
    if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }

    if (state.currentStudentIndex >= 0 && state.hasUnsavedChanges) {
        saveCurrentReportData(true).catch(() => {}); // Save on close only if dirty
    }
    
    document.getElementById('report-editor').classList.remove('active');
    document.getElementById('landing-page').classList.remove('hidden');
    
    renderStudentsGrid();
    updateProgress();
    state.currentStudentIndex = -1;
    state.hasUnsavedChanges = false;
    state.lastSavedHash = null;
}

async function switchStudent(newIndex) {
    if (newIndex === state.currentStudentIndex) return;
    
    // Cancel any pending auto-save from the previous student BEFORE saving
    if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }
    
    if (state.hasUnsavedChanges) {
        await saveCurrentReportData(true);
    }
    
    state.currentStudentIndex = newIndex;
    state.hasUnsavedChanges = false;
    state.lastSavedHash = null;
    renderStudentList();
    await renderEditorContent();
}

async function renderEditorContent() {
    const student = state.students[state.currentStudentIndex];
    if (!student) return;

    // Step 1: Cancel any stale auto-save timer immediately
    if (state.autoSaveTimer) { clearTimeout(state.autoSaveTimer); state.autoSaveTimer = null; }

    // Step 2: Ensure this student's report is in state (uses cache; only hits DB if missing)
    await ensureStudentReportLoaded(student.id);

    // Step 2b: Recalculate all positions now that state is fresh for this student
    calculateAllPositions();

    // Step 3: Read the authoritative data from state
    const attendance = { present: 0, total: 0 }; // attendance is now manual — not auto-loaded
    const report     = state.reportsData[student.id];
    const savedData  = (report && report.data && typeof report.data === 'object' && !Array.isArray(report.data))
        ? report.data : {};
    console.log('[renderEditorContent] Student:', student.name,
        '| savedData keys:', Object.keys(savedData).length);

    // Step 4: Update the editor header
    document.getElementById('student-avatar').textContent      = student.name.charAt(0).toUpperCase();
    document.getElementById('editor-student-name').textContent = student.name;
    document.getElementById('editor-student-meta').textContent = `${state.assignedClass} • ${student.student_id || student.id}`;
    const editorAttEl = document.getElementById('editor-attendance');
    if (editorAttEl) editorAttEl.textContent = savedData.attendance ? `${savedData.attendance} days` : 'Manual entry';

    // Step 5: Inject Activate Position button (primary levels only) + update position display
    const isPrimaryLevel = ['lower', 'upper'].includes(state.classLevel);
    if (isPrimaryLevel) {
        // Inject button once — reuse on subsequent renders
        let posToggleWrap = document.getElementById('pos-toggle-wrap');
        if (!posToggleWrap) {
            posToggleWrap = document.createElement('div');
            posToggleWrap.id = 'pos-toggle-wrap';
            posToggleWrap.className = 'flex items-center gap-2 mt-1';
            const metaEl = document.getElementById('editor-student-meta');
            if (metaEl && metaEl.parentNode) {
                metaEl.parentNode.insertBefore(posToggleWrap, metaEl.nextSibling);
            }
        }
        const isActive = state.calculateClassPosition;
        posToggleWrap.innerHTML = `
            <button id="toggle-position-btn"
                onclick="toggleClassPosition()"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                       ${isActive ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'}">
                🏅 ${isActive ? 'Deactivate' : 'Activate'} Class Position
            </button>
            ${state.isTerm3 ? '<span class="text-xs text-emerald-400 font-medium">(Auto — Term 3)</span>' : ''}
        `;
    }

    const posWrapper = document.getElementById('class-position-wrapper');
    const posValue   = document.getElementById('editor-position');
    if (posWrapper && posValue && state.calculateClassPosition && isPrimaryLevel) {
        posWrapper.classList.remove('hidden');
        const position = savedData.class_position || '-';
        posValue.textContent = position;
        const posNum = parseInt(position);
        if      (posNum === 1) posValue.className = 'text-2xl font-bold text-yellow-400';
        else if (posNum === 2) posValue.className = 'text-2xl font-bold text-slate-300';
        else if (posNum === 3) posValue.className = 'text-2xl font-bold text-amber-400';
        else                   posValue.className = 'text-2xl font-bold text-white';
    } else if (posWrapper) {
        posWrapper.classList.add('hidden');
    }

    // Step 6: Build form HTML — render functions get savedData so value= attrs are pre-filled
    const container = document.getElementById('form-container');
    const config    = TEMPLATE_CONFIG[state.classLevel];

    // Show a brief loading skeleton while building the form
    container.innerHTML = '<div class="flex items-center justify-center py-16"><div class="flex flex-col items-center gap-3"><div class="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div><p class="text-sm text-slate-500 dark:text-slate-400">Loading report data...</p></div></div>';

    // Small yield so the spinner actually paints before the synchronous HTML build
    await new Promise(resolve => setTimeout(resolve, 0));

    container.innerHTML = config.sections.map(section => `
        <div class="glass-panel rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700 animate-slide-up">
            <div class="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <h3 class="font-bold text-slate-900 dark:text-white">${section.title}</h3>
                ${section.subtitle ? `<p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${section.subtitle}</p>` : ''}
            </div>
            <div class="p-6">
                ${renderSectionContent(section, savedData, student, attendance)}
            </div>
        </div>
    `).join('');

    // Step 7: Force-populate every field from state — definitive pass after DOM is built
    populateFormFromState(student.id);

    // Step 8: Attach input listeners for live calculations + debounced auto-save
    container.querySelectorAll('input, select, textarea').forEach(el => {
        el.addEventListener('input', () => {
            // Validate score inputs (class score & exam score must be ≤ 50)
            const fieldName = el.getAttribute('data-field');
            if (fieldName === 'class_score' || fieldName === 'exam_score') {
                if (!validateScoreInput(el)) {
                    // Clear total when score is invalid so a bad value never gets saved
                    const subjectName = el.getAttribute('data-subject');
                    if (subjectName) {
                        const totalInput = container.querySelector(`[data-subject="${subjectName}"][data-field="total_score"]`);
                        if (totalInput) totalInput.value = '';
                    }
                    return; // Stop processing — don't save invalid data
                }
            }

            state.hasUnsavedChanges = true;

            // Live days_absent computation: recompute whenever total_days or attendance changes
            if (fieldName === 'total_days' || fieldName === 'attendance') {
                const totalEl   = container.querySelector('[data-field="total_days"]');
                const presentEl = container.querySelector('[data-field="attendance"]');
                const absentEl  = container.querySelector('[data-field="days_absent"]');
                if (absentEl) {
                    const total   = parseInt(totalEl?.value   || 0);
                    const present = parseInt(presentEl?.value || 0);
                    const absent  = Math.max(0, total - present);
                    const isRo = absentEl.hasAttribute('readonly');
                    if (isRo) absentEl.removeAttribute('readonly');
                    absentEl.value = String(absent);
                    if (isRo) absentEl.setAttribute('readonly', '');
                }
            }

            if (el.hasAttribute('data-subject')) {
                const subjectName = el.getAttribute('data-subject');
                const classInput  = container.querySelector(`[data-subject="${subjectName}"][data-field="class_score"]`);
                const examInput   = container.querySelector(`[data-subject="${subjectName}"][data-field="exam_score"]`);
                const totalInput  = container.querySelector(`[data-subject="${subjectName}"][data-field="total_score"]`);
                if (classInput && examInput && totalInput) {
                    const c = parseFloat(classInput.value) || 0;
                    const e = parseFloat(examInput.value)  || 0;
                    totalInput.value = (c + e) > 0 ? String(c + e) : '';
                }

                calculateAllPositions();

                const rpt = state.reportsData[student.id];

                // Update overall class position badge in header
                if (state.calculateClassPosition) {
                    updatePositionDisplay();
                }

                // Update class_position field in the form
                const cpInput = container.querySelector('[data-field="class_position"]');
                if (cpInput && rpt?.data?.class_position) {
                    const isRo = cpInput.hasAttribute('readonly');
                    if (isRo) cpInput.removeAttribute('readonly');
                    cpInput.value = rpt.data.class_position;
                    if (isRo) cpInput.setAttribute('readonly', '');
                }

                // Update subject position cells
                container.querySelectorAll('[data-field="position"]').forEach(posInput => {
                    const sName    = posInput.getAttribute('data-subject');
                    const subjData = rpt?.data?.[sName];
                    const pos = subjData ? (subjData.position || '') : '';
                    const isRo = posInput.hasAttribute('readonly');
                    if (isRo) posInput.removeAttribute('readonly');
                    posInput.value = pos;
                    if (isRo) posInput.setAttribute('readonly', '');
                    posInput.className = posInput.className.replace(/\btext-yellow-600\b/g, '').replace(/\bfont-bold\b/g, '').trim();
                    if (pos === '1st') posInput.className += ' text-yellow-600 font-bold';
                });
            }

            if (state.autoSaveTimer) clearTimeout(state.autoSaveTimer);
            state.autoSaveTimer = setTimeout(() => {
                saveCurrentReportData(true).catch(() => {});
            }, 1500);
        });
    });
}

function renderSectionContent(section, savedData, student, attendance) {
    const autoValues = {
        'name': student.name,
        'class': state.assignedClass,
        'term': state.term,
        'year': state.academicYear,
        'present': attendance.present,
        'total': attendance.total,
        'count': state.students.length
    };
    
    switch (section.type) {
        case 'demographic':
            return renderDemographicFields(section.fields, savedData);
        case 'play_therapy_yes_no':
            return renderYesNoTable(section.fields, savedData);
        case 'rating_abcd':
        case 'rating_abcd_single':
            return renderRatingTable(section.fields, savedData);
        case 'subjects_scored':
            return renderSubjectsTable(section.fields, savedData, false);
        case 'subjects_scored_full':
            return renderSubjectsTable(section.fields, savedData, true);
        case 'senses_yes_no':
            return renderSensesTable(section.fields, savedData);
        case 'physical_dev':
            return renderPhysicalDev(section.fields, savedData);
        case 'basic_info':
            return renderBasicInfo(section.fields, savedData, autoValues);
        case 'summary':
            return renderSummary(section.fields, savedData, student.id);
        case 'remarks':
            return renderRemarks(section.fields, savedData);
        case 'textarea':
            return renderTextarea(section.fields, savedData);
        // KG-specific section types
        case 'kg_student_info':
            return renderKGStudentInfo(section, savedData, student, attendance);
        case 'kg_unified_table':
            return renderKGUnifiedTable(section, savedData);
        case 'kg_footer_info':
            return renderKGFooterInfo(section, savedData, student, attendance);
        default:
            return '';
    }
}

function renderDemographicFields(fields, savedData) {
    return `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${fields.map(field => {
            const value = savedData[field.name] || '';
            const inputType = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
            return `
                <div class="space-y-2">
                    <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300">${field.label}</label>
                    <input type="${inputType}" class="input-field w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800" data-field="${field.name}" value="${escHtml(value)}" placeholder="Enter ${field.label}">
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderYesNoTable(fields, savedData) {
    return `<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table class="w-full">
            <thead class="bg-slate-50 dark:bg-slate-800">
                <tr>
                    <th class="text-left p-4 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Activity</th>
                    <th class="p-4 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-32 text-center">Response</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                ${fields.map(field => {
                    const value = savedData[field.name] || '';
                    if (field.type === 'text_with_remark') {
                        return `
                            <tr>
                                <td class="p-4 text-sm font-medium text-slate-800 dark:text-slate-200">${field.label}</td>
                                <td class="p-4">
                                    <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm" data-field="${field.name}" value="${escHtml(value)}" placeholder="Specify...">
                                </td>
                            </tr>
                        `;
                    }
                    return `
                        <tr>
                            <td class="p-4 text-sm font-medium text-slate-800 dark:text-slate-200">${field.label}</td>
                            <td class="p-4">
                                <select class="input-field w-full px-3 py-2 rounded-lg text-sm font-semibold text-center" data-field="${field.name}">
                                    <option value="">-</option>
                                    <option value="Yes" ${value === 'Yes' ? 'selected' : ''} class="text-emerald-600">Yes</option>
                                    <option value="No" ${value === 'No' ? 'selected' : ''} class="text-red-600">No</option>
                                </select>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    </div>`;
}

function renderRatingTable(fields, savedData) {
    // Auto-comment map: A=EXCELLENT, B=VERY GOOD, C=GOOD, D=FAIL
    const RATING_COMMENTS = { A: 'EXCELLENT', B: 'VERY GOOD', C: 'GOOD', D: 'FAIL' };

    return `<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table class="w-full">
            <thead class="bg-slate-50 dark:bg-slate-800">
                <tr>
                    <th class="text-left p-4 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Activity</th>
                    <th class="p-4 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-24 text-center">Rating</th>
                    <th class="p-4 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-left">Comment <span class="text-blue-400 font-normal normal-case">(Auto)</span></th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                ${fields.map(field => {
                    const rating = savedData[`${field.name}_rating`] || '';
                    // Auto-populate comment from rating; fall back to saved comment only if no rating
                    const comment = rating ? (RATING_COMMENTS[rating] || savedData[`${field.name}_comment`] || '') : (savedData[`${field.name}_comment`] || '');
                    
                    if (field.type === 'text_value') {
                        return `
                            <tr>
                                <td class="p-4 text-sm font-medium text-slate-800 dark:text-slate-200" colspan="2">${field.label}</td>
                                <td class="p-4">
                                    <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm" data-field="${field.name}" value="${escHtml(savedData[field.name] || '')}" placeholder="Value...">
                                </td>
                            </tr>
                        `;
                    }
                    
                    return `
                        <tr>
                            <td class="p-4 text-sm font-medium text-slate-800 dark:text-slate-200">${field.label}</td>
                            <td class="p-4">
                                <select class="input-field w-full px-3 py-2 rounded-lg text-sm font-bold text-center" data-field="${field.name}_rating"
                                    onchange="(function(sel){
                                        const commentMap = {A:'EXCELLENT',B:'VERY GOOD',C:'GOOD',D:'FAIL'};
                                        const commentEl = sel.closest('tr').querySelector('[data-field=\\'${field.name}_comment\\']');
                                        if (commentEl) {
                                            commentEl.value = commentMap[sel.value] || '';
                                            commentEl.dispatchEvent(new Event('input', {bubbles:true}));
                                        }
                                    })(this)">
                                    <option value="">-</option>
                                    <option value="A" ${rating === 'A' ? 'selected' : ''} class="text-emerald-600">A</option>
                                    <option value="B" ${rating === 'B' ? 'selected' : ''} class="text-blue-600">B</option>
                                    <option value="C" ${rating === 'C' ? 'selected' : ''} class="text-amber-600">C</option>
                                    <option value="D" ${rating === 'D' ? 'selected' : ''} class="text-red-600">D</option>
                                </select>
                            </td>
                            <td class="p-4">
                                <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" data-field="${field.name}_comment" value="${escHtml(comment)}" placeholder="Auto-filled from rating..." readonly tabindex="-1">
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    </div>`;
}

function renderSubjectsTable(fields, savedData, isFull) {
    const headers = isFull 
        ? ['Subject', 'Class (50%)', 'Exam (50%)', 'Total', 'Pos', 'Remarks', 'Initials']
        : ['Subject', 'Class (50%)', 'Exam (50%)', 'Total', 'Remarks'];
    
    return `<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 subject-table">
        <table class="w-full">
            <thead>
                <tr class="bg-slate-50 dark:bg-slate-800">
                    ${headers.map(h => `<th class="p-3 text-xs font-bold text-slate-700 dark:text-slate-300 text-center whitespace-nowrap">${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                ${fields.map(field => {
                    const data = savedData[field.name] || {};
                    const classScore = data.class_score || '';
                    const examScore = data.exam_score || '';
                    const total = data.total_score || (classScore && examScore ? parseFloat(classScore) + parseFloat(examScore) : '');
                    const position = data.position || '';
                    const remarks = data.remarks || '';
                    const initials = data.teacher_initials || '';
                    
                    if (isFull) {
                        // Auto-derive remark and grade from total score
                        const gradeInfo = getGradeInfo(total);
                        const autoRemark = gradeInfo ? gradeInfo.remark : (remarks || '');
                        const autoGrade  = gradeInfo ? gradeInfo.grade : (initials || '');
                        // Colour-code the remark based on grade
                        const remarkColor = gradeInfo
                            ? (['A'].includes(gradeInfo.grade) ? 'text-emerald-600'
                              : ['B'].includes(gradeInfo.grade) ? 'text-blue-600'
                              : ['C', 'D'].includes(gradeInfo.grade) ? 'text-amber-600'
                              : 'text-red-600')
                            : '';
                        return `
                            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td class="p-3 text-sm font-semibold text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-700 subject-label">${field.label}</td>
                                <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                    <input type="number" min="0" max="50" class="score-input text-emerald-600 dark:text-emerald-400" data-subject="${field.name}" data-field="class_score" value="${classScore}" onchange="calculateAllPositions(); autoFillRemarkAndGrade(this);">
                                </td>
                                <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                    <input type="number" min="0" max="50" class="score-input text-blue-600 dark:text-blue-400" data-subject="${field.name}" data-field="exam_score" value="${examScore}" onchange="calculateAllPositions(); autoFillRemarkAndGrade(this);">
                                </td>
                                <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                    <input type="text" class="score-input bg-slate-100 dark:bg-slate-700 border-0" data-subject="${field.name}" data-field="total_score" value="${total}" readonly tabindex="-1">
                                </td>
                                <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                    <input type="text" class="score-input bg-slate-100 dark:bg-slate-700 border-0 text-xs ${position === '1st' ? 'text-yellow-600 font-bold' : ''}" data-subject="${field.name}" data-field="position" value="${position}" readonly tabindex="-1">
                                </td>
                                <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                    <input type="text" class="score-input bg-slate-100 dark:bg-slate-700 border-0 text-xs font-semibold uppercase text-center ${remarkColor}" data-subject="${field.name}" data-field="remarks" value="${escHtml(autoRemark)}" readonly tabindex="-1" title="Auto-filled from grade interpretation">
                                </td>
                                <td class="p-2">
                                    <input type="text" class="input-field w-full px-2 py-1.5 rounded text-sm text-center uppercase font-bold grade-badge" data-subject="${field.name}" data-field="teacher_initials" value="${escHtml(autoGrade)}" maxlength="1" placeholder="A" readonly tabindex="-1" title="Auto-filled grade (A–G)">
                                </td>
                            </tr>
                        `;
                    }
                    
                    return `
                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td class="p-3 text-sm font-semibold text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-700">${field.label}</td>
                            <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                <input type="number" min="0" max="50" class="score-input text-emerald-600 dark:text-emerald-400" data-subject="${field.name}" data-field="class_score" value="${classScore}">
                            </td>
                            <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                <input type="number" min="0" max="50" class="score-input text-blue-600 dark:text-blue-400" data-subject="${field.name}" data-field="exam_score" value="${examScore}">
                            </td>
                            <td class="p-2 border-r border-slate-100 dark:border-slate-700">
                                <input type="text" class="score-input bg-slate-100 dark:bg-slate-700 border-0" data-subject="${field.name}" data-field="total_score" value="${total}" readonly tabindex="-1">
                            </td>
                            <td class="p-2">
                                <input type="text" class="input-field w-full px-2 py-1.5 rounded text-sm" data-subject="${field.name}" data-field="remarks" value="${escHtml(remarks)}" placeholder="Remarks">
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    </div>`;
}

function renderSensesTable(fields, savedData) {
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${fields.map(field => {
            const value = savedData[field.name] || '';
            return `
                <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span class="font-semibold text-slate-800 dark:text-slate-200">${field.label}</span>
                    <select class="input-field w-32 px-3 py-2 rounded-lg text-sm font-bold" data-field="${field.name}">
                        <option value="">Select</option>
                        <option value="Yes" ${value === 'Yes' ? 'selected' : ''} class="text-emerald-600">Yes ✓</option>
                        <option value="No" ${value === 'No' ? 'selected' : ''} class="text-red-600">No ✗</option>
                    </select>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderPhysicalDev(fields, savedData) {
    return `<div class="space-y-3">
        ${fields.map(field => {
            const value = savedData[field.name] || '';
            return `
                <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span class="font-semibold text-slate-800 dark:text-slate-200">${field.label}</span>
                    <select class="input-field w-48 px-3 py-2 rounded-lg text-sm" data-field="${field.name}">
                        <option value="">Select Rating</option>
                        <option value="Excellent" ${value === 'Excellent' ? 'selected' : ''} class="text-emerald-600 font-bold">Excellent</option>
                        <option value="Good" ${value === 'Good' ? 'selected' : ''} class="text-blue-600 font-bold">Good</option>
                        <option value="Average" ${value === 'Average' ? 'selected' : ''} class="text-amber-600 font-bold">Average</option>
                        <option value="Needs Improvement" ${value === 'Needs Improvement' ? 'selected' : ''} class="text-red-600 font-bold">Needs Improvement</option>
                    </select>
                </div>
            `;
        }).join('')}
    </div>`;
}

// ==================== KG UNIFIED TABLE RENDER FUNCTIONS ====================
// These render the new KG report UI matching the uploaded K.G 2 REPORT.docx template.

function renderKGStudentInfo(section, savedData, student, attendance) {
    const LIVE_AUTO_KEYS = new Set(['count', 'name', 'term', 'year', 'class']);
    const autoValues = {
        name: student.name, class: state.assignedClass, term: state.term,
        year: state.academicYear, count: state.students.length
    };
    const fields = section.fields;
    function val(f) {
        let v = savedData[f.name] || '';
        if (f.auto) {
            if (LIVE_AUTO_KEYS.has(f.auto)) v = autoValues[f.auto] !== undefined ? String(autoValues[f.auto]) : v;
            else if (!v) v = autoValues[f.auto] || '';
        }
        return v;
    }
    const name     = val(fields.find(f => f.name === 'student_name') || {name:'student_name'});
    const term     = val(fields.find(f => f.name === 'term') || {name:'term'});
    const year     = val(fields.find(f => f.name === 'year') || {name:'year'});
    const cls      = val(fields.find(f => f.name === 'class') || {name:'class'});
    const roll     = val(fields.find(f => f.name === 'no_on_roll') || {name:'no_on_roll'});
    const date     = savedData['date'] || '';
    const nextTerm = savedData['next_term_begins'] || '';

    return `
        <div class="space-y-4">
            <div class="rounded-xl border-2 border-blue-900 dark:border-blue-700 overflow-hidden">
                <div class="bg-blue-900 px-6 py-3">
                    <p class="text-center text-white font-bold text-sm uppercase tracking-widest">
                        Physical and Cognitive Development &ndash; Progress Report &nbsp;&middot;&nbsp; K.G
                    </p>
                </div>
                <div class="bg-white dark:bg-slate-800 p-5 space-y-3">
                    <div class="flex flex-wrap gap-3 items-center border-b border-slate-100 dark:border-slate-700 pb-3">
                        <label class="text-xs font-bold text-slate-500 uppercase">NAME</label>
                        <input type="text" class="input-field flex-1 min-w-48 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-700"
                            data-field="student_name" value="${escHtml(name)}" readonly tabindex="-1">
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">TERM</label>
                            <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-700"
                                data-field="term" value="${escHtml(term)}" readonly tabindex="-1">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">YEAR</label>
                            <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-700"
                                data-field="year" value="${escHtml(year)}" readonly tabindex="-1">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">LEVEL</label>
                            <input type="text" class="input-field w-full px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-700"
                                data-field="class" value="${escHtml(cls)}" readonly tabindex="-1">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">NO. ON ROLL</label>
                            <input type="number" class="input-field w-full px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-700"
                                data-field="no_on_roll" value="${escHtml(roll)}" readonly tabindex="-1">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">DATE</label>
                            <input type="date" class="input-field w-full px-3 py-2 rounded-lg text-sm"
                                data-field="date" value="${escHtml(date)}">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase block">NEXT TERM BEGINS</label>
                            <input type="date" class="input-field w-full px-3 py-2 rounded-lg text-sm"
                                data-field="next_term_begins" value="${escHtml(nextTerm)}">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderKGUnifiedTable(section, savedData) {
    const rows       = section.scoredRows;
    const subjectRows = rows.filter(r => !r.section);
    const sensesRows  = rows.filter(r => r.section === 'senses');
    const physRows    = rows.filter(r => r.section === 'physical');

    function scoreRow(row, idx) {
        const d   = (typeof savedData[row.name] === 'object' && savedData[row.name]) ? savedData[row.name] : {};
        const cs  = d.class_score || '';
        const es  = d.exam_score  || '';
        const ts  = d.total_score || (cs && es ? String((parseFloat(cs)||0)+(parseFloat(es)||0)) : '');
        const rem = d.remarks || '';
        const bg  = idx % 2 === 0 ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900';
        return `
            <tr class="${bg}">
                <td class="px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700">${row.label}</td>
                <td class="px-2 py-1.5 border-r border-slate-200 dark:border-slate-700">
                    <input type="number" min="0" max="50" class="score-input text-emerald-600 dark:text-emerald-400"
                        data-subject="${row.name}" data-field="class_score" value="${escHtml(cs)}">
                </td>
                <td class="px-2 py-1.5 border-r border-slate-200 dark:border-slate-700">
                    <input type="number" min="0" max="50" class="score-input text-blue-600 dark:text-blue-400"
                        data-subject="${row.name}" data-field="exam_score" value="${escHtml(es)}">
                </td>
                <td class="px-2 py-1.5 border-r border-slate-200 dark:border-slate-700">
                    <input type="text" class="score-input bg-slate-100 dark:bg-slate-700 border-0 font-bold"
                        data-subject="${row.name}" data-field="total_score" value="${escHtml(ts)}" readonly tabindex="-1">
                </td>
                <td class="px-2 py-1.5">
                    <input type="text" class="input-field w-full px-2 py-1 rounded text-sm"
                        data-subject="${row.name}" data-field="remarks" value="${escHtml(rem)}" placeholder="Remarks">
                </td>
            </tr>
        `;
    }

    function sectionHeaderRow(label) {
        return `
            <tr class="bg-blue-900">
                <td colspan="5" class="px-3 py-2 text-xs font-bold text-white uppercase tracking-wider">${label}</td>
            </tr>
        `;
    }

    let idx = 0;
    const subjectHtml = subjectRows.map(r => scoreRow(r, idx++)).join('');
    const sensesHtml  = sensesRows.map(r => scoreRow(r, idx++)).join('');
    const physHtml    = physRows.map(r => scoreRow(r, idx++)).join('');

    const grandTotal = subjectRows.reduce((sum, row) => {
        const d  = (typeof savedData[row.name] === 'object' && savedData[row.name]) ? savedData[row.name] : {};
        const ts = d.total_score;
        const cs = parseFloat(d.class_score) || 0;
        const es = parseFloat(d.exam_score)  || 0;
        return sum + (ts ? (parseFloat(ts)||0) : (cs + es));
    }, 0);

    return `
        <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <table class="w-full text-sm">
                <thead>
                    <tr class="bg-blue-900">
                        <th class="px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wider border-r border-blue-700 w-2/5">SUBJECTS</th>
                        <th class="px-2 py-2.5 text-center text-xs font-bold text-white uppercase border-r border-blue-700 w-16">CLASS SCORE<br><span class="font-normal text-blue-200 text-xs">50%</span></th>
                        <th class="px-2 py-2.5 text-center text-xs font-bold text-white uppercase border-r border-blue-700 w-16">EXAM SCORE<br><span class="font-normal text-blue-200 text-xs">50%</span></th>
                        <th class="px-2 py-2.5 text-center text-xs font-bold text-white uppercase border-r border-blue-700 w-16">TOTAL SCORE<br><span class="font-normal text-blue-200 text-xs">100%</span></th>
                        <th class="px-2 py-2.5 text-center text-xs font-bold text-white uppercase w-28">REMARKS</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-700">
                    ${subjectHtml}
                    ${sectionHeaderRow('SENSES \u2014 Can Differentiate Between')}
                    ${sensesHtml}
                    ${sectionHeaderRow('PHYSICAL DEVELOPMENT')}
                    ${physHtml}
                </tbody>
                <tfoot>
                    <tr class="bg-blue-900">
                        <td colspan="3" class="px-3 py-2.5 text-right text-xs font-bold text-white uppercase tracking-wider">TOTAL SCORE</td>
                        <td class="px-2 py-2.5 text-center text-base font-black text-white" id="kg-grand-total">${grandTotal > 0 ? grandTotal : ''}</td>
                        <td class="px-2 py-2.5"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function renderKGFooterInfo(section, savedData, student, attendance) {
    const LIVE_AUTO_KEYS = new Set(['count', 'name', 'term', 'year', 'class']);
    const autoValues = {
        name: student.name, class: state.assignedClass, term: state.term,
        year: state.academicYear, count: state.students.length
    };
    // Compute days_absent from manually entered saved values (attendance is now manual)
    const absentDays = Math.max(0, (parseInt(savedData['total_days'] || 0)) - (parseInt(savedData['attendance'] || 0)));

    function val(f) {
        if (f.name === 'days_absent') return String(absentDays);
        let v = savedData[f.name] || '';
        if (f.auto) {
            if (LIVE_AUTO_KEYS.has(f.auto)) v = autoValues[f.auto] !== undefined ? String(autoValues[f.auto]) : v;
            else if (!v) v = autoValues[f.auto] || '';
        }
        return v;
    }
    const gridFields     = section.fields.filter(f => f.type !== 'textarea');
    const textareaFields = section.fields.filter(f => f.type === 'textarea');
    return `
        <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                ${gridFields.map(f => {
                    const v = val(f);
                    const isRO = !!f.auto || f.readonly || f.name === 'days_absent';
                    const bg = isRO ? 'bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'bg-white dark:bg-slate-800';
                    return `
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block">
                                ${f.label}${isRO ? ' <span class="text-blue-400 font-normal">(Auto)</span>' : ''}
                            </label>
                            <input type="${f.type === 'number' ? 'number' : 'text'}"
                                class="input-field w-full px-3 py-2 rounded-lg text-sm ${bg}"
                                data-field="${f.name}" value="${escHtml(v)}"
                                ${isRO ? 'readonly tabindex="-1"' : ''}>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="space-y-3">
                ${textareaFields.map(f => {
                    const v = savedData[f.name] || '';
                    return `
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block">${f.label}</label>
                            <textarea class="input-field w-full px-3 py-2 rounded-lg text-sm resize-none"
                                rows="${f.rows || 3}" data-field="${f.name}"
                                placeholder="Enter ${f.label.toLowerCase()}...">${escHtml(v)}</textarea>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}


function renderBasicInfo(fields, savedData, autoValues) {
    // These auto keys come from live system state and must always override saved values
    const LIVE_AUTO_KEYS = new Set(['count', 'name', 'term', 'year', 'class']);

    // Compute days_absent from manually entered saved values (attendance is now manual)
    const totalDays   = parseInt(savedData['total_days'] || autoValues['total']   || 0);
    const presentDays = parseInt(savedData['attendance'] || autoValues['present'] || 0);
    const absentDays  = Math.max(0, totalDays - presentDays);

    return `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${fields.map(field => {
            let value = savedData[field.name] || '';

            // Auto-fill values:
            // - LIVE keys always use current state (override stale saved value)
            // - Other auto keys fill only if nothing is saved yet
            if (field.auto) {
                if (LIVE_AUTO_KEYS.has(field.auto)) {
                    // Always use the live value — never the stale saved one
                    value = autoValues[field.auto] !== undefined ? String(autoValues[field.auto]) : value;
                } else if (!value) {
                    value = autoValues[field.auto] || '';
                }
            }

            // days_absent is always computed live from attendance data
            if (field.name === 'days_absent') {
                value = String(absentDays);
            }
            
            const isReadOnly = field.readonly || field.calculated || field.name === 'days_absent';
            const bgClass = isReadOnly ? 'bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'bg-white dark:bg-slate-800';
            const textClass = field.calculated ? 'text-emerald-600 dark:text-emerald-400 font-bold' : '';
            
            if (field.type === 'date') {
                return `
                    <div class="space-y-2">
                        <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300">${field.label}</label>
                        <input type="date" class="input-field w-full px-4 py-2.5 rounded-xl ${bgClass} ${textClass}" data-field="${field.name}" value="${escHtml(value)}" ${isReadOnly ? 'readonly tabindex="-1"' : ''}>
                    </div>
                `;
            }
            
            return `
                <div class="space-y-2">
                    <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                        ${field.label}
                        ${field.calculated ? '<span class="text-xs text-emerald-500 font-normal ml-1">(Auto)</span>' : ''}
                        ${field.auto && !field.calculated ? '<span class="text-xs text-blue-500 font-normal ml-1">(Auto)</span>' : ''}
                        ${field.name === 'days_absent' ? '<span class="text-xs text-blue-500 font-normal ml-1">(Auto)</span>' : ''}
                    </label>
                    <input type="${field.type === 'number' ? 'number' : 'text'}" class="input-field w-full px-4 py-2.5 rounded-xl ${bgClass} ${textClass}" data-field="${field.name}" value="${escHtml(value)}" ${isReadOnly ? 'readonly tabindex="-1"' : ''}>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderSummary(fields, savedData, studentId) {
    const total = calculateStudentTotal(studentId);
    const displayTotal = savedData.total_score || total || '';
    
    return `<div class="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-xl p-6 border-2 border-emerald-200 dark:border-emerald-800">
        <div class="flex items-center justify-between">
            <div>
                <p class="text-sm font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider mb-1">Grand Total</p>
                <p class="text-3xl font-black text-emerald-700 dark:text-emerald-400">${displayTotal}</p>
            </div>
            <div class="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                <i class="fas fa-trophy text-2xl text-emerald-600"></i>
            </div>
        </div>
    </div>`;
}

function renderRemarks(fields, savedData) {
    return `<div class="space-y-4">
        ${fields.map(field => {
            const value = savedData[field.name] || '';
            // Use dropdown for all headteacher/head teacher remark fields across every level
            const isHeadTeacher = field.name.toLowerCase().includes('head') && field.name.toLowerCase().includes('remark');
            const isHeadComment = field.name.toLowerCase().includes('head') && field.name.toLowerCase().includes('comment');
            if (isHeadTeacher || isHeadComment) {
                return `
                    <div class="space-y-2">
                        <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">${field.label}</label>
                        <select class="input-field w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-800" data-field="${field.name}">
                            <option value="">— Select a remark —</option>
                            ${HEAD_TEACHER_REMARKS.map(r => `<option value="${escHtml(r)}" ${value === r ? 'selected' : ''}>${escHtml(r)}</option>`).join('')}
                        </select>
                    </div>
                `;
            }
            return `
                <div class="space-y-2">
                    <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">${field.label}</label>
                    <textarea class="input-field w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-800 resize-none" rows="${field.rows || 3}" data-field="${field.name}" placeholder="Enter ${field.label.toLowerCase()}...">${escHtml(value)}</textarea>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderTextarea(fields, savedData) {
    return renderRemarks(fields, savedData);
}

// ==================== SAVE OPERATIONS ====================
function saveCurrentReportData(isAutoSave = false) {
    if (state.currentStudentIndex < 0) return Promise.resolve();
    
    const student = state.students[state.currentStudentIndex];
    if (!student) return Promise.resolve();

    // Block save if any score input exceeds 50
    if (!allScoresValid()) {
        if (!isAutoSave) showToast('Cannot save — one or more scores exceed the maximum of 50.', 'error');
        return Promise.resolve();
    }
    
    try {
        const config = TEMPLATE_CONFIG[state.classLevel];
        const data = {};
        
        // Collect simple fields
        document.querySelectorAll('[data-field]:not([data-subject])').forEach(input => {
            const fieldName = input.getAttribute('data-field');
            if (input.value !== undefined) data[fieldName] = input.value;
        });
        
        // Collect subject fields
        const subjectNames = [];
        config.sections.forEach(sec => {
            if (sec.type === 'subjects_scored' || sec.type === 'subjects_scored_full') {
                sec.fields.forEach(f => subjectNames.push(f.name));
            }
            // KG unified table -- collect all scored rows as nested subject objects
            if (sec.type === 'kg_unified_table') {
                (sec.scoredRows || []).forEach(f => subjectNames.push(f.name));
            }
        });
        
        subjectNames.forEach(subjectName => {
            const inputs = document.querySelectorAll(`[data-subject="${subjectName}"]`);
            if (inputs.length > 0) {
                data[subjectName] = {};
                inputs.forEach(input => {
                    const field = input.getAttribute('data-field');
                    data[subjectName][field] = input.value;
                });
            }
        });
        
        // Calculate total for primary levels
        if (['lower', 'upper'].includes(state.classLevel)) {
            data.total_score = calculateStudentTotal(student.id);
        }

        // Compute days_absent from manually entered total_days and attendance fields
        {
            const totalDays   = parseInt(data.total_days   || 0);
            const presentDays = parseInt(data.attendance   || 0);
            data.days_absent = String(Math.max(0, totalDays - presentDays));
        }
        
        // Check if data actually changed (for auto-save)
        const dataHash = JSON.stringify(data);
        if (isAutoSave && state.lastSavedHash === dataHash) {
            return Promise.resolve();
        }

        // Extra guard: don't auto-save a completely empty form
        // (this prevents saving blank data when switching students)
        if (isAutoSave) {
            const hasAnyValue = Object.values(data).some(v => {
                if (typeof v === 'object' && v !== null) {
                    return Object.values(v).some(sv => sv !== '' && sv !== null && sv !== undefined);
                }
                return v !== '' && v !== null && v !== undefined;
            });
            if (!hasAnyValue) {
                console.log('[saveCurrentReportData] Skipping auto-save — all fields empty');
                return Promise.resolve();
            }
        }
        
        // Update state
        state.reportsData[student.id] = {
            studentId: student.id,
            studentName: student.name,
            completed: true,
            lastModified: new Date().toISOString(),
            data: data
        };
        
        state.hasUnsavedChanges = false;
        state.lastSavedHash = dataHash;
        
        // Save to Supabase
        return saveToSupabase(student.id, isAutoSave);
        
    } catch (err) {
        handleError(err, 'Save Report Data');
        return Promise.reject(err);
    }
}

async function saveToSupabase(studentId, isAutoSave) {
    try {
        const report = state.reportsData[studentId];
        const student = state.students.find(s => s.id === studentId);
        
        if (!report || !student) throw new AppError('Report data not found', 'error');
        
        const saveData = {
            student_id: studentId,
            student_name: student.name,
            teacher_id: state.teacherId,
            class: state.assignedClass,
            class_id: state.assignedClassId || null,
            term: state.term,
            academic_year: state.academicYear,
            data: report.data,
            completed: true,
            submitted: report.submitted || false,
            submitted_at: report.submittedAt,
            last_modified: new Date().toISOString()
        };
        
        // Use the cached DB row id from state (populated by loadSavedReports) so we
        // never need to query for an existing record on each save. This avoids the
        // "multiple or no rows returned" error when duplicates are already in the table.
        let existingId = report.id || null;

        // If no cached id, fall back to a single DB look-up (first save in this session).
        if (!existingId) {
            let lookupData = null;
            if (state.assignedClassId) {
                const { data: existUuid } = await state.supabaseClient
                    .from('reports')
                    .select('id')
                    .eq('student_id', studentId)
                    .eq('class_id', state.assignedClassId)
                    .eq('term', state.term)
                    .eq('academic_year', state.academicYear)
                    .limit(1)
                    .maybeSingle();
                if (existUuid) lookupData = existUuid;
            }
            if (!lookupData) {
                const { data: existStr, error: checkError } = await state.supabaseClient
                    .from('reports')
                    .select('id')
                    .eq('student_id', studentId)
                    .eq('class', state.assignedClass)
                    .eq('term', state.term)
                    .eq('academic_year', state.academicYear)
                    .limit(1)
                    .maybeSingle();
                if (checkError) throw checkError;
                lookupData = existStr;
            }
            if (lookupData) existingId = lookupData.id;
        }

        let error = null;

        if (existingId) {
            // Update existing record — match by id for precision
            const { error: updateError } = await state.supabaseClient
                .from('reports')
                .update(saveData)
                .eq('id', existingId);
            error = updateError;
            // Keep the cached id in state so future saves skip the DB look-up entirely
            if (!error) state.reportsData[studentId].id = existingId;
        } else {
            // Insert new record and cache the returned id for all future saves
            const { data: insertedRows, error: insertError } = await state.supabaseClient
                .from('reports')
                .insert([saveData])
                .select('id');
            error = insertError;
            if (!error && insertedRows && insertedRows[0]) {
                state.reportsData[studentId].id = insertedRows[0].id;
            }
        }
        
        if (error) {
            // Handle specific constraint errors
            if (error.code === '23505') {
                throw new AppError('A report for this student already exists for this term.', 'warning', true);
            } else if (error.code === '23503') {
                throw new AppError('Invalid reference. Please ensure all data is valid.', 'error');
            } else {
                throw new AppError(`Database error: ${error.message}`, 'error', true);
            }
        }
        
        if (!isAutoSave) {
            showToast('Report saved successfully!', 'success');
        }

        console.log('[saveToSupabase] Saved student:', studentId,
            '| keys:', Object.keys(state.reportsData[studentId]?.data || {}).length);
        
        // Update UI indicators
        updateProgress();
        renderStudentList();
        
    } catch (err) {
        if (!isAutoSave) {
            handleError(err, 'Save to Supabase');
        }
        throw err;
    }
}

async function saveCurrentReport() {
    try {
        showGlobalLoading('Saving...', 'Please wait while we save the report');
        await saveCurrentReportData(false);
        hideGlobalLoading();
    } catch (err) {
        hideGlobalLoading();
        // Error already handled in saveCurrentReportData
    }
}

// ==================== SCHOOL INFO ====================
async function loadSchoolInfo() {
    try {
        // Try school_settings first, fall back to settings table
        let row = null;
        const { data: d1, error: e1 } = await state.supabaseClient
            .from('school_settings')
            .select('school_name, logo_url, logo_base64')
            .limit(1)
            .maybeSingle();

        if (!e1 && d1) {
            row = d1;
        } else {
            const { data: d2 } = await state.supabaseClient
                .from('settings')
                .select('school_name, logo_url, logo_base64')
                .limit(1)
                .maybeSingle();
            if (d2) row = d2;
        }

        if (!row) {
            console.warn('[loadSchoolInfo] No school_settings row found.');
            return;
        }

        state.schoolName = row.school_name || '';

        // ── Logo: prefer stored base64 string ──────────────────────────────
        if (row.logo_base64) {
            // May already have data: prefix or be raw base64
            const b = row.logo_base64.trim();
            state.schoolLogoBase64 = b.startsWith('data:') ? b : `data:image/png;base64,${b}`;
            console.log('[loadSchoolInfo] Logo loaded from base64 column');

        } else if (row.logo_url) {
            // Fetch the image and convert to base64 safely (no spread operator)
            try {
                const url = row.logo_url.trim();
                console.log('[loadSchoolInfo] Fetching logo from URL:', url);

                const resp = await fetch(url);
                if (!resp.ok) {
                    console.warn('[loadSchoolInfo] Logo fetch failed HTTP', resp.status, resp.statusText);
                } else {
                    const buf  = await resp.arrayBuffer();
                    const arr  = new Uint8Array(buf);
                    // Safe base64 conversion — no spread (avoids stack overflow on large images)
                    let b64 = '';
                    const CHUNK = 8192;
                    for (let i = 0; i < arr.length; i += CHUNK) {
                        b64 += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK));
                    }
                    b64 = btoa(b64);
                    // Detect MIME from Content-Type header or URL extension
                    const ct   = resp.headers.get('content-type') || '';
                    const ext  = url.split('.').pop().split('?')[0].toLowerCase();
                    const mime = ct.includes('image/') ? ct.split(';')[0].trim()
                               : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                               : ext === 'gif' ? 'image/gif'
                               : ext === 'webp' ? 'image/webp'
                               : ext === 'svg' ? 'image/svg+xml'
                               : 'image/png';
                    state.schoolLogoBase64 = `data:${mime};base64,${b64}`;
                    console.log('[loadSchoolInfo] Logo fetched and converted, size:', arr.length, 'bytes, mime:', mime);
                }
            } catch(e) {
                console.warn('[loadSchoolInfo] Logo fetch exception:', e.message || e);
            }
        }

        console.log('[loadSchoolInfo] School name:', state.schoolName, '| Has logo:', !!state.schoolLogoBase64);
    } catch(e) {
        console.warn('[loadSchoolInfo] Non-critical error:', e.message || e);
    }
}

// ==================== TEMPLATE-BASED DOCX BUILDER ====================
// Loads a .docx template from Supabase Storage and populates data into it.
// School name and logo are already embedded in the template — no need to fetch them.
// Approach:
//   • Header section: replace placeholder text via XML string replacement
//   • Subject/activity tables: find table rows by subject label, insert scores
//   • Footer section (interest, conduct, promoted to, remarks): replace placeholder text
//   • Bills: append a new XML table section after the last paragraph

// ── XML escape ───────────────────────────────────────────────────────────────
function xmlEsc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Cached template buffers (avoids re-fetching on each report) ──────────────
const _templateCache = {};

async function loadTemplateBuffer(classLevel) {
    if (_templateCache[classLevel]) return _templateCache[classLevel];

    const fileName = TEMPLATE_FILES[classLevel];
    if (!fileName) throw new Error(`No template defined for level: ${classLevel}`);

    // Get public URL from Supabase Storage
    const { data: urlData } = state.supabaseClient.storage
        .from(TEMPLATE_BUCKET)
        .getPublicUrl(fileName);

    const url = urlData?.publicUrl;
    if (!url) throw new Error(`Could not get public URL for template: ${fileName}`);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch template "${fileName}": HTTP ${resp.status}`);

    const buffer = await resp.arrayBuffer();
    _templateCache[classLevel] = buffer;
    console.log(`[loadTemplateBuffer] Loaded template for "${classLevel}": ${fileName} (${buffer.byteLength} bytes)`);
    return buffer;
}

// ── Replace a plain-text placeholder in the XML, preserving surrounding XML ──
// Handles cases where the text may be split across multiple <w:t> runs.
// This does a simple string-level replacement on the document.xml content.
function replacePlaceholderInXml(xml, placeholder, value) {
    // Direct replacement (placeholder in a single run)
    const escaped = xmlEsc(placeholder);
    const valEsc  = xmlEsc(value);
    xml = xml.split(escaped).join(valEsc);
    return xml;
}

// ── Find a table cell that matches a label and insert value into the NEXT cell ─
// Used for footer fields like INTEREST, CONDUCT, PROMOTED TO, etc.
// Strategy: find the label text in XML, then insert value after the underscores
// in the adjacent run or paragraph.
function fillFooterField(xml, labelPattern, value) {
    if (!value) return xml;
    const valEsc = xmlEsc(String(value));

    // Pattern: label followed by underscores (placeholder blanks)
    // We replace the underscores that follow the label with the actual value
    // This regex finds the label text and then the next sequence of underscores
    const underscorePattern = new RegExp(
        '(' + labelPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^<]{0,50}?)(_+)',
        'g'
    );
    return xml.replace(underscorePattern, (match, prefix, underscores) => {
        // Pad value to roughly same length to preserve layout
        return prefix + valEsc;
    });
}

// ── Insert value into the next empty table cell after a matching label cell ──
function fillTableCellAfterLabel(xml, labelText, value) {
    if (!value) return xml;
    const valEsc = xmlEsc(String(value));

    // Find the <w:t> containing the label, then find the very next empty <w:t></w:t> or <w:t/>
    const labelIdx = xml.indexOf(`>${labelText}<`);
    if (labelIdx === -1) return xml;

    // After the label, find the next empty cell paragraph: <w:t></w:t> or <w:t/>
    const afterLabel = xml.substring(labelIdx);
    const emptyT = afterLabel.search(/<w:t><\/w:t>|<w:t\/>/);
    if (emptyT === -1) return xml;

    const insertPos = labelIdx + emptyT;
    // Replace the empty <w:t></w:t> with value
    return xml.substring(0, insertPos)
        + xml.substring(insertPos).replace(/<w:t><\/w:t>|<w:t\/>/, `<w:t>${valEsc}</w:t>`);
}

// ── Fill subject/activity table rows ─────────────────────────────────────────
// For primary tables: Subject | Class Score | Exam Score | Total | Position | Remarks
// For KG/Nursery tables: Subject | A | B | C | D | Comment  (or similar)
// Strategy: find the row containing the subject label text, then fill subsequent empty cells.
function fillSubjectRow(xml, subjectLabel, cellValues) {
    // cellValues: array of strings to put into cells AFTER the label cell
    if (!cellValues || cellValues.length === 0) return xml;

    // XML-encode the label for matching (e.g. "RELIGIOUS & MORAL" → "RELIGIOUS &amp; MORAL")
    const labelEsc = xmlEsc(subjectLabel);

    const rowStart = xml.indexOf(`>${labelEsc}</w:t>`);
    if (rowStart === -1) {
        // Try with unencoded (label already has &amp; etc.)
        const rowStartAlt = xml.indexOf(`>${subjectLabel}</w:t>`);
        if (rowStartAlt === -1) {
            console.warn(`[fillSubjectRow] Label not found in template: "${subjectLabel}"`);
            return xml;
        }
        return fillSubjectRowAt(xml, rowStartAlt, cellValues);
    }
    return fillSubjectRowAt(xml, rowStart, cellValues);
}

function fillSubjectRowAt(xml, labelPos, cellValues) {
    // Find the enclosing <w:tr> ... </w:tr>
    const trStart = xml.lastIndexOf('<w:tr', labelPos);
    if (trStart === -1) return xml;
    const trEnd = xml.indexOf('</w:tr>', labelPos);
    if (trEnd === -1) return xml;

    let rowXml = xml.substring(trStart, trEnd + 7);

    // Split into individual <w:tc> cells using a string-based split approach
    // Template data cells are EMPTY (no <w:r> run) - we inject a new run into each.
    // We skip cell 0 (the label) and inject values into cells 1, 2, 3...
    const cellSplit = rowXml.split('<w:tc>');
    // cellSplit[0] = content before first <w:tc> (the <w:tr> opening)
    // cellSplit[1] = first cell (label cell), cellSplit[2..] = data cells

    let valuesToFill = [...cellValues];
    const rebuiltCells = [cellSplit[0]]; // keep the pre-cell content

    for (let i = 1; i < cellSplit.length; i++) {
        let cellContent = cellSplit[i]; // everything after <w:tc> up to next <w:tc>

        if (i === 1) {
            // Label cell — keep unchanged
            rebuiltCells.push('<w:tc>' + cellContent);
        } else {
            // Data cell — try to fill it
            const val = valuesToFill.shift();
            if (val !== undefined && val !== null && val !== '') {
                const valEsc = xmlEsc(String(val));

                if (/<w:r[\s>]/.test(cellContent)) {
                    // Cell already has a run — replace the <w:t> content
                    cellContent = cellContent.replace(
                        /(<w:t[^>]*>)[^<]*(<\/w:t>)/,
                        '$1' + valEsc + '$2'
                    );
                    // Also ensure center alignment in the pPr
                    if (!cellContent.includes('<w:jc')) {
                        cellContent = cellContent.replace(
                            /<\/w:pPr>/,
                            '<w:jc w:val="center"/></w:pPr>'
                        );
                    }
                } else {
                    // Empty cell — extract font info from <w:pPr><w:rPr> and inject a run
                    const rPrMatch = cellContent.match(/<w:pPr>.*?<w:rPr>(.*?)<\/w:rPr>.*?<\/w:pPr>/s);
                    const rPrContent = rPrMatch ? rPrMatch[1] : '';
                    const rPr = rPrContent ? '<w:rPr>' + rPrContent + '</w:rPr>' : '';
                    const injectedRun = '<w:r>' + rPr + '<w:t xml:space="preserve">' + valEsc + '</w:t></w:r>';
                    // Add center alignment to pPr and insert run before </w:p>
                    if (!cellContent.includes('<w:jc')) {
                        cellContent = cellContent.replace(
                            /<\/w:pPr>/,
                            '<w:jc w:val="center"/></w:pPr>'
                        );
                    }
                    cellContent = cellContent.replace('<\/w:p>', injectedRun + '</w:p>');
                }
            }
            rebuiltCells.push('<w:tc>' + cellContent);
        }
    }

    const filledRow = rebuiltCells.join('');
    return xml.substring(0, trStart) + filledRow + xml.substring(trEnd + 7);
}

// ── BILLS XML BUILDER (inline, appended after last section) ──────────────────
// Builds the "Bills for Next Term" table to append into the filled template.
async function buildReportUpcomingBills(studentId, ayId, termId) {
    try {
        const sc = state.supabaseClient;
        if (!sc) return '';

        const { data: aData, error: aErr } = await sc
            .from('bill_assignments')
            .select('bill_id')
            .eq('student_id', studentId);
        if (aErr || !aData || aData.length === 0) return '';

        const billIds = aData.map(a => a.bill_id);

        const { data: bData, error: bErr } = await sc
            .from('bills')
            .select('*')
            .eq('status', 'active')
            .in('id', billIds);
        if (bErr || !bData || bData.length === 0) return '';

        const myBills = bData.filter(b => {
            if (ayId   && b.academic_year_id && b.academic_year_id !== ayId)   return false;
            if (termId && b.term_id          && b.term_id          !== termId) return false;
            return true;
        });
        if (myBills.length === 0) return '';

        const fmtCur  = (v) => `GH\u20B5 ${parseFloat(v || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }) : 'TBA';
        const esc     = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const bodyW = 9360;
        const cW    = [3600, 1800, 1980, 1980];

        const tcPr = (w) =>
            `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
            `<w:tcBorders><w:top w:val="single" w:sz="4" w:color="e2e8f0"/>` +
            `<w:left w:val="none"/><w:right w:val="none"/>` +
            `<w:bottom w:val="single" w:sz="4" w:color="e2e8f0"/></w:tcBorders>` +
            `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>` +
            `<w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`;

        const cell = (text, w, { bold = false, color = '0f172a', align = 'left', size = 18 } = {}) =>
            `<w:tc>${tcPr(w)}<w:p><w:pPr><w:jc w:val="${align}"/></w:pPr>` +
            `<w:r><w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${color}"/>` +
            `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
            `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;

        const headerRow =
            `<w:tr><w:trPr><w:trHeight w:val="400"/>` +
            `<w:shd w:val="clear" w:color="auto" w:fill="1a56db"/></w:trPr>` +
            cell('Description',  cW[0], { bold: true, color: 'FFFFFF', size: 18 }) +
            cell('Category',     cW[1], { bold: true, color: 'FFFFFF', size: 18 }) +
            cell('Amount (GH\u20B5)', cW[2], { bold: true, color: 'FFFFFF', align: 'right', size: 18 }) +
            cell('Due Date',     cW[3], { bold: true, color: 'FFFFFF', align: 'center', size: 18 }) +
            `</w:tr>`;

        const dataRows = myBills.map((b, i) => {
            const shade = i % 2 === 0 ? 'f8fafc' : 'ffffff';
            return `<w:tr><w:trPr><w:shd w:val="clear" w:color="auto" w:fill="${shade}"/></w:trPr>` +
                cell(b.bill_name || b.name || 'Unnamed Bill', cW[0], { size: 18 }) +
                cell(b.bill_category || b.category || '\u2014',   cW[1], { color: '64748b', size: 18 }) +
                cell(fmtCur(b.amount),                        cW[2], { align: 'right', size: 18 }) +
                cell(fmtDate(b.due_date),                     cW[3], { align: 'center', color: '64748b', size: 18 }) +
                `</w:tr>`;
        }).join('');

        const grandTotal = myBills.reduce((s, b) => s + parseFloat(b.amount || 0), 0);
        const totalRow =
            `<w:tr><w:trPr><w:shd w:val="clear" w:color="auto" w:fill="eff6ff"/></w:trPr>` +
            cell('Total Obligations', cW[0], { bold: true, color: '1a56db', size: 18 }) +
            cell('',                  cW[1]) +
            cell(fmtCur(grandTotal),  cW[2], { bold: true, color: '1a56db', align: 'right', size: 18 }) +
            cell('',                  cW[3]) +
            `</w:tr>`;

        let xml = `<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr></w:p>`;
        xml +=
            `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="120" w:after="80"/>` +
            `<w:pBdr><w:top w:val="single" w:sz="12" w:space="1" w:color="1a56db"/>` +
            `<w:bottom w:val="single" w:sz="4" w:space="1" w:color="e2e8f0"/></w:pBdr></w:pPr>` +
            `<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="1a56db"/>` +
            `<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
            `<w:t>BILLS FOR NEXT TERM</w:t></w:r></w:p>`;
        xml +=
            `<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr>` +
            `<w:r><w:rPr><w:i/><w:iCs/><w:color w:val="64748b"/>` +
            `<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
            `<w:t>The following payments will be due at the commencement of next term. ` +
            `Payment history and outstanding balances are managed through the school\u2019s fee portal.</w:t></w:r></w:p>`;
        xml +=
            `<w:tbl><w:tblPr><w:tblW w:w="${bodyW}" w:type="dxa"/>` +
            `<w:tblBorders>` +
            `<w:top    w:val="single" w:sz="6" w:color="1a56db"/>` +
            `<w:bottom w:val="single" w:sz="6" w:color="1a56db"/>` +
            `<w:insideH w:val="single" w:sz="4" w:color="e2e8f0"/>` +
            `<w:insideV w:val="none"/></w:tblBorders></w:tblPr>` +
            `<w:tblGrid>${cW.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
            headerRow + dataRows + totalRow +
            `</w:tbl>`;

        return xml;
    } catch (err) {
        console.warn('[buildReportUpcomingBills] Non-critical error:', err);
        return '';
    }
}

// ── MAIN BUILD FUNCTION (template-based) ──────────────────────────────────────
// Loads the appropriate .docx template from Supabase Storage, then:
//   1. Replaces header placeholder text with student data
//   2. Fills table rows by matching subject/activity label text
//   3. Replaces footer field placeholders (interest, conduct, remarks, etc.)
//   4. Appends the bills table before </w:body>
async function buildReportDocx(student, reportData) {
    const config     = TEMPLATE_CONFIG[state.classLevel];
    // Attendance is now manually entered — read from saved report data
    const liveValues = {
        name:    student.name,
        class:   state.assignedClass,
        term:    state.term,
        year:    state.academicYear,
        present: String(reportData.attendance || '0'),
        total:   String(reportData.total_days  || '0'),
        count:   String(state.students.length)
    };

    // ── Load template from Supabase Storage ────────────────────────────────
    const templateBuffer = await loadTemplateBuffer(state.classLevel);
    const zip = await JSZip.loadAsync(templateBuffer);

    // ── Get document.xml ───────────────────────────────────────────────────
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Template is missing word/document.xml');
    let docXml = await docFile.async('string');

    const dateVal    = reportData.date || '';
    const nextTermVal = reportData.next_term_begins || '';

    // ── STEP 1: Fill header/info placeholders ──────────────────────────────
    // The template header fields appear as underscores after their label text.
    // Some fields span multiple XML runs (e.g. student name continues into a second run).
    // We target the combined single-line text "Term: ___ Year: ___ Level: ___ NO. On Roll: ___"
    // and replace the underscores after each label individually.

    // Student Name: appears as two adjacent runs — we replace the underscores in both
    docXml = docXml.split('________________').join(
        // First occurrence = student name field (the remaining joins handle other fields)
        // Actually do them individually:
        '________________'
    );
    // Replace student name underscores (first block of underscores after "Student Name:") — BOLD
    docXml = replaceFirstUnderscoreBlockBold(docXml, 'Student Name:', xmlEsc(liveValues.name));

    // Term / Year / Level / NO. On Roll — all on one combined text run
    // We replace each underscore block after each label in that run
    const infoLine = 'Term: _____________ Year: __________________ Level: ______________________  NO. On Roll: ______________';
    if (docXml.includes(infoLine)) {
        let filled = infoLine;
        filled = filled.replace('_____________', xmlEsc(liveValues.term));
        filled = filled.replace('__________________', xmlEsc(liveValues.year));
        filled = filled.replace('______________________', xmlEsc(liveValues.class));
        filled = filled.replace('______________', xmlEsc(liveValues.count));
        // Replace all occurrences (template has it twice — main body + header copy)
        docXml = docXml.split(infoLine).join(filled);
    }

    // Date: the label "Date" is in one run, ":  ____..." is in the next
    const dateFmt = dateVal ? formatDateForReport(dateVal) : '';
    docXml = docXml.replace(':  ____________________________     ', `:  ${xmlEsc(dateFmt).padEnd(28)}     `);

    // Next Term Begins: similarly split — replace the underscores in the second run
    const nextTermFmt = nextTermVal ? formatDateForReport(nextTermVal) : '';
    docXml = docXml.replace(':  _____________________________', `:  ${xmlEsc(nextTermFmt)}`);

    // ── STEP 2: Fill table rows with scores/ratings ──────────────────────
    if (['lower', 'upper'].includes(state.classLevel)) {
        docXml = fillPrimarySubjectTable(docXml, config, reportData);
        // Fill TOTAL SCORE row
        const totalScore = reportData.total_score || String(calculateStudentTotalFromData(reportData, config));
        docXml = fillSubjectRow(docXml, 'TOTAL SCORE', [totalScore]);
    } else if (state.classLevel === 'kg') {
        docXml = fillKGSubjectTable(docXml, config, reportData);
        const totalScore = reportData.total_score || String(calculateStudentTotalFromData(reportData, config));
        docXml = fillSubjectRow(docXml, 'TOTAL SCORE', [totalScore]);
    } else if (['nursery', 'creche'].includes(state.classLevel)) {
        docXml = fillNurseryCrecheTable(docXml, config, reportData);
    }

    // ── STEP 3: Fill footer/ending fields ────────────────────────────────
    // Fields appear as "  LABEL:______" lines. We target the exact text from the template.
    const absenceDays = Math.max(0, (parseInt(liveValues.total) || 0) - (parseInt(liveValues.present) || 0));

    // Attendance — exact strings from templates (spaces matter!)
    // Lower/Upper: one combined run, no leading spaces
    // KG: split across two runs
    // Creche/Nursery: same split pattern as KG

    // Lower / Upper Primary (single run, no leading spaces — matches template exactly)
    const attLineLower = 'TOTAL SCHOOL DAYS:__________  DAYS PRESENT: _______________  DAYS ABSENT: ________________';
    if (docXml.includes(attLineLower)) {
        const filled = attLineLower
            .replace('__________', xmlEsc(liveValues.total))
            .replace('_______________', xmlEsc(liveValues.present))
            .replace('________________', xmlEsc(String(absenceDays)));
        docXml = docXml.split(attLineLower).join(filled);
    }

    // KG (split across two runs, no leading spaces)
    const attKG1 = 'TOTAL SCHOOL DAYS:__________  DAYS PRESENT: _______________';
    const attKG2 = 'DAYS ABSENT: ________________';
    if (docXml.includes(attKG1)) {
        docXml = docXml.split(attKG1).join(
            `TOTAL SCHOOL DAYS:${xmlEsc(liveValues.total)}  DAYS PRESENT: ${xmlEsc(liveValues.present)}`
        );
        docXml = docXml.split(attKG2).join(`DAYS ABSENT: ${xmlEsc(String(absenceDays))}`);
    }

    // Creche / Nursery (split, different leading spaces than KG)
    const attCreche1 = '  TOTAL SCHOOL DAYS:__________  DAYS PRESENT: _______________ ';
    const attCreche2 = ' DAYS ABSENT: ________________';
    if (docXml.includes(attCreche1)) {
        docXml = docXml.split(attCreche1).join(
            `  TOTAL SCHOOL DAYS:${xmlEsc(liveValues.total)}  DAYS PRESENT: ${xmlEsc(liveValues.present)} `
        );
        docXml = docXml.split(attCreche2).join(` DAYS ABSENT: ${xmlEsc(String(absenceDays))}`);
    }

    // Interest / Conduct / Promoted To / Remarks — exact template text
    // Note: conduct, interest, promoted_to, remarks, and head teacher remark are bolded;
    // head teacher remark is also uppercased (it comes from a dropdown).
    const headRemark = (reportData.head_teacher_remarks || reportData.head_teacher_comment || '').toString().toUpperCase();
    const footerMap = [
        // ── Lower / Upper Primary ─────────────────────────────────────────────
        ['INTEREST: ____________________________________________________________________________________',
            `INTEREST: ${xmlEsc(reportData.interest || '')}`, true],
        ['CONDUCT:_____________________________________________________________________________________',
            `CONDUCT:${xmlEsc(reportData.conduct || '')}`, true],
        ['PROMOTED TO: _________________________________________________________________________________',
            `PROMOTED TO: ${xmlEsc(reportData.promoted_to || '')}`, true],
        ['CLASS TEACHER’S REMARK: ____________________________________________________________________',
            `CLASS TEACHER’S REMARK: ${xmlEsc(reportData.class_teacher_remarks || reportData.class_teacher_comment || '')}`, true],
        ['HEAD TEACHER’S REMARK:_____________________________________________________________________',
            `HEAD TEACHER’S REMARK:${xmlEsc(headRemark)}`, true],
        // ── KG ──────────────────────────────────────────────────────────────────────
        ['SUBJECT OF INTEREST: __________________________________________________________________________',
            `SUBJECT OF INTEREST: ${xmlEsc(reportData.subject_of_interest || reportData.interest || '')}`, true],
        ['CONDUCT:______________________________________________________________________________________',
            `CONDUCT:${xmlEsc(reportData.conduct || '')}`, true],
        ['PROMOTED TO:_________________________________________________________________________________',
            `PROMOTED TO:${xmlEsc(reportData.promoted_to || '')}`, true],
        // ── Creche / Nursery ────────────────────────────────────────────
        ['IDENTIFIED INTEREST: __________________________________________________________________________',
            `IDENTIFIED INTEREST: ${xmlEsc(reportData.interest || '')}`, true],
        ['  IDENTIFIED TALENT:____________________________________________________________________________',
            `  IDENTIFIED TALENT:${xmlEsc(reportData.talent || '')}`, true],
    ];

    footerMap.forEach(([pattern, replacement, bold]) => {
        if (docXml.includes(pattern)) {
            if (bold) {
                docXml = replaceFooterPatternBold(docXml, pattern, replacement);
            } else {
                docXml = docXml.split(pattern).join(replacement);
            }
        }
    });

    // ── STEP 4: Append Bills for Next Term before </w:body> ───────────────
    try {
        const ayId = state.currentAcademicYear?.id;
        const billsXml = await buildReportUpcomingBills(student.id, ayId, null);
        if (billsXml) {
            // Insert before </w:body>
            docXml = docXml.replace('</w:body>', billsXml + '</w:body>');
        }
    } catch (_) { /* bills are non-critical */ }

    // ── Write back to zip and return blob ─────────────────────────────────
    zip.file('word/document.xml', docXml);
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ── Format a date value for display on the report ────────────────────────────
function formatDateForReport(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-GH', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch (_) { return dateStr; }
}

// ── Replace the underscores after a label text on a line ─────────────────────
// Handles "LABEL: _____" patterns in the XML.
// Searches for the label, finds the next sequence of underscores, replaces them.
function replaceUnderscoreLine(xml, label, value) {
    if (!value && value !== 0) return xml;
    const valEsc = xmlEsc(String(value));
    const labelEsc = xmlEsc(label);

    // Find label position
    let pos = xml.indexOf(`>${labelEsc}`);
    if (pos === -1) {
        // Try with entity-encoded ampersands
        const altLabel = label.replace(/'/g, '&#x2019;').replace(/'/g, '&apos;');
        pos = xml.indexOf(`>${xmlEsc(altLabel)}`);
    }
    if (pos === -1) return xml;

    // After the label, find the nearest sequence of underscores within ~500 chars
    const slice = xml.substring(pos, pos + 800);
    const underscoreMatch = slice.match(/_{3,}/);
    if (!underscoreMatch) return xml;

    const underscoreStart = pos + underscoreMatch.index;
    const underscoreEnd   = underscoreStart + underscoreMatch[0].length;

    return xml.substring(0, underscoreStart) + valEsc + xml.substring(underscoreEnd);
}

// ── Replace an inline field blank (within a mixed-text line) ─────────────────
// Used for "Term: ___ Year: ___ Level: ___" type lines.
// Finds label then replaces the underscores that immediately follow it.
function replaceInlineField(xml, label, value) {
    return replaceUnderscoreLine(xml, label, value);
}

// ── Replace only the FIRST block of underscores after a label ─────────────────
// Used for multi-run student name where underscores span two XML runs.
function replaceFirstUnderscoreBlock(xml, label, value) {
    if (!value && value !== 0) return xml;
    const valEsc   = String(value);
    const labelEsc = xmlEsc(label);

    let pos = xml.indexOf(`>${labelEsc}`);
    if (pos === -1) return xml;

    // Within the next 1000 chars, find and replace the FIRST ___ block
    const slice = xml.substring(pos, pos + 1000);
    const match  = slice.match(/_{3,}/);
    if (!match) return xml;

    const startIdx = pos + match.index;
    const endIdx   = startIdx + match[0].length;

    return xml.substring(0, startIdx) + valEsc + xml.substring(endIdx);
}

// ── Bold variant: replaces the FIRST underscore block after a label with a bold run ──
// Correctly closes the enclosing <w:t></w:r> before inserting the bold run, then
// skips the original </w:t></w:r> so there are no duplicate closing tags.
function replaceFirstUnderscoreBlockBold(xml, label, value) {
    if (!value && value !== 0) return xml;
    const valEsc   = xmlEsc(String(value));
    const labelEsc = xmlEsc(label);

    let pos = xml.indexOf(`>${labelEsc}`);
    if (pos === -1) return xml;

    const slice = xml.substring(pos, pos + 1000);
    const match  = slice.match(/_{3,}/);
    if (!match) return xml;

    const startIdx = pos + match.index;
    const endIdx   = startIdx + match[0].length;

    // Everything before the underscores (still inside the original <w:t>)
    const beforeUnderscores = xml.substring(0, startIdx);
    // Everything after the underscores — starts with </w:t></w:r>...
    const afterUnderscores  = xml.substring(endIdx);

    // Extract any rPr from the enclosing <w:r> to copy font info into bold run
    const rStart = beforeUnderscores.lastIndexOf('<w:r>');
    const rStartAlt = beforeUnderscores.lastIndexOf('<w:r ');
    const runStart = Math.max(rStart, rStartAlt);
    const rPrMatch = runStart !== -1
        ? beforeUnderscores.substring(runStart).match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
        : null;
    const rPrContent = rPrMatch ? rPrMatch[1] : '';
    const boldRPr = rPrContent
        ? `<w:rPr>${rPrContent}<w:b/><w:bCs/></w:rPr>`
        : `<w:rPr><w:b/><w:bCs/></w:rPr>`;
    const boldRun = `<w:r>${boldRPr}<w:t xml:space="preserve">${valEsc}</w:t></w:r>`;

    // Close the current <w:t> and <w:r>, insert the bold run, then skip the
    // original </w:t></w:r> that follows the underscores to avoid duplicate tags.
    const REST_OPEN = '</w:t></w:r>';
    const restAfter = afterUnderscores.startsWith(REST_OPEN)
        ? afterUnderscores.substring(REST_OPEN.length)
        : afterUnderscores;

    return beforeUnderscores + REST_OPEN + boldRun + restAfter;
}

// ── Bold replacement for footer patterns (label + underscores in same run) ───
// The pattern is the full text that appears inside a <w:t> element.
// We replace the matched text so that the label part stays plain and
// the value part gets a new bold run injected right after the label prefix.
// Correctly skips the original </w:r> already present after </w:t> to avoid
// producing duplicate </w:r> closing tags that corrupt the XML.
function replaceFooterPatternBold(xml, pattern, replacement) {
    if (!xml.includes(pattern)) return xml;

    // The replacement string has the form "  LABEL:VALUE" where VALUE is what's bold.
    // The pattern has underscores where VALUE goes. We need to:
    // 1. Replace the full pattern text (which is inside a <w:t>…</w:t></w:r>) with just the label prefix.
    // 2. Inject a bold run with the value right after that, then continue from after the </w:r>.

    // Find the label prefix — everything up to and including the last colon/space before underscores
    const underscoreIdx = pattern.indexOf('_');
    if (underscoreIdx === -1) {
        // No underscores — just do plain replacement
        return xml.split(pattern).join(replacement);
    }
    const labelPrefix = pattern.substring(0, underscoreIdx);

    // The value is whatever comes after labelPrefix in the replacement string
    const valueInReplacement = replacement.substring(labelPrefix.length);
    if (!valueInReplacement) {
        // Empty value — just replace pattern with labelPrefix (remove underscores)
        return xml.split(pattern).join(labelPrefix);
    }

    // Find the pattern in XML and split the run
    const patternIdx = xml.indexOf(pattern);
    if (patternIdx === -1) return xml;

    // Find the enclosing </w:t> after the pattern
    const tEndIdx = xml.indexOf('</w:t>', patternIdx);
    if (tEndIdx === -1) return xml.split(pattern).join(replacement);

    // Extract rPr from the enclosing <w:r> for font matching
    const beforePattern = xml.substring(0, patternIdx);
    const rStart = Math.max(beforePattern.lastIndexOf('<w:r>'), beforePattern.lastIndexOf('<w:r '));
    const rPrMatch = rStart !== -1
        ? beforePattern.substring(rStart).match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
        : null;
    const rPrContent = rPrMatch ? rPrMatch[1] : '';
    const boldRPr = rPrContent
        ? `<w:rPr>${rPrContent}<w:b/><w:bCs/></w:rPr>`
        : `<w:rPr><w:b/><w:bCs/></w:rPr>`;

    // afterTEnd starts right after </w:t> — it begins with </w:r>...</p>...
    // We must skip that </w:r> because we are emitting our own </w:t></w:r> already.
    let afterTEnd = xml.substring(tEndIdx + 6); // skip </w:t>
    if (afterTEnd.startsWith('</w:r>')) {
        afterTEnd = afterTEnd.substring(6); // skip the original </w:r>
    }

    const boldRun = `<w:r>${boldRPr}<w:t xml:space="preserve">${xmlEsc(valueInReplacement)}</w:t></w:r>`;

    return xml.substring(0, patternIdx)
        + xmlEsc(labelPrefix)
        + '</w:t></w:r>'
        + boldRun
        + afterTEnd;
}

// ── Calculate grand total from report data (no DOM access) ───────────────────
function calculateStudentTotalFromData(reportData, config) {
    let total = 0;
    if (!config) return total;
    config.sections.forEach(sec => {
        const fields = sec.type === 'kg_unified_table' ? (sec.scoredRows || []) : (sec.fields || []);
        if (['subjects_scored', 'subjects_scored_full', 'kg_unified_table'].includes(sec.type)) {
            fields.forEach(f => {
                const d = typeof reportData[f.name] === 'object' ? (reportData[f.name] || {}) : {};
                const ts = parseFloat(d.total_score || 0) ||
                    (parseFloat(d.class_score || 0) + parseFloat(d.exam_score || 0));
                total += ts;
            });
        }
    });
    return total > 0 ? total : '';
}

// ── Fill Primary (Lower/Upper) subject table rows ────────────────────────────
function fillPrimarySubjectTable(xml, config, reportData) {
    config.sections.forEach(sec => {
        if (!['subjects_scored', 'subjects_scored_full'].includes(sec.type)) return;
        sec.fields.forEach(f => {
            const d = (typeof reportData[f.name] === 'object' && reportData[f.name]) ? reportData[f.name] : {};
            const cs = String(d.class_score || '');
            const es = String(d.exam_score  || '');
            const ts = d.total_score ? String(d.total_score)
                     : (cs && es ? String((parseFloat(cs)||0) + (parseFloat(es)||0)) : '');
            const pos    = String(d.position || '');
            const remark = String(d.remarks  || '');
            // Lower: 5 data cols (class, exam, total, position, remark)
            // Upper (full): same 5 but template may also have initials - we use remarks col
            xml = fillSubjectRow(xml, f.label, [cs, es, ts, pos, remark]);
        });
    });
    return xml;
}

// ── Fill KG unified table rows ────────────────────────────────────────────────
function fillKGSubjectTable(xml, config, reportData) {
    const sec = config.sections.find(s => s.type === 'kg_unified_table');
    if (!sec) return xml;
    sec.scoredRows.forEach(f => {
        const d = (typeof reportData[f.name] === 'object' && reportData[f.name]) ? reportData[f.name] : {};
        const cs = String(d.class_score || '');
        const es = String(d.exam_score  || '');
        const ts = d.total_score ? String(d.total_score)
                 : (cs && es ? String((parseFloat(cs)||0) + (parseFloat(es)||0)) : '');
        const remark = String(d.remarks || '');
        xml = fillSubjectRow(xml, f.label, [cs, es, ts, remark]);
    });
    return xml;
}

// ── Fill Nursery/Creche rating table rows ─────────────────────────────────────
// Rating table columns: Activity | A | B | C | D | Comment
function fillNurseryCrecheTable(xml, config, reportData) {
    config.sections.forEach(sec => {
        const fields = sec.fields || [];
        if (['rating_abcd', 'rating_abcd_single'].includes(sec.type)) {
            fields.forEach(f => {
                if (f.type === 'text_value') {
                    const val = String(reportData[f.name] || '');
                    xml = fillSubjectRow(xml, f.label, [val]);
                } else {
                    const rating  = String(reportData[`${f.name}_rating`]  || '');
                    const comment = String(reportData[`${f.name}_comment`] || '');
                    // Rating columns A B C D — mark the selected one with a tick, rest blank
                    const cols = ['A','B','C','D'].map(r => r === rating ? '\u2713' : '');
                    xml = fillSubjectRow(xml, f.label, [...cols, comment]);
                }
            });
        }
        // play_therapy_yes_no for creche
        if (sec.type === 'play_therapy_yes_no') {
            fields.forEach(f => {
                const val = String(reportData[f.name] || '');
                xml = fillSubjectRow(xml, f.label, [val]);
            });
        }
    });
    return xml;
}


async function generateAndDownloadDOCX() {
    try {
        await saveCurrentReportData(false);
        showGlobalLoading('Generating report...', 'Building DOCX from saved data');

        const student    = state.students[state.currentStudentIndex];
        const reportData = state.reportsData[student.id]?.data || {};

        const blob = await buildReportDocx(student, reportData);
        saveAs(blob, `${student.name.replace(/\s+/g, '_')}_${state.term}_Report.docx`);

        hideGlobalLoading();
        showToast('Report downloaded successfully!', 'success');

    } catch (err) {
        hideGlobalLoading();
        handleError(err, 'Generate DOCX');
    }
}

// ==================== STORAGE UPLOAD FUNCTIONS ====================
async function uploadReportToStorage(studentId, blob, fileName) {
    try {
        const filePath = `${state.academicYear}/${state.term}/${state.assignedClass.replace(/\s+/g, '_')}/${fileName}`;
        
        const { error: uploadError } = await state.supabaseClient.storage
            .from('reports')
            .upload(filePath, blob, {
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                upsert: true
            });
        
        if (uploadError) {
            throw new AppError(`Storage upload failed: ${uploadError.message}`, 'error');
        }
        
        // Get public URL
        const { data: { publicUrl } } = state.supabaseClient.storage
            .from('reports')
            .getPublicUrl(filePath);
        
        return publicUrl;
    } catch (err) {
        console.error('Storage upload error:', err);
        throw err;
    }
}

async function uploadBundleToStorage(zipBlob, bundleName) {
    try {
        const filePath = `bundles/${state.academicYear}/${state.term}/${bundleName}`;
        
        const { error: uploadError } = await state.supabaseClient.storage
            .from('reports')
            .upload(filePath, zipBlob, {
                contentType: 'application/zip',
                upsert: true
            });
        
        if (uploadError) {
            throw new AppError(`Bundle upload failed: ${uploadError.message}`, 'error');
        }
        
        const { data: { publicUrl } } = state.supabaseClient.storage
            .from('reports')
            .getPublicUrl(filePath);
        
        return publicUrl;
    } catch (err) {
        console.error('Bundle upload error:', err);
        throw err;
    }
}

// ==================== SUBMISSION ====================
async function submitToAdmin() {
    if (state.isSubmitting) return;
    
    const completedCount = Object.values(state.reportsData).filter(r => r.completed).length;
    if (completedCount < state.students.length) {
        showToast(`Complete all reports first (${completedCount}/${state.students.length})`, 'warning');
        return;
    }
    
    showConfirmModal(
        'Submit to Admin',
        `You are about to submit ${completedCount} reports to the admin. This action cannot be undone. Continue?`,
        async () => {
            await executeSubmission();
        }
    );
}

async function executeSubmission() {
    state.isSubmitting = true;
    showGlobalLoading('Submitting reports...', 'Please wait while we process your submission');
    
    try {
        // Save any pending changes
        await saveCurrentReportData(false);
        
        // Generate and upload individual reports
        const uploadedReports = [];
        const totalStudents = state.students.length;
        
        for (let i = 0; i < state.students.length; i++) {
            const student = state.students[i];
            const report = state.reportsData[student.id];
            
            if (!report?.completed) continue;
            
            showGlobalLoading(`Uploading reports...`, `${i + 1} of ${totalStudents}: ${student.name}`);
            
            // Generate DOCX blob from saved data (no template file needed)
            const docxBlob = await buildReportDocx(student, report.data);
            const fileName = `${student.name.replace(/\s+/g, '_')}_${state.term}_Report.docx`;
            
            // Upload to storage
            const fileUrl = await uploadReportToStorage(student.id, docxBlob, fileName);
            
            uploadedReports.push({
                student_id: student.id,
                student_name: student.name,
                file_url: fileUrl,
                file_name: fileName
            });
        }
        
        // Prepare updates array with file URLs
        const updates = uploadedReports.map(upload => ({
            student_id: upload.student_id,
            student_name: upload.student_name,
            teacher_id: state.teacherId,
            class: state.assignedClass,
            class_id: state.assignedClassId || null,
            term: state.term,
            academic_year: state.academicYear,
            data: state.reportsData[upload.student_id].data,
            file_url: upload.file_url,
            file_name: upload.file_name,
            completed: true,
            submitted: true,
            submitted_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        }));
        
        // Process each report individually
        for (const updateData of updates) {
            // Check if record exists — prefer class_id lookup
            let existing = null;
            if (state.assignedClassId) {
                const { data: existUuid } = await state.supabaseClient
                    .from('reports')
                    .select('id')
                    .eq('student_id', updateData.student_id)
                    .eq('class_id', state.assignedClassId)
                    .eq('term', updateData.term)
                    .eq('academic_year', updateData.academic_year)
                    .maybeSingle();
                if (existUuid) existing = existUuid;
            }
            if (!existing) {
                const { data: existStr, error: checkError } = await state.supabaseClient
                    .from('reports')
                    .select('id')
                    .eq('student_id', updateData.student_id)
                    .eq('class', updateData.class)
                    .eq('term', updateData.term)
                    .eq('academic_year', updateData.academic_year)
                    .maybeSingle();
                if (checkError) throw checkError;
                existing = existStr;
            }
            
            if (existing) {
                // Update existing record — match by id for precision
                const { error: updateError } = await state.supabaseClient
                    .from('reports')
                    .update(updateData)
                    .eq('id', existing.id);
                if (updateError) throw updateError;
            } else {
                // Insert new record
                const { error: insertError } = await state.supabaseClient
                    .from('reports')
                    .insert([updateData]);
                
                if (insertError) throw insertError;
            }
        }
        
        // Generate and upload ZIP bundle
        showGlobalLoading('Creating bundle...', 'Uploading ZIP file');
        const zip = new JSZip();
        const reportsFolder = zip.folder("reports");
        
        for (const upload of uploadedReports) {
            const response = await fetch(upload.file_url);
            const arrayBuffer = await response.arrayBuffer();
            reportsFolder.file(upload.file_name, arrayBuffer);
        }
        
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const bundleName = `${state.assignedClass.replace(/\s+/g, '_')}_${state.term}_Reports_${Date.now()}.zip`;
        const bundleUrl = await uploadBundleToStorage(zipBlob, bundleName);
        
        // Create received_reports entry for admin
        const bundleData = {
            teacher_id: state.teacherId,
            teacher_name: state.teacherName,
            class: state.assignedClass,
            term: state.term,
            academic_year: state.academicYear,
            student_count: uploadedReports.length,
            status: 'pending_review',
            submitted_at: new Date().toISOString(),
            class_level: state.classLevel,
            template_used: `template_${state.classLevel}`,
            bundle_url: bundleUrl,
            bundle_name: bundleName,
            report_summary: uploadedReports.map(r => ({
                student_id: r.student_id,
                student_name: r.student_name,
                file_url: r.file_url,
                total_score: state.reportsData[r.student_id]?.data?.total_score || null
            }))
        };
        
        const { data: receivedEntry, error: receivedError } = await state.supabaseClient
            .from('received_reports')
            .insert([bundleData])
            .select()
            .single();
        
        if (receivedError) throw receivedError;
        
        // Update reports with bundle ID
        const bulkUpdateQuery = state.supabaseClient
            .from('reports')
            .update({ 
                status: 'submitted_to_admin',
                submitted_to_admin_at: new Date().toISOString(),
                submission_bundle_id: receivedEntry.id
            })
            .eq('teacher_id', state.teacherId)
            .eq('term', state.term)
            .eq('academic_year', state.academicYear);

        if (state.assignedClassId) {
            await bulkUpdateQuery.eq('class_id', state.assignedClassId);
        } else {
            await bulkUpdateQuery.eq('class', state.assignedClass);
        }
        
        // Store bundle in state so teacher can download on demand via the Download button
        state.pendingBundle = { blob: zipBlob, name: bundleName };
        
        hideGlobalLoading();
        showToast('Reports submitted to admin successfully! Use the Download button to save the ZIP.', 'success');
        
        // Show download button if present
        const dlBtn = document.getElementById('download-bundle-btn');
        if (dlBtn) {
            dlBtn.classList.remove('hidden');
            dlBtn.onclick = () => {
                if (state.pendingBundle) {
                    saveAs(state.pendingBundle.blob, state.pendingBundle.name);
                }
            };
        }
        
        // Close editor after delay
        setTimeout(() => {
            closeEditor();
            // Refresh data
            loadSavedReports().then(() => {
                renderStudentsGrid();
                updateProgress();
            });
        }, 2000);
        
    } catch (err) {
        hideGlobalLoading();
        state.isSubmitting = false;
        handleError(err, 'Submit to Admin');
    }
}

// ==================== BUNDLE DOWNLOAD ====================
function downloadBundle() {
    if (state.pendingBundle) {
        saveAs(state.pendingBundle.blob, state.pendingBundle.name);
    } else {
        showToast('No bundle available to download yet.', 'warning');
    }
}

// ==================== UI UTILITIES ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showGlobalLoading(text, subtext = '') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-subtext').textContent = subtext;
    document.getElementById('global-loading').classList.remove('hidden');
    document.getElementById('global-loading').classList.add('flex');
}

function hideGlobalLoading() {
    document.getElementById('global-loading').classList.add('hidden');
    document.getElementById('global-loading').classList.remove('flex');
}

function showConfirmModal(title, message, onConfirm, onCancel = null) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    
    const modal = document.getElementById('confirm-modal');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    
    // Remove old listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.addEventListener('click', () => {
        closeModal();
        if (onConfirm) onConfirm();
    });
    
    modal.classList.add('active');
    
    // Store cancel callback
    modal.dataset.onCancel = onCancel ? 'true' : 'false';
}

function closeModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('active');
    
    if (modal.dataset.onCancel === 'true') {
        // Would need to store the actual callback differently in production
    }
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark ? 'true' : 'false');
}

function goBackToDashboard() {
    if (state.hasUnsavedChanges) {
        showConfirmModal(
            'Unsaved Changes',
            'You have unsaved changes. Are you sure you want to leave?',
            () => {
                if (state.autoSaveTimer)    clearTimeout(state.autoSaveTimer);
                if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
                window.location.href = 'index.html?view=teacher_dashboard';
            }
        );
    } else {
        if (state.autoSaveTimer)    clearTimeout(state.autoSaveTimer);
        if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
        window.location.href = 'index.html?view=teacher_dashboard';
    }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    // ── Mobile Responsiveness ──────────────────────────────────────────────────
    // Ensure viewport meta is present (critical for mobile rendering)
    if (!document.querySelector('meta[name="viewport"]')) {
        const vp = document.createElement('meta');
        vp.name = 'viewport';
        vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
        document.head.appendChild(vp);
    }

    // Inject mobile-specific CSS for the subject table and layout
    const mobileStyle = document.createElement('style');
    mobileStyle.textContent = `
        /* ── Score validation shake animation ── */
        @keyframes scoreShake {
            0%,100% { transform: translateX(0); }
            20%      { transform: translateX(-6px); }
            40%      { transform: translateX(6px); }
            60%      { transform: translateX(-4px); }
            80%      { transform: translateX(4px); }
        }
        .score-invalid-shake {
            animation: scoreShake 0.45s ease;
            border-color: #ef4444 !important;
            background-color: rgba(239,68,68,0.1) !important;
        }
        /* ── Mobile: subject table scrolls horizontally ── */
        .subject-table { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .subject-table table { min-width: 520px; }

        /* ── Mobile: subject column label wraps instead of overflows ── */
        @media (max-width: 640px) {
            .subject-label { font-size: 0.7rem !important; white-space: normal !important; max-width: 80px; }
            .score-input { min-width: 36px !important; font-size: 0.7rem !important; padding: 0.25rem !important; }
            /* Stack basic-info grid to single column on small screens */
            .grid.grid-cols-1.md\\:grid-cols-3 { grid-template-columns: 1fr !important; }
            /* Tighten section padding */
            .glass-panel .p-6 { padding: 1rem !important; }
            .glass-panel .px-6 { padding-left: 1rem !important; padding-right: 1rem !important; }
            /* Editor sidebar hidden on mobile (scroll-based layout) */
            #student-sidebar { display: none !important; }
            #editor-main { margin-left: 0 !important; width: 100% !important; }
            /* Make the form container full width */
            #form-container { padding: 0 !important; }
            /* Student grid single column */
            #students-grid { grid-template-columns: 1fr !important; }
            /* Stack editor header */
            #editor-header { flex-wrap: wrap; gap: 0.5rem; }
            /* Remarks select full width */
            .remarks-select { width: 100% !important; }
        }
    `;
    document.head.appendChild(mobileStyle);

    // Check for saved dark mode preference
    if (localStorage.getItem('darkMode') === 'true') {
        document.documentElement.classList.add('dark');
    }
    
    initializeSupabase();
});
