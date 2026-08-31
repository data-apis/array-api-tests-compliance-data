/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
*/

'use strict';

const STRUCTURAL_SUMMARY_KEYS = new Set([ 'collected', 'total' ]);

function compareSummaries( current, previous ) {
	const keys = new Set( Object.keys( current ).concat( Object.keys( previous ) ) );
	return Array.from( keys )
		.filter( ( key ) => !STRUCTURAL_SUMMARY_KEYS.has( key ) )
		.sort()
		.map( ( key ) => ({
			current: current[ key ] || 0,
			delta: ( current[ key ] || 0 ) - ( previous[ key ] || 0 ),
			name: key,
			previous: previous[ key ] || 0
		}) );
}

function duplicateIds( tests ) {
	const seen = new Set();
	const duplicates = new Set();
	tests.forEach( ( test ) => {
		if ( seen.has( test.nodeid ) ) {
			duplicates.add( test.nodeid );
		}
		seen.add( test.nodeid );
	});
	return Array.from( duplicates ).sort();
}

function transitionRank( transition ) {
	if ( transition.from === 'passed' && transition.to === 'failed' ) {
		return '00';
	}
	if ( transition.from === 'failed' && transition.to === 'passed' ) {
		return '01';
	}
	return '02-'+transition.from+'-'+transition.to;
}

function compareTests( currentTests, previousTests ) {
	const duplicates = {
		current: duplicateIds( currentTests ),
		previous: duplicateIds( previousTests )
	};
	if ( duplicates.current.length || duplicates.previous.length ) {
		return {
			added: [],
			compositionChanged: null,
			diagnostic: 'Test identifiers are not unique; per-test changes are unavailable.',
			duplicates,
			removed: [],
			transitions: []
		};
	}

	const current = new Map( currentTests.map( ( test ) => [ test.nodeid, test.outcome ]) );
	const previous = new Map( previousTests.map( ( test ) => [ test.nodeid, test.outcome ]) );
	const added = Array.from( current.keys() ).filter( ( key ) => !previous.has( key ) ).sort();
	const removed = Array.from( previous.keys() ).filter( ( key ) => !current.has( key ) ).sort();
	if ( added.length || removed.length ) {
		return {
			added,
			compositionChanged: true,
			diagnostic: 'Test composition changed; per-test transition counts are unavailable.',
			duplicates,
			removed,
			transitions: []
		};
	}

	const groups = new Map();
	Array.from( current.keys() ).sort().forEach( ( nodeid ) => {
		const from = previous.get( nodeid );
		const to = current.get( nodeid );
		if ( from === to ) {
			return;
		}
		const key = from+'->'+to;
		if ( !groups.has( key ) ) {
			groups.set( key, { from, tests: [], to } );
		}
		groups.get( key ).tests.push( nodeid );
	});
	const transitions = Array.from( groups.values() )
		.map( ( group ) => ({ ...group, count: group.tests.length }) )
		.sort( ( a, b ) => transitionRank( a ).localeCompare( transitionRank( b ) ) );
	return {
		added,
		compositionChanged: false,
		diagnostic: '',
		duplicates,
		removed,
		transitions
	};
}

function environmentChanges( current, previous ) {
	const changes = [];
	const currentTarget = current.execution_target || {};
	const previousTarget = previous.execution_target || {};
	[
		[ 'Python', current.python, previous.python ],
		[ 'OS release', current.platform && current.platform.release, previous.platform && previous.platform.release ],
		[ 'Platform', current.platform && current.platform.description, previous.platform && previous.platform.description ],
		[ 'Target kind', currentTarget.kind, previousTarget.kind ],
		[ 'Backend', currentTarget.backend, previousTarget.backend ],
		[ 'Device model', currentTarget.device_model, previousTarget.device_model ],
		[ 'Runtime version', currentTarget.runtime_version, previousTarget.runtime_version ],
		[ 'Driver version', currentTarget.driver_version, previousTarget.driver_version ]
	].forEach( ( entry ) => {
		if ( entry[ 1 ] !== entry[ 2 ] ) {
			changes.push({ current: entry[ 1 ], label: entry[ 0 ], previous: entry[ 2 ] });
		}
	});
	return changes;
}

function compareRuns( currentRecord, previousRecord, currentProjection, previousProjection ) {
	const testComparison = compareTests( currentProjection.tests, previousProjection.tests );
	return {
		environmentChanges: environmentChanges( currentRecord, previousRecord ),
		headlineTransition: testComparison.transitions[ 0 ] || null,
		summaryDeltas: compareSummaries( currentRecord.summary, previousRecord.summary ),
		tests: testComparison
	};
}

module.exports = {
	compareRuns,
	compareSummaries,
	compareTests,
	duplicateIds,
	environmentChanges
};
