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
import fs from 'node:fs/promises';
import path from 'node:path';
import Debug from 'debug';
import EventEmitter from 'node:events';
import {randomBytes} from "node:crypto";

const secretKey = Buffer.from(randomBytes(20)).toString('hex');

const debug = Debug('sqlite-db');



/*

  Environment variables used
  
  SQLITE_DB_DIR=/app/db                    Directory within Container to find the database files
  SQLITE_DB_INITDIR=/app/server/db-init    Directory within Container to find the database initiation files and the upgrade,downgrade 
  SQLITE_DB_NAME                           Name of the initial database to be opened (others can be opened with Open Database)
  SQLITE_DB_POOL_MIN_DB=2                  Put a connection in the pool instead of closing it if pool size is less than this
  SQLITE_DB_POOL_MAX_DB=100                Stop and wait before opening any more connections
  SQLITE_DB_VERSION
*/
const databases = new Map();  //This is a map, between database name (full filename) and and an array of connections that are no longer in use but are still open.
const openDBs = new Set();  

const poolMin = Number(process.env.SQLITE_DB_OPEN_MIN);
const poolMax = Number(process.env.SQLITE_DB_CONNECTION_MAX);

let maxConnections = 1;  //just avoids a message on startup when the very first connection is made
let currentConnections = 0;
let shuttingDown = false;

const overPoolLimitQueue = [];

async function getConnectionPermission() {
  return new Promise(resolve => { //make a resolver for the promise and either queue it or resolve it
    currentConnections++;
    if (currentConnections > maxConnections) {
      maxConnections = currentConnections;
      logger('db', `Database Connections new maximum size of ${currentConnections}`);
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
class DatabaseError extends Error {
  constructor(message) {
    super('Database Error: ' + message);
  }
}

class Database extends EventEmitter {
  constructor(key,cbv, dn,rv ) {
    if(key !== secretKey) throw new DatabaseError('Cannot construct Database class directly');
    super()
    this._callingdb = cbv
    this.requiredVersion = rv;
    this.dbfile = path.resolve(process.env.SQLITE_DB_DIR,dn + '.db');
    if (databases.has(this.dbfile)) {
      const pool = databases.get(this.dbfile);
      this._db = pool.shift();
      if (pool.length > 0) {
        databases.set(this.dbfile, pool);
      } else {
        databases.delete(this.dbfile);
      }
    } else {
      this._db  = new DatabaseSync(this.dbfile);
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
  static async build(creatingdb,dn,rv = 0) {
    const dbName = dn
    const requiredVersion = rv;
    await getConnectionPermission();
    const db =  new Database(secretKey,creatingdb ,dbName, requiredVersion)
    openDBs.add(db)
    return db;
  }
  all(strings,...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    return this._tagstore.all(strings, ...keys);
  }
  close(skipVacuum) {
    debug('Database closing with Tag Store Size', this._tagstore.size(), 'Capacity', this._tagstore.capacity);
    if (this.isOpen) {
      if (!skipVacuum) this.exec('VACUUM');
      this.emit('dbclose',this)
      
    }
    let pool;
    if (databases.has(this.dbFile)) {
        pool = databases.get(this.dbfile);
    } else {
      pool = []; //no entry yet so make one
    }
    if (pool.length < poolMin && !shuttingDown) {
      pool.pop({...this._db});
      databases.set(this.dbfile,pool);
    } else {
      this._db.close();
      releaseConnection();
    }
    this._db = null
    openDBs.delete(this);
  }
  exec(sql) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
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
    if (this._db === null) return false;
    return this._db.isOpen;
  }
  iterate(strings,...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    return this._tagstore.iterate(strings, ...keys);
  }
  prepare(sql) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    return this._db.prepare(sql)
  }
  run(strings, ...keys) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    this._tagstore.run(strings, ...keys)
  }
  async transaction(callback) {
    if (!this.isOpen) throw new DatabaseError('Not Open')
    let returnValue;
    this._db.exec('BEGIN TRANSACTION');
    try {
      returnValue = await callback(this);
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
    const db = Database.build(this._callingdb,this.dbfile);
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


export const openDatabase = async(dn,rv = 0) => {
  
  const dbName = dn
  const requiredVersion = rv;
  const db = await Database.build(null,dbName,requiredVersion);
  try {
    await db.transaction(async (tdb) => {
      tdb.exec('PRAGMA foreign_keys = OFF;');
      const {count} = tdb.get`SELECT COUNT(*) as count FROM pragma_table_list() where schema = 'main'`;
      if (count <= 1) {
        const dbInitFile =  path.resolve(process.env.SQLITE_DB_INITDIR, `database-${dbName}.sql`);
        //we haven't set up the database yet.  time to do so
        const database = await fs.readFile(dbInitFile,{ encoding: 'utf8' });
        tdb.exec(database);

      }
      if (Number.isInteger(requiredVersion) && requiredVersion > 0) {
        const {name} = tdb.get`SELECT name from pragma_table_list() WHERE name = 'Settings'`??{name:null};
        if (name !== null) {
          const {value:dbVersion} = tdb.get`SELECT value FROM Settings WHERE name = ${'db-version'}`??{value:0};
          if (dbVersion !== requiredVersion) {
            if (dbVersion > requiredVersion) throw new DatabaseError(`Version of Database (${dbVersion})is higher than Required (${requiredVersion})`);   
            for (let version = dbVersion; version < requiredVersion; version++) {
              const upgradeFile = path.resolve(process.env.SQLITE_DB_INITDIR, `upgrade-${dbName}_${version}.sql`) ;
              let update;         
              try {
                update = await fs.readFile(upgradeFile, { encoding: 'utf8' });
              } catch (e) {
                throw new DatabaseError(`Missing version file ${upgradeFile} doesn't exist`);
              }
              tdb.exec(update);
              tdb.run`UPDATE Settings SET value = ${version + 1} WHERE name = ${'db-version'}`
            }   
          }
        }      
      }
      tdb.exec('PRAGMA foreign_keys = ON;');
    });
      
  } catch(e) {
    logger('error', e.stack);
    db.close();
  }
  return db; 
};

process.on('exit',() => {
  shuttingDown = true;
  for (const pool of databases) {
    for(const db of pool[1]) db.close();  
  }
  for (const db of openDBs) db.close(true);
});

const sqlite = await openDatabase(process.env.SQLITE_DB_NAME, Number(process.env.SQLITE_DB_VERSION));
export default sqlite;

