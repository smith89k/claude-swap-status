// A small stand-in for the `vscode` module so the extension's glue code can be
// unit-tested under plain Node. Tests drive it through `fake`.
export const fake = {
    messages: [] as { level: 'info' | 'warning' | 'error'; text: string; items: string[] }[],
    commands: [] as { id: string; args: unknown[] }[],
    config: {} as Record<string, unknown>,
    activeExtensions: new Set<string>(),
    reply: undefined as string | undefined,
    reset() {
        this.messages.length = 0;
        this.commands.length = 0;
        this.config = {};
        this.activeExtensions.clear();
        this.reply = undefined;
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
    executeCommand: (id: string, ...args: unknown[]) => {
        fake.commands.push({ id, args });
        return Promise.resolve(undefined);
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
