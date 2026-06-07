/**
 * auto_gen ControlNet poz seçimi (v0.8.15)
 * SCENE_POSE_REFS eşlemesi: sahne tag'i → poz referans dosyası.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../mocks/st.js';
import { autoGenModule } from '../../modules/auto_gen.js';

describe('auto_gen poz referans seçimi', () => {
  test('explicit poz tag\'i doğru dosyaya eşlenir', () => {
    assert.equal(autoGenModule.selectPoseRef(['missionary']), 'explicit/missionary.png');
    assert.equal(autoGenModule.selectPoseRef(['doggystyle']), 'explicit/doggystyle.png');
    assert.equal(autoGenModule.selectPoseRef(['cowgirl_position']), 'explicit/cowgirl.png');
    assert.equal(autoGenModule.selectPoseRef(['blowjob']), 'explicit/oral.png');
  });

  test('çift/yakınlık poz tag\'i doğru dosyaya eşlenir', () => {
    assert.equal(autoGenModule.selectPoseRef(['straddling']), 'couple/straddling.png');
    assert.equal(autoGenModule.selectPoseRef(['embrace']), 'couple/embrace.png');
  });

  test('solo poz tag\'i doğru dosyaya eşlenir', () => {
    assert.equal(autoGenModule.selectPoseRef(['standing']), 'solo/standing.png');
    assert.equal(autoGenModule.selectPoseRef(['arching_back']), 'solo/arching.png');
  });

  test('öncelik: explicit > couple > solo (ilk eşleşen kazanır)', () => {
    // hem missionary (explicit) hem sitting (solo) → explicit kazanmalı
    assert.equal(autoGenModule.selectPoseRef(['sitting', 'missionary']), 'explicit/missionary.png');
  });

  test('eşleşme yoksa null döner (ControlNet atlanır)', () => {
    assert.equal(autoGenModule.selectPoseRef(['coffee_shop', 'happy']), null);
    assert.equal(autoGenModule.selectPoseRef([]), null);
    assert.equal(autoGenModule.selectPoseRef(null), null);
  });

  test('büyük/küçük harf duyarsız', () => {
    assert.equal(autoGenModule.selectPoseRef(['MISSIONARY']), 'explicit/missionary.png');
  });
});
