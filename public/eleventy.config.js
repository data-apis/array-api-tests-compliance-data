/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
*/

'use strict';

module.exports = function configureEleventy( eleventyConfig ) {
	eleventyConfig.setNunjucksEnvironmentOptions({ autoescape: true });
	eleventyConfig.addPassthroughCopy({ 'public/src/assets': 'assets' });
	eleventyConfig.addWatchTarget( 'data' );
	eleventyConfig.addWatchTarget( 'registry' );
	return {
		dir: {
			data: '_data',
			includes: '_includes',
			input: 'public/src',
			output: process.env.DASHBOARD_OUTPUT_DIR || 'public/dist'
		},
		htmlTemplateEngine: 'njk',
		markdownTemplateEngine: 'njk',
		pathPrefix: process.env.DASHBOARD_PATH_PREFIX || '/'
	};
};
