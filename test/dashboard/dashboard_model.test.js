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

const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const test = require( 'node:test' );
const zlib = require( 'node:zlib' );
const { buildDashboardModel, orderedOutcomeNames, runView } = require( '../../public/lib/build_dashboard_model.js' );
const { compareTests } = require( '../../public/lib/compare_runs.js' );
const { formatContextLabel, formatExecutionTarget, formatRunEnvironment } = require( '../../public/lib/format_context.js' );
const { createProjectionLoader, MAX_EXPANDED_BYTES } = require( '../../public/lib/load_dashboard_data.js' );

function record( overrides ) {
	return {
		api_version: '2025.12',
		execution_target: { kind: 'cpu' },
		library_id: 'alpha',
		path: 'alpha/demo/report.json.gz',
		platform: {
			description: 'Linux test host',
			machine: 'x86_64',
			release: '6.0',
			system: 'Linux'
		},
		python: '3.14.1',
		report_sha256: 'a'.repeat( 64 ),
		series: {
			api_version: '2025.12',
			execution_target: { kind: 'cpu' },
			platform: { machine: 'x86_64', system: 'Linux' },
			python: '3.14'
		},
		series_key: 'sha256:'+ '1'.repeat( 64 ),
		series_schema: 'compliance-v1-series-v1',
		source_id: 'demo',
		summary: { collected: 2, failed: 0, passed: 2, skipped: 0, total: 2 },
		test_suite: 'A'.repeat( 40 ),
		timestamp: '2026-08-31T00:00:00Z',
		version: '1.0.0',
		variant: {
			api_version: '2025.12',
			execution_target: { kind: 'cpu' },
			platform: {
				description: 'Linux test host',
				machine: 'x86_64',
				release: '6.0',
				system: 'Linux'
			},
			python: '3.14.1'
		},
		variant_key: 'sha256:'+ '2'.repeat( 64 ),
		variant_schema: 'compliance-v1-variant-v1',
		...overrides
	};
}

const REGISTRY = {
	libraries: [
		{ id: 'zeta', name: 'Zeta', sources: [{ id: 'ci' }] },
		{ id: 'alpha', name: 'Alpha', sources: [{ id: 'demo' }] }
	]
};

test( 'orders outcomes without dropping extension outcomes', () => {
	assert.deepEqual(
		orderedOutcomeNames({ total: 4, xfailed: 1, skipped: 1, passed: 1, failed: 1, collected: 4 }),
		[ 'passed', 'failed', 'skipped', 'xfailed' ]
	);
} );

test( 'handles a zero total without dividing by zero', () => {
	const run = runView( record({ summary: { collected: 0, total: 0 } }) );
	assert.equal( run.resultText, 'No tests collected' );
	assert.equal( run.passPercentage, null );
	assert.equal( run.passPercentageText, '' );
} );

test( 'formats complete accelerator target metadata', () => {
	const target = formatExecutionTarget({
		backend: 'cuda',
		device_model: 'NVIDIA H100',
		driver_version: '570.00',
		kind: 'gpu',
		runtime_version: '12.8'
	});
	assert.equal( target.short, 'GPU · CUDA · NVIDIA H100' );
	assert.equal( target.full, 'GPU · CUDA · NVIDIA H100 · Runtime 12.8 · Driver 570.00' );
} );

test( 'formats target kinds without optional separator artifacts', () => {
	assert.equal( formatExecutionTarget({ kind: 'cpu', backend: 'openmp' }).full, 'CPU · OPENMP' );
	assert.equal( formatExecutionTarget({ kind: 'tpu', backend: 'xla' }).full, 'TPU · XLA' );
	assert.equal( formatExecutionTarget({ kind: 'other', backend: 'webgpu' }).full, 'OTHER · WEBGPU' );
} );

test( 'context label exposes stable series dimensions and source', () => {
	const value = record({
		execution_target: { backend: 'cuda', driver_version: '570', kind: 'gpu' },
		series: {
			api_version: '2025.12',
			execution_target: { backend: 'cuda', kind: 'gpu' },
			platform: { machine: 'aarch64', system: 'Linux' },
			python: '3.14'
		}
	});
	assert.equal(
		formatContextLabel( value, 'nightly' ),
		'Array API 2025.12 · Python 3.14 · Linux aarch64 · GPU · CUDA · Source nightly'
	);
} );

