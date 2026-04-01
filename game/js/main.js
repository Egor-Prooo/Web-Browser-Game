/**
 * main.js — Game orchestrator with level system.
 *
 * Levels replace pure wave-mode with distinct layouts, objectives
 * and difficulty curves. See levels.js for level data.
 */

import { Audio }                                    from './audio.js';
import { createEnemy }                              from './enemy.js';
import { Player }                                   from './player.js';
import { LEVELS, getLevel, getTotalLevels,
         rollEnemyTypeForLevel as levelRoll }       from './levels.js';
import { drawArena, buildPatterns,
         getSpawnPoints, generateObstacles }        from './arena.js';

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

// ─── Level Intro Overlay ──────────────────────────────────────────────────────

class LevelIntro {
    constructor(levelData, onDone) {
        this.level  = levelData;
        this.onDone = onDone;
        this.el     = document.getElementById('levelIntroScreen');
        this._render();
        this.el.classList.remove('hidden');
    }

    _render() {
        const L = this.level;
        const objLabels = {
            eliminate: '⬡ ELIMINATE ALL WAVES',
            holdout:   '⏱ SURVIVE THE TIMER',
            defend:    '🛡 PROTECT THE CACHE',
        };

        this.el.innerHTML = `
            <div class="li-header">
                <div class="li-level-num">LEVEL ${L.id} / ${getTotalLevels()}</div>
                <div class="li-title">${L.name}</div>
                <div class="li-sub">${L.subtitle}</div>
            </div>
            <div class="li-objective">${objLabels[L.objective] ?? L.objective.toUpperCase()}</div>
            <div class="li-desc">${L.description}</div>
            <div class="li-briefing">
                ${L.briefing.map(line => `<div class="li-brief-line">▸ ${line}</div>`).join('')}
            </div>
            <button class="btn li-start-btn" id="liStartBtn">▶ &nbsp; DEPLOY</button>
        `;

        document.getElementById('liStartBtn').addEventListener('click', () => {
            Audio.resume();
            this.el.classList.add('hidden');
            this.onDone();
        });
    }

    dismiss() {
        this.el.classList.add('hidden');
    }
}

// ─── Level Complete Overlay ───────────────────────────────────────────────────

class LevelComplete {
    constructor(levelData, stats, isLastLevel, onNext, onMenu) {
        this.el = document.getElementById('levelCompleteScreen');

        const bonusText = `+${levelData.completionBonus} BONUS`;
        const nextText  = isLastLevel ? '⌂ &nbsp; MAIN MENU' : `▶ &nbsp; LEVEL ${levelData.id + 1}`;

        this.el.innerHTML = `
            <div class="lc-title">LEVEL CLEAR</div>
            <div class="lc-level">${levelData.name}</div>
            <div class="stat-block">
                KILLS &nbsp;&nbsp; <span class="big" style="color:#ef9a9a">${stats.kills}</span>
                SCORE &nbsp;&nbsp; <span class="big" style="color:#ffb300">${stats.score}</span>
                <span style="color:#a5d6a7;font-size:0.8em;letter-spacing:3px">${bonusText}</span>
            </div>
            <button class="btn" id="lcNextBtn">${nextText}</button>
            <button class="btn"  id="lcMenuBtn">⌂ &nbsp; MAIN MENU</button>
        `;

        document.getElementById('lcNextBtn').addEventListener('click', () => {
            Audio.resume();
            this.el.classList.add('hidden');
            if (isLastLevel) onMenu();
            else onNext();
        });
        document.getElementById('lcMenuBtn').addEventListener('click', () => {
            this.el.classList.add('hidden');
            onMenu();
        });

        this.el.classList.remove('hidden');
    }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.state  = 'menu';   // menu | levelIntro | playing | paused | levelComplete | gameover

        // Global run stats
        this.score = 0;
        this.kills = 0;

        // Level tracking
        this.currentLevelId = 1;
        this.levelData      = null;

