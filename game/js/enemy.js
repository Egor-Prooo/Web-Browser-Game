/**
 * enemy.js — Zombie enemy using the FSM class.
 *
 * Each zombie has its own FSM instance with 5 states:
 *   SPAWN → WANDER → CHASE → ATTACK → DEAD
 */

import { FSM }   from './fsm.js';
import { Audio } from './audio.js';

// ─── Tuning constants ──────────────────────────────────────────────────────────
const CHASE_RANGE    = 420;  // px — zombie starts chasing  (was 150 — too small)
const FORGET_RANGE   = 600;  // px — zombie gives up chasing (was 250)
const ATTACK_RANGE   = 32;   // px — zombie can hit the player
const WANDER_SPEED   = 45;   // px/s
const CHASE_SPEED    = 95;   // px/s
const ATTACK_DAMAGE  = 10;   // HP per hit
const ATTACK_RATE    = 1000; // ms between attacks
const SPAWN_DURATION = 600;  // ms of spawn animation
const MAX_HEALTH     = 100;

// ─── State definitions ────────────────────────────────────────────────────────

function buildZombieStates(enemy) {
    return {

        SPAWN: {
            onEnter() { enemy.alpha = 0; },
            onUpdate() {
                enemy.alpha = Math.min(1, enemy.fsm.getTimeInState() / SPAWN_DURATION);
            },
            transitions: [
                { to: 'WANDER', condition: () => enemy.fsm.getTimeInState() >= SPAWN_DURATION },
            ],
        },

        WANDER: {
            onEnter() { enemy.pickNewWanderTarget(); },
            onUpdate(ctx) {
                enemy.moveToward(enemy.wanderTarget, WANDER_SPEED, ctx.delta);
                const dx = enemy.x - enemy.wanderTarget.x;
                const dy = enemy.y - enemy.wanderTarget.y;
                if (Math.hypot(dx, dy) < 8) enemy.pickNewWanderTarget();
            },
            transitions: [
                { to: 'CHASE', condition: (ctx) => ctx.player && enemy.distanceTo(ctx.player) < CHASE_RANGE },
                { to: 'DEAD',  condition: () => enemy.health <= 0 },
            ],
        },

        CHASE: {
            onEnter() {},
            onUpdate(ctx) {
                if (ctx.player) enemy.moveToward(ctx.player, CHASE_SPEED * enemy.speedMult, ctx.delta);
            },
            transitions: [
                { to: 'ATTACK', condition: (ctx) => ctx.player && enemy.distanceTo(ctx.player) < ATTACK_RANGE },
                { to: 'WANDER', condition: (ctx) => !ctx.player || enemy.distanceTo(ctx.player) > FORGET_RANGE },
                { to: 'DEAD',   condition: () => enemy.health <= 0 },
            ],
        },

        ATTACK: {
            onEnter() { enemy.attackTimer = 0; },
            onUpdate(ctx) {
                // Stay adjacent to the player while attacking
                if (ctx.player) enemy.moveToward(ctx.player, CHASE_SPEED * enemy.speedMult, ctx.delta);

                enemy.attackTimer += ctx.delta;
                if (enemy.attackTimer >= ATTACK_RATE) {
                    enemy.attackTimer = 0;
                    if (ctx.player) ctx.player.takeDamage(ATTACK_DAMAGE);
                }
            },
            transitions: [
                { to: 'CHASE', condition: (ctx) => !ctx.player || enemy.distanceTo(ctx.player) >= ATTACK_RANGE },
                { to: 'DEAD',  condition: () => enemy.health <= 0 },
            ],
        },

        DEAD: {
            onEnter() {
                enemy.alpha = 1;
                enemy.dead = false;
                enemy.deathTimer = 0;
                document.dispatchEvent(new CustomEvent('enemyDied', { detail: { enemy } }));
                Audio.death();
            },
            onUpdate(ctx) {
                enemy.deathTimer += ctx.delta;
                enemy.alpha = Math.max(0, 1 - enemy.deathTimer / 500);
                if (enemy.deathTimer >= 500) enemy.dead = true;
            },
            transitions: [],
        },
    };
}

// ─── Enemy class ──────────────────────────────────────────────────────────────

export class Enemy {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} [speedMult=1] - Per-wave speed scalar passed from main.js
     */
    constructor(x, y, speedMult = 1) {
        this.x = x;
        this.y = y;
        this.radius    = 14;
        this.health    = MAX_HEALTH;
        this.maxHealth = MAX_HEALTH;
        this.alpha     = 0;
        this.dead      = false;
        this.speedMult = speedMult;
        this.attackTimer = 0;
        this.deathTimer  = 0;
        this.wanderTarget = { x, y };

        this.fsm = new FSM('SPAWN', buildZombieStates(this));
    }

    update(player, delta) {
        if (this.dead) return;
        this.fsm.update({ player, delta }, delta);
    }

    draw(ctx) {
        if (this.dead) return;

        ctx.save();
        ctx.globalAlpha = this.alpha;

        const state = this.fsm.getState();
        const colors = {
            SPAWN:  '#6b7a3e',
            WANDER: '#5a8a5a',
            CHASE:  '#c8a020',
            ATTACK: '#d44',
            DEAD:   '#555',
        };
        const bodyColor = colors[state] || '#5a8a5a';

        // Shadow
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + this.radius - 2, this.radius * 0.8, this.radius * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle   = bodyColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Health bar
        if (this.health < this.maxHealth && !this.fsm.isIn('SPAWN', 'DEAD')) {
            const barW = 28, barH = 4;
            const bx = this.x - barW / 2;
            const by = this.y - this.radius - 8;
            ctx.fillStyle = '#333';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = this.health > 50 ? '#4caf50' : this.health > 25 ? '#ff9800' : '#f44336';
            ctx.fillRect(bx, by, barW * (this.health / this.maxHealth), barH);
        }

        if (window.DEBUG_FSM) {
            ctx.fillStyle = 'white';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(state, this.x, this.y - this.radius - 12);
        }

        ctx.restore();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    takeDamage(amount) {
        if (this.fsm.isIn('DEAD')) return;
        this.health = Math.max(0, this.health - amount);
        Audio.hit();
        if (this.health <= 0) this.fsm.forceTransition('DEAD');
    }

    distanceTo(target) {
        return Math.hypot(this.x - target.x, this.y - target.y);
    }

    moveToward(target, speed, delta) {
        const dx   = target.x - this.x;
        const dy   = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;
        const s = (speed * delta) / 1000;
        this.x += (dx / dist) * s;
        this.y += (dy / dist) * s;
    }

    /**
     * FIX: Pick a random point anywhere inside the visible canvas so enemies
     * walk onto the playfield instead of lingering near their off-screen spawn.
     */
    pickNewWanderTarget() {
        const canvas = document.getElementById('gameCanvas');
        const W = canvas ? canvas.width  : 800;
        const H = canvas ? canvas.height : 600;
        const margin = 60;
        this.wanderTarget = {
            x: margin + Math.random() * (W - margin * 2),
            y: margin + Math.random() * (H - margin * 2),
        };
    }
}