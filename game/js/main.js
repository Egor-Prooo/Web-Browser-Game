/**
 * main.js — Game orchestrator and entry point.
 *
 * Responsibilities:
 *   - Game loop (requestAnimationFrame)
 *   - Wave / spawn management
 *   - Input aggregation
 *   - HUD updates
 *   - Screen transitions (menu → playing → paused → gameover)
 *   - Particle effects
 *
 * Depends on: audio.js, fsm.js, enemy.js, player.js
 */

import { Audio }  from './audio.js';
import { Enemy }  from './enemy.js';
import { Player } from './player.js';

// ─── Particle ─────────────────────────────────────────────────────────────────

class Particle {
    /**
     * @param {number} x
     * @param {number} y
     * @param {string} [color='#c62828']
     */
    constructor(x, y, color = '#c62828') {
        this.x = x;
        this.y = y;

        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 140;
        this.vx    = Math.cos(angle) * speed;
        this.vy    = Math.sin(angle) * speed;
        this.color = color;
        this.r     = 1.5 + Math.random() * 3;
        this.life  = 350 + Math.random() * 350; // ms
        this.age   = 0;
    }

    update(delta) {
        this.x  += this.vx * delta / 1000;
        this.y  += this.vy * delta / 1000;
        this.vx *= 0.93; // friction
        this.vy *= 0.93;
        this.age += delta;
    }

    draw(ctx) {
        const progress = 1 - this.age / this.life;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * progress, 0, Math.PI * 2);
        ctx.fillStyle   = this.color;
        ctx.globalAlpha = progress;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    get dead() { return this.age >= this.life; }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');

        // 'menu' | 'playing' | 'paused' | 'gameover'
        this.state = 'menu';

        // Score counters
        this.score = 0;
        this.kills = 0;
        this.wave  = 1;

        // Entity pools
        this.enemies   = [];
        this.bullets   = [];
        this.particles = [];
        this.player    = null;

        // Wave management
        this.waveActive  = false;
        this.enemiesLeft = 0;
        this.spawnTimer  = 0;

        // ── Aggregated input state (written by event listeners) ───────────────
        this.input = {
            keys:          new Set(),   // lowercase key strings currently held
            mouseX:        0,
            mouseY:        0,
            shooting:      false,       // LMB held
            dashPressed:   false,       // RMB pressed this frame
            reloadPressed: false,       // R pressed this frame
        };

        this._raf       = null;
        this._lastTime  = 0;

        // Pre-bake the floor tile pattern once
        this._tileCanvas  = null;
        this._tilePattern = null;
        this._buildTilePattern();

