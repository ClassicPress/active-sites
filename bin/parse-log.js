#!/usr/bin/env node

const crypto      = require( 'crypto' );
const fs          = require( 'fs' );
const path        = require( 'path' );
const querystring = require( 'querystring' );
const util        = require( 'util' );

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

const sites = {};
const ips = {};
const ipsNoID = {};
let lastTime = null;
let records = 0;
let apiRecords = 0;
let failedRecords = 0;

function reportProgress( record ) {
	if ( lastTime ) {
		if (
			record &&
			Date.parse( lastTime ) - 60000 > Date.parse( record.time )
		) {
			throw new Error( util.format(
				'Log entries are not sorted in ascending order! (%s, %s)',
				lastTime, record.time
			) );
		}
		if (
			! record ||
			lastTime.substring( 0, 10 ) !== record.time.substring( 0, 10 )
		) {
			console.log(
				'%s: %d records; %d API records; %d failed parsing',
				lastTime.substring( 0, 10 ),
				records,
				apiRecords,
				failedRecords,
			);
			const numSites     = Object.keys( sites ).length;
			const numIps       = Object.keys( ips ).length;
			const numIpsNoID   = Object.keys( ipsNoID ).length;
			const numSitesNoID = Math.round( numSites / numIps * numIpsNoID );
			console.log(
				'%s: %d sites (%d with ID, %d without); %d IPs (%d with ID, %d without)',
				lastTime.substring( 0, 10 ),
				numSites + numSitesNoID,
				numSites,
				numSitesNoID,
				numIps + numIpsNoID,
				numIps,
				numIpsNoID,
			);
		}
	}
}

fs.createReadStream( logFilename )
	.pipe( split2() )
	.on( 'data', line => {
		records++;
		const record = JSON.parse( line );

		const match = record.url.match( /\/upgrade\/[^\/]+\.json\?(.*$)/ );
		if ( match ) {
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
				sites[ siteID ] = ( sites[ siteID ] || 0 ) + 1;
				ips[ ip ] = ( ips[ ip ] || 0 ) + 1;
			} else {
				ipsNoID[ ip ] = ( ipsNoID[ ip ] || 0 ) + 1;
			}
		}

		reportProgress( record );
		lastTime = record.time;
	} )
	.on( 'end', () => {
		reportProgress();
	} );
