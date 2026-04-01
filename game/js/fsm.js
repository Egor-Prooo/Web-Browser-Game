/**
 * fsm.js — Finite State Machine (unchanged)
 */
export class FSM {
    constructor(initialState, states) {
        this._states = states;
        this._current = null;
        this._previous = null;
        this._timeSinceEnter = 0;
        this._history = [];
        this._enter(initialState, null);
    }
    getState()         { return this._current; }
    getPreviousState() { return this._previous; }
    getTimeInState()   { return this._timeSinceEnter; }
    update(context, delta = 16) {
        this._timeSinceEnter += delta;
        const state = this._states[this._current];
        if (!state) return;
        if (state.onUpdate) state.onUpdate(context);
        if (state.transitions) {
            for (const t of state.transitions) {
                if (t.condition(context)) { this._enter(t.to, context); return; }
            }
        }
    }
    forceTransition(stateName, context = {}) {
        if (!this._states[stateName]) { console.warn(`FSM: unknown state "${stateName}"`); return; }
        this._enter(stateName, context);
    }
    isIn(...stateNames) { return stateNames.includes(this._current); }
    debug() { return { current: this._current, previous: this._previous, timeInState: this._timeSinceEnter, history: [...this._history] }; }
    _enter(stateName, context) {
        const prev = this._states[this._current];
        if (prev && prev.onExit) prev.onExit(context);
        this._previous = this._current;
        this._current = stateName;
        this._timeSinceEnter = 0;
        this._history.push(stateName);
        if (this._history.length > 20) this._history.shift();
        const next = this._states[stateName];
        if (!next) { console.warn(`FSM: state "${stateName}" is not defined.`); return; }
        if (next.onEnter) next.onEnter(context);
    }
}