        this._registerEvents();
    }

    // ─── Floor tile ───────────────────────────────────────────────────────────

    _buildTilePattern() {
        const size = 64;
        const oc   = document.createElement('canvas');
        oc.width = oc.height = size;
        const c = oc.getContext('2d');
        c.fillStyle = '#0a120a';
        c.fillRect(0, 0, size, size);
        c.strokeStyle = 'rgba(255,255,255,0.032)';
        c.lineWidth   = 1;
        c.strokeRect(0, 0, size, size);
        this._tileCanvas  = oc;
        this._tilePattern = this.ctx.createPattern(oc, 'repeat');
    }

    /** Resize canvas to fill the window (called on load and on every resize event). */
    resize() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Pattern must be recreated after canvas resize
        if (this._tileCanvas)
            this._tilePattern = this.ctx.createPattern(this._tileCanvas, 'repeat');
    }

    // ─── Event registration ───────────────────────────────────────────────────
    // Events used (20 total — more than the required 10):
    //  Keyboard:  ① keydown  ② keyup
    //  Mouse:     ③ mousemove  ④ mousedown  ⑤ mouseup  ⑥ contextmenu  ⑦ wheel
    //  Window:    ⑧ resize  ⑨ blur  ⑩ focus  ⑪ visibilitychange
    //  Game loop: ⑫ requestAnimationFrame  ⑬ setTimeout
    //  Custom:    ⑭ enemyDied  ⑮ playerDied  ⑯ gameStart
    //             ⑰ gameOver  ⑱ waveStart  ⑲ waveComplete
    //  UI clicks: ⑳ click (play / resume / quit / restart / mute buttons)

    _registerEvents() {

        // ① keydown
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            this.input.keys.add(key);
            if (key === 'r')      this.input.reloadPressed = true;
            if (key === 'escape') this._onEscape();
        });

        // ② keyup
        window.addEventListener('keyup', (e) => {
            this.input.keys.delete(e.key.toLowerCase());
        });

        // ③ mousemove — track cursor for aiming and crosshair rendering
        window.addEventListener('mousemove', (e) => {
            this.input.mouseX = e.clientX;
            this.input.mouseY = e.clientY;
        });

        // ④ mousedown — LMB = shoot, RMB = dash
        window.addEventListener('mousedown', (e) => {
            Audio.resume();
            if (e.button === 0) this.input.shooting   = true;
            if (e.button === 2) this.input.dashPressed = true;
        });

        // ⑤ mouseup — stop shooting
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.input.shooting = false;
        });

        // ⑥ contextmenu — suppress browser menu so RMB works as dash
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        // ⑦ wheel — reserved for a future weapon-cycle feature
        window.addEventListener('wheel', (_e) => {
            // Placeholder — swap weapon slot here in a future milestone
        }, { passive: true });

        // ⑧ resize — keep the canvas full-window at all times
        window.addEventListener('resize', () => this.resize());

        // ⑨ blur — auto-pause when the window loses focus
        window.addEventListener('blur', () => {
            if (this.state === 'playing') this._pause();
        });

        // ⑩ focus — the player decides when to resume (ESC or button)
        window.addEventListener('focus', () => { /* intentionally empty */ });

        // ⑪ visibilitychange — pause on tab switch
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing') this._pause();
        });

        // ⑭ Custom: enemyDied — award score and count kills
        document.addEventListener('enemyDied', () => {
            this.kills++;
            this.score += 100 * this.wave;
            this._updateHUD();
        });

        // ⑮ Custom: playerDied — delay then trigger game-over screen
        document.addEventListener('playerDied', () => {
            setTimeout(() => this._endGame(), 900); // ⑬ setTimeout
        });

        // Mute toggle button (click ⑳)
        document.getElementById('muteBtn').addEventListener('click', () => {
            Audio.resume();
            const m = Audio.toggleMute();
            document.getElementById('muteBtn').textContent = m ? '🔇 SFX OFF' : '🔊 SFX ON';
        });

        // Screen buttons (click ⑳)
        document.getElementById('playBtn')   .addEventListener('click', () => { Audio.resume(); this.startGame(); });
        document.getElementById('resumeBtn') .addEventListener('click', () => this._resume());
        document.getElementById('quitBtn')   .addEventListener('click', () => this._quitMenu());
        document.getElementById('restartBtn').addEventListener('click', () => { Audio.resume(); this.startGame(); });
        document.getElementById('menuBtn')   .addEventListener('click', () => this._quitMenu());
    }

    // ─── State transitions ────────────────────────────────────────────────────

    startGame() {
        // Reset all game data
        this.score = 0;
        this.kills = 0;
        this.wave  = 1;
        this.enemies   = [];
        this.bullets   = [];
        this.particles = [];

        const cx = this.canvas.width  / 2;
        const cy = this.canvas.height / 2;
        this.player = new Player(cx, cy);

        this.state = 'playing';
        this._showScreen(null);
        document.getElementById('hud').classList.add('on');
        this._updateHUD();
        this._startWave(1);

        // ⑫ requestAnimationFrame — start the game loop
        this._lastTime = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));

        // ⑯ Custom event: gameStart
        document.dispatchEvent(new CustomEvent('gameStart', { detail: { wave: 1 } }));
    }

    _pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        cancelAnimationFrame(this._raf);
        this._showScreen('pauseScreen');
    }

    _resume() {
        if (this.state !== 'paused') return;
        this.state = 'playing';
        this._showScreen(null);
        this._lastTime = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    _onEscape() {
        if      (this.state === 'playing') this._pause();
        else if (this.state === 'paused')  this._resume();
    }

    _quitMenu() {
        cancelAnimationFrame(this._raf);
        this.state = 'menu';
        document.getElementById('hud').classList.remove('on');
        this._showScreen('menuScreen');
        this._showBestScore();
    }

    _endGame() {
        cancelAnimationFrame(this._raf);
        this.state = 'gameover';
        Audio.gameOver();
        document.getElementById('hud').classList.remove('on');

        // Persist high score in localStorage
        const prev  = parseInt(localStorage.getItem('zombieBestScore') || '0');
        const isNew = this.score > prev;
        if (isNew) localStorage.setItem('zombieBestScore', String(this.score));

        document.getElementById('finalScore').textContent  = this.score;
        document.getElementById('finalWave') .textContent  = this.wave;
        document.getElementById('finalKills').textContent  = this.kills;
        document.getElementById('newBest')   .style.display = isNew ? 'block' : 'none';

        this._showScreen('gameOverScreen');

        // ⑰ Custom event: gameOver
        document.dispatchEvent(new CustomEvent('gameOver', {
            detail: { score: this.score, wave: this.wave, kills: this.kills },
        }));
    }

    _showScreen(id) {
        ['menuScreen', 'pauseScreen', 'gameOverScreen'].forEach((name) => {
            document.getElementById(name).classList.toggle('hidden', name !== id);
        });
    }

    _showBestScore() {
        const best = parseInt(localStorage.getItem('zombieBestScore') || '0');
        if (best > 0) {
            document.getElementById('bestChip').style.display = 'block';
            document.getElementById('bestVal') .textContent   = best;
        }
    }

    // ─── Wave management ──────────────────────────────────────────────────────

    _startWave(num) {
        this.wave        = num;
        this.waveActive  = true;
        this.enemiesLeft = 5 + num * 2;  // wave 1 → 7 enemies, wave 2 → 9, etc.
        this.spawnTimer  = 0;            // spawn first enemy immediately
        this._updateHUD();
        this._announce(`WAVE  ${num}`);
        Audio.waveUp();

        // ⑱ Custom event: waveStart
        document.dispatchEvent(new CustomEvent('waveStart', { detail: { wave: num } }));
    }

    _announce(text) {
        const el = document.getElementById('announce');
        el.textContent = text;
        el.classList.add('show');
        // ⑬ setTimeout — hide announcement after 2.2 s
        setTimeout(() => el.classList.remove('show'), 2200);
    }

    _checkWaveComplete() {
        if (!this.waveActive) return;
        if (this.enemiesLeft > 0) return;
        if (this.enemies.some(e => !e.dead)) return;

        this.waveActive = false;
        this._announce('WAVE CLEAR!');
        Audio.waveClear();

        // Restore 25 HP between waves
        if (this.player) {
            this.player.health = Math.min(this.player.maxHealth, this.player.health + 25);
        }

        // ⑲ Custom event: waveComplete
        document.dispatchEvent(new CustomEvent('waveComplete', { detail: { wave: this.wave } }));

        // ⑬ setTimeout — brief break before next wave
        setTimeout(() => {
            if (this.state === 'playing') this._startWave(this.wave + 1);
        }, 3200);
    }

    /** Drip-feed enemies onto the canvas edge over time. */
    _trySpawnEnemy(delta) {
        if (this.enemiesLeft <= 0) return;
        this.spawnTimer -= delta;
        if (this.spawnTimer > 0) return;

        // Random canvas edge
        const W = this.canvas.width, H = this.canvas.height;
        const side = Math.floor(Math.random() * 4);
        let ex, ey;
        switch (side) {
            case 0: ex = Math.random() * W; ey = -24;   break; // top
            case 1: ex = W + 24;            ey = Math.random() * H; break; // right
            case 2: ex = Math.random() * W; ey = H + 24; break; // bottom
            default: ex = -24;             ey = Math.random() * H; break; // left
        }

        // Speed increases each wave, capped at 2.2×
        const speedMult = Math.min(1 + (this.wave - 1) * 0.08, 2.2);
        this.enemies.push(new Enemy(ex, ey, speedMult));
        this.enemiesLeft--;

        // Spawn interval shrinks with wave (min 450 ms)
        this.spawnTimer = Math.max(450, 1600 - this.wave * 120);
    }

    // ─── Main loop (requestAnimationFrame ⑫) ─────────────────────────────────

    _loop(timestamp) {
        if (this.state !== 'playing') return;
        const delta = Math.min(timestamp - this._lastTime, 100); // cap spike at 100 ms
        this._lastTime = timestamp;
        this._update(delta);
        this._draw();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    // ─── Update ───────────────────────────────────────────────────────────────

    _update(delta) {
        if (!this.player) return;

        // Spawn queued enemies
        this._trySpawnEnemy(delta);

        // Update player — collect any bullets fired this frame
        const newBullets = this.player.update(this.input, delta);
        this.bullets.push(...newBullets);

        // Clamp player inside canvas bounds
        const W = this.canvas.width, H = this.canvas.height;
        const r = this.player.radius;
        this.player.x = Math.max(r, Math.min(W - r, this.player.x));
        this.player.y = Math.max(r, Math.min(H - r, this.player.y));

        // Update enemies — null player ref if dead (so enemies stop targeting)
        const livePlayer = this.player.dead ? null : this.player;
        for (const e of this.enemies) e.update(livePlayer, delta);
        this.enemies = this.enemies.filter(e => !e.dead);

        // Bullet vs enemy collision
        for (const b of this.bullets) {
            b.update(delta);
            if (b.dead) continue;

            for (const e of this.enemies) {
                if (e.fsm.isIn('DEAD', 'SPAWN')) continue;
                if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + b.radius) {
                    e.takeDamage(b.damage);
                    b.dead = true;
                    // Spawn blood-splatter particles at the impact point
                    for (let i = 0; i < 7; i++)
                        this.particles.push(new Particle(b.x, b.y, '#b71c1c'));
                    break;
                }
            }

            // Expire bullets that have left the visible canvas
            if (b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60) b.dead = true;
        }
        this.bullets = this.bullets.filter(b => !b.dead);

        // Particles
        for (const p of this.particles) p.update(delta);
        this.particles = this.particles.filter(p => !p.dead);

        // Check if the wave is over
        this._checkWaveComplete();

        // Sync HUD every frame
        this._updateHUD();
    }

    // ─── Draw ─────────────────────────────────────────────────────────────────

    _draw() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;

        // Floor
        ctx.fillStyle = this._tilePattern || '#0a120a';
        ctx.fillRect(0, 0, W, H);

        // Edge vignette
        const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.85);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.62)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);

        // Red vignette flash when the player is hit
        if (this.player?.hurtFlash > 0) {
            const a   = (this.player.hurtFlash / 280) * 0.38;
            const hvg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
            hvg.addColorStop(0, 'rgba(180,0,0,0)');
            hvg.addColorStop(1, `rgba(180,0,0,${a})`);
            ctx.fillStyle = hvg;
            ctx.fillRect(0, 0, W, H);
        }

        // Danger glow around the player when an enemy is very close
        if (this.player && !this.player.dead) {
            const closest = this.enemies.reduce((min, e) => {
                if (e.fsm.isIn('DEAD', 'SPAWN')) return min;
                return Math.min(min, Math.hypot(this.player.x - e.x, this.player.y - e.y));
            }, Infinity);

            if (closest < 90) {
                const t  = 1 - closest / 90;
                const dg = ctx.createRadialGradient(
                    this.player.x, this.player.y, 10,
                    this.player.x, this.player.y, 100
                );
                dg.addColorStop(0, 'rgba(255,30,0,0)');
                dg.addColorStop(1, `rgba(255,30,0,${t * 0.18})`);
                ctx.fillStyle = dg;
                ctx.beginPath();
                ctx.arc(this.player.x, this.player.y, 100, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Entities — back to front: bullets, particles, enemies, player
        for (const b of this.bullets)   b.draw(ctx);
        for (const p of this.particles) p.draw(ctx);
        for (const e of this.enemies)   e.draw(ctx);
        if (this.player) this.player.draw(ctx);

        // Crosshair overlay
        this._drawCrosshair(ctx);
    }

    _drawCrosshair(ctx) {
        const { mouseX: mx, mouseY: my } = this.input;
        const r = 11, gap = 4;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(mx - r - gap, my); ctx.lineTo(mx - gap, my);
        ctx.moveTo(mx + gap, my);     ctx.lineTo(mx + r + gap, my);
        ctx.moveTo(mx, my - r - gap); ctx.lineTo(mx, my - gap);
        ctx.moveTo(mx, my + gap);     ctx.lineTo(mx, my + r + gap);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.restore();
    }

    // ─── HUD sync ─────────────────────────────────────────────────────────────

    _updateHUD() {
        if (!this.player) return;

        // Health bar
        const hp    = this.player.health / this.player.maxHealth;
        const hFill = document.getElementById('healthFill');
        hFill.style.width      = (hp * 100) + '%';
        hFill.style.background = hp > 0.5 ? '#4caf50' : hp > 0.25 ? '#ff9800' : '#f44336';

        // Dash cooldown bar
        document.getElementById('dashFill').style.width =
            (this.player.dashFraction * 100) + '%';

        // Counters
        document.getElementById('scoreVal').textContent = this.score;
        document.getElementById('waveVal') .textContent = this.wave;
        document.getElementById('killsVal').textContent = this.kills;

        // Ammo / reload indicator
        const reloading = this.player.reloading;
        document.getElementById('reloadMsg').style.display = reloading ? 'block' : 'none';
        document.getElementById('ammoNum')  .style.display = reloading ? 'none'  : 'block';
        if (!reloading)
            document.getElementById('ammoNum').firstChild.textContent = this.player.ammo;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP  — runs after the page finishes loading (window load event ⑳+1)
// ════════════════════════════════════════════════════════════════════════════

window.addEventListener('load', () => {
    Audio.resume();

    const canvas = document.getElementById('gameCanvas');
    const game   = new Game(canvas);
    game.resize();
    game._showBestScore();

    // Animate the background while on the menu screen (uses its own rAF loop)
    let menuRaf;
    function menuLoop() {
        if (game.state !== 'menu') return;
        const ctx = game.ctx;
        ctx.fillStyle = game._tilePattern || '#0a120a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Slow green radial pulse
        const now = Date.now() / 1000;
        const cx  = canvas.width / 2, cy = canvas.height / 2;
        const pulse = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cx, cy));
        const a = 0.05 + 0.03 * Math.sin(now * 0.8);
        pulse.addColorStop(0,   `rgba(76,175,80,${a})`);
        pulse.addColorStop(0.5, 'rgba(76,175,80,0.01)');
        pulse.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = pulse;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        menuRaf = requestAnimationFrame(menuLoop);
    }
    menuRaf = requestAnimationFrame(menuLoop);

    // Kill menu animation when the game begins
    document.addEventListener('gameStart', () => cancelAnimationFrame(menuRaf));

    // Restart it if the player returns to the menu
    document.getElementById('quitBtn').addEventListener('click', () =>
        requestAnimationFrame(menuLoop));
    document.getElementById('menuBtn').addEventListener('click', () =>
        requestAnimationFrame(menuLoop));
});