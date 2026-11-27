// Draws the Claude Accounts panel from the model the extension sends.
// All text and decisions come from the extension; this file only builds DOM.
(function () {
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');

    const BUTTON_TEXT = { use: 'Use here', signIn: 'Sign in', signInAgain: 'Sign in again' };
    const BUTTON_TITLE = {
        use: 'Use this account in this window. The window reloads.',
        signIn: 'Sign in to this account.',
        signInAgain: 'Sign in to this account again.',
    };
    const ICONS = {
        rename: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>',
        remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M10 3h3v1h-1v9l-1 1H5l-1-1V4H3V3h3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1zM9 2H7v1h2V2zM5 4v9h6V4H5zm1 2h1v5H6V6zm3 0h1v5H9V6z"/></svg>',
    };
    ICONS.icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 12l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7zm0 2.3L6.6 6.3l-3.1.5 2.3 2.2-.6 3.1L8 10.6l2.8 1.5-.6-3.1 2.3-2.2-3.1-.5z"/></svg>';
    const TOOL_LABEL = { icon: 'Change icon', rename: 'Rename', remove: 'Delete' };
    // A window with a round arrow inside: "reload this window" (the title bar's refresh only updates the numbers).
    const RELOAD_WINDOW = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="2.1" width="12.8" height="11.8" rx="1.8"/><path d="M1.6 5.1h12.8"/><path d="M10.6 9.6a2.6 2.6 0 1 1-.76-1.84"/><path d="M10.2 6.4v1.6H8.6"/></svg>';
    const CROWN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.3 4.2 4.9 7 8 2.2 11.1 7l3.6-2.8-1.3 7.3H2.6L1.3 4.2zM2.7 12.6h10.6V14H2.7z"/></svg>';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function send(action, key) {
        vscode.postMessage({ type: 'action', action, key });
    }

    function meterRow(m) {
        const row = el('div', 'meter');
        row.dataset.level = m.level;
        row.title = m.title;

        const track = el('span', 'meter-track');
        track.setAttribute('role', 'meter');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(Math.round(m.pct)));
        track.setAttribute('aria-label', m.label === '5h' ? '5-hour limit' : 'Weekly limit');
        track.setAttribute('aria-valuetext', m.title);

        const bar = el('span', 'meter-bar');
        const fill = el('span', 'meter-fill');
        fill.style.setProperty('--pct', m.pct + '%');
        bar.append(fill);
        track.append(bar);
        if (typeof m.pace === 'number') {
            const pace = el('span', 'meter-pace');
            pace.style.setProperty('--pace', (m.pace * 100) + '%');
            track.append(pace);
        }

        row.append(el('span', 'meter-label', m.label), track, el('span', 'meter-value', m.pctText), el('span', 'meter-reset', m.resetText || ''));
        return row;
    }

    function iconBadge(svg, label) {
        const badge = el('span', 'acc-icon');
        badge.innerHTML = svg;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', label);
        badge.title = label;
        return badge;
    }

    function accountBlock(a) {
        const block = el('article', 'account' + (a.isThisWindow ? ' is-current' : ''));
        block.dataset.state = a.state;
        if (a.isThisWindow) {
            block.setAttribute('aria-current', 'true');
        }

        const head = el('div', 'acc-head');
        if (a.isMain) {
            // The crown marks the main account (your normal Claude login), whatever its name.
            const crown = el('span', 'acc-crown');
            crown.innerHTML = CROWN;
            crown.title = 'Main account: your normal Claude login';
            crown.setAttribute('role', 'img');
            crown.setAttribute('aria-label', 'Main account');
            head.append(crown);
        } else if (a.icon) {
            head.append(iconBadge(a.icon.svg, a.icon.label));
        }
        head.append(el('span', 'acc-name', a.name));
        if (a.plan) {
            head.append(el('span', 'acc-plan', a.plan));
        }
        // Tools and the main button travel together: on a narrow sidebar they wrap to the
        // next line as one group, still aligned to the right.
        const end = el('div', 'acc-end');
        const tools = el('div', 'acc-tools');
        for (const action of ['icon', 'rename', 'remove']) {
            if (!a.actions.includes(action)) {
                continue;
            }
            const blocked = action === 'remove' && a.canRemove === false;
            const b = el('button', 'icon-btn' + (blocked ? ' is-blocked' : ''));
            b.type = 'button';
            b.innerHTML = ICONS[action];
            b.title = blocked ? a.removeNote : TOOL_LABEL[action];
            b.setAttribute('aria-label', blocked ? a.removeNote : TOOL_LABEL[action] + ' ' + a.name);
            if (blocked) {
                b.setAttribute('aria-disabled', 'true');
            }
            b.addEventListener('click', () => send(action, a.key));
            tools.append(b);
        }
        end.append(tools);
        const main = a.actions.find((x) => BUTTON_TEXT[x]);
        if (main) {
            const b = el('button', 'btn btn-small ' + (main === 'use' ? 'btn-secondary' : 'btn-primary'), BUTTON_TEXT[main]);
            b.type = 'button';
            b.title = BUTTON_TITLE[main];
            b.setAttribute('aria-label', BUTTON_TEXT[main] + ': ' + a.name);
            b.addEventListener('click', () => send(main, a.key));
            end.append(b);
        }
        if (!main) {
            // Only the hover icons: let them float over the card instead of taking a line.
            end.classList.add('only-tools');
        }
        head.append(end);
        block.append(head);

        if (a.email && a.email !== a.name) {
            block.append(el('p', 'acc-email', a.email));
        }

        if (a.meters.length) {
            const meters = el('div', 'meters');
            a.meters.forEach((m) => meters.append(meterRow(m)));
            block.append(meters);
        }
        if (a.note) {
            block.append(el('p', 'acc-note', a.note));
        }
        if (a.detail) {
            block.append(el('p', 'acc-detail', a.detail));
        }

        return block;
    }

    function addButton(primary) {
        const row = el('div', 'add-row');
        const b = el('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), 'Add account');
        b.type = 'button';
        b.title = 'Add another Claude account. This window reloads so you can sign in.';
        b.addEventListener('click', () => send('add'));
        row.append(b);
        return row;
    }

    // ----- Sessions tab -----

    function sessionRow(r) {
        const b = el('button', 'session' + (r.canJump ? '' : ' cannot-jump'));
        b.type = 'button';
        b.dataset.status = r.status;
        b.title = r.canJump ? (r.status === 'finished' ? 'Reopen this conversation here' : 'Jump to this session') : (r.note || '');
        const top = el('span', 'session-top');
        top.append(el('span', 'session-dot'), el('span', 'session-title', r.title));
        const account = el('span', 'session-account');
        if (r.isMain) {
            const crown = el('span', 'acc-crown');
            crown.innerHTML = CROWN;
            crown.setAttribute('role', 'img');
            crown.setAttribute('aria-label', 'Main account');
            account.append(crown);
        } else if (r.accountIcon) {
            const badge = iconBadge(r.accountIcon, 'Account icon');
            badge.removeAttribute('title');
            account.append(badge);
        }
        account.append(el('span', 'session-account-name', r.accountName));
        top.append(account);
        b.append(top);
        if (r.subtitle) {
            b.append(el('span', 'session-sub', r.subtitle));
        }
        b.append(el('span', 'session-meta', r.whereText + ' · ' + r.ageText));
        b.addEventListener('click', () => vscode.postMessage({ type: 'jump', sessionId: r.sessionId }));
        return b;
    }

    function viewSwitch() {
        const bar = el('div', 'view-switch');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Which sessions to show');
        for (const v of [{ id: 'all', text: 'All', title: 'Running sessions, then finished ones from the last 30 days' }, { id: 'active', text: 'Active', title: 'Only running sessions' }]) {
            const b = el('button', 'view-btn', v.text);
            b.type = 'button';
            b.title = v.title;
            b.setAttribute('aria-pressed', String(state.view === v.id));
            b.addEventListener('click', () => {
                state = { ...state, view: v.id };
                vscode.setState(state);
                draw();
            });
            bar.append(b);
        }
        return bar;
    }

    function renderGroups(groups) {
        for (const g of groups) {
            const section = el('section', 'sessions');
            section.append(el('h2', '', g.heading));
            g.rows.forEach((r) => section.append(sessionRow(r)));
            app.append(section);
        }
    }

    function renderSessions(sessions) {
        app.append(viewSwitch());
        const running = sessions ? sessions.groups : [];
        const past = state.view === 'all' && sessions && sessions.past ? sessions.past : [];
        if (!running.length && !past.length) {
            app.append(el('p', 'intro', state.view === 'all' ? 'No Claude sessions in the last 30 days.' : 'No Claude sessions are running right now.'));
            return;
        }
        renderGroups(running);
        renderGroups(past);
    }

    // ----- Tabs -----

    let state = { model: undefined, sessions: undefined, tab: 'accounts', view: 'active' };

    function tabBar() {
        const row = el('div', 'tabs');
        const bar = el('div', 'tab-list');
        bar.setAttribute('role', 'tablist');
        const tabs = [
            { id: 'accounts', text: 'Accounts' },
            { id: 'sessions', text: 'Sessions', count: state.sessions ? state.sessions.count : 0 },
        ];
        const buttons = tabs.map((t) => {
            const b = el('button', 'tab');
            b.type = 'button';
            b.id = 'tab-' + t.id;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(state.tab === t.id));
            b.tabIndex = state.tab === t.id ? 0 : -1;
            b.append(el('span', '', t.text));
            if (t.count) {
                b.append(el('span', 'tab-count', String(t.count)));
            }
            b.addEventListener('click', () => select(t.id));
            return b;
        });
        bar.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                return;
            }
            const next = state.tab === 'accounts' ? 'sessions' : 'accounts';
            select(next);
            const focus = document.getElementById('tab-' + next);
            if (focus) {
                focus.focus();
            }
        });
        bar.append(...buttons);
        row.append(bar, reloadButton());
        return row;
    }

    // Reloads this editor window, the same way switching accounts does (it asks first).
    function reloadButton() {
        const b = el('button', 'icon-btn tab-reload');
        b.type = 'button';
        b.innerHTML = RELOAD_WINDOW;
        b.title = 'Reload window';
        b.setAttribute('aria-label', 'Reload window');
        b.addEventListener('click', () => send('reload'));
        return b;
    }

    function select(tab) {
        state = { ...state, tab };
        vscode.setState(state);
        draw();
    }

    function draw() {
        app.replaceChildren();
        app.append(tabBar());
        if (state.tab === 'sessions') {
            renderSessions(state.sessions);
        } else if (state.model) {
            renderAccounts(state.model);
        }
    }

    function renderAccounts(model) {
        if (model.current) {
            const section = el('section', 'current');
            section.append(el('h2', '', 'This window'), accountBlock(model.current));
            app.append(section);
        }
        if (model.others.length) {
            const section = el('section', 'others');
            section.append(el('h2', '', model.current ? 'Other accounts' : 'Accounts'));
            model.others.forEach((a) => section.append(accountBlock(a)));
            app.append(section);
        }
        if (!model.hasExtraAccounts) {
            app.append(el('p', 'intro', 'Give each window its own Claude account. Add one, sign in once, then pick it for any window.'));
            app.append(addButton(true));
        } else {
            app.append(addButton(false));
        }
        if (model.hint) {
            app.append(el('p', 'hint', model.hint));
        }
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'state' && msg.model) {
            state = { ...state, model: msg.model, sessions: msg.sessions };
            vscode.setState(state);
            draw();
        }
    });

    const saved = vscode.getState();
    if (saved && saved.model) {
        state = { ...state, model: saved.model, sessions: saved.sessions, tab: saved.tab === 'sessions' ? 'sessions' : 'accounts' };
    }
    if (saved && saved.view === 'all') {
        state = { ...state, view: 'all' };
    }
    if (state.model) {
        draw();
    }
    vscode.postMessage({ type: 'ready' });
})();
