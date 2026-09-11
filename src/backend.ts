// StanceLoop portable backend abstraction (Task 5).
//
// Pure TypeScript: zero React/DOM imports so the interfaces can move to
// iOS/Android later. React only renders what these helpers return.
//
// STUB — NO NETWORK CALLS IN THIS BUILD. Auth defaults to guest mode and
// sync is a local merge. Every stub below carries an integration note naming
// the real call that will replace it when the user creates real accounts.
//
// Planned backend: Supabase (Auth + Postgres + RLS). Planned shape:
//   - guest      → supabase.auth.signInAnonymously()
//   - connect    → supabase.auth.signInWithOAuth({ provider }) or magic link
//   - sessions   → supabase.from("sessions").upsert(...) / .select() (RLS: own rows only)
//   - challenges → supabase.from("challenges").select() scoped to invite ids
//                  only — invites stay link-based, there is NEVER a public
//                  listing (private-by-default).

import type { Session } from "./types";
import { LEGACY_VERSION } from "./rules";

/** Guest by default; authenticated only after the real backend lands. */
export type AuthKind = "guest" | "authenticated";

export type AuthUser = {
  id: string;
  kind: AuthKind;
  displayName: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; code: "not_connected"; message: string };

export type SyncConflict = {
  id: string;
  winner: "local" | "remote";
  reason: string;
};

export type SyncableRecord = {
  id: string;
  updatedAt: number;
  ruleVersion: string;
};

export interface AuthProvider {
  getUser(): AuthUser;
  signInGuest(displayName?: string): AuthResult;
  connectAccount(): AuthResult;
  signOut(): AuthUser;
}

export interface SyncProvider {
  syncSessions(local: Session[], remote: Session[]): { merged: Session[]; conflicts: SyncConflict[] };
  fetchChallenges(): { ok: false; code: "not_connected"; message: string };
}

/**
 * Conflict rule (deterministic, no data loss of the newest): per record id
 * the higher updatedAt wins; an updatedAt tie breaks toward the higher
 * ruleVersion (lexical); a full tie keeps local (this device is the source
 * of truth for its own sets) and still records the conflict. Union by id —
 * records present on only one side are always kept.
 */
export function mergeSyncableRecords<T extends SyncableRecord>(
  local: readonly T[],
  remote: readonly T[],
): { merged: T[]; conflicts: SyncConflict[] } {
  const byId = new Map<string, { local?: T; remote?: T }>();
  for (const record of local) {
    const entry = byId.get(record.id) ?? {};
    entry.local = record;
    byId.set(record.id, entry);
  }
  for (const record of remote) {
    const entry = byId.get(record.id) ?? {};
    entry.remote = record;
    byId.set(record.id, entry);
  }
  const merged: T[] = [];
  const conflicts: SyncConflict[] = [];
  for (const [id, entry] of byId) {
    if (entry.local && !entry.remote) {
      merged.push(entry.local);
      continue;
    }
    if (entry.remote && !entry.local) {
      merged.push(entry.remote);
      continue;
    }
    const left = entry.local!;
    const right = entry.remote!;
    if (left.updatedAt !== right.updatedAt) {
      const winner = left.updatedAt > right.updatedAt ? "local" : "remote";
      merged.push(winner === "local" ? left : right);
      conflicts.push({
        id,
        winner,
        reason: `Newest wins: ${winner} copy is newer (updated ${Math.max(left.updatedAt, right.updatedAt)} vs ${Math.min(left.updatedAt, right.updatedAt)}).`,
      });
      continue;
    }
    if (left.ruleVersion !== right.ruleVersion) {
      // A stamped rule version beats an unstamped (legacy) one; two stamped
      // versions break lexically so the outcome stays deterministic.
      const leftLegacy = left.ruleVersion === LEGACY_VERSION;
      const rightLegacy = right.ruleVersion === LEGACY_VERSION;
      const winner =
        leftLegacy !== rightLegacy ? (leftLegacy ? "remote" : "local") : left.ruleVersion > right.ruleVersion ? "local" : "remote";
      merged.push(winner === "local" ? left : right);
      conflicts.push({
        id,
        winner,
        reason: `Same timestamp — newer rule version wins (${winner}: ${winner === "local" ? left.ruleVersion : right.ruleVersion}).`,
      });
      continue;
    }
    merged.push(left);
    conflicts.push({ id, winner: "local", reason: "Identical timestamps and versions — kept this device's copy." });
  }
  merged.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { merged, conflicts };
}

/**
 * Map a saved session onto the syncable shape. Sessions are immutable once
 * saved, so createdAt doubles as updatedAt until the backend adds its own
 * revision stamps.
 */
export function sessionToSyncable(session: Session): SyncableRecord & { session: Session } {
  return { id: session.id, updatedAt: session.createdAt, ruleVersion: session.ruleVersion, session };
}

/** STUB local auth: guest mode default, everything in memory, no network. */
export function createLocalAuth(options?: { userId?: string; displayName?: string }): AuthProvider {
  let counter = 0;
  let user: AuthUser = {
    id: options?.userId ?? "guest-local",
    kind: "guest",
    displayName: options?.displayName ?? "Athlete",
  };
  return {
    getUser: () => ({ ...user }),
    signInGuest: (displayName?: string) => {
      // STUB integration note: replace with supabase.auth.signInAnonymously()
      // and persist the returned session; displayName maps to profiles.
      counter++;
      user = {
        id: options?.userId && counter === 1 ? options.userId : `guest-local-${counter}`,
        kind: "guest",
        displayName: displayName ?? user.displayName,
      };
      return { ok: true, user: { ...user } };
    },
    connectAccount: () => {
      // STUB integration note: replace with supabase.auth.signInWithOAuth()
      // (or magic link). Deliberately no network here — the UI must present
      // this as coming soon, and guest mode must keep working offline.
      return {
        ok: false,
        code: "not_connected",
        message: "Accounts are coming soon — this build has no backend yet, so guest mode continues offline.",
      };
    },
    signOut: () => {
      // STUB integration note: replace with supabase.auth.signOut().
      counter++;
      user = { id: `guest-local-${counter}`, kind: "guest", displayName: "Athlete" };
      return { ...user };
    },
  };
}

/** STUB local sync: local merge with the deterministic conflict rule, no network. */
export function createLocalSync(): SyncProvider {
  return {
    syncSessions: (local, remote) => {
      // STUB integration note: replace with
      //   supabase.from("sessions").upsert(local) then .select() for remote,
      // with RLS limiting rows to the signed-in user. The merge below stays
      // as the client-side conflict rule (newest-wins + version tie-break).
      const left = local.map(sessionToSyncable);
      const right = remote.map(sessionToSyncable);
      const { merged, conflicts } = mergeSyncableRecords(left, right);
      return { merged: merged.map((entry) => entry.session), conflicts };
    },
    fetchChallenges: () => {
      // STUB integration note: replace with supabase.from("challenges")
      // .select() scoped to known invite ids. Private-by-default: there is
      // no endpoint that lists other people's challenges.
      return {
        ok: false,
        code: "not_connected",
        message: "Duel invites are link-based in this build — nothing is listed publicly.",
      };
    },
  };
}
