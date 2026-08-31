'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var fs = require('node:fs/promises');
var constants = require('node:fs').constants;
var sha256 = require('./../lib/node_modules/@data-apis/canonical/sha256');
var serializeIndex = require('./../lib/node_modules/@data-apis/record/serialize-index');
var HarvesterError = require('./../lib/node_modules/@data-apis/errors/harvester-error');
var gzipEnvelope = require('./../lib/node_modules/@data-apis/record/gzip-envelope');
var parseGzipEnvelope = require('./../lib/node_modules/@data-apis/record/parse-gzip-envelope');
var validatePublishEnvelope = require('./../lib/node_modules/@data-apis/publish/validate-envelope');
var verifyTransfer = require('./../lib/node_modules/@data-apis/publish/verify-transfer');
var runHarvest = require('./../lib/node_modules/@data-apis/harvest/run');
var validateOutput = require('./../lib/node_modules/@data-apis/output/validate');
var loadRegistry = require('./../lib/node_modules/@data-apis/registry/load');
var validateRepository = require('./../lib/node_modules/@data-apis/repository/validate');
var createWorkspace = require('./helpers/create_workspace.js');
var urlRegistry = require('./helpers/url_registry.js');

var NOW = Date.parse('2026-08-24T12:00:00Z');
var BASE_SHA = 'a'.repeat(40);

/**
* Creates a deterministic URL adapter returning provided bytes.
*
* @param {Buffer|Function} value - bytes or context mapper
* @returns {Function} adapter
*/
function urlAdapter(value) {
	return async function fetch(context) {
		var bytes = typeof value === 'function' ? value(context) : value;

		return {
			bytes: bytes,
			origin: {
				type: 'url',
				endpoint: context.source.url
			}
		};
	};
}

/**
* Applies a validated output bundle to a temporary repository fixture.
*
* @param {string} root - fixture root
* @param {string} output - output directory
* @returns {Promise<void>} promise
*/
async function applyOutput(root, output) {
	var manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));

	for (const item of manifest.files) {
		var source = path.join(output, ...item.path.split('/'));
		var destination = path.join(root, ...item.path.split('/'));

		await fs.mkdir(path.dirname(destination), { recursive: true });
		if (item.path === 'data/index.json') {
			await fs.copyFile(source, destination);
		} else {
			await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
		}
	}
}

test('harvests, validates, and deduplicates a direct report', async function () {
	var root = await createWorkspace(urlRegistry());
	var bytes = await fs.readFile('test/fixtures/minimal_report.json');
	var first = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(bytes) }
	});

	assert.equal(first.outputDirectory, path.join(root, 'build/harvest-output'));
	assert.equal(first.summary.new_records.length, 1);
	assert.equal(path.basename(first.summary.new_records[0]).includes('-'), false);
	assert.match(path.basename(first.summary.new_records[0]), /^\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2}Z__sha256_[0-9a-f]{64}\.json\.gz$/);
	await validateOutput({ rootDirectory: root, outputDirectory: first.outputDirectory });
	await applyOutput(root, first.outputDirectory);
	await validateRepository({
		dataDirectory: path.join(root, 'data'),
		registry: await loadRegistry(path.join(root, 'registry/data.json')),
		all: true
	});
	var secondOutput = path.join(root, 'build/harvest-output-2');
	var second = await runHarvest({
		rootDirectory: root,
		outputDirectory: secondOutput,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(bytes) }
	});

	assert.deepEqual(second.summary.new_records, []);
	assert.equal(second.summary.sources[0].dispositions[0].status, 'duplicate');
	await validateOutput({ rootDirectory: root, outputDirectory: secondOutput });
});

test('stores multiple dynamically inferred series from one ZIP', async function () {
	var root = await createWorkspace(urlRegistry());
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(await fs.readFile('test/fixtures/multi_report.zip')) }
	});
	var outputIndex = JSON.parse(await fs.readFile(path.join(result.outputDirectory, 'data/index.json'), 'utf8'));

	assert.equal(result.summary.new_records.length, 2);
	assert.equal(new Set(outputIndex.records.map(function series(row) { return row.series_key; })).size, 2);
	await validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory });
});

