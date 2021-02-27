/**
@licence
    Copyright (c) 2020 Alan Chandler, all rights reserved

    This file is part of football-mobile.

    football-mobile is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    football-mobile is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with football-mobile.  If not, see <http://www.gnu.org/licenses/>.
*/




(function() {
  'use strict';

  const chalk = require('chalk');
  const { isIP } = require('net');
  let cyrb53;

  if (process.env.LOG_NO_ENCODE) {
    cyrb53 = (str, seed = 0) => {return str;};
  } else {
    cyrb53 = (str, seed = 0) => {
      let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
      for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
      h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
      return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    };
  }
  const COLOURS = {
    app: chalk.rgb(255, 136, 0).bold, //orange,
    db: chalk.greenBright,
    api: chalk.magentaBright,
    client: chalk.redBright,
    log: chalk.yellowBright,
    mail:chalk.cyanBright,
    //error like have backGround colouring
    auth: chalk.black.bgCyan,
    err: chalk.white.bgBlue,
    error: chalk.white.bgRed
  };

  function logger(ip,level, ...messages) {
    if (process.env.LOG_NONE === undefined) {
      let logLine = '';
      if (process.env.LOG_NO_DATE === undefined) logLine += new Date().toISOString() + ': ';
      let message;
      let logcolor
      if (isIP(ip) === 0 ) {
        logcolor = ip;
        message = level + messages.join(' ');
      } else {
        const client = process.env.LOG_IP_HIDDEN !== undefined ? cyrb53(ip): ip;
        logLine += COLOURS.client(client + ': ');
        logcolor = level
        message = messages.join(' ');
      }
      logLine += COLOURS[logcolor](message);
      //eslint-disable-next-line no-console
      console.log(logLine.trim());
    }
  }

  module.exports = logger;
})();
