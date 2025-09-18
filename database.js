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
import Database from 'better-sqlite3';
import Debug from 'debug';
import fs from 'node:fs';

const debug = Debug('database');
let db;

export default function (dbfilename, initdir) {
  if (!db) {
    try {
      db = new Database(dbfilename);
    } catch(e) {
      if (e.code === 'SQLITE_CANTOPEN') {
        //looks like database didn't exist, so we had better make if from scratch
        try {
          debug ('could not open database as it did not exist - so now going to create it');
          db = new Database(dbfilename, { fileMustExist: false, timeout: 5000 });
          debug('Opened database - ready to start creating structure');
          const database = fs.readFileSync(initfile, 'utf8');
          db.exec(database);
          const pin = 'T' + ('000000' + (Math.floor(Math.random() * 999999)).toString()).slice(-6); //make a new pin 
          debug('going to use', pin, 'as our token key');
          db.prepare(`UPDATE settings SET value = ? WHERE name = 'token_key'`).run(pin);
          debug('Successfully updated blank database with script')
        } catch (e) {
          fs.unlinkSync(dbfilename); //failed to create it. so delete it so we can correct problem and try again.
          throw new Error(`Encountered ${e.toString()} error when trying to create ${dbfilename} or to initialsize from ${initfile}`)
        }
      } else {
        throw new Error(`Encountered ${e.toString()} error when opening database`);
      }
    }
    /*
      now database is open - see if we need to check for a version
    */
    if (typeof process.env.DATABASE_DB_VERSION !== 'undefined') {
      // check there is a settings table
      const dbSettingsTable = db.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'settings'`).pluck().get();
      if (dbSettingsTable > 0) {
        //read version to see if it is up to date
        const dbVersion = db.prepare(`SELECT value FROM settings WHERE name = 'version'`).pluck().get();
        const requiredVersion = parseInt(process.env.DATABASE_DB_VERSION,10);
        debug('database is at version ', dbVersion, ' we require ', requiredVersion);
        if (dbVersion !== requiredVersion) {
          if (dbVersion > requiredVersion) throw new Error('Setting Version in Database higher than required version');
          db.pragma('foreign_keys = OFF');
          const upgradeVersions = db.transaction(() => {
            for (let version = dbVersion; version < requiredVersion; version++) {
              if (fs.existsSync(path.resolve(initdir, `pre-upgrade_${version}.sql`))) {
                debug('do pre upgrade on version', version)
                //if there is a site specific update we need to do before running upgrade do it
                const update = fs.readFileSync(path.resolve(initdir, `pre-upgrade_${version}.sql`), { encoding: 'utf8' });
                db.exec(update);
              }
              debug('do upgrade on version', version)
              const update = fs.readFileSync(path.resolve(initdir, `upgrade_${version}.sql`),{ encoding: 'utf8' });
              db.exec(update);
              if (fs.existsSync(path.resolve(initdir,`post-upgrade_${version}.sql`))) {
                debug('do post upgrade on version', version);
                //if there is a site specific update we need to do after running upgrade do it
                const update = fs.readFileSync(path.resolve(initdir, `post-upgrade_${version}.sql`), { encoding: 'utf8' });
                db.exec(update);
              }
            }
          });
          upgradeVersions.exclusive();
        }
      }
    }
    db.exec('VACUUM');
    db.pragma('foreign_keys = ON');
    process.on('exit', () => {
      let tmp = db;
      db = null;
      tmp.close()
    });
  }
  return db;
} 
