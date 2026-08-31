'use strict';

/**
* Creates a registry containing one or more stable URL sources.
*
* @param {number} [count=1] - source count
* @returns {Object} registry
*/
function urlRegistry(count) {
	var sources = [];
	var idx;

	count = count || 1;
	for (idx = 0; idx < count; idx += 1) {
		sources.push({
			id: idx === 0 ? 'demo' : 'demo-' + idx,
			type: 'url',
			url: 'https://example.test/report-' + idx + '.json'
		});
	}
	return {
		schema: 'registry-v1',
		libraries: [{
			id: 'array-api-strict',
			name: 'Array API Strict',
			report_name: 'array-api-strict',
			sources: sources
		}]
	};
}

module.exports = urlRegistry;
