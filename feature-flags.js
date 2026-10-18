// =============================================================================
// Feature switches (shared by the portal and the report page)
//
// Features the school isn't using can be switched off and back on in
// Settings: academic features by the administrator, finance features by the
// accountant. Stored in app_settings as two JSON rows:
//   features_academic   features_finance
// A feature with no saved value uses its default below. Defaults keep
// everything that is on screen today switched on; features that were already
// hidden (teacher attendance) start switched off.
// =============================================================================
(function () {
    'use strict';

    const GROUPS = {
        academic: {
            key: 'features_academic',
            title: 'Academic features',
            owner: 'admin',
            features: [
                { id: 'attendance', label: 'Teacher attendance marking', default: false,
                  who: 'Teachers, Admin',
                  desc: 'Teachers mark students present or absent each school day and see a term summary. The admin can view the records by date and class.',
                  views: ['attendance', 'teacher_attendance', 'teacher_total_attendance'] },
                { id: 'weeks', label: 'Academic weeks', default: true,
                  who: 'Admin, everyone (top bar)',
                  desc: 'The Weeks screen, the current week shown in the top bar, and switching to the next week automatically when its dates arrive.',
                  views: ['weeks'] },
                { id: 'promotion', label: 'Promotion & graduation', default: true,
                  who: 'Admin',
                  desc: 'Moving classes up at the end of the year and archiving graduates, plus the Graduated Students list.',
                  views: ['promotion', 'graduated_students'] },
                { id: 'upload_reports', label: 'Upload report files', default: true,
                  who: 'Admin',
                  desc: 'Uploading finished report files (PDF or Word) for each student.',
                  views: ['admin_upload_reports'] },
                { id: 'parent_reports', label: 'Reports for parents', default: true,
                  who: 'Parents',
                  desc: "Parents can open their children's published reports.",
                  views: ['parent_reports'] },
                { id: 'data_analysis', label: 'Data analysis', default: true,
                  who: 'Admin',
                  desc: 'Charts and figures about students, classes and results.',
                  views: ['data_analysis'] },
                { id: 'name_order', label: 'Student name order for teachers', default: true,
                  who: 'Teachers',
                  desc: 'Teachers choose how their students’ names are shown (for example surname first, or first name first). My Students and the report page then list students alphabetically in that order.',
                  views: [] },
            ],
        },
        finance: {
            key: 'features_finance',
            title: 'Finance features',
            owner: 'accountant',
            features: [
                { id: 'billing', label: 'Billing', default: true,
                  who: 'Accountant',
                  desc: 'Creating bills (uniforms, books, trips and so on) and assigning them to students.',
                  views: ['billing'] },
                { id: 'payment_proofs', label: 'Payment proofs', default: true,
                  who: 'Accountant',
                  desc: 'The screen listing Mobile Money screenshots uploaded by parents.',
                  views: ['screenshots'] },
                { id: 'parent_payments', label: 'Payments for parents', default: true,
                  who: 'Parents',
                  desc: 'Parents see fees and balances and submit Mobile Money payments.',
                  views: ['parent_finance'] },
                { id: 'financial_report', label: 'Financial report', default: true,
                  who: 'Accountant',
                  desc: 'Income, arrears and payment summaries, with PDF export.',
                  views: ['financial_report', 'financial_analytics'] },
                { id: 'paystack', label: 'Paystack online payments', default: false,
                  who: 'Parents, Accountant',
                  desc: 'Parents pay online by card or Mobile Money through Paystack. Payments arrive as pending with a Paystack reference for you to confirm. After switching it on, add your Paystack public key.',
                  views: [] },
                { id: 'report_bills', label: "Next term's bills on report cards", default: true,
                  who: 'Teachers, Parents',
                  desc: "Adds a table of each student's bills for next term to the downloaded report card.",
                  views: [] },
            ],
        },
    };

    const saved = { academic: {}, finance: {} };
    // Plain settings that go with a feature (e.g. the Paystack public key)
    const VALUE_KEYS = ['paystack_public_key'];
    const values = {};
    let loaded = false;

    function feature(id) {
        for (const [group, g] of Object.entries(GROUPS)) {
            const f = g.features.find(x => x.id === id);
            if (f) return { group, f };
        }
        return null;
    }

    function isOn(id) {
        const hit = feature(id);
        if (!hit) return true;
        const v = saved[hit.group][id];
        return typeof v === 'boolean' ? v : hit.f.default;
    }

    // The feature a screen belongs to (null if the screen is always available)
    function featureForView(view) {
        for (const g of Object.values(GROUPS)) {
            const f = g.features.find(x => x.views.includes(view));
            if (f) return f.id;
        }
        return null;
    }

    function parse(text) {
        try { const o = JSON.parse(text || '{}'); return o && typeof o === 'object' ? o : {}; }
        catch (_) { return {}; }
    }

    async function load(client) {
        try {
            const { data, error } = await client.from('app_settings')
                .select('key, value').in('key', [GROUPS.academic.key, GROUPS.finance.key, ...VALUE_KEYS]);
            if (error) throw error;
            VALUE_KEYS.forEach(k => { values[k] = (data || []).find(r => r.key === k)?.value || ''; });
            for (const [group, g] of Object.entries(GROUPS)) {
                const row = (data || []).find(r => r.key === g.key);
                saved[group] = row ? parse(row.value) : {};
            }
        } catch (err) {
            // Not readable yet (e.g. before the settings permission is added): use defaults
            console.warn('[features] using defaults:', err?.message || err);
        }
        loaded = true;
        return saved;
    }

    async function set(client, group, id, on) {
        const g = GROUPS[group];
        const next = { ...saved[group], [id]: !!on };
        const { data, error } = await client.from('app_settings')
            .upsert({ key: g.key, value: JSON.stringify(next) }, { onConflict: 'key' })
            .select('key');
        if (error) throw error;
        if (!data || !data.length) throw new Error('The setting was not saved. You may not have permission to change it.');
        saved[group] = next;
    }

    async function setValue(client, key, value) {
        if (!VALUE_KEYS.includes(key)) throw new Error('Unknown setting');
        const { data, error } = await client.from('app_settings')
            .upsert({ key, value }, { onConflict: 'key' }).select('key');
        if (error) throw error;
        if (!data || !data.length) throw new Error('The setting was not saved. You may not have permission to change it.');
        values[key] = value;
    }

    window.rvFeatures = { GROUPS, isOn, featureForView, load, set, setValue,
        value: k => values[k] || '', get loaded() { return loaded; } };
})();
