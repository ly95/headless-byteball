/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createDivisibleAssetPayment(){
	var network = require('byteballcore/network.js');
	var divisibleAsset = require('byteballcore/divisible_asset.js');
	var walletGeneral = require('byteballcore/wallet_general.js');
	
	divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint({
		asset: 'arePGuKJRNEa3vJ2S1CsKHIRrOaYzN+VXsZZ822kmug=', 
		paying_addresses: ["46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW"],
		fee_paying_addresses: ["46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW"],
		change_address: "46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW",
		to_address: "GIBIFBPG42MJHN4KGY7RV4UTHTHKVRJE",
		amount: 5000, 
		signer: headlessWallet.signer, 
		callbacks: {
			ifError: onError,
			ifNotEnoughFunds: onError,
			ifOk: function(objJoint, arrChains){
				network.broadcastJoint(objJoint);
				if (arrChains){ // if the asset is private
					// send directly to the receiver
					network.sendPrivatePayment('ws://127.0.0.1:6611', arrChains);
					
					// or send to the receiver's device address through the receiver's hub
					//walletGeneral.sendPrivatePayments("0F7Z7DDVBDPTYJOY7S4P24CW6K23F6B7S", arrChains);
				}
			}
		}
	});
}

eventBus.on('headless_wallet_ready', createDivisibleAssetPayment);
