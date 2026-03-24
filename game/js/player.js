/**
 * player.js — Player character and Bullet projectile.
 *
 * Import and use:
 *   import { Player } from './player.js';
 *   const player = new Player(x, y);
 *   const newBullets = player.update(input, delta);
 *   player.draw(ctx);
 */

import { Audio } from './audio.js';

// ─── Tuning constants ────────────────────────────────────────────────────────
const PLAYER_SPEED  = 165;  // px/s normal movement
const PLAYER_MAX_HP = 100;

const MAX_AMMO      = 10;   // magazine capacity
const RELOAD_MS     = 1500; // ms to reload a full magazine
const FIRE_RATE     = 195;  // ms minimum between shots

const BULLET_SPEED  = 520;  // px/s
const BULLET_DAMAGE = 25;   // HP removed per bullet
const BULLET_LIFE   = 1400; // ms before a stray bullet expires

const DASH_SPEED    = 480;  // px/s while dashing
const DASH_DUR      = 170;  // ms per dash
const DASH_COOLDOWN = 1100; // ms between dashes

// ─── Bullet ───────────────────────────────────────────────────────────────────

export class Bullet {
    /**
     * @param {number} x     - Origin X
     * @param {number} y     - Origin Y
     * @param {number} angle - Direction in radians
     */
    constructor(x, y, angle) {
        this.x  = x;
        this.y  = y;
        this.vx = Math.cos(angle) * BULLET_SPEED;
        this.vy = Math.sin(angle) * BULLET_SPEED;

        this.radius = 4;
        this.damage = BULLET_DAMAGE;
        this.age    = 0;
        this.dead   = false;
        this.trail  = [];   // stores last N positions for motion trail
    }

    /** @param {number} delta - Ms since last frame */
    update(delta) {
        // Store position for trail before moving
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 6) this.trail.shift();

        this.x   += this.vx * delta / 1000;
        this.y   += this.vy * delta / 1000;
        this.age += delta;

