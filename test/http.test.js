'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fetchBounded = require('./../lib/node_modules/@data-apis/http/fetch-bounded');

test('strips authorization before following an HTTPS redirect', async function () {
	var calls = [];
	var fetchImpl = async function mock(url, init) {
		calls.push({ url: String(url), authorization: init.headers.get('authorization') });
		if (calls.length === 1) {
			return new Response(null, {
				status: 302,
				headers: { location: 'https://storage.example.test/report.json' }
			});
		}
		return new Response('{"ok":true}', { status: 200 });
	};
	var result = await fetchBounded('https://api.example.test/report', {
		fetchImpl: fetchImpl,
		headers: { authorization: 'Bearer secret' }
	});

	assert.equal(result.bytes.toString(), '{"ok":true}');
	assert.equal(calls[0].authorization, 'Bearer secret');
	assert.equal(calls[1].authorization, null);
});

test('rejects insecure redirects and decoded responses over the byte cap', async function () {
	await assert.rejects(fetchBounded('https://example.test/report', {
		fetchImpl: async function redirect() {
			return new Response(null, { status: 302, headers: { location: 'http://example.test/report' } });
		}
	}), /HTTPS/);
	await assert.rejects(fetchBounded('https://example.test/report', {
		fetchImpl: async function large() {
			return new Response('1234567890', { status: 200 });
		},
		maxBytes: 5
	}), /exceeded/);
});

test('retries transient failures with a bounded policy', async function () {
	var calls = 0;
	var sleeps = 0;
	var cancellations = 0;
	var result = await fetchBounded('https://example.test/report', {
		fetchImpl: async function transient() {
			calls += 1;
			return calls < 3 ? new Response(new ReadableStream({
				start: function start(controller) {
					controller.enqueue(new TextEncoder().encode('later'));
				},
				cancel: function cancel() {
					cancellations += 1;
				}
			}), { status: 503 }) : new Response('ok', { status: 200 });
		},
		sleep: async function noDelay() {
			sleeps += 1;
		}
	});

	assert.equal(result.bytes.toString(), 'ok');
	assert.equal(calls, 3);
	assert.equal(sleeps, 2);
	assert.equal(cancellations, 2);
});

test('recognizes provider rate-limit exhaustion and retains reset time', async function () {
	var reset = 1800000000;

	await assert.rejects(fetchBounded('https://api.example.test/report', {
		fetchImpl: async function exhausted() {
			return new Response('limited', {
				status: 403,
				headers: {
					'x-ratelimit-remaining': '0',
					'x-ratelimit-reset': String(reset)
				}
			});
		},
		maxRetries: 1
	}), function verify(error) {
		assert.equal(error.code, 'RATE_LIMITED');
		assert.equal(error.resetAt, new Date(reset * 1000).toISOString().replace('.000Z', 'Z'));
		return true;
	});
	await assert.rejects(fetchBounded('https://api.example.test/report', {
		fetchImpl: async function invalidReset() {
			return new Response('limited', {
				status: 403,
				headers: {
					'x-ratelimit-remaining': '0',
					'x-ratelimit-reset': String(Number.MAX_SAFE_INTEGER)
				}
			});
		},
		maxRetries: 1
	}), function verifyInvalidReset(error) {
		assert.equal(error.code, 'RATE_LIMITED');
		assert.equal(error.resetAt, undefined);
		return true;
	});
});

test('retains a sanitized endpoint and bounded JSON detail for HTTP errors', async function () {
	await assert.rejects(fetchBounded('https://api.example.test/repos/org/repo/actions/artifacts/123/zip?signature=secret', {
		fetchImpl: async function forbidden() {
			return new Response(JSON.stringify({
				message: 'Token expiration exceeds\norganization policy.'
			}), { status: 403 });
		}
	}), function verify(error) {
		assert.equal(error.code, 'HTTP_ERROR');
		assert.equal(error.message, 'HTTP 403 from https://api.example.test/repos/org/repo/actions/artifacts/123/zip: Token expiration exceeds organization policy.');
		assert.doesNotMatch(error.message, /signature|secret/);
		return true;
	});
});

test('does not let malformed or oversized error bodies mask HTTP failures', async function () {
	var bodies = [
		'not JSON',
		JSON.stringify({ message: 'x'.repeat(70 * 1024) })
	];

	for (const body of bodies) {
		await assert.rejects(fetchBounded('https://api.example.test/report?credential=secret', {
			fetchImpl: async function forbidden() {
				return new Response(body, { status: 403 });
			}
		}), function verify(error) {
			assert.equal(error.code, 'HTTP_ERROR');
			assert.equal(error.message, 'HTTP 403 from https://api.example.test/report');
			return true;
		});
	}
});
