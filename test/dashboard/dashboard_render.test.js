/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
*/

'use strict';

const assert = require( 'node:assert/strict' );
const childProcess = require( 'node:child_process' );
const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const test = require( 'node:test' );
const zlib = require( 'node:zlib' );

const ROOT = path.resolve( __dirname, '..', '..' );
const ELEVENTY = path.join( ROOT, 'node_modules', '@11ty', 'eleventy', 'cmd.cjs' );

function build( pathPrefix, dataRoot ) {
	const output = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-render-' ) );
	const result = childProcess.spawnSync(
		process.execPath,
		[ ELEVENTY, '--config=public/eleventy.config.js' ],
		{
			cwd: ROOT,
			encoding: 'utf8',
			env: {
				...process.env,
				DASHBOARD_DATA_ROOT: dataRoot || ROOT,
				DASHBOARD_OUTPUT_DIR: output,
				DASHBOARD_PATH_PREFIX: pathPrefix
			}
		}
	);
	assert.equal( result.status, 0, result.stdout+'\n'+result.stderr );
	return output;
}

function read( output, relative ) {
	return fs.readFileSync( path.join( output, relative ), 'utf8' );
}

function outputForHref( output, href, prefix ) {
	const withoutFragment = href.split( '#' )[ 0 ];
	if ( withoutFragment === '' ) {
		return null;
	}
	assert.ok( withoutFragment.startsWith( prefix ), 'unprefixed internal link: '+href );
	let relative = withoutFragment.slice( prefix.length );
	if ( relative === '' || relative.endsWith( '/' ) ) {
		relative += 'index.html';
	}
	return path.join( output, relative );
}

function assertInternalLinksResolve( output, prefix ) {
	const htmlFiles = [];
	fs.readdirSync( output, { recursive: true, withFileTypes: true } ).forEach( ( entry ) => {
		if ( entry.isFile() && entry.name.endsWith( '.html' ) ) {
			htmlFiles.push( path.join( entry.parentPath, entry.name ) );
		}
	});
	htmlFiles.forEach( ( filepath ) => {
		const source = fs.readFileSync( filepath, 'utf8' );
		for ( const match of source.matchAll( /href="([^"]+)"/g ) ) {
			if ( /^(?:https?:|mailto:)/.test( match[ 1 ] ) ) {
				continue;
			}
			const target = outputForHref( output, match[ 1 ], prefix );
			if ( target ) {
				assert.ok( fs.existsSync( target ), filepath+' links to missing '+target );
			}
		}
	});
}

function syntheticDataRoot() {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-data-' ) );
	fs.mkdirSync( path.join( root, 'registry' ) );
	fs.mkdirSync( path.join( root, 'data' ) );
	fs.writeFileSync( path.join( root, 'registry', 'data.json' ), JSON.stringify({
		libraries: [{
			id: 'escaped',
			name: '<script>alert("stored")</script>',
			sources: [{ id: 'demo' }]
		}]
	}) );
	fs.writeFileSync( path.join( root, 'data', 'index.json' ), JSON.stringify({
		records: [{
			api_version: '2025.12',
			execution_target: { kind: 'cpu' },
			library_id: 'escaped',
			path: 'unused.json.gz',
			platform: { description: 'Linux', machine: 'x86_64', release: '6', system: 'Linux' },
			python: '3.14.1',
			report_sha256: 'a'.repeat( 64 ),
			series: {
				api_version: '2025.12',
				execution_target: { kind: 'cpu' },
				platform: { machine: 'x86_64', system: 'Linux' },
				python: '3.14'
			},
				series_key: 'sha256:'+ 'b'.repeat( 64 ),
				series_schema: 'compliance-v1-series-v1',
				source_id: 'demo',
			summary: { collected: 1, passed: 1, total: 1 },
			test_suite: 'c'.repeat( 40 ),
				timestamp: '2026-08-31T00:00:00Z',
				variant: {
					api_version: '2025.12',
					execution_target: { kind: 'cpu' },
					platform: { description: 'Linux', machine: 'x86_64', release: '6', system: 'Linux' },
					python: '3.14.1'
				},
				variant_key: 'sha256:'+ 'd'.repeat( 64 ),
				variant_schema: 'compliance-v1-variant-v1',
				version: '1.0.0'
		}]
	}) );
	return root;
}

function emptyDataRoot() {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-empty-' ) );
	fs.mkdirSync( path.join( root, 'registry' ) );
	fs.mkdirSync( path.join( root, 'data' ) );
	fs.writeFileSync( path.join( root, 'registry', 'data.json' ), JSON.stringify({
		libraries: [{ id: 'waiting', name: 'Waiting Library', sources: [{ id: 'ci' }] }]
	}) );
	fs.writeFileSync( path.join( root, 'data', 'index.json' ), JSON.stringify({ records: [] }) );
	return root;
}

