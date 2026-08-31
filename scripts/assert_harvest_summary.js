#!/usr/bin/env node

/**
* @license MIT
*
* Copyright (c) 2026 Consortium for Python Data API Standards.
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

/*
* Assert that a harvest summary is well-formed and contains no source-level
* failures. This script exits with a nonzero status for an invalid summary or
* when one or more registered sources failed during harvesting.
*
* Usage: node ./scripts/assert_harvest_summary.js [options]
*
* Options:
*
*   --summary <path>   Path to the harvest summary JSON file. Default:
*                      build/harvest-output/summary.json relative to the current
*                      working directory.
*
* Environment variables:
*
*   None.
*
* Examples:
*
*   node ./scripts/assert_harvest_summary.js
*   node ./scripts/assert_harvest_summary.js \
*     --summary build/harvest-output/summary.json
*/

'use strict';

// MODULES //

var resolve = require( 'path' ).resolve;
var proc = require( 'process' );
var ARGV = require( '@stdlib/process-argv' );
var isBoolean = require( '@stdlib/assert-is-boolean' ).isPrimitive;
var readFileSync = require( '@stdlib/fs-read-file' ).sync;
var parseJSON = require( '@stdlib/utils-parse-json' );
var stdout = require( '@stdlib/streams-node-stdout' );
var stderr = require( '@stdlib/streams-node-stderr' );
var parseArguments = require( './../lib/node_modules/@data-apis/cli/parse-arguments' );


// MAIN //

/**
* Main execution sequence.
*
* @private
* @returns {Promise<void>} promise
*/
function main() {
	var summaryPath;
	var summary;
	var args;

	args = parseArguments( ARGV.slice( 2 ) );
	summaryPath = ( args.summary ) ? resolve( args.summary ) : resolve( 'build/harvest-output/summary.json' );
	summary = parseJSON( readFileSync( summaryPath, 'utf8' ) );

	if (
		summary instanceof Error ||
		summary.schema !== 'harvest-summary-v1' ||
		!isBoolean( summary.has_source_errors )
	) {
		stderr.write( 'assert_harvest_summary: invalid harvest summary\n' );
		proc.exitCode = 1;
		return;
	}
	if ( summary.has_source_errors ) {
		stderr.write( 'assert_harvest_summary: One or more harvest sources failed; see the job summary' );
		proc.exitCode = 1;
		return;
	}
	stdout.write( 'All harvest sources completed without errors.\n' );
}

main();
