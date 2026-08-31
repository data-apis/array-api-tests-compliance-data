'use strict';

var path = require('node:path');
var os = require('node:os');
var fs = require('node:fs/promises');
var serializeIndex = require('./../../lib/node_modules/@data-apis/record/serialize-index');

/**
* Creates an isolated repository fixture with an empty data index.
*
* @param {Object} registry - registry value
* @returns {Promise<string>} workspace path
*/
async function createWorkspace(registry) {
	var root = await fs.mkdtemp(path.join(os.tmpdir(), 'array-api-harvester-test-'));

	await fs.mkdir(path.join(root, 'registry'), { recursive: true });
	await fs.mkdir(path.join(root, 'data'), { recursive: true });
	await fs.writeFile(path.join(root, 'registry/data.json'), JSON.stringify(registry, null, 2) + '\n');
	await fs.writeFile(path.join(root, 'data/index.json'), serializeIndex([]));
	return root;
}

module.exports = createWorkspace;
