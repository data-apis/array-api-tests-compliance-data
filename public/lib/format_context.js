/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
*/

'use strict';

const NUMBER_FORMATTER = new Intl.NumberFormat( 'en-US' );
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat( 'en-US', {
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC'
} );
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat( 'en-US', {
	day: 'numeric',
	month: 'long',
	timeZone: 'UTC',
	year: 'numeric'
} );
const COMPACT_DATE_FORMATTER = new Intl.DateTimeFormat( 'en-US', {
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC',
	year: 'numeric'
} );
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat( 'en-US', {
	day: 'numeric',
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	month: 'long',
	second: '2-digit',
	timeZone: 'UTC',
	timeZoneName: 'short',
	year: 'numeric'
} );

function compact( values ) {
	return values.filter( ( value ) => value !== undefined && value !== null && value !== '' );
}

function titleCase( value ) {
	return String( value )
		.replace( /[_-]+/g, ' ' )
		.replace( /\b\w/g, ( character ) => character.toUpperCase() );
}

function formatExecutionTarget( target ) {
	const value = target || {};
	const kind = value.kind ? String( value.kind ).toUpperCase() : 'Unknown target';
	const primary = compact([
		kind,
		value.backend ? String( value.backend ).toUpperCase() : '',
		value.device_model
	]);
	const details = compact([
		value.runtime_version ? 'Runtime '+value.runtime_version : '',
		value.driver_version ? 'Driver '+value.driver_version : ''
	]);
	return {
		full: primary.concat( details ).join( ' · ' ),
		kind: kind,
		short: primary.join( ' · ' )
	};
}

function formatDate( timestamp, style ) {
	const date = new Date( timestamp );
	if ( Number.isNaN( date.getTime() ) ) {
		throw new Error( 'Invalid dashboard timestamp: '+timestamp );
	}
	if ( style === 'short' ) {
		return SHORT_DATE_FORMATTER.format( date );
	}
	if ( style === 'compact' ) {
		return COMPACT_DATE_FORMATTER.format( date );
	}
	if ( style === 'datetime' ) {
		return DATE_TIME_FORMATTER.format( date );
	}
	return LONG_DATE_FORMATTER.format( date );
}

function formatCount( value ) {
	return NUMBER_FORMATTER.format( value );
}

function formatOutcomeName( name ) {
	return titleCase( name );
}

function formatContextLabel( record, sourceName ) {
	const series = record.series;
	const platform = series.platform || {};
	return compact([
		'Array API '+series.api_version,
		'Python '+series.python,
		compact([ platform.system, platform.machine ]).join( ' ' ),
		formatExecutionTarget( series.execution_target ).full,
		'Source '+( sourceName || record.source_id )
	]).join( ' · ' );
}

function formatRunEnvironment( record ) {
	return compact([
		'Python '+record.python,
		compact([ record.platform.system, record.platform.release, record.platform.machine ]).join( ' ' ),
		'Platform '+record.platform.description,
		formatExecutionTarget( record.execution_target ).full
	]).join( ' · ' );
}

module.exports = {
	formatContextLabel,
	formatCount,
	formatDate,
	formatExecutionTarget,
	formatOutcomeName,
	formatRunEnvironment
};
