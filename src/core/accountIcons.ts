// The icons an added account can wear (the main account always wears the crown).
// Each one has a drawing for the panel and the editor's built-in icon of the same
// thing for the status bar and pick lists.

export interface AccountIcon {
    id: string;
    label: string;
    /** The editor's built-in icon name, used as $(name). */
    codicon: string;
    /** A 16x16 drawing for the panel, in the same style as the crown. */
    svg: string;
}

const svg = (d: string, evenOdd = false) =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor"${evenOdd ? ' fill-rule="evenodd"' : ''} d="${d}"/></svg>`;

export const ACCOUNT_ICONS: readonly AccountIcon[] = [
    { id: 'star', label: 'Star', codicon: 'star-full', svg: svg('M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 12l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z') },
    { id: 'heart', label: 'Heart', codicon: 'heart', svg: svg('M8 14.2 2.3 8.6a3.6 3.6 0 0 1 5.1-5.1l.6.6.6-.6a3.6 3.6 0 0 1 5.1 5.1z') },
    { id: 'rocket', label: 'Rocket', codicon: 'rocket', svg: svg('M14.6 1.4c.2 3.3-1.2 6-4 8.2l.4 3.1-2.4 2-1-2.9-3.4-3.4-2.9-1 2-2.4 3.1.4c2.2-2.8 4.9-4.2 8.2-4zM10.7 4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM3.4 10.6l2 2c-.6 1-1.8 1.7-3.6 2 .3-1.8 1-3 1.6-4z') },
    { id: 'flame', label: 'Flame', codicon: 'flame', svg: svg('M8.2 1c.6 2.5 4.6 4.3 4.6 8.4a4.8 4.8 0 0 1-9.6 0c0-1.9 1-3.2 2-4.1-.1 1.5.6 2.5 1.6 2.8C6.6 5.8 7.4 3.2 8.2 1z') },
    { id: 'bolt', label: 'Lightning bolt', codicon: 'zap', svg: svg('M9.6 1 3 9h4.2l-1 6L13 7H8.7z') },
    { id: 'briefcase', label: 'Briefcase', codicon: 'briefcase', svg: svg('M5.5 2.5h5v2H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h3.5zm1 1v1h3v-1zM1 8.5h14v1H1z', true) },
    { id: 'home', label: 'House', codicon: 'home', svg: svg('M8 1.5 1 7.6h2V14h3.5v-4h3v4H13V7.6h2z') },
    { id: 'coffee', label: 'Coffee cup', codicon: 'coffee', svg: svg('M2 5.5h9V10a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM11 6.5h1.3a2.1 2.1 0 0 1 0 4.2H11V9.5h1.3a.9.9 0 0 0 0-1.8H11zM4.5 1h1v3h-1zM7 1h1v3H7z') },
    { id: 'flask', label: 'Flask', codicon: 'beaker', svg: svg('M5.5 1.5h5v1h-1v4l4.3 6.6a1 1 0 0 1-.8 1.4H3a1 1 0 0 1-.8-1.4l4.3-6.6v-4h-1z') },
    { id: 'gem', label: 'Gem', codicon: 'ruby', svg: svg('M4 2h8l3 4-7 8.5L1 6z') },
];

/** What goes before an account's name in a pick list: the crown, its icon, or nothing. */
export function iconPrefix(isMain: boolean, id: string | undefined): string {
    if (isMain) {
        return '👑 ';
    }
    const icon = accountIcon(id);
    return icon ? `$(${icon.codicon}) ` : '';
}

/** The icon with this id, or undefined for none or an id this version doesn't know. */
export function accountIcon(id: string | undefined): AccountIcon | undefined {
    return id ? ACCOUNT_ICONS.find((i) => i.id === id) : undefined;
}
