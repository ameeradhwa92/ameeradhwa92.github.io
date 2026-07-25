const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluate } = require('../assets/js/aimeer-device.js');

const capable = {
  hasWebGPU: true,
  maxBufferSize: 1_500_000_000,
  saveData: false
};

test('routes iOS to cloud only', () => {
  const result = evaluate({
    ...capable,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    platform: 'iPhone',
    maxTouchPoints: 5
  });

  assert.deepEqual(
    { isIOS: result.isIOS, localEligible: result.localEligible, cloudPreferred: result.cloudPreferred },
    { isIOS: true, localEligible: false, cloudPreferred: true }
  );
});

test('allows a desktop WebGPU device with enough buffer to use local AI', () => {
  const result = evaluate({
    ...capable,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
    maxTouchPoints: 0
  });

  assert.deepEqual(
    { isDesktop: result.isDesktop, localEligible: result.localEligible, cloudPreferred: result.cloudPreferred },
    { isDesktop: true, localEligible: true, cloudPreferred: false }
  );
});

test('prefers cloud on desktop when the adapter buffer is insufficient', () => {
  const result = evaluate({
    ...capable,
    maxBufferSize: 1_499_999_999,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    platform: 'Linux x86_64',
    maxTouchPoints: 0
  });

  assert.equal(result.localEligible, false);
  assert.equal(result.cloudPreferred, true);
});

test('allows a recognized flagship Android family to use local AI', () => {
  const result = evaluate({
    ...capable,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S25 Ultra) AppleWebKit/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5
  });

  assert.equal(result.isAndroid, true);
  assert.equal(result.androidTier, 'flagship');
  assert.equal(result.localEligible, true);
  assert.equal(result.cloudPreferred, false);
});

test('defaults an unknown Android model to cloud', () => {
  const result = evaluate({
    ...capable,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Generic Phone)',
    platform: 'Linux armv8l',
    maxTouchPoints: 5
  });

  assert.equal(result.androidTier, 'unknown');
  assert.equal(result.localEligible, false);
  assert.equal(result.cloudPreferred, true);
});

test('defaults a recognized mid-range Android family to cloud', () => {
  const result = evaluate({
    ...capable,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-A556E)',
    platform: 'Linux armv8l',
    maxTouchPoints: 5
  });

  assert.equal(result.androidTier, 'mid');
  assert.equal(result.localEligible, false);
  assert.equal(result.cloudPreferred, true);
});

test('prefers cloud when Save-Data is enabled', () => {
  const result = evaluate({
    ...capable,
    saveData: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    platform: 'Win32',
    maxTouchPoints: 0
  });

  assert.equal(result.localEligible, true);
  assert.equal(result.cloudPreferred, true);
});
