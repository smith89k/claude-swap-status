// A small stand-in for the `vscode` module so the extension's glue code can be
// unit-tested under plain Node. Tests drive it through `fake`.
export const fake = {
    messages: [] as { level: 'info' | 'warning' | 'error'; text: string; items: string[] }[],
    commands: [] as { id: string; args: unknown[] }[],
    config: {} as Record<string, unknown>,
    activeExtensions: new Set<string>(),
    reply: undefined as string | undefined,
    /** Lets a test play another extension's command (it runs after the call is recorded). */
    onCommand: undefined as ((id: string, args: unknown[]) => void | Promise<void>) | undefined,
    reset() {
        this.messages.length = 0;
        this.commands.length = 0;
        this.config = {};
        this.activeExtensions.clear();
        this.reply = undefined;
        this.onCommand = undefined;
        tabState.groups.length = 0;
        tabState.closed.length = 0;
    },
};

function show(level: 'info' | 'warning' | 'error') {
    return (text: string, ...rest: unknown[]) => {
        const items = rest.filter((x): x is string => typeof x === 'string');
        fake.messages.push({ level, text, items });
        return Promise.resolve(fake.reply);
    };
}

export const window = {
    showInformationMessage: show('info'),
    showWarningMessage: show('warning'),
    showErrorMessage: show('error'),
};

export const commands = {
    executeCommand: async (id: string, ...args: unknown[]) => {
        fake.commands.push({ id, args });
        await fake.onCommand?.(id, args);
        return undefined;
    },
};

/** Editor tabs. A webview tab (like a Claude tab) has a TabInputWebview with the webview's type. */
export class TabInputWebview {
    constructor(readonly viewType: string) {}
}

export interface FakeTab { label: string; input: unknown; isActive: boolean }
export interface FakeGroup { viewColumn: number; tabs: FakeTab[]; isActive: boolean; readonly activeTab: FakeTab | undefined }
export const tabState = { groups: [] as FakeGroup[], closed: [] as string[] };

export const CLAUDE_VIEW_TYPE = 'mainThreadWebview-claudeVSCodePanel';

/** Lays out tab groups. `active` marks the selected tab of a group; the first group is the active one unless one says so. */
export function setTabs(groups: { tabs: { label: string; claude?: boolean; active?: boolean }[]; active?: boolean }[]): void {
    tabState.groups.length = 0;
    groups.forEach((g, i) => {
        const tabs: FakeTab[] = g.tabs.map((t) => ({ label: t.label, input: t.claude ? new TabInputWebview(CLAUDE_VIEW_TYPE) : { uri: t.label }, isActive: !!t.active }));
        tabState.groups.push({ viewColumn: i + 1, tabs, isActive: g.active ?? i === 0, get activeTab(): FakeTab | undefined { return tabs.find((t) => t.isActive); } });
    });
}

/** Makes this tab the selected one in its group, and its group the active one. */
export function activateTab(tab: FakeTab): void {
    for (const g of tabState.groups) {
        const mine = g.tabs.includes(tab);
        g.isActive = mine;
        if (mine) {
            g.tabs.forEach((t) => (t.isActive = t === tab));
        }
    }
}

/** Adds a Claude tab to the active group and selects it. */
export function addClaudeTab(label: string): FakeTab {
    const g = tabState.groups.find((x) => x.isActive) ?? tabState.groups[0];
    const tab: FakeTab = { label, input: new TabInputWebview(CLAUDE_VIEW_TYPE), isActive: false };
    g.tabs.push(tab);
    activateTab(tab);
    return tab;
}

(window as any).tabGroups = {
    get all() {
        return tabState.groups;
    },
    get activeTabGroup() {
        return tabState.groups.find((g) => g.isActive) ?? tabState.groups[0];
    },
    close: async (tab: FakeTab) => {
        for (const g of tabState.groups) {
            const i = g.tabs.indexOf(tab);
            if (i >= 0) {
                g.tabs.splice(i, 1);
                tabState.closed.push(tab.label);
                if (tab.isActive && g.tabs.length) {
                    g.tabs[Math.max(0, i - 1)].isActive = true;
                }
                return true;
            }
        }
        return false;
    },
};

export const workspace = {
    getConfiguration: (section: string) => ({
        get: <T>(key: string, fallback?: T): T | undefined => {
            const full = `${section}.${key}`;
            return (full in fake.config ? fake.config[full] : fallback) as T | undefined;
        },
    }),
};

export const extensions = {
    getExtension: (id: string) => ({ id, isActive: fake.activeExtensions.has(id) }),
};

/** In-memory Memento, like context.workspaceState. */
export class FakeMemento {
    private readonly data = new Map<string, unknown>();
    get<T>(key: string): T | undefined {
        return this.data.get(key) as T | undefined;
    }
    update(key: string, value: unknown): Promise<void> {
        this.data.set(key, value);
        return Promise.resolve();
    }
}

/** Records what the extension does to the terminal environment. */
export class FakeEnvCollection {
    readonly vars = new Map<string, string>();
    description: string | undefined;
    replace(name: string, value: string) {
        this.vars.set(name, value);
    }
    delete(name: string) {
        this.vars.delete(name);
    }
}

export class FakeLog {
    readonly lines: string[] = [];
    warn(s: string) { this.lines.push(`warn ${s}`); }
    error(s: string) { this.lines.push(`error ${s}`); }
    info(s: string) { this.lines.push(`info ${s}`); }
}

export enum StatusBarAlignment { Left = 1, Right = 2 }

export class ThemeColor {
    constructor(readonly id: string) {}
}

export const statusItems: { text: string; tooltip?: string; backgroundColor?: ThemeColor; command?: string }[] = [];
(window as any).createStatusBarItem = () => {
    const item = { text: '', tooltip: undefined as string | undefined, backgroundColor: undefined as ThemeColor | undefined, command: undefined as string | undefined, show() {}, dispose() {} };
    statusItems.push(item);
    return item;
};

export class Uri {
    private constructor(readonly fsPath: string, readonly scheme: string = 'file') {}
    static file(p: string): Uri {
        return new Uri(p);
    }
}

export class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    readonly event = (fn: (e: T) => void) => {
        this.listeners.push(fn);
        return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== fn); } };
    };
    fire(e: T) {
        this.listeners.forEach((l) => l(e));
    }
    dispose() {
        this.listeners = [];
    }
}

/** Terminals a test puts in this stand-in window. */
export interface FakeTerminal { processId: Promise<number | undefined>; show(): void; sendText?(text: string): void; name?: string; cwd?: string; sent?: string[] }
export const terminals: FakeTerminal[] = [];
Object.defineProperty(window, 'terminals', { get: () => terminals });

/** A terminal the extension makes: it records what is typed into it. */
(window as any).createTerminal = (o: { name?: string; cwd?: string }) => {
    const t: FakeTerminal = { name: o.name, cwd: o.cwd, processId: Promise.resolve(undefined), sent: [], show() {}, sendText(text: string) { t.sent!.push(text); } };
    terminals.push(t);
    return t;
};
