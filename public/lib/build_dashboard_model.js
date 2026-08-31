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

const {
	formatContextLabel,
	formatCount,
	formatDate,
	formatExecutionTarget,
	formatOutcomeName,
	formatRunEnvironment
} = require( './format_context.js' );
const { compareRuns } = require( './compare_runs.js' );

const OUTCOME_PRIORITY = new Map([
	[ 'passed', 0 ],
	[ 'failed', 1 ],
	[ 'skipped', 2 ]
]);

function compareStrings( a, b ) {
	return String( a ).localeCompare( String( b ) );
}

function sortRecords( a, b ) {
	const time = new Date( b.timestamp ).getTime() - new Date( a.timestamp ).getTime();
	if ( time !== 0 ) {
		return time;
	}
	const keys = [ 'library_id', 'source_id', 'series_schema', 'series_key', 'report_sha256', 'path' ];
	for ( const key of keys ) {
		const result = compareStrings( a[ key ], b[ key ] );
		if ( result !== 0 ) {
			return result;
		}
	}
	return 0;
}

function orderedOutcomeNames( summary ) {
	return Object.keys( summary )
		.filter( ( key ) => key !== 'collected' && key !== 'total' )
		.sort( ( a, b ) => {
			const aRank = OUTCOME_PRIORITY.has( a ) ? OUTCOME_PRIORITY.get( a ) : 3;
			const bRank = OUTCOME_PRIORITY.has( b ) ? OUTCOME_PRIORITY.get( b ) : 3;
			return aRank - bRank || compareStrings( a, b );
		});
}

function runView( record ) {
	const passed = record.summary.passed || 0;
	const total = record.summary.total;
	const percentage = total === 0 ? null : ( passed / total ) * 100;
	const outcomes = orderedOutcomeNames( record.summary ).map( ( name ) => ({
		count: record.summary[ name ],
		countText: formatCount( record.summary[ name ] ),
		label: formatOutcomeName( name ),
		name,
		tone: OUTCOME_PRIORITY.has( name ) ? name : 'neutral',
		percentage: total === 0 ? 0 : ( record.summary[ name ] / total ) * 100
	}) );
	return {
		apiVersion: record.api_version,
		dateTime: formatDate( record.timestamp, 'datetime' ),
		dateLong: formatDate( record.timestamp, 'long' ),
		dateShort: formatDate( record.timestamp, 'short' ),
		environment: formatRunEnvironment( record ),
		executionTarget: formatExecutionTarget( record.execution_target ),
		outcomes,
		passPercentage: percentage,
		passPercentageText: percentage === null ? '' : percentage.toFixed( 1 )+'%',
		passed,
		passedText: formatCount( passed ),
		platform: record.platform,
		python: record.python,
		reportSha256: record.report_sha256,
		resultText: total === 0 ? 'No tests collected' : formatCount( passed )+' of '+formatCount( total )+' tests passed',
		summary: record.summary,
		suite: record.test_suite.toLowerCase(),
		timestamp: record.timestamp,
		total,
		totalText: formatCount( total ),
		variantKey: record.variant_key,
		version: record.version
	};
}

function contextPath( record ) {
	const digest = record.series_key.replace( /^sha256:/, '' );
	return '/libraries/'+record.library_id+'/sources/'+record.source_id+'/series/'+digest+'/';
}

function historyPoints( records ) {
	let priorSuite = '';
	return records.map( ( record ) => {
		const run = runView( record );
		const startsEpoch = priorSuite !== run.suite;
		priorSuite = run.suite;
		return {
			...run,
			historyPoint: {
				collected: record.summary.collected,
				compositionChanged: null,
				outcomes: Object.fromEntries( run.outcomes.map( ( outcome ) => [ outcome.name, outcome.count ]) ),
				passRate: run.passPercentage === null ? null : run.passPercentage / 100,
				suiteEpoch: run.suite,
				timestamp: run.timestamp,
				total: run.total,
				variantKey: run.variantKey
			},
			startsEpoch
		};
	});
}

function transitionText( transition ) {
	return transition.count+' '+transition.from+' to '+transition.to;
}

function headlineText( transitions ) {
	if ( transitions.length === 0 ) {
		return 'No tests changed outcome.';
	}
	if ( transitions.length === 1 ) {
		const transition = transitions[ 0 ];
		const noun = transition.count === 1 ? 'test' : 'tests';
		return transition.count+' '+noun+' changed from '+transition.from+' to '+transition.to+'.';
	}
	const total = transitions.reduce( ( sum, transition ) => sum + transition.count, 0 );
	return total+' tests changed outcome: '+transitions.map( transitionText ).join( '; ' )+'.';
}

function comparisonView( currentRecord, previousRecord, result ) {
	return {
		available: true,
		current: runView( currentRecord ),
		diagnostic: result.tests.diagnostic,
		environmentChanges: result.environmentChanges,
		headline: result.tests.diagnostic ? '' : headlineText( result.tests.transitions ),
		previous: runView( previousRecord ),
		summaryDeltas: result.summaryDeltas,
		tests: result.tests
	};
}

