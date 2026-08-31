'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs/promises');
var path = require('node:path');
var os = require('node:os');
var writeActionsSummary = require('./../../lib/node_modules/@data-apis/summary/write-actions');

/**
* Returns a representative successful harvest summary.
*
* @returns {Object} summary
*/
function successfulSummary() {
	return {
		new_records: [ 'data/array-api-strict/demo/report.json.gz' ],
		sources: [{
			library_id: 'array-api-strict',
			source_id: 'demo',
			status: 'ok',
			dispositions: [{ status: 'stored' }],
			errors: []
		}],
		warnings: []
	};
}

test('writes only to an explicit Actions summary target', async function () {
	var directory = await fs.mkdtemp(path.join(os.tmpdir(), 'array-api-summary-test-'));
	var ambient = path.join(directory, 'ambient.md');
	var explicit = path.join(directory, 'explicit.md');
	var previous = process.env.GITHUB_STEP_SUMMARY;
	var output;

	process.env.GITHUB_STEP_SUMMARY = ambient;
	try {
		await writeActionsSummary(successfulSummary());
		await assert.rejects(fs.access(ambient), function absent(error) {
			return error.code === 'ENOENT';
		});
		await writeActionsSummary(successfulSummary(), explicit);
		output = await fs.readFile(explicit, 'utf8');
	} finally {
		if ( previous === undefined ) {
			delete process.env.GITHUB_STEP_SUMMARY;
		} else {
			process.env.GITHUB_STEP_SUMMARY = previous;
		}
	}
	assert.match(output, /\*\*Accepted reports:\*\* 1/);
	assert.match(output, /\| array-api-strict\/demo \| Success \| 1 \| — \|/);
});
