'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs/promises');
var decodePayload = require('./../lib/node_modules/@data-apis/payload/decode');
var validateReport = require('./../lib/node_modules/@data-apis/report/validate');

/**
* Replaces every equal-length byte sequence in a buffer.
*
* @param {Buffer} bytes - input bytes
* @param {string} before - source text
* @param {string} after - replacement text
* @returns {Buffer} mutated copy
*/
function replaceBytes(bytes, before, after) {
	var output = Buffer.from(bytes);
	var source = Buffer.from(before);
	var replacement = Buffer.from(after);
	var offset = 0;
	var index;

	assert.equal(source.length, replacement.length);
	while ((index = output.indexOf(source, offset)) !== -1) {
		replacement.copy(output, index);
		offset = index + replacement.length;
	}
	return output;
}

test('detects equivalent direct JSON and ZIP payloads from bytes', async function () {
	var direct = await decodePayload(await fs.readFile('test/fixtures/array_api_compliance.json'));
	var zipped = await decodePayload(await fs.readFile('test/fixtures/array_api_compliance.json.zip'));
	var directReport = validateReport(JSON.parse(direct.candidates[0].bytes.toString('utf8')));
	var zippedReport = validateReport(JSON.parse(zipped.candidates[0].bytes.toString('utf8')));

	assert.equal(direct.format, 'json');
	assert.equal(zipped.format, 'zip');
	assert.equal(directReport.reportSha256, zippedReport.reportSha256);
});

test('accepts an optional UTF-8 BOM without changing report identity', async function () {
	var bytes = await fs.readFile('test/fixtures/minimal_report.json');
	var plain = await decodePayload(bytes);
	var bom = await decodePayload(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));

	assert.equal(bom.candidates[0].bytes.toString('utf8'), plain.candidates[0].bytes.toString('utf8'));
});

test('discovers multiple JSON reports or selects one exact member', async function () {
	var bytes = await fs.readFile('test/fixtures/multi_report.zip');
	var all = await decodePayload(bytes);
	var selected = await decodePayload(bytes, { file: 'minimal_report_windows.json' });

	assert.equal(all.candidates.length, 2);
	assert.equal(selected.candidates.length, 1);
	assert.equal(selected.candidates[0].member, 'minimal_report_windows.json');
});

test('rejects unexpected ZIP contents, missing members, and unknown payloads', async function () {
	await assert.rejects(decodePayload(await fs.readFile('test/fixtures/unexpected_file.zip')), /Unexpected non-JSON/);
	await assert.rejects(decodePayload(await fs.readFile('test/fixtures/multi_report.zip'), { file: 'missing.json' }), /not found/);
	await assert.rejects(decodePayload(Buffer.from('not a payload')), /neither JSON nor ZIP/);
	await assert.rejects(decodePayload(Buffer.from([0x7b, 0xff, 0x7d])), /encoded data|UTF-8/i);
});

test('enforces per-report ZIP expansion limits', async function () {
	await assert.rejects(decodePayload(await fs.readFile('test/fixtures/multi_report.zip'), {
		maxJsonBytes: 10
	}), /too large/);
});

test('rejects traversal paths, duplicate names, and corrupted members', async function () {
	var multi = await fs.readFile('test/fixtures/multi_report.zip');
	var duplicate = await fs.readFile('test/fixtures/duplicate_report.zip');
	var traversal = replaceBytes(multi, 'minimal_report.json', '../evil_report.json');
	var duplicateName = replaceBytes(duplicate, 'b.json', 'a.json');
	var corrupted = Buffer.from(multi);
	var nameLength = corrupted.readUInt16LE(26);
	var extraLength = corrupted.readUInt16LE(28);
	var compressedLength = corrupted.readUInt32LE(18);
	var dataOffset = 30 + nameLength + extraLength;

	corrupted[dataOffset + Math.floor(compressedLength / 2)] ^= 0xff;
	await assert.rejects(decodePayload(traversal), /traversal/);
	await assert.rejects(decodePayload(duplicateName), /Duplicate ZIP member/);
	await assert.rejects(decodePayload(corrupted), /invalid|error|CRC|compressed|size/i);
});

test('rejects explicitly non-regular ZIP entry types', async function () {
	var bytes = Buffer.from(await fs.readFile('test/fixtures/multi_report.zip'));
	var central = bytes.indexOf(Buffer.from('PK\x01\x02', 'binary'));
	var fifoMode = ((0x1000 | 0o644) << 16) >>> 0;

	assert.notEqual(central, -1);
	bytes.writeUInt32LE(fifoMode, central + 38);
	await assert.rejects(decodePayload(bytes), /Unsafe ZIP member/);
});
