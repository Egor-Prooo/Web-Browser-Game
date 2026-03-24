/**
 * enemy.js — Zombie enemy using the FSM class.
 *
 * Each zombie has its own FSM instance with 5 states:
 *   SPAWN → WANDER → CHASE → ATTACK → DEAD
 *
 * Import and use:
 *   import { Enemy } from './enemy.js';
 *   const zombie = new Enemy(x, y);
 *   zombie.update(player, delta);
 *   zombie.draw(ctx);
 */

import { FSM } from './fsm.js';
import { Audio } from './audio.js';

// ─── Tuning constants (easy to tweak) ─────────────────────────────────────────
const CHASE_RANGE   = 150; // px — zombie starts chasing
const FORGET_RANGE  = 250; // px — zombie gives up chasing
const ATTACK_RANGE  = 30;  // px — zombie can hit the player
const WANDER_SPEED  = 40;  // px/s
const CHASE_SPEED   = 90;  // px/s
const ATTACK_DAMAGE = 10;  // HP per hit
const ATTACK_RATE   = 1000; // ms between attacks
const SPAWN_DURATION = 600; // ms of spawn animation
const MAX_HEALTH    = 100;

// ─── State definitions ────────────────────────────────────────────────────────

/**
 * Builds the state map for one zombie.
 * Receives the enemy instance so states can read/write its properties.
 */
function buildZombieStates(enemy) {
    return {

        SPAWN: {
            onEnter(ctx) {
                enemy.alpha = 0;
            },
            onUpdate(ctx) {
                // Fade in over SPAWN_DURATION ms
                enemy.alpha = Math.min(1, enemy.fsm.getTimeInState() / SPAWN_DURATION);
            },
            transitions: [
                {
                    to: 'WANDER',
                    condition: (ctx) => enemy.fsm.getTimeInState() >= SPAWN_DURATION,
                },
            ],
        },

        WANDER: {
            onEnter(ctx) {
                enemy.pickNewWanderTarget();
            },
            onUpdate(ctx) {
                enemy.moveToward(enemy.wanderTarget, WANDER_SPEED, ctx.delta);

                // Pick a new random target when close enough
                const dx = enemy.x - enemy.wanderTarget.x;
                const dy = enemy.y - enemy.wanderTarget.y;
                if (Math.hypot(dx, dy) < 5) enemy.pickNewWanderTarget();
            },
            transitions: [
                {
                    to: 'CHASE',
                    condition: (ctx) => ctx.player && enemy.distanceTo(ctx.player) < CHASE_RANGE,
                },
                {
                    to: 'DEAD',
                    condition: () => enemy.health <= 0,
                },
            ],
        },

        CHASE: {
            onEnter(ctx) {
                // Nothing special — just start moving toward player
            },
            onUpdate(ctx) {
                if (ctx.player) enemy.moveToward(ctx.player, CHASE_SPEED, ctx.delta);
            },
            transitions: [
                {
                    to: 'ATTACK',
                    condition: (ctx) => ctx.player && enemy.distanceTo(ctx.player) < ATTACK_RANGE,
                },
                {
                    to: 'WANDER',
                    condition: (ctx) => !ctx.player || enemy.distanceTo(ctx.player) > FORGET_RANGE,
                },
                {
                    to: 'DEAD',
                    condition: () => enemy.health <= 0,
                },
            ],
        },

        ATTACK: {
            onEnter(ctx) {
                enemy.attackTimer = 0;
            },
            onUpdate(ctx) {
                enemy.attackTimer += ctx.delta;

                if (enemy.attackTimer >= ATTACK_RATE) {
                    enemy.attackTimer = 0;
                    if (ctx.player) ctx.player.takeDamage(ATTACK_DAMAGE);
                }
            },
            transitions: [
                {
                    to: 'CHASE',
                    condition: (ctx) => !ctx.player || enemy.distanceTo(ctx.player) >= ATTACK_RANGE,
                },
                {
                    to: 'DEAD',
                    condition: () => enemy.health <= 0,
                },
            ],
        },

        DEAD: {
            onEnter(ctx) {
                enemy.alpha = 1;
                enemy.dead = false; // will be set true after death anim
                enemy.deathTimer = 0;
                // Dispatch a custom event so the game can track kills
                document.dispatchEvent(new CustomEvent('enemyDied', { detail: { enemy } }));
            },
            onUpdate(ctx) {
                enemy.deathTimer += ctx.delta;
                enemy.alpha = Math.max(0, 1 - enemy.deathTimer / 500);
                if (enemy.deathTimer >= 500) enemy.dead = true; // ready to remove
            },
            transitions: [], // terminal state — no way out
        },
    };
}

// ─── Enemy class ──────────────────────────────────────────────────────────────

export class Enemy {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 14;
        this.health = MAX_HEALTH;
        this.maxHealth = MAX_HEALTH;
        this.alpha = 0;
        this.dead = false;
        this.attackTimer = 0;
        this.deathTimer = 0;
        this.wanderTarget = { x, y };

        // Velocity (used for smooth movement)
        this.vx = 0;
        this.vy = 0;

        // Create the FSM — starts in SPAWN state
        this.fsm = new FSM('SPAWN', buildZombieStates(this));
    }

    // ─── Called every frame ──────────────────────────────────────────────────

    /**
     * @param {Object} player - The player object (must have x, y, takeDamage())
     * @param {number} delta  - Ms since last frame
     */
    update(player, delta) {
        if (this.dead) return;
        this.fsm.update({ player, delta }, delta);
    }

    draw(ctx) {
        if (this.dead) return;

        ctx.save();
        ctx.globalAlpha = this.alpha;

        const state = this.fsm.getState();

        // Body color changes per state
        const colors = {
            SPAWN:  '#6b7a3e',
            WANDER: '#5a8a5a',
            CHASE:  '#c8a020',
            ATTACK: '#d44',
            DEAD:   '#555',
        };
        const bodyColor = colors[state] || '#5a8a5a';

        // Draw shadow
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + this.radius - 2, this.radius * 0.8, this.radius * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // Draw body
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw health bar (only when damaged and alive)
        if (this.health < this.maxHealth && !this.fsm.isIn('SPAWN', 'DEAD')) {
            const barW = 28, barH = 4;
            const bx = this.x - barW / 2;
            const by = this.y - this.radius - 8;
            ctx.fillStyle = '#333';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = this.health > 50 ? '#4caf50' : this.health > 25 ? '#ff9800' : '#f44336';
            ctx.fillRect(bx, by, barW * (this.health / this.maxHealth), barH);
        }

        // Debug: show state label (remove in production)
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
        if (this.health <= 0) this.fsm.forceTransition('DEAD');
    }

    distanceTo(target) {
        return Math.hypot(this.x - target.x, this.y - target.y);
    }

    moveToward(target, speed, delta) {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;

        const s = (speed * delta) / 1000;
        this.x += (dx / dist) * s;
        this.y += (dy / dist) * s;
    }

    pickNewWanderTarget() {
        // Pick a point within 120px in a random direction
        const angle = Math.random() * Math.PI * 2;
        const dist  = 40 + Math.random() * 80;
        this.wanderTarget = {
            x: this.x + Math.cos(angle) * dist,
            y: this.y + Math.sin(angle) * dist,
        };
    }
}