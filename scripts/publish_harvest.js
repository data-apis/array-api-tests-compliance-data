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
* Validate and atomically publish a harvest transfer bundle to a GitHub branch.
* When the bundle contains new reports, this script creates a commit through the
* GitHub Git Data API and performs a non-force branch update. It does not open a
* pull request.
*
* Usage: node ./scripts/publish_harvest.js [options]
*
* Options:
*
*   --output-dir <path>   Path to the harvest transfer bundle. Default:
*                         <repository>/build/harvest-output.
*   --branch <name>       Branch to update. Default: GITHUB_REF_NAME. A value
*                         from either the option or environment is required.
*   --base-sha <sha>      Expected source revision for the bundle. Default:
*                         HARVEST_BASE_SHA. When provided, the script refuses a
*                         bundle harvested from another revision.
*
* Environment variables:
*
*   GITHUB_REPOSITORY    Required destination in "owner/name" form.
*   GITHUB_TOKEN         Required token with permission to write repository
*                        contents.
*   GITHUB_REF_NAME      Fallback for --branch.
*   HARVEST_BASE_SHA     Fallback for --base-sha.
*
* Example:
*
*   GITHUB_REPOSITORY=data-apis/array-api-tests-compliance-data \
*   GITHUB_TOKEN=YOUR_TOKEN \
*   node ./scripts/publish_harvest.js \
*     --output-dir build/harvest-output \
*     --branch main \
*     --base-sha 0123456789abcdef0123456789abcdef01234567
*/

'use strict';

// MODULES //

var resolve = require( 'path' ).resolve;
var join = require( 'path' ).join;
var proc = require( 'process' );
var parseArguments = require( './../lib/node_modules/@data-apis/cli/parse-arguments' );
var publish = require( './../lib/node_modules/@data-apis/publish/run' );


// FUNCTIONS //

/**
* Callback invoked upon encountering an error.
*
* @private
* @param {Error} error - error
*/
function onError( error ) {
	proc.stderr.write( 'publish_harvest: ' + error.message + '\n' );
	proc.exitCode = 1;
}


// MAIN //

/**
* Main execution sequence.
*
* @private
* @returns {Promise<void>} promise
*/
async function main() {
	var rootDirectory;
	var result;
	var args;

	args = parseArguments( proc.argv.slice( 2 ) );
	rootDirectory = resolve( __dirname, '..' );
	result = await publish({
		'rootDirectory': rootDirectory,
		'outputDirectory': ( args.output_dir ) ? resolve( args.output_dir ) : join( rootDirectory, 'build/harvest-output' ),
		'repository': proc.env.GITHUB_REPOSITORY,
		'branch': args.branch || proc.env.GITHUB_REF_NAME,
		'token': proc.env.GITHUB_TOKEN,
		'expectedBaseSha': args.base_sha || proc.env.HARVEST_BASE_SHA
	});

	if ( result.published ) {
		proc.stdout.write( 'Published harvest commit ' + result.commitSha + '.\n' );
		return;
	}
	proc.stdout.write( 'No new records to publish.\n' );
}

main().catch( onError );
