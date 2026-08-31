'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var os = require('node:os');
var fs = require('node:fs/promises');
var runHarvest = require('./../../lib/node_modules/@data-apis/harvest/run');
var publish = require('./../../lib/node_modules/@data-apis/publish/run');
var sha256 = require('./../../lib/node_modules/@data-apis/canonical/sha256');
var serializeIndex = require('./../../lib/node_modules/@data-apis/record/serialize-index');
var createWorkspace = require('./helpers/create_workspace.js');
var urlRegistry = require('./helpers/url_registry.js');

var BASE_SHA = 'a'.repeat(40);

/**
* Rewrites one manifested bundle file and updates its size and digest.
*
* @param {string} output - bundle directory
* @param {string} relative - manifested path
* @param {Buffer|string} bytes - replacement bytes
* @returns {Promise<void>} promise
*/
async function rewriteBundleFile(output, relative, bytes) {
	var value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	var manifestPath = path.join(output, 'manifest.json');
	var manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	var item = manifest.files.find(function find(file) { return file.path === relative; });

	await fs.writeFile(path.join(output, ...relative.split('/')), value);
	item.size = value.length;
	item.sha256 = sha256(value);
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

/**
* Creates a successful Git Data API mock.
*
* @param {string} refSha - current ref SHA
* @returns {Object} fetcher and calls
*/
function gitDataMock(refSha) {
	var calls = [];
	var blobCount = 0;

	return {
		calls: calls,
		fetch: async function mock(url, init) {
			var route = new URL(url).pathname;
			var body = init.body ? JSON.parse(init.body) : undefined;
			var response;

			calls.push({ route: route, method: init.method, body: body });
			if (init.method === 'GET' && route.endsWith('/git/ref/heads/main')) {
				response = { object: { sha: refSha } };
			} else if (init.method === 'GET' && route.endsWith('/git/commits/' + BASE_SHA)) {
				response = { tree: { sha: 'base-tree' } };
			} else if (init.method === 'POST' && route.endsWith('/git/blobs')) {
				blobCount += 1;
				response = { sha: 'blob-' + blobCount };
			} else if (init.method === 'POST' && route.endsWith('/git/trees')) {
				response = { sha: 'new-tree' };
			} else if (init.method === 'POST' && route.endsWith('/git/commits')) {
				response = { sha: 'new-commit' };
			} else if (init.method === 'PATCH' && route.endsWith('/git/refs/heads/main')) {
				response = { object: { sha: 'new-commit' } };
			} else {
				throw new Error('Unexpected publication request: ' + init.method + ' ' + route);
			}
			return new Response(JSON.stringify(response), { status: 200 });
		}
	};
}

test('publishes only manifest files through a non-force atomic ref update', async function () {
	var root = await createWorkspace(urlRegistry());
	var report = await fs.readFile('test/harvester/fixtures/minimal_report.json');
	var harvest = await runHarvest({
		rootDirectory: root,
		now: Date.parse('2026-08-24T12:00:00Z'),
		baseSha: BASE_SHA,
		adapters: {
			url: async function adapter(context) {
				return { bytes: report, origin: { type: 'url', endpoint: context.source.url } };
			}
		}
	});
	var mock = gitDataMock(BASE_SHA);
	var result = await publish({
		rootDirectory: root,
		outputDirectory: harvest.outputDirectory,
		repository: 'data-apis/array-api-tests-compliance-data',
		branch: 'main',
		token: 'write-token',
		expectedBaseSha: BASE_SHA,
		fetchImpl: mock.fetch
	});
	var update = mock.calls.find(function find(call) {
		return call.method === 'PATCH';
	});

	assert.equal(result.published, true);
	assert.equal(result.commitSha, 'new-commit');
	assert.deepEqual(update.body, { sha: 'new-commit', force: false });
	assert.equal(mock.calls.filter(function blobs(call) { return call.route.endsWith('/git/blobs'); }).length, 2);
});

test('refuses publication when the branch advanced', async function () {
	var root = await createWorkspace(urlRegistry());
	var report = await fs.readFile('test/harvester/fixtures/minimal_report.json');
	var harvest = await runHarvest({
		rootDirectory: root,
		now: Date.parse('2026-08-24T12:00:00Z'),
		baseSha: BASE_SHA,
		adapters: {
			url: async function adapter(context) {
				return { bytes: report, origin: { type: 'url', endpoint: context.source.url } };
			}
		}
	});
	var mock = gitDataMock('b'.repeat(40));

	await assert.rejects(publish({
		rootDirectory: root,
		outputDirectory: harvest.outputDirectory,
		repository: 'data-apis/array-api-tests-compliance-data',
		branch: 'main',
		token: 'write-token',
		fetchImpl: mock.fetch
	}), /advanced/);
	assert.equal(mock.calls.some(function mutation(call) { return call.method === 'POST'; }), false);
});

test('rejects a rehashed but semantically tampered index before network access', async function () {
	var root = await createWorkspace(urlRegistry());
	var harvest = await runHarvest({
		rootDirectory: root,
		now: Date.parse('2026-08-24T12:00:00Z'),
		baseSha: BASE_SHA,
		adapters: {
			url: async function adapter(context) {
				return {
					bytes: await fs.readFile('test/harvester/fixtures/minimal_report.json'),
					origin: { type: 'url', endpoint: context.source.url }
				};
			}
		}
	});
	var indexPath = path.join(harvest.outputDirectory, 'data/index.json');
	var index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
	var mock = gitDataMock(BASE_SHA);

	index.records[0].version = 'tampered';
	await rewriteBundleFile(harvest.outputDirectory, 'data/index.json', serializeIndex(index.records));
	await assert.rejects(publish({
		rootDirectory: root,
		outputDirectory: harvest.outputDirectory,
		repository: 'data-apis/array-api-tests-compliance-data',
		branch: 'main',
		token: 'write-token',
		expectedBaseSha: BASE_SHA,
		fetchImpl: mock.fetch
	}), /does not agree with new record/);
	assert.equal(mock.calls.length, 0);
});

test('rejects summary/manifest disagreement before network access', async function () {
	var root = await createWorkspace(urlRegistry());
	var report = await fs.readFile('test/harvester/fixtures/minimal_report.json');
	var harvest = await runHarvest({
		rootDirectory: root,
		now: Date.parse('2026-08-24T12:00:00Z'),
		baseSha: BASE_SHA,
		adapters: {
			url: async function adapter(context) {
				return { bytes: report, origin: { type: 'url', endpoint: context.source.url } };
			}
		}
	});
	var summaryPath = path.join(harvest.outputDirectory, 'summary.json');
	var summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
	var mock = gitDataMock(BASE_SHA);

	summary.new_records = [];
	await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
	await assert.rejects(publish({
		rootDirectory: root,
		outputDirectory: harvest.outputDirectory,
		repository: 'data-apis/array-api-tests-compliance-data',
		branch: 'main',
		token: 'write-token',
		expectedBaseSha: BASE_SHA,
		fetchImpl: mock.fetch
	}), /summary and manifest records differ/i);
	assert.equal(mock.calls.length, 0);
});

test('creates no commit for an empty manifest', async function () {
	var root = await fs.mkdtemp(path.join(os.tmpdir(), 'array-api-publish-empty-'));
	var output = path.join(root, 'output');

	await fs.mkdir(output);
	await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
		schema: 'harvest-manifest-v1',
		base_sha: BASE_SHA,
		files: []
	}, null, 2) + '\n');
	await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({
		schema: 'harvest-summary-v1',
		base_sha: BASE_SHA,
		has_source_errors: false,
		new_records: [],
		sources: [],
		warnings: []
	}, null, 2) + '\n');
	var result = await publish({
		rootDirectory: root,
		outputDirectory: output,
		repository: 'data-apis/array-api-tests-compliance-data',
		branch: 'main',
		token: 'write-token'
	});

	assert.equal(result.published, false);
});