test('stores provider-neutral CI provenance with provider-specific details', async function () {
	var registry = urlRegistry();
	var source = {
		id: 'linux',
		type: 'ci_artifact',
		provider: 'github',
		project: 'example/project',
		ref: { kind: 'branch', name: 'main' },
		selector: { workflow: 'compliance.yml', artifact: 'reports' }
	};

	registry.libraries[0].sources = [source];
	var root = await createWorkspace(registry);
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: {
			ciArtifact: async function adapter() {
				return {
					bytes: await fs.readFile('test/fixtures/minimal_report.json'),
					origin: {
						type: 'ci_artifact',
						provider: 'github',
						project: { id: '1234', locator: 'example/project' },
						ref: { kind: 'branch', name: 'main' },
						run: { id: '55', revision: 'c'.repeat(40) },
						artifact: { id: '99', name: 'reports' },
						provider_details: { workflow: 'compliance.yml', run_attempt: 1 }
					}
				};
			}
		}
	});
	var index = JSON.parse(await fs.readFile(path.join(result.outputDirectory, 'data/index.json'), 'utf8'));

	assert.deepEqual(index.records[0].origin, {
		type: 'ci_artifact',
		provider: 'github',
		project: { id: '1234', locator: 'example/project' }
	});
	await validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory });
	var publicationPath = result.summary.new_records[0];
	var relative = publicationPath.slice('data/'.length);
	var envelope = parseGzipEnvelope(await fs.readFile(path.join(result.outputDirectory, ...publicationPath.split('/'))));

	envelope.harvest.origin.artifact.id = {};
	assert.throws(function validateArtifactId() {
		validatePublishEnvelope(gzipEnvelope(envelope), relative, registry.libraries[0], source);
	}, /bounded string/);
	envelope.harvest.origin.artifact.id = '99';
	envelope.harvest.origin.provider_details.artifact_created_at = {};
	assert.throws(function validateArtifactTime() {
		validatePublishEnvelope(gzipEnvelope(envelope), relative, registry.libraries[0], source);
	}, /bounded string/);
});

test('publisher rejects a changed immutable CI project ID before network access', async function () {
	var registry = urlRegistry();
	var source = {
		id: 'linux',
		type: 'ci_artifact',
		provider: 'github',
		project: 'example/project',
		ref: { kind: 'branch', name: 'main' },
		selector: { workflow: 'compliance.yml', artifact: 'reports' }
	};
	var report = JSON.parse(await fs.readFile('test/fixtures/minimal_report.json', 'utf8'));

	registry.libraries[0].sources = [source];
	var root = await createWorkspace(registry);
	var adapter = function ciAdapter(projectId, value) {
		return async function fetch() {
			return {
				bytes: Buffer.from(JSON.stringify(value)),
				origin: {
					type: 'ci_artifact',
					provider: 'github',
					project: { id: projectId, locator: 'example/project' },
					ref: { kind: 'branch', name: 'main' },
					run: { id: '55' },
					artifact: { id: '99', name: 'reports' },
					provider_details: { workflow: 'compliance.yml', run_attempt: 1 }
				}
			};
		};
	};
	var first = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { ciArtifact: adapter('1234', report) }
	});

	await applyOutput(root, first.outputDirectory);
	report.timestamp = '2026-08-24T10:35:27Z';
	report.version = '2.6.2';
	var second = await runHarvest({
		rootDirectory: root,
		outputDirectory: path.join(root, 'build/harvest-output-project-change'),
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { ciArtifact: adapter('9999', report) }
	});

	assert.equal(second.summary.new_records.length, 1);
	await assert.rejects(verifyTransfer({
		rootDirectory: root,
		outputDirectory: second.outputDirectory,
		expectedBaseSha: BASE_SHA
	}), /immutable project ID/);
});

test('rejects distinct bundled history for one series', async function () {
	var root = await createWorkspace(urlRegistry());
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(await fs.readFile('test/fixtures/same_series.zip')) }
	});

	assert.equal(result.summary.has_source_errors, true);
	assert.equal(result.summary.new_records.length, 0);
	assert.match(result.summary.sources[0].errors[0], /distinct reports/);
	await validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory });
});

test('consolidates exact duplicate ZIP reports by UTF-8 member ordering', async function () {
	var root = await createWorkspace(urlRegistry());
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(await fs.readFile('test/fixtures/duplicate_report.zip')) }
	});

	assert.equal(result.summary.new_records.length, 1);
	assert.equal(result.summary.sources[0].dispositions[0].member, 'a.json');
	assert.match(result.summary.warnings[0], /duplicate ZIP members/);
});

test('marks a rolled-back series stale after accepting a newer record', async function () {
	var root = await createWorkspace(urlRegistry());
	var bytes = await fs.readFile('test/fixtures/minimal_report.json');
	var first = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(bytes) }
	});
	var old = JSON.parse(bytes.toString('utf8'));

	await applyOutput(root, first.outputDirectory);
	old.timestamp = '2026-08-24T09:00:00Z';
	old.version = '2.5.0';
	var result = await runHarvest({
		rootDirectory: root,
		outputDirectory: path.join(root, 'build/harvest-output-stale'),
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(Buffer.from(JSON.stringify(old))) }
	});

	assert.equal(result.summary.new_records.length, 0);
	assert.equal(result.summary.sources[0].dispositions[0].status, 'stale');
	assert.equal(result.summary.has_source_errors, true);
});

test('publishes valid partial results while recording another source failure', async function () {
	var root = await createWorkspace(urlRegistry(2));
	var valid = await fs.readFile('test/fixtures/minimal_report.json');
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: {
			url: urlAdapter(function choose(context) {
				return context.source.id === 'demo' ? valid : Buffer.from('invalid');
			})
		}
	});

	assert.equal(result.summary.new_records.length, 1);
	assert.equal(result.summary.has_source_errors, true);
	assert.equal(result.summary.sources[1].status, 'failed');
	await validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory });
});

