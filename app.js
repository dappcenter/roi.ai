const axios = require("axios");
const events = require("events");
const cron = require("node-schedule");
const Immer = require("immer");
const produce = Immer.produce;
const R = require("ramda");

const { from, fromEvent, merge, of, timer } = require("rxjs");
const { concatMap, filter, finalize, map, mergeMap, switchMap, take, takeUntil, tap } = require("rxjs/operators");

const Telegraf = require("telegraf");
const TronWeb = require("tronweb");

const { store } = require("./config");

require("dotenv").config();

const TRONGRID_API_FULL = "https://api.trongrid.io";
const TRONGRID_API_SOL = "https://api.trongrid.io";
const TRONGRID_API_EVENT = "https://api.trongrid.io";

// const TRONGRID_API_FULL = "https://api.shasta.trongrid.io";
// const TRONGRID_API_SOL = "https://api.shasta.trongrid.io";
// const TRONGRID_API_EVENT = "https://api.shasta.trongrid.io";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PK;
const STAKER_ADDRESS = process.env.STAKER_ADDRESS;

const TXN_API_PARAMS = "/wallet/gettransactionbyid?value=";
const TXN_ENDPOINT = (txn) => TRONGRID_API_FULL + TXN_API_PARAMS + txn;
const CONTRACT_ENDPOINT = (contract, timestamp) =>
    TRONGRID_API_FULL.concat(
        "/event/contract/",
        contract,
        "?size=200&page=1&since=",
        timestamp,
        "&fromTimestamp=",
        timestamp,
        "&sort=block_timestamp"
    );
const POLL_INTERVAL = 3250;
// const WALLET_ENDPOINT = (address) => "https://apilist.tronscan.org/api/account?address=" + address;

const Utils = {
    tronWeb: false,
    contract: false,

    async setTronWeb(tronWeb, contract = CONTRACT_ADDRESS) {
        this.tronWeb = tronWeb;
        this.contract = await this.tronWeb.contract().at(contract);
    },

    async setContract(contract) {
        this.contract = await this.tronWeb.contract().at(CONTRACT_ADDRESS);
    },
};

const getSeconds = () => {
    return new Date().getTime();
};
const mapEvents = (response) => {
    return of(response);
};

const root$ = new events.EventEmitter();

let start$;
let stop$;
let timestampPreviousEventSync = getSeconds();

let txns = {};
let amount = 1000;

const tewkenTimestamp = process.env.TEWKEN_TIMESTAMP;
const tewkenStartDate = new Date(tewkenTimestamp * 1e3);

let tewkenBuyLimit = 25;
let tewkenBuyAttempts = 0;

const hexAddress = (address) => {
    const base58 = address.split("");

    base58[0] = "4";
    base58[1] = "1";

    return base58.join("");
};

const initializeTron = async () => {
    const tronWeb = new TronWeb(TRONGRID_API_FULL, TRONGRID_API_SOL, TRONGRID_API_EVENT, PRIVATE_KEY);

    await Utils.setTronWeb(tronWeb);

    return tronWeb;
};

const isAddress = (address) => {
    return Utils.tronWeb.isAddress(address);
};

const buyToken = () => {
    if (Utils.contract) {
        Utils.contract
        .buy(STAKER_ADDRESS)
        .send({ callValue: amount * 1e6 })
        .then((txn) => {
            console.log("[CONTRACT] (buy)", txn);

            txns[txn] = timer(0, 2750);

            txns[txn]
            .pipe(concatMap(() => from(axios.get(TXN_ENDPOINT(txn))).pipe(map((response) => response))))
            .pipe(filter(({ data }) => typeof data.ret === "object"))
            .pipe(take(1))
            .subscribe(({ data }) => {
                let errors = 0;

                data.ret.forEach((value, index) => {
                    if (value.contractRet === "REVERT") {
                        errors++;
                    }
                });

                if (errors > 0) {
                    console.log("[ERROR] (buy)", txn);

                    if (tewkenBuyAttempts < tewkenBuyLimit) {
                        buyToken();
                        tewkenBuyAttempts++;
                    }
                } else {
                    console.log("[CONTRACT] (buy) - SUCCESS");
                }
            });

            return true;
        })

        .catch((error) => {
            console.error(error);
        });
    } else {
        console.error("[ERROR] TronWeb not found.");
    }
};

const reinvestRewards = () => {
    if (Utils.contract) {
        Utils.contract
        .reinvest()
        .send()
        .then((txn) => {
            console.log("[CONTRACT] (reinvest)", txn);

            txns[txn] = timer(0, 2750);

            txns[txn]
            .pipe(concatMap(() => from(axios.get(TXN_ENDPOINT(txn))).pipe(map((response) => response))))
            .pipe(filter(({ data }) => typeof data.ret === "object"))
            .pipe(take(1))
            .subscribe(({ data }) => {
                let errors = 0;

                data.ret.forEach((value, index) => {
                    if (value.contractRet === "REVERT") {
                        errors++;
                    }
                });

                if (errors > 0) {
                    // console.error("[ERROR] (reinvest)", txn, data);
                } else {
                    console.log("[CONTRACT] (reinvest) - SUCCESS");
                }
            });

            return true;
        })

        .catch((error) => {
            console.error(error);
        });
    } else {
        console.error("[ERROR] TronWeb not found.");
    }
};

