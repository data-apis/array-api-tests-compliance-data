'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var validateRegistry = require('./../../lib/node_modules/@data-apis/registry/validate');
var sourceFingerprint = require('./../../lib/node_modules/@data-apis/registry/source-fingerprint');
var validateReport = require('./../../lib/node_modules/@data-apis/report/validate');
var validatePublishReport = require('./../../lib/node_modules/@data-apis/publish/validate-report');
var urlRegistry = require('./helpers/url_registry.js');

var report = JSON.parse(fs.readFileSync('test/harvester/fixtures/minimal_report.json', 'utf8'));

test('validates dynamic report metadata and derives an immutable series', function () {
	var result = validateReport(report, {
		expectedName: 'array-api-strict',
		now: Date.parse('2026-08-24T12:00:00Z')
	});
	var windows = JSON.parse(fs.readFileSync('test/harvester/fixtures/minimal_report_windows.json', 'utf8'));
	var windowsResult = validateReport(windows, {
		expectedName: 'array-api-strict',
		now: Date.parse('2026-08-24T12:00:00Z')
	});

	assert.equal(result.seriesSchema, 'compliance-v1-series-v1');
	assert.equal(result.series.python, '3.14');
	assert.deepEqual(result.series.execution_target, { kind: 'cpu' });
	assert.equal(result.timestamp, '2026-08-24T10:34:27Z');
	assert.match(result.seriesKey, /^sha256:[0-9a-f]{64}$/);
	assert.equal(windowsResult.series.python, '3.15');
	assert.equal(windowsResult.series.platform.system, 'Windows');
	assert.notEqual(windowsResult.seriesKey, result.seriesKey);
});

test('keeps CPU and accelerator runs in distinct series', function () {
	var cpu = structuredClone(report);
	var cuda = structuredClone(report);
	var upgraded;
	var otherDevice;
	var cpuResult;
	var cudaResult;
	var upgradedResult;
	var otherDeviceResult;
	var publishResult;

	cuda.execution_target = {
		kind: 'gpu',
		backend: 'cuda',
		device_model: 'NVIDIA H100',
		runtime_version: '12.8',
		driver_version: '570.00'
	};
	upgraded = structuredClone(cuda);
	upgraded.execution_target.runtime_version = '12.9';
	upgraded.execution_target.driver_version = '571.00';
	otherDevice = structuredClone(cuda);
	otherDevice.execution_target.device_model = 'NVIDIA A100';
	cpuResult = validateReport(cpu);
	cudaResult = validateReport(cuda);
	upgradedResult = validateReport(upgraded);
	otherDeviceResult = validateReport(otherDevice);
	publishResult = validatePublishReport(cuda, 'array-api-strict');
	assert.deepEqual(cudaResult.series.execution_target, {
		kind: 'gpu',
		backend: 'cuda',
		device_model: 'NVIDIA H100'
	});
	assert.deepEqual(cudaResult.variant.execution_target, cuda.execution_target);
	assert.notEqual(cudaResult.seriesKey, cpuResult.seriesKey);
	assert.equal(upgradedResult.seriesKey, cudaResult.seriesKey);
	assert.notEqual(upgradedResult.variantKey, cudaResult.variantKey);
	assert.notEqual(upgradedResult.reportSha256, cudaResult.reportSha256);
	assert.notEqual(otherDeviceResult.seriesKey, cudaResult.seriesKey);
	assert.deepEqual(publishResult.series, cudaResult.series);
	assert.equal(publishResult.seriesKey, cudaResult.seriesKey);
	assert.deepEqual(publishResult.variant, cudaResult.variant);
	assert.equal(publishResult.variantKey, cudaResult.variantKey);
});

test('normalizes equivalent timestamps before hashing and storage', function () {
	var first = structuredClone(report);
	var second = structuredClone(report);

	first.timestamp = '2026-08-24T12:34:27+02:00';
	second.timestamp = '2026-08-24T10:34:27.999Z';
	var firstResult = validateReport(first, { now: Date.parse('2026-08-24T14:00:00Z') });
	var secondResult = validateReport(second, { now: Date.parse('2026-08-24T14:00:00Z') });

	assert.equal(firstResult.report.timestamp, '2026-08-24T10:34:27Z');
	assert.equal(secondResult.report.timestamp, '2026-08-24T10:34:27Z');
	assert.equal(firstResult.reportSha256, secondResult.reportSha256);
});

test('validates RFC 3339 calendar and time components strictly', function () {
	var value = structuredClone(report);

	['2026-02-30T12:00:00Z', '2026-08-24T24:00:00Z', '2026-08-24T12:00:60Z', '2026-08-24T12:00:00+24:00'].forEach(function invalid(timestamp) {
		value.timestamp = timestamp;
		assert.throws(function validateTimestamp() {
			validateReport(value, { now: Date.parse('2026-08-25T12:00:00Z') });
		}, /timestamp/);
	});
	value.timestamp = '2028-02-29T12:00:00-03:30';
	assert.equal(validateReport(value, { now: Date.parse('2028-03-01T12:00:00Z') }).timestamp, '2028-02-29T15:30:00Z');
});

test('rejects malformed semantic report data', function () {
	var value = structuredClone(report);

	value.name = 'wrong';
	assert.throws(function validateName() {
		validateReport(value, { expectedName: 'array-api-strict' });
	}, /does not match/);
	value = structuredClone(report);
	value.python = ' 3.14.7';
	assert.throws(function validatePython() {
		validateReport(value);
	}, /whitespace/);
	value = structuredClone(report);
	value.data.exitcode = 2;
	assert.throws(function validateExit() {
		validateReport(value);
	}, /exit code/);
	value = structuredClone(report);
	value.data.summary.passed = 2;
	assert.throws(function validateSummary() {
		validateReport(value);
	}, /outcome counts/);
	value = structuredClone(report);
	delete value.execution_target;
	assert.throws(function validateTarget() {
		validateReport(value);
	}, /validation failed/);
	value = structuredClone(report);
	value.execution_target = { kind: 'gpu' };
	assert.throws(function validateBackend() {
		validateReport(value);
	}, /validation failed/);
	value = structuredClone(report);
	value.execution_target = { kind: 'gpu', backend: 'CUDA' };
	assert.throws(function validateBackendCase() {
		validateReport(value);
	}, /validation failed/);
	value = structuredClone(report);
	value.execution_target = { kind: 'gpu', backend: 'cuda', device_model: ' H100' };
	assert.throws(function validateDeviceModel() {
		validateReport(value);
	}, /trimmed string/);
});

test('rejects future timestamps and unsupported report schemas', function () {
	var value = structuredClone(report);

	value.timestamp = '2026-08-27T12:00:00Z';
	assert.throws(function validateFuture() {
		validateReport(value, { now: Date.parse('2026-08-24T12:00:00Z') });
	}, /future/);
	value = structuredClone(report);
	value.schema = 'v2';
	assert.throws(function validateSchema() {
		validateReport(value);
	}, /Unsupported/);
});

test('validates the provider-neutral registry and excludes matrix expectations', function () {
	var registry = urlRegistry();
	var first = validateRegistry(registry);
	var fingerprint = sourceFingerprint(first.libraries[0].sources[0]);
	var changed = structuredClone(registry);

	assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
	changed.libraries[0].sources[0].expect = [];
	assert.throws(function validateExpect() {
		validateRegistry(changed);
	}, /additional properties|oneOf/);
	changed = structuredClone(registry);
	changed.libraries[0].sources[0].url = 'http://example.test/report.json';
	assert.throws(function validateHttp() {
		validateRegistry(changed);
	}, /validation failed|HTTPS/);
});