test('rejects endpoint reuse and tampered output bytes', async function () {
	var root = await createWorkspace(urlRegistry());
	var bytes = await fs.readFile('test/fixtures/minimal_report.json');
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(bytes) }
	});
	var recordPath = result.summary.new_records[0];

	await fs.appendFile(path.join(result.outputDirectory, ...recordPath.split('/')), 'tamper');
	await assert.rejects(validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory }), /hash mismatch/);
	await fs.truncate(path.join(result.outputDirectory, ...recordPath.split('/')), result.manifest.files.find(function record(file) {
		return file.path === recordPath;
	}).size);
	await applyOutput(root, result.outputDirectory);
	var registry = JSON.parse(await fs.readFile(path.join(root, 'registry/data.json'), 'utf8'));

	registry.libraries[0].sources[0].url = 'https://example.test/changed.json';
	await fs.writeFile(path.join(root, 'registry/data.json'), JSON.stringify(registry, null, 2) + '\n');
	await assert.rejects((async function validateChanged() {
		var loaded = await loadRegistry(path.join(root, 'registry/data.json'));
		return validateRepository({ dataDirectory: path.join(root, 'data'), registry: loaded, all: false });
	})(), /changed without a new source ID/);
});

test('rejects duplicate output index paths before publication', async function () {
	var root = await createWorkspace(urlRegistry());
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(await fs.readFile('test/fixtures/minimal_report.json')) }
	});
	var indexPath = path.join(result.outputDirectory, 'data/index.json');
	var index = JSON.parse(await fs.readFile(indexPath, 'utf8'));

	index.records.push(structuredClone(index.records[0]));
	var indexBytes = Buffer.from(serializeIndex(index.records));
	await fs.writeFile(indexPath, indexBytes);
	var manifestPath = path.join(result.outputDirectory, 'manifest.json');
	var manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	var item = manifest.files.find(function find(file) { return file.path === 'data/index.json'; });
	item.size = indexBytes.length;
	item.sha256 = sha256(indexBytes);
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
	await assert.rejects(validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory }), /duplicate record paths/);
});

test('fast repository validation compares all path-derived index fields', async function () {
	var root = await createWorkspace(urlRegistry());
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(await fs.readFile('test/fixtures/minimal_report.json')) }
	});

	await applyOutput(root, result.outputDirectory);
	var indexPath = path.join(root, 'data/index.json');
	var original = JSON.parse(await fs.readFile(indexPath, 'utf8'));
	var mutations = [
		function library(row) { row.library_id = 'other'; },
		function source(row) { row.source_id = 'other'; },
		function timestamp(row) { row.timestamp = '2026-08-24T10:34:26Z'; },
		function hash(row) { row.report_sha256 = 'b'.repeat(64); }
	];

	for (const mutate of mutations) {
		var index = structuredClone(original);

		mutate(index.records[0]);
		await fs.writeFile(indexPath, serializeIndex(index.records));
		await assert.rejects(validateRepository({ dataDirectory: path.join(root, 'data'), all: false }), /metadata does not agree with path/);
	}
});

test('accepts the report/index platform description boundary', async function () {
	var root = await createWorkspace(urlRegistry());
	var report = JSON.parse(await fs.readFile('test/fixtures/minimal_report.json', 'utf8'));

	report.platform.description = 'x'.repeat(16384);
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: { url: urlAdapter(Buffer.from(JSON.stringify(report))) }
	});

	assert.equal(result.summary.new_records.length, 1);
	await validateOutput({ rootDirectory: root, outputDirectory: result.outputDirectory });
});

test('suppresses only an exhausted CI provider and continues URL sources', async function () {
	var registry = urlRegistry();
	var githubSource = {
		id: 'github-one',
		type: 'ci_artifact',
		provider: 'github',
		project: 'example/project',
		ref: { kind: 'branch', name: 'main' },
		selector: { workflow: 'compliance.yml', artifact: 'reports' }
	};
	var calls = 0;

	var secondGitHubSource = structuredClone(githubSource);

	secondGitHubSource.id = 'github-two';
	secondGitHubSource.selector.artifact = 'reports-two';
	registry.libraries[0].sources.unshift(githubSource, secondGitHubSource);
	var root = await createWorkspace(registry);
	var result = await runHarvest({
		rootDirectory: root,
		now: NOW,
		baseSha: BASE_SHA,
		adapters: {
			ciArtifact: async function limited() {
				calls += 1;
				throw new HarvesterError('rate limited', { code: 'RATE_LIMITED', resetAt: '2026-08-24T13:00:00Z' });
			},
			url: urlAdapter(await fs.readFile('test/fixtures/minimal_report.json'))
		}
	});

	assert.equal(calls, 1);
	assert.match(result.summary.sources[1].errors[0], /suppressed.*13:00:00Z/);
	assert.equal(result.summary.new_records.length, 1);
});