test( 'run environment exposes every human-readable variant dimension', () => {
	const value = record({
		execution_target: { kind: 'cpu', runtime_version: '3.2' },
		platform: {
			description: 'Linux-6.1-x86_64-with-glibc2.39',
			machine: 'x86_64',
			release: '6.1',
			system: 'Linux'
		},
		python: '3.14.2'
	});
	assert.equal(
		formatRunEnvironment( value ),
		'Python 3.14.2 · Linux 6.1 x86_64 · Platform Linux-6.1-x86_64-with-glibc2.39 · CPU · Runtime 3.2'
	);
} );

test( 'suppresses transitions for duplicate ids and composition changes', () => {
	const duplicate = compareTests(
		[{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'a', outcome: 'failed' }],
		[{ nodeid: 'a', outcome: 'passed' }]
	);
	assert.match( duplicate.diagnostic, /not unique/ );
	assert.equal( duplicate.compositionChanged, null );
	assert.deepEqual( duplicate.transitions, [] );

	const changed = compareTests(
		[{ nodeid: 'a', outcome: 'failed' }, { nodeid: 'b', outcome: 'passed' }],
		[{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'c', outcome: 'passed' }]
	);
	assert.equal( changed.compositionChanged, true );
	assert.deepEqual( changed.added, [ 'b' ] );
	assert.deepEqual( changed.removed, [ 'c' ] );
	assert.deepEqual( changed.transitions, [] );
} );

test( 'does not make a zero-change claim when transition analysis is suppressed', async () => {
	const previous = record({ report_sha256: 'b'.repeat( 64 ), timestamp: '2026-08-24T00:00:00Z' });
	const current = record({ report_sha256: 'c'.repeat( 64 ) });
	const cases = [
		{
			compositionChanged: null,
			currentTests: [{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'a', outcome: 'failed' }],
			diagnostic: /not unique/,
			previousTests: [{ nodeid: 'a', outcome: 'passed' }]
		},
		{
			compositionChanged: true,
			currentTests: [{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'b', outcome: 'passed' }],
			diagnostic: /composition changed/,
			previousTests: [{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'c', outcome: 'passed' }]
		}
	];
	for ( const value of cases ) {
		const model = await buildDashboardModel({
			index: { records: [ previous, current ] },
			loadProjection: async ( run ) => ({
				failures: [],
				tests: run.report_sha256 === current.report_sha256 ? value.currentTests : value.previousTests
			}),
			registry: REGISTRY
		});
		const comparison = model.contexts[ 0 ].comparison;
		assert.equal( comparison.headline, '' );
		assert.match( comparison.diagnostic, value.diagnostic );
		assert.equal( model.contexts[ 0 ].history[ 0 ].historyPoint.compositionChanged, value.compositionChanged );
	}
} );

test( 'builds registered empty states and an exact same-suite comparison', async () => {
	const previous = record({
		report_sha256: 'b'.repeat( 64 ),
		test_suite: 'A'.repeat( 40 ),
		timestamp: '2026-08-24T00:00:00Z'
	});
	const current = record({
		report_sha256: 'c'.repeat( 64 ),
		summary: { collected: 2, failed: 1, passed: 1, skipped: 0, total: 2 },
		test_suite: 'a'.repeat( 40 )
	});
	const projections = new Map([
		[ previous.report_sha256, { failures: [], tests: [{ nodeid: 'a', outcome: 'passed' }, { nodeid: 'b', outcome: 'passed' }] } ],
		[ current.report_sha256, { failures: [{ nodeid: 'a', outcome: 'failed' }], tests: [{ nodeid: 'a', outcome: 'failed' }, { nodeid: 'b', outcome: 'passed' }] } ]
	]);
	const loads = [];
	const model = await buildDashboardModel({
		index: { records: [ previous, current ] },
		loadProjection: async ( value ) => {
			loads.push( value.report_sha256 );
			return projections.get( value.report_sha256 );
		},
		registry: REGISTRY
	});

	assert.deepEqual( model.libraries.map( ( library ) => library.name ), [ 'Alpha', 'Zeta' ] );
	assert.equal( model.libraries[ 1 ].hasReports, false );
	assert.equal( model.defaultLibrary.id, 'alpha' );
	assert.equal( model.contexts[ 0 ].comparison.available, true );
	assert.equal( model.contexts[ 0 ].comparison.headline, '1 test changed from passed to failed.' );
	assert.equal( model.contexts[ 0 ].failureCount, 1 );
	assert.equal( model.contexts[ 0 ].current.passPercentageText, '50.0%' );
	assert.deepEqual( loads.sort(), [ current.report_sha256, previous.report_sha256 ].sort() );
} );

