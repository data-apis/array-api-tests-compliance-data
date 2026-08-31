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

'use strict';

const fs = require( 'node:fs/promises' );
const path = require( 'node:path' );
const zlib = require( 'node:zlib' );
const { buildDashboardModel } = require( './build_dashboard_model.js' );

const MAX_EXPANDED_BYTES = 55 * 1024 * 1024;

async function readJson( filepath ) {
	let source;
	try {
		source = await fs.readFile( filepath, 'utf8' );
	} catch ( error ) {
		throw new Error( 'Unable to read dashboard input '+filepath+': '+error.message );
	}
	try {
		return JSON.parse( source );
	} catch ( error ) {
		throw new Error( 'Unable to parse dashboard input '+filepath+': '+error.message );
	}
}

function projectEnvelope( envelope, filepath ) {
	const tests = envelope && envelope.report && envelope.report.data && envelope.report.data.tests;
	if ( !Array.isArray( tests ) ) {
		throw new Error( 'Stored report has no test array: '+filepath );
	}
	const projection = tests.map( ( test ) => {
		if ( typeof test.nodeid !== 'string' || typeof test.outcome !== 'string' ) {
			throw new Error( 'Stored report has a malformed test result: '+filepath );
		}
		return { nodeid: test.nodeid, outcome: test.outcome };
	});
	return {
		failures: projection.filter( ( test ) => test.outcome === 'failed' ),
		tests: projection
	};
}

function createProjectionLoader( root, stats ) {
	const cache = new Map();
	return async function loadProjection( record ) {
		if ( cache.has( record.report_sha256 ) ) {
			return cache.get( record.report_sha256 );
		}
		const promise = ( async () => {
			const filepath = path.join( root, 'data', record.path );
			let compressed;
			try {
				compressed = await fs.readFile( filepath );
			} catch ( error ) {
				throw new Error( 'Unable to read indexed report '+filepath+': '+error.message );
			}
			let expanded;
			try {
				expanded = zlib.gunzipSync( compressed, { maxOutputLength: MAX_EXPANDED_BYTES } );
			} catch ( error ) {
				throw new Error( 'Unable to expand indexed report '+filepath+': '+error.message );
			}
			stats.reportsLoaded += 1;
			stats.expandedBytes += expanded.byteLength;
			let envelope;
			try {
				envelope = JSON.parse( expanded.toString( 'utf8' ) );
			} catch ( error ) {
				throw new Error( 'Unable to parse indexed report '+filepath+': '+error.message );
			}
			return projectEnvelope( envelope, filepath );
		})();
		cache.set( record.report_sha256, promise );
		return promise;
	};
}

async function loadDashboardData( options ) {
	const root = ( options && options.root ) || path.resolve( __dirname, '..', '..' );
	const registry = await readJson( path.join( root, 'registry', 'data.json' ) );
	const index = await readJson( path.join( root, 'data', 'index.json' ) );
	const stats = { expandedBytes: 0, reportsLoaded: 0 };
	const model = await buildDashboardModel({
		index,
		loadProjection: createProjectionLoader( root, stats ),
		registry
	});
	model.buildStats = stats;
	return model;
}

module.exports = {
	MAX_EXPANDED_BYTES,
	createProjectionLoader,
	loadDashboardData,
	projectEnvelope,
	readJson
};
