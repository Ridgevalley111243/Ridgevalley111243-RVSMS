// =============================================================================
// Report card templates and report progress (shared by report.html and the portal)
//
// TEMPLATE_CONFIG lists the fields on each level's report card. reportProgress()
// works out how much of a student's report the CLASS TEACHER has filled in:
//   • counts only fields the teacher fills: scores, ratings, answers, dates,
//     attendance, interest/conduct, the class teacher's remark;
//   • skips what fills itself in (name, term, class, totals, grades,
//     positions, subject remarks on primary, days absent);
//   • skips the head teacher's remark (added by the admin);
//   • skips "Promoted to" until the final term (Term 3).
// A report is complete when every counted field is filled.
// =============================================================================
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
                fields: [{ name: 'signs_gestures_details', label: 'If yes, what signs/gestures?', placeholder: 'Describe the signs or gestures...',
                           // Only needed when one of the "signs / gestures" questions was answered Yes
                           requiredIf: d => d.show_signs_tasty === 'Yes' || d.show_signs_hungry === 'Yes' }]
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

// Level from a class name, e.g. "LOWER PRIMARY - BASIC 2" → 'lower'.
// Same rules as the report page uses to pick the report card template.
function reportLevelForClass(name) {
    const c = String(name || '').trim().toLowerCase();
    if (/creche|crèche|crèche|baby|toddler|pre-?nursery/.test(c)) return 'creche';
    if (c.includes('kindergarten') || /\bkg\b/.test(c)) return 'kg';
    if (/nursery|playgroup|pre-?school/.test(c)) return 'nursery';
    const m = c.match(/\b(\d+)\b/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n === 0) return 'kg';
        if (n >= 1 && n <= 3 && !/jhs|jss|shs|sss|form/.test(c)) return 'lower';
        return 'upper';
    }
    return 'kg'; // reception / transition / unknown: the report page also falls back to KG
}

// The final term of the year is when "Promoted to" is filled in
function isFinalTerm(term) {
    return /\b3\b|third/i.test(String(term || ''));
}

function reportProgress(level, term, data) {
    const config = TEMPLATE_CONFIG[level];
    const d = data || {};
    const filled = v => v !== undefined && v !== null && String(v).trim() !== '';
    const items = []; // { label, done }
    if (!config) return { done: 0, total: 0, percent: 0, complete: false, missing: [] };

    const skip = f => f.readonly || f.auto || f.name === 'days_absent' || f.name === 'head_teacher_remarks'
        || (f.name === 'promoted_to' && !isFinalTerm(term))
        || (typeof f.requiredIf === 'function' && !f.requiredIf(d));

    for (const section of config.sections) {
        switch (section.type) {
            case 'subjects_scored':
            case 'subjects_scored_full':
                section.fields.forEach(f => {
                    const s = d[f.name] || {};
                    items.push({ label: `${f.label}: class score`, done: filled(s.class_score) });
                    items.push({ label: `${f.label}: exam score`, done: filled(s.exam_score) });
                });
                break;
            case 'kg_unified_table':
                (section.scoredRows || []).forEach(r => {
                    const s = d[r.name] || {};
                    items.push({ label: `${r.label}: class score`, done: filled(s.class_score) });
                    items.push({ label: `${r.label}: exam score`, done: filled(s.exam_score) });
                    items.push({ label: `${r.label}: remarks`, done: filled(s.remarks) });
                });
                break;
            case 'rating_abcd':
            case 'rating_abcd_single':
                section.fields.forEach(f => {
                    const key = f.type === 'text_value' ? f.name : `${f.name}_rating`;
                    items.push({ label: f.label, done: filled(d[key]) });
                });
                break;
            default:
                (section.fields || []).forEach(f => {
                    if (skip(f)) return;
                    items.push({ label: f.label, done: filled(d[f.name]) });
                });
        }
    }
    const total = items.length;
    const done = items.filter(i => i.done).length;
    const percent = total ? Math.round(done / total * 100) : 0;
    return { done, total, percent, complete: total > 0 && done === total,
             missing: items.filter(i => !i.done).map(i => i.label) };
}
