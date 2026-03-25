/**
 * player.js — Player character and Bullet projectile.
 *
 * Dash fix: RMB now dashes toward the mouse cursor direction.
 *   - If WASD is held, it dashes in that direction (original intent).
 *   - If no WASD is held, it dashes toward the mouse (the intuitive dodge).
 *   This means you can always dodge by right-clicking without having to
 *   pre-hold a movement key.
 *
 * New: applyKnockback(dx, dy) — used by the Brute enemy.
 */

import { Audio } from './audio.js';

// ─── Tuning constants ────────────────────────────────────────────────────────
const PLAYER_SPEED  = 165;
const PLAYER_MAX_HP = 100;

const MAX_AMMO      = 10;
const RELOAD_MS     = 1500;
const FIRE_RATE     = 195;

const BULLET_SPEED  = 520;
const BULLET_DAMAGE = 25;

const DASH_SPEED    = 480;
const DASH_DUR      = 185;   // ms
const DASH_COOLDOWN = 1100;  // ms

// ─── Bullet ───────────────────────────────────────────────────────────────────

export class Bullet {
    constructor(x, y, angle) {
        this.x  = x;
        this.y  = y;
        this.vx = Math.cos(angle) * BULLET_SPEED;
        this.vy = Math.sin(angle) * BULLET_SPEED;
        this.radius = 4;
        this.damage = BULLET_DAMAGE;
        this.dead   = false;
        this.trail  = [];
    }

