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
* Harvest artifacts from all sources in the registry and create a validated
* transfer bundle. This script does not modify checked-in compliance data. The
* output directory must be empty or absent.
*
* Usage: node ./scripts/harvest.js [options]
*
* Options:
*
*   --registry <path>     Path to a registry JSON file. Default:
*                         <repository>/registry/data.json.
*   --data-dir <path>     Path to the checked-in data directory. Default:
*                         <repository>/data.
*   --output-dir <path>   Destination for the transfer bundle. Default:
*                         <repository>/build/harvest-output.
*   --base-sha <sha>      Source revision to record in the bundle. Default:
*                         GITHUB_SHA, or "local" when GITHUB_SHA is unset.
*
* Environment variables:
*
*   GITHUB_REPOSITORY       Current GitHub repository in "owner/name" form.
*                           Used to distinguish local and external sources.
*   GITHUB_TOKEN            Read token used for a GitHub source matching
*                           GITHUB_REPOSITORY.
*   HARVEST_GITHUB_TOKEN    Read token used for registered GitHub sources other
*                           than GITHUB_REPOSITORY.
*   GITHUB_SHA              Fallback for --base-sha.
*   GITHUB_STEP_SUMMARY     Optional path to which a GitHub Actions job summary
*                           is appended.
*
* A GitHub token is required when harvesting a GitHub source. URL sources do not
* require any environment variables.
*
* Examples:
*
*   HARVEST_GITHUB_TOKEN=YOUR_TOKEN node ./scripts/harvest.js
*   HARVEST_GITHUB_TOKEN=YOUR_TOKEN node ./scripts/harvest.js \
*     --output-dir build/harvest-output \
*     --base-sha 0123456789abcdef0123456789abcdef01234567
*/

'use strict';

// MODULES //

var resolve = require( 'path' ).resolve;
var proc = require( 'process' );
var ARGV = require( '@stdlib/process-argv' );
var stdout = require( '@stdlib/streams-node-stdout' );
var stderr = require( '@stdlib/streams-node-stderr' );
var format = require( '@stdlib/string-format' );
var parseArguments = require( './../lib/node_modules/@data-apis/cli/parse-arguments' );
var runHarvest = require( './../lib/node_modules/@data-apis/harvest/run' );


// FUNCTIONS //

/**
* Callback invoked upon encountering an error.
*
* @private
* @param {Error} error - error
*/
function onError( error ) {
	stderr.write( format( 'harvest: %s\n', error.message ) );
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
	var stored;
	var result;
	var args;

	args = parseArguments( ARGV.slice( 2 ) );
	result = await runHarvest({
		'rootDirectory': resolve( __dirname, '..' ),
		'registryPath': ( args.registry ) ? resolve( args.registry ) : void 0,
		'dataDirectory': ( args.data_dir ) ? resolve( args.data_dir ) : void 0,
		'outputDirectory': ( args.output_dir ) ? resolve( args.output_dir ) : void 0,
		'baseSha': args.base_sha
	});
	stored = result.summary.new_records.length;

	stdout.write( format( 'Harvested %s new report%s.\n', stored, ( stored === 1 ) ? '' : 's' ) );
	if ( result.summary.has_source_errors ) {
		stdout.write( 'One or more sources failed; validated records remain publishable.\n' );
	}
}

main().catch( onError );
