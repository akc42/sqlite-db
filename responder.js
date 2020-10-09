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


(function() {
  'use strict';

  const debug = require('debug')('responder');
  
  class Responder {
    constructor(response) {
      debug('Starting responder');
      this.response = response;
      this.doneFirstRow = false;
      this.doneFirstSection = false;
      this.ended = false;
      this.isArray = false;
      this.awaitingDrain = false;
    }
    addSection(name, value) {
      if (!this.ended) {
        if (this.isArray) {
          throw new Error('Cannot add section to an array');
        }
        if (this.doneFirstSection) {
          //need to close previous one
          if (this.inSection) {
            this.response.write(']');
          }
          this.response.write(',"' + name + '": ');
        } else {
          this.response.write('{"' + name + '": ');
        }

        if (value !== undefined) {
          this.response.write(JSON.stringify(value));
          this.inSection = false;
          debug('Value section %s',name);
        } else {
          this.response.write('[');
          this.inSection = true;
          debug('In section %s',name);
        }
        this.doneFirstSection = true;
        this.doneFirstRow = false;
      }
    }
    write(row) {
      if (!this.ended) {
        if (!this.doneFirstSection) {
          this.isArray = true;
          this.response.write('[');
          this.doneFirstSection = true;
          this.inSection = true;
        }
        if (!this.inSection) {
          throw new Error('Cannot add rows after a value section without a new section header');
        }
        if (this.doneFirstRow) {
          this.response.write(',');
        }
        this.doneFirstRow = true;
        const JSONrow = JSON.stringify(row);
        const reply = this.response.write(JSONrow);
        if (reply) {
          return Promise.resolve();
        }
        debug('False reply from write so need return the promise of a drain');
        if (!this.awaitingDrain) {
          this.awaitingDrain = true;
          const self = this;
          debug('create a drain promise as we do not have one');
          this.drainPromise = new Promise(resolve => {
            self.response.once('drain', () => {
              self.awaitingDrain = false;
              debug('drained so resolve promise of drain');
              resolve();
            });
          });
        }
        return this.drainPromise;
      }
      return Promise.reject(); //mark as blocked
    }
    end() {
      debug('End Responder');
      if (!this.ended) {
        if (this.inSection) {
          this.response.write(']');
        }
        if (!this.isArray) {
          if (this.doneFirstSection) {
            this.response.end('}');
          } else {
            this.response.end('[]');
          }
        } else {
          this.response.end();
        }
      }
      this.ended = true;
    }
  }
  module.exports = Responder;
})();