async function createContext( records, libraryName, sourceName, loadProjection ) {
	const currentRecord = records[ 0 ];
	const previousRecord = records[ 1 ];
	const sameSuite = previousRecord && currentRecord.test_suite.toLowerCase() === previousRecord.test_suite.toLowerCase();
	const hasFailures = ( currentRecord.summary.failed || 0 ) > 0;
	let currentProjection = null;
	let comparison = {
		available: false,
		message: 'First run for this test-suite revision.'
	};
	if ( hasFailures || sameSuite ) {
		currentProjection = await loadProjection( currentRecord );
	}
	if ( sameSuite ) {
		const previousProjection = await loadProjection( previousRecord );
		comparison = comparisonView(
			currentRecord,
			previousRecord,
			compareRuns( currentRecord, previousRecord, currentProjection, previousProjection )
		);
	}
	const history = historyPoints( records );
	if ( sameSuite ) {
		history[ 0 ].historyPoint.compositionChanged = comparison.tests.compositionChanged;
	}
	const path = contextPath( currentRecord );
	return {
		comparison,
		current: runView( currentRecord ),
		failureCount: hasFailures ? currentProjection.failures.length : 0,
		failures: hasFailures ? currentProjection.failures : [],
		failuresUrl: hasFailures ? path+'failures/' : '',
		history,
		historyUrl: path+'history/',
		label: formatContextLabel( currentRecord, sourceName ),
		libraryId: currentRecord.library_id,
		libraryName,
		libraryUrl: '/libraries/'+currentRecord.library_id+'/',
		path,
		series: currentRecord.series,
		seriesKey: currentRecord.series_key,
		shortLabel: 'Array API '+currentRecord.series.api_version,
		sourceId: currentRecord.source_id,
		sourceName
	};
}

function groupContextRecords( records ) {
	const groups = new Map();
	records.forEach( ( record ) => {
		const key = record.library_id+'\u0000'+record.source_id+'\u0000'+record.series_key;
		if ( !groups.has( key ) ) {
			groups.set( key, [] );
		}
		groups.get( key ).push( record );
	});
	return Array.from( groups.values() ).map( ( group ) => group.sort( sortRecords ) );
}

function sourceLabel( library, sourceId ) {
	const source = library.sources.find( ( item ) => item.id === sourceId );
	return source ? source.id : sourceId;
}

async function buildDashboardModel( options ) {
	const { index, loadProjection, registry } = options;
	const registered = new Map( registry.libraries.map( ( library ) => [ library.id, library ]) );
	index.records.forEach( ( record ) => {
		if ( !registered.has( record.library_id ) ) {
			throw new Error( 'Index references unregistered library: '+record.library_id );
		}
	});
	const records = index.records.slice().sort( sortRecords );
	const libraries = registry.libraries.slice()
		.sort( ( a, b ) => compareStrings( a.name, b.name ) || compareStrings( a.id, b.id ) )
		.map( ( library ) => ({
			id: library.id,
			name: library.name,
			sources: library.sources,
			url: '/libraries/'+library.id+'/'
		}) );
	const contextGroups = groupContextRecords( records );
	const contexts = [];
	for ( const group of contextGroups ) {
		const library = registered.get( group[ 0 ].library_id );
		contexts.push( await createContext( group, library.name, sourceLabel( library, group[ 0 ].source_id ), loadProjection ) );
	}
	contexts.sort( ( a, b ) => {
		const time = new Date( b.current.timestamp ).getTime() - new Date( a.current.timestamp ).getTime();
		return time || compareStrings( a.libraryId, b.libraryId ) || compareStrings( a.sourceId, b.sourceId ) || compareStrings( a.seriesKey, b.seriesKey );
	});

	for ( const library of libraries ) {
		library.contexts = contexts.filter( ( context ) => context.libraryId === library.id );
		library.contexts.forEach( ( context ) => {
			context.shortLabel = library.contexts.length > 1 ? context.label : 'Array API '+context.current.apiVersion;
		});
		library.hasReports = library.contexts.length > 0;
		library.defaultContext = library.contexts[ 0 ] || null;
		library.latestTimestamp = library.hasReports ? library.defaultContext.current.timestamp : '';
	}
	const defaultLibrary = libraries.find( ( library ) => library.hasReports ) || libraries[ 0 ] || null;
	return {
		contexts,
		defaultLibrary,
		failureContexts: contexts.filter( ( context ) => context.failuresUrl ),
		hasReports: records.length > 0,
		libraryById: Object.fromEntries( libraries.map( ( library ) => [ library.id, library ]) ),
		libraries,
		updated: records.length ? {
			date: formatDate( records[ 0 ].timestamp, 'compact' ),
			timestamp: records[ 0 ].timestamp
		} : null
	};
}

module.exports = {
	buildDashboardModel,
	contextPath,
	orderedOutcomeNames,
	runView,
	sortRecords
};
