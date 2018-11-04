/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('byteballcore/event_bus.js');

function onError(err){
	throw Error(err);
}

function createIndivisibleAssetPayment(){
	var network = require('byteballcore/network.js');
	var indivisibleAsset = require('byteballcore/indivisible_asset.js');
	var walletGeneral = require('byteballcore/wallet_general.js');
	
	indivisibleAsset.composeAndSaveIndivisibleAssetPaymentJoint({
		asset: 'arePGuKJRNEa3vJ2S1CsKHIRrOaYzN+VXsZZ822kmug=', 
		paying_addresses: ["46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW"],
		fee_paying_addresses: ["46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW"],
		change_address: "46YNPZ6SXAEUMOSBA5JYH5KE7TL3DSEW",
		to_address: "ORKPD5QZFX4JDGYBQ7FV535LCRDOJQHK",
		amount: 100, 
		tolerance_plus: 0, 
		tolerance_minus: 0, 
		signer: headlessWallet.signer, 
		callbacks: {
			ifError: onError,
			ifNotEnoughFunds: onError,
			ifOk: function(objJoint, arrRecipientChains, arrCosignerChains){
				network.broadcastJoint(objJoint);
				if (arrRecipientChains){ // if the asset is private
					// send directly to the receiver
					network.sendPrivatePayment('ws://127.0.0.1:6611', arrRecipientChains);
					
					// or send to the receiver's device address through the receiver's hub
					// walletGeneral.sendPrivatePayments("0DTZZY6J27KSEVEXL4BIGTZXAELJ47OYW", arrRecipientChains);
				}
			}
		}
	});
}

eventBus.on('headless_wallet_ready', createIndivisibleAssetPayment);
