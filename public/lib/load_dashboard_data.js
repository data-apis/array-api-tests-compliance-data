/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
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