test( 'summarizes every outcome transition when aggregate counts are unchanged', async () => {
	const previous = record({
		report_sha256: 'b'.repeat( 64 ),
		summary: { collected: 2, failed: 1, passed: 1, total: 2 },
		timestamp: '2026-08-24T00:00:00Z'
	});
	const current = record({
		report_sha256: 'c'.repeat( 64 ),
		summary: { collected: 2, failed: 1, passed: 1, total: 2 }
	});
	const projections = new Map([
		[ previous.report_sha256, { failures: [{ nodeid: 'b', outcome: 'failed' }], tests: [
			{ nodeid: 'a', outcome: 'passed' },
			{ nodeid: 'b', outcome: 'failed' }
		] } ],
		[ current.report_sha256, { failures: [{ nodeid: 'a', outcome: 'failed' }], tests: [
			{ nodeid: 'a', outcome: 'failed' },
			{ nodeid: 'b', outcome: 'passed' }
		] } ]
	]);
	const model = await buildDashboardModel({
		index: { records: [ previous, current ] },
		loadProjection: async ( value ) => projections.get( value.report_sha256 ),
		registry: REGISTRY
	});

	assert.equal(
		model.contexts[ 0 ].comparison.headline,
		'2 tests changed outcome: 1 passed to failed; 1 failed to passed.'
	);
} );

test( 'does not skip an immediate suite boundary to compare an older run', async () => {
	const oldSameSuite = record({ report_sha256: 'd'.repeat( 64 ), timestamp: '2026-08-01T00:00:00Z' });
	const boundary = record({ report_sha256: 'e'.repeat( 64 ), test_suite: 'b'.repeat( 40 ), timestamp: '2026-08-20T00:00:00Z' });
	const current = record({ report_sha256: 'f'.repeat( 64 ), timestamp: '2026-08-31T00:00:00Z' });
	let loads = 0;
	const model = await buildDashboardModel({
		index: { records: [ oldSameSuite, boundary, current ] },
		loadProjection: async () => {
			loads += 1;
			return { failures: [], tests: [] };
		},
		registry: REGISTRY
	});
	assert.equal( model.contexts[ 0 ].comparison.available, false );
	assert.match( model.contexts[ 0 ].comparison.message, /First run/ );
	assert.equal( loads, 0 );
} );

test( 'keeps sources and execution targets in separate contexts', async () => {
	const cpu = record({ timestamp: '2026-08-30T00:00:00Z' });
	const otherSource = record({
		report_sha256: '2'.repeat( 64 ),
		source_id: 'nightly',
		timestamp: '2026-08-31T00:00:00Z'
	});
	const gpu = record({
		execution_target: { backend: 'cuda', driver_version: '570', kind: 'gpu' },
		report_sha256: '3'.repeat( 64 ),
		series: {
			...cpu.series,
			execution_target: { backend: 'cuda', kind: 'gpu' }
		},
		series_key: 'sha256:'+ '4'.repeat( 64 ),
		variant_key: 'sha256:'+ '5'.repeat( 64 ),
		timestamp: '2026-08-29T00:00:00Z'
	});
	const registry = structuredClone( REGISTRY );
	registry.libraries[ 1 ].sources.push({ id: 'nightly' });
	const model = await buildDashboardModel({
		index: { records: [ cpu, gpu, otherSource ] },
		loadProjection: async () => ({ failures: [], tests: [] }),
		registry
	});
	assert.equal( model.contexts.length, 3 );
	assert.equal( model.defaultLibrary.defaultContext.sourceId, 'nightly' );
	assert.equal( model.contexts.some( ( context ) => context.label.includes( 'GPU · CUDA' ) ), true );
	model.contexts.forEach( ( context ) => assert.equal( context.comparison.available, false ) );
} );

test( 'keeps runtime and driver variants in one series with visible environment changes', async () => {
	function accelerator( digest, runtime, driver, timestamp ) {
		const executionTarget = {
			backend: 'cuda',
			device_model: 'NVIDIA H100',
			driver_version: driver,
			kind: 'gpu',
			runtime_version: runtime
		};
		return record({
			execution_target: executionTarget,
			report_sha256: digest.repeat( 64 ),
			series: {
				...record().series,
				execution_target: {
					backend: executionTarget.backend,
					device_model: executionTarget.device_model,
					kind: executionTarget.kind
				}
			},
			series_key: 'sha256:'+ '6'.repeat( 64 ),
			variant: { ...record().variant, execution_target: executionTarget },
			variant_key: 'sha256:'+digest.repeat( 64 ),
			timestamp
		});
	}
	const model = await buildDashboardModel({
		index: { records: [
			accelerator( '4', '12.8', '570', '2026-08-31T00:00:00Z' ),
			accelerator( '5', '12.9', '571', '2026-08-30T00:00:00Z' )
		] },
		loadProjection: async () => ({ failures: [], tests: [] }),
		registry: REGISTRY
	});
	assert.equal( model.defaultLibrary.contexts.length, 1 );
	assert.equal( model.defaultLibrary.contexts[ 0 ].history.length, 2 );
	assert.match( model.defaultLibrary.contexts[ 0 ].history[ 0 ].environment, /Platform Linux test host/ );
	assert.match( model.defaultLibrary.contexts[ 0 ].history[ 0 ].environment, /Runtime 12\.8 · Driver 570/ );
	assert.match( model.defaultLibrary.contexts[ 0 ].history[ 1 ].environment, /Runtime 12\.9 · Driver 571/ );
	assert.deepEqual(
		model.defaultLibrary.contexts[ 0 ].comparison.environmentChanges.map( ( change ) => change.label ),
		[ 'Runtime version', 'Driver version' ]
	);
} );

