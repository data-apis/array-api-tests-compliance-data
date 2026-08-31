/**
* @license MIT
* Copyright (c) 2026 Python Data APIs Consortium.
*/

'use strict';

const { loadDashboardData } = require( '../../lib/load_dashboard_data.js' );

module.exports = async function dashboardData() {
	const model = await loadDashboardData({ root: process.env.DASHBOARD_DATA_ROOT });
	console.log( '[dashboard] loaded '+model.buildStats.reportsLoaded+' report envelopes ('+model.buildStats.expandedBytes+' expanded bytes)' );
	return model;
};