function unknownOutcomeDataRoot() {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-unknown-' ) );
	fs.mkdirSync( path.join( root, 'registry' ) );
	fs.mkdirSync( path.join( root, 'data' ) );
	fs.writeFileSync( path.join( root, 'registry', 'data.json' ), JSON.stringify({
		libraries: [{ id: 'alpha', name: 'Alpha', sources: [{ id: 'ci' }] }]
	}) );
	const records = [ '2026-08-30T02:33:08Z', '2026-08-31T12:03:30Z' ].map( ( timestamp, index ) => {
		const executionTarget = { kind: 'cpu', runtime_version: index === 0 ? '3.1' : '3.2' };
		const platform = {
			description: index === 0 ? 'Linux glibc 2.38' : 'Linux glibc 2.39',
			machine: 'x86_64',
			release: index === 0 ? '6.0' : '6.1',
			system: 'Linux'
		};
		const python = index === 0 ? '3.14.1' : '3.14.2';
		return {
			api_version: '2025.12',
			execution_target: executionTarget,
			library_id: 'alpha',
			path: 'report-'+index+'.json.gz',
			platform,
			python,
			report_sha256: String( index + 1 ).repeat( 64 ),
			series: {
				api_version: '2025.12',
				execution_target: { kind: 'cpu' },
				platform: { machine: 'x86_64', system: 'Linux' },
				python: '3.14'
			},
			series_key: 'sha256:'+ 'b'.repeat( 64 ),
			series_schema: 'compliance-v1-series-v1',
			source_id: 'ci',
			summary: index === 0 ?
				{ collected: 3, passed: 2, total: 3, xfailed: 1 } :
				{ collected: 3, failed: 1, passed: 1, total: 3, xfailed: 1 },
			test_suite: 'c'.repeat( 40 ),
			timestamp,
			variant: { api_version: '2025.12', execution_target: executionTarget, platform, python },
			variant_key: 'sha256:'+String( index + 3 ).repeat( 64 ),
			variant_schema: 'compliance-v1-variant-v1',
			version: index === 0 ? '1.0.0' : '2.0.0'
		};
	});
	records.forEach( ( value, index ) => {
		const envelope = { report: { data: { tests: [
			{ nodeid: 'a', outcome: 'passed' },
			{ nodeid: 'b', outcome: index === 0 ? 'passed' : 'failed' },
			{ nodeid: 'c', outcome: 'xfailed' }
		] } } };
		fs.writeFileSync( path.join( root, 'data', value.path ), zlib.gzipSync( JSON.stringify( envelope ) ) );
	});
	fs.writeFileSync( path.join( root, 'data', 'index.json' ), JSON.stringify({ records }) );
	return root;
}

function multiContextDataRoot() {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'dashboard-contexts-' ) );
	fs.mkdirSync( path.join( root, 'registry' ) );
	fs.mkdirSync( path.join( root, 'data' ) );
	fs.writeFileSync( path.join( root, 'registry', 'data.json' ), JSON.stringify({
		libraries: [{ id: 'alpha', name: 'Alpha', sources: [{ id: 'ci' }] }]
	}) );
	const records = [
		{ digest: 'd', executionTarget: { kind: 'cpu' }, timestamp: '2026-08-31T00:00:00Z' },
		{ digest: 'e', executionTarget: { backend: 'cuda', driver_version: '570', kind: 'gpu' }, timestamp: '2026-08-30T00:00:00Z' }
	].map( ( value ) => ({
		api_version: '2025.12',
		execution_target: value.executionTarget,
		library_id: 'alpha',
		path: 'unused-'+value.digest+'.json.gz',
		platform: { description: 'Linux', machine: 'x86_64', release: '6', system: 'Linux' },
		python: '3.14.1',
		report_sha256: value.digest.repeat( 64 ),
		series: {
			api_version: '2025.12',
			execution_target: value.executionTarget.backend ? {
				backend: value.executionTarget.backend,
				kind: value.executionTarget.kind
			} : { kind: value.executionTarget.kind },
			platform: { machine: 'x86_64', system: 'Linux' },
			python: '3.14'
		},
		series_key: 'sha256:'+value.digest.repeat( 64 ),
		series_schema: 'compliance-v1-series-v1',
		source_id: 'ci',
		summary: { collected: 1, passed: 1, total: 1 },
			test_suite: 'c'.repeat( 40 ),
			timestamp: value.timestamp,
			variant: {
				api_version: '2025.12',
				execution_target: value.executionTarget,
				platform: { description: 'Linux', machine: 'x86_64', release: '6', system: 'Linux' },
				python: '3.14.1'
			},
			version: '1.0.0',
			variant_key: 'sha256:'+value.digest.repeat( 64 ),
			variant_schema: 'compliance-v1-variant-v1'
	}) );
	fs.writeFileSync( path.join( root, 'data', 'index.json' ), JSON.stringify({ records }) );
	return root;
}

