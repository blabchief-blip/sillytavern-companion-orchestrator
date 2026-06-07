/**
 * pose_presets — Melisa v1.1.2 trust 9+ presets (wearing_his_shirt, morning_cuddle, sleepy_kitchen, shower_steam)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../mocks/st.js';
import { BUILTIN_POSES } from '../../modules/pose_presets.js';

describe('Melisa v1.1.2 — Trust 9+ intimate presets', () => {

  test('wearing_his_shirt preset var ve trust_floor 9', () => {
    assert.ok(BUILTIN_POSES.wearing_his_shirt, 'wearing_his_shirt preset tanımlı olmalı');
    assert.equal(BUILTIN_POSES.wearing_his_shirt.trust_floor, 9);
    assert.equal(BUILTIN_POSES.wearing_his_shirt.spice, 4);
    assert.ok(BUILTIN_POSES.wearing_his_shirt.tags.includes('wearing_his_shirt'));
    assert.ok(BUILTIN_POSES.wearing_his_shirt.tags.includes('morning_after'));
    assert.ok(BUILTIN_POSES.wearing_his_shirt.tags.includes('post_climax'));
    assert.ok(BUILTIN_POSES.wearing_his_shirt.tags.includes('tender'));
  });

  test('morning_cuddle preset var ve trust_floor 9', () => {
    assert.ok(BUILTIN_POSES.morning_cuddle);
    assert.equal(BUILTIN_POSES.morning_cuddle.trust_floor, 9);
    assert.equal(BUILTIN_POSES.morning_cuddle.spice, 4);
    assert.ok(BUILTIN_POSES.morning_cuddle.tags.includes('morning_cuddle'));
    assert.ok(BUILTIN_POSES.morning_cuddle.tags.includes('head_on_chest'));
    assert.ok(BUILTIN_POSES.morning_cuddle.tags.includes('tangled_sheets'));
  });

  test('sleepy_kitchen preset var ve trust_floor 9', () => {
    assert.ok(BUILTIN_POSES.sleepy_kitchen);
    assert.equal(BUILTIN_POSES.sleepy_kitchen.trust_floor, 9);
    assert.equal(BUILTIN_POSES.sleepy_kitchen.spice, 3);
    assert.ok(BUILTIN_POSES.sleepy_kitchen.tags.includes('kitchen_morning'));
    assert.ok(BUILTIN_POSES.sleepy_kitchen.tags.includes('wearing_his_shirt'));
    assert.ok(BUILTIN_POSES.sleepy_kitchen.tags.includes('barefoot'));
  });

  test('shower_steam preset var ve trust_floor 9', () => {
    assert.ok(BUILTIN_POSES.shower_steam);
    assert.equal(BUILTIN_POSES.shower_steam.trust_floor, 9);
    assert.equal(BUILTIN_POSES.shower_steam.spice, 4);
    assert.ok(BUILTIN_POSES.shower_steam.tags.includes('post_shower'));
    assert.ok(BUILTIN_POSES.shower_steam.tags.includes('towel_wrapped'));
    assert.ok(BUILTIN_POSES.shower_steam.tags.includes('steam'));
  });

  test('tüm yeni preset\'ler trust_floor 9 veya üstü (intimate tier)', () => {
    const newPresets = ['wearing_his_shirt', 'morning_cuddle', 'sleepy_kitchen', 'shower_steam'];
    for (const key of newPresets) {
      const p = BUILTIN_POSES[key];
      assert.ok(p.trust_floor >= 9, `${key} trust_floor 9+ olmalı (got ${p.trust_floor})`);
    }
  });

  test('mevcut preset\'ler etkilenmedi (regression)', () => {
    // v0.6.1'deki 12 preset hâlâ var
    const old = ['intimate_seated', 'holding_close', 'forehead_kiss', 'kissing_close', 'neck_kiss', 'dancing_close', 'pinned_wall', 'foreplay_soft', 'under_blanket', 'lying_together', 'aftercare', 'domestic_intimacy'];
    for (const key of old) {
      assert.ok(BUILTIN_POSES[key], `${key} hâlâ var olmalı`);
    }
  });

  test('toplam preset sayısı 16 (12 eski + 4 yeni)', () => {
    assert.equal(Object.keys(BUILTIN_POSES).length, 16);
  });

  test('yeni preset tag\'leri çakışmıyor (her preset unique tag seti)', () => {
    const newPresets = ['wearing_his_shirt', 'morning_cuddle', 'sleepy_kitchen', 'shower_steam'];
    const sigs = newPresets.map(k => BUILTIN_POSES[k].tags.sort().join('|'));
    const unique = new Set(sigs);
    assert.equal(unique.size, newPresets.length, 'Her preset unique tag signature olmalı');
  });
});
