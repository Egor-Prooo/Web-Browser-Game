/**
 * main.js — Game orchestrator and entry point.
 */

import { Audio }                        from './audio.js';
import { createEnemy, rollEnemyType }   from './enemy.js';
import { Player }                        from './player.js';

// ─── Particle ─────────────────────────────────────────────────────────────────

class Particle {
    constructor(x, y, color = '#c62828') {
        this.x = x; this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 140;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.color = color;
        this.r    = 1.5 + Math.random() * 3;
        this.life = 350 + Math.random() * 350;
        this.age  = 0;
    }
    update(delta) {
        this.x += this.vx * delta / 1000;
        this.y += this.vy * delta / 1000;
        this.vx *= 0.93; this.vy *= 0.93;
        this.age += delta;
    }
    draw(ctx) {
        const p = 1 - this.age / this.life;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * p, 0, Math.PI * 2);
        ctx.fillStyle   = this.color;
        ctx.globalAlpha = p;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    get dead() { return this.age >= this.life; }
}

// Floating score labels ("+150  RUNNER") that rise and fade
class ScoreLabel {
    constructor(x, y, text, color = '#ffb300') {
        this.x = x; this.y = y;
        this.text  = text;
        this.color = color;
        this.life  = 900;
        this.age   = 0;
    }
    update(delta) { this.y -= 28 * delta / 1000; this.age += delta; }
    draw(ctx) {
        const p = 1 - this.age / this.life;
        ctx.save();
        ctx.globalAlpha  = p;
        ctx.font         = 'bold 13px "Share Tech Mono", monospace';
        ctx.textAlign    = 'center';
        ctx.fillStyle    = this.color;
        ctx.shadowColor  = this.color;
        ctx.shadowBlur   = 6;
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
    get dead() { return this.age >= this.life; }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.state  = 'menu';

        this.score = 0;
        this.kills = 0;
        this.wave  = 1;

        this.enemies     = [];
        this.bullets     = [];
        this.particles   = [];
        this.scoreLabels = [];
        this.player      = null;

        this.waveActive  = false;
        this.enemiesLeft = 0;
        this.spawnTimer  = 0;

        this.input = {
            keys:          new Set(),
            mouseX:        0,
            mouseY:        0,
            shooting:      false,
            dashPressed:   false,
            reloadPressed: false,
        };

        this._raf      = null;
        this._lastTime = 0;
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
        c.fillStyle = '#0a120a'; c.fillRect(0, 0, size, size);
        c.strokeStyle = 'rgba(255,255,255,0.032)'; c.lineWidth = 1;
        c.strokeRect(0, 0, size, size);
        this._tileCanvas  = oc;
        this._tilePattern = this.ctx.createPattern(oc, 'repeat');
    }

