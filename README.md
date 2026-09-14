# SyncPad: Real-Time Collaborative Notes with Operational Transformation (OT)

SyncPad is a production-grade real-time collaborative notes application built with Node.js, Express, Socket.IO, PostgreSQL, MongoDB, Redis, and React (Vite). Multiple users can concurrently view, edit, and collaborate on documents in real time with character-level Operational Transformation (OT) mathematical convergence guarantees, presence indicators, dynamic remote cursor tracking, non-destructive revision history, and fine-grained Role-Based Access Control (RBAC).

---

## Architecture Overview

SyncPad utilizes a hybrid multi-database and distributed event architecture to separate relational access management from high-throughput collaborative document persistence.

```text
                               ┌──────────────────────────────────────────────────────────┐
                               │                    React Frontend (Vite)                 │
                               │  - Collaborative Editor (Monaco/Textarea)               │
                               │  - Client OT Synchronizer (3-State Machine)             │
                               │  - Presence & Remote Cursor Renderer                    │
                               └────────────────────────────┬─────────────────────────────┘
                                                            │ (HTTP REST & WebSockets)
                                                            ▼
                               ┌──────────────────────────────────────────────────────────┐
                               │                     Node.js / Express                    │
                               │  - JWT Authentication & RBAC Middleware                  │
                               │  - Socket.IO Gateway & Presence Manager                  │
                               │  - OT Transformation & Concurrency Engine                │
                               └───────┬────────────────────┬─────────────────────┬───────┘
                                       │                    │                     │
                    ┌──────────────────┴───┐     ┌──────────┴───────────┐  ┌──────┴─────────────┐
                    ▼                      ▼     ▼                      ▼  ▼                     ▼
          ┌───────────────────┐  ┌────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
          │    PostgreSQL     │  │      MongoDB       │  │       Redis       │  │  Docker Compose  │
          │  Users, Auth,     │  │ Current Doc State, │  │ Socket.IO Pub/Sub │  │  Container       │
          │  Workspaces, RBAC │  │ Revision Log History│ │ Multi-Node Adapter│  │  Orchestration   │
          └───────────────────┘  └────────────────────┘  └───────────────────┘  └──────────────────┘
```

### Component & Subsystem Breakdown

