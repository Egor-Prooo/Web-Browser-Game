/**
 * levels.js — Level definitions for Zombie Survival Arena.
 *
 * Each level has:
 *  - id, name, subtitle
 *  - objective: 'survive' | 'defend' | 'eliminate' | 'holdout'
 *  - waves: number of waves before level complete (or timer for holdout)
 *  - layout: arena type that main.js renders
 *  - spawnConfig: enemy mix overrides
 *  - difficulty: multiplier applied to speedMult and counts
 *  - description: shown on the level intro screen
 *  - briefing: tactical text shown in the intro
 */

export const LEVELS = [
    {
        id:        1,
        name:      'THE OUTBREAK',
        subtitle:  'SURVIVE THE HORDE',
        objective: 'eliminate',
        waves:     3,
        layout:    'open',
        difficulty: 1.0,
        enemyCountBase: 5,
        enemyCountPerWave: 2,
        spawnDelay: 1600,
        allowedTypes: ['zombie'],
        description: 'The dead are rising. Eliminate every wave.',
        briefing:   [
            'THREAT: Basic infected',
            'OBJECTIVE: Eliminate 3 waves',
            'TIP: Headshots kill faster — aim center mass',
        ],
        completionBonus: 500,
    },
    {
        id:        2,
        name:      'RUNNERS',
        subtitle:  'THEY\'RE FAST',
        objective: 'eliminate',
        waves:     3,
        layout:    'open',
        difficulty: 1.1,
        enemyCountBase: 6,
        enemyCountPerWave: 3,
        spawnDelay: 1400,
        allowedTypes: ['zombie', 'runner'],
        runnerChance: 0.55,
        description: 'Faster infected have been spotted. Clear all waves.',
        briefing:   [
            'THREAT: Standard + Runner infected',
            'OBJECTIVE: Eliminate 3 waves',
            'TIP: Runners zigzag — lead your shots',
        ],
        completionBonus: 750,
    },
    {
        id:        3,
        name:      'LAST STAND',
        subtitle:  'HOLD THE LINE',
        objective: 'holdout',
        holdoutTime: 90000,  // 90 seconds
        layout:    'corridor',
        difficulty: 1.25,
        enemyCountBase: 99,  // infinite spawns
        spawnDelay: 1100,
        allowedTypes: ['zombie', 'runner', 'spitter'],
        description: 'Survive 90 seconds in the narrow corridor.',
        briefing:   [
            'THREAT: Mixed infected — walls are tight',
            'OBJECTIVE: Survive for 90 seconds',
            'TIP: The corridor limits flanking — watch both ends',
        ],
        completionBonus: 1200,
    },
    {
        id:        4,
        name:      'DEFEND THE CACHE',
        subtitle:  'PROTECT THE SUPPLY',
        objective: 'defend',
        waves:     4,
        layout:    'defend',
        difficulty: 1.35,
        enemyCountBase: 7,
        enemyCountPerWave: 3,
        spawnDelay: 1000,
        allowedTypes: ['zombie', 'runner', 'spitter'],
        description: 'Protect the supply cache from all enemies. If it\'s destroyed, you fail.',
        briefing:   [
            'THREAT: Mixed infected — targeting supply cache',
            'OBJECTIVE: Protect cache through 4 waves',
            'TIP: Position yourself BETWEEN enemies and the cache',
        ],
        objectiveHealth: 200,
        completionBonus: 1500,
    },
    {
        id:        5,
        name:      'THE SIEGE',
        subtitle:  'BRUTES INBOUND',
        objective: 'eliminate',
        waves:     4,
        layout:    'ruins',
        difficulty: 1.5,
        enemyCountBase: 8,
        enemyCountPerWave: 3,
        spawnDelay: 900,
        allowedTypes: ['zombie', 'runner', 'brute', 'spitter'],
        bruteChance: 0.25,
        description: 'Heavy infected have arrived. Brutes hit like trucks.',
        briefing:   [
            'THREAT: Full mix including BRUTES',
            'OBJECTIVE: Clear 4 waves',
            'WARNING: Brutes deal 60 damage per slam — DASH away',
        ],
        completionBonus: 2000,
    },
    {
        id:        6,
        name:      'NIGHTMARE',
        subtitle:  'NO MERCY',
        objective: 'holdout',
        holdoutTime: 120000, // 2 minutes
        layout:    'open',
        difficulty: 1.8,
        enemyCountBase: 99,
        spawnDelay: 700,
        allowedTypes: ['zombie', 'runner', 'brute', 'spitter'],
        description: 'Maximum difficulty. Survive 2 minutes of unrelenting assault.',
        briefing:   [
            'THREAT: All types — no restrictions',
            'OBJECTIVE: Survive 2 minutes',
            'WARNING: Speed and damage are significantly increased',
        ],
        completionBonus: 3000,
    },
];

export function getLevel(id) {
    return LEVELS.find(l => l.id === id) ?? LEVELS[LEVELS.length - 1];
}

export function getTotalLevels() {
    return LEVELS.length;
}

/**
 * Picks an enemy type based on the level's allowed types and any bias weights.
 */
export function rollEnemyTypeForLevel(level, wave) {
    const types = level.allowedTypes ?? ['zombie'];

    // Build a weighted pool
    const pool = [];
    for (const t of types) {
        if (t === 'zombie') {
            const w = level.zombieChance ?? (types.length === 1 ? 10 : 4);
            for (let i = 0; i < w; i++) pool.push('zombie');
        } else if (t === 'runner') {
            const w = level.runnerChance ? Math.round(level.runnerChance * 10) : 3;
            for (let i = 0; i < w; i++) pool.push('runner');
        } else if (t === 'brute') {
            const w = level.bruteChance ? Math.round(level.bruteChance * 10) : 2;
            for (let i = 0; i < w; i++) pool.push('brute');
        } else if (t === 'spitter') {
            const w = level.spitterChance ? Math.round(level.spitterChance * 10) : 2;
            for (let i = 0; i < w; i++) pool.push('spitter');
        }
    }

    return pool[Math.floor(Math.random() * pool.length)] ?? 'zombie';
}