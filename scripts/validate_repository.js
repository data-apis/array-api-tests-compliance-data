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
* Validate the checked-in compliance-data repository. The default validation
* checks the registry, index, record paths, uniqueness, and registered-source
* history. Pass --all to decompress and validate every stored report envelope.
*
* Usage: node ./scripts/validate_repository.js [options]
*
* Options:
*
*   --registry <path>   Path to a registry JSON file. Default:
*                       <repository>/registry/data.json.
*   --data-dir <path>   Path to the checked-in data directory. Default:
*                       <repository>/data.
*   --all               Validate every compressed report envelope in addition
*                       to repository structure.
*
* Environment variables:
*
*   None.
*
* Examples:
*
*   node ./scripts/validate_repository.js
*   node ./scripts/validate_repository.js --all
*   node ./scripts/validate_repository.js \
*     --registry ./registry/data.json \
*     --data-dir ./data \
*     --all
*/

'use strict';

// MODULES //

var resolve = require( 'path' ).resolve;
var join = require( 'path' ).join;
var proc = require( 'process' );
var ARGV = require( '@stdlib/process-argv' );
var stdout = require( '@stdlib/streams-node-stdout' );
var stderr = require( '@stdlib/streams-node-stderr' );
var Boolean = require( '@stdlib/boolean-ctor' );
var format = require( '@stdlib/string-format' );
var parseArguments = require( './../lib/node_modules/@data-apis/cli/parse-arguments' );
var loadRegistry = require( './../lib/node_modules/@data-apis/registry/load' );
var validateRepository = require( './../lib/node_modules/@data-apis/repository/validate' );


// FUNCTIONS //

/**
* Callback invoked upon encountering an error.
*
* @private
* @param {Error} error - error
*/
function onError( error ) {
	stderr.write( format( 'validate_repository: %s\n', error.message ) );
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
	var registry;
	var result;
	var root;
	var args;

	args = parseArguments( ARGV.slice( 2 ) );
	root = resolve( __dirname, '..' );
	registry = await loadRegistry( ( args.registry ) ? resolve( args.registry ) : join( root, 'registry/data.json' ) );
	result = await validateRepository({
		'dataDirectory': ( args.data_dir ) ? resolve( args.data_dir ) : join( root, 'data' ),
		'registry': registry,
		'all': Boolean( args.all )
	});

	stdout.write( format( 'Validated %s stored record(s).\n', result.index.records.length ) );
}

main().catch( onError );
