# Team Spaces & Per-Space Permissions — Architecture & Execution Plan

Status: **proposed** · Branch: `claude/notes-team-spaces-permissions-xyhgkh` · Last updated: 2026-07-11

This plan reorganizes notes Notion/Granola-style: every user gets a **Private space**; teams get **Team spaces** that contain folders and notes; access to each team space is **membership-gated and enforced server-side**. It is grounded in a full audit of the current branch, `origin/main`, and the sync/auth trust boundary (file references throughout).

---

## 0. TL;DR

- We are **not starting from scratch.** `origin/main` already ships a dormant, flag-gated workspaces scaffold — including a complete `TeamsService` (team CRUD + membership under `/api/workspaces/{id}/teams`, `/api/teams/{id}/members`) and a `WorkspaceTeamsTab`. This branch un-gated workspaces/sharing v1 and (deliberately) deleted the Teams UI because teams had no content. **Team spaces = resurrect Teams and give them content.**
- The genuinely missing pieces: a **space dimension on notes/folders** (local schema + cloud payloads), **space-scoped list/sync** with server-side enforcement, a **revocation → local purge** pipeline, and the **sidebar tree UI** (Private / Team spaces).
- Six phases, each independently shippable. Phases 1–2 (local model + sidebar) need no backend changes. Phases 3–4 (scoped sync + membership UX) need the backend contract in §6.
- Git strategy: **merge `origin/main` into this branch — do not rebase** (upstream history was rewritten; 37 of this branch's 50 commits are stale duplicates that would replay as a conflict marathon).

---

## 1. Product target & UX principles

Target sidebar (matches the approved mock):

```
  ✏️  New note
  🔍  Search notes
  ✨  Actions

  PRIVATE SPACES
  🔒 Personal                       2

  TEAM SPACES                        +
  ▾ Sales team
     ▾ 📁 David's sales calls
          📄 03/11/2026
          📄 03/11/2026
     📄 (root notes…)
  ▸ Marketing team
```

Principles (in priority order):

1. **Plain and simple.** One tree, two labeled sections. No workspace switcher in the notes UI; everything you can access is visible in one place. Spaces you can't access simply don't exist to you.
2. **Access is respected, always.** The server is the only authority on who sees what. The client renders only what the server returns and purges local copies when access is lost. Client-side checks are UX affordances, never security.
3. **Smooth = fast + honest.** Local-first optimistic writes for everything SQLite-backed; visible pending states for server round-trips; every failure has a toast; every audience-changing action has a confirm; every move/delete has an undo. Nothing dead-ends (carried over from the v1 "quiet collaboration" philosophy, commit `4eced70`).
4. **Boring motion.** 120–200 ms ease-out, one property at a time, `prefers-reduced-motion` honored. No springs, no bounces.

Non-goals for v1 (explicitly deferred): nested folders (folder-in-folder), read-only Viewer role, per-folder permission overrides, realtime co-editing/CRDT, unseen-changes badges, E2EE for team content, multiple private spaces.

---

## 2. Where we are today (audit summary)

### What exists and is reusable

| Capability | State | Where |
| --- | --- | --- |
| Workspace = org container (name, slug, seats, Stripe, roles `owner\|admin\|member`) | ✅ live on this branch | `WorkspacesService.ts`, `workspaceStore.ts`, `settings/WorkspaceSection.tsx` |
| Workspace invitations w/ deep link `openwhispr://…/invitations/{token}`, accept/revoke/resend, wrong-account handling | ✅ live | `InvitationsService.ts`, `AcceptInvitationModal.tsx`, `main.js:505-559` |
| `WorkspaceInvitation.team_ids: string[]` | ✅ typed, never populated | `src/types/electron.ts` |
| **Teams CRUD + membership service and settings tab** | ⚠️ exists on `origin/main`, deleted on this branch | `origin/main:src/services/TeamsService.ts`, `origin/main:src/components/settings/WorkspaceTeamsTab.tsx`, `Team`/`TeamMember` types |
| Per-note web sharing (`private\|link\|domain\|invited`, tokens, share viewer at notes.openwhispr.com) | ✅ live | `NoteSharingService.ts`, `ShareNoteDialog.tsx` |
| Notes/folders local CRUD + cloud backup sync (LWW on `updated_at`, `client_*_id`↔`cloud_id`, tombstones, poll: 5 min + focus/online) | ✅ live | `database.js`, `SyncService.ts`, `NotesService.ts`, `FoldersService.ts` |
| Hybrid search: FTS5 + Qdrant w/ RRF; agent tools (`search_notes`, `list_folders`, …) | ✅ live | `database.js:2102`, `ipcHandlers.js:1100`, `src/services/tools/` |
| Workspace API key scopes already name `workspace:notes:*`, `workspace:folders:*` | ✅ server anticipates workspace-scoped content | `WorkspaceDeveloperTab.tsx` |

### What is missing (the actual work)

1. **No space dimension on content.** `notes`/`folders` have no `workspace_id`/`team_id`/`space_id` columns locally or in cloud DTOs. The TS stubs exist (`NoteItem.workspace_id?/team_id?`, `FolderItem.workspace_id?/team_id?` in `src/types/electron.ts`) but nothing backs them.
2. **Folders are flat with a global `UNIQUE(name)`** (`database.js:183`) — two spaces can't both have "Projects" today. Sync's default-folder reconciliation (`SyncService.ts:381,497`) leans on that global uniqueness.
3. **Sync is self-scoped and push-only for sharing.** `pullNotes()` fetches only the caller's own rows; a teammate's note never reaches your app. No realtime.
4. **No revocation semantics.** Sign-out wipes nothing (`SettingsPage.tsx` `handleSignOut`); there is no per-space purge primitive; six local stores hold note content (SQLite rows, FTS5, Qdrant vectors, audio files, speaker/diarization tables, localStorage caches).
5. **No spaces UI.** `PersonalNotesView.tsx` renders a flat folder rail + note list; zero workspace references in `src/components/notes/`.
6. **Search/agent paths are unscoped** — six retrieval paths need a space filter (§9).

### Git state (from the branch↔main audit)

- Merge-base is `2e4558065` (#1090). Branch is "50 ahead / 20 behind" but **~37 of the 50 are stale duplicates**: upstream history was rewritten, so old PRs (#668–#922) exist on both sides under different SHAs. Only **~13 commits are genuine** (workspaces plumbing, sharing UX, flag removal, i18n).
- **Merge, don't rebase.** A rebase replays all 50 commits against a main that already contains 37 of them; with `ipcHandlers.js` +482 and `audioManager.js` diverged on main, the stale commits conflict instead of dropping.
- Conflict budget for the merge: 10× locale `translation.json` (mechanical, highest volume), `ipcHandlers.js` (take main, re-apply ~17 branch lines), `types/electron.ts`, `main.js`, `database.js` (the `is_shared`/`share_token` migration region), `package.json` version. Clean take-main: `PersonalNotesView.tsx`, `noteStore.ts`, `UploadAudioView.tsx`, `ReasoningService.ts`, `settingsStore.ts`.
- The branch deleted `TeamsService.ts`, `Team`/`TeamMember` types, `workspaceStore` teams state, `WorkspaceTeamsTab.tsx`, `WorkspaceSwitcher.tsx`, `src/lib/features.ts`, and the `settingsPage.workspace.teams.*` i18n keys. Teams artifacts must be **restored from `origin/main`** (`git checkout origin/main -- <path>`); the switcher and feature flags stay deleted. Post-merge, grep main-side additions for `WORKSPACES_ENABLED`/`SHARING_ENABLED` imports before finalizing the `features.ts` deletion.

---

## 3. Concept model & vocabulary

```
Workspace (org: billing, seats, roster, invitations)          — exists today
 └── Team space  (= backend "team": name, emoji, members)      — resurrect + extend
      ├── Folders (flat within the space)                      — existing folders, scoped
      │    └── Notes
      └── Notes (space root, no folder)

Private space ("Personal") — exactly one per user, device-local first,
  never shared, syncs via the existing personal cloud backup.
```

Decisions (defaults chosen to keep v1 plain — revisit only if product disagrees):

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Client entity `Space`** with `kind: 'private' \| 'team'`; team spaces map 1:1 to backend **teams**. UI says "space"; API says "team". | Reuses the existing backend contract (`TeamsService`) and the pre-declared `team_id` stubs; the sidebar model falls out directly. |
| D2 | Notes carry a **denormalized `space_id`** in addition to `folder_id`. Invariant: `note.folder_id != NULL ⇒ folder.space_id == note.space_id`. Enforced by doing every move as one transaction that sets both. | Root-level notes (no folder) still need a space; queries stay one-table. |
| D3 | Folders stay **flat within a space** (no `parent_folder_id`) in v1. | Matches the mock (space → folder → notes = 2 levels); nesting is a separate lift (recursive queries, tree DnD edge cases). Schema leaves room to add it later. |
| D4 | **One private space**, auto-created, undeletable, unrenameable ("Personal", lock icon). No "+" on the PRIVATE SPACES header in v1. | User requirement is singular ("everyone gets their own private space"); multiple private spaces add taxonomy for no benefit. |
| D5 | Space roles: **`admin`** (manage members, rename, delete; creator starts as admin) and **`member`** (read/write all content in the space). Workspace `owner`/`admin` implicitly hold admin on every team space in their workspace. | Matches the existing backend member signature (`role: "admin" \| "member"`); implicit org-admin access prevents orphaned spaces. Viewer deferred. |
| D6 | Any member may create/edit/move/delete notes in a space (full-trust team). Moves that **change audience** (into or out of a team space) always confirm + offer undo. | Granola-simple; audit trails and granular roles are v2. |
| D7 | Team-space content syncs whenever you're **signed in and a member** — independent of the personal `cloudBackupEnabled` toggle (same precedent as shared-note sync, `SyncService.canSyncSharedNotes`). Personal space keeps today's gate (signed-in + backup on + subscribed). | A team space that silently didn't sync would violate "access respected"; the backup toggle is a personal-data preference. |
| D8 | Per-note web sharing (link/domain/invited) remains, orthogonal to spaces, for **private-space notes**. For team-space notes v1 hides the web-share menu (the space *is* the audience); revisit after backend defines ACLs for team-note tokens. | Avoids shipping an ACL ambiguity (who may widen a team note's audience?). |
| D9 | Deleting a team space **archives server-side** (30-day recovery, backend-permitting) and purges locally. Deleting the last copy of team content is never a silent client-side cascade. | Team data loss must be recoverable; local folder-delete's hard-delete-children semantics are not acceptable at space scope. |

---

## 4. Permission model

Role matrix (v1):

| Action | Space member | Space admin | Workspace owner/admin | Non-member |
| --- | --- | --- | --- | --- |
| See space exists, read notes | ✅ | ✅ | ✅ (implicit admin) | ❌ (404, not 403 — don't leak existence) |
| Create/edit/move/delete notes & folders in space | ✅ | ✅ | ✅ | ❌ |
| Move note **out** to Personal / another space | ✅ (confirm) | ✅ | ✅ | ❌ |
| Add/remove members, change roles | ❌ | ✅ | ✅ | ❌ |
| Rename space, change emoji | ❌ | ✅ | ✅ | ❌ |
| Delete (archive) space | ❌ | ✅ | ✅ | ❌ |
| Leave space | ✅ | ✅ (if not last admin) | n/a | n/a |
| Create team space | any workspace member | — | ✅ | ❌ |

Enforcement rules:

1. **Server-authoritative.** Every content endpoint validates session → workspace membership → team membership per row. List endpoints return only permitted rows; the client never receives-then-filters.
2. **Existence privacy.** Non-members get `404 team_not_found`, not 403, for direct fetches.
3. **Client checks are cosmetic** (hide buttons, gray drop targets). Every hidden action is also rejected server-side with a typed error code (§6).
4. **Revocation is a first-class event** (§7.4): membership loss ⇒ local purge of that space across all six content stores, even mid-session.
5. **The agent obeys the same boundary** — its tools run through the same scoped queries; no tool may read across spaces the user can't (§9).

---

## 5. Local data model & migration

### 5.1 New table

```sql
CREATE TABLE IF NOT EXISTS spaces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_space_id TEXT,                 -- UUID minted locally (unique index)
  cloud_team_id   TEXT,                 -- backend team id; NULL for private
  workspace_id    TEXT,                 -- backend workspace id; NULL for private
  kind            TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('private','team')),
  name            TEXT NOT NULL,
  emoji           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  my_role         TEXT,                 -- cached 'admin'|'member'; NULL for private
  member_count    INTEGER,              -- cached for UI
  sync_status     TEXT NOT NULL DEFAULT 'pending',
  deleted_at      TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_client_space_id ON spaces(client_space_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_cloud_team_id   ON spaces(cloud_team_id) WHERE cloud_team_id IS NOT NULL;
```

Follows the existing folder sync-column pattern exactly (`client_*_id`, `cloud_id`, `sync_status`, `deleted_at`) so `SyncService` treats it like a sibling of folders.

### 5.2 Column additions & the one table rebuild

- `ALTER TABLE notes ADD COLUMN space_id INTEGER` and `ALTER TABLE folders ADD COLUMN space_id INTEGER` via the existing idempotent-ALTER pattern (`database.js` migration style — try/catch "duplicate column").
- **Folders must be rebuilt** to change `name TEXT NOT NULL UNIQUE` → `UNIQUE(space_id, name)` (SQLite can't drop a column constraint): create `folders_new` with the composite constraint, copy rows, drop old, rename, recreate `idx_folders_client_folder_id`. Folders have no FTS triggers, so the rebuild is contained; do it inside one transaction with `PRAGMA foreign_keys` unchanged (FKs are not enforced in this DB — referential integrity remains app-level, as today).
- Backfill: insert the private space (`kind='private'`, `name='Personal'`), then `UPDATE folders SET space_id = :privateId WHERE space_id IS NULL` and same for notes. Idempotent, versioned by presence checks like every other migration in `initDatabase()`.
- New indexes (also fixes an existing gap): `notes(folder_id)`, `notes(updated_at)`, `notes(space_id, updated_at)`, `folders(space_id, sort_order)`.

### 5.3 Code paths that must learn `space_id`

All identified in the audit — this is the exhaustive thread-through list:

| Path | Change |
| --- | --- |
| `updateNote` allow-list (`database.js:1478-1494`) | add `space_id` (and keep `folder_id`); writes not in the list are silently dropped today |
| `saveNote(...)` (`database.js:1394`) | accept `spaceId`; default-folder resolution ("Meetings"/"Personal") becomes per-space |
| `getNotes`, `getFolderNoteCounts`, `searchNotes` | add space predicate |
| `deleteFolder` (`database.js:1554`) | scope to space; **stop hard-deleting child notes for team spaces** — server owns cascades there (D9) |
| `upsertNoteFromCloud` / `upsertFolderFromCloud` (`database.js:2699,2850`) | add `space_id` (mapped from cloud `team_id`) to the explicit UPSERT column lists |
| Sync push payloads (`SyncService.ts:244-311`) | include `workspace_id`/`team_id` |
| Folder↔cloud maps (`SyncService.ts:1224-1237`) and default-folder reconciliation (`:381,497-511`) | key by `(space, name)` instead of global name; unknown-folder fallback becomes "root of the same space", not "Personal" |
| IPC surface (`ipcHandlers.js` + `preload.js` + `types/electron.ts`) | `db-get-spaces`, `db-create-space`, `db-rename-space`, `db-delete-space`, `db-purge-space`; existing note/folder channels gain space params |
| Qdrant (`vectorIndex.js:33-51,79-90`) | write `{ space_id, client_space_id }` into point payloads on upsert; add filtered search + `deleteBySpace`; one-time background `reindexAll` after migration |
| Markdown mirror (`_asyncMirrorWrite`) | mirror under `<space>/<folder>/` directories |

### 5.4 `purgeSpace(localSpaceId)` — the revocation primitive

One transaction + follow-up async work, covering **every store that holds note content** (from the trust-boundary audit):

1. Collect note ids for the space.
2. Delete `speaker_mappings`, `note_speaker_embeddings` rows for those notes (FKs are not enforced — delete explicitly), then `notes` rows (FTS5 triggers clean `notes_fts`), then `folders`, then the `spaces` row.
3. Async: Qdrant delete-by-filter on `space_id`; delete audio files referenced by those notes (`audioStorage`); drop `shareByCloudId` cache entries; clear per-space sync cursors.
4. Emit `space-purged` broadcast so open windows drop UI state (editor showing a purged note swaps to the safe empty state).

Unit-test purge completeness by seeding all six stores and asserting zero residue.

---

## 6. Cloud API contract

### Already exists (verified in client code — reuse as-is)

```
GET    /api/workspaces                                   list my workspaces (+role)
GET    /api/workspaces/{id}/members                      roster
POST   /api/workspaces/{id}/invitations {email, role}    invite (accepts team_ids — typed, unused)
GET    /api/invitations/{token}   ·  POST …/accept       public preview / accept
GET    /api/workspaces/{id}/teams                        list teams          ┐
POST   /api/workspaces/{id}/teams {name, description}    create team         │ from main's
PATCH  /api/teams/{id} · DELETE /api/teams/{id}          rename / delete     │ TeamsService
GET/POST/DELETE /api/teams/{id}/members                  membership (role: admin|member) ┘
POST/PATCH/DELETE/GET /api/notes/*  and  /api/folders/*  personal-scope content sync
```

### Needed from the backend (the ask — confirm with the API team)

| # | Endpoint / change | Purpose |
| --- | --- | --- |
| B1 | `notes`/`folders` rows gain `workspace_id`, `team_id` (nullable) on create/update/list/search | space dimension |
| B2 | `GET /api/notes/list?scope=all&since=` (and folders): return every row the caller may access — own + member-team rows, each stamped with `team_id`. **Opt-in `scope=all` param** so pre-spaces clients keep today's own-rows-only behavior and never import teammates' notes into a flat personal list. | scoped delta sync, one cursor |
| B3 | Membership check on every content write; typed errors: `team_not_found` (404, non-member reads), `team_access_revoked` (403, writes after removal), `team_archived` (410) | enforcement + client UX |
| B4 | `GET /api/me/teams` (or reuse per-workspace teams list): teams + `my_role` + `member_count` + `updated_at` — the fast poll for membership/rename changes | sidebar freshness + revocation detection |
| B5 | Move semantics: `PATCH /api/notes/update` accepts `team_id` transitions (personal→team, team→team, team→personal) with membership checks on **both** ends | cross-space moves |
| B6 | Team delete = archive with recovery window; content list excludes archived | D9 |
| B7 | Invitation `team_ids` honored: accepting grants those team memberships; response includes granted teams | invite-to-space flow |
| B8 | (later, phase 6+) cheap change feed — `GET /api/changes?since=` or SSE — to tighten team freshness beyond the 5-min poll | latency polish |

Server-side migration: backfill existing cloud notes/folders with `team_id = NULL` (personal). No client data movement required.

---

## 7. Sync architecture changes

### 7.1 Pull (scoped delta)

- `syncAll()` gains a **spaces pass before folders**: pull `GET /api/me/teams` → upsert local `spaces` rows (name/emoji/role/member_count), create newly-joined spaces, and mark vanished team ids for purge (§7.4).
- Notes/folders pulls switch to `scope=all`; each row's `team_id` maps → local `space_id` via the spaces table (exactly like today's cloud-folder→local-folder map). Unknown `team_id` (race: content before membership row) ⇒ trigger a spaces re-pull once, else park the row (do not misfile into Personal — replaces today's silent "fallback to Personal" for unknown folders, which becomes "root of the same space").
- Cursors: keep the existing global `lastSyncedAt.*` cursors (server filters by access; one cursor stays correct because revocation is handled by purge, not by cursor rewind). First join of a space naturally arrives as > cursor rows? **No — it arrives as old rows.** So: on detecting a newly-joined space, run a one-time backfill pull for that team (`?team_id=&before=` paging) while the UI shows skeleton rows (§8.6).
- Poll triggers unchanged (5-min interval, focus, online, storage) **plus**: refresh on window focus while a team-space note is open, and immediately after any push that touched a team space.

### 7.2 Push

- Push payloads include `workspace_id`/`team_id` (from the note's space). Offline queue is unchanged (`sync_status='pending'` rows).
- `403 team_access_revoked` on push ⇒ don't retry-loop: move the affected local note to Personal, mark `sync_status='pending'` (it becomes a personal note), toast: *"You no longer have access to Sales team — 'Q3 pipeline' was moved to your Personal space."* This is the only path where the client "keeps" team content: **only for notes authored/edited locally that never reached the server** — everything else purges.
- Shared-note push gate precedent applies: team content pushes when signed-in + member, regardless of `cloudBackupEnabled` (D7).

### 7.3 Conflicts (multi-writer reality check)

- v1 keeps **LWW on `updated_at`** — acceptable for the meeting-notes shape (mostly single-author notes) but it can drop concurrent edits. Mitigations now:
  - Pull never overwrites a **dirty** local note (`sync_status='pending'` + open in editor); instead the editor shows a passive banner: *"A newer version of this note exists — Refresh · Keep editing."* Refresh applies the remote row; Keep editing lets the next push win LWW.
  - Editor shows *"Edited by {name} · {time}"* when the last writer isn't you (requires `updated_by` on note rows — add to B1).
- Roadmap note (v2): per-field merge (title vs content vs folder) → server revision counters → CRDT only if real co-editing demand appears. Do not build this now.

### 7.4 Revocation & sign-out

- **Revocation:** spaces pass diffs local team spaces vs server list → for each lost space: `purgeSpace()` (§5.4) + sidebar node fades out + one toast. If the active note belonged there, the editor swaps to a neutral "This note is no longer available" state — no dead-end, no stack traces.
- **Sign-out / account switch:** purge **all team spaces** (they are other people's data; today sign-out wipes nothing — audited gap). Personal local notes keep today's device-local behavior. Add the same purge to the existing account-switch path in `AcceptInvitationModal` (stash-token → signOut flow).

---

## 8. UX specification — sidebar, flows, micro-interactions

The centerpiece. Everything here uses existing primitives (Radix menus, shadcn dialogs, the current hover/kebab/inline-rename patterns in `PersonalNotesView.tsx`) so the app stays coherent.

### 8.1 Information architecture

- The left rail of the notes view becomes a single **tree** (`role="tree"`): quick actions on top (unchanged), then `PRIVATE SPACES`, then `TEAM SPACES`.
- **Selection model:** clicking a note opens it. Clicking a space/folder row toggles expansion *and* sets it as the **active context** (used by "New note" targeting and the note-list pane). Chevron click toggles expansion only.
- The right pane is unchanged (editor / empty states). The current middle "notes list of active folder" merges into the tree (notes render as tree leaves) — this is the structural change the mock shows.
- TEAM SPACES section renders only when signed in **and** the capability probe succeeds (`GET /api/me/teams` 200; a 404 hides the section entirely — safe rollout without local feature flags). Signed-out or no workspace: section hidden; discovery lives in Settings → Workspace (existing) and a one-time dismissible hint card.

### 8.2 Row anatomy (metrics)

| Row | Height | Indent | Icon | Trailing |
| --- | --- | --- | --- | --- |
| Section header (`PRIVATE SPACES`) | 24px, 11px uppercase tracking-wide muted | 0 | — | `+` (TEAM SPACES only), fades in on section hover |
| Space | 30px | 0 | 🔒 lock (private) / emoji or `Users` (team), 16px | note count → kebab on hover; chevron 12px |
| Folder | 28px | 14px | `Folder` 16px | count → kebab on hover; chevron |
| Note | 28px | 28px (folder child) / 14px (space root) | `FileText` 14px | relative time, `Share2` if web-shared (existing) |

Hit targets ≥ 24px everywhere; row hover = `accent/50` background, active = primary tint (existing tokens). Truncate with tooltip on overflow. No layout shift on hover (count and kebab occupy the same slot — existing pattern).

### 8.3 Motion (the "boring motion" spec)

| Interaction | Spec |
| --- | --- |
| Expand/collapse | height auto-animate 160ms ease-out + children opacity 80ms; chevron rotates 90° in 150ms; `prefers-reduced-motion` ⇒ instant |
| Space appears (joined) / disappears (revoked) | 200ms height+opacity; revoked pairs with toast |
| Drop success | keep the existing emerald check `scale-in 200ms`, 800ms hold (`useNoteDragAndDrop.ts`) |
| Inline create/rename | input replaces label in place, autofocus + select-all; Enter commit, Esc cancel, blur commits (existing) |
| Pending server op | button spinner only after a 300ms delay (no flash on fast ops); row-level ops show a subtle right-aligned spinner in the trailing slot |
| Undo toast | 8s, action button, one at a time, newest wins |

Performance bar: 60fps expand/collapse with 500 notes in a space (virtualize note leaves with the existing list virtualization approach if profiling demands; folders/spaces are few and never virtualized).

### 8.4 Drag & drop matrix

Extends `useNoteDragAndDrop.ts` (drag ghost, enter/leave counter, MIME `application/x-note-id` all reused):

| Drag → Drop target | Behavior |
| --- | --- |
| Note → folder, same space | instant move (today's behavior) |
| Note → space row / space root | instant move to space root (same space) |
| Note → anything in a **different team space** | drop allowed; **confirm dialog** before commit: *"Move to Sales team? Everyone in Sales team will be able to view and edit this note."* Confirm ⇒ move + undo toast |
| Team note → Personal | confirm: *"Move to Personal? Members of Sales team will lose access to this note."* + undo toast |
| During drag, hover a collapsed space/folder 500ms | auto-expands |
| Invalid target (e.g. the note's current folder) | no ring, `not-allowed` cursor (existing) |
| Folder → other space | v1 via context menu "Move folder to…" (with the same audience confirm, moves children); folder *dragging* deferred |

Undo restores previous `space_id`+`folder_id` in one transaction and re-pushes. Undo of a cross-space move is itself a cross-space move — but silent (no confirm on undo).

### 8.5 Menus & inline actions

- **Space kebab (team):** Members… · Rename · Change emoji · Move folder here ▸ (v1 optional) · Copy space link (deep link, later) · Leave space · Delete space (danger, admin-only, type-name confirm).
- **Space kebab (Personal):** none (lock tooltip: "Only you can see your Personal space").
- **Folder kebab:** unchanged (Show in file manager · Rename · Delete) + "Move to space…" submenu (spaces list w/ search, mirrors the existing move-to-folder submenu in `NoteListItem.tsx`).
- **Note kebab:** unchanged + "Move to" submenu now two-level: spaces → folders (search across both, reusing the existing >5-items search-input pattern).
- **`+` on TEAM SPACES header:** opens Create-space dialog: name (autofocus), emoji picker (optional), "Add members" multi-combobox of workspace roster (deferrable — skippable step), Create. If the user has no workspace yet: the same dialog is preceded by the existing `CreateWorkspaceDialog` (chained, one flow, no dead-end).
- **"New note"** (quick action + per-container `+`): creates in the **active context** (selected space/folder), title focused; the existing new-note dialog's folder picker becomes a space+folder picker defaulting to the active context.

### 8.6 States

| State | Treatment |
| --- | --- |
| First sync of a newly joined space | 3 shimmer skeleton rows under the space node; never block the rest of the UI |
| Empty team space | *"No notes yet. Notes here are visible to everyone in {space}."* + `Invite teammates` (admins) / `New note` |
| Empty folder | existing hand-drawn empty state |
| Offline | tree fully interactive (local-first); team spaces show a muted cloud-off glyph in the section header with tooltip *"Changes sync when you're back online"* |
| Push rejected (revoked) | note relocates to Personal + toast (§7.2) |
| Space revoked | node fades out + toast *"You no longer have access to {space}"*; open note swaps to neutral empty state |
| Error on any server op | destructive toast with message + Retry where idempotent; never a dead-end (v1 philosophy) |

### 8.7 Members & permissions surfaces

- **Members dialog** (space kebab → Members…): roster with avatars/names/emails (reuse `WorkspaceMembersTab` list patterns), role select per row (Admin/Member), remove (confirm), Leave space row pinned at bottom, "Add people" combobox: workspace members first; emails not yet in the workspace fall through to the existing workspace-invite flow with `team_ids=[this space]` pre-attached — one continuous flow, seat-limit errors reuse the existing `seat_limit_reached` UX.
- **Accept-invitation modal** gains a line when `team_ids` present: *"You'll join: 💼 Sales team, 📣 Marketing team."* On accept: workspaces refresh + spaces pass + skeleton backfill (§7.1) — the new spaces visibly "arrive" in the sidebar.
- **Editor header** for team notes: clickable breadcrumb `Sales team / David's sales calls`, and an audience pill `👥 Sales team · 5` opening the Members dialog. Private notes show nothing new (plain stays plain). "Edited by {name} · 2m" appears only when the last writer isn't you.

### 8.8 Keyboard & accessibility

- WAI-ARIA tree: `role="tree"/"treeitem"`, `aria-expanded`, roving tabindex. `↑/↓` traverse visible rows, `→` expand / first child, `←` collapse / parent, `Enter` open note or toggle container, `F2` rename, `Delete` delete (confirm), `Cmd/Ctrl+N` new note in context.
- CommandSearch (`Cmd/Ctrl+K`): spaces and folders become jump targets; note results grouped with a space breadcrumb subtitle.
- Focus visible everywhere; lock/shared icons get `aria-label`s; toasts are `aria-live=polite`; confirms trap focus (Radix default).

### 8.9 "Feels smooth" definition of done

- [ ] Any local action reflects in the tree in <100ms (optimistic; SQLite write-through).
- [ ] Zero layout shift on hover/expand; 60fps expand with 500 notes.
- [ ] Every audience-changing action confirms; every move/delete offers undo; every failure toasts with a next step.
- [ ] Every pending server op is visible (delayed spinner) and abandonable.
- [ ] Kill the network: everything local still works; team edits queue and badge as pending.
- [ ] Kill Qdrant: search falls back to FTS5 (existing chain) with space scoping intact.

---

## 9. Search, agent & AI scoping

Six retrieval paths gain a space filter (defense-in-depth even though the local DB only ever contains permitted rows — scoping also powers "search this space" UX and keeps purge races harmless):

1. `DatabaseManager.getNotes` — space predicate param.
2. `searchNotes` FTS5 — join back to `notes` for the `space_id` predicate (`WHERE notes_fts MATCH ? AND n.space_id IN (…)`).
3. `vectorIndex.search` — Qdrant payload filter on `space_id` (payloads added in §5.3).
4. `db-semantic-search-notes` RRF handler — thread the filter into both legs.
5. Agent tools — `search_notes`, `list_folders`, `create_note`, `get_note`, `update_note` gain space awareness: default scope = all accessible; explicit scope when the user says "in Sales team"; tool results label the space so the agent cites it.
6. Cloud search `POST /api/notes/search` — server enforces membership; request gains optional `team_id` filter (B1).

Search UI: results show a space breadcrumb; a lightweight scope chip ("All spaces ▾") defaults to All.

---

## 10. Security & privacy invariants (review checklist)

1. Server is the sole authority for read/write on team content; client filtering is UX only.
2. Non-membership reads return 404 (existence privacy).
3. `scope=all` is opt-in so legacy clients never ingest team rows into personal contexts.
4. Losing membership purges **all six** local stores (SQLite rows incl. speaker tables, FTS5, Qdrant, audio files, localStorage caches, in-memory stores) — tested by residue assertion.
5. Sign-out purges all team spaces (personal notes keep device-local semantics).
6. The only surviving team data after revocation: locally-authored rows that never reached the server — relocated to Personal, surfaced with a toast (never silent).
7. Agent/LLM tool calls cannot cross the boundary (same scoped queries), and cloud search is server-enforced.
8. Share tokens stay server-minted; team-space notes expose no web-share menu in v1 (D8).
9. No team content or tokens in debug logs (`debugLogger` audit for new code paths).
10. Deep links (`openwhispr://…`) validate against server state on arrival; a stale space link lands on a friendly "not available" state.

---

## 11. i18n

- New namespaces: `notes.spaces.*` (tree, sections, confirms, toasts, empty states), `notes.spaces.members.*` (dialog), plus restored `settingsPage.workspace.teams.*`.
- Every string ships in **all 10 locales** (`en, de, es, fr, it, ja, pt, ru, zh-CN, zh-TW`) in the same PR that introduces it (repo rule). Interpolations for names/counts (`{{space}}`, `{{count}}`).
- Confirm-dialog copy is the product voice: audience change stated plainly, no jargon ("Everyone in Sales team will be able to view and edit this note.").

---

## 12. Execution plan (phases = PR-sized, each shippable)

**Phase 0 — Land the runway (no features).**
Merge `origin/main` into the branch (strategy + conflict budget in §2); restore Teams artifacts from main (`TeamsService.ts`, `Team`/`TeamMember` types, `workspaceStore` teams state, teams i18n keys; keep `WorkspaceTeamsTab` as reference or park it); reconcile `features.ts` deletion; green build + `node --test` pass.
*Accept:* app runs, workspaces/sharing v1 behaves exactly as before the merge.

**Phase 1 — Local space foundations (invisible).**
§5 in full: `spaces` table, `space_id` columns, folders rebuild (per-space uniqueness), Personal backfill, indexes, `purgeSpace`, Qdrant payloads + background reindex, IPC surface, allow-list/UPSERT thread-through. No visible UI change.
*Accept:* migration idempotent on a seeded pre-migration fixture DB; all existing note flows unchanged; new unit tests (migration, uniqueness-per-space, purge residue, move invariant D2) green.

**Phase 2 — Sidebar tree UI (Personal-only visible, team-ready).**
The §8 tree with PRIVATE SPACES fully live; TEAM SPACES behind the capability probe (hidden for everyone until backend lands — testable via a dev override). All micro-interactions, DnD, menus, keyboard nav, i18n ×10.
*Accept:* feature-parity for existing users (folders/notes all present under Personal) + §8.9 checklist for Personal scope.

**Phase 3 — Backend contract + scoped sync.**
Client side of §6/§7 against the agreed API: spaces pass, `scope=all` pulls with team mapping, joined-space backfill w/ skeletons, push with `team_id`, revocation purge, sign-out purge, typed-error handling, editor conflict banner.
*Accept:* two accounts on two machines: create space → invite → member sees space arrive and notes flow both ways ≤ one poll cycle; remove member → space + content vanish from their machine (residue test); offline edits queue and reconcile.

**Phase 4 — Membership & permission UX.**
Create-space dialog (+chained workspace creation), Members dialog, invite-with-`team_ids` end-to-end (deep link → accept modal shows spaces → arrival animation), role changes, leave/delete-space flows, audience pill + breadcrumb in editor.
*Accept:* the exec-notes scenario: user in Sales+Product but not Exec never sees Exec anywhere (sidebar, search, agent, command palette); all §4 matrix rows exercised in a manual pass.

**Phase 5 — Search & agent scoping.**
§9 across all six paths + scope chip UI + agent tool updates.
*Accept:* agent asked about content in a non-member space finds nothing; "search in Sales team" scopes correctly; Qdrant-down fallback keeps scoping.

**Phase 6 — Polish, hardening, docs.**
Perf pass (500-note spaces, virtualization if needed), reduced-motion audit, a11y audit, kill-network/kill-Qdrant drills, copy review across locales, `CLAUDE.md` + `docs/` updates, QA matrix run (macOS/Windows/Linux), optional B8 change-feed latency work.
*Accept:* §8.9 + §10 checklists fully green.

Sequencing: 0→1→2 are client-only and immediately start; 3 needs backend B1–B7 (kick off the contract conversation at Phase 0); 4–5 parallelize after 3.

---

## 13. Testing strategy

- **Unit (`node --test`, follows `test/helpers/*.test.js` conventions):** migration & folders rebuild (fixture DB before/after), per-space name uniqueness, D2 move invariant, `purgeSpace` residue across stores (SQLite side; Qdrant/audio mocked), sync team-id mapping incl. unknown-team parking, revocation push-conflict relocation, FTS/RRF space filters.
- **Manual matrix (extends the CLAUDE.md checklist):** two-account collaboration loop; revocation mid-edit; offline queue; sign-out purge; invitation deep link cold-start; agent boundary probes; per-platform tree interactions (DnD, keyboard) on macOS/Windows/Linux; GNOME/Hyprland unaffected (no hotkey surface touched).
- **Perf:** scripted seed of 5 spaces × 20 folders × 500 notes; expand/scroll profiling; sync pass timing.

---

## 14. Risks & open questions

| # | Risk / question | Owner | Plan default if unanswered |
| --- | --- | --- | --- |
| 1 | Backend naming & readiness: are `/api/teams/*` live in prod or scaffold-only? B1–B7 delta must be scheduled. | backend | Capability probe keeps TEAM SPACES hidden until live |
| 2 | Seats/billing: does team-space membership consume workspace seats only (assumed), or per-space pricing? | product | Workspace seats only |
| 3 | Web-share of team notes (D8) | product+backend | Hidden in v1 |
| 4 | LWW edit loss under real co-editing | product | Mitigations §7.3; revisit after usage data |
| 5 | Legacy-client coexistence (`scope=all` opt-in) — confirm server default stays own-rows | backend | B2 as specced |
| 6 | Space archive/recovery window (D9) | backend | 30 days |
| 7 | Locale-merge conflicts (10 files, both sides) make Phase 0 tedious | client | Budgeted; mechanical key-level merge |
| 8 | Large-space perf (1000s of notes) in the tree | client | Virtualize leaves; paginate backfill |
| 9 | Personal-space notes of signed-out users must never regress (core dictation audience) | client | Phases 1–2 acceptance = full parity |
| 10 | Existing single-tenant local DB leaks personal notes across accounts on shared machines (pre-existing, adjacent) | client | Out of scope here; §7.4 fixes the *team* half; file follow-up issue |
