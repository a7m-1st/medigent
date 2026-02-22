# Changelog

## Performance & Architecture Optimization

Seven features implemented to dramatically reduce startup latency, improve
resource utilization, and modernize the client-server communication layer.

### Feature 1: Shared Model Backend Registry

**Commit:** `50b1678`

Eliminates redundant model backend instantiation. A thread-safe, fingerprint-
based registry ensures each unique model configuration (platform, type, API URL,
temperature, etc.) is created once and shared across all agents that need it.

**Files:**
- `backend/app/service/model_registry.py` — new registry with `get_or_create_model()`
- `backend/app/agent/agent_model.py` — `ModelFactory.create()` routes through registry
- `backend/app/agent/factory/chief_of_medicine.py` — uses registry
- `backend/app/agent/factory/radiologist.py` — uses registry
- `backend/app/agent/factory/clinical_researcher.py` — uses registry

---

### Feature 2: Toolkit Pool

**Commit:** `de4c273`

Per-project toolkit caching. Toolkits (search, terminal, code interpreter, etc.)
are created once per project and reused across agent re-creations, avoiding
repeated initialization of heavyweight tool instances.

**Files:**
- `backend/app/service/toolkit_pool.py` — new pool with `get_or_create_toolkit()`
- All 6 agent factories updated to use pooled toolkits

---

### Feature 3: Workforce Pool & Reuse

**Commit:** `aef59ce`

Caches the entire CAMEL `Workforce` object (coordinator, task agent, all workers)
between turns. Follow-up messages reuse the existing workforce instead of
rebuilding it from scratch, cutting multi-second startup overhead to near zero.

**Key behaviors:**
- `TaskLock.workforce` field holds the cached workforce
- `prepare_for_new_task()` resets channel, clears pending/in-flight tasks, clones
  workers with fresh memory while keeping shared model backends and toolkits
- `Action.end` no longer breaks the SSE loop — connection stays alive for
  follow-up messages
- `Action.improve` reuses or recovers the cached workforce

**Files:**
- `backend/app/service/task.py` — `workforce` field, cleanup logic
- `backend/app/utils/workforce.py` — `prepare_for_new_task()` method
- `backend/app/service/chat_service.py` — reuse/recovery logic
- `backend/app/controller/chat_controller.py` — queue drainage on reuse

---

### Feature 4: Concurrent Subtask Execution

**Commit:** `c96344c`

Overrides CAMEL's default serial task-completion handler with a batch-drain
approach. Instead of processing one completed task at a time, the workforce
collects all tasks that complete within a 150ms window and processes them
together, enabling true parallel subtask execution.

**Files:**
- `backend/app/utils/workforce.py` — `_drain_returned_tasks()` (150ms batch
  window), `_listen_to_channel()` override

---

### Feature 5: Preemption Support

**Commit:** `6ea3f6c`

When a follow-up message arrives while the workforce is still running, the
system preempts the in-flight task: cancels child tasks, stops workers, clears
pending work, then redirects the workforce to the new question — all without
tearing down and rebuilding agents.

**Key behaviors:**
- `_preempted` flag suppresses the normal `ActionEndData` emission during stop
- `preempt_and_redirect()` performs graceful cancellation then calls
  `prepare_for_new_task()`

**Files:**
- `backend/app/utils/workforce.py` — `_preempted` flag, `preempt_and_redirect()`,
  updated `stop()`
- `backend/app/service/chat_service.py` — preemption logic in `Action.improve`

---

### Feature 6: Direct Execution for MODERATE

**Commit:** `1e5e91c`

When the triage system classifies a question as MODERATE complexity with exactly
one suggested agent, and that agent exists in a cached workforce, the system
bypasses the full workforce orchestration entirely. The agent is cloned and run
directly, avoiding coordinator overhead, task decomposition, and channel setup.

**Falls through** to the normal workforce flow if the conditions are not met.

**Files:**
- `backend/app/service/chat_service.py` — `_find_agent_in_workforce()`,
  `_run_direct_agent()`, direct execution path in triage handler

---

### Feature 7: WebSocket Session

**Commit:** `dc3b1e3`

Replaces the per-message SSE (Server-Sent Events) connection with a persistent
bidirectional WebSocket. The client opens one socket per project session; all
operations (start, follow-up, stop, human reply, task start) flow as JSON
messages over the same connection. Server events use the same
`{"step": ..., "data": ...}` format as SSE but without framing overhead.

**Client -> Server messages:**
- `start_chat` — begin a new chat session
- `improve` — send a follow-up message
- `stop` — cancel the current task
- `human_reply` — respond to an agent's question
- `start_task` — trigger task execution after decomposition

**Backend:**
- `_WSRequest` adapter class wraps WebSocket for `step_solve()` compatibility
- `_consume_sse_and_forward()` strips SSE framing and forwards as raw JSON
- SSE and REST endpoints preserved as backward-compatible fallbacks

**Frontend:**
- `WSConnection` class with auto-reconnect (exponential backoff, max 5 attempts)
- `useChat` hook rewritten to manage a persistent WS connection via `ensureWS()`
- `useSSEHandler` accepts `onStartTask` callback — sends `start_task` over WS
  instead of making a REST `POST /task/{id}/start` call

**Files:**
- `backend/app/controller/chat_controller.py` — WS endpoint, `_WSRequest` adapter
- `frontend/src/lib/ws.ts` — `WSConnection` class, `getWSUrl()` helper
- `frontend/src/hooks/useChat.ts` — rewritten for WebSocket
- `frontend/src/hooks/useSSEHandler.ts` — `onStartTask` callback integration
