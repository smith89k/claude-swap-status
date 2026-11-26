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
    const TOOL_LABEL = { rename: 'Rename', remove: 'Remove' };

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

    function accountBlock(a) {
        const block = el('article', 'account' + (a.isThisWindow ? ' is-current' : ''));
        block.dataset.state = a.state;
        if (a.isThisWindow) {
            block.setAttribute('aria-current', 'true');
        }

        const head = el('div', 'acc-head');
        head.append(el('span', 'acc-name', a.name));
        if (a.plan) {
            head.append(el('span', 'acc-plan', a.plan));
        }
        const tools = el('div', 'acc-tools');
        for (const action of ['rename', 'remove']) {
            if (!a.actions.includes(action)) {
                continue;
            }
            const b = el('button', 'icon-btn');
            b.type = 'button';
            b.innerHTML = ICONS[action];
            b.title = TOOL_LABEL[action];
            b.setAttribute('aria-label', TOOL_LABEL[action] + ' ' + a.name);
            b.addEventListener('click', () => send(action, a.key));
            tools.append(b);
        }
        head.append(tools);
        const main = a.actions.find((x) => BUTTON_TEXT[x]);
        if (main) {
            const b = el('button', 'btn btn-small ' + (main === 'use' ? 'btn-secondary' : 'btn-primary'), BUTTON_TEXT[main]);
            b.type = 'button';
            b.title = BUTTON_TITLE[main];
            b.setAttribute('aria-label', BUTTON_TEXT[main] + ': ' + a.name);
            b.addEventListener('click', () => send(main, a.key));
            head.append(b);
        }
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

    function render(model) {
        app.replaceChildren();
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
            vscode.setState(msg.model);
            render(msg.model);
        }
    });

    const saved = vscode.getState();
    if (saved) {
        render(saved);
    }
    vscode.postMessage({ type: 'ready' });
})();
