// ==UserScript==
// @name         Steam Economy Enhancer (jafin)
// @namespace    https://github.com/jafin
// @version      7.3.2
// @author       Jason Finch
// @description  Enhances the Steam Inventory and Steam Market.
// @license      MIT
// @icon         data:image/svg+xml,%0A%3Csvg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" fill-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2" clip-rule="evenodd" viewBox="0 0 267 267"%3E%3Ccircle cx="133.3" cy="133.3" r="133.3" fill="%2326566c"/%3E%3Cpath fill="%23ebebeb" fill-rule="nonzero" d="m50 133 83-83 84 83-84 84-83-84Zm83 62 62-61-62-62v123Z"/%3E%3C/svg%3E
// @homepage     https://github.com/jafin/Steam-Economy-Enhancer
// @homepageURL  https://github.com/jafin/Steam-Economy-Enhancer
// @supportURL   https://github.com/jafin/Steam-Economy-Enhancer/issues
// @downloadURL  https://raw.githubusercontent.com/jafin/Steam-Economy-Enhancer/master/dist/code.user.js
// @updateURL    https://raw.githubusercontent.com/jafin/Steam-Economy-Enhancer/master/dist/code.user.js
// @match        https://steamcommunity.com/id/*/inventory*
// @match        https://steamcommunity.com/profiles/*/inventory*
// @match        https://steamcommunity.com/market*
// @match        https://steamcommunity.com/tradeoffer*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/4.0.0/jquery.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/async/3.2.6/async.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/luxon/3.5.0/luxon.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/list.js/2.3.1/list.js
// @grant        unsafeWindow
// ==/UserScript==

