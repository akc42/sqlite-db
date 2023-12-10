/**
@licence
    Copyright (c) 2020 Alan Chandler, all rights reserved

    This file is part of Meeting.

    Meeting is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Meeting is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Meeting.  If not, see <http://www.gnu.org/licenses/>.
*/
import Database from 'better-sqlite3';
import Debug from 'debug';
import fs from 'node:fs';


const debug = Debug('database');
let db;

export default function (dbfilename, initfile) {

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

    db.pragma('foreign_keys = ON');
    process.on('exit', () => db.close());
  }
  return db;
} 
