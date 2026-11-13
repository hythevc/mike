// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
    getJurisdictionRegistry,
    type JurisdictionRegistry,
} from "@/app/lib/mikeApi";

// The registry is the same for everyone and changes only with a release, so
// one successful read serves every picker and every chip for the rest of the
// session. A failed read is not kept: the next thing to ask tries again.
let cached: JurisdictionRegistry | null = null;
let pending: Promise<JurisdictionRegistry> | null = null;

// Everything on the page that shows the registry hears when it arrives, so
// a read that succeeds for one of them (a "Try again" in a form, say) also
// gives the others their names.
const listeners = new Set<() => void>();

function setCached(registry: JurisdictionRegistry | null) {
    cached = registry;
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const getCached = () => cached;
// Nothing is read while a page is rendered on the server.
const getServerSnapshot = () => null;

function loadRegistry(): Promise<JurisdictionRegistry> {
    if (cached) return Promise.resolve(cached);
    if (!pending) {
        pending = getJurisdictionRegistry()
            .then((registry) => {
                setCached(registry);
                return registry;
            })
            .finally(() => {
                pending = null;
            });
    }
    return pending;
}

/** For tests: forget the registry that was read. */
export function clearJurisdictionRegistryCache() {
    pending = null;
    setCached(null);
}

export type JurisdictionRegistryState = {
    /** Null until it has loaded. */
    registry: JurisdictionRegistry | null;
    /** What went wrong with the last read, or null. */
    error: unknown;
    /** Read it again after a failure. */
    retry: () => void;
};

/**
 * The jurisdiction registry: the jurisdictions and working languages the
 * pickers offer, and the names behind the codes a matter stores.
 */
export function useJurisdictionRegistry(): JurisdictionRegistryState {
    const registry = useSyncExternalStore(
        subscribe,
        getCached,
        getServerSnapshot,
    );
    const [error, setError] = useState<unknown>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (registry) return;
        let cancelled = false;
        loadRegistry().catch((failure: unknown) => {
            if (!cancelled) setError(failure ?? new Error("load failed"));
        });
        return () => {
            cancelled = true;
        };
    }, [registry, attempt]);

    const retry = useCallback(() => {
        setError(null);
        setAttempt((count) => count + 1);
    }, []);

    // A failure stops mattering the moment the registry is there, whoever
    // read it.
    return { registry, error: registry ? null : error, retry };
}
