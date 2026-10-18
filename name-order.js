// =============================================================================
// Student name order (used by the portal and the report page)
//
// The register writes names surname first: "MENSAH KWAME KOFI" is
// surname MENSAH, first name KWAME, middle name KOFI. A teacher can choose to
// show their students in another order, e.g. "KWAME KOFI MENSAH", and the
// lists are then sorted alphabetically in that order.
//
// The choice is saved on the teacher's own account (user metadata), so it
// follows them to every device. The admin can switch the feature off in
// Settings; when it is off, names show exactly as written.
// =============================================================================
(function () {
    'use strict';

    const ORDERS = {
        sfm: { label: 'Surname, first name, middle name', parts: ['surname', 'first', 'middle'] },
        smf: { label: 'Surname, middle name, first name', parts: ['surname', 'middle', 'first'] },
        fms: { label: 'First name, middle name, surname', parts: ['first', 'middle', 'surname'] },
        fsm: { label: 'First name, surname, middle name', parts: ['first', 'surname', 'middle'] },
    };
    const DEFAULT = 'sfm';

    function split(name) {
        const w = String(name || '').trim().split(/\s+/).filter(Boolean);
        return { surname: w[0] || '', first: w[1] || '', middle: w.slice(2).join(' ') };
    }

    function format(name, order) {
        const o = ORDERS[order] || ORDERS[DEFAULT];
        const p = split(name);
        const out = o.parts.map(k => p[k]).filter(Boolean).join(' ');
        return out || String(name || '');
    }

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    // Returns a new array sorted alphabetically by the name as displayed
    function sort(list, order, getName = s => s.name) {
        return [...(list || [])].sort((a, b) =>
            collator.compare(format(getName(a), order), format(getName(b), order)));
    }

    function optionsHtml(selected) {
        return Object.entries(ORDERS).map(([k, o]) =>
            `<option value="${k}" ${k === selected ? 'selected' : ''}>${o.label}</option>`).join('');
    }

    // The teacher's saved choice, from their account
    async function load(client) {
        try {
            const { data } = await client.auth.getUser();
            const v = data?.user?.user_metadata?.rv_name_order;
            return ORDERS[v] ? v : DEFAULT;
        } catch (_) { return DEFAULT; }
    }

    async function save(client, order) {
        if (!ORDERS[order]) return { error: new Error('Unknown name order') };
        return client.auth.updateUser({ data: { rv_name_order: order } });
    }

    // Builds a register name from its parts: SURNAME FIRST MIDDLE
    function compose(surname, first, middle) {
        return [surname, first, middle].map(x => String(x ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
    }

    // The name typed into the admin's Register New Student form ('' if surname or first name is missing)
    function fromForm() {
        const v = id => document.getElementById(id)?.value || '';
        if (!v('student-surname').trim() || !v('student-first-name').trim()) return '';
        return compose(v('student-surname'), v('student-first-name'), v('student-middle-name'));
    }

    window.rvNameOrder = { ORDERS, DEFAULT, split, format, sort, optionsHtml, load, save, compose, fromForm };
})();
