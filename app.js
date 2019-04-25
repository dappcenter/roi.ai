const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const TronWeb = require("tronweb");
require('dotenv').config();

const TRONGRID_API_FULL = "https://api.trongrid.io";
const TRONGRID_API_SOL = "https://api.trongrid.io";
const TRONGRID_API_EVENT = "https://api.trongrid.io";

const PRIVATE_KEY = process.env.PK;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const NetworkAdapter = new TronWeb(TRONGRID_API_FULL, TRONGRID_API_SOL, TRONGRID_API_EVENT, PRIVATE_KEY);
const Utils = {
    tronWeb: false,
    contract: false,

    async setTronWeb(tronWeb) {
        this.tronWeb = tronWeb;
        this.contract = tronWeb.contract().at(CONTRACT_ADDRESS);
    },
};

const bets = [
    { low: 0, high: 96 },
    { low: 1, high: 97 },
    { low: 2, high: 98 },
];
const wager = 135;
const seed = "0x000000000000000000000000000000000000000000000000000000005cc21073";
// const seed = "0x000000000000000000000000000000000000000000000000000000005cc2265d";
// const seed = "0x000000000000000000000000000000000000000000000000000000005cc22f2a";

const roll = () => {
    const   bet = bets[((max) => {
        return Math.floor(Math.random() * Math.floor(max));
    })(bets.length)];
    const rollIntegerVariables = [bet.low, bet.high, wager, 0, 0];

    console.log("Wager " + wager + " $trx on " + bet.low + " - " + bet.high);

    if (Utils.contract) {
        Utils.contract
            .then((contract) => {
                contract
                    .roll(rollIntegerVariables, seed, "TFwSxkqGKTRua2JhoL65JeuRgfjLLzhD3R")
                    .send({ callValue: wager * 1000000 })
                    .then((response) => {
                        const txn = response;

                        console.log("TriggerContract (roll) view txn result here... https://api.trongrid.io/wallet/gettransactionbyid?value=" + response);

                        return true;
                    })
                    .catch((err) => {
                        console.error(err);
                    });
            })
            .catch((err) => {
                console.error(err);
            });
    } else {
        console.log("TronWeb not found.");
    }
};

const EVERY_30_MINUTES = process.env.EVERY_30_MINUTES;
const EVERY_05_MINUTES = process.env.EVERY_05_MINUTES;
const EVERY_XX_MINUTES = process.env.EVERY_XX_MINUTES;
const EVERY_XX_SECONDS = process.env.EVERY_XX_SECONDS;

let interval = EVERY_30_MINUTES;

if (EVERY_XX_SECONDS > 0) {
    interval = EVERY_XX_SECONDS * 1000;
}

if (EVERY_XX_MINUTES > 0) {
    interval = EVERY_XX_MINUTES * 60000;
}

if (EVERY_05_MINUTES === 'Y') {
    interval = 300000;
}

if (EVERY_30_MINUTES === 'Y') {
    interval = 1800000;
}

Utils.setTronWeb(NetworkAdapter);

setInterval(() => {
    roll();
}, interval);

roll();

http.listen(35500, () => {
    console.log("Listening on *:35500");
    console.log("Rolling every " + (interval / 60000).toFixed(2) + " minutes.");
});
