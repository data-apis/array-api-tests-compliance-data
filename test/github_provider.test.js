'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs/promises');
var fetchArtifact = require('./../lib/node_modules/@data-apis/providers/github/fetch-artifact');
var decodePayload = require('./../lib/node_modules/@data-apis/payload/decode');

/**
* Creates a complete mocked GitHub Actions REST fetcher.
*
* @param {Object} [options] - behavior overrides
* @returns {Object} fetcher and captured calls
*/
function githubMock(options) {
	var calls = [];
	var zipPromise = fs.readFile('test/fixtures/array_api_compliance.json.zip');

	options = options || {};
	return {
		calls: calls,
		fetch: async function mock(url, init) {
			var value = new URL(url);
			var body;

			calls.push({ url: value.href, authorization: init.headers.get('authorization') });
			if (value.hostname === 'storage.example.test') {
				return new Response(await zipPromise, { status: 200 });
			}
			if (value.pathname === '/repos/data-apis/array-api-tests-compliance-data') {
				body = { id: options.projectId || 1234, full_name: 'data-apis/array-api-tests-compliance-data' };
			} else if (value.pathname.endsWith('/actions/workflows/demo.yml')) {
				body = { id: 55, state: 'active', path: '.github/workflows/demo.yml' };
			} else if (value.pathname.endsWith('/actions/workflows/55/runs')) {
				body = {
					workflow_runs: [
						{
							id: 1,
							run_attempt: 1,
							run_started_at: '2026-08-24T10:00:00Z',
							event: 'pull_request',
							head_branch: 'main',
							head_sha: 'b'.repeat(40),
							head_repository: { id: 1234, full_name: 'data-apis/array-api-tests-compliance-data' }
						},
						{
							id: 2,
							run_attempt: 2,
							run_started_at: '2026-08-24T11:00:00Z',
							event: 'workflow_dispatch',
							head_branch: 'main',
							head_sha: 'c'.repeat(40),
							head_repository: { id: 1234, full_name: 'data-apis/array-api-tests-compliance-data' }
						}
					]
				};
			} else if (value.pathname.endsWith('/actions/runs/2/artifacts')) {
				body = {
					artifacts: options.missingArtifact ? [] : [{
						id: 99,
						name: 'array_api_compliance.json',
						expired: false,
						size_in_bytes: 100,
						created_at: '2026-08-24T11:01:00Z'
					}]
				};
			} else if (value.pathname.endsWith('/actions/artifacts/99/zip')) {
				return new Response(null, {
					status: 302,
					headers: { location: 'https://storage.example.test/signed.zip' }
				});
			} else {
				throw new Error('Unexpected mock request: ' + value.href);
			}
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
	};
}

/**
* Returns the registered GitHub source fixture.
*
* @returns {Object} source
*/
function source() {
	return {
		id: 'demo',
		type: 'ci_artifact',
		provider: 'github',
		project: 'data-apis/array-api-tests-compliance-data',
		ref: { kind: 'branch', name: 'main' },
		selector: { workflow: 'demo.yml', artifact: 'array_api_compliance.json' }
	};
}

test('selects the newest trusted GitHub run and strips auth from signed storage', async function () {
	var mock = githubMock();
	var result = await fetchArtifact({
		source: source(),
		token: 'read-token',
		fetchImpl: mock.fetch,
		maxRetries: 1
	});
	var decoded = await decodePayload(result.bytes);
	var signed = mock.calls.find(function find(call) { return call.url.includes('storage.example.test'); });

	assert.equal(result.origin.run.id, '2');
	assert.equal(result.origin.project.id, '1234');
	assert.equal(decoded.candidates.length, 1);
	assert.equal(signed.authorization, null);
});

test('rejects a changed immutable project ID and missing latest artifact', async function () {
	var mock = githubMock();

	await assert.rejects(fetchArtifact({
		source: source(),
		token: 'read-token',
		fetchImpl: mock.fetch,
		expectedProjectId: '9999',
		maxRetries: 1
	}), /immutable ID/);
	mock = githubMock({ missingArtifact: true });
	await assert.rejects(fetchArtifact({
		source: source(),
		token: 'read-token',
		fetchImpl: mock.fetch,
		maxRetries: 1
	}), /exactly one/);
});
