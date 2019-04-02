#!/usr/bin/env node

const crypto      = require( 'crypto' );
const fs          = require( 'fs' );
const path        = require( 'path' );
const querystring = require( 'querystring' );
const util        = require( 'util' );

const moment = require( 'moment' );
const split2 = require( 'split2' );

const logFilename = process.argv[ 2 ];

// https://github.com/nodejs/node/issues/17871 :(
process.on( 'unhandledRejection', err => {
    console.error( 'Unhandled promise rejection:', err );
    process.exit( 1 );
} );

if ( ! fs.existsSync( logFilename ) ) {
	throw new Error( util.format(
		'Invalid log filename: %s',
		logFilename
	) );
}

// Count a site as active for this many days before and after an update check.
// Without this, we will miss active sites that don't get much traffic.
const daysValidityBefore = 6;
const daysValidityAfter  = 6;

const sites = {};
const ips = {};
const ipsNoID = {};
let lastTime = null;
let records = 0;
let apiRecords = 0;
let failedRecords = 0;
let minDate = null;

function reportProgress( record ) {
	if ( ! lastTime ) {
		return;
	}
	if (
		record &&
		lastTime.substring( 0, 10 ) === record.time.substring( 0, 10 )
	) {
		return;
	}

	const maxDate = moment( record ? record.time : lastTime )
		.subtract( daysValidityBefore + 1, 'days' )
		.format( 'YYYY-MM-DD' );

	let n = 0;
	console.log( '---' );
	Object.keys( sites ).forEach( date => {
		if ( date < minDate || date > maxDate ) {
			return;
		}
		n++;
		const numSites     = Object.keys( sites[ date ] ).length;
		const numIps       = Object.keys( ips[ date ] ).length;
		const numIpsNoID   = Object.keys( ipsNoID[ date ] ).length;
		const numSitesNoID = Math.round( numSites / numIps * numIpsNoID );
		console.log(
			'%s: ~%d sites (%d with ID, ~%d without); %d IPs (%d with ID, %d without)',
			date,
			numSites + numSitesNoID,
			numSites,
			numSitesNoID,
			numIps + numIpsNoID,
			numIps,
			numIpsNoID,
		);
	} );
	for ( ; n <= 24; n++ ) {
		console.log();
	}
}

fs.createReadStream( logFilename )
	.pipe( split2() )
	.on( 'data', line => {
		records++;
		const record = JSON.parse( line );

		const match = record.url.match( /\/upgrade\/[^\/]+\.json\?(.*$)/ );
		if ( match ) {
			const date = record.time.substring( 0, 10 );
			if ( ! minDate ) {
				minDate = date;
			}
			const qs = querystring.parse( match[ 1 ] );
			const cpVersionBase = qs.version.replace( /\+.*$/, '' );
			let siteID = null;
			if ( /^1\.0\.0-(alpha|beta)/.test( cpVersionBase ) ) {
				// These ClassicPress versions sent us the site URL directly.
				siteID = record.user_agent
					.replace( /^.*; https?:/, '' )
					.replace( /\/+$/, '' )
					.toLowerCase();
				siteID = crypto.createHash( 'sha1' )
					.update( siteID )
					.digest( 'hex' );
			} else if ( /^1\.0\.0-rc[12]$/.test( cpVersionBase ) ) {
				// These ClassicPress versions did not send a site identifier.
			} else {
				// Other ClassicPress versions send an anonymous site identifier.
				try {
					siteID = new URL(
						record.user_agent.replace( /^.*; (https?:)/, '$1' )
					).searchParams.get( 'site' );
				} catch ( err ) {
					siteID = null;
					failedRecords++;
				}
			}
			apiRecords++;
			const ip = record.remote_host;
			if ( siteID ) {
				siteID += '|' + ip;
			}
			for ( let i = -daysValidityBefore; i <= daysValidityAfter; i++ ) {
				const d = moment( record.time )
					.add( i, 'days' )
					.format( 'YYYY-MM-DD' );
				sites[ d ]   = sites[ d ]   || {};
				ips[ d ]     = ips[ d ]     || {};
				ipsNoID[ d ] = ipsNoID[ d ] || {};
				if ( siteID ) {
					sites[ d ][ siteID ] = true;
					ips[ d ][ ip ] = true;
				} else {
					ipsNoID[ d ][ ip ] = true;
				}
			}
		}

		if ( Date.parse( lastTime ) - 60000 > Date.parse( record.time ) ) {
			throw new Error( util.format(
				'Log entries are not sorted in ascending order! (%s, %s)',
				lastTime, record.time
			) );
		}
		reportProgress( record );
		lastTime = record.time;
	} )
	.on( 'end', () => {
		reportProgress();
	} );
