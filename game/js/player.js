/**
 * player.js — Player character and Bullet projectile.
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
// NOTE: BULLET_LIFE removed — bullets now live until they leave the screen
// (the off-screen cull in main.js handles cleanup).

const DASH_SPEED    = 480;
const DASH_DUR      = 170;
const DASH_COOLDOWN = 1100;

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
        // Store position for trail
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 6) this.trail.shift();

        this.x += this.vx * delta / 1000;
        this.y += this.vy * delta / 1000;
        // FIX: no age-based expiry — main.js culls bullets that leave the canvas
    }

    draw(ctx) {
        // Motion trail
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

        this.hurtFlash  = 0;
        this.invincible = 0;
        this.dead       = false;
    }

    update(input, delta) {
        if (this.dead) return [];

        const bullets = [];

        // ── Dash movement ────────────────────────────────────────────────────
        if (this.dashTimer > 0) {
            this.dashTimer -= delta;
            this.x += this.dashDx * DASH_SPEED * delta / 1000;
            this.y += this.dashDy * DASH_SPEED * delta / 1000;
        } else {
            // ── Normal WASD movement ──────────────────────────────────────────
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

            // ── Trigger dash ──────────────────────────────────────────────────
            if (input.dashPressed && this.dashCooldown <= 0 && mag > 0) {
                this.dashTimer    = DASH_DUR;
                this.dashDx       = dx / mag;
                this.dashDy       = dy / mag;
                this.dashCooldown = DASH_COOLDOWN;
                this.invincible   = DASH_DUR + 80;
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

    draw(ctx) {
        const dashing = this.dashTimer > 0;
        ctx.save();

        if (this.hurtFlash > 0) {
            ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(this.hurtFlash / 40));
        }

        // Shadow
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + this.radius - 2, this.radius * 0.9, this.radius * 0.32, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        // Dash ghost
        if (dashing) {
            ctx.beginPath();
            ctx.arc(this.x - this.dashDx * 22, this.y - this.dashDy * 22, this.radius * 0.75, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(100, 220, 255, 0.18)';
            ctx.fill();
        }

        // Body
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

    get dashFraction() {
        return this.dashCooldown <= 0 ? 1 : 1 - this.dashCooldown / DASH_COOLDOWN;
    }
}