        // Wave tracking (within a level)
        this.wave        = 1;
        this.waveActive  = false;
        this.enemiesLeft = 0;
        this.spawnTimer  = 0;

        // Holdout timer
        this.holdoutRemaining = 0;
        this.holdoutComplete  = false;

        // Defend objective
        this.objectiveHealth    = 0;
        this.objectiveMaxHealth = 0;
        this.objectivePos       = null;
        this.objectiveDead      = false;

        // Entity lists
        this.enemies     = [];
        this.bullets     = [];
        this.particles   = [];
        this.scoreLabels = [];
        this.player      = null;

        // Arena
        this.obstacles = [];

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
        this._menuRaf  = null;
        this._registerEvents();
    }

    // ─── Resize ───────────────────────────────────────────────────────────────

    resize() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        buildPatterns(this.ctx);
        if (this.state === 'menu') this._renderMenuBg();
    }

    _renderMenuBg() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.fillStyle = '#060a06';
        ctx.fillRect(0, 0, W, H);
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
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('blur', () => {
            this.input.keys.clear();
            this.input.shooting = false;
            if (this.state === 'playing') this._pause();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing') this._pause();
        });

        document.addEventListener('enemyDied', (ev) => {
            this.kills++;
            const bonus = ev.detail?.scoreBonus ?? 100;
            const wMult = this.wave;
            this.score += bonus * wMult;
            const e = ev.detail?.enemy;
            if (e) {
                const color = { zombie:'#ef9a9a', runner:'#ffcc80', brute:'#ce93d8', spitter:'#a5d6a7' }[e.type] ?? '#ffb300';
                this.scoreLabels.push(new ScoreLabel(e.x, e.y - e.radius - 10,
                    `+${bonus * wMult}  ${(e.type||'').toUpperCase()}`, color));
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

        document.getElementById('playBtn')   .addEventListener('click', () => { Audio.resume(); this._showLevelSelect(); });
        document.getElementById('resumeBtn') .addEventListener('click', () => this._resume());
        document.getElementById('quitBtn')   .addEventListener('click', () => this._quitMenu());
        document.getElementById('restartBtn').addEventListener('click', () => { Audio.resume(); this._restartLevel(); });
        document.getElementById('menuBtn')   .addEventListener('click', () => this._quitMenu());
    }

    // ─── Level select (or just kick into level 1) ─────────────────────────────

    _showLevelSelect() {
        // For now, build a simple level select screen replacing the menu temporarily
        const ls = document.getElementById('levelSelectScreen');
        ls.innerHTML = `
            <div class="screen-title" style="font-size:clamp(1.8rem,4vw,3rem);margin-bottom:0.3em">SELECT LEVEL</div>
            <div class="screen-sub" style="margin-bottom:1.5rem">CHOOSE YOUR BATTLEFIELD</div>
            <div class="ls-grid">
                ${LEVELS.map(L => {
                    const unlocked = this._isLevelUnlocked(L.id);
                    const cleared  = this._isLevelCleared(L.id);
                    return `
                    <div class="ls-card ${unlocked?'':'ls-locked'}" data-lid="${L.id}">
                        <div class="ls-num">0${L.id}</div>
                        <div class="ls-name">${L.name}</div>
                        <div class="ls-sub">${L.subtitle}</div>
                        <div class="ls-obj ls-obj-${L.objective}">${L.objective.toUpperCase()}</div>
                        ${cleared ? '<div class="ls-cleared">★ CLEARED</div>' : ''}
                        ${!unlocked ? '<div class="ls-lock-label">🔒 LOCKED</div>' : ''}
                    </div>`;
                }).join('')}
            </div>
            <button class="btn" id="lsBackBtn" style="margin-top:1.5rem">← BACK</button>
        `;

        ls.classList.remove('hidden');
        document.getElementById('menuScreen').classList.add('hidden');

        ls.querySelectorAll('.ls-card:not(.ls-locked)').forEach(card => {
            card.addEventListener('click', () => {
                ls.classList.add('hidden');
                const lid = parseInt(card.dataset.lid);
                this._startLevel(lid);
            });
        });
        document.getElementById('lsBackBtn').addEventListener('click', () => {
            ls.classList.add('hidden');
            document.getElementById('menuScreen').classList.remove('hidden');
        });
    }

    _isLevelUnlocked(id) {
        if (id === 1) return true;
        const cleared = parseInt(localStorage.getItem('zombieMaxLevel') || '0');
        return id <= cleared + 1;
    }

    _isLevelCleared(id) {
        const cleared = parseInt(localStorage.getItem('zombieMaxLevel') || '0');
        return id <= cleared;
    }

    // ─── Start a specific level ───────────────────────────────────────────────

    _startLevel(levelId) {
        this.currentLevelId = levelId;
        this.levelData      = getLevel(levelId);
        this.state          = 'levelIntro';
        this._showScreen(null);
        cancelAnimationFrame(this._menuRaf);

        new LevelIntro(this.levelData, () => {
            this._initLevel();
        });
    }

    _initLevel() {
        const L = this.levelData;

        // Reset level state
        this.enemies     = [];
        this.bullets     = [];
        this.particles   = [];
        this.scoreLabels = [];
        this.wave        = 1;
        this.waveActive  = false;
        this.enemiesLeft = 0;
        this.spawnTimer  = 0;

        // First level also resets run score; continuing levels accumulate
        if (this.currentLevelId === 1) {
            this.score = 0;
            this.kills = 0;
        }

        // Holdout setup
        this.holdoutRemaining = L.holdoutTime ?? 0;
        this.holdoutComplete  = false;

        // Defend objective setup
        if (L.objective === 'defend') {
            this.objectiveMaxHealth = L.objectiveHealth ?? 200;
            this.objectiveHealth    = this.objectiveMaxHealth;
            this.objectivePos       = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
            this.objectiveDead      = false;
        } else {
            this.objectivePos  = null;
            this.objectiveDead = false;
        }

        // Obstacles for ruins
        this.obstacles = L.layout === 'ruins' ? generateObstacles(this.canvas.width, this.canvas.height) : [];

        // Spawn player away from objective
        const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
        const px = cx, py = cy + 140;
        this.player = new Player(px, py);

        this.state = 'playing';
        this._showScreen(null);
        document.getElementById('hud').classList.add('on');
        this._updateHUD();

        this._startWave(1);

        if (document.activeElement && document.activeElement !== document.body)
            document.activeElement.blur();

        this._lastTime = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    _restartLevel() {
        cancelAnimationFrame(this._raf);
        this._showScreen(null);
        this._startLevel(this.currentLevelId);
    }

    // ─── State transitions ────────────────────────────────────────────────────

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
        document.getElementById('levelSelectScreen').classList.add('hidden');
        document.getElementById('levelIntroScreen').classList.add('hidden');
        document.getElementById('levelCompleteScreen').classList.add('hidden');
        this._showScreen('menuScreen');
        this._showBestScore();
        this._startMenuLoop();
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

        // Show level name in game over
        const lvlEl = document.getElementById('finalLevel');
        if (lvlEl && this.levelData) lvlEl.textContent = this.levelData.name;

        this._showScreen('gameOverScreen');
    }

    _levelComplete() {
        cancelAnimationFrame(this._raf);
        this.state = 'levelComplete';
        document.getElementById('hud').classList.remove('on');
        Audio.waveClear();

        // Apply completion bonus
        this.score += this.levelData.completionBonus ?? 0;

        // Save progress
        const prevMax = parseInt(localStorage.getItem('zombieMaxLevel') || '0');
        if (this.currentLevelId > prevMax)
            localStorage.setItem('zombieMaxLevel', String(this.currentLevelId));

        const prevBest = parseInt(localStorage.getItem('zombieBestScore') || '0');
        if (this.score > prevBest)
            localStorage.setItem('zombieBestScore', String(this.score));

        const isLast = this.currentLevelId >= getTotalLevels();

        new LevelComplete(
            this.levelData,
            { kills: this.kills, score: this.score },
            isLast,
            () => this._startLevel(this.currentLevelId + 1),  // next level
            () => this._quitMenu()
        );
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
        const L = this.levelData;
        this.wave       = num;
        this.waveActive = true;

        if (L.objective === 'holdout') {
            // Infinite enemies — just maintain spawn pressure
            this.enemiesLeft = 999;
        } else {
            this.enemiesLeft = (L.enemyCountBase ?? 5) + (num - 1) * (L.enemyCountPerWave ?? 2);
        }

        this.spawnTimer = 0;
        this._updateHUD();

        if (L.objective === 'holdout') {
            this._announce(`SURVIVE!`);
        } else {
            this._announce(`WAVE  ${num}`);
        }
        Audio.waveUp();
    }

    _announce(text) {
        const el = document.getElementById('announce');
        el.textContent = text;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2200);
    }

    _checkLevelComplete() {
        const L = this.levelData;
        if (!this.waveActive) return;

        // Defend: fail if objective destroyed
        if (L.objective === 'defend' && this.objectiveDead) {
            this._endGame();
            return;
        }

        // Holdout: timer expired = win
        if (L.objective === 'holdout') {
            if (this.holdoutComplete) {
                this.waveActive = false;
                setTimeout(() => { if (this.state === 'playing') this._levelComplete(); }, 1500);
            }
            return;
        }

        // Eliminate: all waves cleared
        if (L.objective === 'eliminate' || L.objective === 'defend') {
            if (this.enemiesLeft > 0) return;
            if (this.enemies.some(e => !e.dead)) return;
            this.waveActive = false;

            // More waves to go?
            if (this.wave < (L.waves ?? 3)) {
                this._announce('WAVE CLEAR!');
                Audio.waveClear();
                if (this.player)
                    this.player.health = Math.min(this.player.maxHealth, this.player.health + 20);
                setTimeout(() => { if (this.state === 'playing') this._startWave(this.wave + 1); }, 3000);
            } else {
                // Level complete
                this._announce('LEVEL CLEAR!');
                Audio.waveClear();
                setTimeout(() => { if (this.state === 'playing') this._levelComplete(); }, 2000);
            }
        }
    }

    _trySpawnEnemy(delta) {
        if (this.enemiesLeft <= 0) return;
        this.spawnTimer -= delta;
        if (this.spawnTimer > 0) return;

        const L = this.levelData;
        const W = this.canvas.width, H = this.canvas.height;
        const { x: ex, y: ey } = getSpawnPoints(L.layout, W, H);

        const speedMult = Math.min(
            1 + (this.wave - 1) * 0.1 * (L.difficulty ?? 1),
            2.2
        ) * (L.difficulty ?? 1);

        const type = levelRoll(L, this.wave);
        this.enemies.push(createEnemy(type, ex, ey, speedMult));

        if (L.objective !== 'holdout') this.enemiesLeft--;
        this.spawnTimer = Math.max(300, (L.spawnDelay ?? 1600) - this.wave * 80);
    }

    // ─── Objective: defend — enemies attack the cache ─────────────────────────

    _updateObjective(delta) {
        if (!this.objectivePos || this.objectiveDead) return;
        for (const e of this.enemies) {
            if (e.fsm.isIn('DEAD', 'SPAWN')) continue;
            const dist = Math.hypot(e.x - this.objectivePos.x, e.y - this.objectivePos.y);
            if (dist < 40 + e.radius) {
                // Enemy gnaws at the objective
                this.objectiveHealth -= 0.035 * delta;
                if (this.objectiveHealth <= 0) {
                    this.objectiveHealth = 0;
                    this.objectiveDead   = true;
                    this._announce('CACHE DESTROYED!');
                    // brief delay then game over
                    setTimeout(() => this._endGame(), 1800);
                }
            }
        }
        // Acid blobs vs objective
        for (const e of this.enemies) {
            for (const blob of e.projectiles) {
                if (blob.dead) continue;
                const dist = Math.hypot(blob.x - this.objectivePos.x, blob.y - this.objectivePos.y);
                if (dist < 30) {
                    this.objectiveHealth = Math.max(0, this.objectiveHealth - blob.damage * 2);
                    blob.dead = true;
                    for (let i = 0; i < 4; i++)
                        this.particles.push(new Particle(blob.x, blob.y, '#76ff03'));
                }
            }
        }
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

        // Holdout timer
        if (this.levelData?.objective === 'holdout' && this.waveActive) {
            this.holdoutRemaining = Math.max(0, this.holdoutRemaining - delta);
            if (this.holdoutRemaining <= 0 && !this.holdoutComplete) {
                this.holdoutComplete = true;
                // Stop spawning
                this.enemiesLeft = 0;
            }
            this._updateHUD();
        }

        this._trySpawnEnemy(delta);

        const newBullets = this.player.update(this.input, delta);
        this.bullets.push(...newBullets);

        // Clamp player to canvas
        const W = this.canvas.width, H = this.canvas.height;
        const r = this.player.radius;
        this.player.x = Math.max(r, Math.min(W - r, this.player.x));
        this.player.y = Math.max(r, Math.min(H - r, this.player.y));

        // Clamp player out of wall obstacles (ruins layout)
        for (const ob of this.obstacles) {
            const nearX = Math.max(ob.x, Math.min(ob.x + ob.w, this.player.x));
            const nearY = Math.max(ob.y, Math.min(ob.y + ob.h, this.player.y));
            const dist  = Math.hypot(this.player.x - nearX, this.player.y - nearY);
            if (dist < r) {
                const nx = (this.player.x - nearX) / (dist || 1);
                const ny = (this.player.y - nearY) / (dist || 1);
                this.player.x = nearX + nx * (r + 1);
                this.player.y = nearY + ny * (r + 1);
            }
        }

        const livePlayer = this.player.dead ? null : this.player;

        // Feed enemies: direct toward objective if defend mode, else player
        const enemyTarget = (this.levelData?.objective === 'defend' && this.objectivePos && !this.objectiveDead)
            ? this._blendTarget(livePlayer)
            : livePlayer;

        for (const e of this.enemies) e.update(enemyTarget, delta);
        this.enemies = this.enemies.filter(e => !e.dead);

        // Bullet vs enemy
        for (const b of this.bullets) {
            b.update(delta);
            if (b.dead) continue;

            // Bullet vs obstacles
            let blocked = false;
            for (const ob of this.obstacles) {
                if (b.x > ob.x && b.x < ob.x+ob.w && b.y > ob.y && b.y < ob.y+ob.h) {
                    b.dead = true; blocked = true;
                    for (let i = 0; i < 3; i++)
                        this.particles.push(new Particle(b.x, b.y, '#607d8b'));
                    break;
                }
            }
            if (blocked) continue;

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
            if (b.x < -80 || b.x > W+80 || b.y < -80 || b.y > H+80) b.dead = true;
        }
        this.bullets = this.bullets.filter(b => !b.dead);

        // Acid blobs vs player
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
                e.projectiles = e.projectiles.filter(b => {
                    if (b.dead) return false;
                    if (b.x < -80 || b.x > W+80 || b.y < -80 || b.y > H+80) return false;
                    return true;
                });
            }
        }

        // Defend objective
        this._updateObjective(delta);

        for (const p of this.particles)   p.update(delta);
        for (const l of this.scoreLabels) l.update(delta);
        this.particles   = this.particles.filter(p => !p.dead);
        this.scoreLabels = this.scoreLabels.filter(l => !l.dead);

        this._checkLevelComplete();
        this._updateHUD();
    }

    /** In defend mode, enemies split attention: 60% move to objective, 40% to player */
    _blendTarget(livePlayer) {
        if (!livePlayer) return this.objectivePos;
        return Math.random() < 0.6 ? this.objectivePos : livePlayer;
    }

    // ─── Draw ─────────────────────────────────────────────────────────────────

    _draw() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        const L = this.levelData;

        // Arena background
        drawArena(ctx, W, H, L?.layout ?? 'open', {
            objectivePos:    this.objectivePos,
            objectiveHealth: this.objectivePos ? this.objectiveHealth / this.objectiveMaxHealth : 1,
            obstacles:       this.obstacles,
        });

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

        // Holdout timer bar (top centre)
        if (L?.objective === 'holdout' && this.waveActive) {
            this._drawHoldoutBar(ctx, W, H);
        }

        this._drawCrosshair(ctx);
    }

    _drawHoldoutBar(ctx, W, H) {
        const L         = this.levelData;
        const total     = L.holdoutTime;
        const remaining = this.holdoutRemaining;
        const frac      = remaining / total;
        const secs      = Math.ceil(remaining / 1000);

        const barW = Math.min(400, W * 0.45);
        const barH = 10;
        const bx   = W / 2 - barW / 2;
        const by   = 56;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        // Fill
        const color = frac > 0.5 ? '#00e5ff' : frac > 0.25 ? '#ff9800' : '#f44336';
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barW * frac, barH);

        // Pulse on last 10s
        if (secs <= 10) {
            ctx.fillStyle = `rgba(255,80,0,${0.3 * Math.abs(Math.sin(Date.now()/200))})`;
            ctx.fillRect(bx, by, barW * frac, barH);
        }

        // Label
        ctx.font      = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(`SURVIVE — ${secs}s`, W / 2, by - 5);
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

        // Objective health display
        const objBar = document.getElementById('objectiveBar');
        if (objBar) {
            if (this.objectivePos && !this.objectiveDead) {
                objBar.style.display = 'flex';
                const pct = this.objectiveHealth / this.objectiveMaxHealth;
                document.getElementById('objFill').style.width      = (pct * 100) + '%';
                document.getElementById('objFill').style.background = pct > 0.5 ? '#ffb300' : pct > 0.25 ? '#ff6d00' : '#f44336';
            } else {
                objBar.style.display = 'none';
            }
        }

        // Level name badge
        const lvlBadge = document.getElementById('levelBadge');
        if (lvlBadge && this.levelData) lvlBadge.textContent = `LVL ${this.currentLevelId}  ${this.levelData.name}`;
    }

    // ─── Menu loop ────────────────────────────────────────────────────────────

    _startMenuLoop() {
        const canvas = this.canvas;
        const ctx    = this.ctx;
        const loop = () => {
            if (this.state !== 'menu') return;
            const W = canvas.width, H = canvas.height;
            ctx.fillStyle = '#060a06';
            ctx.fillRect(0, 0, W, H);
            const now = Date.now() / 1000;
            const cx = W / 2, cy = H / 2;
            const pulse = ctx.createRadialGradient(cx,cy,0, cx,cy,Math.max(cx,cy));
            const a = 0.05 + 0.03 * Math.sin(now * 0.8);
            pulse.addColorStop(0,   `rgba(76,175,80,${a})`);
            pulse.addColorStop(0.5, 'rgba(76,175,80,0.01)');
            pulse.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = pulse;
            ctx.fillRect(0, 0, W, H);
            this._menuRaf = requestAnimationFrame(loop);
        };
        this._menuRaf = requestAnimationFrame(loop);
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
    Audio.resume();
    const canvas = document.getElementById('gameCanvas');
    const game   = new Game(canvas);
    game.resize();
    game._showBestScore();
    game._startMenuLoop();

    // Expose for debugging
    window._game = game;
});