    update(delta) {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 6) this.trail.shift();
        this.x += this.vx * delta / 1000;
        this.y += this.vy * delta / 1000;
    }

    draw(ctx) {
        for (let i = 0; i < this.trail.length; i++) {
            const t = i / this.trail.length;
            ctx.beginPath();
            ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * t * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,210,60,${t * 0.35})`;
            ctx.fill();
        }
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
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius    = 16;
        this.health    = PLAYER_MAX_HP;
        this.maxHealth = PLAYER_MAX_HP;
        this.angle     = 0;

        this.ammo        = MAX_AMMO;
        this.reloading   = false;
        this.reloadTimer = 0;
        this.fireTimer   = 0;

        this.dashTimer    = 0;
        this.dashCooldown = 0;
        this.dashDx       = 0;
        this.dashDy       = 0;

        // Knockback state (set by Brute)
        this._kbX = 0;
        this._kbY = 0;
        this._kbTimer = 0;
        this._KB_DUR  = 220; // ms knockback lasts

        this.hurtFlash  = 0;
        this.invincible = 0;
        this.dead       = false;
    }

    // ─── Main update ─────────────────────────────────────────────────────────

    update(input, delta) {
        if (this.dead) return [];

        const bullets = [];

        // ── Knockback (overrides all movement while active) ───────────────────
        if (this._kbTimer > 0) {
            this._kbTimer -= delta;
            const t = Math.max(0, this._kbTimer / this._KB_DUR);
            this.x += this._kbX * t * delta / 1000;
            this.y += this._kbY * t * delta / 1000;
        }
        // ── Dash movement ─────────────────────────────────────────────────────
        else if (this.dashTimer > 0) {
            this.dashTimer -= delta;
            this.x += this.dashDx * DASH_SPEED * delta / 1000;
            this.y += this.dashDy * DASH_SPEED * delta / 1000;
        }
        // ── Normal WASD movement ──────────────────────────────────────────────
        else {
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

            // ── Dash trigger ────────────────────────────────────────────────
            // FIX: dash no longer requires WASD to be held.
            // Priority: WASD direction first, then mouse-cursor direction.
            if (input.dashPressed && this.dashCooldown <= 0) {
                let ddx, ddy;

                if (mag > 0) {
                    // Directional dash (WASD held)
                    ddx = dx / mag;
                    ddy = dy / mag;
                } else {
                    // Mouse-direction dash — dash toward the cursor
                    const mx = input.mouseX - this.x;
                    const my = input.mouseY - this.y;
                    const mm = Math.hypot(mx, my);
                    if (mm > 0) {
                        ddx = mx / mm;
                        ddy = my / mm;
                    } else {
                        // Cursor is exactly on player — dash right as fallback
                        ddx = 1; ddy = 0;
                    }
                }

                this.dashTimer    = DASH_DUR;
                this.dashDx       = ddx;
                this.dashDy       = ddy;
                this.dashCooldown = DASH_COOLDOWN;
                this.invincible   = DASH_DUR + 100; // brief iframe window
                Audio.dash();
            }
        }

        input.dashPressed = false;

        this.dashCooldown = Math.max(0, this.dashCooldown - delta);
        this.invincible   = Math.max(0, this.invincible   - delta);
        this.hurtFlash    = Math.max(0, this.hurtFlash    - delta);

        // ── Aim ───────────────────────────────────────────────────────────────
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

        // ── Shoot ─────────────────────────────────────────────────────────────
        this.fireTimer = Math.max(0, this.fireTimer - delta);
        if (input.shooting && !this.reloading && this.ammo > 0 && this.fireTimer <= 0) {
            this.ammo--;
            this.fireTimer = FIRE_RATE;
            bullets.push(new Bullet(this.x, this.y, this.angle));
            Audio.shot();
            if (this.ammo === 0) this._startReload();
        }

        return bullets;
    }

    _startReload() {
        if (this.reloading) return;
        this.reloading   = true;
        this.reloadTimer = RELOAD_MS;
        Audio.reload();
    }

    // ─── Draw ────────────────────────────────────────────────────────────────

    draw(ctx) {
        const dashing = this.dashTimer > 0;
        ctx.save();

        if (this.hurtFlash > 0)
            ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(this.hurtFlash / 40));

        // Shadow
        ctx.beginPath();
        ctx.ellipse(this.x, this.y+this.radius-2, this.radius*0.9, this.radius*0.32, 0, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fill();

        // Dash after-image
        if (dashing) {
            ctx.beginPath();
            ctx.arc(this.x-this.dashDx*22, this.y-this.dashDy*22, this.radius*0.75, 0, Math.PI*2);
            ctx.fillStyle='rgba(100,220,255,0.18)'; ctx.fill();
        }

        // Body
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fillStyle   = dashing ? '#80deea' : '#eceff1';
        ctx.strokeStyle = dashing ? '#00bcd4' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 2;
        ctx.fill(); ctx.stroke();

        // Gun barrel
        ctx.save();
        ctx.translate(this.x, this.y); ctx.rotate(this.angle);
        ctx.fillStyle='#78909c';
        ctx.fillRect(this.radius-4, -3.5, 18, 7);
        ctx.restore();

        // Centre dot
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2.5, 0, Math.PI*2);
        ctx.fillStyle='#fff'; ctx.fill();

        ctx.restore();
    }

    // ─── Damage / knockback ──────────────────────────────────────────────────

    takeDamage(amount) {
        if (this.invincible > 0 || this.dead) return;
        this.health     = Math.max(0, this.health - amount);
        this.hurtFlash  = 280;
        this.invincible = 550;
        Audio.hurt();
        if (this.health <= 0) {
            this.dead = true;
            document.dispatchEvent(new CustomEvent('playerDied'));
        }
    }

    /**
     * Push the player by (dx, dy) pixels over _KB_DUR ms.
     * Called by the Brute on a successful slam.
     * The velocity decays linearly so it eases out naturally.
     */
    applyKnockback(dx, dy) {
        this._kbX     = dx / (this._KB_DUR / 1000); // convert to px/s
        this._kbY     = dy / (this._KB_DUR / 1000);
        this._kbTimer = this._KB_DUR;
    }

    get dashFraction() {
        return this.dashCooldown <= 0 ? 1 : 1 - this.dashCooldown / DASH_COOLDOWN;
    }
}