/**
 * fsm.js — Finite State Machine
 * A reusable, generic FSM class for any game entity (enemies, NPCs, bosses).
 *
 * Usage:
 *   const fsm = new FSM('WANDER', states);
 *   fsm.update(context);   // call every frame
 *   fsm.getState();        // current state name
 */

export class FSM {
    /**
     * @param {string} initialState - The starting state name.
     * @param {Object} states - State definitions (see below for shape).
     *
     * Each state is an object with optional hooks:
     * {
     *   onEnter(context) {},      // called once when entering this state
     *   onExit(context)  {},      // called once when leaving this state
     *   onUpdate(context) {},     // called every frame while in this state
     *   transitions: [            // evaluated in order every frame
     *     { to: 'NEXT_STATE', condition(context): boolean }
     *   ]
     * }
     */
    constructor(initialState, states) {
        this._states = states;
        this._current = null;
        this._previous = null;
        this._timeSinceEnter = 0; // ms spent in current state
        this._history = [];       // for debugging / logging

        this._enter(initialState, null);
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Returns the current state name (e.g. 'CHASE'). */
    getState() {
        return this._current;
    }

    /** Returns the previous state name, or null on the first state. */
    getPreviousState() {
        return this._previous;
    }

    /** How many milliseconds the FSM has been in the current state. */
    getTimeInState() {
        return this._timeSinceEnter;
    }

    /**
     * Call this every frame from your entity's update() method.
     * @param {Object} context - Anything the state needs: { entity, player, delta, ... }
     * @param {number} delta   - Time in ms since the last frame.
     */
    update(context, delta = 16) {
        this._timeSinceEnter += delta;

        const state = this._states[this._current];
        if (!state) return;

        // Run per-frame logic for the current state
        if (state.onUpdate) state.onUpdate(context);

        // Check transitions in order — first match wins
        if (state.transitions) {
            for (const t of state.transitions) {
                if (t.condition(context)) {
                    this._enter(t.to, context);
                    return; // only one transition per frame
                }
            }
        }
    }

    /**
     * Force an immediate transition regardless of conditions.
     * Useful for external triggers (e.g. entity takes lethal damage).
     * @param {string} stateName
     * @param {Object} context
     */
    forceTransition(stateName, context = {}) {
        if (!this._states[stateName]) {
            console.warn(`FSM: unknown state "${stateName}"`);
            return;
        }
        this._enter(stateName, context);
    }

    /** Returns true if currently in one of the given state names. */
    isIn(...stateNames) {
        return stateNames.includes(this._current);
    }

    /** Returns a snapshot for debugging (state, timeInState, history). */
    debug() {
        return {
            current: this._current,
            previous: this._previous,
            timeInState: this._timeSinceEnter,
            history: [...this._history],
        };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _enter(stateName, context) {
        const prev = this._states[this._current];

        // Exit old state
        if (prev && prev.onExit) prev.onExit(context);

        this._previous = this._current;
        this._current = stateName;
        this._timeSinceEnter = 0;
        this._history.push(stateName);
        if (this._history.length > 20) this._history.shift(); // keep last 20

        // Enter new state
        const next = this._states[stateName];
        if (!next) {
            console.warn(`FSM: state "${stateName}" is not defined.`);
            return;
        }
        if (next.onEnter) next.onEnter(context);
    }
}