const streamAnalyze = (stream) => {
    if (stream) {
        const incomingEventDelta = stream ? stream.reverse() : [];

        if (incomingEventDelta.length > 0) {
            const sequentialEvents = incomingEventDelta;

            let lastBlockTimestamp;

            sequentialEvents.forEach((event) => {
                const me = Utils.tronWeb.defaultAddress.hex.toLowerCase();

                const eventName = R.pathOr(null, ["event_name"], event);
                const gameId = R.pathOr(null, ["result", "id"], event);

                lastBlockTimestamp = 10 + R.pathOr(-1, ["block_timestamp"], event);

                console.log("[INFO] streamAnalyze - eventName", eventName);

                if (eventName === "onTokenPurchase") {
                    const customerAddress = R.pathOr(null, ["result", "customerAddress"], event);
                    const tokensMinted = R.pathOr(null, ["result", "tokensMinted"], event);
                    const price = R.pathOr(null, ["result", "price"], event);
                    const referredBy = R.pathOr(null, ["result", "referredBy"], event);
                    const incomingTron = R.pathOr(null, ["result", "incomingTron"], event);

                    if (hexAddress(customerAddress) !== me) {
                        reinvestRewards();
                    }
                }

                if (eventName === "onTokenSell") {
                    const customerAddress = R.pathOr(null, ["result", "customerAddress"], event);
                    const tokensBurned = R.pathOr(null, ["result", "tokensBurned"], event);
                    const price = R.pathOr(null, ["result", "price"], event);
                    const tronEarned = R.pathOr(null, ["result", "tronEarned"], event);
                    const incomingTron = R.pathOr(null, ["result", "incomingTron"], event);

                    if (hexAddress(customerAddress) !== me) {
                        reinvestRewards();
                    }
                }

                if (eventName === "onWithdraw") {
                    const customerAddress = R.pathOr(null, ["result", "customerAddress"], event);
                    const tronWithdrawn = R.pathOr(null, ["result", "tronWithdrawn"], event);

                    if (hexAddress(customerAddress) !== me) {
                        reinvestRewards();
                    }
                }

                if (eventName === "onReinvestment") {
                    const customerAddress = R.pathOr(null, ["result", "customerAddress"], event);
                    const tokensBurned = R.pathOr(null, ["result", "tokensBurned"], event);
                    const tronReinvested = R.pathOr(null, ["result", "tronReinvested"], event);

                    if (hexAddress(customerAddress) !== me) {
                        reinvestRewards();
                    }
                }
            });

            timestampPreviousEventSync = lastBlockTimestamp ? lastBlockTimestamp : getSeconds();
        }
    }
};

const streamListen = () => {
    // Start new Poll
    return streamStart(POLL_INTERVAL).pipe(
        tap(streamAnalyze),
        takeUntil(
            // stop polling on either button click or change of categories
            merge(stop$)
        ),
        finalize(() => {
            // final processing
        })
    );
};

const streamLoad = () => {
    // Dispatch the event, starting polling
    root$.emit("poll");
};

const streamRequest = (url, mapFunc) => {
    let _response;

    return from(
        new Promise((resolve, reject) => {
            axios
                .get(url)
                .then((response) => {
                    resolve(response.data);
                })
                .catch((error) => {
                    reject(error);
                });
        })
    ).pipe(
        switchMap((data) => mapFunc(data)),
        tap((data) => {
            // console.log("[LOG] - Request result: ", data);
        })
    );
};

const streamStart = (interval = 3250) => {
    return timer(0, interval).pipe(
        switchMap((_) => {
            const mapper = mapEvents;
            const url = CONTRACT_ENDPOINT(CONTRACT_ADDRESS, timestampPreviousEventSync);

            return streamRequest(url, mapper);
        })
    );
};

const streamUnload = () => {
    // Dispatch the event, starting polling
    root$.emit("exit");
};

const app = async () => {
    (async () => {
        start$ = fromEvent(root$, "poll");
        stop$ = fromEvent(root$, "exit");

        start$
            .pipe(
                tap((_) => {
                    console.log("[LOG] - Started...");
                }),
                mergeMap((_) => streamListen())
            )
            .subscribe();

        streamLoad();

        initializeTron().then(async (result) => {
            const tronWeb = result
                ? result
                : new TronWeb(TRONGRID_API_FULL, TRONGRID_API_SOL, TRONGRID_API_EVENT, PRIVATE_KEY);

            await Utils.setTronWeb(tronWeb).then(() => {
                // const bot = new Telegraf(BOT_TOKEN);
                //
                // bot.start((context) => context.reply("Trophy King Agent active..."));
                // bot.help((context) => context.reply("Please contact an admin."));
                // bot.command("kingme", (context) => {
                //     const commandText = R.pathOr("", ["message", "text"], context).split(" ");
                //     const airdropAddress = R.pathOr(null, ["1"], commandText);
                //     const userId = R.pathOr(null, ["message", "from", "id"], context);
                //
                //     if (userId && isAddress(airdropAddress)) {
                //         transferToken(userId.toString(), airdropAddress)
                //             .then((result) => {
                //                 console.log("[TXN]", result.transaction);
                //                 const txn_url =
                //                     "https://api.trongrid.io/wallet/gettransactionbyid?value=" + result.transaction;
                //                 context.reply("Reward transaction: " + txn_url);
                //             })
                //             .catch((error) => {
                //                 console.log("[ERROR]", error);
                //                 context.reply(error);
                //             });
                //     } else if (!isAddress(airdropAddress)) {
                //         context.reply("Invalid address.");
                //     } else if (!userId) {
                //         context.reply("Invalid user id.");
                //     }
                // });
                //
                // bot.launch();
            });
        });
    })();
};

if (getSeconds() > (tewkenTimestamp * 1e3)) {
    console.log("[INFO] - Starting now...");
    setTimeout(() => {
        buyToken();
    }, 15000);
} else {
    console.log("[INFO] - Starting later...");
    cron.scheduleJob(tewkenStartDate, buyToken);
}

module.exports = app;
