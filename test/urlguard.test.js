import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateIp } from '../src/urlguard.js';

test('private IPs are detected', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('assertPublicUrl rejects unsafe URLs', async () => {
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost:4100', 'http://127.0.0.1/', 'http://safuswap.localhost:4100/', 'http://169.254.169.254/latest', 'https://user:pw@example.com', 'https://example.com:8443/', 'http://[::1]/', 'http://intranet/']) {
    await assert.rejects(assertPublicUrl(u), u);
  }
});