#### 1. Frontend Client Tier ([`client/src/`](file:///c:/Users/VICTUS/SyncPad/client/src))
- **Application Shell & Context Providers**: React (Vite) SPA leveraging [`AuthContext`](file:///c:/Users/VICTUS/SyncPad/client/src/context/AuthContext.jsx) for JWT auth state and [`SocketContext`](file:///c:/Users/VICTUS/SyncPad/client/src/context/SocketContext.jsx) for maintaining socket lifecycle, automatic reconnects, and event dispatching.
- **Collaborative Editor ([`CollaborativeEditor.jsx`](file:///c:/Users/VICTUS/SyncPad/client/src/components/CollaborativeEditor.jsx))**: Provides real-time typing input capture, remote cursor rendering, typing indicators, active collaborator presence pills, and point-in-time document revision previews.
- **Client OT Synchronizer ([`otClientEngine.js`](file:///c:/Users/VICTUS/SyncPad/client/src/ot/otClientEngine.js))**: Implements a non-blocking 3-state machine (`Synchronized`, `AwaitingAck`, `AwaitingWithBuffer`) that immediately applies user typing locally to maintain zero-latency responsiveness while managing outstanding un-acknowledged edits and transforming incoming remote edits.

#### 2. Backend Gateway & Service Tier ([`server/src/`](file:///c:/Users/VICTUS/SyncPad/server/src))
- **HTTP REST API**: Handled via Express controllers for user registration, authentication, workspace management, note creation, role assignment, and version playback requests.
- **Socket.IO Event Gateway ([`otSocketHandler.js`](file:///c:/Users/VICTUS/SyncPad/server/src/sockets/otSocketHandler.js))**: Manages Socket.IO connection handshakes, JWT verification, note room subscriptions (`note:<noteId>`), user presence tracking, live cursor broadcasting, and operation submission pipelines.
- **RBAC Middleware ([`rbac.js`](file:///c:/Users/VICTUS/SyncPad/server/src/middleware/rbac.js))**: Enforces note-level permission checks (`OWNER`, `EDITOR`, `VIEWER`) across REST endpoints and Socket event listeners.
- **OT Transformation Service ([`otService.js`](file:///c:/Users/VICTUS/SyncPad/server/src/services/otService.js))**: Implements server-side catch-up transformation. When a client submits an operation with an older `baseVersion`, the service fetches all operations applied since `baseVersion` from MongoDB and transforms the incoming operation sequentially before committing the new document revision.

#### 3. Pure Operational Transformation Engine ([`server/src/ot/index.js`](file:///c:/Users/VICTUS/SyncPad/server/src/ot/index.js))
- Pure mathematical module defining `INSERT` and `DELETE` operations.
- Contains the 4-way Operational Transformation matrix (`Insert vs Insert`, `Insert vs Delete`, `Delete vs Insert`, `Delete vs Delete`) with deterministic tie-breaking.
- Provides operation composition (`compose`) and cursor offset transformation (`transformCursor`).

#### 4. Data Persistence & Pub/Sub Layer
- **PostgreSQL**: Stores relational domain entities including Users, Workspaces, Workspace Memberships, Notes, and Note Permissions (RBAC).
- **MongoDB**: Stores document state snapshots (`Document` schema) with current content & revision `version`, along with an append-only transaction log (`OperationLog` schema) recording every operation, author, timestamp, base version, and applied version.
- **Redis Adapter**: Enables multi-node Socket.IO scaling by distributing socket broadcasts across cluster nodes via Redis Pub/Sub channel channels.

---

## Detailed System Workflows

### Workflow 1: Authentication & Workspace / Note Initialization

```text
User ──► REST POST /api/auth/login ──► PostgreSQL Verify Credentials ──► Return JWT Token
User ──► REST POST /api/notes      ──► PostgreSQL Create Note & Set OWNER
                                    ──► MongoDB Initialize Document State (version = 0)
```

1. **User Authentication**: Client posts credentials to `/api/auth/login`. The server verifies bcrypt password hashes against PostgreSQL and returns a signed JWT.
2. **Workspace & Note Creation**: User creates a workspace or note. The backend records note metadata and assigns the creator as `OWNER` in PostgreSQL.
3. **Document Initialization**: MongoDB creates an initial document record (`noteId`, `content: ""`, `version: 0`).

---

### Workflow 2: Real-Time Collaborative Editing & Operation Transformation Lifecycle

```text
Client A (Typing)            Client OT Engine               Server Socket Gateway           MongoDB             Client B (Collaborator)
   │                             │                            │                                │                         │
   ├─ User Types 'X' ───────────►│                            │                                │                         │
   │                             ├─ Apply Locally (Optimistic)│                                │                         │
   │                             ├─ State: AwaitingAck        │                                │                         │
   │                             └─ Send operation:submit ───►│                                │                         │
   │                                                          ├─ Validate JWT & RBAC Role     │                         │
   │                                                          ├─ Fetch Ops > baseVersion       │                         │
   │                                                          ├─ Transform Op vs History      │                         │
   │                                                          ├─ Apply Op to Doc State ───────►│ (version = version + 1) │
   │                                                          ├─ Save OperationLog Record ────►│                         │
   │                                                          ├─ Emit operation:ack ──────────►│                         │
   │◄─ Receive operation:ack ─────────────────────────────────┤                                │                         │
   │   (State -> Synchronized)                                ├─ Broadcast operation:broadcast │                         │
   │                                                          └────────────────────────────────┼────────────────────────►│
   │                                                                                           │  Apply Transformed Op   │
   │                                                                                           │  Transform Cursor       │
```

1. **Local Edit & Optimistic UI**: When Client A types, `OTClientManager.applyLocalOp()` immediately updates the local UI.
2. **State Transition & Socket Dispatch**:
   - If in `Synchronized` state, Client A sets `pendingOp = op`, transitions to `AwaitingAck`, and emits `operation:submit` with `{ noteId, baseVersion, operation }`.
   - If user continues typing while awaiting ACK, local edits are stored/composed into `bufferOp` in state `AwaitingWithBuffer`.
3. **Server Transformation Pipeline**:
   - Server receives `operation:submit`, verifies user's `EDITOR` or `OWNER` role.
   - If `baseVersion < serverVersion`, server queries MongoDB `OperationLog` for all operations executed between `baseVersion` and `serverVersion`.
   - Incoming operation is transformed catch-up style against historical operations: `op' = transform(op, histOp, 'right')`.
   - Server updates document content, increments `serverVersion` to `nextVersion`, and logs the operation to MongoDB.
4. **Acknowledgement & Broadcast**:
   - Server emits `operation:ack` with `version: nextVersion` back to Client A.
   - Client A updates base version and flushes any buffered edits (`bufferOp -> pendingOp`), transitioning back to `AwaitingAck` (or `Synchronized`).
   - Server broadcasts `operation:broadcast` with transformed operation to all other note room members (Client B).
5. **Remote Application**: Client B receives `operation:broadcast`, transforms the incoming edit against its own pending/buffered operations if present, updates its document content, and shifts local cursor offsets dynamically (`transformCursor`).

---

### Workflow 3: Room Joining, Presence, and Live Cursor Tracking

```text
Client                      Server Socket Gateway              Note Room Members
  │                                   │                                │
  ├─ socket.emit('note:join') ───────►│                                │
  │                                   ├─ Check RBAC (Postgres)         │
  │                                   ├─ Join socket room `note:<id>`  │
  │                                   ├─ Add to Room Presence Map      │
  │                                   ├─ Fetch MongoDB Doc Content     │
  │                                   ├─ Broadcast `user:join` ───────►│ (Update Presence List)
  │◄─ Callback({ document, presence })┤                                │
  │                                   │                                │
  ├─ socket.emit('cursor:update')────►│                                │
  │                                   └─ Broadcast `cursor:update`────►│ (Render Remote Cursors)
```

1. **Room Join & Handshake**: Client emits `note:join` with `{ noteId }`. Server checks note permissions in PostgreSQL. On success, socket joins room `note:<noteId>`.
2. **Presence Broadcast**: Server records socket details in `notePresence` map and broadcasts `user:join` (including full active presence list) to all room members.
3. **Cursor Tracking**: As users move their caret or selection, client emits `cursor:update`. Server broadcasts `cursor:update` with user name and cursor offset to render color-coded remote selection carets.

---

### Workflow 4: Network Disconnection, Reconnection, and Catch-Up Sync

```text
Client Offline / Reconnecting           Server Gateway                    MongoDB / PostgreSQL
   │                                         │                                      │
   ├─ Network Disconnect Event               │                                      │
   ├─ Buffer Local Edits Locally             │                                      │
   │                                         │                                      │
   ├─ Socket Reconnected ───────────────────►│                                      │
   ├─ socket.emit('note:join') ─────────────►│ ── Fetch Document & History ─────────►│
   │◄─ Return Full Latest Doc & Version ─────┤                                      │
   ├─ Reset Client OT State Machine          │                                      │
   └─ Resend Pending/Buffered Edits ────────►│ ── Transform & Apply ───────────────►│
```

1. **Disconnect Grace**: If connection drops, local user input continues to buffer.
2. **Re-handshake**: Upon reconnection, client re-emits `note:join`. Server supplies latest snapshot content and revision version.
3. **Resynchronization**: Client OT engine resets its base version to current server snapshot and re-submits buffered local operations for transformation.

---

### Workflow 5: Revision History & Non-Destructive Version Restoration

```text
User ──► GET /api/notes/:id/history       ──► Return Operation History Array from MongoDB
User ──► GET /api/notes/:id/versions/:v   ──► Replay Ops 0 -> v to Preview Document Snapshot
User ──► POST /api/notes/:id/restore/:v  ──► Generate Delete & Insert Operations to match v
                                          ──► Apply as NEW Operation (Preserves Revision Log)
```

1. **History Retrieval**: `GET /api/notes/:id/history` queries MongoDB `OperationLog` to return a reverse-chronological list of every modification, author, and timestamp.
2. **Point-in-Time Preview**: `GET /api/notes/:id/versions/:version` fetches initial document state and replays operations up to `:version`, returning historical content without modifying database state.
3. **Non-Destructive Restoration**: `POST /api/notes/:id/restore/:version` retrieves historical text at target version, constructs deletion of existing content and insertion of historical text, and applies them as brand-new operations ($V_{\text{current}} \to V_{\text{current}}+1$). All historic logs remain preserved.

---

### Workflow 6: Role-Based Access Control (RBAC) Enforcement

| Role | Read Document | Receive Socket Edits | Submit Edits | Restore Versions | Manage Members / Delete |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **OWNER** | Yes | Yes | Yes | Yes | Yes |
| **EDITOR** | Yes | Yes | Yes | Yes | No |
| **VIEWER** | Yes | Yes | No | No | No |

- **REST Middleware ([`rbac.js`](file:///c:/Users/VICTUS/SyncPad/server/src/middleware/rbac.js))**: Verifies note permission prior to executing controllers (`requireNoteRole(['OWNER', 'EDITOR'])`).
- **Socket Enforcement ([`otSocketHandler.js`](file:///c:/Users/VICTUS/SyncPad/server/src/sockets/otSocketHandler.js))**: Re-validates role on every `operation:submit`. If role is `VIEWER`, operation is rejected and error response returned.

---

## WebSocket & Socket.IO Event Registry

### 1. Client-to-Server Events (Emitters)

#### `note:join`
- **Trigger**: Client opens editor view or reconnects socket.
- **Payload**: `{ noteId: string }`
- **Acknowledgement Callback**: `{ success: true, role: string, document: { content, version }, presence: Array }` or `{ error: string }`.
- **Server Action**: Validates RBAC permissions, joins room `note:<noteId>`, records presence in memory map, queries MongoDB document state, and broadcasts `user:join` to room.

#### `note:leave`
- **Trigger**: Client navigates away from editor or switches notes.
- **Payload**: `{ noteId: string }`
- **Server Action**: Leaves socket room `note:<noteId>`, removes entry from `notePresence` map, and emits `user:leave` to room.

#### `operation:submit`
- **Trigger**: Client OT state machine sends pending local edit.
- **Payload**: `{ noteId: string, baseVersion: number, operation: { type: 'insert'|'delete', position: number, text?: string, length?: number } }`
- **Acknowledgement Callback**: `{ success: true, version: number }` or `{ error: string }`.
- **Server Action**: Verifies write permission (`OWNER`/`EDITOR`), fetches revision history > `baseVersion`, transforms operation catch-up style, updates document state in MongoDB, writes `OperationLog`, emits `operation:ack` to sender, and broadcasts `operation:broadcast` to room.

#### `user:typing`
- **Trigger**: User starts typing in text container.
- **Payload**: `{ noteId: string }`
- **Server Action**: Broadcasts `user:typing` event to note room members.

#### `user:stopTyping`
- **Trigger**: Typing debounce timer expires (e.g. 1000ms idle).
- **Payload**: `{ noteId: string }`
- **Server Action**: Broadcasts `user:stopTyping` event to note room members.

#### `cursor:update`
- **Trigger**: Caret or selection offset changes in client editor.
- **Payload**: `{ noteId: string, cursor: { position: number, selectionEnd?: number } }`
- **Server Action**: Broadcasts `cursor:update` with user name and user ID to room.

---

### 2. Server-to-Client Events (Listeners & Broadcasts)

#### `user:join`
- **Recipient**: Active note room members (excluding joiner).
- **Payload**: `{ userId: string, name: string, email: string, role: string, presence: Array<{ userId, name, email, role }> }`
- **Client Action**: Updates active collaborators UI list and displays toast notification.

#### `user:leave`
- **Recipient**: Active note room members.
- **Payload**: `{ userId: string, socketId: string, presence: Array }`
- **Client Action**: Removes disconnected user from active collaborators UI list and clears remote cursor overlay.

#### `operation:ack`
- **Recipient**: Sender client socket.
- **Payload**: `{ noteId: string, version: number }`
- **Client Action**: Triggers `OTClientManager.handleAck(version)` to confirm pending operation, advance client base version, and submit next buffered operation if queued.

#### `operation:broadcast`
- **Recipient**: All room collaborators except sender (`socket.to(room).emit`).
- **Payload**: `{ noteId: string, version: number, operation: Object, userId: string }`
- **Client Action**: Triggers `OTClientManager.applyRemoteOp(operation, version)`, transforms local pending/buffered edits against remote edit, updates document content, and adjusts local cursor offset.

#### `user:typing`
- **Recipient**: Room collaborators.
- **Payload**: `{ userId: string, name: string }`
- **Client Action**: Renders typing indicator indicator (e.g. *"Alice is typing..."*).

#### `user:stopTyping`
- **Recipient**: Room collaborators.
- **Payload**: `{ userId: string }`
- **Client Action**: Hides typing indicator for specified user.

#### `cursor:update`
- **Recipient**: Room collaborators.
- **Payload**: `{ noteId: string, userId: string, name: string, cursor: { position: number, selectionEnd?: number } }`
- **Client Action**: Renders remote caret/selection overlay at transformed position.

#### `disconnect`
- **Trigger**: Network drop or client browser tab closed.
- **Server Action**: Cleans up all joined note rooms, removes socket from presence map, and broadcasts `user:leave` for affected rooms.

---

## Concurrency Issues & Operational Transformation Solution

### The Core Problem: Real-Time Race Conditions

In naive real-time collaborative text editing, when two users edit the same document concurrently without coordination, several failure modes occur:

1. **Overwritten Updates / Lost Edits**: If Client A and Client B both edit version 0 and send full document text, whichever packet arrives last overwrites the first packet completely.
2. **Index Displacement Corruption**: If Client A inserts 1 character at position 2 and Client B inserts 1 character at position 4 on base string `"ABCDEF"`:
   - If Client B's operation (`INSERT(4, "Y")`) is executed *after* Client A's edit (`"ABXCDEF"`), position 4 now points to `'C'` instead of `'D'`, causing Bob's insert to land in the wrong location (`"ABXCYDEF"` instead of `"ABXCDYEF"`).
3. **Divergence (State Non-Convergence)**: Client A and Client B end up viewing different text documents despite receiving the exact same set of edits.

```text
                  NAIVE EXECUTION (DIVERGENCE & CORRUPTION)

                 Initial Document State: "ABCDEF" (Version 0)
                                    │
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
      Alice: INSERT(2, "X")                       Bob: INSERT(4, "Y")
      Result: "ABXCDEF"                           Result: "ABCDYEF"
              │                                           │
   (Applies Bob's Op raw at pos 4)             (Applies Alice's Op raw at pos 2)
   "ABXCDEF" + INSERT(4, "Y")                  "ABCDYEF" + INSERT(2, "X")
   => "ABXCYDEF"  ◄─────── DIVERGENCE! ────────► => "ABXCDYEF"
```

---

### The OT Solution Framework

SyncPad solves concurrency race conditions using character-level **Operational Transformation (OT)**. Instead of sending raw document snapshots, clients emit atomic operations (`INSERT` or `DELETE`). When concurrent operations clash, they are passed through mathematical transformation functions before application.

#### 1. Operations Representation
- `INSERT(position, text)`: Inserts `text` starting at index `position`.
- `DELETE(position, length)`: Deletes `length` characters starting at index `position`.

#### 2. The 4-Way Transformation Matrix

When operation $O_1$ and operation $O_2$ are generated concurrently against state $D$, function $\text{transform}(O_1, O_2, \text{prioritySide})$ returns transformed operation $O_1'$ such that applying $O_1'$ after $O_2$ achieves the exact same document state as applying $O_2'$ after $O_1$.

```text
                       (D)
                      /   \
                  O1 /     \ O2
                    /       \
                 (D1)       (D2)
                    \       /
                 O2' \     / O1'  where O1' = transform(O1, O2, 'right')
                      \   /             O2' = transform(O2, O1, 'left')
                       (D')  ◄── CONVERGED STATE!
```

##### Matrix Case Summary:
1. **Insert vs Insert**:
   - If $O_1.\text{pos} < O_2.\text{pos}$: $O_1$ position is unchanged.
   - If $O_1.\text{pos} > O_2.\text{pos}$: $O_1.\text{pos}' = O_1.\text{pos} + O_2.\text{text.length}$.
   - If $O_1.\text{pos} == O_2.\text{pos}$: Deterministic tie-breaking using `prioritySide`. Left priority keeps position; right priority shifts right by $O_2.\text{text.length}$.
2. **Insert vs Delete**:
   - If $O_1.\text{pos} \le O_2.\text{pos}$: $O_1$ position is unchanged.
   - If $O_1.\text{pos} \ge O_2.\text{pos} + O_2.\text{len}$: $O_1.\text{pos}' = O_1.\text{pos} - O_2.\text{len}$.
   - If insert falls inside deleted range: $O_1.\text{pos}' = O_2.\text{pos}$.
3. **Delete vs Insert**:
   - If delete range ends before insert: Delete is unchanged.
   - If delete starts after insert: Delete position shifts right by inserted text length.
   - If insert falls inside delete range: Delete splits into two operations around inserted text to prevent destroying newly typed text.
4. **Delete vs Delete**:
   - Overlapping ranges are merged/trimmed so overlapping characters are not deleted twice.

#### 3. Mathematical Convergence (TP1 Property)
For any two concurrent operations $O_1$ and $O_2$ operating on state $D$:

$$\text{apply}(\text{apply}(D, O_1), \text{transform}(O_2, O_1, \text{'right'})) = \text{apply}(\text{apply}(D, O_2), \text{transform}(O_1, O_2, \text{'left'}))$$

This fundamental convergence property is verified in [`server/tests/ot.test.js`](file:///c:/Users/VICTUS/SyncPad/server/tests/ot.test.js).

---

### Concrete Step-by-Step Execution Example

#### Scenario Parameters:
- **Initial Document State ($D_0$)**: `"ABCDEF"`
- **Initial Version ($V$)**: `0`
- **Alice ($O_A$)**: Performs `INSERT(2, "X")` on base version 0.
- **Bob ($O_B$)**: Performs `INSERT(4, "Y")` on base version 0.

#### Step-by-Step Execution Flow & State Matrix:

| Step | Entity | Action / Event | Base Version | Operation Details | Document State | Server Version |
| :---: | :--- | :--- | :---: | :--- | :--- | :---: |
| **0** | **System** | Initial document loaded | 0 | None | `"ABCDEF"` | 0 |
| **1** | **Alice** | Types `'X'` at index 2 locally | 0 | `INSERT(2, "X")` | `"ABXCDEF"` *(Optimistic)* | 0 |
| **2** | **Bob** | Types `'Y'` at index 4 concurrently | 0 | `INSERT(4, "Y")` | `"ABCDYEF"` *(Optimistic)* | 0 |
| **3** | **Server** | Receives $O_A$ from Alice first | 0 | `INSERT(2, "X")` | Applies $O_A \to$ `"ABXCDEF"` | **1** |
| **4** | **Server** | Sends `operation:ack` (v1) to Alice | 1 | ACK | `"ABXCDEF"` | 1 |
| **5** | **Server** | Broadcasts $O_A$ (`INSERT(2, "X")`) to Bob | 1 | Broadcast | - | 1 |
| **6** | **Server** | Receives $O_B$ from Bob (`baseVersion: 0`) | 0 | `INSERT(4, "Y")` | Detects `baseVersion (0) < serverVersion (1)` | 1 |
| **7** | **Server** | Executes Catch-Up Transformation | 1 | $\text{transform}(O_B, O_A, \text{'right'})$ | Transformed $O_B' = \text{INSERT}(5, \text{"Y"})$ | 1 |
| **8** | **Server** | Applies $O_B'$ to current document | 1 | `INSERT(5, "Y")` | Applies $O_B' \to$ `"ABXCDYEF"` | **2** |
| **9** | **Server** | Sends `operation:ack` (v2) to Bob | 2 | ACK | Bob state $\to$ `Synchronized` | 2 |
| **10**| **Server** | Broadcasts $O_B'$ (`INSERT(5, "Y")`) to Alice | 2 | Broadcast | Alice applies $O_B' \to$ `"ABXCDYEF"` | 2 |

#### Detailed Transformation Math for Step 7:
```text
op_incoming (Bob) = INSERT(position: 4, text: "Y")
op_history  (Alice) = INSERT(position: 2, text: "X")

Since op_incoming.position (4) > op_history.position (2):
transformed_position = op_incoming.position + op_history.text.length
                     = 4 + 1 = 5

Transformed Operation (Bob') = INSERT(position: 5, text: "Y")
```

#### Final Outcome:
- **Alice's Document Content**: `"ABXCDYEF"`
- **Bob's Document Content**: `"ABXCDYEF"`
- **Server Document Content**: `"ABXCDYEF"`
- **Final Version**: `2`
- **Result**: Perfect deterministic convergence with zero lost characters or shifted offsets!

---

## Client-Side State Machine (`OTClientManager`)

To allow non-blocking typing while operations are in flight, the client editor employs a 3-state machine:

```text
                        ┌────────────────────────┐
                        │      Synchronized      │
                        └───────────┬────────────┘
                                    │ Local edit occurs
                                    │ (Send pendingOp)
                                    ▼
                        ┌────────────────────────┐
                        │      AwaitingAck       │
                        └───────────┬────────────┘
                                    │ User types again
                                    │ (Buffer edit)
                                    ▼
                        ┌────────────────────────┐
                        │   AwaitingWithBuffer   │
                        └────────────────────────┘
```

1. **`Synchronized`**:
   - No outstanding local edits.
   - When user types, edit is set to `pendingOp`, transmitted to server, and client transitions to `AwaitingAck`.
2. **`AwaitingAck`**:
   - Outstanding operation `pendingOp` sent to server, waiting for `operation:ack`.
   - If user types further, additional edits are appended to `bufferOp` and client transitions to `AwaitingWithBuffer`.
   - If remote edit arrives (`operation:broadcast`), client pair-transforms remote edit against `pendingOp`:
     $$\text{remote}' = \text{transform}(\text{remote}, \text{pendingOp}, \text{'left'})$$
     $$\text{pendingOp}' = \text{transform}(\text{pendingOp}, \text{remote}, \text{'right'})$$
3. **`AwaitingWithBuffer`**:
   - Both `pendingOp` and `bufferOp` exist.
   - When user types, new edit is composed into `bufferOp` via `compose(bufferOp, newOp)`.
   - If remote edit arrives, client performs a 3-way transformation chain across `pendingOp` and `bufferOp`.
   - When `operation:ack` arrives for `pendingOp`, `bufferOp` is promoted to `pendingOp`, transmitted to server, and state moves to `AwaitingAck`.

---

## REST API Specification

### Authentication API ([`server/src/routes/auth.js`](file:///c:/Users/VICTUS/SyncPad/server/src/routes/auth.js))
- `POST /api/auth/register` - Register new user account `{ name, email, password }`.
- `POST /api/auth/login` - Authenticate & obtain JWT `{ email, password }`.
- `GET /api/users/me` - Fetch profile of currently authenticated user.

### Workspace API ([`server/src/routes/workspaces.js`](file:///c:/Users/VICTUS/SyncPad/server/src/routes/workspaces.js))
- `POST /api/workspaces` - Create new workspace.
- `GET /api/workspaces` - List workspaces accessible by user.
- `POST /api/workspaces/:id/invite` - Invite member to workspace with role.
- `GET /api/workspaces/:id/members` - Retrieve workspace members list.

### Notes & History API ([`server/src/routes/notes.js`](file:///c:/Users/VICTUS/SyncPad/server/src/routes/notes.js))
- `POST /api/notes` - Create new note inside workspace.
- `GET /api/notes/workspace/:workspaceId` - List notes in workspace.
- `GET /api/notes/:id` - Fetch note metadata, document content, and current user role.
- `PATCH /api/notes/:id` - Update note title (`OWNER` or `EDITOR`).
- `DELETE /api/notes/:id` - Delete note (`OWNER` only).
- `POST /api/notes/:id/members` - Share note and assign RBAC role (`OWNER`, `EDITOR`, `VIEWER`).
- `GET /api/notes/:id/history` - Fetch full operation revision log.
- `GET /api/notes/:id/versions/:version` - Preview historical document state at specific version.
- `POST /api/notes/:id/restore/:version` - Perform non-destructive restoration to historical version.

---

## Quick Start & Development Guide

### Prerequisites
- Node.js (v18+) & npm
- Docker & Docker Compose (optional for containerized deployment)
- PostgreSQL, MongoDB, Redis (for manual local execution)

---

### Quick Start with Docker Compose

Run all services (React Frontend, Node.js Backend, PostgreSQL, MongoDB, Redis) in containerized mode:

```bash
docker compose up --build
```

- Frontend SPA: `http://localhost:3000`
- REST API Server: `http://localhost:5000`

---

### Manual Local Development Setup

#### 1. Backend Service
```bash
cd server
npm install
npm run dev
```

#### 2. Run Test Suite
```bash
cd server
npm test
```
Executes 24 automated unit and integration tests covering the 4-way transformation matrix, TP1 mathematical convergence property, edge cases, composition, and multi-client concurrent editing simulations.

#### 3. Frontend Client
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:3000` in your web browser.

---

## License

MIT License. Designed for real-time collaborative applications.