    resize() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this._tileCanvas)
            this._tilePattern = this.ctx.createPattern(this._tileCanvas, 'repeat');
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _registerEvents() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            this.input.keys.add(key);
            if (key === 'r')      this.input.reloadPressed = true;
            if (key === 'escape') this._onEscape();
        });

        window.addEventListener('keyup', (e) => {
            this.input.keys.delete(e.key.toLowerCase());
        });

        window.addEventListener('mousemove', (e) => {
            this.input.mouseX = e.clientX;
            this.input.mouseY = e.clientY;
        });

        window.addEventListener('mousedown', (e) => {
            Audio.resume();
            if (e.button === 0) this.input.shooting   = true;
            if (e.button === 2) this.input.dashPressed = true;
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.input.shooting = false;
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('wheel', () => {}, { passive: true });
        window.addEventListener('resize', () => this.resize());

        window.addEventListener('blur', () => {
            this.input.keys.clear();
            this.input.shooting = false;
            if (this.state === 'playing') this._pause();
        });

        window.addEventListener('focus', () => {});

        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing') this._pause();
        });

        document.addEventListener('enemyDied', (ev) => {
            this.kills++;
            const bonus = ev.detail?.scoreBonus ?? 100;
            this.score += bonus * this.wave;
            // Floating score label
            const e = ev.detail?.enemy;
            if (e) {
                const color = { zombie:'#ef9a9a', runner:'#ffcc80', brute:'#ce93d8', spitter:'#a5d6a7' }[e.type] ?? '#ffb300';
                const label = e.type ? `+${bonus * this.wave}  ${e.type.toUpperCase()}` : `+${bonus * this.wave}`;
                this.scoreLabels.push(new ScoreLabel(e.x, e.y - e.radius - 10, label, color));
            }
            this._updateHUD();
        });

        document.addEventListener('playerDied', () => {
            setTimeout(() => this._endGame(), 900);
        });

        document.getElementById('muteBtn').addEventListener('click', () => {
            Audio.resume();
            const m = Audio.toggleMute();
            document.getElementById('muteBtn').textContent = m ? '🔇 SFX OFF' : '🔊 SFX ON';
        });

        document.getElementById('playBtn')   .addEventListener('click', () => { Audio.resume(); this.startGame(); });
        document.getElementById('resumeBtn') .addEventListener('click', () => this._resume());
        document.getElementById('quitBtn')   .addEventListener('click', () => this._quitMenu());
        document.getElementById('restartBtn').addEventListener('click', () => { Audio.resume(); this.startGame(); });
        document.getElementById('menuBtn')   .addEventListener('click', () => this._quitMenu());
    }

    // ─── State transitions ────────────────────────────────────────────────────

    startGame() {
        this.score = 0; this.kills = 0; this.wave = 1;
        this.enemies = []; this.bullets = []; this.particles = []; this.scoreLabels = [];

        const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
        this.player = new Player(cx, cy);

        this.state = 'playing';
        this._showScreen(null);
        document.getElementById('hud').classList.add('on');
        this._updateHUD();
        this._startWave(1);

        if (document.activeElement && document.activeElement !== document.body)
            document.activeElement.blur();

        this._lastTime = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
        document.dispatchEvent(new CustomEvent('gameStart', { detail: { wave: 1 } }));
    }

    _pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        this.input.keys.clear();
        cancelAnimationFrame(this._raf);
        this._showScreen('pauseScreen');
    }

    _resume() {
        if (this.state !== 'paused') return;
        this.state = 'playing';
        this._showScreen(null);
        if (document.activeElement && document.activeElement !== document.body)
            document.activeElement.blur();
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

        const prev  = parseInt(localStorage.getItem('zombieBestScore') || '0');
        const isNew = this.score > prev;
        if (isNew) localStorage.setItem('zombieBestScore', String(this.score));

        document.getElementById('finalScore').textContent   = this.score;
        document.getElementById('finalWave') .textContent   = this.wave;
        document.getElementById('finalKills').textContent   = this.kills;
        document.getElementById('newBest')   .style.display = isNew ? 'block' : 'none';

        this._showScreen('gameOverScreen');
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
        this.enemiesLeft = 5 + num * 2;
        this.spawnTimer  = 0;
        this._updateHUD();
        this._announce(`WAVE  ${num}`);
        Audio.waveUp();
        document.dispatchEvent(new CustomEvent('waveStart', { detail: { wave: num } }));
    }

    _announce(text) {
        const el = document.getElementById('announce');
        el.textContent = text;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2200);
    }

    _checkWaveComplete() {
        if (!this.waveActive) return;
        if (this.enemiesLeft > 0) return;
        if (this.enemies.some(e => !e.dead)) return;

        this.waveActive = false;
        this._announce('WAVE CLEAR!');
        Audio.waveClear();

        if (this.player)
            this.player.health = Math.min(this.player.maxHealth, this.player.health + 25);

        document.dispatchEvent(new CustomEvent('waveComplete', { detail: { wave: this.wave } }));
        setTimeout(() => { if (this.state === 'playing') this._startWave(this.wave + 1); }, 3200);
    }

    _trySpawnEnemy(delta) {
        if (this.enemiesLeft <= 0) return;
        this.spawnTimer -= delta;
        if (this.spawnTimer > 0) return;

        const W = this.canvas.width, H = this.canvas.height;
        const side = Math.floor(Math.random() * 4);
        let ex, ey;
        switch (side) {
            case 0: ex = Math.random() * W; ey = -24;    break;
            case 1: ex = W + 24;            ey = Math.random() * H; break;
            case 2: ex = Math.random() * W; ey = H + 24; break;
            default: ex = -24;             ey = Math.random() * H; break;
        }

        const speedMult = Math.min(1 + (this.wave - 1) * 0.08, 2.2);
        const type = rollEnemyType(this.wave);
        this.enemies.push(createEnemy(type, ex, ey, speedMult));
        this.enemiesLeft--;
        this.spawnTimer = Math.max(450, 1600 - this.wave * 120);
    }

    // ─── Main loop ────────────────────────────────────────────────────────────

    _loop(timestamp) {
        if (this.state !== 'playing') return;
        const delta = Math.min(timestamp - this._lastTime, 100);
        this._lastTime = timestamp;
        this._update(delta);
        this._draw();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    // ─── Update ───────────────────────────────────────────────────────────────

    _update(delta) {
        if (!this.player) return;

        this._trySpawnEnemy(delta);

        const newBullets = this.player.update(this.input, delta);
        this.bullets.push(...newBullets);

        // Clamp player to canvas
        const W = this.canvas.width, H = this.canvas.height;
        const r = this.player.radius;
        this.player.x = Math.max(r, Math.min(W - r, this.player.x));
        this.player.y = Math.max(r, Math.min(H - r, this.player.y));

        const livePlayer = this.player.dead ? null : this.player;
        for (const e of this.enemies) e.update(livePlayer, delta);
        this.enemies = this.enemies.filter(e => !e.dead);

        // Bullet vs enemy
        for (const b of this.bullets) {
            b.update(delta);
            if (b.dead) continue;
            for (const e of this.enemies) {
                if (e.fsm.isIn('DEAD', 'SPAWN')) continue;
                if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + b.radius) {
                    e.takeDamage(b.damage);
                    b.dead = true;
                    const splashColor = e.type === 'brute'   ? '#9c27b0'
                                      : e.type === 'runner'  ? '#ff7043'
                                      : e.type === 'spitter' ? '#76ff03'
                                      : '#b71c1c';
                    for (let i = 0; i < 7; i++)
                        this.particles.push(new Particle(b.x, b.y, splashColor));
                    break;
                }
            }
            if (b.x < -80 || b.x > W + 80 || b.y < -80 || b.y > H + 80) b.dead = true;
        }
        this.bullets = this.bullets.filter(b => !b.dead);

        // Acid blob vs player (Spitter projectiles)
        if (livePlayer) {
            for (const e of this.enemies) {
                for (const blob of e.projectiles) {
                    if (blob.dead) continue;
                    if (Math.hypot(blob.x - livePlayer.x, blob.y - livePlayer.y) < livePlayer.radius + blob.radius) {
                        livePlayer.takeDamage(blob.damage);
                        blob.dead = true;
                        for (let i = 0; i < 5; i++)
                            this.particles.push(new Particle(blob.x, blob.y, '#76ff03'));
                    }
                }
                // Cull off-screen blobs
                e.projectiles = e.projectiles.filter(b => {
                    if (b.dead) return false;
                    if (b.x < -80 || b.x > W+80 || b.y < -80 || b.y > H+80) return false;
                    return true;
                });
            }
        }

        // Particles & labels
        for (const p of this.particles)   p.update(delta);
        for (const l of this.scoreLabels) l.update(delta);
        this.particles   = this.particles.filter(p => !p.dead);
        this.scoreLabels = this.scoreLabels.filter(l => !l.dead);

        this._checkWaveComplete();
        this._updateHUD();
    }

    // ─── Draw ─────────────────────────────────────────────────────────────────

    _draw() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;

        ctx.fillStyle = this._tilePattern || '#0a120a';
        ctx.fillRect(0, 0, W, H);

        // Edge vignette
        const vig = ctx.createRadialGradient(W/2,H/2,H*0.15, W/2,H/2,H*0.85);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.62)');
        ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

        // Hurt flash
        if (this.player?.hurtFlash > 0) {
            const a   = (this.player.hurtFlash / 280) * 0.38;
            const hvg = ctx.createRadialGradient(W/2,H/2,0, W/2,H/2,Math.hypot(W,H)/2);
            hvg.addColorStop(0, 'rgba(180,0,0,0)');
            hvg.addColorStop(1, `rgba(180,0,0,${a})`);
            ctx.fillStyle = hvg; ctx.fillRect(0, 0, W, H);
        }

        // Danger glow
        if (this.player && !this.player.dead) {
            const closest = this.enemies.reduce((min, e) => {
                if (e.fsm.isIn('DEAD','SPAWN')) return min;
                return Math.min(min, Math.hypot(this.player.x - e.x, this.player.y - e.y));
            }, Infinity);
            if (closest < 90) {
                const t  = 1 - closest / 90;
                const dg = ctx.createRadialGradient(this.player.x,this.player.y,10, this.player.x,this.player.y,100);
                dg.addColorStop(0, 'rgba(255,30,0,0)');
                dg.addColorStop(1, `rgba(255,30,0,${t*0.18})`);
                ctx.fillStyle = dg;
                ctx.beginPath(); ctx.arc(this.player.x,this.player.y,100,0,Math.PI*2); ctx.fill();
            }
        }

        for (const b of this.bullets)   b.draw(ctx);
        for (const p of this.particles) p.draw(ctx);
        for (const e of this.enemies)   e.draw(ctx);
        if (this.player) this.player.draw(ctx);
        for (const l of this.scoreLabels) l.draw(ctx);

        this._drawCrosshair(ctx);
    }

    _drawCrosshair(ctx) {
        const { mouseX: mx, mouseY: my } = this.input;
        const r = 11, gap = 4;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(mx-r-gap,my); ctx.lineTo(mx-gap,my);
        ctx.moveTo(mx+gap,my);   ctx.lineTo(mx+r+gap,my);
        ctx.moveTo(mx,my-r-gap); ctx.lineTo(mx,my-gap);
        ctx.moveTo(mx,my+gap);   ctx.lineTo(mx,my+r+gap);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(mx,my,2,0,Math.PI*2);
        ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fill();
        ctx.restore();
    }

    // ─── HUD sync ─────────────────────────────────────────────────────────────

    _updateHUD() {
        if (!this.player) return;
        const hp    = this.player.health / this.player.maxHealth;
        const hFill = document.getElementById('healthFill');
        hFill.style.width      = (hp * 100) + '%';
        hFill.style.background = hp > 0.5 ? '#4caf50' : hp > 0.25 ? '#ff9800' : '#f44336';
        document.getElementById('dashFill').style.width = (this.player.dashFraction * 100) + '%';
        document.getElementById('scoreVal').textContent = this.score;
        document.getElementById('waveVal') .textContent = this.wave;
        document.getElementById('killsVal').textContent = this.kills;
        const reloading = this.player.reloading;
        document.getElementById('reloadMsg').style.display = reloading ? 'block' : 'none';
        document.getElementById('ammoNum')  .style.display = reloading ? 'none'  : 'block';
        if (!reloading) document.getElementById('ammoNum').firstChild.textContent = this.player.ammo;
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
    Audio.resume();
    const canvas = document.getElementById('gameCanvas');
    const game   = new Game(canvas);
    game.resize();
    game._showBestScore();

    let menuRaf;
    function menuLoop() {
        if (game.state !== 'menu') return;
        const ctx = game.ctx;
        ctx.fillStyle = game._tilePattern || '#0a120a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const now = Date.now() / 1000;
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const pulse = ctx.createRadialGradient(cx,cy,0, cx,cy,Math.max(cx,cy));
        const a = 0.05 + 0.03 * Math.sin(now * 0.8);
        pulse.addColorStop(0,   `rgba(76,175,80,${a})`);
        pulse.addColorStop(0.5, 'rgba(76,175,80,0.01)');
        pulse.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = pulse;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        menuRaf = requestAnimationFrame(menuLoop);
    }
    menuRaf = requestAnimationFrame(menuLoop);

    document.addEventListener('gameStart', () => cancelAnimationFrame(menuRaf));
    document.getElementById('quitBtn').addEventListener('click', () => requestAnimationFrame(menuLoop));
    document.getElementById('menuBtn').addEventListener('click', () => requestAnimationFrame(menuLoop));
});