// Turns the registry, open windows and usage cache into the list the UI shows.
import { MAIN_KEY, type Account, type AccountView, type Identity, type UsageEntry, type WindowBeat } from './types';

export function buildSnapshot(i: {
    accounts: Account[];
    mainIdentity?: Identity;
    liveWindows: WindowBeat[];
    usage: Record<string, UsageEntry>;
    thisWindowKey: string;
}): AccountView[] {
    const usedBy = (key: string) => [...new Set(i.liveWindows.filter((w) => w.accountKey === key).map((w) => w.workspaceName))];

    const views: AccountView[] = i.accounts.map((a) => {
        const v: AccountView = {
            key: a.id,
            label: a.alias ?? a.email ?? 'New account (not signed in)',
            isMain: false,
            isThisWindow: i.thisWindowKey === a.id,
            signedIn: !!a.email,
            usedBy: usedBy(a.id),
        };
        if (a.email) {
            v.email = a.email;
        }
        if (a.orgName) {
            v.orgName = a.orgName;
        }
        if (i.usage[a.id]) {
            v.entry = i.usage[a.id];
        }
        return v;
    });

    const main: AccountView = {
        key: MAIN_KEY,
        label: 'Main login',
        isMain: true,
        isThisWindow: i.thisWindowKey === MAIN_KEY,
        signedIn: !!i.mainIdentity,
        usedBy: usedBy(MAIN_KEY),
    };
    if (i.mainIdentity?.email) {
        main.email = i.mainIdentity.email;
    }
    if (i.mainIdentity?.orgName) {
        main.orgName = i.mainIdentity.orgName;
    }
    if (i.usage[MAIN_KEY]) {
        main.entry = i.usage[MAIN_KEY];
    }
    views.push(main);
    return views;
}
