/**
 * v0.8.7 regression: index.js module registry
 *
 * v0.8.6'da `characterProfileModule` modules array'ine eklenmemişti.
 * Sonuç: ST production'da /co char her zaman "character_profile modülü
 * yüklenmedi" hatası veriyordu (Node test'lerinde init() manuel
 * çağrıldığı için bug yakalanmamıştı).
 *
 * Bu test `index.js` dosyasını parse edip tüm 23 modülün hem import
 * hem modules array'inde kayıtlı olduğunu doğrular.
 *
 * Yeni modül eklendiğinde bu test başarısız olur — kasıtlı.
 * "Failed" → ya modülü index.js'e ekle, ya da bu test listesini güncelle.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const indexPath = path.join(process.cwd(), 'index.js');
const indexSrc = fs.readFileSync(indexPath, 'utf8');

describe('index.js: modül registry bütünlüğü', () => {
    test('index.js dosyası okunabilir ve anlamlı uzunlukta', () => {
        assert.ok(indexSrc.length > 1000, 'index.js anlamlı uzunlukta');
    });

    test('v0.8.6 modülü: characterProfileModule import ediliyor', () => {
        // v0.8.6 öncesi 22 modül, v0.8.6 ile 23 modül oldu (character_profile eklendi).
        // Bu import satırı olmadan /co char prod'da "modül yüklü değil" hatası verir.
        assert.match(indexSrc, /import\s+\{\s*characterProfileModule\s*\}\s+from\s+'\.\/modules\/character_profile\.js';/,
            'index.js characterProfileModule import etmeli');
    });

    test('v0.8.6 modülü: characterProfileModule modules array\'inde', () => {
        // modules array'i orchestrator'ı kurarken init() için modülleri iterate eder.
        // Eğer burada yoksa init() çağrılmaz, globalThis.__co_characterProfile
        // set edilmez, /co char patlar.
        assert.match(indexSrc, /characterProfileModule\s*\]\s*;?\s*$/m,
            'characterProfileModule modules array sonunda olmalı (ya da listelenmiş)');
        // Daha güvenilir: array içinde geçiyor mu?
        const modulesArrayMatch = indexSrc.match(/const\s+modules\s*=\s*\[([\s\S]*?)\];/);
        assert.ok(modulesArrayMatch, 'modules array tanımı var');
        assert.match(modulesArrayMatch[1], /\bcharacterProfileModule\b/,
            'modules array içinde characterProfileModule referansı var');
    });

    test('TÜM beklenen modüller import ediliyor (v0.8.7 itibarıyla)', () => {
        const expectedImports = [
            'memoryModule', 'moodModule', 'scenariosModule', 'lorebookModule',
            'promptsModule', 'ioModule', 'spiceModule', 'limitsModule',
            'aftercareModule', 'stmbBridgeModule', 'imageGenModule', 'avatarDescModule',
            'kazumaBridgeModule', 'autoGenModule', 'llmTaggerModule', 'posePresetsModule',
            'customTagsModule', 'spiceIntensifyModule', 'charLoraProfilesModule',
            'promptTemplatesModule', 'tinderModule', 'booruPromptModule',
            'contentSafetyModule', 'antiGhostingModule', 'platformTransitionModule',
            'phoneShellModule', 'modernUIModule', 'characterProfileModule',
        ];
        for (const modName of expectedImports) {
            assert.match(indexSrc, new RegExp(`import\\s+\\{\\s*${modName}\\s*\\}`),
                `${modName} import ediliyor`);
        }
    });

    test('TÜM beklenen modüller modules array\'inde listelenmiş', () => {
        const modulesArrayMatch = indexSrc.match(/const\s+modules\s*=\s*\[([\s\S]*?)\];/);
        assert.ok(modulesArrayMatch, 'modules array tanımı var');
        const arrayBody = modulesArrayMatch[1];
        const expectedModules = [
            'memoryModule', 'moodModule', 'scenariosModule', 'lorebookModule',
            'promptsModule', 'ioModule', 'spiceModule', 'limitsModule',
            'aftercareModule', 'stmbBridgeModule', 'imageGenModule', 'avatarDescModule',
            'kazumaBridgeModule', 'autoGenModule', 'llmTaggerModule', 'posePresetsModule',
            'customTagsModule', 'spiceIntensifyModule', 'charLoraProfilesModule',
            'promptTemplatesModule', 'tinderModule', 'booruPromptModule',
            'contentSafetyModule', 'antiGhostingModule', 'platformTransitionModule',
            'phoneShellModule', 'modernUIModule', 'characterProfileModule',
        ];
        for (const modName of expectedModules) {
            assert.match(arrayBody, new RegExp(`\\b${modName}\\b`),
                `${modName} modules array\'inde`);
        }
    });

    test('modules array uzunluğu beklenen 28 (v0.8.7)', () => {
        const modulesArrayMatch = indexSrc.match(/const\s+modules\s*=\s*\[([\s\S]*?)\];/);
        const arrayBody = modulesArrayMatch[1];
        // Virgülle ayrılmış entry'leri say
        const entries = arrayBody.split(',').map(s => s.trim()).filter(s => /^\w+Module$/.test(s));
        assert.equal(entries.length, 28,
            `28 modül bekleniyor, var: ${entries.length} (${entries.join(', ')})`);
    });

    test('registerAllCommands init()\'ten SONRA çağrılıyor', () => {
        // Init tüm modülleri init etmeli, sonra commands register olmalı.
        // Aksi halde slash command callback çalıştığında modül namespace'leri
        // hazır olmaz (globalThis.__co_* set edilmemiş).
        const initBlock = indexSrc.match(/for\s*\(\s*const\s+mod\s+of\s+this\.modules\s*\)/);
        const registerCall = indexSrc.match(/registerAllCommands\s*\(\s*this\s*\)/);
        assert.ok(initBlock, 'init loop var');
        assert.ok(registerCall, 'registerAllCommands çağrısı var');
        const initPos = indexSrc.indexOf(initBlock[0]);
        const registerPos = indexSrc.indexOf(registerCall[0]);
        assert.ok(initPos < registerPos,
            'init loop registerAllCommands\'dan ÖNCE olmalı (init önce, register sonra)');
    });
});

describe('index.js: extension entry point\'leri export ediliyor', () => {
    test('onInstall / onEnable / onDisable export ediliyor', () => {
        assert.match(indexSrc, /export\s+async\s+function\s+onInstall/);
        assert.match(indexSrc, /export\s+async\s+function\s+onEnable/);
        assert.match(indexSrc, /export\s+async\s+function\s+onDisable/);
    });

    test('globalThis.CompanionOrchestrator set ediliyor', () => {
        // ST\'in extension\'a erişim noktası: globalThis\'a orchestrator
        // objesini atamak (F12 console\'dan inceleme için).
        assert.match(indexSrc, /globalThis\.CompanionOrchestrator\s*=\s*orchestrator/);
    });
});

describe('modules/character_profile.js: init() namespace pattern', () => {
    const cpPath = path.join(process.cwd(), 'modules', 'character_profile.js');
    const cpSrc = fs.readFileSync(cpPath, 'utf8');

    test('init() globalThis.__co_characterProfile set ediyor', () => {
        // commands.js bu namespace\'i okuyor: globalThis.__co_characterProfile
        // init() çağrıldıktan SONRA set edilmeli.
        assert.match(cpSrc, /globalThis\.__co_characterProfile\s*=\s*this/,
            'init içinde globalThis.__co_characterProfile = this var');
    });

    test('init() `_ctx = SillyTavern.getContext()` çağırıyor', () => {
        // Karakter lookup için ST context gerekli.
        assert.match(cpSrc, /SillyTavern\.getContext\(\)/);
    });
});

describe('modules/commands.js: cp lookup pattern', () => {
    const cmdPath = path.join(process.cwd(), 'modules', 'commands.js');
    const cmdSrc = fs.readFileSync(cmdPath, 'utf8');

    test('cp lookup: globalThis.__co_characterProfile okunuyor', () => {
        // /co char subcommand içinde cp değişkeni init ediliyor.
        const charBlock = cmdSrc.match(/if\s*\(\s*sub\s*===\s*'char'\s*\)/);
        assert.ok(charBlock, 'sub === "char" branch var');
        const afterChar = cmdSrc.slice(cmdSrc.indexOf(charBlock[0]));
        assert.match(afterChar.slice(0, 2000), /__co_characterProfile/,
            'char branch içinde globalThis.__co_characterProfile referansı var');
    });
});
