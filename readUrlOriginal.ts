const ndef = require( 'ndef' );

async function selectApplication( reader: any ) {

		console.log( '\n' );
		console.log( '--SELECT APPLICATION--' );
		const apdu = Buffer.from( '00A4040C07D276000085010100', 'hex' );
		console.log( 'Sending:', apdu.toString( 'hex' ).toUpperCase() );
		let response = await reader.transmit( apdu, 2 );
		console.log( 'Received:', response.toString( 'hex' ).toUpperCase() );

    if ( response.toString( 'hex' ) === '9000' ) {

      return true;

    } else {

      console.log(  `Failed to select tag application. Received ${response.toString(`hex`).toUpperCase()} from tag.` );
			throw new Error( `Failed to select tag application. Received ${response.toString(`hex`).toUpperCase()} from tag.`)

    }

	}

async function selectFile( reader :any, fileType? : 'cc' | 'ndef' | 'raw' ) {

		console.log( '\n' );
		console.log( '--SELECT FILE--' );
		const cmdHeader = Buffer.from( '00A4000C02', 'hex' );
		let cmdData : Buffer;
		switch ( fileType ) {

			case 'ndef':
				cmdData = Buffer.from( 'E104', 'hex' );
				break;

			case 'cc':
				cmdData = Buffer.from( 'E103', 'hex' );
				break;

			case 'raw':
				cmdData = Buffer.from( 'E105', 'hex' );
				break;

			default:
				cmdData = Buffer.from( 'E104', 'hex' );
				break;

		}

		const Lc = Buffer.from( '00', 'hex' );

		const apdu = Buffer.concat( [
			cmdHeader,
			cmdData,
			Lc
		] );
		console.log( 'Sending:', apdu.toString( 'hex' ).toUpperCase() );
		const res : Buffer = await reader.transmit( apdu, 2 );
		console.log( 'Received:', res.toString( 'hex' ).toUpperCase() );

	}

	async function attemptRead( reader: any ) {

		await selectApplication( reader );
		await selectFile( reader ,'ndef' );
		const apdu = Buffer.from( '00B0000000', 'hex' );

		console.log( 'Sending:', apdu.toString( 'hex' ).toUpperCase() );
		const response : Buffer = await reader.transmit( apdu, 300 );
		console.log( 'Received', response.toString( 'hex' ).toUpperCase() );

		if ( response.slice( - 2 ).toString( 'hex' ) === '9000' ) {

			let msg = ndef.decodeMessage( response );
			console.log( 'NDEF:', msg );
			const Len = response.slice( 0, 2 );
			//const Header = response.slice(2, 7);
			return response.slice( 7, parseInt( Len.toString( 'hex' ), 16 ) + 2 ).toString( 'ascii' );

		} else {

      console.log(`Failed to execute ISOReadBinary function. Received ${ response.toString( 'hex' ).toUpperCase() } from tag.`);
			throw new Error( `Failed to execute ISOReadBinary function. Received ${ response.toString( 'hex' ).toUpperCase() } from tag.` );

		}

	}


	async function read( reader : any ) : Promise<string> {

		let data;

		for ( let i = 0; i < 5; i ++ ) {

			try {

				data = await attemptRead( reader );
				i = 5;

			} catch ( err ) {

				if ( i === 4 ) {

					throw err;

				} else {

					console.log( `Failed to read tag data, starting attempt number ${i}` );

				}

			}

		}

		// @ts-ignore
		return data;

	}