/**
@licence
    Copyright (c) 2020-2025 Alan Chandler, all rights reserved

    This file is part of Sqlite-db

    Sqlite-db is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Sqlite-db is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Sqlite-db.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
@licence
    Copyright (c) 2020-2025 Alan Chandler, all rights reserved

    This file is part of Sqlite-db

    Sqlite-db is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Sqlite-db is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Sqlite-db.  If not, see <http://www.gnu.org/licenses/>.
*/
import { DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import EventEmitter from 'node:events';
import {randomBytes} from "node:crypto";
import chalk from 'chalk';

let loggeractive = true;
let debugactive = false;

const sqlcolour = chalk.hex('#ff651d');
const sqltopic = chalk.hex('#b613a2');

function debug(topic, ...args) {
  const shortdate = (typeof topic !== 'string');
  if (shortdate && !loggeractive ) return;
  if (!shortdate && !debugactive) return; 
  const message = args.reduce((cum, arg) => {
      if (arg === undefined) return cum;
      return `${cum} ${arg}`.trim();
    },'');
  const logdate = new Date();
  const displaydate = `${logdate.getFullYear()}-${('00' + (logdate.getMonth() + 1)).slice(-2)}-${('00' + logdate.getDate()).slice(-2)}`;
  const displaytime = `${('00' + logdate.getHours()).slice(-2)}:${('00' + logdate.getMinutes()).slice(-2)}:${('00' + logdate.getSeconds()).slice(-2)}.${
    ('000' + logdate.getMilliseconds()).slice(-3)}`;
  const d = chalk.blueBright(`${displaydate} ${shortdate? displaytime.slice(0,-7): displaytime}`);
  const t = shortdate? '': sqltopic(`(${topic})`);
  const m = ' ' + (shortdate ? chalk.greenBright(message) : sqlcolour(message));
  console.log(`${d} ${t}${m}`);
}


function debugTemplate(type,strings,...keys) {
  if (!debugactive) return;
  let result = strings[0];
  for (let i = 1; i < strings.length; i++) {
    result += '${' + keys[i-1] + '}' + strings[i];
  }
  
  debug(type,result);
}

const secretKey = Buffer.from(randomBytes(20)).toString('hex');

/*

  Environment variables used
  
  SQLITE_DB_EXT                            Extention for database ASSUMES '.db' If not present 
  SQLITE_DB_NAME                           Name of the initial database to be opened (others can be opened with Open Database)
  SQLITE_DB_POOL_MIN_DB=2                  Put a connection in the pool instead of closing it if pool size is less than this
  SQLITE_DB_POOL_MAX_DB=100                Stop and wait before opening any more connections

*/
const databases = new Map();  //This is a map, between database name (full filename) and and an array of connections that are no longer in use but are still open.
const openDBs = new Set();  

const poolMin = Number(process.env.SQLITE_DB_OPEN_MIN);
const poolMax = Number(process.env.SQLITE_DB_CONNECTION_MAX);

let maxConnections = 1;  //just avoids a message on startup when the very first connection is made
let currentConnections = 0;
let shuttingDown = false;

let maxTagStoreSize = 5; //not interested in knowing until its that large

const overPoolLimitQueue = [];

async function getConnectionPermission() {
  return new Promise(resolve => { //make a resolver for the promise and either queue it or resolve it
    currentConnections++;
    if (currentConnections > maxConnections) {
      maxConnections = currentConnections;
      debug(true,'Database Connections new maximum size of', currentConnections); 
    }
    if (currentConnections > poolMax) {
      overPoolLimitQueue.push(resolve);
    } else {
      resolve();
    }
  }) 
};

function releaseConnection() {
  currentConnections--;
  let headroom = poolMax - currentConnections;
  while (overPoolLimitQueue.length > 0 && headroom > 0) {
    const resolver = overPoolLimitQueue.shift();
    headroom--;
    resolver(); //resolve the earliest person who requested a "getConnectionPermission"
  }
}
export class DatabaseError extends Error {
  constructor(message) {
    super('Database Error: ' + message);
  }
}



class Database extends EventEmitter {
  constructor(key,cbv, dn ) {
    if(key !== secretKey) throw new DatabaseError('Cannot construct Database class directly');
    super()
    this._callingdb = cbv
    this.dbfile = path.resolve(process.env.SQLITE_DB_DIR,dn);
    if (databases.has(this.dbfile)) {
      const pool = databases.get(this.dbfile);
      this._db = pool.shift();
      if (pool.length > 0) {
        databases.set(this.dbfile, pool);
      } else {
        databases.delete(this.dbfile);
      }
      releaseConnection();  //we release it, because build got one increased the number, but in fact we haven't
    } else {
      this._db  = new DatabaseSync(this.dbfile + '.db', {timeout: Number(process.env.SQLITE_DB_BUSY_TIMEOUT??5000)});
    }
    this._tagstore = this._db.createTagStore();
    if (this._callingdb === null) {
      //we are the orignal
      this._functionMap = new Map();
    } else {
      const fm = this.functionMap; //we are not the original, but the getter will find it.
      for (const f of fm) this._db.function(f[0], f[1][0], f[1],[1]); //apply all the function maps to this instance
    }
    
  }
  static async build(creatingdb,dn) {
    const dbName = dn
    await getConnectionPermission();
    const db =  new Database(secretKey,creatingdb ,dbName)
    openDBs.add(db)
    return db;
  }
  all(strings,...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debugTemplate('all',strings, ...keys);
    return this._tagstore.all(strings, ...keys);
  }
  close(skipVacuum) {
    if (this._db === null) return;
    if (this.isOpen) {
      if (this.isTransaction) this.exec('ROLLBACK;');
      if (!skipVacuum) this.exec('VACUUM;');
      this.exec('PRAGMA main.wal_checkpoint(TRUNCATE);');
      this.emit('dbclose',this);
      
    }
    let pool;
    if (databases.has(this.dbfile)) {
        pool = databases.get(this.dbfile);
    } else {
      pool = []; //no entry yet so make one
    }
    if (pool.length < poolMin && !shuttingDown) {
      pool.push(this._db);

      databases.set(this.dbfile,pool);
    } else {
      const tgSize = this._tagstore.size();
      if (tgSize > maxTagStoreSize) {
        maxTagStoreSize = tgSize;
        debug(true,'Database closing with Tag Store Size',tgSize , 'Capacity', this._tagstore.capacity);
      }
      this._db?.close();
      releaseConnection();
    }
    this._db = null
    openDBs.delete(this);
  }
  exec(sql) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debug('exec', sql);
    this._db.exec(sql);
  }
  function(name,options,callback) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    if (this._callingdb !== null) throw new DatabaseError('cannot add a function inside a transaction');
    this._db.function(name,options,callback);
    this._functionMap.set(name,[options, callback])
  }
  get(strings,...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debugTemplate('get',strings, ...keys);
    return this._tagstore.get(strings, ...keys);
  }
  get functionMap() {
    if (this._callingdb === null) {
      return this._functionMap;
    } else {
      return this._callingdb.functionMap;
    }
  }
  get isOpen() {
    if (this._db) return this._db.isOpen;
    return false;
  }
  iterate(strings,...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debugTemplate('iterate',strings, ...keys);
    return this._tagstore.iterate(strings, ...keys);
  }
  get isTransaction() {
    if (this._db ) return this._db.isTransaction;
    return false;
  }
  open() {
    if (!this.isOpen) {
      if (databases.has(this.dbfile)) {
        const pool = databases.get(this.dbfile);
        this._db = pool.shift();
        if (pool.length > 0) {
          databases.set(this.dbfile, pool);
        } else {
          databases.delete(this.dbfile);
        }
      } else {
        this._db  = new DatabaseSync(this.dbfile + '.db', {timeout: Number(process.env.SQLITE_DB_BUSY_TIMEOUT??5000)});
      }
    }
  }
  prepare(sql) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debug('prepare',sql);
    return this._db.prepare(sql)
  }
  run(strings, ...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debugTemplate('run',strings, ...keys);
    this._tagstore.run(strings, ...keys)
  }
  transaction(callback) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    let returnValue;
    this._db.exec('BEGIN TRANSACTION');
    try {
      returnValue = callback(this);
      this._db.exec('COMMIT');
    } catch (e) {
      this._db.exec('ROLLBACK');
      throw e;
    }
    return returnValue
  }
  async transactionAsync(callback) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    debug('Async Transaction Started')
    let returnValue;
    const db = await Database.build(this,this.dbfile);
    openDBs.add(db);
    db.exec('BEGIN TRANSACTION');
    try {
      returnValue = await callback(db);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      db.close(true)
      throw e;
    } finally {
      db.close(true)
    }
    debug('Async Transaction Ended');
    return returnValue
      
  }
}

export function manager(command, param) {
  switch (command.toLowerCase()) {
    case 'logger':
      loggeractive = param;
      break;
    case 'debug':
      debugactive = param;
      break;
  }
}


export const openDatabase = async(dn) => {
  const dbName = dn;
  const db = await Database.build(null,dbName);
  db.exec('PRAGMA journal_mode=WAL;');
  return db; 
};

process.on('exit',() => {
  shuttingDown = true;
  debug(true,'The maximum TagStore Size was',maxTagStoreSize);
  for (const pool of databases) {
    for(const db of pool[1]) db?.close();  
  }
  for (const db of openDBs) db?.close(true);
});

const sqlite = await openDatabase(process.env.SQLITE_DB_NAME);

export default sqlite;

