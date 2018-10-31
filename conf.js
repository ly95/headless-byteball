/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.GENESIS_UNIT = '5dz2NhZ3cAPhqtqJ3vvjC9iVJmNOmLITwGUcWsBHBMI=';
exports.BLACKBYTES_ASSET = 'ZWPYh1NOFE9J7qofOdIo3/2i3xOIDt5xqtEVTSwr/V4=';

exports.storage = 'sqlite';

exports.WS_PROTOCOL = 'ws://';
exports.hub = '127.0.0.1:6611';
exports.deviceName = 'Headless';
exports.permanent_pairing_secret = 'randomstring';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.KEYS_FILENAME = 'keys.json';

// where logs are written to (absolute path).  Default is log.txt in app data directory
//exports.LOG_FILENAME = '/dev/null';

// consolidate unspent outputs when there are too many of them.  Value of 0 means do not try to consolidate
exports.MAX_UNSPENT_OUTPUTS = 0;
exports.CONSOLIDATION_INTERVAL = 3600*1000;

// this is for runnining RPC service only, see play/rpc_service.js
exports.rpcInterface = '0.0.0.0';
exports.rpcPort = '6332';

console.log('finished headless conf');