test( 'history points preserve the framework-independent plotting seam', async () => {
	const value = record({ summary: { collected: 4, failed: 1, passed: 2, skipped: 1, total: 4 } });
	const model = await buildDashboardModel({
		index: { records: [ value ] },
		loadProjection: async () => ({ failures: [{ nodeid: 'a', outcome: 'failed' }], tests: [] }),
		registry: REGISTRY
	});
	assert.deepEqual( model.contexts[ 0 ].history[ 0 ].historyPoint, {
		collected: 4,
		compositionChanged: null,
		outcomes: { passed: 2, failed: 1, skipped: 1 },
		passRate: 0.5,
		suiteEpoch: 'a'.repeat( 40 ),
		timestamp: value.timestamp,
		total: 4,
		variantKey: value.variant_key
	});
} );

test( 'loads only the newest and immediate predecessor from long history', async () => {
	const records = Array.from({ length: 20 }, ( _, index ) => record({
		report_sha256: String( index ).padStart( 64, '0' ),
		timestamp: '2026-08-'+String( index + 1 ).padStart( 2, '0' )+'T00:00:00Z'
	}) );
	const loads = [];
	await buildDashboardModel({
		index: { records },
		loadProjection: async ( value ) => {
			loads.push( value.report_sha256 );
			return { failures: [], tests: [] };
		},
		registry: REGISTRY
	});
	assert.deepEqual( loads, [ records[ 19 ].report_sha256, records[ 18 ].report_sha256 ] );
} );

test( 'deduplicates report projections by digest and records build cost', async ( t ) => {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-loader-' ) );
	t.after( () => fs.rmSync( root, { force: true, recursive: true }) );
	fs.mkdirSync( path.join( root, 'data' ) );
	const envelope = { report: { data: { tests: [
		{ nodeid: 'a', outcome: 'passed' },
		{ nodeid: 'b', outcome: 'failed' }
	] } } };
	const source = Buffer.from( JSON.stringify( envelope ) );
	fs.writeFileSync( path.join( root, 'data', 'shared.json.gz' ), zlib.gzipSync( source ) );
	const stats = { expandedBytes: 0, reportsLoaded: 0 };
	const loader = createProjectionLoader( root, stats );
	const digest = 'a'.repeat( 64 );
	const [ first, second ] = await Promise.all([
		loader({ path: 'shared.json.gz', report_sha256: digest }),
		loader({ path: 'missing-but-deduplicated.json.gz', report_sha256: digest })
	]);
	assert.strictEqual( first, second );
	assert.deepEqual( first.failures, [{ nodeid: 'b', outcome: 'failed' }] );
	assert.deepEqual( stats, { expandedBytes: source.byteLength, reportsLoaded: 1 } );
} );

test( 'rejects a report whose expanded envelope exceeds the build limit', async ( t ) => {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-loader-limit-' ) );
	t.after( () => fs.rmSync( root, { force: true, recursive: true }) );
	fs.mkdirSync( path.join( root, 'data' ) );
	const filepath = path.join( root, 'data', 'oversized.json.gz' );
	fs.writeFileSync(
		filepath,
		zlib.gzipSync( Buffer.alloc( MAX_EXPANDED_BYTES + 1, 0x20 ), { level: zlib.constants.Z_BEST_SPEED })
	);
	const stats = { expandedBytes: 0, reportsLoaded: 0 };
	const loader = createProjectionLoader( root, stats );
	await assert.rejects(
		loader({ path: 'oversized.json.gz', report_sha256: 'f'.repeat( 64 ) }),
		/Unable to expand indexed report/
	);
	assert.deepEqual( stats, { expandedBytes: 0, reportsLoaded: 0 } );
} );
