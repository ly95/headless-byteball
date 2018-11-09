/*jslint node: true */

/*
	Accept commands via JSON-RPC API.
	The daemon listens on port 6332 by default.
	See https://github.com/byteball/headless-byteball/wiki/Running-RPC-service for detailed description of the API
*/

"use strict";
var headlessWallet = require('../start.js');
var conf = require('byteballcore/conf.js');
var eventBus = require('byteballcore/event_bus.js');
var db = require('byteballcore/db.js');
var mutex = require('byteballcore/mutex.js');
var storage = require('byteballcore/storage.js');
var constants = require('byteballcore/constants.js');
var validationUtils = require("byteballcore/validation_utils.js");
let crypto = require('crypto');
let Mnemonic = require('bitcore-mnemonic');
let Bitcore = require('bitcore-lib');
let objectHash = require('byteballcore/object_hash');
let ecdsa = require('secp256k1');
var ecdsaSig = require('byteballcore/signature.js');
var wallet_id;

if (conf.bSingleAddress)
	throw Error('can`t run in single address mode');

function initRPC() {
	var composer = require('byteballcore/composer.js');
	var network = require('byteballcore/network.js');

	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('byteballcore/wallet_defined_by_keys.js');
	var Wallet = require('byteballcore/wallet.js');
	var balances = require('byteballcore/balances.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default 
		'headers': { // allow custom headers is empty by default 
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Returns information about the current state.
	 * @return { last_mci: {Integer}, last_stable_mci: {Integer}, count_unhandled: {Integer} }
	 */
	server.expose('getinfo', function (args, opt, cb) {
		var response = {};
		storage.readLastMainChainIndex(function (last_mci) {
			response.last_mci = last_mci;
			storage.readLastStableMcIndex(db, function (last_stable_mci) {
				response.last_stable_mci = last_stable_mci;
				db.query("SELECT COUNT(*) AS count_unhandled FROM unhandled_joints", function (rows) {
					response.count_unhandled = rows[0].count_unhandled;
					cb(null, response);
				});
			});
		});
	});

	/**
	 * Validates address.
	 * @return {boolean} is_valid
	 */
	server.expose('validateaddress', function (args, opt, cb) {
		var address = args[0];
		cb(null, validationUtils.isValidAddress(address));
	});

	// alias for validateaddress
	server.expose('verifyaddress', function (args, opt, cb) {
		var address = args[0];
		cb(null, validationUtils.isValidAddress(address));
	});

	/**
	 * Creates and returns new wallet address.
	 * @return {String} address
	 */
	server.expose('getnewaddress', function (args, opt, cb) {
		mutex.lock(['rpc_getnewaddress'], function (unlock) {
			walletDefinedByKeys.issueNextAddress(wallet_id, 0, function (addressInfo) {
				unlock();
				cb(null, addressInfo.address);
			});
		});
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {String} address
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 * 
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getbalance', function (args, opt, cb) {
		let start_time = Date.now();
		var address = args[0];
		if (address) {
			if (validationUtils.isValidAddress(address)) {
				db.query(
				"SELECT asset, is_stable, SUM(amount) AS balance \n\
					FROM outputs CROSS JOIN units USING(unit) \n\
					WHERE is_spent=0 AND address=? AND sequence='good' \n\
					GROUP BY asset, is_stable", [address],
					function (rows) {
						var assocBalances = {base: {stable: 0, pending: 0}};
						for (var i=0; i<rows.length; i++){
							var row = rows[i];
							var asset = row.asset || "base";
							if (!assocBalances[asset])
								assocBalances[asset] = {stable: 0, pending: 0};
							assocBalances[asset][row.is_stable ? 'stable' : 'pending'] = row.balance;
						}
						cb(null, assocBalances);
					}
				);
			} else {
				cb("invalid address");
			}
		}
		else
			Wallet.readBalance(wallet_id, function (balances) {
				console.log('getbalance took ' + (Date.now() - start_time) + 'ms');
				cb(null, balances);
			});
	});

	/**
	 * Returns wallet balance(stable and pending) without commissions earned from headers and witnessing.
	 * 
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getmainbalance', function (args, opt, cb) {
		let start_time = Date.now();
		balances.readOutputsBalance(wallet_id, function (balances) {
			console.log('getmainbalance took ' + (Date.now() - start_time) + 'ms');
			cb(null, balances);
		});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address or {since_mci: {Integer}, unit: {String}} 
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 * 
	 * If no address supplied, returns wallet transaction list.
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 */
	server.expose('listtransactions', function (args, opt, cb) {
		let start_time = Date.now();
		if (Array.isArray(args) && typeof args[0] === 'string') {
			var address = args[0];
			if (validationUtils.isValidAddress(address))
				Wallet.readTransactionHistory({ address: address }, function (result) {
					cb(null, result);
				});
			else
				cb("invalid address");
		}
		else {
			var opts = { wallet: wallet_id };
			if (args.unit && validationUtils.isValidBase64(args.unit, constants.HASH_LENGTH))
				opts.unit = args.unit;
			if (args.since_mci && validationUtils.isNonnegativeInteger(args.since_mci))
				opts.since_mci = args.since_mci;
			else
				opts.limit = 200;
			if (args.asset) {
				if (!validationUtils.isValidBase64(args.asset, constants.HASH_LENGTH))
					return cb("bad asset: " + args.asset);
				opts.asset = args.asset;
			}
			Wallet.readTransactionHistory(opts, function (result) {
				console.log('listtransactions ' + JSON.stringify(args) + ' took ' + (Date.now() - start_time) + 'ms');
				cb(null, result);
			});
		}

	});

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @param {Integer} amount
	 * @return {String} status
	 */
	server.expose('sendtoaddress', function (args, opt, cb) {
		console.log('sendtoaddress ' + JSON.stringify(args));
		let start_time = Date.now();
		var amount = args[1];
		var toAddress = args[0];
		var asset = args[2];
		if (asset && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
			return cb("bad asset: " + asset);
		if (amount && toAddress) {
			if (validationUtils.isValidAddress(toAddress))
				headlessWallet.issueChangeAddressAndSendPayment(asset, amount, toAddress, null, function (err, unit) {
					console.log('sendtoaddress ' + JSON.stringify(args) + ' took ' + (Date.now() - start_time) + 'ms, unit=' + unit + ', err=' + err);
					cb(err, err ? undefined : unit);
				});
			else
				cb("invalid address");
		}
		else
			cb("wrong parameters");
	});

	/**
	 * Send funds to address.
	 */
	server.expose('sendpayment', function (args, opt, cb) {
		console.log('sendpayment ' + JSON.stringify(args));

		var walletObj = args[0];
		var toAddress = args[1];
		var amount = args[2];

		if (!validationUtils.isValidAddress(toAddress)) {
			cb("227: invalid address");
		}

		let composer = require('byteballcore/composer.js');
		let network = require('byteballcore/network.js');
		let callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: function (err) {
				cb(err);
			},
			ifError: function (err) {
				cb("241: " + err);
			},
			ifOk: function (objJoint) {
				network.broadcastJoint(objJoint);
				cb(null, objJoint);
			}
		});

		var mnemonic = new Mnemonic(walletObj.mnemonic_phrase);
		var xPrivKey = mnemonic.toHDPrivateKey(walletObj.passphrase);

		var signWithLocalPrivateKey = function (account, is_change, address_index, text_to_sign, handleSig) {
			var path = "m/44'/0'/" + account + "'/" + is_change + "/" + address_index;
			var privateKey = xPrivKey.derive(path).privateKey;
			var privKeyBuf = privateKey.bn.toBuffer({ size: 32 });
			handleSig(ecdsaSig.sign(text_to_sign, privKeyBuf));
		}

		var signer = {
			readSigningPaths: function (conn, address, handleLengthsBySigningPaths) {
				handleLengthsBySigningPaths({ r: constants.SIG_LENGTH });
			},
			readDefinition: function (conn, address, handleDefinition) {
				if (!walletObj.definition) {
					throw Error("definition not found");
				}
				handleDefinition(null, walletObj.definition);
			},
			sign: function (objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature) {
				var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
				signWithLocalPrivateKey(0, walletObj.is_change, walletObj.address_index, buf_to_sign, function (sig) {
					handleSignature(null, sig);
				});
			}
		};

		let arrOutputs = [
			{ address: walletObj.address, amount: 0 },
			{ address: toAddress, amount: amount }
		];
		// composePaymentJoint
		// allow spend unconfirmed asset
		composer.composeSpendUnconfirmedPaymentJoint([walletObj.address], arrOutputs, signer, callbacks);
	});

	/**
	 * create config object for wallet
	 * @return {Object} wallet
	 */
	server.expose('createwallet', function (args, opt, cb) {
		console.log('createwallet ' + JSON.stringify(args));

		var derivePubkey = function (xPubKey, path) {
			let hdPubKey = new Bitcore.HDPublicKey(xPubKey);
			return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
		}

		let deviceTempPrivKey = crypto.randomBytes(32);
		let devicePrevTempPrivKey = crypto.randomBytes(32);
		let passphrase = "";
		let mnemonic = new Mnemonic();
		while (!Mnemonic.isValid(mnemonic.toString()))
			mnemonic = new Mnemonic();

		let xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		let strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
		let pubkey = derivePubkey(strXPubKey, "m/" + 0 + "/" + 0);
		let arrDefinition = ['sig', { pubkey: pubkey }];
		let address = objectHash.getChash160(arrDefinition);
		let wallet = crypto.createHash("sha256").update(strXPubKey, "utf8").digest("base64");

		let devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({ size: 32 });
		let devicePubkey = ecdsa.publicKeyCreate(devicePrivKey, true).toString('base64');
		let device_address = objectHash.getDeviceAddress(devicePubkey);

		let obj = {};
		obj['passphrase'] = passphrase;
		obj['mnemonic_phrase'] = mnemonic.phrase;
		obj['temp_priv_key'] = deviceTempPrivKey.toString('base64');
		obj['prev_temp_priv_key'] = devicePrevTempPrivKey.toString('base64');
		obj['device_address'] = device_address;
		obj['address'] = address;
		obj['wallet'] = wallet;
		obj['is_change'] = 0;
		obj['address_index'] = 0;
		obj['definition'] = arrDefinition;

		cb(null, obj);
	});

	/**
	 * create an asset
	 */
	server.expose('createasset', function (args, opt, cb) {
		console.log('createasset ' + JSON.stringify(args));

		var composer = require('byteballcore/composer.js');
		var network = require('byteballcore/network.js');
		var callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: function (err) {
				cb(err);
			},
			ifError: function (err) {
				cb("340: " + err);
			},
			ifOk: function (objJoint) {
				network.broadcastJoint(objJoint);
				cb(null, objJoint);
			}
		});

		var asset = args[1];
		var walletObj = args[0];

		var mnemonic = new Mnemonic(walletObj.mnemonic_phrase);
		var xPrivKey = mnemonic.toHDPrivateKey(walletObj.passphrase);

		var signWithLocalPrivateKey = function (account, is_change, address_index, text_to_sign, handleSig) {
			var path = "m/44'/0'/" + account + "'/" + is_change + "/" + address_index;
			var privateKey = xPrivKey.derive(path).privateKey;
			var privKeyBuf = privateKey.bn.toBuffer({ size: 32 });
			handleSig(ecdsaSig.sign(text_to_sign, privKeyBuf));
		}

		var signer = {
			readSigningPaths: function (conn, address, handleLengthsBySigningPaths) {
				handleLengthsBySigningPaths({ r: constants.SIG_LENGTH });
			},
			readDefinition: function (conn, address, handleDefinition) {
				if (!walletObj.definition) {
					throw Error("definition not found");
				}
				handleDefinition(null, walletObj.definition);
			},
			sign: function (objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature) {
				var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
				signWithLocalPrivateKey(0, walletObj.is_change, walletObj.address_index, buf_to_sign, function (sig) {
					handleSignature(null, sig);
				});
			}
		};

		composer.composeAssetDefinitionJoint(walletObj.address, asset, signer, callbacks);
	});

	server.expose('sendassetpayment', function (args, opt, cb) {
		console.log('sendassetpayment ' + JSON.stringify(args));

		var walletObj = args[0];
		var asset = args[1];
		var toAddress = args[2];
		var amount = args[3];

		if (!validationUtils.isValidBase64(asset, constants.HASH_LENGTH)) {
			return cb("bad asset: " + asset);
		}

		if (!validationUtils.isValidAddress(toAddress)) {
			cb("invalid address");
		}

		if (!amount) {
			cb("invalid amount");
		}

		var network = require('byteballcore/network.js');
		var divisibleAsset = require('byteballcore/divisible_asset.js');

		var mnemonic = new Mnemonic(walletObj.mnemonic_phrase);
		var xPrivKey = mnemonic.toHDPrivateKey(walletObj.passphrase);

		var signWithLocalPrivateKey = function (account, is_change, address_index, text_to_sign, handleSig) {
			var path = "m/44'/0'/" + account + "'/" + is_change + "/" + address_index;
			var privateKey = xPrivKey.derive(path).privateKey;
			var privKeyBuf = privateKey.bn.toBuffer({ size: 32 });
			handleSig(ecdsaSig.sign(text_to_sign, privKeyBuf));
		}

		var signer = {
			readSigningPaths: function (conn, address, handleLengthsBySigningPaths) {
				handleLengthsBySigningPaths({ r: constants.SIG_LENGTH });
			},
			readDefinition: function (conn, address, handleDefinition) {
				if (!walletObj.definition) {
					throw Error("definition not found");
				}
				handleDefinition(null, walletObj.definition);
			},
			sign: function (objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature) {
				var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
				signWithLocalPrivateKey(0, walletObj.is_change, walletObj.address_index, buf_to_sign, function (sig) {
					handleSignature(null, sig);
				});
			}
		};

		divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint({
			spend_unconfirmed: "all",
			asset: asset,
			paying_addresses: [walletObj.address],
			fee_paying_addresses: [walletObj.address],
			change_address: walletObj.address,
			to_address: toAddress,
			amount: amount,
			signer: signer,
			callbacks: {
				ifNotEnoughFunds: function (err) {
					cb(err);
				},
				ifError: function (err) {
					cb("440: " + err);
				},
				ifOk: function (objJoint, arrChains) {
					network.broadcastJoint(objJoint);
					cb(null, objJoint);
				}
			}
		});
	});

	headlessWallet.readSingleWallet(function (_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only 
		var httpServer = server.listen(conf.rpcPort, conf.rpcInterface);
		httpServer.timeout = 900 * 1000;
	});
}

eventBus.on('headless_wallet_ready', initRPC);