test( 'builds current repository data and resolves every generated route', () => {
	const output = build( '/' );
	const homepage = read( output, 'index.html' );
	assert.match( homepage, /<main class="dashboard-shell" id="main-content">/ );
	assert.ok( fs.existsSync( path.join( output, 'about', 'index.html' ) ) );
	assertInternalLinksResolve( output, '/' );
	const files = fs.readdirSync( output, { recursive: true } ).map( String );
	assert.ok( files.some( ( name ) => /(?:^|\/)libraries\/[^/]+\/index\.html$/.test( name ) ) );
	assert.ok( files.some( ( name ) => /(?:^|\/)series\/[^/]+\/history\/index\.html$/.test( name ) ) );
	assert.equal( files.some( ( name ) => /\.(?:gz|njk|js)$/.test( name ) ), false );
	const about = read( output, 'about/index.html' );
	assert.match( about, /stable execution-target details: kind, backend, and device model/ );
	assert.match( about, /identify a variant within that series/ );
} );

test( 'prefixes links for project Pages', () => {
	const prefix = '/array-api-tests-compliance-data';
	const output = build( prefix, syntheticDataRoot() );
	const homepage = read( output, 'index.html' );
	assert.match( homepage, /href="\/array-api-tests-compliance-data\/assets\/css\/site\.css"/ );
	assertInternalLinksResolve( output, prefix );
} );

test( 'escapes stored strings and omits false failure and picker actions', () => {
	const dataRoot = syntheticDataRoot();
	const output = build( '/', dataRoot );
	const homepage = read( output, 'index.html' );
	assert.doesNotMatch( homepage, /<script>alert/ );
	assert.match( homepage, /&lt;script&gt;alert\(&quot;stored&quot;\)&lt;\/script&gt;/ );
	assert.match( homepage, /No failed tests/ );
	assert.doesNotMatch( homepage, /View failed tests/ );
	assert.doesNotMatch( homepage, /class="context-picker"/ );
	assert.doesNotMatch( homepage, /First run[^<]*[+-]\d/ );
} );

test( 'renders one site-level state when no reports have been harvested', () => {
	const output = build( '/', emptyDataRoot() );
	const homepage = read( output, 'index.html' );
	assert.match( homepage, /No compliance reports have been harvested yet/ );
	assert.doesNotMatch( homepage, /class="dashboard-shell"/ );
	assert.doesNotMatch( homepage, /Updated <time/ );
	assert.doesNotMatch( homepage, /#libraries-(?:desktop|mobile)/ );
	assert.doesNotMatch( homepage.match( /<nav class="top-nav"[\s\S]*?<\/nav>/ )[ 0 ], /Libraries/ );
} );

test( 'selects the newest synthetic run and retains extension outcomes', () => {
	const output = build( '/', unknownOutcomeDataRoot() );
	const homepage = read( output, 'index.html' );
	assert.match( homepage, /<h2 id="library-result-title">Alpha <span>2\.0\.0<\/span><\/h2>/ );
	assert.match( homepage, /1 of 3 tests passed/ );
	assert.match( homepage, /comparison-outcomes[\s\S]*1 xfailed[\s\S]*comparison-row--current[\s\S]*1 xfailed/ );
	assert.match( homepage, /<li>Python 3\.14\.2<\/li>/ );
	assert.match( homepage, /Linux 6\.1 x86_64<\/li>/ );
	assert.match( homepage, /Platform Linux glibc 2\.39/ );
	assert.match( homepage, /aria-label="Environment changes"/ );
	assert.match( homepage, /Python:<\/strong> previous 3\.14\.1; current 3\.14\.2/ );
	assert.match( homepage, /Platform:<\/strong> previous Linux glibc 2\.38; current Linux glibc 2\.39/ );
	assert.match( homepage, /Runtime version:<\/strong> previous 3\.1; current 3\.2/ );
	const seriesRoot = 'libraries/alpha/sources/ci/series/'+ 'b'.repeat( 64 );
	const failures = read( output, seriesRoot+'/failures/index.html' );
	assert.match( failures, /August 31, 2026 at 12:03:30 UTC/ );
	assert.match( failures, /Python 3\.14\.2 · Linux 6\.1 x86_64 · Platform Linux glibc 2\.39 · CPU · Runtime 3\.2/ );
	const history = read( output, seriesRoot+'/history/index.html' );
	assert.ok( history.indexOf( '2026-08-31T12:03:30Z' ) < history.indexOf( '2026-08-30T02:33:08Z' ) );
} );

test( 'marks a context as the current page only on its exact series route', () => {
	const output = build( '/', multiContextDataRoot() );
	const homepage = read( output, 'index.html' );
	const library = read( output, 'libraries/alpha/index.html' );
	const series = read( output, 'libraries/alpha/sources/ci/series/'+ 'd'.repeat( 64 )+'/index.html' );
	assert.doesNotMatch( homepage, /class="context-picker"[\s\S]*aria-current="page"/ );
	assert.doesNotMatch( library, /class="context-picker"[\s\S]*aria-current="page"/ );
	assert.match( series, /class="context-picker"[\s\S]*aria-current="page"/ );
} );