        if (this.age >= BULLET_LIFE) this.dead = true;
    }

    /** @param {CanvasRenderingContext2D} ctx */
    draw(ctx) {
        // Motion trail (fades in opacity + radius toward the tip)
        for (let i = 0; i < this.trail.length; i++) {
            const t = i / this.trail.length;
            ctx.beginPath();
            ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * t * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 210, 60, ${t * 0.35})`;
            ctx.fill();
        }

        // Bullet core
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle   = '#ffe066';
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur  = 12;
        ctx.fill();
        ctx.shadowBlur  = 0;
    }
}

// ─── Player ───────────────────────────────────────────────────────────────────

export class Player {
    /**
     * @param {number} x - Initial X position (canvas pixels)
     * @param {number} y - Initial Y position (canvas pixels)
     */
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius    = 16;
        this.health    = PLAYER_MAX_HP;
        this.maxHealth = PLAYER_MAX_HP;
        this.angle     = 0;   // radians — direction the player is aiming

        // Weapon state
        this.ammo        = MAX_AMMO;
        this.reloading   = false;
        this.reloadTimer = 0;
        this.fireTimer   = 0;   // cooldown between shots

        // Dash state
        this.dashTimer    = 0;  // ms remaining in current dash
        this.dashCooldown = 0;  // ms until next dash is allowed
        this.dashDx       = 0;  // normalised direction X
        this.dashDy       = 0;  // normalised direction Y

        // Visual/gameplay flags
        this.hurtFlash  = 0;   // ms of red flash remaining
        this.invincible = 0;   // ms of invincibility remaining (dash window)
        this.dead       = false;
    }

    // ─── Called every frame ──────────────────────────────────────────────────

    /**
     * Processes movement, dash, aiming, reload and shooting.
     *
     * @param {Object}   input              - Shared input state from main.js
     * @param {Set}      input.keys         - Currently held keys (lowercase)
     * @param {number}   input.mouseX
     * @param {number}   input.mouseY
     * @param {boolean}  input.shooting     - Is LMB held down?
     * @param {boolean}  input.dashPressed  - Was RMB pressed this frame? (consumed here)
     * @param {boolean}  input.reloadPressed- Was R pressed this frame? (consumed here)
     * @param {number}   delta              - Ms since last frame
     *
     * @returns {Bullet[]} Bullets fired this frame (may be empty).
     */
    update(input, delta) {
        if (this.dead) return [];

        const bullets = [];

        // ── Dash movement ────────────────────────────────────────────────────
        if (this.dashTimer > 0) {
            this.dashTimer -= delta;
            this.x += this.dashDx * DASH_SPEED * delta / 1000;
            this.y += this.dashDy * DASH_SPEED * delta / 1000;
        } else {
            // ── Normal WASD / arrow-key movement ─────────────────────────────
            let dx = 0, dy = 0;
            if (input.keys.has('w') || input.keys.has('arrowup'))    dy -= 1;
            if (input.keys.has('s') || input.keys.has('arrowdown'))  dy += 1;
            if (input.keys.has('a') || input.keys.has('arrowleft'))  dx -= 1;
            if (input.keys.has('d') || input.keys.has('arrowright')) dx += 1;

            const mag = Math.hypot(dx, dy);
            if (mag > 0) {
                this.x += (dx / mag) * PLAYER_SPEED * delta / 1000;
                this.y += (dy / mag) * PLAYER_SPEED * delta / 1000;
            }

            // ── Trigger dash (RMB + movement direction required) ──────────────
            if (input.dashPressed && this.dashCooldown <= 0 && mag > 0) {
                this.dashTimer    = DASH_DUR;
                this.dashDx       = dx / mag;
                this.dashDy       = dy / mag;
                this.dashCooldown = DASH_COOLDOWN;
                this.invincible   = DASH_DUR + 80; // brief invincibility window
                Audio.dash();
            }
        }

        // Always consume the dash input so it doesn't carry over next frame
        input.dashPressed = false;

        // Tick down cooldown timers
        this.dashCooldown = Math.max(0, this.dashCooldown - delta);
        this.invincible   = Math.max(0, this.invincible   - delta);
        this.hurtFlash    = Math.max(0, this.hurtFlash    - delta);

        // ── Aim toward the mouse cursor ───────────────────────────────────────
        this.angle = Math.atan2(input.mouseY - this.y, input.mouseX - this.x);

        // ── Reload ────────────────────────────────────────────────────────────
        if (this.reloading) {
            this.reloadTimer -= delta;
            if (this.reloadTimer <= 0) {
                this.ammo      = MAX_AMMO;
                this.reloading = false;
            }
        } else if (input.reloadPressed && this.ammo < MAX_AMMO) {
            this._startReload();
        }
        input.reloadPressed = false;

        // ── Shoot (auto-fire while LMB held) ─────────────────────────────────
        this.fireTimer = Math.max(0, this.fireTimer - delta);

        if (input.shooting && !this.reloading && this.ammo > 0 && this.fireTimer <= 0) {
            this.ammo--;
            this.fireTimer = FIRE_RATE;
            bullets.push(new Bullet(this.x, this.y, this.angle));
            Audio.shot();

            // Auto-reload when the last round is fired
            if (this.ammo === 0) this._startReload();
        }

        return bullets;
    }

    /** Start a reload cycle. Safe to call multiple times — ignores if already reloading. */
    _startReload() {
        if (this.reloading) return;
        this.reloading   = true;
        this.reloadTimer = RELOAD_MS;
        Audio.reload();
    }

    /** @param {CanvasRenderingContext2D} ctx */
    draw(ctx) {
        const dashing = this.dashTimer > 0;
        ctx.save();

        // Flicker transparency when recently hurt
        if (this.hurtFlash > 0) {
            ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(this.hurtFlash / 40));
        }

        // Drop shadow
        ctx.beginPath();
        ctx.ellipse(
            this.x, this.y + this.radius - 2,
            this.radius * 0.9, this.radius * 0.32,
            0, 0, Math.PI * 2
        );
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        // Dash after-image ghost
        if (dashing) {
            ctx.beginPath();
            ctx.arc(
                this.x - this.dashDx * 22,
                this.y - this.dashDy * 22,
                this.radius * 0.75, 0, Math.PI * 2
            );
            ctx.fillStyle = 'rgba(100, 220, 255, 0.18)';
            ctx.fill();
        }

        // Body circle
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle   = dashing ? '#80deea' : '#eceff1';
        ctx.strokeStyle = dashing ? '#00bcd4' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 2;
        ctx.fill();
        ctx.stroke();

        // Gun barrel
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.fillStyle = '#78909c';
        ctx.fillRect(this.radius - 4, -3.5, 18, 7);
        ctx.restore();

        // Centre dot
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.restore();
    }

    /**
     * Called by enemies when they successfully land an attack.
     * @param {number} amount - HP to subtract
     */
    takeDamage(amount) {
        if (this.invincible > 0 || this.dead) return;
        this.health    = Math.max(0, this.health - amount);
        this.hurtFlash = 280;
        this.invincible = 550; // prevent immediate repeat damage
        Audio.hurt();

        if (this.health <= 0) {
            this.dead = true;
            // Custom event — main.js listens to trigger game-over flow
            document.dispatchEvent(new CustomEvent('playerDied'));
        }
    }

    /**
     * Fraction 0–1 representing dash cooldown progress (1 = ready to dash again).
     * Used by the HUD dash bar.
     */
    get dashFraction() {
        return this.dashCooldown <= 0 ? 1 : 1 - this.dashCooldown / DASH_COOLDOWN;
    }
}