(function(jquery, localforage, async, luxon, list_js) {
	"use strict";
	var __create = Object.create;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getProtoOf = Object.getPrototypeOf;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __copyProps = (to, from, except, desc) => {
		if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
				get: ((k) => from[k]).bind(null, key),
				enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
			});
		}
		return to;
	};
	var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
		value: mod,
		enumerable: true
	}) : target, mod));
	jquery = __toESM(jquery);
	localforage = __toESM(localforage);
	async = __toESM(async);
	luxon = __toESM(luxon);
	list_js = __toESM(list_js);
	var COLOR_ERROR = "#8A4243";
	var COLOR_SUCCESS = "#407736";
	var COLOR_PENDING = "#908F44";
	var COLOR_PRICE_FAIR = "#496424";
	var COLOR_PRICE_CHEAP = "#837433";
	var COLOR_PRICE_EXPENSIVE = "#813030";
	var COLOR_PRICE_NOT_CHECKED = "#26566c";
	var VERDICT_OVERPRICED = "overpriced";
	var VERDICT_UNDERPRICED = "underpriced";
	var VERDICT_FAIR = "fair";
	var VERDICT_COLORS = {
		[VERDICT_OVERPRICED]: COLOR_PRICE_EXPENSIVE,
		[VERDICT_UNDERPRICED]: COLOR_PRICE_CHEAP,
		[VERDICT_FAIR]: COLOR_PRICE_FAIR
	};
	var VERDICT_MESSAGES = {
		[VERDICT_OVERPRICED]: "Sell price is too high.",
		[VERDICT_UNDERPRICED]: "Sell price is too low.",
		[VERDICT_FAIR]: "Sell price is fair."
	};
	var ROW_STATUS_COLORS = {
		notChecked: COLOR_PRICE_NOT_CHECKED,
		pending: COLOR_PENDING,
		success: COLOR_SUCCESS,
		error: COLOR_ERROR
	};
	var RETRY_DELAY_SHORT_MIN = 1e3;
	var RETRY_DELAY_SHORT_MAX = 1500;
	var RETRY_DELAY_LONG_MIN = 3e4;
	var RETRY_DELAY_LONG_MAX = 45e3;
	function createListingState() {
		const states = new Map();
		return {
			get(id) {
				return states.get(String(id));
			},
			set(id, state) {
				const key = String(id);
				states.set(key, Object.assign({}, states.get(key), state));
			}
		};
	}
	function getListingVerdict(bestPrice, listedPrice) {
		if (bestPrice < listedPrice) return VERDICT_OVERPRICED;
		if (bestPrice > listedPrice) return VERDICT_UNDERPRICED;
		return VERDICT_FAIR;
	}
	function getListingPriceDelta(bestPrice, listedPrice) {
		return listedPrice - bestPrice;
	}
	var listingState = createListingState();
	var itemQueueState = createListingState();
	function getAssetKey(item) {
		return `${item.appid}_${item.contextid}_${item.id}`;
	}
	function isItemQueued(item) {
		return itemQueueState.get(getAssetKey(item))?.queued === true;
	}
	function markItemQueued(item) {
		itemQueueState.set(getAssetKey(item), { queued: true });
	}
	function flattenItem(value, id) {
		const item = Object.assign({}, value, value.description);
		item.id = id;
		item.assetid = id;
		return item;
	}
	function readInventoryItems(activeInventory, childrenProperty, assetsProperty) {
		const items = [];
		if (!activeInventory) return items;
		const collect = (assets) => {
			for (const key in assets) {
				const value = assets[key];
				if (typeof value === "object") items.push(flattenItem(value, key));
			}
		};
		for (const child in activeInventory[childrenProperty]) collect(activeInventory[childrenProperty][child][assetsProperty]);
		collect(activeInventory[assetsProperty]);
		return items;
	}
	function getMarketHashName(item) {
		if (item == null) return null;
		if (item.description != null && item.description.market_hash_name != null) return item.description.market_hash_name;
		if (item.description != null && item.description.name != null) return item.description.name;
		if (item.market_hash_name != null) return item.market_hash_name;
		if (item.name != null) return item.name;
		return null;
	}
	function getIsCrate(item) {
		if (item == null) return false;
		const tags = item.tags != null ? item.tags : item.description != null && item.description.tags != null ? item.description.tags : null;
		if (tags != null) {
			let isTaggedAsCrate = false;
			tags.forEach((arrayItem) => {
				if (arrayItem.category == "Type") {
					if (arrayItem.internal_name == "Supply Crate") isTaggedAsCrate = true;
				}
			});
			if (isTaggedAsCrate) return true;
		}
		return false;
	}
	function getIsTradingCard(item) {
		if (item == null) return false;
		const tags = item.tags != null ? item.tags : item.description != null && item.description.tags != null ? item.description.tags : null;
		if (tags != null) {
			let isTaggedAsTradingCard = false;
			tags.forEach((arrayItem) => {
				if (arrayItem.category == "item_class") {
					if (arrayItem.internal_name == "item_class_2") isTaggedAsTradingCard = true;
				}
			});
			if (isTaggedAsTradingCard) return true;
		}
		if (item.owner_actions != null) for (let i = 0; i < item.owner_actions.length; i++) {
			if (item.owner_actions[i].link == null) continue;
			if (item.owner_actions[i].link.toString().toLowerCase().includes("gamecards")) return true;
		}
		if (item.type != null && item.type.toLowerCase().includes("trading card")) return true;
		return false;
	}
	function getIsFoilTradingCard(item) {
		if (!getIsTradingCard(item)) return false;
		const tags = item.tags != null ? item.tags : item.description != null && item.description.tags != null ? item.description.tags : null;
		if (tags != null) {
			let isTaggedAsFoilTradingCard = false;
			tags.forEach((arrayItem) => {
				if (arrayItem.category == "cardborder" && arrayItem.internal_name == "cardborder_1") isTaggedAsFoilTradingCard = true;
			});
			if (isTaggedAsFoilTradingCard) return true;
		}
		if (item.owner_actions != null) for (let i = 0; i < item.owner_actions.length; i++) {
			if (item.owner_actions[i].link == null) continue;
			if (item.owner_actions[i].link.toString().toLowerCase().includes("gamecards") && item.owner_actions[i].link.toString().toLowerCase().includes("border")) return true;
		}
		if (item.type != null && item.type.toLowerCase().includes("foil trading card")) return true;
		return false;
	}
	var logger = document.createElement("div");
	logger.setAttribute("id", "logger");
	var userScrolled = false;
	function setUserScrolled(value) {
		userScrolled = value;
	}
	function updateScroll() {
		if (userScrolled) return;
		const element = document.getElementById("logger");
		if (element == null) return;
		element.scrollTop = element.scrollHeight;
	}
	function logDOM(text) {
		logger.innerHTML += `${text}<br/>`;
		updateScroll();
	}
	var REQUEST_DELAY_MARKET = 1e3;
	var REQUEST_DELAY_ERROR = 5e3;
	var REQUEST_BREAKER_STATUSES = [
		400,
		401,
		403,
		404,
		405,
		429
	];
	var REQUEST_BREAKER_WINDOW_MS = 3e5;
	function getRequestStoppedMessage() {
		return `Steam Economy Enhancer stopped sending requests after 5 failed requests within ${REQUEST_BREAKER_WINDOW_MS / 6e4} minutes. Reload the page to start again.`;
	}
	function stopRequests() {
		request.stopped = true;
		request.errors = 0;
		console.error(getRequestStoppedMessage());
		logDOM(getRequestStoppedMessage());
	}
	function getRequestDelay(url, status, statusText) {
		if (status === 0 || status >= 400 || statusText === "error") return REQUEST_DELAY_ERROR;
		if (url.startsWith("https://steamcommunity.com/market/")) return REQUEST_DELAY_MARKET;
		return 300;
	}
	function request(url, options, callback, { transport = jquery.default.ajax } = {}) {
		callback = callback || function() {};
		if (request.stopped) {
			const error = new Error(getRequestStoppedMessage());
			setTimeout(() => request.queue.shift()?.(), 1);
			setTimeout(() => callback(error, null), 0);
			return;
		}
		if (request.pending) {
			const args = Array.prototype.slice.call(arguments);
			request.queue.push(() => request(...args));
			return;
		}
		request.pending = true;
		transport({
			url,
			type: options.method,
			data: options.data,
			dataType: options.responseType,
			success: function(data, _statusText, _xhr) {
				setTimeout(() => callback(null, data), 0);
			},
			error: (xhr, statusText, _httpErrorText) => {
				const error = new Error(`Request failed with status ${xhr.status || 0} (${statusText === "error" ? "http error" : statusText})`);
				error.url = url;
				error.method = options.method;
				error.errorText = statusText || "";
				error.statusCode = xhr.status || 0;
				error.responseText = xhr.responseText || "";
				setTimeout(() => callback(error, null), 0);
			},
			complete: (xhr, statusText) => {
				const delay = getRequestDelay(url, xhr.status, statusText);
				if (REQUEST_BREAKER_STATUSES.includes(xhr.status)) {
					if (request.errors++ === 0) setTimeout(() => request.errors = 0, REQUEST_BREAKER_WINDOW_MS);
					if (request.errors >= 5) stopRequests();
				}
				const next = () => {
					request.pending = false;
					request.queue.shift()?.();
				};
				setTimeout(next, delay);
			}
		});
	}
	function isRetryMessage(message) {
		return [
			"You cannot sell any items until your previous action completes.",
			"There was a problem listing your item. Refresh the page and try again.",
			"We were unable to contact the game's item server. The game's item server may be down or Steam may be experiencing temporary connectivity issues. Your listing has not been created. Refresh the page and try again."
		].indexOf(message) !== -1;
	}
	request.queue = [];
	request.errors = 0;
	request.pending = false;
	request.stopped = false;
	function getLocalStorageItem(name) {
		try {
			return localStorage.getItem(name);
		} catch (e) {
			`${name}${e}`;
			return null;
		}
	}
	function setLocalStorageItem(name, value) {
		try {
			localStorage.setItem(name, value);
			return true;
		} catch (e) {
			`${name}${e}`;
			return false;
		}
	}
	function getSessionStorageItem(name) {
		try {
			return sessionStorage.getItem(name);
		} catch (e) {
			`${name}${e}`;
			return null;
		}
	}
	function setSessionStorageItem(name, value) {
		try {
			sessionStorage.setItem(name, value);
			return true;
		} catch (e) {
			`${name}${e}`;
			return false;
		}
	}
	var SETTING_MIN_NORMAL_PRICE = "SETTING_MIN_NORMAL_PRICE";
	var SETTING_MAX_NORMAL_PRICE = "SETTING_MAX_NORMAL_PRICE";
	var SETTING_MIN_FOIL_PRICE = "SETTING_MIN_FOIL_PRICE";
	var SETTING_MAX_FOIL_PRICE = "SETTING_MAX_FOIL_PRICE";
	var SETTING_MIN_MISC_PRICE = "SETTING_MIN_MISC_PRICE";
	var SETTING_MAX_MISC_PRICE = "SETTING_MAX_MISC_PRICE";
	var SETTING_PRICE_OFFSET = "SETTING_PRICE_OFFSET";
	var SETTING_PRICE_MIN_CHECK_PRICE = "SETTING_PRICE_MIN_CHECK_PRICE";
	var SETTING_PRICE_MIN_LIST_PRICE = "SETTING_PRICE_MIN_LIST_PRICE";
	var SETTING_PRICE_ALGORITHM = "SETTING_PRICE_ALGORITHM";
	var SETTING_PRICE_IGNORE_LOWEST_Q = "SETTING_PRICE_IGNORE_LOWEST_Q";
	var SETTING_PRICE_HISTORY_HOURS = "SETTING_PRICE_HISTORY_HOURS";
	var SETTING_INVENTORY_PRICE_LABELS = "SETTING_INVENTORY_PRICE_LABELS";
	var SETTING_TRADEOFFER_PRICE_LABELS = "SETTING_TRADEOFFER_PRICE_LABELS";
	var SETTING_QUICK_SELL_BUTTONS = "SETTING_QUICK_SELL_BUTTONS";
	var SETTING_LAST_CACHE = "SETTING_LAST_CACHE";
	var SETTING_RELIST_AUTOMATICALLY = "SETTING_RELIST_AUTOMATICALLY";
	var settingDefaults = {
		SETTING_MIN_NORMAL_PRICE: .05,
		SETTING_MAX_NORMAL_PRICE: 2.5,
		SETTING_MIN_FOIL_PRICE: .15,
		SETTING_MAX_FOIL_PRICE: 10,
		SETTING_MIN_MISC_PRICE: .05,
		SETTING_MAX_MISC_PRICE: 10,
		SETTING_PRICE_OFFSET: 0,
		SETTING_PRICE_MIN_CHECK_PRICE: 0,
		SETTING_PRICE_MIN_LIST_PRICE: .03,
		SETTING_PRICE_ALGORITHM: 1,
		SETTING_PRICE_IGNORE_LOWEST_Q: 1,
		SETTING_PRICE_HISTORY_HOURS: 12,
		SETTING_INVENTORY_PRICE_LABELS: 1,
		SETTING_TRADEOFFER_PRICE_LABELS: 1,
		SETTING_QUICK_SELL_BUTTONS: 1,
		SETTING_LAST_CACHE: 0,
		SETTING_RELIST_AUTOMATICALLY: 0
	};
	function getSettingWithDefault(name) {
		return getLocalStorageItem(name) || (name in settingDefaults ? settingDefaults[name] : null);
	}
	function setSetting(name, value) {
		setLocalStorageItem(name, value);
	}
	function pickSellListingsHeader(anchored, all) {
		return anchored.length > 0 ? anchored[0] : all[0];
	}
	function createSteamPage(win) {
		return {
			isLoggedIn: () => typeof win.g_rgWalletInfo !== "undefined" && win.g_rgWalletInfo != null || typeof win.g_bLoggedIn !== "undefined" && win.g_bLoggedIn,
			countryCode: () => typeof win.g_strCountryCode !== "undefined" ? win.g_strCountryCode : void 0,
			walletInfo: () => win.g_rgWalletInfo,
			appContextData: () => win.g_rgAppContextData,
			inventoryLoadUrl: () => win.g_strInventoryLoadURL || void 0,
			profileUrl: () => win.g_strProfileURL || void 0,
			currencyCode: (currencyId) => win.GetCurrencyCode(currencyId),
			formatPrice: (valueInCents, currencyCode, currencyCountry) => win.v_currencyformat(valueInCents, currencyCode, currencyCountry),
			parsePriceText: (text) => win.GetPriceValueAsInt(text),
			showDialog: (title, html) => win.ShowDialog(title, html),
			showConfirmDialog: (title, html) => win.ShowConfirmDialog(title, html),
			activeInventory: () => win.g_ActiveInventory,
			activeUser: () => win.g_ActiveUser,
			steamId: () => win.g_steamID,
			activeSelectView: () => win.iActiveSelectView,
			onInventorySelectItem(handler) {
				if (typeof win.CInventory === "undefined") return () => {};
				const original = win.CInventory.prototype.SelectItem;
				win.CInventory.prototype.SelectItem = function(event, elItem, rgItem) {
					original.apply(this, arguments);
					handler(rgItem);
				};
				return () => {
					win.CInventory.prototype.SelectItem = original;
				};
			},
			assetFor: (appid, contextid, assetid) => win.g_rgAssets?.[appid]?.[contextid]?.[assetid],
			setAsset: (appid, contextid, assetid, asset) => {
				win.g_rgAssets[appid][contextid][assetid] = asset;
			},
			firstAsset: () => {
				for (const appid in win.g_rgAssets) for (const contextid in win.g_rgAssets[appid]) for (const assetid in win.g_rgAssets[appid][contextid]) return win.g_rgAssets[appid][contextid][assetid];
				return null;
			},
			mergeAssets: (assets) => win.MergeWithAssetArray(assets),
			requestFullInventory: (url, callback) => win.RequestFullInventory(url, {}, null, null, callback),
			myListingsTotalCount: () => typeof win.g_oMyListings !== "undefined" && win.g_oMyListings != null ? win.g_oMyListings.m_cTotalCount : null,
			goToHistoryPage: (index) => {
				if (typeof win.g_oMyHistory !== "undefined") win.g_oMyHistory.GoToPage(index);
			},
			sellListingsHeader: () => {
				const anchored = (0, jquery.default)("#tabContentsMyActiveMarketListingsRows").closest(".market_home_listing_table").find(".my_market_header");
				const all = (0, jquery.default)(".my_market_header");
				return (0, jquery.default)(pickSellListingsHeader(anchored, all));
			},
			tradeAssets: (side) => win.g_rgCurrentTradeStatus[side].assets,
			findTradeAsset: (side, appid, contextid, assetid) => {
				return (side === "me" ? win.UserYou : win.UserThem).findAsset(appid, contextid, assetid);
			},
			moveItemToTrade: (item) => win.MoveItemToTrade(item)
		};
	}
	var steamPage = createSteamPage(unsafeWindow);
	steamPage.countryCode();
	var isLoggedIn = steamPage.isLoggedIn();
	var currentPage = window.location.href.includes(".com/market") ? window.location.href.includes("market/listings") ? 1 : 0 : window.location.href.includes(".com/tradeoffer") ? 2 : 3;
	function getInventoryUrl() {
		const inventoryLoadUrl = steamPage.inventoryLoadUrl();
		if (inventoryLoadUrl) return inventoryLoadUrl;
		let profileUrl = `${window.location.origin}/my/`;
		const steamProfileUrl = steamPage.profileUrl();
		if (steamProfileUrl) profileUrl = steamProfileUrl;
		else {
			const avatar = document.querySelector("#global_actions a.user_avatar");
			if (avatar) profileUrl = avatar.href;
		}
		return `${profileUrl.replace(/\/$/, "")}/inventory/json/`;
	}
	var walletInfo = isLoggedIn ? steamPage.walletInfo() : void 0;
	var currencyId = isLoggedIn && walletInfo != null && walletInfo.wallet_currency != null ? walletInfo.wallet_currency : 3;
	var currencyCountry = isLoggedIn && walletInfo != null && walletInfo.wallet_country != null ? walletInfo.wallet_country : "US";
	var currencyCode = steamPage.currencyCode(currencyId);
	var useRound = [
		"JPY",
		"IDR",
		"UAH",
		"CLP",
		"COP",
		"TWD",
		"KZT",
		"CRC",
		"UYU",
		"KRW",
		"VND"
	].includes(currencyCode);
	function readCookie(name) {
		const nameEQ = `${name}=`;
		const ca = document.cookie.split(";");
		for (let i = 0; i < ca.length; i++) {
			let c = ca[i];
			while (c.charAt(0) == " ") c = c.substring(1, c.length);
			if (c.indexOf(nameEQ) == 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
		}
		return null;
	}
	function priceBeforeFees(price, item, rules) {
		let publisherFee = -1;
		if (item != null) {
			if (item.market_fee != null) publisherFee = item.market_fee;
			else if (item.description != null && item.description.market_fee != null) publisherFee = item.description.market_fee;
		}
		if (publisherFee == -1) publisherFee = rules.walletInfo != null ? rules.walletInfo["wallet_publisher_fee_percent_default"] : .1;
		price = Math.round(price);
		const feeInfo = CalculateFeeAmount(price, publisherFee, rules.walletInfo, rules.useRound);
		return price > feeInfo.fees ? price - feeInfo.fees : 1;
	}
	function priceIncludingFees(price, item, rules) {
		let publisherFee = -1;
		if (item != null) {
			if (item.market_fee != null) publisherFee = item.market_fee;
			else if (item.description != null && item.description.market_fee != null) publisherFee = item.description.market_fee;
		}
		if (publisherFee == -1) publisherFee = rules.walletInfo != null ? rules.walletInfo["wallet_publisher_fee_percent_default"] : .1;
		price = Math.round(price);
		return CalculateAmountToSendForDesiredReceivedAmount(price, publisherFee, rules.walletInfo, rules.useRound).amount;
	}
	function CalculateFeeAmount(amount, publisherFee, walletInfo, useRound) {
		if (walletInfo == null || !walletInfo["wallet_fee"]) return { fees: 0 };
		publisherFee = publisherFee == null ? 0 : publisherFee;
		let iterations = 0;
		let nEstimatedAmountOfWalletFundsReceivedByOtherParty = parseInt(String((amount - parseInt(String(walletInfo["wallet_fee_base"]))) / (parseFloat(String(walletInfo["wallet_fee_percent"])) + parseFloat(String(publisherFee)) + 1)));
		let bEverUndershot = false;
		let fees = CalculateAmountToSendForDesiredReceivedAmount(nEstimatedAmountOfWalletFundsReceivedByOtherParty, publisherFee, walletInfo, useRound);
		while (fees.amount != amount && iterations < 10) {
			if (fees.amount > amount) {
				if (bEverUndershot) {
					fees = CalculateAmountToSendForDesiredReceivedAmount(nEstimatedAmountOfWalletFundsReceivedByOtherParty - 1, publisherFee, walletInfo, useRound);
					fees.steam_fee += amount - fees.amount;
					fees.fees += amount - fees.amount;
					fees.amount = amount;
					break;
				} else nEstimatedAmountOfWalletFundsReceivedByOtherParty--;
			} else {
				bEverUndershot = true;
				nEstimatedAmountOfWalletFundsReceivedByOtherParty++;
			}
			fees = CalculateAmountToSendForDesiredReceivedAmount(nEstimatedAmountOfWalletFundsReceivedByOtherParty, publisherFee, walletInfo, useRound);
			iterations++;
		}
		return fees;
	}
	function clamp(cur, min, max) {
		if (cur < min) cur = min;
		if (cur > max) cur = max;
		return cur;
	}
	function CalculateAmountToSendForDesiredReceivedAmount(receivedAmount, publisherFee, walletInfo, useRound) {
		if (walletInfo == null || !walletInfo["wallet_fee"]) return { amount: receivedAmount };
		const roundFee = useRound ? Math.round : Math.floor;
		const minFee = walletInfo["wallet_fee_minimum"] || 1;
		publisherFee = publisherFee == null ? 0 : publisherFee;
		const nSteamFee = Math.max(parseInt(String(roundFee(receivedAmount * parseFloat(String(walletInfo["wallet_fee_percent"])) + parseInt(String(walletInfo["wallet_fee_base"]))))), minFee);
		const nPublisherFee = publisherFee > 0 ? Math.max(parseInt(String(roundFee(receivedAmount * publisherFee))), minFee) : 0;
		const nAmountToSend = receivedAmount + nSteamFee + nPublisherFee;
		return {
			steam_fee: nSteamFee,
			publisher_fee: nPublisherFee,
			fees: nSteamFee + nPublisherFee,
			amount: parseInt(String(nAmountToSend))
		};
	}
	localforage.default.createInstance({ name: "see_persistent" });
	var storageSession;
	var noCache = new URL(window.location.href).searchParams.get("no-cache") != null;
	if (getSessionStorageItem("SESSION") == null || noCache) {
		let lastCache = getSettingWithDefault(SETTING_LAST_CACHE);
		if (lastCache > 5) lastCache = 0;
		setSetting(SETTING_LAST_CACHE, lastCache + 1);
		storageSession = localforage.default.createInstance({ name: `see_session_${lastCache}` });
		storageSession.clear();
		setSessionStorageItem("SESSION", lastCache);
	} else storageSession = localforage.default.createInstance({ name: `see_session_${getSessionStorageItem("SESSION")}` });
	function SteamMarket(appContext, inventoryUrl, walletInfo) {
		this.appContext = appContext;
		this.inventoryUrl = inventoryUrl;
		this.walletInfo = walletInfo;
		this.inventoryUrlBase = inventoryUrl.replace("/inventory/json", "");
		if (!this.inventoryUrlBase.endsWith("/")) this.inventoryUrlBase += "/";
	}
	function steamRefused(data) {
		return !data?.success;
	}
	function buildOrderBook(data) {
		if (!data || steamRefused(data) || !data.data) return null;
		const orderBook = data.data;
		const buildGraph = (compactOrders) => {
			const graph = [];
			if (!Array.isArray(compactOrders)) return graph;
			for (let i = 0; i < compactOrders.length; i += 2) {
				const price = parseInt(compactOrders[i], 10);
				const quantity = parseInt(compactOrders[i + 1], 10);
				if (isNaN(price) || isNaN(quantity)) continue;
				graph.push([
					price / 100,
					quantity,
					""
				]);
			}
			return graph;
		};
		return {
			success: 1,
			highest_buy_order: orderBook.amtMaxBuyOrder != null ? parseInt(orderBook.amtMaxBuyOrder, 10) : 0,
			lowest_sell_order: orderBook.amtMinSellOrder != null ? parseInt(orderBook.amtMinSellOrder, 10) : 0,
			buy_order_graph: buildGraph(orderBook.rgCompactBuyOrders),
			sell_order_graph: buildGraph(orderBook.rgCompactSellOrders),
			cBuyOrders: orderBook.cBuyOrders,
			cSellOrders: orderBook.cSellOrders,
			eCurrency: orderBook.eCurrency
		};
	}
	var market = new SteamMarket(steamPage.appContextData(), getInventoryUrl(), isLoggedIn ? steamPage.walletInfo() : void 0);
	SteamMarket.prototype.sellItem = function(item, price, callback) {
		request(`${window.location.origin}/market/sellitem/`, {
			method: "POST",
			data: {
				sessionid: readCookie("sessionid"),
				appid: item.appid,
				contextid: item.contextid,
				assetid: item.assetid || item.id,
				amount: item.amount || 1,
				price
			},
			responseType: "json"
		}, (error, data) => {
			if (error) {
				callback(1, null);
				return;
			}
			if (steamRefused(data)) {
				callback(2, data);
				return;
			}
			callback(null, data);
		});
	};
	SteamMarket.prototype.removeListing = function(item, isBuyOrder, callback) {
		request(isBuyOrder ? `${window.location.origin}/market/cancelbuyorder/` : `${window.location.origin}/market/removelisting/${item}`, {
			method: "POST",
			data: {
				sessionid: readCookie("sessionid"),
				...isBuyOrder ? { buy_orderid: item } : {}
			},
			responseType: "json"
		}, (error, data) => {
			if (error) {
				callback(1, null);
				return;
			}
			callback(null, data);
		});
	};
	SteamMarket.prototype.getPriceHistory = function(item, cache, callback) {
		if (!(getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 1 || getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 4)) return callback(null, null, true);
		try {
			const market_name = getMarketHashName(item);
			if (market_name == null) {
				callback(1, null, false);
				return;
			}
			const appid = item.appid;
			if (cache) {
				const storage_hash = `pricehistory_${appid}+${market_name}`;
				storageSession.getItem(storage_hash).then((value) => {
					if (value != null) callback(null, value, true);
					else market.getCurrentPriceHistory(appid, market_name, callback);
				}).catch(() => {
					market.getCurrentPriceHistory(appid, market_name, callback);
				});
			} else market.getCurrentPriceHistory(appid, market_name, callback);
		} catch {
			return callback(1, null, false);
		}
	};
	SteamMarket.prototype.getGooValue = function(item, callback) {
		try {
			let appid = item.market_fee_app;
			for (const action of item.owner_actions) {
				if (!action.link || !action.link.startsWith("javascript:GetGooValue")) continue;
				const rgMatches = action.link.match(/GetGooValue\( *'%contextid%', *'%assetid%', *'?(?<appid>[0-9]+)'?/);
				if (!rgMatches) continue;
				appid = rgMatches.groups.appid;
				break;
			}
			request(`${this.inventoryUrlBase}ajaxgetgoovalue/`, {
				method: "GET",
				data: {
					sessionid: readCookie("sessionid"),
					appid,
					assetid: item.assetid,
					contextid: item.contextid
				},
				responseType: "json"
			}, (error, data) => {
				if (error) {
					callback(1, null);
					return;
				}
				callback(null, data);
			});
		} catch {
			return callback(1, null);
		}
	};
	SteamMarket.prototype.grindIntoGoo = function(item, gooValueExpected, callback) {
		try {
			request(`${this.inventoryUrlBase}ajaxgrindintogoo/`, {
				method: "POST",
				data: {
					sessionid: readCookie("sessionid"),
					appid: item.market_fee_app,
					assetid: item.assetid,
					contextid: item.contextid,
					goo_value_expected: gooValueExpected
				},
				responseType: "json"
			}, (error, data) => {
				if (error) {
					callback(1, null);
					return;
				}
				callback(null, data);
			});
		} catch {
			return callback(1, null);
		}
	};
	SteamMarket.prototype.unpackBoosterPack = function(item, callback) {
		try {
			request(`${this.inventoryUrlBase}ajaxunpackbooster/`, {
				method: "POST",
				data: {
					sessionid: readCookie("sessionid"),
					appid: item.market_fee_app,
					communityitemid: item.assetid
				},
				responseType: "json"
			}, (error, data) => {
				if (error) {
					callback(1, null);
					return;
				}
				callback(null, data);
			});
		} catch {
			return callback(1, null);
		}
	};
	SteamMarket.prototype.getCurrentPriceHistory = function(appid, market_name, callback) {
		request(`${window.location.origin}/market/pricehistory/`, {
			method: "GET",
			data: {
				appid,
				market_hash_name: market_name
			},
			responseType: "json"
		}, (error, data) => {
			if (error) {
				callback(1, null, false);
				return;
			}
			if (data && (steamRefused(data) || !data.prices)) {
				callback(2, null, false);
				return;
			}
			for (let i = 0; i < data.prices.length; i++) {
				data.prices[i][1] *= 100;
				data.prices[i][2] = parseInt(data.prices[i][2]);
			}
			const storage_hash = `pricehistory_${appid}+${market_name}`;
			storageSession.setItem(storage_hash, data.prices);
			callback(null, data.prices, false);
		});
	};
	SteamMarket.prototype.getOrderBook = function(item, cache, callback) {
		try {
			const market_name = getMarketHashName(item);
			if (market_name == null) {
				callback(1, null, false);
				return;
			}
			const appid = item.appid;
			if (cache) {
				const storage_hash = `orderbook_${appid}+${market_name}`;
				storageSession.getItem(storage_hash).then((value) => {
					if (value != null) callback(null, value, true);
					else market.getCurrentOrderBook(item, market_name, callback);
				}).catch(() => {
					market.getCurrentOrderBook(item, market_name, callback);
				});
			} else market.getCurrentOrderBook(item, market_name, callback);
		} catch {
			return callback(1, null, false);
		}
	};
	SteamMarket.prototype.getCurrentOrderBook = function(item, market_name, callback) {
		request(`${window.location.origin}/market/orderbook`, {
			method: "GET",
			data: {
				q: "Load",
				qp: JSON.stringify([item.appid, market_name])
			},
			responseType: "json"
		}, (error, data) => {
			if (error) {
				callback(1, null, false);
				return;
			}
			const orderbook = buildOrderBook(data?.data);
			if (orderbook == null) {
				callback(2, null, false);
				return;
			}
			const storage_hash = `orderbook_${item.appid}+${market_name}`;
			storageSession.setItem(storage_hash, orderbook);
			callback(null, orderbook, false);
		});
	};
	SteamMarket.prototype.getPriceBeforeFees = function(price, item) {
		return priceBeforeFees(price, item, {
			walletInfo: this.walletInfo,
			useRound
		});
	};
	SteamMarket.prototype.getPriceIncludingFees = function(price, item) {
		return priceIncludingFees(price, item, {
			walletInfo: this.walletInfo,
			useRound
		});
	};
	function formatPrice(valueInCents) {
		return steamPage.formatPrice(valueInCents, currencyCode, currencyCountry);
	}
	function formatPriceDelta(cents) {
		if (!cents) return "";
		return `${cents > 0 ? "+" : "−"}${formatPrice(Math.abs(cents))}`;
	}
	function getPriceInformationFromItem(item) {
		return getPriceInformation(getIsTradingCard(item), getIsFoilTradingCard(item));
	}
	function getPriceInformation(isTradingCard, isFoilTradingCard) {
		let maxPrice = 0;
		let minPrice = 0;
		if (!isTradingCard) {
			maxPrice = getSettingWithDefault(SETTING_MAX_MISC_PRICE);
			minPrice = getSettingWithDefault(SETTING_MIN_MISC_PRICE);
		} else {
			maxPrice = isFoilTradingCard ? getSettingWithDefault(SETTING_MAX_FOIL_PRICE) : getSettingWithDefault(SETTING_MAX_NORMAL_PRICE);
			minPrice = isFoilTradingCard ? getSettingWithDefault(SETTING_MIN_FOIL_PRICE) : getSettingWithDefault(SETTING_MIN_NORMAL_PRICE);
		}
		maxPrice = maxPrice * 100;
		minPrice = minPrice * 100;
		const maxPriceBeforeFees = market.getPriceBeforeFees(maxPrice);
		const minPriceBeforeFees = market.getPriceBeforeFees(minPrice);
		return {
			maxPrice,
			minPrice,
			maxPriceBeforeFees,
			minPriceBeforeFees
		};
	}
	var NO_LISTING_PRICE_SENTINEL = 65535;
	function createPricingRules() {
		return {
			algorithm: Number(getSettingWithDefault(SETTING_PRICE_ALGORITHM)),
			offsetCents: Number(getSettingWithDefault(SETTING_PRICE_OFFSET)) * 100,
			historyHours: Number(getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS)),
			ignoreLowestOnLowQuantity: getSettingWithDefault(SETTING_PRICE_IGNORE_LOWEST_Q) == 1,
			walletInfo: market.walletInfo,
			useRound,
			now: Date.now()
		};
	}
	function calculateAverageHistoryPriceBeforeFees(history, rules = createPricingRules()) {
		let highest = 0;
		let total = 0;
		if (history != null) {
			const timeAgo = rules.now - rules.historyHours * 60 * 60 * 1e3;
			history.forEach((historyItem) => {
				if (new Date(historyItem[0]).getTime() > timeAgo) {
					highest += historyItem[1] * historyItem[2];
					total += historyItem[2];
				}
			});
		}
		if (total == 0) return 0;
		highest = Math.floor(highest / total);
		return priceBeforeFees(highest, null, rules);
	}
	function calculateListingPriceBeforeFees(orderbook, rules = createPricingRules()) {
		if (typeof orderbook === "undefined" || orderbook == null || orderbook.lowest_sell_order == null || orderbook.sell_order_graph == null) return 0;
		let listingPrice = priceBeforeFees(orderbook.lowest_sell_order, null, rules);
		if (rules.ignoreLowestOnLowQuantity && orderbook.sell_order_graph.length >= 2) {
			const listingPrice2ndLowest = priceBeforeFees(orderbook.sell_order_graph[1][0] * 100, null, rules);
			if (listingPrice2ndLowest > listingPrice) {
				const numberOfListingsLowest = orderbook.sell_order_graph[0][1];
				const numberOfListings2ndLowest = orderbook.sell_order_graph[1][1];
				const percentageLower = 100 * (numberOfListingsLowest / numberOfListings2ndLowest);
				if (numberOfListings2ndLowest >= 1e3 && percentageLower <= 5) listingPrice = listingPrice2ndLowest;
				else if (numberOfListings2ndLowest < 1e3 && percentageLower <= 10) listingPrice = listingPrice2ndLowest;
				else if (numberOfListings2ndLowest < 100 && percentageLower <= 15) listingPrice = listingPrice2ndLowest;
				else if (numberOfListings2ndLowest < 50 && percentageLower <= 20) listingPrice = listingPrice2ndLowest;
				else if (numberOfListings2ndLowest < 25 && percentageLower <= 25) listingPrice = listingPrice2ndLowest;
				else if (numberOfListings2ndLowest < 10 && percentageLower <= 30) listingPrice = listingPrice2ndLowest;
			}
		}
		return listingPrice;
	}
	function calculateBuyOrderPriceBeforeFees(orderbook, rules = createPricingRules()) {
		if (typeof orderbook === "undefined" || orderbook == null) return 0;
		return priceBeforeFees(orderbook.highest_buy_order, null, rules);
	}
	function calculateSellPriceBeforeFees(history, orderbook, applyOffset, minPriceBeforeFees, maxPriceBeforeFees, rules = createPricingRules()) {
		const historyPrice = calculateAverageHistoryPriceBeforeFees(history, rules);
		const listingPrice = calculateListingPriceBeforeFees(orderbook, rules);
		const buyPrice = calculateBuyOrderPriceBeforeFees(orderbook, rules);
		const shouldUseAverage = rules.algorithm === 1;
		const shouldUseBuyOrder = rules.algorithm === 3;
		const shouldUseHistory = rules.algorithm === 4;
		let calculatedPrice = 0;
		if (shouldUseBuyOrder) calculatedPrice = buyPrice;
		else if ((historyPrice < listingPrice || !shouldUseAverage) && !shouldUseHistory) calculatedPrice = listingPrice;
		else calculatedPrice = historyPrice;
		let changedToMax = false;
		if (calculatedPrice == 0) {
			calculatedPrice = maxPriceBeforeFees;
			changedToMax = true;
		}
		if (!changedToMax && applyOffset) calculatedPrice = calculatedPrice + rules.offsetCents;
		calculatedPrice = clamp(calculatedPrice, minPriceBeforeFees, maxPriceBeforeFees);
		if (!shouldUseHistory && typeof orderbook !== "undefined" && orderbook != null && orderbook.highest_buy_order != null) {
			const buyOrderPrice = priceBeforeFees(orderbook.highest_buy_order, null, rules);
			if (buyOrderPrice > calculatedPrice) calculatedPrice = buyOrderPrice;
		}
		return calculatedPrice;
	}
	function getRandomInt(min, max) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
	function getNumberOfDigits(x) {
		return (Math.log10((x ^ x >> 31) - (x >> 31)) | 0) + 1;
	}
	function padLeftZero(str, max) {
		str = str.toString();
		return str.length < max ? padLeftZero(`0${str}`, max) : str;
	}
	function replaceNonNumbers(str) {
		return str.replace(/\D/g, "");
	}
	function createFailureCounter() {
		return { failures: 0 };
	}
	function resetRetryDelay(counter) {
		counter.failures = 0;
	}
	function nextRetryDelay(counter) {
		counter.failures += 1;
		const delay = counter.failures > 1 ? getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX) : getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX);
		if (counter.failures > 3) counter.failures = 0;
		return delay;
	}
	function nextQueueStep(success, cached, failures, alreadyRetried, options = {}) {
		if (success) {
			if (!cached) resetRetryDelay(failures);
			const configured = options.successDelayMs ?? (() => getRandomInt(1e3, 1500));
			const delay = typeof configured === "function" ? configured() : configured;
			return {
				delay: cached ? 0 : delay,
				retry: false
			};
		}
		const retry = (options.retryOnFailure ?? false) && !alreadyRetried;
		return {
			delay: cached ? 0 : nextRetryDelay(failures),
			retry
		};
	}
	function runQueue(worker, options = {}) {
		const failures = createFailureCounter();
		const queue = async.default.queue((task, next) => {
			worker(task, task.ignoreErrors === true, (success, cached) => {
				const step = nextQueueStep(success, cached, failures, task.ignoreErrors === true, options);
				if (step.retry) {
					task.ignoreErrors = true;
					if (options.retryPlacement === "front") queue.unshift(task);
					else queue.push(task);
				} else options.onTaskDone?.(task, success);
				setTimeout(() => next(), step.delay);
			});
		}, options.concurrency ?? 1);
		return queue;
	}
	function markRow(assetKey, status) {
		(0, jquery.default)(`#${assetKey}`).css("background", ROW_STATUS_COLORS[status]);
	}
	function injectCss(css) {
		const head = document.getElementsByTagName("head")[0];
		if (!head) return;
		const style = document.createElement("style");
		style.type = "text/css";
		style.innerHTML = css;
		head.appendChild(style);
	}
	function renderSpinner(text) {
		const { container, spinnerid } = getSpinnerContext();
		if (container == null || spinnerid == null) return;
		text = (text || "").trim();
		removeSpinner();
		container.append(`
        <div id="${spinnerid}">
            <div class="spinner">
                <div class="rect1"></div>
                <div class="rect2"></div>
                <div class="rect3"></div>
                <div class="rect4"></div>
                <div class="rect5"></div>
            </div>
            ${text ? `<div style="text-align:center">${text}</div>` : ""}
        </div>`);
	}
	function removeSpinner() {
		const { container, spinnerid } = getSpinnerContext();
		if (container == null || spinnerid == null) return;
		(0, jquery.default)(`#${spinnerid}`, container).remove();
	}
	function getSpinnerContext() {
		let container = null;
		let spinnerid = null;
		switch (currentPage) {
			case 0:
				container = (0, jquery.default)(".my_market_header").eq(0);
				spinnerid = "market_listings_spinner";
				break;
			case 3:
				container = (0, jquery.default)("#inventory_sell_buttons");
				spinnerid = "inventory_items_spinner";
		}
		container = container && container.length > 0 ? container : null;
		return {
			container,
			spinnerid
		};
	}
	var marketLists = [];
	function getListFromContainer(group) {
		for (let i = 0; i < marketLists.length; i++) if (group[0].contains(marketLists[i].listContainer)) return marketLists[i];
	}
	function getListingFromLists(listingid) {
		for (let i = marketLists.length - 1; i >= 0; i--) {
			let values = marketLists[i].get("market_listing_item_name", `mylisting_${listingid}_name`);
			if (values != null && values.length > 0) return values[0];
			values = marketLists[i].get("market_listing_item_name", `mbuyorder_${listingid}_name`);
			if (values != null && values.length > 0) return values[0];
		}
	}
	function removeListingFromLists(listingid) {
		for (let i = 0; i < marketLists.length; i++) {
			marketLists[i].remove("market_listing_item_name", `mylisting_${listingid}_name`);
			marketLists[i].remove("market_listing_item_name", `mbuyorder_${listingid}_name`);
		}
	}
	var getPriceValueAsInt = (listing) => steamPage.parsePriceText(listing.match(/(?<price>[0-9][0-9 .,]*)/)?.groups?.price ?? 0);
	function getAssetInfoFromListingId(listingid) {
		const listing = getListingFromLists(listingid);
		if (listing == null) return {};
		const actionButton = (0, jquery.default)(".item_market_action_button", listing.elm).attr("href");
		if (actionButton == null || actionButton.toLowerCase().includes("cancelmarketbuyorder")) return {};
		const priceBuyer = getPriceValueAsInt((0, jquery.default)(".market_listing_price > span:nth-child(1) > span:nth-child(1)", listing.elm).text());
		const priceSeller = getPriceValueAsInt((0, jquery.default)(".market_listing_price > span:nth-child(1) > span:nth-child(3)", listing.elm).text());
		const itemIds = actionButton.split(",");
		const appid = replaceNonNumbers(itemIds[2]);
		const contextid = replaceNonNumbers(itemIds[3]);
		const assetid = replaceNonNumbers(itemIds[4]);
		return {
			appid,
			contextid,
			assetid,
			amount: Number(steamPage.assetFor(appid, contextid, assetid)?.amount ?? 1),
			priceBuyer,
			priceSeller
		};
	}
	function getAssetInfoFromBuyOrderId(orderid) {
		const listing = getListingFromLists(orderid);
		if (listing == null) return {};
		if (!listing.elm.id.startsWith("mbuyorder_") && !listing.elm.id.startsWith("mybuyorder_")) return {};
		return {
			amount: parseInt((0, jquery.default)(".market_listing_buyorder_qty", listing.elm).text().trim()),
			price: getPriceValueAsInt((0, jquery.default)(".market_listing_price", listing.elm)[0].innerText)
		};
	}
	function marketSectionFor(target) {
		return (0, jquery.default)(target).closest(".market_listing_buttons").parent().parent();
	}
	function selectionFor(target) {
		const group = marketSectionFor(target);
		const list = getListFromContainer(group);
		if (list == null) return null;
		return {
			list,
			rows: list.matchingItems,
			group
		};
	}
	function tableHeaderSectionFor(target) {
		return (0, jquery.default)(target).parent().parent();
	}
	var marketRelistQueuedListings = new Set();
	var marketOverpricedButtonsQueued = false;
	function refreshMarketOverpricedButtons() {
		if (marketOverpricedButtonsQueued) return;
		marketOverpricedButtonsQueued = true;
		const refresh = () => {
			marketOverpricedButtonsQueued = false;
			updateMarketOverpricedButtons();
		};
		if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(refresh);
		else setTimeout(refresh, 0);
	}
	var marketOverpricedQueue = runQueue(marketOverpricedQueueWorker, {
		retryOnFailure: true,
		retryPlacement: "front",
		onTaskDone: () => {
			marketProgress.relistDone += 1;
			increaseMarketProgress();
		}
	});
	function marketOverpricedQueueWorker(item, ignoreErrors, callback) {
		let listingUI = getListingFromLists(item.listing);
		if (listingUI == null) {
			`${item.listing}`;
			callback(true);
			return;
		}
		listingUI = listingUI.elm;
		market.removeListing(item.listing, false, (errorRemove) => {
			if (!errorRemove) {
				(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_PENDING);
				setTimeout(() => {
					const itemName = (0, jquery.default)(".market_listing_item_name_link", listingUI).first().attr("href");
					const marketHashNameIndex = itemName.lastIndexOf("/") + 1;
					const marketHashName = itemName.substring(marketHashNameIndex);
					const decodedMarketHashName = decodeURIComponent(itemName.substring(marketHashNameIndex));
					let newAssetId = -1;
					steamPage.requestFullInventory(`${market.inventoryUrl + item.appid}/${item.contextid}/`, (transport) => {
						if (transport.responseJSON && transport.responseJSON.success) {
							const inventory = transport.responseJSON.rgInventory;
							for (const child in inventory) if (marketListingsRelistedAssets.indexOf(child) == -1 && inventory[child].appid == item.appid && (inventory[child].market_hash_name == decodedMarketHashName || inventory[child].market_hash_name == marketHashName)) {
								newAssetId = child;
								break;
							}
							if (newAssetId == -1) {
								(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_ERROR);
								return callback(false);
							}
							item.assetid = newAssetId;
							marketListingsRelistedAssets.push(newAssetId);
							market.sellItem(item, item.sellPrice, (errorSell, dataSell) => {
								if (!errorSell) {
									(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_SUCCESS);
									setTimeout(() => {
										removeListingFromLists(item.listing);
										refreshMarketOverpricedButtons();
									}, 3e3);
									return callback(true);
								} else {
									const message = dataSell?.message || "";
									`${item.listing}`, message && `${message}`;
									(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_ERROR);
									return callback(false);
								}
							});
						} else {
							(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_ERROR);
							return callback(false);
						}
					});
				}, getRandomInt(1500, 2500));
			} else {
				(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_ERROR);
				return callback(false);
			}
		});
	}
	function queueOverpricedItemListing(listingid) {
		if (marketRelistQueuedListings.has(listingid)) return;
		const assetInfo = getAssetInfoFromListingId(listingid);
		const state = listingState.get(listingid);
		const price = state == null ? -1 : state.sellPrice;
		if (price > 0) {
			marketOverpricedQueue.push({
				listing: listingid,
				assetid: assetInfo.assetid,
				contextid: assetInfo.contextid,
				appid: assetInfo.appid,
				sellPrice: price
			});
			marketRelistQueuedListings.add(listingid);
			marketProgress.relistTotal += 1;
			increaseMarketProgressMax();
			refreshMarketOverpricedButtons();
		}
	}
	function updateMarketOverpricedButtons() {
		const isRelisting = marketProgress.relistTotal > 0;
		(0, jquery.default)(".market_listing_buttons").each(function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows, group } = selection;
			const count = rows.filter((item) => (0, jquery.default)(item.elm).hasClass(VERDICT_OVERPRICED)).length;
			(0, jquery.default)(".relist_overpriced > span", group).text(isRelisting ? `Relisting ${marketProgress.relistDone}/${marketProgress.relistTotal}` : `Relist overpriced (${count})`);
			(0, jquery.default)(".relist_overpriced", group).toggleClass("see_button_busy", isRelisting);
			(0, jquery.default)(".select_overpriced > span", group).text(`Select overpriced (${count})`);
		});
	}
	var marketProgress = {
		bar: null,
		relistTotal: 0,
		relistDone: 0
	};
	function increaseMarketProgressMax() {
		let value = marketProgress.bar.max;
		if (marketProgress.bar.value === value) {
			marketProgress.bar.value = 0;
			value = 0;
		}
		marketProgress.bar.max = value + 1;
		marketProgress.bar.removeAttribute("hidden");
	}
	function increaseMarketProgress() {
		marketProgress.bar.value += 1;
		if (marketProgress.bar.value === marketProgress.bar.max) marketProgress.bar.setAttribute("hidden", "true");
		refreshMarketOverpricedButtons();
	}
	function resetMarketRelistProgress() {
		marketProgress.relistTotal = 0;
		marketProgress.relistDone = 0;
		marketRelistQueuedListings.clear();
		refreshMarketOverpricedButtons();
	}
	function sortMarketListings(elem, isPrice, isDateOrQuantity, isName) {
		const list = getListFromContainer(elem);
		if (list == null) return;
		let asc = true;
		const arrow_down = "▼";
		const arrow_up = "▲";
		(0, jquery.default)(".market_listing_table_header > span", elem).each(function() {
			if ((0, jquery.default)(this).hasClass("market_listing_edit_buttons")) return;
			if ((0, jquery.default)(this).text().includes(arrow_up)) asc = false;
			(0, jquery.default)(this).text((0, jquery.default)(this).text().replace(` ${arrow_down}`, "").replace(` ${arrow_up}`, ""));
		});
		let market_listing_selector;
		if (isPrice) market_listing_selector = (0, jquery.default)(".market_listing_table_header", elem).children().eq(1);
		else if (isDateOrQuantity) market_listing_selector = (0, jquery.default)(".market_listing_table_header", elem).children().eq(2);
		else if (isName) market_listing_selector = (0, jquery.default)(".market_listing_table_header", elem).children().eq(3);
		market_listing_selector.text(`${market_listing_selector.text()} ${asc ? arrow_up : arrow_down}`);
		if (list.sort == null) return;
		const isBuyOrder = list.list.querySelectorAll(".market_listing_buyorder_qty").length >= 1;
		if (isName) list.sort("", {
			order: asc ? "asc" : "desc",
			sortFunction: function(a, b) {
				if (a.values().market_listing_game_name.toLowerCase().localeCompare(b.values().market_listing_game_name.toLowerCase()) == 0) return a.values().market_listing_item_name_link.toLowerCase().localeCompare(b.values().market_listing_item_name_link.toLowerCase());
				return a.values().market_listing_game_name.toLowerCase().localeCompare(b.values().market_listing_game_name.toLowerCase());
			}
		});
		else if (isDateOrQuantity) {
			const currentMonth = luxon.DateTime.local().month;
			if (isBuyOrder) list.sort("market_listing_buyorder_qty", {
				order: asc ? "asc" : "desc",
				sortFunction: function(a, b) {
					return a.elm.querySelector(".market_listing_buyorder_qty").innerText - b.elm.querySelector(".market_listing_buyorder_qty").innerText;
				}
			});
			else list.sort("market_listing_listed_date", {
				order: asc ? "asc" : "desc",
				sortFunction: function(a, b) {
					let firstDate = luxon.DateTime.fromString(a.values().market_listing_listed_date.trim(), "d MMM");
					let secondDate = luxon.DateTime.fromString(b.values().market_listing_listed_date.trim(), "d MMM");
					if (firstDate == null || secondDate == null) return 0;
					if (firstDate.month > currentMonth) firstDate = firstDate.plus({ years: -1 });
					if (secondDate.month > currentMonth) secondDate = secondDate.plus({ years: -1 });
					if (firstDate > secondDate) return 1;
					if (firstDate === secondDate) return 0;
					return -1;
				}
			});
		} else if (isPrice) list.sort("market_listing_price", {
			order: asc ? "asc" : "desc",
			sortFunction: function(a, b) {
				if (!isBuyOrder) {
					let listingPriceA = (0, jquery.default)(a.values().market_listing_price).text();
					listingPriceA = listingPriceA.substr(0, listingPriceA.indexOf("("));
					let listingPriceB = (0, jquery.default)(b.values().market_listing_price).text();
					listingPriceB = listingPriceB.substr(0, listingPriceB.indexOf("("));
					return getPriceValueAsInt(listingPriceA) - getPriceValueAsInt(listingPriceB);
				} else return getPriceValueAsInt(a.elm.querySelector("div:nth-child(3) > span:nth-child(1) > span:nth-child(1)").innerText) - getPriceValueAsInt(b.elm.querySelector("div:nth-child(3) > span:nth-child(1) > span:nth-child(1)").innerText);
			}
		});
	}
	function openSettings() {
		const price_options = (0, jquery.default)(`<div id="see_settings_modal">
        <div>
            Calculate prices as the:&nbsp;
            <select id="${SETTING_PRICE_ALGORITHM}">
                <option value="1"${getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 1 ? "selected=\"selected\"" : ""}>Maximum of the average history and lowest sell listing</option>
                <option value="2" ${getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 2 ? "selected=\"selected\"" : ""}>Lowest sell listing</option>
                <option value="3" ${getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 3 ? "selected=\"selected\"" : ""}>Highest current buy order or lowest sell listing</option>
                <option value="4" ${getSettingWithDefault("SETTING_PRICE_ALGORITHM") == 4 ? "selected=\"selected\"" : ""}>Average history only</option>
            </select>
        </div>
        <div style="margin-top:6px;">
            Hours to use for the average history calculated price:&nbsp;
            <input type="number" min="0" step="2" id="${SETTING_PRICE_HISTORY_HOURS}" value=${getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS)}>
        </div>
        <div style="margin-top:6px;">
            The value to add to the calculated price (minimum and maximum are respected):&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_OFFSET}" value=${getSettingWithDefault(SETTING_PRICE_OFFSET)}>
        </div>
        <div style="margin-top:6px">
            Use the second lowest sell listing when the lowest sell listing has a low quantity:&nbsp;
            <input type="checkbox" id="${SETTING_PRICE_IGNORE_LOWEST_Q}" ${getSettingWithDefault("SETTING_PRICE_IGNORE_LOWEST_Q") == 1 ? "checked" : ""}>
        </div>
        <div style="margin-top:6px;">
            Don't check market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_CHECK_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_CHECK_PRICE)}>
        </div>
        <div style="margin-top:6px;">
            Don't list market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_LIST_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_LIST_PRICE)}>
        </div>
        <div style="margin-top:24px">
            Show price labels in inventory:&nbsp;
            <input type="checkbox" id="${SETTING_INVENTORY_PRICE_LABELS}" ${getSettingWithDefault("SETTING_INVENTORY_PRICE_LABELS") == 1 ? "checked" : ""}>
        </div>
        <div style="margin-top:6px">
            Show price labels in trade offers:&nbsp;
            <input type="checkbox" id="${SETTING_TRADEOFFER_PRICE_LABELS}" ${getSettingWithDefault("SETTING_TRADEOFFER_PRICE_LABELS") == 1 ? "checked" : ""}>
        </div>
        <div style="margin-top:6px">
            Show quick sell info and buttons:&nbsp;
            <input type="checkbox" id="${SETTING_QUICK_SELL_BUTTONS}" ${getSettingWithDefault("SETTING_QUICK_SELL_BUTTONS") == 1 ? "checked" : ""}>
        </div>
        <div style="margin-top:24px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_NORMAL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_NORMAL_PRICE)}>
            &nbsp;price for normal cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_FOIL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_FOIL_PRICE)}>
            &nbsp;price for foil cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MIN_MISC_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MAX_MISC_PRICE)}>
            &nbsp;price for other items
        </div>
        <div style="margin-top:6px;">
            Automatically relist overpriced market listings (slow on large inventories):&nbsp;
            <input id="${SETTING_RELIST_AUTOMATICALLY}" class="market_relist_auto" type="checkbox" ${getSettingWithDefault("SETTING_RELIST_AUTOMATICALLY") == 1 ? "checked" : ""}>
        </div>
    </div>`);
		steamPage.showConfirmDialog("Steam Economy Enhancer", price_options).done(() => {
			setSetting(SETTING_MIN_NORMAL_PRICE, (0, jquery.default)(`#${SETTING_MIN_NORMAL_PRICE}`, price_options).val());
			setSetting(SETTING_MAX_NORMAL_PRICE, (0, jquery.default)(`#${SETTING_MAX_NORMAL_PRICE}`, price_options).val());
			setSetting(SETTING_MIN_FOIL_PRICE, (0, jquery.default)(`#${SETTING_MIN_FOIL_PRICE}`, price_options).val());
			setSetting(SETTING_MAX_FOIL_PRICE, (0, jquery.default)(`#${SETTING_MAX_FOIL_PRICE}`, price_options).val());
			setSetting(SETTING_MIN_MISC_PRICE, (0, jquery.default)(`#${SETTING_MIN_MISC_PRICE}`, price_options).val());
			setSetting(SETTING_MAX_MISC_PRICE, (0, jquery.default)(`#${SETTING_MAX_MISC_PRICE}`, price_options).val());
			setSetting(SETTING_PRICE_OFFSET, (0, jquery.default)(`#${SETTING_PRICE_OFFSET}`, price_options).val());
			setSetting(SETTING_PRICE_MIN_CHECK_PRICE, (0, jquery.default)(`#${SETTING_PRICE_MIN_CHECK_PRICE}`, price_options).val());
			setSetting(SETTING_PRICE_MIN_LIST_PRICE, (0, jquery.default)(`#${SETTING_PRICE_MIN_LIST_PRICE}`, price_options).val());
			setSetting(SETTING_PRICE_ALGORITHM, (0, jquery.default)(`#${SETTING_PRICE_ALGORITHM}`, price_options).val());
			setSetting(SETTING_PRICE_IGNORE_LOWEST_Q, (0, jquery.default)(`#SETTING_PRICE_IGNORE_LOWEST_Q`, price_options).prop("checked") ? 1 : 0);
			setSetting(SETTING_PRICE_HISTORY_HOURS, (0, jquery.default)(`#${SETTING_PRICE_HISTORY_HOURS}`, price_options).val());
			setSetting(SETTING_RELIST_AUTOMATICALLY, (0, jquery.default)(`#SETTING_RELIST_AUTOMATICALLY`, price_options).prop("checked") ? 1 : 0);
			setSetting(SETTING_INVENTORY_PRICE_LABELS, (0, jquery.default)(`#SETTING_INVENTORY_PRICE_LABELS`, price_options).prop("checked") ? 1 : 0);
			setSetting(SETTING_TRADEOFFER_PRICE_LABELS, (0, jquery.default)(`#SETTING_TRADEOFFER_PRICE_LABELS`, price_options).prop("checked") ? 1 : 0);
			setSetting(SETTING_QUICK_SELL_BUTTONS, (0, jquery.default)(`#SETTING_QUICK_SELL_BUTTONS`, price_options).prop("checked") ? 1 : 0);
			window.location.reload();
		});
	}
	function initializeMarketHistoryUI() {
		(0, jquery.default)("#tabContentsMyMarketHistory").observe("childlist subtree", () => {
			const controlsDiv = (0, jquery.default)("#tabContentsMyMarketHistory_controls");
			if (controlsDiv.length > 0 && (0, jquery.default)("#see_page_jump").length === 0) {
				const jumpContainer = (0, jquery.default)("<span id=\"see_page_jump\"></span>");
				const input = (0, jquery.default)("<input type=\"number\" min=\"1\" placeholder=\"Page\" />");
				const btn = (0, jquery.default)("<span class=\"btn_green_white_innerfade btn_small\" style=\"cursor: pointer;\"><span>Jump</span></span>");
				jumpContainer.append(input).append(btn);
				controlsDiv.append(jumpContainer);
				btn.on("click", () => {
					const targetPage = parseInt(String(input.val()));
					if (isNaN(targetPage) || targetPage < 1) return;
					const targetIndex = targetPage - 1;
					steamPage.goToHistoryPage(targetIndex);
				});
				input.on("keypress", (e) => {
					if (e.which === 13) btn.click();
				});
			}
		});
	}
	var marketRemoveQueue = runQueue(marketRemoveQueueWorker, {
		retryOnFailure: true,
		retryPlacement: "front",
		successDelayMs: () => getRandomInt(50, 100),
		onTaskDone: () => increaseMarketProgress()
	});
	function marketRemoveQueueWorker(task, ignoreErrors, callback) {
		const listingid = task.listingid;
		const listing = getListingFromLists(listingid);
		if (listing == null) {
			`${listingid}`;
			callback(true);
			return;
		}
		const listingUI = listing.elm;
		const isBuyOrder = listingUI.id.startsWith("mybuyorder_");
		market.removeListing(listingid, isBuyOrder, (errorRemove) => {
			if (!errorRemove) {
				(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_SUCCESS);
				setTimeout(() => {
					removeListingFromLists(listingid);
					refreshMarketOverpricedButtons();
					const numberOfListings = marketLists[0].size;
					if (numberOfListings > 0) {
						(0, jquery.default)("#my_market_selllistings_number").text(numberOfListings.toString());
						(0, jquery.default)("#my_market_activelistings_number").text(numberOfListings.toString());
					}
				}, 3e3);
				return callback(true);
			} else {
				(0, jquery.default)(".actual_content", listingUI).css("background", COLOR_ERROR);
				return callback(false);
			}
		});
	}
	function updateMarketSelectAllButton() {
		(0, jquery.default)(".market_listing_buttons").each(function() {
			const group = marketSectionFor(this);
			let invert = (0, jquery.default)(".market_select_item:checked", group).length == (0, jquery.default)(".market_select_item", group).length;
			if ((0, jquery.default)(".market_select_item", group).length == 0) invert = false;
			(0, jquery.default)(".select_all > span", group).text(invert ? "Deselect all" : "Select all");
		});
	}
	function initializeMarketUI() {
		(0, jquery.default)(".market_header_text").append("<progress id=\"see_market_progress\" value=\"1\" max=\"1\" hidden>");
		marketProgress.bar = document.getElementById("see_market_progress");
		const sellListingsHeader = steamPage.sellListingsHeader();
		sellListingsHeader.append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_five_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 5</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_twentyfive_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 25</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_selected market_listing_button" style="margin-left:auto">
            <span class="item_market_action_button_contents">Relist selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Relist overpriced (0)</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Select overpriced (0)</span>
        </a>
    </div>`);
		(0, jquery.default)(".my_market_header").not(sellListingsHeader).append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
    </div>`);
		(0, jquery.default)(".market_listing_table_header").on("click", "span", function() {
			if ((0, jquery.default)(this).hasClass("market_listing_edit_buttons") || (0, jquery.default)(this).hasClass("item_market_action_button_contents")) return;
			const section = tableHeaderSectionFor(this);
			sortMarketListings(section, (0, jquery.default)(".market_listing_table_header", section).children().eq(1).text() == (0, jquery.default)(this).text(), (0, jquery.default)(".market_listing_table_header", section).children().eq(2).text() == (0, jquery.default)(this).text(), (0, jquery.default)(".market_listing_table_header", section).children().eq(3).text() == (0, jquery.default)(this).text());
		});
		(0, jquery.default)(".select_all").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows, group } = selection;
			const invert = (0, jquery.default)(".market_select_item:checked", group).length == (0, jquery.default)(".market_select_item", group).length;
			for (let i = 0; i < rows.length; i++) (0, jquery.default)(".market_select_item", rows[i].elm).prop("checked", !invert);
			updateMarketSelectAllButton();
		});
		(0, jquery.default)(".select_five_from_page").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows } = selection;
			let count = 0;
			for (let i = 0; i < rows.length; i++) {
				if (count == 5) break;
				if (!(0, jquery.default)(".market_select_item", rows[i].elm).prop("checked")) {
					(0, jquery.default)(".market_select_item", rows[i].elm).prop("checked", true);
					count += 1;
				}
			}
			updateMarketSelectAllButton();
		});
		(0, jquery.default)(".select_twentyfive_from_page").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows } = selection;
			let count = 0;
			for (let i = 0; i < rows.length; i++) {
				if (count == 25) break;
				if (!(0, jquery.default)(".market_select_item", rows[i].elm).prop("checked")) {
					(0, jquery.default)(".market_select_item", rows[i].elm).prop("checked", true);
					count += 1;
				}
			}
			updateMarketSelectAllButton();
		});
		(0, jquery.default)(".select_overpriced").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows, group } = selection;
			for (let i = 0; i < rows.length; i++) if ((0, jquery.default)(rows[i].elm).hasClass("overpriced")) (0, jquery.default)(".market_select_item", rows[i].elm).prop("checked", true);
			(0, jquery.default)(".market_listing_row", group).each(function() {
				if ((0, jquery.default)(this).hasClass("overpriced")) (0, jquery.default)(".market_select_item", (0, jquery.default)(this)).prop("checked", true);
			});
			updateMarketSelectAllButton();
		});
		(0, jquery.default)(".remove_selected").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows } = selection;
			for (let i = 0; i < rows.length; i++) if ((0, jquery.default)(".market_select_item", (0, jquery.default)(rows[i].elm)).prop("checked")) {
				const listingid = replaceNonNumbers(rows[i].values().market_listing_item_name);
				const listing = getListingFromLists(listingid);
				if (listing == null) continue;
				(0, jquery.default)(listing.elm).addClass("removing");
				marketRemoveQueue.push({ listingid });
				increaseMarketProgressMax();
			}
		});
		(0, jquery.default)(".market_relist_auto").change(() => {
			setSetting(SETTING_RELIST_AUTOMATICALLY, (0, jquery.default)(".market_relist_auto").is(":checked") ? 1 : 0);
		});
		(0, jquery.default)(".relist_overpriced").on("click", "*", function() {
			if ((0, jquery.default)(this).closest(".relist_overpriced").hasClass("see_button_busy")) return;
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows } = selection;
			for (let i = 0; i < rows.length; i++) if ((0, jquery.default)(rows[i].elm).hasClass("overpriced")) queueOverpricedItemListing(replaceNonNumbers(rows[i].values().market_listing_item_name));
		});
		(0, jquery.default)(".relist_selected").on("click", "*", function() {
			const selection = selectionFor(this);
			if (selection == null) return;
			const { rows } = selection;
			for (let i = 0; i < rows.length; i++) if ((0, jquery.default)(rows[i].elm) && (0, jquery.default)(".market_select_item", (0, jquery.default)(rows[i].elm)).prop("checked")) queueOverpricedItemListing(replaceNonNumbers(rows[i].values().market_listing_item_name));
		});
		(0, jquery.default)("#see_settings").remove();
		(0, jquery.default)("#global_action_menu").prepend("<span id=\"see_settings\"><a href=\"javascript:void(0)\">⬖ Steam Economy Enhancer</a></span>");
		(0, jquery.default)("#see_settings").on("click", "*", () => openSettings());
		processMarketListings();
		initializeMarketHistoryUI();
	}
	var marketListingsRelistedAssets = [];
	function renderPriceCellGrid(listingUI, values) {
		const priceCell = (0, jquery.default)(".market_listing_my_price", listingUI).last();
		const quadrants = [
			{
				label: "Listed",
				value: values.listed,
				cls: "see_grid_lead"
			},
			{
				label: "You get",
				value: values.net,
				cls: ""
			},
			{
				label: "Buy order",
				value: values.buyOrder,
				cls: ""
			},
			{
				label: "vs best",
				value: values.delta || "—",
				cls: ""
			}
		];
		const grid = (0, jquery.default)("<div class=\"see_price_grid\"></div>");
		quadrants.forEach((q) => {
			(0, jquery.default)("<div class=\"see_grid_cell\"></div>").append((0, jquery.default)("<span class=\"see_grid_label\"></span>").text(q.label)).append((0, jquery.default)(`<span class="see_grid_value ${q.cls}"></span>`).text(q.value)).appendTo(grid);
		});
		(0, jquery.default)(".see_price_grid", priceCell).remove();
		priceCell.append(grid);
		(0, jquery.default)(".market_table_value", priceCell).addClass("see_hidden");
	}
	function clearPriceCellGrid(listingUI) {
		const priceCell = (0, jquery.default)(".market_listing_my_price", listingUI).last();
		(0, jquery.default)(".see_price_grid", priceCell).remove();
		(0, jquery.default)(".market_table_value", priceCell).removeClass("see_hidden");
	}
	var marketListingsQueue = runQueue(marketListingsQueueWorker, {
		retryOnFailure: true,
		retryPlacement: "front",
		onTaskDone: () => increaseMarketProgress()
	});
	function marketListingsQueueWorker(listing, ignoreErrors, callback) {
		const asset = steamPage.assetFor(listing.appid, listing.contextid, listing.assetid);
		const market_hash_name = getMarketHashName(asset);
		const appid = listing.appid;
		let listingUI = getListingFromLists(listing.listingid);
		if (listingUI == null) {
			`${listing.listingid}`;
			callback(true, true);
			return;
		}
		listingUI = (0, jquery.default)(listingUI.elm);
		const game_name = asset.type;
		const price = getPriceValueAsInt((0, jquery.default)(".market_listing_price > span:nth-child(1) > span:nth-child(1)", listingUI).text());
		if (price <= getSettingWithDefault("SETTING_PRICE_MIN_CHECK_PRICE") * 100 || listingUI.hasClass("removing")) {
			(0, jquery.default)(".market_listing_my_price", listingUI).last().css("background", COLOR_PRICE_NOT_CHECKED);
			(0, jquery.default)(".market_listing_my_price", listingUI).last().prop("title", "The price is not checked.");
			clearPriceCellGrid(listingUI);
			listingUI.addClass("not_checked");
			return callback(true, true);
		}
		const priceInfo = getPriceInformationFromItem(asset);
		const item = {
			appid: parseInt(appid),
			description: { market_hash_name }
		};
		let failed = 0;
		market.getPriceHistory(item, true, (errorPriceHistory, history, cachedHistory) => {
			if (errorPriceHistory) {
				`${game_name}`;
				if (errorPriceHistory != null) failed += 1;
			}
			market.getOrderBook(item, true, (errorOrderBook, orderbook, cachedListings) => {
				if (errorOrderBook) {
					`${game_name}`;
					if (errorOrderBook != null) failed += 1;
				}
				if (failed > 0 && !ignoreErrors) return callback(false, cachedHistory && cachedListings);
				const highestBuyOrderPrice = orderbook == null || orderbook.highest_buy_order == null ? "-" : formatPrice(orderbook.highest_buy_order);
				JSON.stringify(listing);
				`${game_name}${asset.name}`;
				price / 100;
				const rules = createPricingRules();
				const sellPriceWithoutOffset = calculateSellPriceBeforeFees(history, orderbook, false, priceInfo.minPriceBeforeFees, priceInfo.maxPriceBeforeFees, rules);
				const sellPriceWithOffset = calculateSellPriceBeforeFees(history, orderbook, true, priceInfo.minPriceBeforeFees, priceInfo.maxPriceBeforeFees, rules);
				const sellPriceWithoutOffsetWithFees = market.getPriceIncludingFees(sellPriceWithoutOffset);
				sellPriceWithoutOffsetWithFees / 100, sellPriceWithoutOffset / 100;
				const verdict = getListingVerdict(sellPriceWithoutOffsetWithFees, price);
				const priceDelta = getListingPriceDelta(sellPriceWithoutOffsetWithFees, price);
				listingState.set(listing.listingid, {
					sellPrice: sellPriceWithOffset,
					verdict,
					priceDelta
				});
				listingUI.addClass(verdict);
				(0, jquery.default)(".market_listing_my_price", listingUI).last().prop("title", `The best price is ${formatPrice(sellPriceWithoutOffsetWithFees)}. Relisting would list at ${formatPrice(market.getPriceIncludingFees(sellPriceWithOffset))}.`);
				const steamPrices = (0, jquery.default)(".market_listing_price > span:nth-child(1)", (0, jquery.default)(".market_listing_my_price", listingUI).last());
				renderPriceCellGrid(listingUI, {
					listed: (0, jquery.default)("span:nth-child(1)", steamPrices).text().trim(),
					net: (0, jquery.default)("span:nth-child(3)", steamPrices).text().trim().replace(/[()]/g, ""),
					buyOrder: highestBuyOrderPrice,
					delta: formatPriceDelta(priceDelta)
				});
				(0, jquery.default)(".market_listing_my_price", listingUI).last().css("background", VERDICT_COLORS[verdict]);
				VERDICT_MESSAGES[verdict];
				if (verdict == "overpriced" && getSettingWithDefault("SETTING_RELIST_AUTOMATICALLY") == 1) queueOverpricedItemListing(listing.listingid);
				return callback(true, cachedHistory && cachedListings);
			});
		});
	}
	var marketListingsItemsQueue = runQueue(marketListingsItemsQueueWorker, { onTaskDone: () => increaseMarketProgress() });
	function marketListingsItemsQueueWorker(task, ignoreErrors, callback) {
		request(`${window.location.origin}/market/mylistings`, {
			method: "GET",
			data: {
				count: 100,
				start: task.start
			},
			responseType: "json"
		}, (error, data) => {
			if (error || !data?.success) return callback(false);
			const myMarketListings = (0, jquery.default)("#tabContentsMyActiveMarketListingsRows");
			const nodes = jquery.default.parseHTML(data.results_html);
			const rows = (0, jquery.default)(".market_listing_row", nodes);
			myMarketListings.append(rows);
			steamPage.mergeAssets(data.assets);
			callback(true);
		});
	}
	function fillMarketListingsQueue() {
		(0, jquery.default)(".market_home_listing_table").each(function(e) {
			if ((0, jquery.default)(".my_market_header", (0, jquery.default)(this)).length == 0) return;
			if (!(0, jquery.default)(this).attr("id")) {
				(0, jquery.default)(this).attr("id", `market-listing-${e}`);
				(0, jquery.default)(this).append(`<div class="market_listing_see" id="market-listing-container-${e}"></div>`);
				(0, jquery.default)(".market_listing_row", (0, jquery.default)(this)).appendTo((0, jquery.default)(`#market-listing-container-${e}`));
			} else (0, jquery.default)(this).children().last().addClass("market_listing_see");
			const marketListing = (0, jquery.default)(".market_listing_see", this).last();
			if (marketListing[0].childElementCount > 0) {
				addMarketListings(marketListing);
				sortMarketListings((0, jquery.default)(this), false, false, true);
			}
		});
		let totalSellOrderPriceBuyer = 0;
		let totalSellOrderPriceSeller = 0;
		let totalSellOrderAmount = 0;
		let totalBuyOrderPrice = 0;
		let totalBuyOrderAmount = 0;
		marketLists.flatMap((list) => list.items).forEach((item) => {
			const isBuyOrder = item.elm.id.startsWith("mbuyorder_") || item.elm.id.startsWith("mybuyorder_");
			if (item.elm.id.startsWith("mylisting_")) {
				const listingid = replaceNonNumbers(item.values().market_listing_item_name);
				const assetInfo = getAssetInfoFromListingId(listingid);
				if (assetInfo.appid === void 0) {
					`${listingid}`;
					return;
				}
				totalSellOrderAmount += assetInfo.amount;
				if (!isNaN(assetInfo.priceBuyer)) totalSellOrderPriceBuyer += assetInfo.priceBuyer * assetInfo.amount;
				if (!isNaN(assetInfo.priceSeller)) totalSellOrderPriceSeller += assetInfo.priceSeller * assetInfo.amount;
				marketListingsQueue.push({
					listingid,
					appid: assetInfo.appid,
					contextid: assetInfo.contextid,
					assetid: assetInfo.assetid
				});
				return;
			}
			if (isBuyOrder) {
				const listingid = replaceNonNumbers(item.values().market_listing_item_name);
				const assetInfo = getAssetInfoFromBuyOrderId(listingid);
				if (assetInfo.amount === void 0) {
					`${listingid}`;
					return;
				}
				totalBuyOrderAmount += assetInfo.amount;
				if (!isNaN(assetInfo.price)) totalBuyOrderPrice += assetInfo.price * assetInfo.amount;
				return;
			}
			`${item.elm.id}`;
		});
		if (totalSellOrderAmount > 0) increaseMarketProgressMax();
		(0, jquery.default)("#my_market_selllistings_number").append(`<span id="my_market_sell_listings_total_amount"> [${totalSellOrderAmount}]</span>`).append(`<span id="my_market_sell_listings_total_price">, Listed ${formatPrice(totalSellOrderPriceBuyer)} · You get ${formatPrice(totalSellOrderPriceSeller)}</span>`);
		(0, jquery.default)("#my_market_buylistings_number").append(`<span id="my_market_buy_listings_total_amount"> [${totalBuyOrderAmount}]</span>`).append(`<span id="my_market_buy_listings_total_price">, ${formatPrice(totalBuyOrderPrice)}</span>`);
	}
	function addMarketListings(market_listing_see) {
		market_listing_see.addClass("list");
		(0, jquery.default)(".market_listing_table_header", market_listing_see.parent()).append("<input class=\"search\" id=\"market_name_search\" placeholder=\"Search...\" />");
		const options = { valueNames: [
			"market_listing_game_name",
			"market_listing_item_name_link",
			"market_listing_price",
			"market_listing_listed_date",
			{
				name: "market_listing_item_name",
				attr: "id"
			}
		] };
		try {
			const list = new list_js.default(market_listing_see.parent().get(0), options);
			list.on("searchComplete", updateMarketSelectAllButton);
			list.on("searchComplete", refreshMarketOverpricedButtons);
			marketLists.push(list);
		} catch (e) {
			console.error(e);
		}
	}
	function addMarketCheckboxes() {
		(0, jquery.default)(".market_listing_row").each(function() {
			if ((0, jquery.default)(".market_listing_select", this).length == 0) {
				(0, jquery.default)(".market_listing_cancel_button", (0, jquery.default)(this)).append("<div class=\"market_listing_select\"><input type=\"checkbox\" class=\"market_select_item\"/></div>");
				(0, jquery.default)(".market_select_item", this).change(() => {
					updateMarketSelectAllButton();
				});
			}
		});
	}
	function processMarketListings() {
		addMarketCheckboxes();
		if (currentPage == 0) {
			let currentCount = 0;
			let totalCount = 0;
			const myListingsTotalCount = steamPage.myListingsTotalCount();
			if (myListingsTotalCount != null) totalCount = myListingsTotalCount;
			else totalCount = parseInt((0, jquery.default)("#my_market_selllistings_number").text());
			if (isNaN(totalCount) || totalCount == 0) {
				fillMarketListingsQueue();
				return;
			}
			(0, jquery.default)("#tabContentsMyActiveMarketListingsRows").html("");
			(0, jquery.default)("#tabContentsMyActiveMarketListingsRows").hide();
			(0, jquery.default)("#tabContentsMyActiveMarketListings_ctn").hide();
			(0, jquery.default)(".market_pagesize_options").hide();
			renderSpinner("Loading market listings");
			while (currentCount < totalCount) {
				marketListingsItemsQueue.push({ start: currentCount });
				increaseMarketProgressMax();
				currentCount += 100;
			}
		} else {
			(0, jquery.default)(".market_home_listing_table").each(function() {
				if ((0, jquery.default)("#market_buyorder_info_show_details", (0, jquery.default)(this)).length > 0) return;
				(0, jquery.default)(this).children().last().wrap("<div class=\"market_listing_see\"></div>");
				const marketListing = (0, jquery.default)(".market_listing_see", this).last();
				const container = (0, jquery.default)(".market_listing_row", marketListing)?.parent();
				if (marketListing[0]?.childElementCount > 0 && container != null && container.length > 0) {
					addMarketListings(container);
					sortMarketListings((0, jquery.default)(this), false, false, true);
				}
			});
			(0, jquery.default)("#tabContentsMyActiveMarketListingsRows > .market_listing_row").each(function() {
				const listingid = (0, jquery.default)(this).attr("id").replace("mylisting_", "").replace("mybuyorder_", "").replace("mbuyorder_", "");
				const assetInfo = getAssetInfoFromListingId(listingid);
				const existingAsset = steamPage.firstAsset();
				steamPage.setAsset(assetInfo.appid, assetInfo.contextid, assetInfo.assetid, existingAsset);
				marketListingsQueue.push({
					listingid,
					appid: assetInfo.appid,
					contextid: assetInfo.contextid,
					assetid: assetInfo.assetid
				});
				increaseMarketProgressMax();
			});
		}
	}
	async function loadAllInventories() {
		const main = getActiveInventory();
		const childs = Object.values(main.m_rgChildInventories);
		for (const inventory of [...childs, main]) await new Promise((resolve) => inventory.LoadCompleteInventory().done(resolve));
	}
	function getInventoryItems() {
		return readInventoryItems(getActiveInventory(), "m_rgChildInventories", "m_rgAssets");
	}
	function getActiveInventory() {
		return steamPage.activeInventory();
	}
	function setInventoryPrices(items) {
		inventoryPriceQueue.kill();
		items.forEach((item) => {
			if (!item.marketable) return;
			if (!(0, jquery.default)(item.element).is(":visible")) return;
			inventoryPriceQueue.push(item);
		});
	}
	var inventoryPriceQueue = runQueue(inventoryPriceQueueWorker, { retryOnFailure: true });
	function inventoryPriceQueueWorker(item, ignoreErrors, callback) {
		let failed = 0;
		const itemName = item.name || item.description.name;
		market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
			if (err) {
				`${itemName}`;
				if (err != null) failed += 1;
			}
			if (failed > 0 && !ignoreErrors) return callback(false, cachedListings);
			const sellPrice = calculateSellPriceBeforeFees(null, orderbook, false, 0, NO_LISTING_PRICE_SENTINEL, createPricingRules());
			const priceWithFees = sellPrice == 65535 ? 0 : market.getPriceIncludingFees(sellPrice);
			const itemPrice = sellPrice == 65535 ? "∞" : formatPrice(priceWithFees);
			listingState.set(getAssetKey(item), { sellPrice: priceWithFees });
			const elementName = `${currentPage == 2 ? "#item" : "#"}${getAssetKey(item)}`;
			const element = (0, jquery.default)(elementName);
			(0, jquery.default)(".inventory_item_price", element).remove();
			element.append(`<span class="inventory_item_price">${itemPrice}</span>`);
			return callback(true, cachedListings);
		});
	}
	function aggregateTradeOfferAssets(assets, resolve) {
		const counts = new Map();
		let totalPrice = 0;
		for (let i = 0; i < assets.length; i++) {
			const item = resolve(assets[i]);
			const text = getTradeOfferAssetText(item);
			counts.set(text, (counts.get(text) || 0) + 1);
			if (item != null && item.price > 0) totalPrice += item.price;
		}
		const items = [];
		counts.forEach((count, text) => {
			items.push({
				text,
				count
			});
		});
		return {
			items,
			totalPrice
		};
	}
	function getTradeOfferAssetText(item) {
		if (item == null) return "Unknown Item";
		let text = "";
		if (item.originalAmount != null && item.amount != null) {
			const usedAmount = parseInt(item.originalAmount) - parseInt(item.amount);
			text += `${usedAmount.toString()}x `;
		}
		text += item.name;
		if (item.type != null && item.type.length > 0) text += ` (${item.type})`;
		return text;
	}
	function getTradeOfferInventoryItems() {
		return readInventoryItems(getActiveInventory(), "rgChildInventories", "rgInventory");
	}
	function sumTradeOfferAssets(side) {
		const summary = aggregateTradeOfferAssets(steamPage.tradeAssets(side), (asset) => {
			const rgItem = steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid);
			if (rgItem == null) return null;
			const state = listingState.get(getAssetKey(rgItem));
			return {
				name: rgItem.name,
				type: rgItem.type,
				originalAmount: rgItem.original_amount,
				amount: rgItem.amount,
				price: state == null ? 0 : state.sellPrice
			};
		});
		const sortable = summary.items.map((item) => [item.text, item.count]);
		sortable.sort((a, b) => {
			return a[1] - b[1];
		}).reverse();
		let totalText = `<strong>Number of unique items: ${sortable.length}, worth ${formatPrice(summary.totalPrice)}<br/><br/></strong>`;
		let totalNumOfItems = 0;
		for (let i = 0; i < sortable.length; i++) {
			totalText += `${sortable[i][1]}x ${sortable[i][0]}<br/>`;
			totalNumOfItems += sortable[i][1];
		}
		totalText += `<br/><strong>Total items: ${totalNumOfItems}</strong><br/>`;
		return totalText;
	}
	var lastTradeOfferSum = 0;
	var TRADE_SIDES = ["them", "me"];
	function tradeItemsFor(side) {
		return steamPage.tradeAssets(side).map((asset) => steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid));
	}
	function hasLoadedAllTradeOfferItems() {
		return TRADE_SIDES.every((side) => tradeItemsFor(side).every((asset) => asset != null));
	}
	function initializeTradeOfferUI() {
		if (getSettingWithDefault("SETTING_TRADEOFFER_PRICE_LABELS") == 1) {
			const updateInventoryPrices = function() {
				setInventoryPrices(getTradeOfferInventoryItems());
			};
			const updateInventoryPricesInTrade = function() {
				setInventoryPrices(TRADE_SIDES.flatMap((side) => tradeItemsFor(side)));
			};
			(0, jquery.default)(".trade_right > div > div > div > .trade_item_box").observe("childlist subtree", () => {
				if (!hasLoadedAllTradeOfferItems()) return;
				const currentTradeOfferSum = TRADE_SIDES.reduce((total, side) => total + steamPage.tradeAssets(side).length, 0);
				if (lastTradeOfferSum != currentTradeOfferSum) updateInventoryPricesInTrade();
				lastTradeOfferSum = currentTradeOfferSum;
				(0, jquery.default)("#trade_offer_your_sum").remove();
				(0, jquery.default)("#trade_offer_their_sum").remove();
				const your_sum = sumTradeOfferAssets("me");
				const their_sum = sumTradeOfferAssets("them");
				(0, jquery.default)("div.offerheader:nth-child(1) > div:nth-child(3)").append(`<div class="trade_offer_sum" id="trade_offer_your_sum">${your_sum}</div>`);
				(0, jquery.default)("div.offerheader:nth-child(3) > div:nth-child(3)").append(`<div class="trade_offer_sum" id="trade_offer_their_sum">${their_sum}</div>`);
			});
			updateInventoryPrices();
			(0, jquery.default)("#pagecontrol_cur").observe("childlist", () => {
				updateInventoryPrices();
			});
		}
		const appendSelectPageButton = () => {
			(0, jquery.default)("#inventory_displaycontrols").append(`<div class="trade_offer_buttons">
          <a class="item_market_action_button item_market_action_button_green select_all">
              <span class="item_market_action_button_contents" style="text-transform:none">Select all from page</span>
          </a>
      </div>`);
			(0, jquery.default)(".select_all").on("click", "*", () => {
				(0, jquery.default)(".inventory_ctn:visible > .inventory_page:visible > .itemHolder:visible").delayedEach(250, (i, it) => {
					const item = it.rgItem;
					if (item.is_stackable) return;
					if (!item.tradable) return;
					steamPage.moveItemToTrade(it);
				});
			});
		};
		if (location.pathname !== "/tradeoffer/new/" && location.pathname !== "/tradeoffer/new") (0, jquery.default)(".modify_trade_offer").one("click", "*", () => {
			appendSelectPageButton();
		});
		else appendSelectPageButton();
	}
	var totals = {
		processedQueueItems: 0,
		queuedItems: 0,
		priceWithFeesOnMarket: 0,
		priceWithoutFeesOnMarket: 0,
		scrap: 0
	};
	function getSelectedItems() {
		const ids = [];
		(0, jquery.default)(".inventory_ctn").each(function() {
			(0, jquery.default)(this).find(".inventory_page").each(function() {
				const inventory_page = this;
				(0, jquery.default)(inventory_page).find(".itemHolder.ui-selected:not([style*=none])").each(function() {
					(0, jquery.default)(this).find(".item").each(function() {
						const matches = this.id.match(/_(-?\d+)$/);
						if (matches) ids.push(matches[1]);
					});
				});
			});
		});
		return ids;
	}
	function getInventorySelectedMarketableItems(callback) {
		const ids = getSelectedItems();
		loadAllInventories().then(() => {
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				if (!item.marketable) return;
				const itemId = item.assetid || item.id;
				if (ids.indexOf(itemId) !== -1) filteredItems.push(item);
			});
			callback(filteredItems);
		});
	}
	function getInventorySelectedGemsItems(callback) {
		const ids = getSelectedItems();
		loadAllInventories().then(() => {
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				let canTurnIntoGems = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("GetGooValue")) canTurnIntoGems = true;
				if (!canTurnIntoGems) return;
				const itemId = item.assetid || item.id;
				if (ids.indexOf(itemId) !== -1) filteredItems.push(item);
			});
			callback(filteredItems);
		});
	}
	function getInventorySelectedBoosterPackItems(callback) {
		const ids = getSelectedItems();
		loadAllInventories().then(() => {
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				let canOpenBooster = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("OpenBooster")) canOpenBooster = true;
				if (!canOpenBooster) return;
				const itemId = item.assetid || item.id;
				if (ids.indexOf(itemId) !== -1) filteredItems.push(item);
			});
			callback(filteredItems);
		});
	}
	function selectAllCards() {
		const cardIds = new Set(getInventoryItems().filter((item) => item.marketable && getIsTradingCard(item)).map((item) => item.assetid || item.id));
		(0, jquery.default)(".itemHolder.ui-selected").each(function() {
			this.classList.remove("ui-selected");
		});
		(0, jquery.default)(".inventory_ctn").each(function() {
			(0, jquery.default)(this).find(".inventory_page:not([style*=none])").each(function() {
				(0, jquery.default)(this).find(".itemHolder:not([style*=none])").each(function() {
					const itemHolder = this;
					(0, jquery.default)(itemHolder).find(".item").each(function() {
						const matches = this.id.match(/_(-?\d+)$/);
						if (matches && cardIds.has(matches[1])) itemHolder.classList.add("ui-selected");
					});
				});
			});
		});
	}
	var boosterQueue = runQueue(boosterQueueWorker, { successDelayMs: 250 });
	function boosterQueueWorker(item, ignoreErrors, callback) {
		const itemName = item.name || item.description.name;
		const itemId = item.assetid || item.id;
		market.unpackBoosterPack(item, (err) => {
			totals.processedQueueItems++;
			const digits = getNumberOfDigits(totals.queuedItems);
			const padLeft = `${padLeftZero(`${totals.processedQueueItems}`, digits)} / ${totals.queuedItems}`;
			if (err != null) {
				`${itemName}`;
				logDOM(`${padLeft} - ${itemName} not unpacked.`);
				markRow(`${item.appid}_${item.contextid}_${itemId}`, "error");
				return callback(false);
			}
			logDOM(`${padLeft} - ${itemName} unpacked.`);
			markRow(`${item.appid}_${item.contextid}_${itemId}`, "success");
			callback(true);
		});
	}
	function unpackAllBoosterPacks() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			let numberOfQueuedItems = 0;
			items.forEach((item) => {
				if (isItemQueued(item) || item.owner_actions == null) return;
				let canOpenBooster = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("OpenBooster")) canOpenBooster = true;
				if (!canOpenBooster) return;
				markItemQueued(item);
				boosterQueue.push(item);
				numberOfQueuedItems++;
			});
			if (numberOfQueuedItems === 0) {
				logDOM("No booster packs found in the inventory to unpack.");
				return;
			}
			totals.queuedItems += numberOfQueuedItems;
			renderSpinner(`Processing ${numberOfQueuedItems} items`);
		});
	}
	function unpackSelectedBoosterPacks() {
		const ids = getSelectedItems();
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			let numberOfQueuedItems = 0;
			items.forEach((item) => {
				if (isItemQueued(item) || item.owner_actions == null) return;
				let canOpenBooster = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("OpenBooster")) canOpenBooster = true;
				if (!canOpenBooster) return;
				const itemId = item.assetid || item.id;
				if (ids.indexOf(itemId) !== -1) {
					markItemQueued(item);
					boosterQueue.push(item);
					numberOfQueuedItems++;
				}
			});
			if (numberOfQueuedItems > 0) {
				totals.queuedItems += numberOfQueuedItems;
				renderSpinner(`Processing ${numberOfQueuedItems} items`);
			}
		});
	}
	var sellQueue = async.default.queue((task, next) => {
		totals.processedQueueItems++;
		const digits = getNumberOfDigits(totals.queuedItems);
		const itemId = task.item.assetid || task.item.id;
		const itemName = task.item.name || task.item.description.name;
		const itemNameWithAmount = task.item.amount == 1 ? itemName : `${task.item.amount}x ${itemName}`;
		const padLeft = `${padLeftZero(`${totals.processedQueueItems}`, digits)} / ${totals.queuedItems}`;
		if (getSettingWithDefault("SETTING_PRICE_MIN_LIST_PRICE") * 100 >= market.getPriceIncludingFees(task.sellPrice)) {
			logDOM(`${padLeft} - ${itemNameWithAmount} is not listed due to ignoring price settings.`);
			markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, "notChecked");
			next();
			return;
		}
		market.sellItem(task.item, task.sellPrice, (error, data) => {
			const success = error === null;
			const message = data?.message || "";
			const callback = () => setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
			if (success) {
				logDOM(`${padLeft} - ${itemNameWithAmount} listed for ${formatPrice(market.getPriceIncludingFees(task.sellPrice) * task.item.amount)}, you will receive ${formatPrice(task.sellPrice * task.item.amount)}.`);
				markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, "success");
				totals.priceWithoutFeesOnMarket += task.sellPrice * task.item.amount;
				totals.priceWithFeesOnMarket += market.getPriceIncludingFees(task.sellPrice) * task.item.amount;
				updateTotals();
				callback();
				return;
			}
			if (message && isRetryMessage(message)) {
				logDOM(`${padLeft} - ${itemNameWithAmount} retrying listing because: ${message.charAt(0).toLowerCase()}${message.slice(1)}`);
				totals.processedQueueItems--;
				sellQueue.unshift(task);
				sellQueue.pause();
				setTimeout(() => sellQueue.resume(), getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX));
				callback();
				return;
			}
			logDOM(`${padLeft} - ${itemNameWithAmount} not added to market${message ? ` because:  ${message.charAt(0).toLowerCase()}${message.slice(1)}` : "."}`);
			markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, "error");
			callback();
		});
	}, 1);
	function sellAllItems() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				if (!item.marketable) return;
				filteredItems.push(item);
			});
			sellItems(filteredItems);
		});
	}
	function sellAllDuplicateItems() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			const marketableItems = [];
			let filteredItems = [];
			items.forEach((item) => {
				if (!item.marketable) return;
				marketableItems.push(item);
			});
			filteredItems = marketableItems.filter((e, i) => marketableItems.map((m) => m.classid).indexOf(e.classid) !== i);
			sellItems(filteredItems);
		});
	}
	function sellAllCards() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				if (!getIsTradingCard(item) || !item.marketable) return;
				filteredItems.push(item);
			});
			sellItems(filteredItems);
		});
	}
	function sellAllCrates() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			const filteredItems = [];
			items.forEach((item) => {
				if (!getIsCrate(item) || !item.marketable) return;
				filteredItems.push(item);
			});
			sellItems(filteredItems);
		});
	}
	function sellSelectedItems() {
		getInventorySelectedMarketableItems((items) => {
			sellItems(items);
		});
	}
	function canSellSelectedItemsManually(items) {
		const contextid = items[0].contextid;
		let hasInvalidItem = false;
		items.forEach((item) => {
			if (item.contextid != contextid || item.commodity == false) hasInvalidItem = true;
		});
		return !hasInvalidItem;
	}
	function sellSelectedItemsManually() {
		getInventorySelectedMarketableItems((items) => {
			const appid = items[0].appid;
			const contextid = items[0].contextid;
			const itemsWithQty = {};
			items.forEach((item) => {
				itemsWithQty[item.market_hash_name] = itemsWithQty[item.market_hash_name] + 1 || 1;
			});
			let itemsString = "";
			for (const itemName in itemsWithQty) itemsString += `&items[]=${encodeURIComponent(itemName)}&qty[]=${itemsWithQty[itemName]}`;
			const redirectUrl = `${`${window.location.origin}/market/multisell`}?appid=${appid}&contextid=${contextid}${itemsString}`;
			steamPage.showDialog("Steam Economy Enhancer", `<iframe frameBorder="0" height="650" width="900" src="${redirectUrl}"></iframe>`).OnDismiss(() => {
				items.forEach((item) => {
					const itemId = item.assetid || item.id;
					markRow(`${item.appid}_${item.contextid}_${itemId}`, "pending");
				});
			});
		});
	}
	function sellItems(items) {
		if (items.length == 0) {
			logDOM("These items cannot be added to the market...");
			return;
		}
		let numberOfQueuedItems = 0;
		items.forEach((item) => {
			if (isItemQueued(item)) return;
			markItemQueued(item);
			itemQueue.push(item);
			numberOfQueuedItems++;
		});
		if (numberOfQueuedItems > 0) {
			totals.queuedItems += numberOfQueuedItems;
			renderSpinner(`Processing ${numberOfQueuedItems} items`);
		}
	}
	var itemQueue = runQueue(itemQueueWorker, { retryOnFailure: true });
	function itemQueueWorker(item, ignoreErrors, callback) {
		const priceInfo = getPriceInformationFromItem(item);
		let failed = 0;
		const itemName = item.name || item.description.name;
		market.getPriceHistory(item, true, (err, history, cachedHistory) => {
			if (err) {
				`${itemName}`;
				if (err != null) failed += 1;
			}
			market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
				if (err) {
					`${itemName}`;
					if (err != null) failed += 1;
				}
				if (failed > 0 && !ignoreErrors) return callback(false, cachedHistory && cachedListings);
				const sellPrice = calculateSellPriceBeforeFees(history, orderbook, true, priceInfo.minPriceBeforeFees, priceInfo.maxPriceBeforeFees, createPricingRules());
				sellPrice / 100, market.getPriceIncludingFees(sellPrice) / 100;
				sellQueue.push({
					item,
					sellPrice
				});
				return callback(true, cachedHistory && cachedListings);
			});
		});
	}
	function onQueueDrain() {
		if (itemQueue.length() == 0 && sellQueue.length() == 0 && scrapQueue.length() == 0 && boosterQueue.length() == 0) removeSpinner();
	}
	function updateTotals() {
		if ((0, jquery.default)("#loggerTotal").length == 0) (0, jquery.default)(logger).parent().append("<div id=\"loggerTotal\"></div>");
		const totalsElement = document.getElementById("loggerTotal");
		totalsElement.innerHTML = "";
		if (totals.priceWithFeesOnMarket > 0) totalsElement.innerHTML += `<div><strong>Total listed for ${formatPrice(totals.priceWithFeesOnMarket)}, you will receive ${formatPrice(totals.priceWithoutFeesOnMarket)}.</strong></div>`;
		if (totals.scrap > 0) totalsElement.innerHTML += `<div><strong>Total scrap ${totals.scrap}.</strong></div>`;
	}
	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	function gemAllDuplicateItems() {
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			let filteredItems = [];
			let numberOfQueuedItems = 0;
			filteredItems = items.filter((e, i) => items.map((m) => m.classid).indexOf(e.classid) !== i);
			filteredItems.forEach((item) => {
				if (isItemQueued(item)) return;
				if (item.owner_actions == null) return;
				let canTurnIntoGems = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("GetGooValue")) canTurnIntoGems = true;
				if (!canTurnIntoGems) return;
				markItemQueued(item);
				scrapQueue.push(item);
				numberOfQueuedItems++;
			});
			if (numberOfQueuedItems > 0) {
				totals.queuedItems += numberOfQueuedItems;
				renderSpinner(`Processing ${numberOfQueuedItems} items`);
			}
		});
	}
	var scrapQueue = runQueue(scrapQueueWorker, { successDelayMs: 250 });
	function scrapQueueWorker(item, ignoreErrors, callback) {
		const itemName = item.name || item.description.name;
		const itemId = item.assetid || item.id;
		market.getGooValue(item, (err, goo) => {
			totals.processedQueueItems++;
			const digits = getNumberOfDigits(totals.queuedItems);
			const padLeft = `${padLeftZero(`${totals.processedQueueItems}`, digits)} / ${totals.queuedItems}`;
			if (err != null) {
				`${itemName}`;
				logDOM(`${padLeft} - ${itemName} not turned into gems due to missing gems value.`);
				markRow(`${item.appid}_${item.contextid}_${itemId}`, "error");
				return callback(false);
			}
			const gooValueExpected = parseInt(goo.goo_value, 10);
			market.grindIntoGoo(item, gooValueExpected, (err) => {
				if (err != null) {
					`${itemName}`;
					logDOM(`${padLeft} - ${itemName} not turned into gems due to unknown error.`);
					markRow(`${item.appid}_${item.contextid}_${itemId}`, "error");
					return callback(false);
				}
				`${goo.goo_value}`;
				logDOM(`${padLeft} - ${itemName} turned into ${gooValueExpected} gems.`);
				markRow(`${item.appid}_${item.contextid}_${itemId}`, "success");
				totals.scrap += gooValueExpected;
				updateTotals();
				callback(true);
			});
		});
	}
	function turnSelectedItemsIntoGems() {
		const ids = getSelectedItems();
		renderSpinner("Loading inventory items");
		loadAllInventories().then(() => {
			removeSpinner();
			const items = getInventoryItems();
			let numberOfQueuedItems = 0;
			items.forEach((item) => {
				if (isItemQueued(item)) return;
				if (item.owner_actions == null) return;
				let canTurnIntoGems = false;
				for (const owner_action in item.owner_actions) if (item.owner_actions[owner_action].link != null && item.owner_actions[owner_action].link.includes("GetGooValue")) canTurnIntoGems = true;
				if (!canTurnIntoGems) return;
				const itemId = item.assetid || item.id;
				if (ids.indexOf(itemId) !== -1) {
					markItemQueued(item);
					scrapQueue.push(item);
					numberOfQueuedItems++;
				}
			});
			if (numberOfQueuedItems > 0) {
				totals.queuedItems += numberOfQueuedItems;
				renderSpinner(`Processing ${numberOfQueuedItems} items`);
			}
		});
	}
	function initializeInventoryUI() {
		const isOwnInventory = steamPage.activeUser().strSteamId == steamPage.steamId();
		updateInventoryUI(isOwnInventory);
		(0, jquery.default)(".games_list_tabs").on("click", "*", () => {
			updateInventoryUI(isOwnInventory);
		});
		if (!isOwnInventory) return;
		initializeInventorySelection();
		steamPage.onInventorySelectItem((rgItem) => {
			updateButtons();
			updateInventorySelection(flattenItem(rgItem, rgItem.assetid || rgItem.id));
		});
	}
	function initializeInventorySelection() {
		const filter = ".itemHolder:not([style*=none])";
		const inventories = (0, jquery.default)("#inventories");
		let anchor = null;
		inventories.on("mousedown", filter, (event) => {
			event.preventDefault();
		});
		inventories.on("click", filter, function(event) {
			const items = inventories.find(filter).toArray();
			const anchored = anchor !== null && items.includes(anchor);
			const select = (element) => element.classList.add("ui-selected");
			const clear = () => items.forEach((item) => item.classList.remove("ui-selected"));
			if (event.shiftKey && anchored) {
				const from = items.indexOf(anchor);
				const to = items.indexOf(this);
				clear();
				items.slice(Math.min(from, to), 1 + Math.max(from, to)).forEach(select);
			} else if (event.ctrlKey || event.metaKey) {
				this.classList.toggle("ui-selected");
				anchor = this;
			} else {
				clear();
				select(this);
				anchor = this;
			}
			updateButtons();
		});
	}
	function updateSellSelectedButton() {
		getInventorySelectedMarketableItems((items) => {
			const selectedItems = items.length;
			if (items.length == 0) {
				(0, jquery.default)(".sell_selected").hide();
				(0, jquery.default)(".sell_manual").hide();
			} else {
				(0, jquery.default)(".sell_selected").show();
				if (canSellSelectedItemsManually(items)) {
					(0, jquery.default)(".sell_manual").show();
					(0, jquery.default)(".sell_manual > span").text(`Sell ${selectedItems}${selectedItems == 1 ? " Item Manual" : " Items Manual"}`);
				} else (0, jquery.default)(".sell_manual").hide();
				(0, jquery.default)(".sell_selected > span").text(`Sell ${selectedItems}${selectedItems == 1 ? " Item" : " Items"}`);
			}
		});
	}
	function updateTurnIntoGemsButton() {
		getInventorySelectedGemsItems((items) => {
			const selectedItems = items.length;
			if (items.length == 0) (0, jquery.default)(".turn_into_gems").hide();
			else {
				(0, jquery.default)(".turn_into_gems").show();
				(0, jquery.default)(".turn_into_gems > span").text(`Turn ${selectedItems}${selectedItems == 1 ? " Item Into Gems" : " Items Into Gems"}`);
			}
		});
	}
	function updateOpenBoosterPacksButton() {
		getInventorySelectedBoosterPackItems((items) => {
			const selectedItems = items.length;
			if (items.length == 0) (0, jquery.default)(".unpack_selected_booster_packs").hide();
			else {
				(0, jquery.default)(".unpack_selected_booster_packs").show();
				(0, jquery.default)(".unpack_selected_booster_packs > span").text(`Unpack ${selectedItems}${selectedItems == 1 ? " Booster Pack" : " Booster Packs"}`);
			}
		});
	}
	function updateButtons() {
		updateSellSelectedButton();
		updateTurnIntoGemsButton();
		updateOpenBoosterPacksButton();
	}
	async function updateInventorySelection(selectedItem) {
		if (getSettingWithDefault("SETTING_QUICK_SELL_BUTTONS") != 1) return;
		const item_info = (0, jquery.default)(`#iteminfo${steamPage.activeSelectView()}`);
		if (!item_info.length) return;
		if (item_info.html().indexOf("checkout/sendgift/") > -1) return;
		let timeDelayed = 0;
		while (timeDelayed < 2500 && item_info.find("a[href^=\"https://steamcommunity.com/market/listings/\"]").length == 0) {
			await delay(100);
			timeDelayed += 100;
		}
		const market_hash_name = getMarketHashName(selectedItem);
		if (market_hash_name == null) return;
		const appid = selectedItem.appid;
		const item = {
			appid: parseInt(appid),
			description: { market_hash_name }
		};
		if (selectedItem.name.toLowerCase().endsWith("booster pack")) {
			const tradingCardsUrl = `/market/search?q=&category_753_Game%5B%5D=tag_app_${selectedItem.market_fee_app}&category_753_item_class%5B%5D=tag_item_class_2&appid=753`;
			const communityHeader = (0, jquery.default)("h1", item_info).next().find("span").eq(0);
			communityHeader.replaceWith(`<a href="${tradingCardsUrl}"><span>${communityHeader.text()}</span></a>`);
		}
		if (!selectedItem.marketable) return;
		if (isItemQueued(selectedItem)) return;
		const marketLink = `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(market_hash_name)}`;
		const baseLink = (0, jquery.default)(`a[href^="${marketLink}"]`, item_info);
		const ownerActions = baseLink.parent().parent();
		market.getOrderBook(item, false, (err, orderbook) => {
			if (err) {
				`${selectedItem.name || selectedItem.description.name}`;
				return;
			}
			if (isItemQueued(selectedItem)) return;
			const sellRows = (orderbook.sell_order_graph || []).slice(0, 10).map(([price, qty]) => `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`).join("");
			const buyRows = (orderbook.buy_order_graph || []).slice(0, 10).map(([price, qty]) => `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`).join("");
			const groupMain = (0, jquery.default)(`<div id="listings_group">
                <div>
                    <div id="listings_sell">Sell</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${sellRows}</table>
                </div>
                <div>
                    <div id="listings_buy">Buy</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${buyRows}</table>
                </div>
            </div>`);
			baseLink.next().append(groupMain);
			let prices = [];
			if (orderbook != null && orderbook.highest_buy_order != null) prices.push(parseInt(orderbook.highest_buy_order));
			if (orderbook != null && orderbook.lowest_sell_order != null) {
				if (parseInt(orderbook.lowest_sell_order) > 3) prices.push(parseInt(orderbook.lowest_sell_order) - 1);
				prices.push(parseInt(orderbook.lowest_sell_order));
			}
			prices = prices.filter((v, i) => prices.indexOf(v) === i).sort((a, b) => a - b);
			let buttons = "<div id=\"price_buttons\">";
			prices.forEach((e) => {
				buttons += `<a class="item_market_action_button item_market_action_button_green quick_sell" id="quick_sell${e}">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">${formatPrice(e)}</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>`;
			});
			buttons += "</div>";
			ownerActions.append(buttons);
			ownerActions.append(`<div id="sell_button" style="display:flex">
                <input id="quick_sell_input" style="background-color: black;color: white;border: transparent;max-width:65px;text-align:center;" type="number" value="${((orderbook.lowest_sell_order || 0) / 100).toFixed(2)}" step="0.01" />&nbsp;
                <a class="item_market_action_button item_market_action_button_green quick_sell_custom">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">➜ Sell</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>
            </div>`);
			(0, jquery.default)(".quick_sell").on("click", function() {
				let price = (0, jquery.default)(this).attr("id").replace("quick_sell", "");
				price = market.getPriceBeforeFees(price);
				totals.queuedItems++;
				sellQueue.push({
					item: selectedItem,
					sellPrice: price
				});
			});
			(0, jquery.default)(".quick_sell_custom").on("click", () => {
				let price = Number((0, jquery.default)("#quick_sell_input", ownerActions).val()) * 100;
				price = market.getPriceBeforeFees(price);
				totals.queuedItems++;
				sellQueue.push({
					item: selectedItem,
					sellPrice: price
				});
			});
		});
	}
	function updateInventoryUI(isOwnInventory) {
		(0, jquery.default)("#inventory_sell_buttons").remove();
		(0, jquery.default)("#see_settings_modal").remove();
		(0, jquery.default)("#inventory_reload_button").remove();
		(0, jquery.default)("#see_settings").remove();
		(0, jquery.default)("#global_action_menu").prepend("<span id=\"see_settings\"><a href=\"javascript:void(0)\">⬖ Steam Economy Enhancer</a></span>");
		(0, jquery.default)("#see_settings").on("click", "*", () => openSettings());
		const appId = getActiveInventory().m_appid;
		const showMiscOptions = appId == 753;
		const TF2 = appId == 440;
		let buttonsHtml = `
        <a class="btn_green_white_innerfade btn_medium_wide sell_all"><span>Sell All Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_all_duplicates"><span>Sell All Duplicate Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_selected" style="display:none"><span>Sell Selected Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_manual" style="display:none"><span>Sell Manually</span></a>
    `;
		if (showMiscOptions) buttonsHtml += `
            <a class="btn_green_white_innerfade btn_medium_wide sell_all_cards"><span>Sell All Cards</span></a>
            <a class="btn_darkblue_white_innerfade btn_medium_wide select_all_cards"><span>Select All Cards</span></a>
            <div class="see_inventory_buttons">
                <a class="btn_darkblue_white_innerfade btn_medium_wide turn_into_gems" style="display:none"><span>Turn Selected Items Into Gems</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_all_booster_packs"><span>Unpack All Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_selected_booster_packs" style="display:none"><span>Unpack Selected Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide gem_all_duplicates"><span>Turn All Duplicate Items Into Gems</span></a>
            </div>
        `;
		else if (TF2) buttonsHtml += "<a class=\"btn_green_white_innerfade btn_medium_wide sell_all_crates\"><span>Sell All Crates</span></a>";
		const sellButtons = (0, jquery.default)(`<div id="inventory_sell_buttons" class="see_inventory_buttons">${buttonsHtml}</div>`);
		const reloadButton = (0, jquery.default)("<a id=\"inventory_reload_button\" class=\"btn_darkblue_white_innerfade btn_medium_wide reload_inventory\" style=\"margin-right:12px\"><span>Reload Inventory</span></a>");
		const logo = (0, jquery.default)("#inventory_logos")[0];
		logo.style.height = "auto";
		logo.style.maxHeight = "unset";
		(0, jquery.default)("#inventory_applogo").hide();
		(0, jquery.default)("#inventory_applogo").after(logger);
		(0, jquery.default)("#logger").on("scroll", () => {
			setUserScrolled(!((0, jquery.default)("#logger").prop("scrollHeight") - (0, jquery.default)("#logger").prop("clientHeight") <= (0, jquery.default)("#logger").prop("scrollTop") + 1));
		});
		if (isOwnInventory) {
			(0, jquery.default)("#inventory_applogo").after(sellButtons);
			(0, jquery.default)(".sell_all").on("click", "*", () => {
				sellAllItems();
			});
			(0, jquery.default)(".sell_selected").on("click", "*", sellSelectedItems);
			(0, jquery.default)(".sell_all_duplicates").on("click", "*", sellAllDuplicateItems);
			(0, jquery.default)(".gem_all_duplicates").on("click", "*", gemAllDuplicateItems);
			(0, jquery.default)(".sell_manual").on("click", "*", sellSelectedItemsManually);
			(0, jquery.default)(".sell_all_cards").on("click", "*", sellAllCards);
			(0, jquery.default)(".select_all_cards").on("click", "*", () => {
				selectAllCards();
				updateButtons();
			});
			(0, jquery.default)(".sell_all_crates").on("click", "*", sellAllCrates);
			(0, jquery.default)(".turn_into_gems").on("click", "*", turnSelectedItemsIntoGems);
			(0, jquery.default)(".unpack_all_booster_packs").on("click", "*", unpackAllBoosterPacks);
			(0, jquery.default)(".unpack_selected_booster_packs").on("click", "*", unpackSelectedBoosterPacks);
		}
		(0, jquery.default)(".inventory_rightnav").prepend(reloadButton);
		(0, jquery.default)(".reload_inventory").on("click", "*", () => {
			window.location.reload();
		});
		loadAllInventories().then(() => {
			const updateInventoryPrices = function() {
				if (getSettingWithDefault("SETTING_INVENTORY_PRICE_LABELS") == 1) setInventoryPrices(getInventoryItems());
			};
			updateInventoryPrices();
			(0, jquery.default)("#pagecontrol_cur").observe("childlist", () => {
				updateInventoryPrices();
			});
		});
	}
	(function(d) {
		d.Observe = {};
	})(jQuery);
	(function(d, q) {
		var r = function(e, f) {
			f || (f = e, e = window.document);
			var m = [];
			d(f).each(function() {
				for (var l = [], g = d(this), h = g.parent(); h.length && !g.is(e); h = h.parent()) {
					var f = g.get(0).tagName.toLowerCase();
					l.push(f + ":eq(" + h.children(f).index(g) + ")");
					g = h;
				}
				(h.length || g.is(e)) && m.push("> " + l.reverse().join(" > "));
			});
			return m.join(", ");
		};
		q.path = {
			get: r,
			capture: function(e, f) {
				f || (f = e, e = window.document);
				var m = [];
				d(f).each(function() {
					var l = -1, g = this;
					if (this instanceof Text) {
						for (var g = this.parentNode, h = g.childNodes, f = 0; f < h.length; f++) if (h[f] === this) {
							l = f;
							break;
						}
					}
					var k = r(e, g), n = d(e).is(g);
					m.push(function(e) {
						e = n ? e : d(e).find(k);
						return -1 === l ? e : e.contents()[l];
					});
				});
				return function(e) {
					e = e || window.document;
					return m.reduce(function(d, f) {
						return d.add(f(e));
					}, d([]));
				};
			}
		};
	})(jQuery, jQuery.Observe);
	(function(d, q) {
		var r = function(e) {
			this.original = d(e);
			this.root = this.original.clone(!1, !0);
		};
		r.prototype.find = function(d) {
			return q.path.capture(this.original, d)(this.root);
		};
		q.Branch = r;
	})(jQuery, jQuery.Observe);
	(function(d, q) {
		var r = function(a, b) {
			var c = {};
			a.forEach(function(a) {
				(a = b(a)) && (c[a[0]] = a[1]);
			});
			return c;
		}, e = r("childList attributes characterData subtree attributeOldValue characterDataOldValue attributeFilter".split(" "), function(a) {
			return [a.toLowerCase(), a];
		}), f = r(Object.keys(e), function(a) {
			if ("attributefilter" !== a) return [e[a], !0];
		}), m = r(["added", "removed"], function(a) {
			return [a.toLowerCase(), a];
		}), l = d([]), g = function(a) {
			if ("object" === typeof a) return a;
			a = a.split(/\s+/);
			var b = {};
			a.forEach(function(a) {
				a = a.toLowerCase();
				if (!e[a] && !m[a]) throw Error("Unknown option " + a);
				b[e[a] || m[a]] = !0;
			});
			return b;
		}, h = function(a) {
			return "[" + Object.keys(a).sort().reduce(function(b, c) {
				var d = a[c] && "object" === typeof a[c] ? h(a[c]) : a[c];
				return b + "[" + JSON.stringify(c) + ":" + d + "]";
			}, "") + "]";
		}, t = window.MutationObserver || window.WebKitMutationObserver, k = function(a, b, c, s) {
			this._originalOptions = d.extend({}, b);
			b = d.extend({}, b);
			this.attributeFilter = b.attributeFilter;
			delete b.attributeFilter;
			c && (b.subtree = !0);
			b.childList && (b.added = !0, b.removed = !0);
			if (b.added || b.removed) b.childList = !0;
			this.target = d(a);
			this.options = b;
			this.selector = c;
			this.handler = s;
		};
		k.prototype.is = function(a, b, c) {
			return h(this._originalOptions) === h(a) && this.selector === b && this.handler === c;
		};
		k.prototype.match = function(a) {
			var b = this.options, c = a.type;
			if (!this.options[c]) return l;
			if (this.selector) switch (c) {
				case "attributes": if (!this._matchAttributeFilter(a)) break;
				case "characterData": return this._matchAttributesAndCharacterData(a);
				case "childList":
					if (a.addedNodes && a.addedNodes.length && b.added && (c = this._matchAddedNodes(a), c.length)) return c;
					if (a.removedNodes && a.removedNodes.length && b.removed) return this._matchRemovedNodes(a);
			}
			else {
				var s = a.target instanceof Text ? d(a.target).parent() : d(a.target);
				if (!b.subtree && s.get(0) !== this.target.get(0)) return l;
				switch (c) {
					case "attributes": if (!this._matchAttributeFilter(a)) break;
					case "characterData": return this.target;
					case "childList": if (a.addedNodes && a.addedNodes.length && b.added || a.removedNodes && a.removedNodes.length && b.removed) return this.target;
				}
			}
			return l;
		};
		k.prototype._matchAttributesAndCharacterData = function(a) {
			return this._matchSelector(this.target, [a.target]);
		};
		k.prototype._matchAddedNodes = function(a) {
			return this._matchSelector(this.target, a.addedNodes);
		};
		k.prototype._matchRemovedNodes = function(a) {
			var b = new q.Branch(this.target), c = Array.prototype.slice.call(a.removedNodes).map(function(a) {
				return a.cloneNode(!0);
			});
			a.previousSibling ? b.find(a.previousSibling).after(c) : a.nextSibling ? b.find(a.nextSibling).before(c) : (this.target === a.target ? b.root : b.find(a.target)).empty().append(c);
			return this._matchSelector(b.root, c).length ? d(a.target) : l;
		};
		k.prototype._matchSelector = function(a, b) {
			var c = a.find(this.selector);
			b = Array.prototype.slice.call(b);
			return c = c.filter(function() {
				var a = this;
				return b.some(function(b) {
					return b instanceof Text ? b.parentNode === a : b === a || d(b).has(a).length;
				});
			});
		};
		k.prototype._matchAttributeFilter = function(a) {
			return this.attributeFilter && this.attributeFilter.length ? 0 <= this.attributeFilter.indexOf(a.attributeName) : !0;
		};
		var n = function(a) {
			this.patterns = [];
			this._target = a;
			this._observer = null;
		};
		n.prototype.observe = function(a, b, c) {
			var d = this;
			this._observer ? this._observer.disconnect() : this._observer = new t(function(a) {
				a.forEach(function(a) {
					d.patterns.forEach(function(b) {
						var c = b.match(a);
						c.length && c.each(function() {
							b.handler.call(this, a);
						});
					});
				});
			});
			this.patterns.push(new k(this._target, a, b, c));
			this._observer.observe(this._target, this._collapseOptions());
		};
		n.prototype.disconnect = function(a, b, c) {
			var d = this;
			this._observer && (this.patterns.filter(function(d) {
				return d.is(a, b, c);
			}).forEach(function(a) {
				a = d.patterns.indexOf(a);
				d.patterns.splice(a, 1);
			}), this.patterns.length || this._observer.disconnect());
		};
		n.prototype.disconnectAll = function() {
			this._observer && (this.patterns = [], this._observer.disconnect());
		};
		n.prototype.pause = function() {
			this._observer && this._observer.disconnect();
		};
		n.prototype.resume = function() {
			this._observer && this._observer.observe(this._target, this._collapseOptions());
		};
		n.prototype._collapseOptions = function() {
			var a = {};
			this.patterns.forEach(function(b) {
				var c = a.attributes && a.attributeFilter;
				if (!c && a.attributes || !b.attributeFilter) c && b.options.attributes && !b.attributeFilter && delete a.attributeFilter;
				else {
					var e = {}, f = [];
					(a.attributeFilter || []).concat(b.attributeFilter).forEach(function(a) {
						e[a] || (f.push(a), e[a] = 1);
					});
					a.attributeFilter = f;
				}
				d.extend(a, b.options);
			});
			Object.keys(m).forEach(function(b) {
				delete a[m[b]];
			});
			return a;
		};
		var p = function(a) {
			this.patterns = [];
			this._paused = !1;
			this._target = a;
			this._events = {};
			this._handler = this._handler.bind(this);
		};
		p.prototype.NS = ".jQueryObserve";
		p.prototype.observe = function(a, b, c) {
			a = new k(this._target, a, b, c);
			d(this._target);
			a.options.childList && (this._addEvent("DOMNodeInserted"), this._addEvent("DOMNodeRemoved"));
			a.options.attributes && this._addEvent("DOMAttrModified");
			a.options.characterData && this._addEvent("DOMCharacerDataModified");
			this.patterns.push(a);
		};
		p.prototype.disconnect = function(a, b, c) {
			var e = d(this._target), f = this;
			this.patterns.filter(function(d) {
				return d.is(a, b, c);
			}).forEach(function(a) {
				a = f.patterns.indexOf(a);
				f.patterns.splice(a, 1);
			});
			var g = this.patterns.reduce(function(a, b) {
				b.options.childList && (a.DOMNodeInserted = !0, a.DOMNodeRemoved = !0);
				b.options.attributes && (a.DOMAttrModified = !0);
				b.options.characterData && (a.DOMCharacerDataModified = !0);
				return a;
			}, {});
			Object.keys(this._events).forEach(function(a) {
				g[a] || (delete f._events[a], e.off(a + f.NS, f._handler));
			});
		};
		p.prototype.disconnectAll = function() {
			var a = d(this._target), b;
			for (b in this._events) a.off(b + this.NS, this._handler);
			this._events = {};
			this.patterns = [];
		};
		p.prototype.pause = function() {
			this._paused = !0;
		};
		p.prototype.resume = function() {
			this._paused = !1;
		};
		p.prototype._handler = function(a) {
			if (!this._paused) {
				var b = {
					type: null,
					target: null,
					addedNodes: null,
					removedNodes: null,
					previousSibling: null,
					nextSibling: null,
					attributeName: null,
					attributeNamespace: null,
					oldValue: null
				};
				switch (a.type) {
					case "DOMAttrModified":
						b.type = "attributes";
						b.target = a.target;
						b.attributeName = a.attrName;
						b.oldValue = a.prevValue;
						break;
					case "DOMCharacerDataModified":
						b.type = "characterData";
						b.target = d(a.target).parent().get(0);
						b.attributeName = a.attrName;
						b.oldValue = a.prevValue;
						break;
					case "DOMNodeInserted":
						b.type = "childList";
						b.target = a.relatedNode;
						b.addedNodes = [a.target];
						b.removedNodes = [];
						break;
					case "DOMNodeRemoved": b.type = "childList", b.target = a.relatedNode, b.addedNodes = [], b.removedNodes = [a.target];
				}
				for (a = 0; a < this.patterns.length; a++) {
					var c = this.patterns[a], e = c.match(b);
					e.length && e.each(function() {
						c.handler.call(this, b);
					});
				}
			}
		};
		p.prototype._addEvent = function(a) {
			this._events[a] || (d(this._target).on(a + this.NS, this._handler), this._events[a] = !0);
		};
		q.Pattern = k;
		q.MutationObserver = n;
		q.DOMEventObserver = p;
		d.fn.observe = function(a, b, c) {
			b ? c || (c = b, b = null) : (c = a, a = f);
			return this.each(function() {
				var e = d(this), f = e.data("observer");
				f || (f = t ? new n(this) : new p(this), e.data("observer", f));
				a = g(a);
				f.observe(a, b, c);
			});
		};
		d.fn.disconnect = function(a, b, c) {
			a && (b ? c || (c = b, b = null) : (c = a, a = f));
			return this.each(function() {
				var e = d(this), f = e.data("observer");
				f && (a ? (a = g(a), f.disconnect(a, b, c)) : (f.disconnectAll(), e.removeData("observer")));
			});
		};
	})(jQuery, jQuery.Observe);
	(($) => {
		class Checkboxes {
			constructor(context) {
				this.$context = context;
			}
			check() {
				this.$context.find(":checkbox").filter(":not(:disabled)").filter(":visible").prop("checked", true).trigger("change");
			}
			uncheck() {
				this.$context.find(":checkbox:visible").filter(":not(:disabled)").prop("checked", false).trigger("change");
			}
			toggle() {
				this.$context.find(":checkbox:visible").filter(":not(:disabled)").each((i, element) => {
					let $checkbox = $(element);
					$checkbox.prop("checked", !$checkbox.is(":checked"));
				}).trigger("change");
			}
			max(max) {
				if (max > 0) {
					let instance = this;
					this.$context.on("click.checkboxes.max", ":checkbox", () => {
						if (instance.$context.find(":checked").length === max) instance.$context.find(":checkbox:not(:checked)").prop("disabled", true);
						else instance.$context.find(":checkbox:not(:checked)").prop("disabled", false);
					});
				} else this.$context.off("click.checkboxes.max");
			}
			range(enable) {
				if (enable) {
					let instance = this;
					this.$context.on("click.checkboxes.range", ":checkbox", (event) => {
						let $checkbox = $(event.target);
						if (event.shiftKey && instance.$last) {
							let $checkboxes = instance.$context.find(":checkbox:visible");
							let from = $checkboxes.index(instance.$last);
							let to = $checkboxes.index($checkbox);
							let start = Math.min(from, to);
							let end = Math.max(from, to) + 1;
							$checkboxes.slice(start, end).filter(":not(:disabled)").prop("checked", $checkbox.prop("checked")).trigger("change");
						}
						instance.$last = $checkbox;
					});
				} else this.$context.off("click.checkboxes.range");
			}
		}
		let old = $.fn.checkboxes;
		$.fn.checkboxes = function(method) {
			let args = Array.prototype.slice.call(arguments, 1);
			return this.each((i, element) => {
				let $this = $(element);
				let instance = $this.data("checkboxes");
				if (!instance) $this.data("checkboxes", instance = new Checkboxes($this));
				if (typeof method === "string" && instance[method]) instance[method].apply(instance, args);
			});
		};
		$.fn.checkboxes.Constructor = Checkboxes;
		$.fn.checkboxes.noConflict = function() {
			$.fn.checkboxes = old;
			return this;
		};
		var dataApiClickHandler = (event) => {
			var el = $(event.target);
			var href = el.attr("href");
			var $context = $(el.data("context") || href && href.replace(/.*(?=#[^\s]+$)/, ""));
			var action = el.data("action");
			if ($context && action) {
				if (!el.is(":checkbox")) event.preventDefault();
				$context.checkboxes(action);
			}
		};
		var dataApiDomReadyHandler = () => {
			$("[data-toggle^=checkboxes]").each(function() {
				let el = $(this);
				let actions = el.data();
				delete actions.toggle;
				for (let action in actions) el.checkboxes(action, actions[action]);
			});
		};
		$(document).on("click.checkboxes.data-api", "[data-toggle^=checkboxes]", dataApiClickHandler);
		$(dataApiDomReadyHandler);
	})(window.jQuery);
	jquery.default.noConflict(true);
	sellQueue.drain(() => {
		onQueueDrain();
	});
	scrapQueue.drain(() => {
		onQueueDrain();
	});
	boosterQueue.drain(() => {
		onQueueDrain();
	});
	itemQueue.drain(() => {
		onQueueDrain();
	});
	marketOverpricedQueue.drain(() => {
		if (!marketListingsQueue.idle()) {
			refreshMarketOverpricedButtons();
			return;
		}
		resetMarketRelistProgress();
	});
	marketListingsQueue.drain(() => {
		if (!marketOverpricedQueue.idle()) return;
		resetMarketRelistProgress();
	});
	marketListingsItemsQueue.drain(() => {
		const myMarketListings = (0, jquery.default)("#tabContentsMyActiveMarketListingsRows");
		myMarketListings.checkboxes("range", true);
		const seen = {};
		(0, jquery.default)(".market_listing_row", myMarketListings).each(function() {
			const item_id = String((0, jquery.default)(this).attr("id"));
			if (seen[item_id]) (0, jquery.default)(this).remove();
			else seen[item_id] = true;
			if ((0, jquery.default)(".item_market_action_button", this).attr("href").toLowerCase().includes("CancelMarketListingConfirmation".toLowerCase())) (0, jquery.default)(this).remove();
			if ((0, jquery.default)(".item_market_action_button", this).attr("href").toLowerCase().includes("CancelMarketBuyOrder".toLowerCase())) (0, jquery.default)(this).remove();
		});
		addMarketCheckboxes();
		removeSpinner();
		myMarketListings.show();
		fillMarketListingsQueue();
	});
	injectCss(`
    .ui-selected { outline: 2px dashed #FFFFFF; }
    #logger { color: #767676; font-size: 12px;margin-top:16px; max-height: 200px; overflow-y: auto; }
    .trade_offer_sum { color: #767676; font-size: 12px; margin-top:8px; user-select: text; }
    .trade_offer_buttons { margin-top: 12px; }
    .market_commodity_orders_table { font-size:12px; font-family: "Motiva Sans", Sans-serif; font-weight: 300; }
    .market_commodity_orders_table th { padding-left: 10px; }
    #listings_group { display: flex; justify-content: space-between; margin-bottom: 8px; }
    #listings_sell { text-align: right; color: #589328; font-weight:600; }
    #listings_buy { text-align: right; color: #589328; font-weight:600; }
    .market_listing_my_price { height: 50px; padding-right:6px; }
    /* The priced cell as four labelled quadrants. The grid owns the whole 50px box, which
       is what stops the old stacked layout from spilling into the next row: Steam gives
       the cell line-height:50px, so a block appended after its inline-block value started
       below the cell entirely, and a long price (A$ 128.00 -> A$ 104.55) wrapped and pushed
       the last value out. A fixed 2x2 with nowrap values cannot do either.
       .see_hidden keeps Steam's own markup in the DOM -- three positional selectors read
       the prices back out of it -- while taking it off the screen. */
    .see_hidden { display: none !important; }
    /* The column gap is 2px rather than 6px to pay for the 2px left pad and then some.
       A quadrant gets (121 - 2 - gap) / 2 of the cell, and a bold A$ 128.00 needs 56px:
       at a 6px gap it had 55 and clipped by a pixel even before the pad existed. Short
       values leave the columns looking generously spaced regardless; it is only at four
       figures that the gap is doing any work. */
    .see_price_grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        height: 50px; padding: 3px 0 3px 2px; box-sizing: border-box; line-height: 1.05; text-align: left; gap: 0 2px; }
    .see_grid_cell { display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
    .see_grid_label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px; color: rgba(255,255,255,0.55); }
    .see_grid_value { font-size: 11px; white-space: nowrap; }
    .see_grid_lead { color: #fff; font-weight: 600; }
    .market_listing_edit_buttons.actual_content { width:276px; transition-property: background-color, border-color; transition-timing-function: linear; transition-duration: 0.5s;}
    .market_listing_buttons { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; padding: 5px; background: rgba(0, 0, 0, 0.4); }
    .market_listing_label_right { float:right; font-size:12px; margin-top:1px; }
    .market_listing_select { position: absolute; top: 16px;right: 10px; display: flex; }
    #market_listing_relist { vertical-align: middle; position: relative; bottom: -1px; right: 2px; }
    .pick_and_sell_button > a { vertical-align: middle; }
    .market_relist_auto { margin-bottom: 8px;  }
    .market_relist_auto_label { margin-right: 6px; }
    .quick_sell { margin-right: 4px; }

    .spinner {margin:10px auto;width:50px;height:40px;text-align:center;font-size:10px;}
    .spinner > div {background-color:#ccc;height:100%;width:6px;display:inline-block;animation:sk-stretchdelay 1.2s infinite ease-in-out}
    .spinner .rect2 {animation-delay:-1.1s}
    .spinner .rect3 {animation-delay:-1s}
    .spinner .rect4 {animation-delay:-.9s}
    .spinner .rect5 {animation-delay:-.8s}
    @keyframes sk-stretchdelay {
        0%,40%,100% {transform:scaleY(0.4);}
        20% {transform:scaleY(1.0);}
    }

    #market_name_search { float: right; background: rgba(0, 0, 0, 0.25); color: white; border: none;height: 25px; padding-left: 6px;}
    .price_option_price { width: 100px }
    .inventory_item_price { top: 0px;position: absolute;right: 0;background: #3571a5;padding: 2px;color: white; font-size:11px; border: 1px solid #666666;}

    .see_inventory_buttons {display:flex;flex-wrap:wrap;gap:10px;align-items:start;}
    .see_inventory_buttons > .see_inventory_buttons, .see_inventory_buttons > #inventory_items_spinner {flex-basis: 100%;}
    #see_market_progress { display: block; width: 50%; height: 20px; }
    #see_market_progress[hidden] { visibility: hidden; }
    .item_market_action_button.see_button_busy { pointer-events: none; opacity: 0.6; cursor: default; }

    #see_settings { background: #26566c; margin-right: 10px; height: 24px; line-height:24px; display:inline-block; padding: 0px 6px; }
    #see_settings_modal select, #see_settings_modal input[type="number"] { background-color: black; color: white; border: transparent; padding: 4px 8px; }
    #see_settings_modal input[type="number"] { width: 100px; }
    #see_settings_modal input[type="checkbox"] { width: 16px; height: 16px; vertical-align: middle; accent-color: #000; }

    #see_page_jump { margin-left: 15px; display: inline-block; }
    #see_page_jump > input { width: 60px; margin-right: 8px; background-color: #1b2838; color: #fff; border: 1px solid #4582a5; padding: 2px 5px; }
`);
	(0, jquery.default)(document).ready(() => {
		if (!isLoggedIn) return;
		if (currentPage == 3) initializeInventoryUI();
		if (currentPage == 0 || currentPage == 1) initializeMarketUI();
		if (currentPage == 2) initializeTradeOfferUI();
	});
	jquery.default.fn.delayedEach = function(timeout, callback, continuous) {
		const $els = this;
		const iterator = function(index) {
			if (index >= $els.length) {
				if (!continuous) return;
				index = 0;
			}
			const cur = $els[index];
			callback.call(cur, index, cur);
			setTimeout(() => {
				iterator(++index);
			}, timeout);
		};
		iterator(0);
	};
})(jQuery, localforage, async, luxon, List);
