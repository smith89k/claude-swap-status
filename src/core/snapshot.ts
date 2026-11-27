// Turns the registry, open windows and usage cache into the list the UI shows.
// Accounts start as "Claude <number>" (the main account is Claude 1); a rename replaces the whole name.
import { accountIcon } from './accountIcons';
import { effectiveNumbers } from './registry';
import { MAIN_KEY, type Account, type AccountView, type Identity, type UsageEntry, type WindowBeat } from './types';

function nameFor(number: number, alias: string | undefined): string {
    return alias || `Claude ${number}`;
}

export function buildSnapshot(i: {
    accounts: Account[];
    mainIdentity?: Identity;
    mainAlias?: string;
    liveWindows: WindowBeat[];
    usage: Record<string, UsageEntry>;
    thisWindowKey: string;
}): AccountView[] {
    const windowsFor = (key: string) => i.liveWindows.filter((w) => w.accountKey === key);
    const usedBy = (key: string) => [...new Set(windowsFor(key).map((w) => w.workspaceName))];
    const numbers = effectiveNumbers(i.accounts);

    const views: AccountView[] = i.accounts.map((a) => {
        const number = numbers.get(a.id)!;
        const v: AccountView = {
            key: a.id,
            number,
            label: nameFor(number, a.alias),
            isMain: false,
            isThisWindow: i.thisWindowKey === a.id,
            signedIn: !!a.email,
            usedBy: usedBy(a.id),
            openWindows: windowsFor(a.id).length,
        };
        if (a.email) {
            v.email = a.email;
        }
        if (a.orgName) {
            v.orgName = a.orgName;
        }
        if (accountIcon(a.icon)) {
            v.icon = a.icon;
        }
        if (i.usage[a.id]) {
            v.entry = i.usage[a.id];
        }
        return v;
    });

    const main: AccountView = {
        key: MAIN_KEY,
        number: 1,
        label: nameFor(1, i.mainAlias),
        isMain: true,
        isThisWindow: i.thisWindowKey === MAIN_KEY,
        signedIn: !!i.mainIdentity,
        usedBy: usedBy(MAIN_KEY),
        openWindows: windowsFor(MAIN_KEY).length,
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
